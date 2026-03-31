const { evaluateRoleAgainstJob, computeProfileCompleteness } = require('./matchEngineV2');

const FEATURE_ORDER = [
    'skillScore',
    'experienceScore',
    'salaryFitScore',
    'distanceScore',
    'profileCompleteness',
    'interviewCompletion',
    'workerReliabilityScore',
    'cityRoleClusterHash',
    'timestampEpochNormalized',
];

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const hashToUnitInterval = (input) => {
    const source = String(input || 'unknown');
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) {
        hash = ((hash << 5) - hash) + source.charCodeAt(i);
        hash |= 0;
    }

    const unsigned = hash >>> 0;
    return clamp01(unsigned / 0xffffffff);
};

const normalizeTimestamp = ({ timestamp = Date.now(), windowStart, windowEnd }) => {
    const ts = Number(new Date(timestamp).getTime()) || Date.now();
    const start = Number(new Date(windowStart || 0).getTime()) || 0;
    const end = Number(new Date(windowEnd || Date.now()).getTime()) || Date.now();

    if (end <= start) return 1;
    return clamp01((ts - start) / (end - start));
};

const deriveCityRoleCluster = ({ job = {}, roleData = {} }) => {
    const city = normalizeText(job.location || 'unknown');
    const roleCluster = normalizeText(roleData.roleName || job.title || 'general');
    return `${city}::${roleCluster}`;
};

const buildFeatureMap = ({
    worker,
    workerUser,
    job,
    roleData,
    deterministicScores = null,
    workerReliabilityScore = 0.5,
    timestamp = Date.now(),
    windowStart,
    windowEnd,
}) => {
    const deterministic = deterministicScores
        || evaluateRoleAgainstJob({ job, worker, workerUser, roleData });

    const profileCompleteness = deterministic?.profileCompletenessMultiplier
        || computeProfileCompleteness({ worker, workerUser, roleData });

    const featureMap = {
        skillScore: clamp01(deterministic?.skillScore),
        experienceScore: clamp01(deterministic?.experienceScore),
        salaryFitScore: clamp01(deterministic?.salaryFitScore),
        distanceScore: clamp01(deterministic?.distanceScore),
        profileCompleteness: clamp01(profileCompleteness),
        interviewCompletion: clamp01(worker?.interviewVerified ? 1 : 0),
        workerReliabilityScore: clamp01(workerReliabilityScore),
        cityRoleClusterHash: hashToUnitInterval(deriveCityRoleCluster({ job, roleData })),
        timestampEpochNormalized: normalizeTimestamp({
            timestamp,
            windowStart,
            windowEnd,
        }),
    };

    return featureMap;
};

const buildFeatureVector = (context) => {
    const featureMap = buildFeatureMap(context);

    const featureValues = FEATURE_ORDER.map((featureName) => clamp01(featureMap[featureName]));

    return {
        featureOrder: FEATURE_ORDER,
        featureValues,
        featureMap,
        rawContext: {
            workerId: context?.worker?._id ? String(context.worker._id) : null,
            workerUserId: context?.workerUser?._id ? String(context.workerUser._id) : null,
            jobId: context?.job?._id ? String(context.job._id) : null,
            roleCluster: context?.roleData?.roleName || context?.job?.title || 'general',
            city: context?.job?.location || context?.worker?.city || 'unknown',
        },
        normalizationMeta: {
            clampedRange: '[0,1]',
            timestampWindow: {
                start: context?.windowStart || null,
                end: context?.windowEnd || null,
            },
            cityRoleClusterHashMethod: '32-bit stable hash scaled to [0,1]',
        },
    };
};

module.exports = {
    FEATURE_ORDER,
    clamp01,
    hashToUnitInterval,
    normalizeTimestamp,
    deriveCityRoleCluster,
    buildFeatureMap,
    buildFeatureVector,
};
