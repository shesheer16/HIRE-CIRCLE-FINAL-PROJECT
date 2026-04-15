const { resolveRoutingContext } = require('./regionRoutingService');
const { resolveRegionConfig } = require('../config/region');

const EDGE_POLICY_VERSION = String(process.env.EDGE_POLICY_VERSION || '2026.03.global-scale').trim();
const EDGE_PUBLIC_CACHE_CONTROL = String(
    process.env.EDGE_PUBLIC_CACHE_CONTROL
    || 'public, max-age=30, s-maxage=120, stale-while-revalidate=60'
).trim();
const EDGE_POLICY_ENABLED = String(process.env.EDGE_POLICY_ENABLED || 'true').toLowerCase() !== 'false';
const PUBLIC_CACHE_PREFIXES = String(process.env.EDGE_PUBLIC_CACHE_PATH_PREFIXES || '/api/v3/public/jobs,/embed/jobs')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
const NO_CACHE_PREFIXES = String(process.env.EDGE_NO_CACHE_PATH_PREFIXES || '/api/admin,/api/auth,/api/payment,/api/financial')
    .split(',')
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);

const toLowerPath = (value = '') => String(value || '').trim().toLowerCase();

const normalizeRegionList = (rows = []) => Array.from(new Set((Array.isArray(rows) ? rows : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));

const shouldApplyPublicCache = ({ method, path }) => {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
        return false;
    }

    const normalizedPath = toLowerPath(path);
    if (!normalizedPath) return false;
    if (NO_CACHE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
        return false;
    }
    return PUBLIC_CACHE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
};

const mergeVaryHeader = (res, value) => {
    const nextValue = String(value || '').trim();
    if (!nextValue || !res || typeof res.getHeader !== 'function' || typeof res.setHeader !== 'function') {
        return;
    }

    const existingRaw = res.getHeader('vary');
    const existing = String(existingRaw || '')
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    const merged = Array.from(new Set([...existing, nextValue]));
    res.setHeader('vary', merged.join(', '));
};

const buildEdgeContext = ({ user = null, requestedRegion = null } = {}) => {
    const routing = resolveRoutingContext({ user, requestedRegion });
    const regionConfig = resolveRegionConfig(routing.primaryRegion);
    const failoverRegions = normalizeRegionList(routing.failoverRegions);

    return {
        policyEnabled: EDGE_POLICY_ENABLED,
        policyVersion: EDGE_POLICY_VERSION,
        primaryRegion: routing.primaryRegion,
        failoverRegions,
        readReplicaEnabled: Boolean(routing.readReplicaEnabled),
        staticAssetsBaseUrl: String(regionConfig.staticAssetsBaseUrl || '').trim(),
        cdnEnabled: Boolean(String(regionConfig.staticAssetsBaseUrl || '').trim()),
    };
};

const applyEdgeResponsePolicy = ({ req, res, edgeContext } = {}) => {
    if (!EDGE_POLICY_ENABLED || !res || typeof res.setHeader !== 'function') {
        return;
    }

    const context = edgeContext || buildEdgeContext({
        user: req?.user || null,
        requestedRegion: req?.headers?.['x-region'] || null,
    });

    res.setHeader('x-hire-edge-policy', context.policyVersion);
    res.setHeader('x-hire-primary-region', context.primaryRegion || 'unknown');
    res.setHeader('x-hire-failover-regions', context.failoverRegions.join(',') || '');
    res.setHeader('x-hire-cdn-enabled', context.cdnEnabled ? '1' : '0');
    if (context.staticAssetsBaseUrl) {
        res.setHeader('x-hire-static-assets-base', context.staticAssetsBaseUrl);
    }

    mergeVaryHeader(res, 'Origin');
    mergeVaryHeader(res, 'Accept-Encoding');
    mergeVaryHeader(res, 'X-Region');

    const currentCacheControl = String(res.getHeader?.('cache-control') || '').trim();
    if (!currentCacheControl && shouldApplyPublicCache({
        method: req?.method,
        path: req?.originalUrl || req?.path || '',
    })) {
        res.setHeader('cache-control', EDGE_PUBLIC_CACHE_CONTROL);
    }
};

const getEdgeCdnPolicySnapshot = () => {
    const defaultContext = buildEdgeContext({
        user: null,
        requestedRegion: process.env.APP_REGION || null,
    });

    return {
        enabled: EDGE_POLICY_ENABLED,
        version: EDGE_POLICY_VERSION,
        publicCacheControl: EDGE_PUBLIC_CACHE_CONTROL,
        publicCachePrefixes: [...PUBLIC_CACHE_PREFIXES],
        noCachePrefixes: [...NO_CACHE_PREFIXES],
        defaultRegionContext: defaultContext,
    };
};

module.exports = {
    EDGE_POLICY_VERSION,
    EDGE_PUBLIC_CACHE_CONTROL,
    buildEdgeContext,
    applyEdgeResponsePolicy,
    getEdgeCdnPolicySnapshot,
    __test__: {
        shouldApplyPublicCache,
        mergeVaryHeader,
    },
};
