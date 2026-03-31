const BASE_MATCH_THRESHOLDS = {
    STRONG: 0.82,
    GOOD: 0.70,
    POSSIBLE: 0.62,
};

const DYNAMIC_RULES = {
    GOOD_UNDERPERFORMANCE_RATIO: 0.8,
    MAX_SKILL_WEIGHT_DELTA: 0.05,
    POSSIBLE_HIRE_RATE_MIN: 0.05,
    POSSIBLE_THRESHOLD_RAISED: 0.65,
};

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeThresholds = (thresholds = {}) => {
    const strong = clamp(thresholds.STRONG ?? BASE_MATCH_THRESHOLDS.STRONG, 0.75, 0.95);
    const good = clamp(thresholds.GOOD ?? BASE_MATCH_THRESHOLDS.GOOD, 0.60, strong - 0.02);
    const possible = clamp(thresholds.POSSIBLE ?? BASE_MATCH_THRESHOLDS.POSSIBLE, 0.50, good - 0.02);

    return {
        STRONG: Number(strong.toFixed(2)),
        GOOD: Number(good.toFixed(2)),
        POSSIBLE: Number(possible.toFixed(2)),
    };
};

module.exports = {
    BASE_MATCH_THRESHOLDS,
    DYNAMIC_RULES,
    normalizeThresholds,
};
