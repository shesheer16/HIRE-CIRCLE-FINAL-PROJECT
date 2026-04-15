const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

const DEFAULT_SCOPE = 'read-only';
const DEFAULT_RATE_LIMIT_TIER = 'basic';
const BASE_RATE_LIMITS_PER_HOUR = {
    basic: 100,
    pro: 1000,
    enterprise: Number.parseInt(process.env.EXTERNAL_ENTERPRISE_DEFAULT_RATE_LIMIT_PER_HOUR || '5000', 10),
};

const LEGACY_RATE_LIMIT_TO_TIER = {
    free: 'basic',
    partner: 'pro',
    enterprise: 'enterprise',
};

const TIER_TO_LEGACY_PLAN = {
    basic: 'free',
    pro: 'partner',
    enterprise: 'enterprise',
};

const API_KEY_TRANSPORT = Object.freeze({
    none: 'none',
    header: 'header',
    query: 'query',
    body: 'body',
});

const isProductionRuntime = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const allowLegacyApiKeyTransports = () => {
    const configured = String(process.env.ALLOW_LEGACY_API_KEY_TRANSPORTS || '').trim().toLowerCase();
    if (configured) {
        return configured === 'true';
    }
    return !isProductionRuntime();
};

const isLikelyHashed = (value = '') => /^[a-f0-9]{64}$/i.test(String(value || '').trim());

const normalizeScope = (scope = DEFAULT_SCOPE) => {
    const normalized = String(scope || '').trim().toLowerCase();
    if ((ApiKey.API_SCOPES || []).includes(normalized)) {
        return normalized;
    }
    return DEFAULT_SCOPE;
};

const normalizeRateLimitTier = (rateLimitTier = DEFAULT_RATE_LIMIT_TIER) => {
    const normalized = String(rateLimitTier || '').trim().toLowerCase();
    if ((ApiKey.RATE_LIMIT_TIERS || []).includes(normalized)) {
        return normalized;
    }
    return DEFAULT_RATE_LIMIT_TIER;
};

const mapLegacyPlanToTier = (planType = 'free') => {
    const normalized = String(planType || 'free').trim().toLowerCase();
    return LEGACY_RATE_LIMIT_TO_TIER[normalized] || DEFAULT_RATE_LIMIT_TIER;
};

const toRateLimitPerHour = (apiKeyDoc = {}) => {
    const tier = normalizeRateLimitTier(apiKeyDoc.rateLimitTier || mapLegacyPlanToTier(apiKeyDoc.planType || apiKeyDoc.tier));
    const custom = Number.parseInt(apiKeyDoc.rateLimit, 10);
    if (tier === 'enterprise' && Number.isFinite(custom) && custom > 0) {
        return custom;
    }
    return BASE_RATE_LIMITS_PER_HOUR[tier] || BASE_RATE_LIMITS_PER_HOUR.basic;
};

const maskApiKey = (rawKey = '') => {
    const value = String(rawKey || '');
    if (value.length <= 8) return '***';
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const getKeyPrefix = (rawKey = '') => String(rawKey || '').slice(0, 12);

const hashApiKey = (rawKey = '') => {
    const hashFn = typeof ApiKey.hashApiKeyValue === 'function'
        ? ApiKey.hashApiKeyValue
        : ((value) => crypto.createHash('sha256').update(String(value || '')).digest('hex'));
    return hashFn(String(rawKey || '').trim());
};

const generateRawApiKey = () => {
    const envLabel = String(process.env.NODE_ENV || 'dev').toLowerCase() === 'production' ? 'live' : 'test';
    const random = crypto.randomBytes(24).toString('hex');
    return `hire_${envLabel}_${random}`;
};

const readLegacyApiKeyTransport = (req = {}) => {
    const queryKey = req.query?.api_key || req.query?.apiKey || null;
    if (queryKey) {
        return {
            apiKey: queryKey,
            transport: API_KEY_TRANSPORT.query,
        };
    }

    const bodyKey = req.body?.api_key || req.body?.apiKey || null;
    if (bodyKey) {
        return {
            apiKey: bodyKey,
            transport: API_KEY_TRANSPORT.body,
        };
    }

    return {
        apiKey: null,
        transport: API_KEY_TRANSPORT.none,
    };
};

const resolveApiKeyFromRequest = (req = {}) => {
    const headerKey = req.headers?.['x-api-key'] || req.headers?.['x-integration-key'] || null;
    if (headerKey) {
        return {
            apiKey: headerKey,
            transport: API_KEY_TRANSPORT.header,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        };
    }

    const legacy = readLegacyApiKeyTransport(req);
    if (!legacy.apiKey) {
        return {
            apiKey: null,
            transport: API_KEY_TRANSPORT.none,
            isLegacyTransport: false,
            legacyTransportBlocked: false,
        };
    }

    const legacyAllowed = allowLegacyApiKeyTransports();

    return {
        apiKey: legacyAllowed ? legacy.apiKey : null,
        transport: legacy.transport,
        isLegacyTransport: true,
        legacyTransportBlocked: !legacyAllowed,
    };
};

const extractApiKeyFromRequest = (req = {}) => resolveApiKeyFromRequest(req).apiKey;

const createApiKey = async ({
    ownerId,
    scope = DEFAULT_SCOPE,
    rateLimitTier = DEFAULT_RATE_LIMIT_TIER,
    rateLimit = null,
    allowedDomains = [],
    organization = null,
    label = 'External API Key',
} = {}) => {
    const rawKey = generateRawApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = getKeyPrefix(rawKey);
    const normalizedTier = normalizeRateLimitTier(rateLimitTier);
    const legacyPlanType = TIER_TO_LEGACY_PLAN[normalizedTier] || 'free';

    const created = await ApiKey.create({
        key: keyHash,
        keyPrefix,
        keyPattern: keyPrefix,
        ownerId,
        employerId: ownerId,
        scope: normalizeScope(scope),
        revoked: false,
        rateLimitTier: normalizedTier,
        rateLimit: normalizedTier === 'enterprise' && Number.parseInt(rateLimit, 10) > 0
            ? Number.parseInt(rateLimit, 10)
            : null,
        label: String(label || 'External API Key').slice(0, 80),
        allowedDomains: Array.isArray(allowedDomains) ? allowedDomains : [],
        organization,
        planType: legacyPlanType,
        tier: legacyPlanType,
        isActive: true,
    });

    return {
        apiKey: created,
        rawKey,
        maskedKey: maskApiKey(rawKey),
    };
};

const findApiKeyByRawValue = async (rawKey = '') => {
    const normalized = String(rawKey || '').trim();
    if (!normalized) return null;

    const keyPrefix = getKeyPrefix(normalized);
    const candidates = await ApiKey.find({
        $or: [
            { keyPrefix },
            { keyPattern: keyPrefix },
            { keyPattern: normalized },
            { key: normalized },
        ],
    }).select('+key +keyPattern +keyPrefix +keyId +scope +rateLimitTier +revoked +isActive +ownerId +employerId +organization +rateLimit +planType +tier +allowedDomains +usageCount +usageMetrics +lastUsedAt');

    if (!Array.isArray(candidates) || !candidates.length) {
        return null;
    }

    const hashedCandidate = hashApiKey(normalized);

    for (const candidate of candidates) {
        const storedKey = String(candidate.key || '').trim();
        const storedPattern = String(candidate.keyPattern || '').trim();

        if (!storedKey && storedPattern === normalized) {
            return candidate;
        }

        if (storedKey && (storedKey === hashedCandidate || storedKey === normalized)) {
            return candidate;
        }

        if (storedPattern && storedPattern === normalized) {
            return candidate;
        }

        if (storedKey && !isLikelyHashed(storedKey) && storedKey === normalized) {
            return candidate;
        }
    }

    return null;
};

const revokeApiKey = async ({ apiKeyId, ownerId }) => {
    const updated = await ApiKey.findOneAndUpdate(
        {
            _id: apiKeyId,
            ownerId,
            revoked: false,
        },
        {
            $set: {
                revoked: true,
                revokedAt: new Date(),
                isActive: false,
            },
        },
        {
            new: true,
        }
    );

    return updated;
};

module.exports = {
    API_KEY_TRANSPORT,
    BASE_RATE_LIMITS_PER_HOUR,
    allowLegacyApiKeyTransports,
    resolveApiKeyFromRequest,
    extractApiKeyFromRequest,
    normalizeScope,
    normalizeRateLimitTier,
    toRateLimitPerHour,
    maskApiKey,
    hashApiKey,
    getKeyPrefix,
    createApiKey,
    findApiKeyByRawValue,
    revokeApiKey,
};
