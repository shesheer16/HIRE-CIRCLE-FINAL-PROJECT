const Application = require('../models/Application');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchRun = require('../models/MatchRun');
const WorkerProfile = require('../models/WorkerProfile');
const mongoose = require('mongoose');
const { evaluateCityBalancing } = require('../match/cityBalancingLayer');
const { getEmployerTierMap } = require('./employerTierService');
const { getTrustBreakdownForUser } = require('./trustGraphService');
const { getBadgeMap, getBadgeForUser } = require('./verificationBadgeService');
const {
    getSkillReputationProfileForUser,
    computeSkillReputationBoostFromProfile,
} = require('./skillReputationService');
const {
    BASE_MATCH_THRESHOLDS,
    DYNAMIC_RULES,
    normalizeThresholds,
} = require('../config/matchDynamicThresholds');
const {
    CITY_DENSITY_RULES,
    BASE_CITY_MATCH_PROFILE,
    HIGH_DENSITY_PROFILE,
    LOW_DENSITY_PROFILE,
} = require('../config/cityMatchProfiles');
const {
    getBehaviorProfile,
    getBehaviorSignalsForMatch,
} = require('./behavioralScoringEngine');
const {
    readAdaptiveWeights,
    toMatchEngineWeightContext,
} = require('./adaptiveMatchWeightEngine');

const CACHE_TTL_MS = 5 * 60 * 1000;
const dynamicThresholdCache = new Map();
const cityProfileCache = new Map();
const employerSignalCache = new Map();
const workerSignalCache = new Map();

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const ratio = (num, den) => (den > 0 ? Number(num || 0) / Number(den) : 0);

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value, fallback = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const toObjectIdOrRaw = (value) => {
    if (mongoose.Types.ObjectId.isValid(value)) {
        return new mongoose.Types.ObjectId(value);
    }
    return value;
};

const readCache = (cache, key) => {
    const hit = cache.get(key);
    if (!hit) return null;
    if ((Date.now() - hit.cachedAt) > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return hit.value;
};

const writeCache = (cache, key, value) => {
    cache.set(key, {
        cachedAt: Date.now(),
        value,
    });
    return value;
};

const buildTierStats = (rows = []) => {
    const stats = {
        STRONG: { served: 0, applications: 0, hires: 0 },
        GOOD: { served: 0, applications: 0, hires: 0 },
        POSSIBLE: { served: 0, applications: 0, hires: 0 },
    };

    rows.forEach((row) => {
        const tier = String(row._id?.tier || '').toUpperCase();
        const eventName = String(row._id?.eventName || '').toUpperCase();
        if (!stats[tier]) return;

        if (eventName === 'MATCH_RECOMMENDATION_VIEWED') {
            stats[tier].served += Number(row.count || 0);
        } else if (eventName === 'APPLICATION_CREATED') {
            stats[tier].applications += Number(row.count || 0);
        } else if (eventName === 'APPLICATION_HIRED') {
            stats[tier].hires += Number(row.count || 0);
        }
    });

    return stats;
};

const loadDynamicThresholdsForCity = async (city) => {
    const normalizedCity = normalizeText(city, 'global');
    const cacheKey = `thresholds:${normalizedCity}`;
    const cached = readCache(dynamicThresholdCache, cacheKey);
    if (cached) return cached;

    const from = new Date(Date.now() - (45 * 24 * 60 * 60 * 1000));
    const match = {
        timestamp: { $gte: from },
        eventName: { $in: ['MATCH_RECOMMENDATION_VIEWED', 'APPLICATION_CREATED', 'APPLICATION_HIRED'] },
        matchTier: { $in: ['STRONG', 'GOOD', 'POSSIBLE'] },
    };

    if (normalizedCity !== 'global') {
        match.city = new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i');
    }

    const rows = await MatchPerformanceMetric.aggregate([
        { $match: match },
        {
            $group: {
                _id: {
                    eventName: '$eventName',
                    tier: '$matchTier',
                },
                count: { $sum: 1 },
            },
        },
    ]);

    const tierStats = buildTierStats(rows);
    const strongApplyRate = ratio(tierStats.STRONG.applications, tierStats.STRONG.served);
    const goodApplyRate = ratio(tierStats.GOOD.applications, tierStats.GOOD.served);
    const possibleHireRate = ratio(tierStats.POSSIBLE.hires, tierStats.POSSIBLE.applications);

    let skillWeightDelta = 0;
    if (strongApplyRate > 0 && goodApplyRate < (strongApplyRate * DYNAMIC_RULES.GOOD_UNDERPERFORMANCE_RATIO)) {
        const drop = strongApplyRate - goodApplyRate;
        skillWeightDelta = clamp(Number((drop * 0.35).toFixed(4)), 0, DYNAMIC_RULES.MAX_SKILL_WEIGHT_DELTA);
    }

    const possibleFloor = (
        tierStats.POSSIBLE.applications >= 20
        && possibleHireRate < DYNAMIC_RULES.POSSIBLE_HIRE_RATE_MIN
    )
        ? DYNAMIC_RULES.POSSIBLE_THRESHOLD_RAISED
        : BASE_MATCH_THRESHOLDS.POSSIBLE;

    const thresholds = normalizeThresholds({
        STRONG: BASE_MATCH_THRESHOLDS.STRONG,
        GOOD: BASE_MATCH_THRESHOLDS.GOOD,
        POSSIBLE: possibleFloor,
    });

    return writeCache(dynamicThresholdCache, cacheKey, {
        city: normalizedCity,
        thresholds,
        skillWeightDelta,
        diagnostics: {
            strongApplyRate,
            goodApplyRate,
            possibleHireRate,
            tierStats,
        },
    });
};

const loadCityProfile = async (city) => {
    const normalizedCity = normalizeText(city, 'global');
    const cacheKey = `city:${normalizedCity}`;
    const cached = readCache(cityProfileCache, cacheKey);
    if (cached) return cached;

    if (normalizedCity === 'global') {
        return writeCache(cityProfileCache, cacheKey, {
            city: normalizedCity,
            activeWorkerCount: 0,
            workersPerJob: 0,
            ...BASE_CITY_MATCH_PROFILE,
        });
    }

    const [activeWorkerCount, latestLiquidity] = await Promise.all([
        WorkerProfile.countDocuments({
            isAvailable: true,
            city: new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i'),
        }),
        CityLiquidityScore.findOne({
            city: new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i'),
        })
            .sort({ day: -1 })
            .select('workersPerJob')
            .lean(),
    ]);

    let profile = BASE_CITY_MATCH_PROFILE;
    if (activeWorkerCount > CITY_DENSITY_RULES.HIGH_DENSITY_ACTIVE_WORKERS) {
        profile = HIGH_DENSITY_PROFILE;
    } else if (activeWorkerCount < CITY_DENSITY_RULES.LOW_DENSITY_ACTIVE_WORKERS) {
        profile = LOW_DENSITY_PROFILE;
    }

    return writeCache(cityProfileCache, cacheKey, {
        city: normalizedCity,
        activeWorkerCount,
        workersPerJob: Number(latestLiquidity?.workersPerJob || 0),
        ...profile,
    });
};

const loadEmployerSignals = async (employerIds = []) => {
    const normalizedEmployerIds = Array.from(new Set(
        employerIds
            .map((id) => String(id || '').trim())
            .filter(Boolean)
    ));

    if (!normalizedEmployerIds.length) {
        return new Map();
    }

    const cacheKey = `employers:${normalizedEmployerIds.sort().join('|')}`;
    const cached = readCache(employerSignalCache, cacheKey);
    if (cached) return cached;
    const castedEmployerIds = normalizedEmployerIds.map((id) => toObjectIdOrRaw(id));

    const applicationRows = await Application.aggregate([
        {
            $match: {
                employer: { $in: castedEmployerIds },
            },
        },
        {
            $group: {
                _id: '$employer',
                totalApplications: { $sum: 1 },
                shortlisted: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0],
                    },
                },
                offersExtended: {
                    $sum: {
                        $cond: [{ $in: ['$status', ['offer_sent', 'offer_proposed', 'offer_accepted']] }, 1, 0],
                    },
                },
                offersAccepted: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'offer_accepted'] }, 1, 0],
                    },
                },
                hires: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                    },
                },
                avgResponseMs: {
                    $avg: { $subtract: ['$updatedAt', '$createdAt'] },
                },
            },
        },
    ]);

    const lifecycleRows = await HiringLifecycleEvent.aggregate([
        {
            $match: {
                employerId: { $in: castedEmployerIds },
                eventType: { $in: ['APPLICATION_HIRED', 'RETENTION_30D'] },
            },
        },
        {
            $group: {
                _id: {
                    employerId: '$employerId',
                    eventType: '$eventType',
                },
                count: { $sum: 1 },
            },
        },
    ]);

    const lifecycleByEmployer = new Map();
    lifecycleRows.forEach((row) => {
        const employerId = String(row._id?.employerId || '');
        if (!employerId) return;
        const existing = lifecycleByEmployer.get(employerId) || {
            hiredEvents: 0,
            retained30d: 0,
        };
        if (row._id?.eventType === 'APPLICATION_HIRED') {
            existing.hiredEvents += Number(row.count || 0);
        }
        if (row._id?.eventType === 'RETENTION_30D') {
            existing.retained30d += Number(row.count || 0);
        }
        lifecycleByEmployer.set(employerId, existing);
    });

    const [tierMap, employerBadgeMap] = await Promise.all([
        getEmployerTierMap({
            employerIds: normalizedEmployerIds,
            computeMissing: true,
        }),
        getBadgeMap({
            userIds: normalizedEmployerIds,
            computeMissing: true,
        }),
    ]);

    const result = new Map();
    normalizedEmployerIds.forEach((employerId) => {
        const app = applicationRows.find((row) => String(row._id) === employerId) || {
            totalApplications: 0,
            shortlisted: 0,
            offersExtended: 0,
            offersAccepted: 0,
            hires: 0,
            avgResponseMs: 72 * 60 * 60 * 1000,
        };
        const lifecycle = lifecycleByEmployer.get(employerId) || {
            hiredEvents: app.hires,
            retained30d: 0,
        };

        const shortlistRate = ratio(app.shortlisted, app.totalApplications);
        const shortlistStrictnessIndex = clamp01(1 - shortlistRate);
        const employerStabilityScore = clamp(1 - (shortlistStrictnessIndex * 0.10), 0.92, 1.05);

        const hireCompletionRate = ratio(app.hires, Math.max(app.shortlisted, 1));
        const offerAcceptanceRate = app.offersExtended > 0
            ? ratio(app.offersAccepted || app.hires, app.offersExtended)
            : ratio(app.hires, Math.max(app.shortlisted, 1));
        const retention30dRate = ratio(lifecycle.retained30d, Math.max(lifecycle.hiredEvents || app.hires, 1));

        const responseTimeHours = Number(app.avgResponseMs || 0) / (60 * 60 * 1000);
        const responseTimeScore = clamp01(1 - (responseTimeHours / 72));

        const qualityRaw = clamp01(
            (hireCompletionRate * 0.35)
            + (offerAcceptanceRate * 0.25)
            + (retention30dRate * 0.25)
            + (responseTimeScore * 0.15)
        );

        const employerTierDoc = tierMap.get(employerId) || null;
        const tierBoost = Number(employerTierDoc?.rankingBoostMultiplier || 1);
        const badgeDoc = employerBadgeMap.get(employerId) || null;
        const employerBadgeRankingMultiplier = clamp(
            Number(badgeDoc?.rankingBoostMultiplier || 1),
            1,
            1.2
        );
        const employerQualityScore = clamp(
            (0.9 + (qualityRaw * 0.2)) * tierBoost * employerBadgeRankingMultiplier,
            0.9,
            1.15
        );

        result.set(employerId, {
            shortlistStrictnessIndex,
            employerStabilityScore,
            employerQualityScore,
            employerTier: employerTierDoc?.tier || 'Standard',
            rankingBoostMultiplier: tierBoost,
            employerBadgeTier: badgeDoc?.tier || 'Basic',
            employerBadgeRankingMultiplier,
            qualityMetrics: {
                hireCompletionRate,
                offerAcceptanceRate,
                retention30dRate,
                responseTimeHours,
            },
        });
    });

    return writeCache(employerSignalCache, cacheKey, result);
};

const buildWorkerSignals = async ({ worker }) => {
    const workerId = String(worker?._id || '').trim();
    const workerUserId = worker?.user?._id || worker?.user || null;
    if (!workerId) {
        return {
            noShowRisk: 0.15,
            salaryNegotiationDriftRate: 0,
            shiftStabilityReliability: 0.75,
            workerReliabilityScore: 0.98,
            shiftConsistencyScore: 1.03,
            salaryMismatchEvents: 0,
            communicationClarityScore: 0.7,
            profileQualityScore: 0.7,
            salaryOutlierFlag: false,
            reliabilityScore: 1,
            trustGraphScore: 0,
            trustGraphRankingMultiplier: 1,
            badgeTier: 'Basic',
            badgeRankingMultiplier: 1,
            skillReputationProfile: {
                map: new Map(),
                averageScore: 0,
                topSkills: [],
            },
        };
    }

    const cacheKey = `worker:${workerId}`;
    const cached = readCache(workerSignalCache, cacheKey);
    if (cached) return cached;

    const since90d = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
    const since30d = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

    const [applications, recentRuns, trustBreakdown, workerBadge, skillReputationProfile] = await Promise.all([
        Application.find({
            worker: workerId,
            createdAt: { $gte: since90d },
        })
            .select('job status')
            .lean(),
        MatchRun.find({
            workerId,
            contextType: 'RECOMMENDED_JOBS',
            createdAt: { $gte: since30d },
        })
            .select('rejectReasonCounts')
            .lean(),
        workerUserId
            ? getTrustBreakdownForUser({ userId: workerUserId, recomputeIfMissing: true })
            : Promise.resolve(null),
        workerUserId
            ? getBadgeForUser({ userId: workerUserId, computeIfMissing: true })
            : Promise.resolve(null),
        workerUserId
            ? getSkillReputationProfileForUser({ userId: workerUserId, recomputeIfMissing: true })
            : Promise.resolve({ map: new Map(), averageScore: 0, topSkills: [] }),
    ]);

    const jobIds = Array.from(new Set(
        applications
            .map((row) => String(row.job || '').trim())
            .filter(Boolean)
    ));

    const jobs = jobIds.length
        ? await Job.find({ _id: { $in: jobIds } }).select('_id shift').lean()
        : [];
    const jobShiftById = new Map(jobs.map((row) => [String(row._id), String(row.shift || '').toLowerCase()]));

    const opportunityStatuses = new Set([
        'shortlisted',
        'interview_requested',
        'interview_completed',
        'offer_sent',
        'offer_accepted',
        'hired',
        // Legacy compatibility.
        'accepted',
        'offer_proposed',
    ]);
    const completedStatuses = new Set(['offer_accepted', 'hired']);

    let opportunities = 0;
    let completed = 0;
    let shiftAligned = 0;
    let shiftSamples = 0;

    const preferredShift = normalizeText(worker?.preferredShift || 'flexible', 'flexible');

    applications.forEach((row) => {
        const status = String(row.status || '').toLowerCase();
        if (opportunityStatuses.has(status)) {
            opportunities += 1;
            if (completedStatuses.has(status)) {
                completed += 1;
            }
        }

        const jobShift = normalizeText(jobShiftById.get(String(row.job)), 'flexible');
        if (preferredShift && preferredShift !== 'flexible' && jobShift) {
            shiftSamples += 1;
            if (jobShift === preferredShift || jobShift === 'flexible') {
                shiftAligned += 1;
            }
        }
    });

    const salaryMismatchEvents = recentRuns.reduce((sum, row) => {
        return sum + Number(row?.rejectReasonCounts?.SALARY_OUTSIDE_RANGE || 0);
    }, 0);

    const noShowRisk = opportunities > 0
        ? clamp01((opportunities - completed) / opportunities)
        : 0.15;

    const salaryNegotiationDriftRate = clamp01(salaryMismatchEvents / 3);
    const shiftStabilityReliability = shiftSamples > 0
        ? clamp01(shiftAligned / shiftSamples)
        : 0.75;

    const baseWorkerReliabilityScore = clamp(
        1 - (noShowRisk * 0.15) - (salaryNegotiationDriftRate * 0.10),
        0.9,
        1.08
    );
    const shiftConsistencyScore = clamp(0.9 + (shiftStabilityReliability * 0.18), 0.9, 1.08);
    const interviewIntelligence = worker?.interviewIntelligence || {};
    const communicationClarityScore = clamp01(
        interviewIntelligence.communicationClarityScore
        ?? worker?.communicationClarityScore
        ?? 0.7
    );
    const profileQualityScore = clamp01(
        interviewIntelligence.profileQualityScore
        ?? worker?.profileQualityScore
        ?? 0.7
    );
    const salaryOutlierFlag = Boolean(
        interviewIntelligence.salaryOutlierFlag
        ?? worker?.salaryOutlierFlag
    );
    const reliabilityScore = clamp(
        worker?.reliabilityScore
        ?? ((profileQualityScore * 0.55) + (communicationClarityScore * 0.45)),
        0.95,
        1.05
    );
    const behaviorProfile = workerUserId
        ? await getBehaviorProfile({
            userId: workerUserId,
            computeIfMissing: false,
        })
        : null;
    const behaviorSignals = getBehaviorSignalsForMatch({ profile: behaviorProfile });
    const workerReliabilityScore = clamp(
        baseWorkerReliabilityScore * Number(behaviorSignals.reliabilityBoost || 1),
        0.9,
        1.08
    );

    return writeCache(workerSignalCache, cacheKey, {
        noShowRisk,
        salaryNegotiationDriftRate,
        shiftStabilityReliability,
        workerReliabilityScore,
        shiftConsistencyScore,
        salaryMismatchEvents,
        communicationClarityScore,
        profileQualityScore,
        salaryOutlierFlag,
        reliabilityScore,
        behaviorTrustScore: Number(behaviorSignals.trustScore || 0.5),
        behaviorSpamRisk: Number(behaviorSignals.spamRisk || 0.5),
        trustGraphScore: Number(trustBreakdown?.trustGraphScore || 0),
        trustGraphRankingMultiplier: Number(trustBreakdown?.rankingMultiplier || 1),
        badgeTier: workerBadge?.tier || trustBreakdown?.badgeTier || 'Basic',
        badgeRankingMultiplier: Number(workerBadge?.rankingBoostMultiplier || 1),
        skillReputationProfile,
    });
};

const buildMatchIntelligenceContext = async ({
    worker,
    jobs = [],
    cityHint = null,
}) => {
    const city = normalizeText(
        cityHint || worker?.city || jobs[0]?.location,
        'global'
    );

    const employerIds = Array.from(new Set(
        jobs.map((job) => String(job?.employerId || '').trim()).filter(Boolean)
    ));

    const [dynamicThresholdInfo, cityProfile, workerSignals, employerSignals] = await Promise.all([
        loadDynamicThresholdsForCity(city),
        loadCityProfile(city),
        buildWorkerSignals({ worker }),
        loadEmployerSignals(employerIds),
    ]);

    const normalizedRoles = Array.from(new Set(
        jobs
            .map((job) => normalizeText(job?.title, 'general'))
            .filter(Boolean)
    ));
    const adaptiveWeightRows = await Promise.all(normalizedRoles.map(async (roleCluster) => {
        const row = await readAdaptiveWeights({ city, roleCluster });
        return [roleCluster, row];
    }));
    const adaptiveWeightMap = new Map(adaptiveWeightRows);

    const balancing = evaluateCityBalancing({
        workersPerJob: Number(cityProfile.workersPerJob || 0),
        currentThresholds: dynamicThresholdInfo.thresholds,
        currentSkillWeightDelta: Number(dynamicThresholdInfo.skillWeightDelta || 0),
    });

    const combinedSkillWeightDelta = clamp(
        Number(balancing.skillWeightDelta || 0) + Number(cityProfile.skillWeightDelta || 0),
        -0.05,
        DYNAMIC_RULES.MAX_SKILL_WEIGHT_DELTA
    );

    const dynamicThresholds = normalizeThresholds({
        ...balancing.thresholds,
        POSSIBLE: Number(balancing.thresholds.POSSIBLE || BASE_MATCH_THRESHOLDS.POSSIBLE)
            + Number(cityProfile.possibleThresholdDelta || 0),
    });

    const getScoringContextForJob = (job) => {
        const employerId = String(job?.employerId || '').trim();
        const roleCluster = normalizeText(job?.title, 'general');
        const adaptiveWeightRow = adaptiveWeightMap.get(roleCluster) || {
            weights: toMatchEngineWeightContext(),
            scopeType: 'global',
            scopeKey: 'global',
        };
        const employer = employerSignals.get(employerId) || {
            shortlistStrictnessIndex: 0.5,
            employerStabilityScore: 0.98,
            employerQualityScore: 1,
            employerBadgeTier: 'Basic',
            employerBadgeRankingMultiplier: 1,
            qualityMetrics: {
                hireCompletionRate: 0,
                offerAcceptanceRate: 0,
                retention30dRate: 0,
                responseTimeHours: 72,
            },
        };
        const skillReputation = computeSkillReputationBoostFromProfile({
            skillProfile: workerSignals.skillReputationProfile,
            job,
        });

        return {
            dynamicThresholds,
            skillWeightDelta: combinedSkillWeightDelta,
            adaptiveWeights: toMatchEngineWeightContext(adaptiveWeightRow.weights),
            adaptiveWeightScope: adaptiveWeightRow.scopeKey,
            distanceWeightExponent: Number(cityProfile.distanceWeightExponent || 1),
            distanceToleranceEnabled: Boolean(cityProfile.distanceToleranceEnabled),
            distanceFallbackScore: Number(cityProfile.distanceFallbackScore || 0),
            workerReliabilityScore: Number(workerSignals.workerReliabilityScore || 1),
            employerStabilityScore: Number(employer.employerStabilityScore || 1),
            shiftConsistencyScore: Number(workerSignals.shiftConsistencyScore || 1),
            employerQualityScore: Number(employer.employerQualityScore || 1),
            communicationClarityScore: Number(workerSignals.communicationClarityScore || 0),
            profileQualityScore: Number(workerSignals.profileQualityScore || 0),
            salaryOutlierFlag: Boolean(workerSignals.salaryOutlierFlag),
            reliabilityScore: Number(workerSignals.reliabilityScore || 1),
            trustGraphScore: Number(workerSignals.trustGraphScore || 0),
            trustGraphRankingMultiplier: Number(workerSignals.trustGraphRankingMultiplier || 1),
            badgeTier: workerSignals.badgeTier || 'Basic',
            badgeRankingMultiplier: Number(workerSignals.badgeRankingMultiplier || 1),
            employerBadgeTier: employer.employerBadgeTier || 'Basic',
            employerBadgeRankingMultiplier: Number(employer.employerBadgeRankingMultiplier || 1),
            skillReputationScore: Number(skillReputation.reputationScore || 0),
            skillReputationMultiplier: Number(skillReputation.skillReputationMultiplier || 1),
            frictionSignals: {
                noShowRisk: Number(workerSignals.noShowRisk || 0),
                shortlistStrictnessIndex: Number(employer.shortlistStrictnessIndex || 0),
                salaryNegotiationDriftRate: Number(workerSignals.salaryNegotiationDriftRate || 0),
                shiftStabilityReliability: Number(workerSignals.shiftStabilityReliability || 0),
                behaviorTrustScore: Number(workerSignals.behaviorTrustScore || 0.5),
                behaviorSpamRisk: Number(workerSignals.behaviorSpamRisk || 0.5),
                skillReputationScore: Number(skillReputation.reputationScore || 0),
            },
            cityProfile: {
                densityBand: cityProfile.densityBand,
                activeWorkerCount: cityProfile.activeWorkerCount,
            },
            employerQualityMetrics: employer.qualityMetrics,
            employerTier: employer.employerTier || 'Standard',
            employerRankingBoostMultiplier: Number(employer.rankingBoostMultiplier || 1),
            conversionSignals: dynamicThresholdInfo.diagnostics,
            cityBalancing: balancing,
        };
    };

    return {
        city,
        dynamicThresholds,
        workerSignals,
        cityProfile,
        conversionSignals: dynamicThresholdInfo.diagnostics,
        cityBalancing: balancing,
        getScoringContextForJob,
    };
};

module.exports = {
    buildMatchIntelligenceContext,
};
