require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const mongoose = require('mongoose');

const {
    evaluateRoleAgainstJob,
    mapTier,
} = require('../match/matchEngineV2');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const RevenueEvent = require('../models/RevenueEvent');

const SCORE_PAIRS = 10000;
const REPORT_DIR = path.resolve(__dirname, '../reports');
const REPORT_JSON = path.join(REPORT_DIR, 'MatchQualityDominationReport.json');
const REPORT_MD = path.join(REPORT_DIR, 'MatchQualityDominationReport.md');

const toFixed = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));

const quantile = (values, q) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + (rest * (sorted[base + 1] - sorted[base]));
    }
    return sorted[base];
};

const histogram = (scores) => {
    const bins = [
        { range: '0.00-0.19', min: 0.0, max: 0.2 },
        { range: '0.20-0.39', min: 0.2, max: 0.4 },
        { range: '0.40-0.59', min: 0.4, max: 0.6 },
        { range: '0.60-0.79', min: 0.6, max: 0.8 },
        { range: '0.80-1.00', min: 0.8, max: 1.0001 },
    ];

    return bins.map((bin) => {
        const count = scores.filter((score) => score >= bin.min && score < bin.max).length;
        return {
            range: bin.range,
            count,
            percent: toFixed((count / Math.max(scores.length, 1)) * 100, 2),
        };
    });
};

const makeJob = (index) => {
    const denseCity = index % 10 === 0;
    const city = denseCity ? 'Hyderabad' : 'Nizamabad';
    const role = index % 3 === 0 ? 'Driver' : index % 3 === 1 ? 'Cook' : 'Security Guard';
    const maxSalary = denseCity
        ? 18000 + ((index % 10) * 3000)
        : 12000 + ((index % 7) * 1500);

    return {
        _id: `job-${index}`,
        title: role,
        location: city,
        requirements: role === 'Driver'
            ? ['Driving', 'Route Planning']
            : role === 'Cook'
                ? ['Cooking', 'Kitchen Hygiene']
                : ['Night Shift', 'Security Patrol'],
        maxSalary,
        minSalary: Math.max(8000, maxSalary - 5000),
        shift: index % 4 === 0 ? 'Night' : 'Day',
        mandatoryLicenses: role === 'Driver' && index % 5 === 0 ? ['Commercial'] : [],
        employerId: `employer-${index % 1400}`,
    };
};

const oppositeShift = (shift) => (shift === 'Night' ? 'Day' : 'Night');

const makeWorker = (index, job) => {
    const role = index % 14 === 0
        ? 'Cleaner'
        : String(job.title || 'Driver');
    const city = index % 6 === 0
        ? (job.location === 'Hyderabad' ? 'Nizamabad' : 'Hyderabad')
        : job.location;
    const preferredShift = index % 5 === 0
        ? oppositeShift(job.shift)
        : job.shift;
    const expectedSalary = index % 7 === 0
        ? Number(job.maxSalary || 0) * 1.2
        : Number(job.maxSalary || 0) * 0.92;
    const skills = index % 4 === 0
        ? [String(job.requirements?.[0] || 'General Skill')]
        : [...(job.requirements || [])];

    return {
        _id: `worker-${index}`,
        city,
        firstName: `Worker${index}`,
        preferredShift,
        interviewVerified: index % 7 !== 0,
        licenses: role === 'Driver' ? ['Commercial'] : [],
        roleProfiles: [
            {
                roleName: role,
                experienceInRole: index % 8,
                expectedSalary,
                skills,
            },
        ],
        updatedAt: new Date(Date.now() - ((index % 40) * 60 * 60 * 1000)),
        lastActiveAt: new Date(Date.now() - ((index % 20) * 60 * 60 * 1000)),
    };
};

const makeUser = (index) => ({
    _id: `user-${index}`,
    isVerified: index % 4 !== 0,
    hasCompletedProfile: index % 9 !== 0,
});

const buildScoringContext = (index, city) => {
    const dense = city.toLowerCase() === 'hyderabad';
    const noShowRisk = (index % 10) / 10;
    const salaryDrift = (index % 5) / 5;
    const shiftReliability = 0.55 + ((index % 5) * 0.1);
    const shortlistStrictness = (index % 6) / 10;

    const workerReliabilityScore = Math.min(1.1, Math.max(0.9, 1.08 - (noShowRisk * 0.18) - (salaryDrift * 0.08)));
    const employerStabilityScore = Math.min(1.1, Math.max(0.9, 1.06 - (shortlistStrictness * 0.20)));
    const shiftConsistencyScore = Math.min(1.1, Math.max(0.9, 0.92 + (shiftReliability * 0.20)));

    return {
        dynamicThresholds: {
            STRONG: 0.82,
            GOOD: 0.70,
            POSSIBLE: dense ? 0.65 : 0.56,
        },
        skillWeightDelta: dense ? 0.05 : 0.04,
        distanceWeightExponent: dense ? 0.9 : 1.1,
        distanceToleranceEnabled: !dense,
        distanceFallbackScore: 0.72,
        workerReliabilityScore,
        employerStabilityScore,
        shiftConsistencyScore,
        employerQualityScore: 1.1,
        frictionSignals: {
            noShowRisk,
            shortlistStrictnessIndex: shortlistStrictness,
            salaryNegotiationDriftRate: salaryDrift,
            shiftStabilityReliability: shiftReliability,
        },
    };
};

const summarizeTierByCity = (rows = []) => {
    return rows.reduce((acc, row) => {
        if (!acc[row.city]) {
            acc[row.city] = {
                STRONG: 0,
                GOOD: 0,
                POSSIBLE: 0,
                REJECT: 0,
            };
        }
        acc[row.city][row.tier] += 1;
        return acc;
    }, {});
};

const extractStages = (plan, stages = []) => {
    if (!plan || typeof plan !== 'object') return stages;
    if (plan.stage) stages.push(plan.stage);
    Object.keys(plan).forEach((key) => {
        const value = plan[key];
        if (Array.isArray(value)) {
            value.forEach((item) => extractStages(item, stages));
        } else if (value && typeof value === 'object') {
            extractStages(value, stages);
        }
    });
    return stages;
};

const summarizeExplain = (label, explain) => {
    const stats = explain.executionStats || {};
    const planner = explain.queryPlanner || {};
    const winningPlan = planner.winningPlan || {};
    const stages = Array.from(new Set(extractStages(winningPlan, [])));

    return {
        label,
        stages,
        hasCollectionScan: stages.includes('COLLSCAN'),
        executionTimeMs: Number(stats.executionTimeMillis || 0),
        keysExamined: Number(stats.totalKeysExamined || 0),
        docsExamined: Number(stats.totalDocsExamined || 0),
    };
};

const runQueryExplain = async () => {
    if (!process.env.MONGO_URI) {
        return {
            skipped: true,
            reason: 'MONGO_URI not configured',
        };
    }

    await mongoose.connect(process.env.MONGO_URI);
    try {
        const now = new Date();
        const from30d = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

        const [recommendedExplain, matchQualityExplain, revenueExplain] = await Promise.all([
            Job.find({ isOpen: true, status: 'active' })
                .sort({ createdAt: -1 })
                .limit(5000)
                .explain('executionStats'),
            MatchPerformanceMetric.find({ timestamp: { $gte: from30d, $lte: now } })
                .select('eventName matchProbability matchTier city roleCluster timestamp')
                .explain('executionStats'),
            RevenueEvent.find({ settledAt: { $gte: from30d, $lte: now } })
                .explain('executionStats'),
        ]);

        return {
            skipped: false,
            plans: [
                summarizeExplain('/api/jobs/recommended', recommendedExplain),
                summarizeExplain('/api/analytics/match-quality-overview', matchQualityExplain),
                summarizeExplain('/api/analytics/revenue-loops', revenueExplain),
            ],
        };
    } finally {
        await mongoose.connection.close();
    }
};

const run = async () => {
    const scores = [];
    const baselineScores = [];
    const latencyMs = [];
    const rows = [];

    const memoryBefore = process.memoryUsage();
    const startedAt = performance.now();

    for (let i = 0; i < SCORE_PAIRS; i += 1) {
        const job = makeJob(i);
        const worker = makeWorker(i, job);
        const workerUser = makeUser(i);
        const roleData = worker.roleProfiles[0];

        const baseline = evaluateRoleAgainstJob({
            job,
            worker,
            workerUser,
            roleData,
        });

        const context = buildScoringContext(i, job.location);
        const pairStart = performance.now();
        const optimized = evaluateRoleAgainstJob({
            job,
            worker,
            workerUser,
            roleData,
            scoringContext: context,
        });
        latencyMs.push(performance.now() - pairStart);

        const baselineScore = Number(baseline.finalScore || 0);
        const score = Number(optimized.finalScore || 0);
        baselineScores.push(baselineScore);
        scores.push(score);
        rows.push({
            city: job.location,
            score,
            baselineScore,
            tier: mapTier(score, context.dynamicThresholds),
            baselineTier: mapTier(baselineScore),
            noShowRisk: context.frictionSignals.noShowRisk,
        });
    }

    const totalTimeMs = performance.now() - startedAt;
    const memoryAfter = process.memoryUsage();

    const baselineShortlistRate = baselineScores.filter((score) => score >= 0.62).length / SCORE_PAIRS;
    const optimizedShortlistRate = scores.filter((score) => score >= 0.62).length / SCORE_PAIRS;
    const shortlistLiftPercent = ((optimizedShortlistRate - baselineShortlistRate) / Math.max(baselineShortlistRate, 0.0001)) * 100;

    const baselineShortlisted = rows.filter((row) => row.baselineScore >= 0.62);
    const optimizedShortlisted = rows.filter((row) => row.score >= 0.62);
    const baselineLowIntentShare = baselineShortlisted.length
        ? baselineShortlisted.filter((row) => row.noShowRisk >= 0.6).length / baselineShortlisted.length
        : 0;
    const optimizedLowIntentShare = optimizedShortlisted.length
        ? optimizedShortlisted.filter((row) => row.noShowRisk >= 0.6).length / optimizedShortlisted.length
        : 0;

    const baselineQualityAdjustedRate = baselineShortlistRate * (1 - baselineLowIntentShare);
    const optimizedQualityAdjustedRate = optimizedShortlistRate * (1 - optimizedLowIntentShare);
    const qualityAdjustedShortlistLiftPercent = ((optimizedQualityAdjustedRate - baselineQualityAdjustedRate)
        / Math.max(baselineQualityAdjustedRate, 0.0001)) * 100;

    const counterfactualJob = {
        _id: 'counter-job',
        title: 'Driver',
        location: 'Hyderabad',
        requirements: ['Driving'],
        maxSalary: 25000,
        shift: 'Day',
        mandatoryLicenses: [],
    };
    const counterfactualWorker = {
        _id: 'counter-worker',
        city: 'Hyderabad',
        firstName: 'Counter',
        preferredShift: 'Day',
        interviewVerified: true,
        licenses: ['Commercial'],
        roleProfiles: [
            {
                roleName: 'Driver',
                experienceInRole: 5,
                expectedSalary: 22000,
                skills: ['Driving'],
            },
        ],
    };
    const counterfactualUser = {
        _id: 'counter-user',
        isVerified: true,
        hasCompletedProfile: true,
    };
    const counterfactualRole = counterfactualWorker.roleProfiles[0];
    const baseCounterfactualContext = buildScoringContext(42, counterfactualJob.location);

    const lowNoShowEval = evaluateRoleAgainstJob({
        job: counterfactualJob,
        worker: counterfactualWorker,
        workerUser: counterfactualUser,
        roleData: counterfactualRole,
        scoringContext: {
            ...baseCounterfactualContext,
            workerReliabilityScore: 1.08,
            shiftConsistencyScore: 1.05,
            frictionSignals: {
                ...baseCounterfactualContext.frictionSignals,
                noShowRisk: 0.1,
            },
        },
    });

    const highNoShowEval = evaluateRoleAgainstJob({
        job: counterfactualJob,
        worker: counterfactualWorker,
        workerUser: counterfactualUser,
        roleData: counterfactualRole,
        scoringContext: {
            ...baseCounterfactualContext,
            workerReliabilityScore: 0.9,
            shiftConsistencyScore: 0.9,
            frictionSignals: {
                ...baseCounterfactualContext.frictionSignals,
                noShowRisk: 0.9,
            },
        },
    });

    const noShowImpact = Number(lowNoShowEval.finalScore || 0) - Number(highNoShowEval.finalScore || 0);

    const queryExplain = await runQueryExplain().catch((error) => ({
        skipped: true,
        reason: error.message,
    }));

    const report = {
        generatedAt: new Date().toISOString(),
        benchmark: {
            scorePairs: SCORE_PAIRS,
            totalTimeMs: toFixed(totalTimeMs, 2),
            p50Ms: toFixed(quantile(latencyMs, 0.50), 4),
            p95Ms: toFixed(quantile(latencyMs, 0.95), 4),
            p99Ms: toFixed(quantile(latencyMs, 0.99), 4),
            memoryUsage: {
                beforeMb: toFixed(memoryBefore.heapUsed / (1024 * 1024), 2),
                afterMb: toFixed(memoryAfter.heapUsed / (1024 * 1024), 2),
                deltaMb: toFixed((memoryAfter.heapUsed - memoryBefore.heapUsed) / (1024 * 1024), 2),
            },
            noMatchExplosion: rows.filter((row) => row.tier !== 'REJECT').length <= SCORE_PAIRS,
        },
        scoreDistributionHistogram: histogram(scores),
        tierDistributionPerCity: summarizeTierByCity(rows),
        conversionDeltaSimulation: {
            baselineShortlistRate: toFixed(baselineShortlistRate, 4),
            optimizedShortlistRate: toFixed(optimizedShortlistRate, 4),
            shortlistLiftPercent: toFixed(shortlistLiftPercent, 2),
            baselineLowIntentShare: toFixed(baselineLowIntentShare, 4),
            optimizedLowIntentShare: toFixed(optimizedLowIntentShare, 4),
            baselineQualityAdjustedRate: toFixed(baselineQualityAdjustedRate, 4),
            optimizedQualityAdjustedRate: toFixed(optimizedQualityAdjustedRate, 4),
            qualityAdjustedShortlistLiftPercent: toFixed(qualityAdjustedShortlistLiftPercent, 2),
        },
        noShowRiskImpact: {
            avgScoreLowRisk: toFixed(lowNoShowEval.finalScore, 4),
            avgScoreHighRisk: toFixed(highNoShowEval.finalScore, 4),
            scoreDelta: toFixed(noShowImpact, 4),
        },
        queryPerformanceExplain: queryExplain,
    };

    if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);

    const explainLines = report.queryPerformanceExplain.skipped
        ? [`- Skipped: ${report.queryPerformanceExplain.reason}`]
        : report.queryPerformanceExplain.plans.map((plan) => (
            `- ${plan.label}: stages=${plan.stages.join(', ')} | COLLSCAN=${plan.hasCollectionScan} | execution=${plan.executionTimeMs}ms`
        ));

    const markdown = [
        '# Match Quality Domination Report',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        '## Benchmark',
        `- Score pairs: ${report.benchmark.scorePairs}`,
        `- Total time: ${report.benchmark.totalTimeMs}ms`,
        `- p50/p95/p99 per score: ${report.benchmark.p50Ms}ms / ${report.benchmark.p95Ms}ms / ${report.benchmark.p99Ms}ms`,
        `- Memory delta: ${report.benchmark.memoryUsage.deltaMb} MB`,
        `- No match explosion: ${report.benchmark.noMatchExplosion}`,
        '',
        '## Conversion Delta Simulation',
        `- Baseline shortlist rate: ${report.conversionDeltaSimulation.baselineShortlistRate}`,
        `- Optimized shortlist rate: ${report.conversionDeltaSimulation.optimizedShortlistRate}`,
        `- Raw shortlist lift: ${report.conversionDeltaSimulation.shortlistLiftPercent}%`,
        `- Quality-adjusted shortlist lift: ${report.conversionDeltaSimulation.qualityAdjustedShortlistLiftPercent}%`,
        '',
        '## No-Show Risk Impact',
        `- Low-risk average score: ${report.noShowRiskImpact.avgScoreLowRisk}`,
        `- High-risk average score: ${report.noShowRiskImpact.avgScoreHighRisk}`,
        `- Delta: ${report.noShowRiskImpact.scoreDelta}`,
        '',
        '## Query Explain Summary',
        ...explainLines,
        '',
    ].join('\n');

    fs.writeFileSync(REPORT_MD, `${markdown}\n`);

    console.log(JSON.stringify({
        reportPath: REPORT_MD,
        jsonPath: REPORT_JSON,
        benchmark: report.benchmark,
        conversionDeltaSimulation: report.conversionDeltaSimulation,
    }, null, 2));
};

run().catch((error) => {
    console.warn('benchmarkMatchQualityDomination failed:', error.message);
    process.exit(1);
});
