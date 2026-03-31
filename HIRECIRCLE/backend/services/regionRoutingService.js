const { resolveRegionConfig } = require('../config/region');

const normalizeRegion = (value, fallback = null) => {
    const normalized = String(value || '').trim();
    if (normalized) return normalized;
    return fallback;
};

const parseFallbacks = () => {
    const fromCsv = String(process.env.REGION_FAILOVER_CHAIN || process.env.SECONDARY_REGION || '')
        .split(',')
        .map((value) => normalizeRegion(value))
        .filter(Boolean);

    const fromJson = (() => {
        const raw = String(process.env.REGION_FAILOVER_MAP_JSON || '').trim();
        if (!raw) return {};
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
            return {};
        }
    })();

    return {
        chain: Array.from(new Set(fromCsv)),
        map: fromJson,
    };
};

const resolveFailoverRegions = ({ primaryRegion } = {}) => {
    const { chain, map } = parseFallbacks();
    const directMap = map[String(primaryRegion || '')] || map[String(primaryRegion || '').toLowerCase()] || [];
    const mapped = Array.isArray(directMap)
        ? directMap.map((value) => normalizeRegion(value)).filter(Boolean)
        : [];

    return Array.from(new Set([
        ...mapped,
        ...chain.filter((region) => region !== primaryRegion),
    ])).slice(0, 5);
};

const resolveRoutingContext = ({ user = null, requestedRegion = null } = {}) => {
    const regionConfig = resolveRegionConfig();
    const primaryRegion = normalizeRegion(
        requestedRegion
        || user?.primaryRegion
        || user?.regionCode
        || process.env.APP_REGION,
        regionConfig.region
    );
    const failoverRegions = resolveFailoverRegions({ primaryRegion });
    const readReplicaEnabled = Boolean(regionConfig.dbReadReplicaUri || String(process.env.MONGO_READ_URI || '').trim());

    return {
        primaryRegion,
        failoverRegions,
        readReplicaEnabled,
        regionConfig,
    };
};

const chooseRegionWithFallback = ({ preferredRegion = null, allowedRegions = [] } = {}) => {
    const normalizedPreferred = normalizeRegion(preferredRegion);
    const normalizedAllowed = Array.from(new Set((Array.isArray(allowedRegions) ? allowedRegions : [])
        .map((value) => normalizeRegion(value))
        .filter(Boolean)));

    if (normalizedPreferred && normalizedAllowed.includes(normalizedPreferred)) {
        return {
            region: normalizedPreferred,
            usedFallback: false,
        };
    }

    return {
        region: normalizedAllowed[0] || normalizedPreferred || normalizeRegion(process.env.APP_REGION, 'ap-south-1'),
        usedFallback: true,
    };
};

module.exports = {
    normalizeRegion,
    resolveRoutingContext,
    resolveFailoverRegions,
    chooseRegionWithFallback,
};
