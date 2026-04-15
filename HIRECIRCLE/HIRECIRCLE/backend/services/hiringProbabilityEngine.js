const Job = require('../models/Job');
const MatchOutcomeModel = require('../models/MatchOutcomeModel');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);
const normalizeText = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SIMILAR_OUTCOME_CACHE_TTL_MS = 10 * 60 * 1000;
const similarOutcomeCache = new Map();

const readSimilarOutcomeCache = (jobId) => {
    if (!jobId) return null;

    const key = String(jobId);
    const cached = similarOutcomeCache.get(key);
    if (!cached) return null;

    if ((Date.now() - cached.cachedAt) > SIMILAR_OUTCOME_CACHE_TTL_MS) {
        similarOutcomeCache.delete(key);
        return null;
    }

    return cached.value;
};

const writeSimilarOutcomeCache = (jobId, value) => {
    if (!jobId) return value;

    similarOutcomeCache.set(String(jobId), {
        cachedAt: Date.now(),
        value,
    });
    return value;
};

const resolveUrgencyScore = (jobUrgency = null) => {
    if (typeof jobUrgency === 'string') {
        const normalized = normalizeText(jobUrgency, 'normal');
        if (['critical', 'urgent', 'high'].includes(normalized)) return 1;
        if (['medium', 'normal'].includes(normalized)) return 0.65;
        if (['low', 'not_urgent'].includes(normalized)) return 0.35;
    }

    const numeric = Number(jobUrgency);
    if (Number.isFinite(numeric)) return clamp01(numeric);
    return 0.65;
};

const getSimilarJobOutcomeSignals = async ({
    jobId = null,
    pastSimilarJobOutcomes = null,
}) => {
    if (pastSimilarJobOutcomes && typeof pastSimilarJobOutcomes === 'object') {
        const sampleSize = Number(pastSimilarJobOutcomes.sampleSize || 0);
        const hireRate = clamp01(pastSimilarJobOutcomes.hireRate || 0);

        return {
            hireRate,
            sampleSize,
            source: 'provided',
        };
    }

    if (!jobId) {
        return {
            hireRate: 0.5,
            sampleSize: 0,
            source: 'fallback',
        };
    }

    const cached = readSimilarOutcomeCache(jobId);
    if (cached) return cached;

    const job = await Job.findById(jobId)
        .select('location title')
        .lean();

    if (!job) {
        return {
            hireRate: 0.5,
            sampleSize: 0,
            source: 'job_missing',
        };
    }

    const cityRegex = new RegExp(`^${escapeRegex(normalizeText(job.location, 'unknown'))}$`, 'i');
    const roleRegex = new RegExp(escapeRegex(normalizeText(job.title, 'general')), 'i');

    const similarJobs = await Job.find({
        location: cityRegex,
        title: roleRegex,
    })
        .select('_id')
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();

    const similarJobIds = similarJobs.map((row) => row._id);
    if (!similarJobIds.length) {
        return writeSimilarOutcomeCache(jobId, {
            hireRate: 0.5,
            sampleSize: 0,
            source: 'no_similar_jobs',
        });
    }

    const aggregate = await MatchOutcomeModel.aggregate([
        {
            $match: {
                jobId: { $in: similarJobIds },
            },
        },
        {
            $group: {
                _id: null,
                hiredCount: {
                    $sum: {
                        $cond: [{ $eq: ['$hired', true] }, 1, 0],
                    },
                },
                totalCount: { $sum: 1 },
            },
        },
    ]);

    const hiredCount = Number(aggregate[0]?.hiredCount || 0);
    const totalCount = Number(aggregate[0]?.totalCount || 0);

    return writeSimilarOutcomeCache(jobId, {
        hireRate: totalCount > 0 ? clamp01(hiredCount / totalCount) : 0.5,
        sampleSize: totalCount,
        source: 'historical_similar_jobs',
    });
};

const predictHiringProbability = async ({
    matchScore = 0,
    employerBehaviorScore = 0.5,
    workerReliabilityScore = 0.5,
    jobUrgency = 0.65,
    pastSimilarJobOutcomes = null,
    jobId = null,
}) => {
    const normalizedMatch = clamp01(matchScore);
    const normalizedEmployer = clamp01(employerBehaviorScore);
    const normalizedWorker = clamp01(workerReliabilityScore);
    const normalizedUrgency = resolveUrgencyScore(jobUrgency);

    const similar = await getSimilarJobOutcomeSignals({
        jobId,
        pastSimilarJobOutcomes,
    });

    const historicalConfidence = clamp(safeDiv(similar.sampleSize, 60), 0, 1);
    const historicalWeight = 0.1 + (historicalConfidence * 0.1);

    const weighted = {
        matchScore: normalizedMatch * 0.38,
        employerBehaviorScore: normalizedEmployer * 0.2,
        workerReliabilityScore: normalizedWorker * 0.2,
        jobUrgency: normalizedUrgency * 0.12,
        similarOutcomes: similar.hireRate * historicalWeight,
    };

    const totalWeight = 0.38 + 0.2 + 0.2 + 0.12 + historicalWeight;
    const raw = safeDiv(
        Object.values(weighted).reduce((sum, value) => sum + value, 0),
        totalWeight
    );

    const predictedHireProbability = clamp01(raw);

    return {
        predictedHireProbability: Number(predictedHireProbability.toFixed(4)),
        explainability: {
            inputSignals: {
                matchScore: Number(normalizedMatch.toFixed(4)),
                employerBehaviorScore: Number(normalizedEmployer.toFixed(4)),
                workerReliabilityScore: Number(normalizedWorker.toFixed(4)),
                jobUrgency: Number(normalizedUrgency.toFixed(4)),
                pastSimilarJobOutcomes: {
                    hireRate: Number(similar.hireRate.toFixed(4)),
                    sampleSize: Number(similar.sampleSize || 0),
                    source: similar.source,
                },
            },
            weightedContributions: {
                matchScore: Number(weighted.matchScore.toFixed(4)),
                employerBehaviorScore: Number(weighted.employerBehaviorScore.toFixed(4)),
                workerReliabilityScore: Number(weighted.workerReliabilityScore.toFixed(4)),
                jobUrgency: Number(weighted.jobUrgency.toFixed(4)),
                pastSimilarOutcomes: Number(weighted.similarOutcomes.toFixed(4)),
            },
            model: {
                type: 'bounded_weighted_blend_v1',
                historicalWeight: Number(historicalWeight.toFixed(4)),
                historicalConfidence: Number(historicalConfidence.toFixed(4)),
                bounded: true,
            },
        },
    };
};

module.exports = {
    predictHiringProbability,
    resolveUrgencyScore,
    getSimilarJobOutcomeSignals,
    __clearSimilarOutcomeCache: () => similarOutcomeCache.clear(),
};
