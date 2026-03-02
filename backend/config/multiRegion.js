const DEFAULT_REGION = String(process.env.DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1').trim();

const normalizeRegion = (value, fallback = DEFAULT_REGION) => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const parseMap = (rawValue) => {
    if (!rawValue) return {};
    try {
        const parsed = JSON.parse(rawValue);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_error) {
        return {};
    }
    return {};
};

const getActiveRegion = () => normalizeRegion(process.env.APP_REGION, DEFAULT_REGION);

const getRegionalValue = ({ jsonEnvName, fallbackEnvName, region = getActiveRegion() }) => {
    const regionMap = parseMap(process.env[jsonEnvName]);
    const direct = regionMap[region] || regionMap[region.toLowerCase()] || regionMap[region.toUpperCase()];
    if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
    }

    const fallbackValue = String(process.env[fallbackEnvName] || '').trim();
    return fallbackValue || null;
};

const getRegionalMongoUri = () => getRegionalValue({
    jsonEnvName: 'MONGO_URI_BY_REGION_JSON',
    fallbackEnvName: 'MONGO_URI',
});

const getRegionalRedisUrl = () => getRegionalValue({
    jsonEnvName: 'REDIS_URL_BY_REGION_JSON',
    fallbackEnvName: 'REDIS_URL',
});

const getRegionalS3Bucket = () => getRegionalValue({
    jsonEnvName: 'AWS_BUCKET_BY_REGION_JSON',
    fallbackEnvName: 'AWS_BUCKET_NAME',
});

module.exports = {
    DEFAULT_REGION,
    getActiveRegion,
    getRegionalMongoUri,
    getRegionalRedisUrl,
    getRegionalS3Bucket,
};
