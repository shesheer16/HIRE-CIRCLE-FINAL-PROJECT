const {
    DEFAULT_ADAPTIVE_WEIGHTS,
    WEIGHT_BOUNDS,
    validateAdaptiveWeights,
} = require('./adaptiveMatchWeightEngine');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const normalize = (weights) => {
    const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
    if (!Number.isFinite(total) || total <= 0) return { ...DEFAULT_ADAPTIVE_WEIGHTS };
    const normalized = {
        skillWeight: Number(weights.skillWeight || 0) / total,
        experienceWeight: Number(weights.experienceWeight || 0) / total,
        salaryToleranceWeight: Number(weights.salaryToleranceWeight || 0) / total,
        commuteToleranceWeight: Number(weights.commuteToleranceWeight || 0) / total,
    };
    return normalized;
};

const boundedNormalize = (weights) => {
    const normalized = normalize(weights);
    return {
        skillWeight: clamp(normalized.skillWeight, WEIGHT_BOUNDS.skillWeight.min, WEIGHT_BOUNDS.skillWeight.max),
        experienceWeight: clamp(normalized.experienceWeight, WEIGHT_BOUNDS.experienceWeight.min, WEIGHT_BOUNDS.experienceWeight.max),
        salaryToleranceWeight: clamp(normalized.salaryToleranceWeight, WEIGHT_BOUNDS.salaryToleranceWeight.min, WEIGHT_BOUNDS.salaryToleranceWeight.max),
        commuteToleranceWeight: clamp(normalized.commuteToleranceWeight, WEIGHT_BOUNDS.commuteToleranceWeight.min, WEIGHT_BOUNDS.commuteToleranceWeight.max),
    };
};

const toOutcomeMix = () => {
    const outcomes = [];

    for (let i = 0; i < 500; i += 1) {
        outcomes.push({ hired: true, rejected: false, feedback: 0.65 + ((i % 8) * 0.04), responseHours: 4 + (i % 16) });
    }
    for (let i = 0; i < 300; i += 1) {
        outcomes.push({ hired: false, rejected: true, feedback: 0.2 + ((i % 5) * 0.05), responseHours: 36 + (i % 72) });
    }
    for (let i = 0; i < 200; i += 1) {
        outcomes.push({ hired: false, rejected: false, feedback: 0.45 + ((i % 6) * 0.03), responseHours: 12 + (i % 48) });
    }

    return outcomes;
};

const applySyntheticUpdate = (weights, outcome) => {
    const qualitySignal = clamp(
        ((outcome.hired ? 1 : 0) * 0.6)
        - ((outcome.rejected ? 1 : 0) * 0.5)
        + ((clamp01(outcome.feedback) - 0.5) * 0.4),
        -1,
        1
    );

    const responseScore = clamp01(1 - ((Number(outcome.responseHours || 0)) / 96));

    const next = {
        skillWeight: Number(weights.skillWeight || 0) + (qualitySignal * 0.008),
        experienceWeight: Number(weights.experienceWeight || 0) + (qualitySignal * 0.006),
        salaryToleranceWeight: Number(weights.salaryToleranceWeight || 0) + ((responseScore - 0.5) * 0.004),
        commuteToleranceWeight: Number(weights.commuteToleranceWeight || 0) + ((responseScore - 0.5) * 0.005),
    };

    return boundedNormalize(next);
};

const runOptimizationStressValidation = () => {
    const outcomes = toOutcomeMix();
    let weights = { ...DEFAULT_ADAPTIVE_WEIGHTS };

    let unstableWeightExplosion = false;
    let hasNaN = false;
    let hasNegativeScore = false;
    let infiniteLoopRisk = false;

    let maxIterationsGuard = 0;

    for (const outcome of outcomes) {
        maxIterationsGuard += 1;
        if (maxIterationsGuard > 5000) {
            infiniteLoopRisk = true;
            break;
        }

        weights = applySyntheticUpdate(weights, outcome);

        const values = Object.values(weights).map((value) => Number(value));
        if (values.some((value) => Number.isNaN(value) || !Number.isFinite(value))) {
            hasNaN = true;
            break;
        }

        if (values.some((value) => value < 0)) {
            hasNegativeScore = true;
            break;
        }

        const stable = validateAdaptiveWeights(weights);
        if (!stable.isStable || !stable.bounded) {
            unstableWeightExplosion = true;
            break;
        }
    }

    return {
        simulated: {
            matches: 1000,
            hires: 500,
            rejections: 300,
            mixedFeedback: true,
        },
        checks: {
            noUnstableWeightExplosion: !unstableWeightExplosion,
            noNaN: !hasNaN,
            noNegativeScore: !hasNegativeScore,
            noInfiniteRankingLoop: !infiniteLoopRisk,
        },
        finalWeights: Object.fromEntries(
            Object.entries(weights).map(([key, value]) => [key, Number(Number(value).toFixed(6))])
        ),
    };
};

module.exports = {
    runOptimizationStressValidation,
};
