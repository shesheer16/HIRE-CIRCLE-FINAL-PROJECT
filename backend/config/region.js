const DEFAULT_REGION = String(process.env.APP_REGION || process.env.AWS_REGION || 'ap-south-1').trim();

const safeParseJSON = (value, fallback) => {
    try {
        if (!value) return fallback;
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_error) {
        return fallback;
    }
};

const regionMapFromEnv = safeParseJSON(process.env.APP_REGION_MAP, {});
const defaultCdnBase = String(process.env.CDN_BASE_URL || process.env.AWS_CLOUDFRONT_URL || '').trim();

const resolveRegionConfig = (region = DEFAULT_REGION) => {
    const safeRegion = String(region || DEFAULT_REGION).trim() || DEFAULT_REGION;
    const regionConfig = regionMapFromEnv[safeRegion] || {};
    const staticAssetsBaseUrl = String(regionConfig.staticAssetsBaseUrl || defaultCdnBase || '').replace(/\/$/, '');

    return {
        region: safeRegion,
        staticAssetsBaseUrl,
        dbReadReplicaUri: String(regionConfig.dbReadReplicaUri || process.env.MONGO_READ_URI || '').trim(),
        dbWriteUri: String(regionConfig.dbWriteUri || process.env.MONGO_URI || '').trim(),
        redisUrl: String(regionConfig.redisUrl || process.env.REDIS_URL || '').trim(),
    };
};

module.exports = {
    DEFAULT_REGION,
    resolveRegionConfig,
};
