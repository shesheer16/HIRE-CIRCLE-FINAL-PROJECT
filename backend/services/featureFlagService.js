const FeatureFlag = require('../models/FeatureFlag');

const inMemoryFlags = new Map();

const normalizeKey = (key) => String(key || '').trim().toUpperCase();
const normalizeCountry = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || null;
};
const normalizeRegion = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || null;
};
const getCacheKey = (key, country = null, region = null) => (
    `${String(key)}::${String(country || '*')}::${String(region || '*')}`
);

const getFeatureFlag = async (key, fallback = false, context = {}) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return Boolean(fallback);

    const country = normalizeCountry(context.country);
    const region = normalizeRegion(context.region);
    const cacheKey = getCacheKey(normalizedKey, country, region);
    const cached = inMemoryFlags.get(cacheKey);
    if (cached && (Date.now() - cached.loadedAt) < 60 * 1000) {
        return cached.enabled;
    }

    const candidateQueries = [];
    if (country && region) {
        candidateQueries.push({ key: normalizedKey, country, region });
    }
    if (country) {
        candidateQueries.push({ key: normalizedKey, country, region: null });
    }
    candidateQueries.push({ key: normalizedKey, country: null, region: null });

    let row = null;
    for (const query of candidateQueries) {
        row = await FeatureFlag.findOne(query).lean();
        if (row) break;
    }

    const enabled = typeof row?.enabled === 'boolean' ? row.enabled : Boolean(fallback);
    inMemoryFlags.set(cacheKey, { enabled, loadedAt: Date.now() });
    return enabled;
};

const setFeatureFlag = async ({
    key,
    enabled,
    country = null,
    region = null,
    description = '',
    updatedByAdmin = null,
    metadata = {},
}) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
        throw new Error('Feature flag key is required');
    }

    const normalizedCountry = normalizeCountry(country);
    const normalizedRegion = normalizeRegion(region);

    const row = await FeatureFlag.findOneAndUpdate(
        {
            key: normalizedKey,
            country: normalizedCountry,
            region: normalizedRegion,
        },
        {
            $set: {
                enabled: Boolean(enabled),
                country: normalizedCountry,
                region: normalizedRegion,
                description: String(description || '').trim(),
                updatedByAdmin: updatedByAdmin || null,
                metadata,
            },
        },
        { upsert: true, new: true }
    );

    inMemoryFlags.set(
        getCacheKey(normalizedKey, normalizedCountry, normalizedRegion),
        { enabled: Boolean(row.enabled), loadedAt: Date.now() }
    );
    return row;
};

const listFeatureFlags = async (filters = {}) => {
    const query = {};
    const country = normalizeCountry(filters.country);
    const region = normalizeRegion(filters.region);
    if (country) query.country = country;
    if (region) query.region = region;
    return FeatureFlag.find(query).sort({ key: 1 }).lean();
};

module.exports = {
    getFeatureFlag,
    setFeatureFlag,
    listFeatureFlags,
};
