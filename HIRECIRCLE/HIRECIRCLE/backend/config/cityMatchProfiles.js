const CITY_DENSITY_RULES = {
    HIGH_DENSITY_ACTIVE_WORKERS: 3000,
    LOW_DENSITY_ACTIVE_WORKERS: 800,
};

const BASE_CITY_MATCH_PROFILE = {
    densityBand: 'medium',
    skillWeightDelta: 0,
    distanceWeightExponent: 1,
    distanceToleranceEnabled: false,
    distanceFallbackScore: 0,
    possibleThresholdDelta: 0,
};

const HIGH_DENSITY_PROFILE = {
    densityBand: 'high',
    skillWeightDelta: 0.03,
    distanceWeightExponent: 0.9,
    distanceToleranceEnabled: false,
    distanceFallbackScore: 0,
    possibleThresholdDelta: 0,
};

const LOW_DENSITY_PROFILE = {
    densityBand: 'low',
    skillWeightDelta: -0.02,
    distanceWeightExponent: 1.1,
    distanceToleranceEnabled: true,
    distanceFallbackScore: 0.72,
    possibleThresholdDelta: -0.02,
};

module.exports = {
    CITY_DENSITY_RULES,
    BASE_CITY_MATCH_PROFILE,
    HIGH_DENSITY_PROFILE,
    LOW_DENSITY_PROFILE,
};
