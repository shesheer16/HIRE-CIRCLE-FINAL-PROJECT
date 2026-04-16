const { getFeatureFlag } = require('./featureFlagService');

const normalizeKey = (value) => String(value || '').trim().toUpperCase();
const normalizeCountry = (value) => String(value || '').trim().toUpperCase() || null;
const normalizeRegion = (value) => String(value || '').trim().toUpperCase() || null;

const isRegionFeatureEnabled = async ({
    key,
    user = null,
    country = null,
    region = null,
    fallback = false,
}) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return Boolean(fallback);

    const resolvedCountry = normalizeCountry(country || user?.country);
    const resolvedRegion = normalizeRegion(region || user?.state || user?.region);

    return getFeatureFlag(normalizedKey, fallback, {
        country: resolvedCountry,
        region: resolvedRegion,
    });
};

module.exports = {
    isRegionFeatureEnabled,
};
