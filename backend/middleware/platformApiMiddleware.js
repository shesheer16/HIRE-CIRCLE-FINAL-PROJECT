const AnalyticsEvent = require('../models/AnalyticsEvent');
const logger = require('../utils/logger');
const { appendPlatformAuditLog } = require('../services/platformAuditService');
const {
    findApiKeyByRawValue,
    toRateLimitPerHour,
} = require('../services/externalApiKeyService');

const toStartOfDayUtc = (date = new Date()) => {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
};

const maskKey = (value = '') => {
    const text = String(value || '');
    if (text.length <= 6) return '***';
    return `${text.slice(0, 3)}***${text.slice(-3)}`;
};

const normalizeHost = (value = '') => {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
        const parsed = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
        return String(parsed.hostname || '').toLowerCase();
    } catch (error) {
        return input.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
};

const getApiKeyFromRequest = (req) => (
    req.headers['x-api-key']
    || req.query.apiKey
    || req.query.api_key
    || req.body?.apiKey
    || req.body?.api_key
    || null
);

const isOriginAllowedForKey = (apiKeyDoc, originHeader) => {
    const allowlist = Array.isArray(apiKeyDoc?.allowedDomains)
        ? apiKeyDoc.allowedDomains.map(normalizeHost).filter(Boolean)
        : [];

    if (!allowlist.length) return true;
    if (!originHeader) return false;

    const requestHost = normalizeHost(originHeader);
    if (!requestHost) return false;

    return allowlist.some((allowedHost) => (
        requestHost === allowedHost || requestHost.endsWith(`.${allowedHost}`)
    ));
};

const applyPlatformCorsHeaders = (req, res) => {
    const origin = req.headers.origin;
    if (!origin) return;
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const platformApiKeyGuard = async (req, res, next) => {
    try {
        const rawKey = getApiKeyFromRequest(req);
        if (!rawKey) {
            return res.status(401).json({ message: 'Platform API key is required' });
        }

        const apiKeyDoc = await findApiKeyByRawValue(rawKey);

        if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked) {
            return res.status(401).json({ message: 'Invalid platform API key' });
        }

        if (!isOriginAllowedForKey(apiKeyDoc, req.headers.origin)) {
            return res.status(403).json({ message: 'Origin not allowed for this API key' });
        }

        const today = toStartOfDayUtc();
        const keyLastReset = toStartOfDayUtc(apiKeyDoc.lastResetDate || new Date(0));
        if (keyLastReset.getTime() !== today.getTime()) {
            apiKeyDoc.requestsToday = 0;
            apiKeyDoc.lastResetDate = today;
        }

        const planType = String(apiKeyDoc.planType || apiKeyDoc.tier || 'free').toLowerCase();
        const resolvedRateLimit = toRateLimitPerHour(apiKeyDoc);
        if (Number(apiKeyDoc.requestsToday || 0) >= resolvedRateLimit) {
            return res.status(429).json({
                message: 'Platform API rate limit exceeded',
                planType,
                rateLimit: resolvedRateLimit,
            });
        }

        apiKeyDoc.requestsToday = Number(apiKeyDoc.requestsToday || 0) + 1;
        apiKeyDoc.usageCount = Number(apiKeyDoc.usageCount || 0) + 1;
        apiKeyDoc.lastUsedAt = new Date();
        await apiKeyDoc.save();

        req.platformClient = {
            apiKeyId: apiKeyDoc._id,
            keyMasked: maskKey(apiKeyDoc.key || apiKeyDoc.keyPattern || rawKey),
            organization: apiKeyDoc.organization || null,
            employerId: apiKeyDoc.employerId || null,
            planType,
            rateLimit: resolvedRateLimit,
            usageCount: apiKeyDoc.usageCount,
        };
        req.tenantContext = {
            tenantId: apiKeyDoc.organization || null,
            ownerId: apiKeyDoc.ownerId || apiKeyDoc.employerId || null,
            mode: apiKeyDoc.organization ? 'organization' : 'owner',
        };

        if (typeof res.on === 'function') {
            res.on('finish', () => {
                void appendPlatformAuditLog({
                    eventType: 'api.key.request',
                    actorType: 'api_key',
                    actorId: String(apiKeyDoc._id),
                    apiKeyId: apiKeyDoc._id,
                    tenantId: apiKeyDoc.organization || null,
                    route: req.originalUrl,
                    method: req.method,
                    action: 'platform_api_request',
                    status: res.statusCode,
                    metadata: {
                        planType,
                        rateLimit: resolvedRateLimit,
                        origin: req.headers.origin || null,
                    },
                });
            });
        }

        setImmediate(() => {
            AnalyticsEvent.create({
                user: apiKeyDoc.employerId || null,
                eventName: 'PLATFORM_API_USAGE',
                metadata: {
                    apiKeyId: String(apiKeyDoc._id),
                    planType,
                    route: req.originalUrl,
                    method: req.method,
                    organizationId: apiKeyDoc.organization ? String(apiKeyDoc.organization) : null,
                    origin: req.headers.origin || null,
                },
            }).catch((error) => {
                logger.warn(`platform api usage log failed: ${error.message}`);
            });
        });

        applyPlatformCorsHeaders(req, res);
        return next();
    } catch (error) {
        logger.warn(`platform api guard failed: ${error.message}`);
        return res.status(500).json({ message: 'Platform authentication failed' });
    }
};

const platformApiOptionsHandler = async (req, res) => {
    const rawKey = getApiKeyFromRequest(req);
    if (!rawKey) {
        return res.status(401).json({ message: 'Platform API key is required' });
    }

    const apiKeyDoc = await findApiKeyByRawValue(rawKey);

    if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked) {
        return res.status(401).json({ message: 'Invalid platform API key' });
    }

    if (!isOriginAllowedForKey(apiKeyDoc, req.headers.origin)) {
        return res.status(403).json({ message: 'Origin not allowed for this API key' });
    }

    applyPlatformCorsHeaders(req, res);
    return res.status(204).send();
};

module.exports = {
    platformApiKeyGuard,
    platformApiOptionsHandler,
};
