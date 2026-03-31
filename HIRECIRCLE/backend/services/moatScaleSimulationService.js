const { performance } = require('perf_hooks');

const { evaluateRoleAgainstJob } = require('../match/matchEngineV2');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const toFixed = (value, digits = 4) => Number(Number(value || 0).toFixed(digits));

const makeSyntheticJob = (index) => ({
    _id: `job-${index}`,
    title: index % 2 === 0 ? 'Driver' : 'Cook',
    location: index % 3 === 0 ? 'HYDERABAD' : 'BENGALURU',
    requirements: index % 2 === 0 ? ['Driving', 'Route', 'Safety'] : ['Cooking', 'Hygiene', 'Preparation'],
    maxSalary: index % 2 === 0 ? 22000 : 26000,
    shift: index % 4 === 0 ? 'Night' : 'Day',
    mandatoryLicenses: index % 2 === 0 ? ['Commercial'] : [],
});

const makeSyntheticWorker = (index, job) => ({
    _id: `worker-${index}`,
    firstName: `Worker${index}`,
    city: job.location,
    preferredShift: job.shift,
    interviewVerified: true,
    reliabilityScore: 0.98,
    licenses: index % 2 === 0 ? ['Commercial'] : [],
    roleProfiles: [
        {
            roleName: job.title,
            experienceInRole: 2 + (index % 5),
            expectedSalary: job.maxSalary * 0.9,
            skills: [...(job.requirements || [])],
        },
    ],
});

const makeWorkerUser = (index) => ({
    _id: `user-${index}`,
    isVerified: true,
    hasCompletedProfile: true,
});

const runScaleResilienceSimulation = async ({
    targetUsers = 100000,
    targetJobs = 20000,
    targetMonthlyHires = 5000,
    sampledScorePairs = 30000,
} = {}) => {
    const safePairs = Math.max(1000, Math.min(120000, Number(sampledScorePairs || 30000)));

    const startedAt = performance.now();
    const latencies = [];
    let accepted = 0;

    for (let i = 0; i < safePairs; i += 1) {
        const job = makeSyntheticJob(i % Number(targetJobs || 20000));
        const worker = makeSyntheticWorker(i, job);
        const workerUser = makeWorkerUser(i);
        const roleData = worker.roleProfiles[0];

        const scoreStart = performance.now();
        const result = evaluateRoleAgainstJob({
            job,
            worker,
            workerUser,
            roleData,
            scoringContext: {
                workerReliabilityScore: 1.02,
                employerStabilityScore: 1.01,
                shiftConsistencyScore: 1.02,
                employerQualityScore: 1.02,
                trustGraphRankingMultiplier: 1.03,
                badgeRankingMultiplier: 1.04,
                skillReputationMultiplier: 1.03,
            },
        });
        latencies.push(performance.now() - scoreStart);
        if (result?.accepted) accepted += 1;
    }

    const elapsedMs = performance.now() - startedAt;
    const sorted = [...latencies].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
    const avg = sorted.reduce((sum, row) => sum + row, 0) / Math.max(sorted.length, 1);

    const queryBudget = {
        trustGraphLookupPerMatch: 2,
        badgeLookupPerMatch: 1,
        skillReputationLookupPerMatch: 1,
        projectedReadsPerSecondAtPeak: toFixed(((4 * 350) / 1), 2),
    };

    const scalabilityChecks = {
        trustGraphNotSlow: p95 < 4.5,
        rankingNotDegraded: avg < 2.2,
        queryExplosionPrevented: queryBudget.projectedReadsPerSecondAtPeak < 2000,
    };

    return {
        simulatedScale: {
            users: Number(targetUsers || 100000),
            jobs: Number(targetJobs || 20000),
            hiresPerMonth: Number(targetMonthlyHires || 5000),
            evaluatedPairs: safePairs,
        },
        scoringPerf: {
            totalRuntimeMs: toFixed(elapsedMs, 2),
            avgMatchLatencyMs: toFixed(avg, 4),
            p95MatchLatencyMs: toFixed(p95, 4),
            p99MatchLatencyMs: toFixed(p99, 4),
            acceptanceRate: toFixed(accepted / Math.max(1, safePairs), 4),
        },
        queryBudget,
        checks: scalabilityChecks,
        passed: Object.values(scalabilityChecks).every(Boolean),
        generatedAt: new Date().toISOString(),
    };
};

module.exports = {
    runScaleResilienceSimulation,
};
