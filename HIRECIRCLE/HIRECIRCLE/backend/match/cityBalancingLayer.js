const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const evaluateCityBalancing = ({
    workersPerJob = 0,
    currentThresholds = { STRONG: 0.82, GOOD: 0.70, POSSIBLE: 0.62 },
    currentSkillWeightDelta = 0,
} = {}) => {
    const safeWorkersPerJob = Number.isFinite(Number(workersPerJob)) ? Number(workersPerJob) : 0;

    let thresholdDeltaPossible = 0;
    let thresholdDeltaStrong = 0;
    let skillWeightDelta = currentSkillWeightDelta;
    const alerts = [];

    if (safeWorkersPerJob < 2) {
        thresholdDeltaPossible = -0.02;
        alerts.push('WORKER_ACQUISITION_ALERT');
    }

    if (safeWorkersPerJob > 6) {
        skillWeightDelta += 0.03;
        thresholdDeltaStrong = 0.02;
        alerts.push('OVER_SUPPLY_STRICT_MODE');
    }

    const nextThresholds = {
        STRONG: clamp(Number(currentThresholds.STRONG || 0.82) + thresholdDeltaStrong, 0.75, 0.95),
        GOOD: clamp(Number(currentThresholds.GOOD || 0.70), 0.60, 0.90),
        POSSIBLE: clamp(Number(currentThresholds.POSSIBLE || 0.62) + thresholdDeltaPossible, 0.5, 0.8),
    };

    if (nextThresholds.GOOD >= nextThresholds.STRONG) {
        nextThresholds.GOOD = clamp(nextThresholds.STRONG - 0.02, 0.60, 0.9);
    }

    if (nextThresholds.POSSIBLE >= nextThresholds.GOOD) {
        nextThresholds.POSSIBLE = clamp(nextThresholds.GOOD - 0.02, 0.5, 0.85);
    }

    return {
        workersPerJob: safeWorkersPerJob,
        thresholds: {
            STRONG: Number(nextThresholds.STRONG.toFixed(2)),
            GOOD: Number(nextThresholds.GOOD.toFixed(2)),
            POSSIBLE: Number(nextThresholds.POSSIBLE.toFixed(2)),
        },
        skillWeightDelta: Number(clamp(skillWeightDelta, -0.05, 0.08).toFixed(4)),
        acquisitionAlert: alerts.includes('WORKER_ACQUISITION_ALERT'),
        oversupplyStrictMode: alerts.includes('OVER_SUPPLY_STRICT_MODE'),
        alerts,
    };
};

module.exports = {
    evaluateCityBalancing,
};
