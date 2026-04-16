const matchEngineV2 = require('./matchEngineV2');
const { scoreSinglePair } = require('./matchProbabilistic');
const { isProbabilisticMatchEnabled } = require('../config/featureFlags');

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const deriveDataCompleteness = (deterministicScore = {}) => {
    const explainability = deterministicScore.explainability || {};
    const profile = Number(explainability.profileMultiplier ?? deterministicScore.profileCompleteness ?? 0);
    const distance = Number(explainability.distanceScore ?? deterministicScore.distanceScore ?? 0);
    return clamp01((profile * 0.7) + (distance * 0.3));
};

const deriveHistoricalPatternSimilarity = (modelKeyUsed, probabilisticExplainability = {}) => {
    if (Number.isFinite(Number(probabilisticExplainability?.historicalPatternSimilarity))) {
        return clamp01(probabilisticExplainability.historicalPatternSimilarity);
    }

    const key = String(modelKeyUsed || '').trim();
    if (!key || key === '*::*') return 0.6;
    if (key.endsWith('::*')) return 0.75;
    return 0.9;
};

const mergeConfidence = ({
    deterministicScore,
    deterministicProbability,
    probabilisticProbability = null,
    modelKeyUsed = null,
    probabilisticExplainability = {},
}) => {
    const dataCompleteness = deriveDataCompleteness(deterministicScore);
    const modelAgreement = Number.isFinite(probabilisticProbability)
        ? clamp01(1 - Math.abs(clamp01(deterministicProbability) - clamp01(probabilisticProbability)))
        : 1;
    const historicalPatternSimilarity = deriveHistoricalPatternSimilarity(modelKeyUsed, probabilisticExplainability);

    const confidenceScore = clamp01(
        (dataCompleteness * 0.4)
        + (modelAgreement * 0.35)
        + (historicalPatternSimilarity * 0.25)
    );

    return {
        confidenceScore,
        confidenceComponents: {
            dataCompleteness,
            modelAgreement,
            historicalPatternSimilarity,
        },
    };
};

const applyOverlay = async ({
    deterministicScore,
    worker,
    job,
    model = {},
}) => {
    if (!deterministicScore || !job) return null;

    const workerUser = model.workerUser || worker?.user || null;
    const allowRejectOutput = Boolean(model.allowRejectOutput);
    const deterministicProbability = Number(deterministicScore.matchProbability ?? deterministicScore.finalScore ?? 0);

    if (!isProbabilisticMatchEnabled(model.user || workerUser || null)) {
        if (deterministicScore.tier === 'REJECT' && !allowRejectOutput) {
            return null;
        }

        return {
            ...deterministicScore,
            finalScore: deterministicProbability,
            matchScore: Math.round(deterministicProbability * 100),
            matchProbability: deterministicProbability,
            tierLabel: deterministicScore.tierLabel || matchEngineV2.toLegacyTierLabel(deterministicScore.tier),
            matchModelVersionUsed: null,
            modelKeyUsed: null,
            probabilisticFallbackUsed: true,
            explainability: {
                ...(deterministicScore.explainability || {}),
                matchProbability: deterministicProbability,
                ...mergeConfidence({
                    deterministicScore,
                    deterministicProbability,
                    probabilisticProbability: null,
                    modelKeyUsed: null,
                }),
            },
        };
    }

    const probabilistic = await scoreSinglePair({
        worker,
        workerUser,
        job,
        roleData: model.roleData || deterministicScore.roleData,
        deterministicScores: model.deterministicScores || deterministicScore.deterministicScores,
        modelVersionOverride: model.modelVersionOverride || null,
    });

    if (probabilistic.fallbackUsed) {
        return {
            ...deterministicScore,
            finalScore: deterministicProbability,
            matchScore: Math.round(deterministicProbability * 100),
            matchProbability: deterministicProbability,
            tier: deterministicScore.tier,
            tierLabel: deterministicScore.tierLabel || matchEngineV2.toLegacyTierLabel(deterministicScore.tier),
            matchModelVersionUsed: probabilistic.modelVersionUsed || null,
            modelKeyUsed: probabilistic.modelKeyUsed || null,
            probabilisticFallbackUsed: true,
            explainability: {
                ...(deterministicScore.explainability || {}),
                matchProbability: deterministicProbability,
                ...mergeConfidence({
                    deterministicScore,
                    deterministicProbability,
                    probabilisticProbability: null,
                    modelKeyUsed: probabilistic.modelKeyUsed || null,
                    probabilisticExplainability: probabilistic.explainability || {},
                }),
            },
        };
    }

    if (probabilistic.tier === 'REJECT' && !allowRejectOutput) {
        // Do not drop a deterministic accepted row purely due probabilistic reject.
        // Fall back to deterministic score so feeds stay populated and deterministic ranking remains stable.
        return {
            ...deterministicScore,
            finalScore: deterministicProbability,
            matchScore: Math.round(deterministicProbability * 100),
            matchProbability: deterministicProbability,
            tier: deterministicScore.tier,
            tierLabel: deterministicScore.tierLabel || matchEngineV2.toLegacyTierLabel(deterministicScore.tier),
            matchModelVersionUsed: probabilistic.modelVersionUsed || null,
            modelKeyUsed: probabilistic.modelKeyUsed || null,
            probabilisticFallbackUsed: true,
            explainability: {
                ...(deterministicScore.explainability || {}),
                matchProbability: deterministicProbability,
                ...mergeConfidence({
                    deterministicScore,
                    deterministicProbability,
                    probabilisticProbability: null,
                    modelKeyUsed: probabilistic.modelKeyUsed || null,
                    probabilisticExplainability: probabilistic.explainability || {},
                }),
            },
        };
    }

    return {
        ...deterministicScore,
        finalScore: probabilistic.matchProbability,
        matchScore: Math.round(probabilistic.matchProbability * 100),
        matchProbability: probabilistic.matchProbability,
        tier: probabilistic.tier,
        tierLabel: probabilistic.tierLabel,
        matchModelVersionUsed: probabilistic.modelVersionUsed,
        modelKeyUsed: probabilistic.modelKeyUsed,
        probabilisticFallbackUsed: false,
        explainability: {
            ...(deterministicScore.explainability || {}),
            ...(probabilistic.explainability || {}),
            ...mergeConfidence({
                deterministicScore,
                deterministicProbability,
                probabilisticProbability: probabilistic.matchProbability,
                modelKeyUsed: probabilistic.modelKeyUsed,
                probabilisticExplainability: probabilistic.explainability || {},
            }),
        },
    };
};

module.exports = {
    applyOverlay,
};
