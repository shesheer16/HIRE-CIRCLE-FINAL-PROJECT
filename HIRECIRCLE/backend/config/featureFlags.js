const PROBABILISTIC_MATCH_FLAG = 'FEATURE_PROBABILISTIC_MATCH';
const MATCH_UI_V1_FLAG = 'FEATURE_MATCH_UI_V1';
const VERIFIED_PRIORITY_FLAG = 'FEATURE_VERIFIED_PRIORITY';

const parseBoolean = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const getEnvDefault = (flagName, fallback) => {
    const envName = `FF_${flagName}`;
    return parseBoolean(process.env[envName], fallback);
};

const isFeatureEnabled = (user, flagName, fallback = false) => {
    const userValue = user?.featureToggles?.[flagName];
    if (typeof userValue === 'boolean') return userValue;
    return getEnvDefault(flagName, fallback);
};

const isProbabilisticMatchEnabled = (user) => isFeatureEnabled(user, PROBABILISTIC_MATCH_FLAG, true);
const isMatchUiV1Enabled = (user) => isFeatureEnabled(user, MATCH_UI_V1_FLAG, true);
const isVerifiedPriorityEnabled = (user) => isFeatureEnabled(user, VERIFIED_PRIORITY_FLAG, false);

module.exports = {
    PROBABILISTIC_MATCH_FLAG,
    MATCH_UI_V1_FLAG,
    VERIFIED_PRIORITY_FLAG,
    isFeatureEnabled,
    isProbabilisticMatchEnabled,
    isMatchUiV1Enabled,
    isVerifiedPriorityEnabled,
};
