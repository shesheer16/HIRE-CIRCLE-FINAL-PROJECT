const AnalyticsEvent = require('../models/AnalyticsEvent');
const logger = require('../utils/logger');
const { appendPlatformAuditLog } = require('../services/platformAuditService');
const {
    extractApiKeyFromRequest,
    findApiKeyByRawValue,
    toRateLimitPerHour,
} = require('../services/externalApiKeyService');
const {
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
} = require('../services/widgetTokenService');

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

const getApiKeyFromRequest = (req) => extractApiKeyFromRequest(req);
const getWidgetTokenFromRequest = (req = {}) => (
    req.headers?.['x-widget-token']
    || req.query?.widget_token
    || req.query?.widgetToken
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
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, X-Widget-Token, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
};

const resolvePlatformCredential = async (req) => {
    const rawKey = getApiKeyFromRequest(req);
    if (rawKey) {
        const apiKeyDoc = await findApiKeyByRawValue(rawKey);
        return {
            apiKeyDoc,
            authSource: 'api_key',
            rawCredential: rawKey,
            widgetTokenPayload: null,
        };
    }

    const widgetToken = getWidgetTokenFromRequest(req);
    if (!widgetToken) {
        return {
            apiKeyDoc: null,
            authSource: 'none',
            rawCredential: null,
            widgetTokenPayload: null,
        };
    }

    const requestDomain = resolveWidgetRequestDomain(req);
    const { apiKeyDoc, tokenPayload } = await resolveApiKeyFromWidgetToken({
        token: widgetToken,
        requestDomain,
    });

    return {
        apiKeyDoc,
        authSource: 'widget_token',
        rawCredential: widgetToken,
        widgetTokenPayload: tokenPayload,
    };
};

const platformApiKeyGuard = async (req, res, next) => {
    try {
        const {
            apiKeyDoc,
            authSource,
            rawCredential,
            widgetTokenPayload,
        } = await resolvePlatformCredential(req);

        if (!rawCredential) {
            return res.status(401).json({ message: 'Platform API credential is required' });
        }

        if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked) {
            return res.status(401).json({ message: 'Invalid platform API credential' });
        }

        if (authSource !== 'widget_token' && !isOriginAllowedForKey(apiKeyDoc, req.headers.origin)) {
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
            keyMasked: maskKey(apiKeyDoc.key || apiKeyDoc.keyPattern || rawCredential),
            organization: apiKeyDoc.organization || null,
            employerId: apiKeyDoc.employerId || null,
            planType,
            rateLimit: resolvedRateLimit,
            usageCount: apiKeyDoc.usageCount,
            authSource,
        };
        req.tenantContext = {
            tenantId: apiKeyDoc.organization || null,
            ownerId: apiKeyDoc.ownerId || apiKeyDoc.employerId || null,
            mode: apiKeyDoc.organization ? 'organization' : 'owner',
        };
        if (widgetTokenPayload) {
            req.widgetTokenPayload = widgetTokenPayload;
        }

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
                        authSource,
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
                    authSource,
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
    const { apiKeyDoc, rawCredential, authSource } = await resolvePlatformCredential(req);
    if (!rawCredential) {
        return res.status(401).json({ message: 'Platform API credential is required' });
    }

    if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked) {
        return res.status(401).json({ message: 'Invalid platform API credential' });
    }

    if (authSource !== 'widget_token' && !isOriginAllowedForKey(apiKeyDoc, req.headers.origin)) {
        return res.status(403).json({ message: 'Origin not allowed for this API key' });
    }

    applyPlatformCorsHeaders(req, res);
    return res.status(204).send();
};

module.exports = {
    platformApiKeyGuard,
    platformApiOptionsHandler,
};
