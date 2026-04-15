const MatchModel = require('../models/MatchModel');
const { buildFeatureVector, FEATURE_ORDER } = require('./probabilisticFeatures');

const MODEL_CACHE = new Map();
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const PROBABILITY_TIERS = {
    STRONG: 0.85,
    GOOD: 0.70,
    POSSIBLE: 0.60,
};

const mapProbabilityTier = (probability) => {
    if (probability >= PROBABILITY_TIERS.STRONG) return 'STRONG';
    if (probability >= PROBABILITY_TIERS.GOOD) return 'GOOD';
    if (probability >= PROBABILITY_TIERS.POSSIBLE) return 'POSSIBLE';
    return 'REJECT';
};

const toLegacyTierLabel = (tier) => {
    if (tier === 'STRONG') return 'Strong Match';
    if (tier === 'GOOD') return 'Good Match';
    if (tier === 'POSSIBLE') return 'Possible Match';
    return 'Rejected';
};

const logisticProbability = ({ weights = [], intercept = 0, values = [] }) => {
    let z = Number(intercept || 0);
    for (let index = 0; index < Math.min(weights.length, values.length); index += 1) {
        z += Number(weights[index] || 0) * Number(values[index] || 0);
    }

    if (z > 35) return 1;
    if (z < -35) return 0;
    return 1 / (1 + Math.exp(-z));
};

const buildContributionMap = ({ featureOrder = [], weights = [], values = [] }) => {
    const contributionMap = {};
    for (let index = 0; index < featureOrder.length; index += 1) {
        const featureName = featureOrder[index];
        contributionMap[featureName] = Number(weights[index] || 0) * Number(values[index] || 0);
    }
    return contributionMap;
};

const buildExplainability = ({ contributionMap = {}, probability = 0, modelKeyUsed = null }) => {
    const skillImpact = Number(contributionMap.skillScore || 0);
    const experienceImpact = Number(contributionMap.experienceScore || 0);
    const salaryImpact = Number(contributionMap.salaryFitScore || 0);
    const distanceImpact = Number(contributionMap.distanceScore || 0);
    const reliabilityImpact = Number(contributionMap.workerReliabilityScore || 0);
    const key = String(modelKeyUsed || '').trim();
    const historicalPatternSimilarity = key === '*::*'
        ? 0.6
        : key.endsWith('::*')
            ? 0.75
            : key
                ? 0.9
                : 0.6;

    return {
        matchProbability: clamp01(probability),
        skillImpact,
        experienceImpact,
        salaryImpact,
        distanceImpact,
        reliabilityImpact,
        profileImpact: Number(contributionMap.profileCompleteness || 0),
        interviewImpact: Number(contributionMap.interviewCompletion || 0),
        cityRoleImpact: Number(contributionMap.cityRoleClusterHash || 0),
        timeImpact: Number(contributionMap.timestampEpochNormalized || 0),
        historicalPatternSimilarity,
    };
};

const getCacheKey = (modelVersion, modelKey) => `${modelVersion}:${modelKey}`;

const getModelFromCache = (modelVersion, modelKey) => {
    const key = getCacheKey(modelVersion, modelKey);
    const cached = MODEL_CACHE.get(key);
    if (!cached) return null;

    if ((Date.now() - cached.cachedAt) > MODEL_CACHE_TTL_MS) {
        MODEL_CACHE.delete(key);
        return null;
    }

    return cached.model;
};

const setModelCache = (modelVersion, modelKey, model) => {
    const key = getCacheKey(modelVersion, modelKey);
    MODEL_CACHE.set(key, { model, cachedAt: Date.now() });
};

const parseModelKey = (modelKey = '*::*') => {
    const [city = '*', roleCluster = '*'] = String(modelKey || '*::*').split('::');
    return { city, roleCluster };
};

const getActiveModelVersion = async () => {
    const configuredVersion = String(process.env.MATCH_MODEL_VERSION_ACTIVE || '').trim();
    if (configuredVersion) return configuredVersion;

    const activeModel = await MatchModel.findOne({ isActive: true })
        .sort({ trainedAt: -1 })
        .select('modelVersion')
        .lean();

    return activeModel?.modelVersion || null;
};

const resolveCandidateModelKeys = ({ city, roleCluster }) => {
    const normalizedCity = normalizeText(city || '*') || '*';
    const normalizedRole = normalizeText(roleCluster || 'general') || 'general';
    return [
        `${normalizedCity}::${normalizedRole}`,
        `${normalizedCity}::*`,
        '*::*',
    ];
};

const loadModel = async ({ modelVersion, city, roleCluster }) => {
    const candidateModelKeys = resolveCandidateModelKeys({ city, roleCluster });

    for (const modelKey of candidateModelKeys) {
        const cachedModel = getModelFromCache(modelVersion, modelKey);
        if (cachedModel) {
            return {
                model: cachedModel,
                modelKeyUsed: modelKey,
            };
        }

        const model = await MatchModel.findOne({ modelVersion, modelKey }).lean();
        if (model) {
            setModelCache(modelVersion, modelKey, model);
            return {
                model,
                modelKeyUsed: modelKey,
            };
        }
    }

    return {
        model: null,
        modelKeyUsed: null,
    };
};

const alignFeatureValues = ({ modelFeatureOrder = FEATURE_ORDER, featureMap = {} }) => {
    return modelFeatureOrder.map((featureName) => clamp01(featureMap[featureName]));
};

const scoreSinglePair = async ({
    worker,
    workerUser,
    job,
    roleData,
    deterministicScores,
    modelVersionOverride = null,
    timestamp = Date.now(),
    windowStart,
    windowEnd,
    workerReliabilityScore = 0.5,
}) => {
    const modelVersion = modelVersionOverride || await getActiveModelVersion();
    if (!modelVersion) {
        return {
            fallbackUsed: true,
            reason: 'NO_ACTIVE_MODEL_VERSION',
            matchProbability: null,
            modelVersionUsed: null,
            modelKeyUsed: null,
            explainability: null,
        };
    }

    const { model, modelKeyUsed } = await loadModel({
        modelVersion,
        city: job?.location,
        roleCluster: roleData?.roleName || job?.title,
    });

    if (!model) {
        return {
            fallbackUsed: true,
            reason: 'NO_MODEL_FOR_CLUSTER',
            matchProbability: null,
            modelVersionUsed: modelVersion,
            modelKeyUsed: null,
            explainability: null,
        };
    }

    const vector = buildFeatureVector({
        worker,
        workerUser,
        job,
        roleData,
        deterministicScores,
        workerReliabilityScore,
        timestamp,
        windowStart,
        windowEnd,
    });

    const modelFeatureOrder = Array.isArray(model.featureOrder) && model.featureOrder.length
        ? model.featureOrder
        : FEATURE_ORDER;

    const alignedValues = alignFeatureValues({
        modelFeatureOrder,
        featureMap: vector.featureMap,
    });

    const probability = logisticProbability({
        weights: model.weights || [],
        intercept: model.intercept || 0,
        values: alignedValues,
    });

    const tier = mapProbabilityTier(probability);
    const contributionMap = buildContributionMap({
        featureOrder: modelFeatureOrder,
        weights: model.weights || [],
        values: alignedValues,
    });

    return {
        fallbackUsed: false,
        reason: null,
        matchProbability: clamp01(probability),
        tier,
        tierLabel: toLegacyTierLabel(tier),
        modelVersionUsed: modelVersion,
        modelKeyUsed,
        explainability: buildExplainability({ contributionMap, probability, modelKeyUsed }),
        featureVector: vector,
    };
};

const scoreDeterministicMatches = async ({
    matches = [],
    worker,
    workerUser,
    modelVersionOverride = null,
}) => {
    if (!Array.isArray(matches) || matches.length === 0) {
        return {
            matches: [],
            fallbackUsedAny: false,
            matchModelVersionUsed: null,
        };
    }

    const scored = [];
    let fallbackUsedAny = false;
    let usedVersion = null;

    for (const row of matches) {
        const probabilistic = await scoreSinglePair({
            worker,
            workerUser,
            job: row.job,
            roleData: row.roleData,
            deterministicScores: row.deterministicScores,
            modelVersionOverride,
        });

        if (probabilistic.fallbackUsed) {
            fallbackUsedAny = true;
            scored.push({
                ...row,
                matchProbability: row.finalScore,
                tier: row.tier,
                tierLabel: row.tierLabel,
                matchModelVersionUsed: probabilistic.modelVersionUsed,
                modelKeyUsed: probabilistic.modelKeyUsed,
                probabilisticFallbackUsed: true,
                explainability: {
                    ...(row.explainability || {}),
                    matchProbability: row.finalScore,
                },
            });
            continue;
        }

        usedVersion = probabilistic.modelVersionUsed;

        if (probabilistic.tier === 'REJECT') {
            continue;
        }

        scored.push({
            ...row,
            matchProbability: probabilistic.matchProbability,
            finalScore: probabilistic.matchProbability,
            matchScore: Math.round(probabilistic.matchProbability * 100),
            tier: probabilistic.tier,
            tierLabel: probabilistic.tierLabel,
            matchModelVersionUsed: probabilistic.modelVersionUsed,
            modelKeyUsed: probabilistic.modelKeyUsed,
            probabilisticFallbackUsed: false,
            explainability: {
                ...(row.explainability || {}),
                ...(probabilistic.explainability || {}),
            },
        });
    }

    scored.sort((left, right) => {
        const leftScore = Number(left.matchProbability ?? left.finalScore ?? 0);
        const rightScore = Number(right.matchProbability ?? right.finalScore ?? 0);
        return rightScore - leftScore;
    });

    return {
        matches: scored,
        fallbackUsedAny,
        matchModelVersionUsed: usedVersion,
    };
};

module.exports = {
    PROBABILITY_TIERS,
    mapProbabilityTier,
    toLegacyTierLabel,
    logisticProbability,
    parseModelKey,
    getActiveModelVersion,
    scoreSinglePair,
    scoreDeterministicMatches,
};
