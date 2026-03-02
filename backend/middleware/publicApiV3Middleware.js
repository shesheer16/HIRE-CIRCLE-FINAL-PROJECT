const ApiKey = require('../models/ApiKey');
const ApiAuditLog = require('../models/ApiAuditLog');
const redisClient = require('../config/redis');
const {
    consumeApiRateLimit,
    consumeInvalidApiKeyAttempt,
    readIpAddress,
} = require('../services/externalRateLimitService');
const {
    findApiKeyByRawValue,
    toRateLimitPerHour,
} = require('../services/externalApiKeyService');
const { trackApiUsageForBilling } = require('../services/apiBillingService');
const {
    resolveTenantContextFromApiKey,
} = require('../services/tenantIsolationService');
const { appendPlatformAuditLog } = require('../services/platformAuditService');
const { verifyWidgetToken } = require('../services/widgetTokenService');

const BURST_WINDOW_MS = Number.parseInt(process.env.PUBLIC_API_BURST_WINDOW_MS || '60000', 10);
const BURST_MAX_REQUESTS = Number.parseInt(process.env.PUBLIC_API_BURST_MAX_REQUESTS || '120', 10);
const MAX_ABUSE_SIGNALS = Number.parseInt(process.env.PUBLIC_API_MAX_ABUSE_SIGNALS || '10', 10);

const SCOPE_ACCESS = {
    jobs: new Set(['jobs', 'read-only', 'full-access']),
    applications: new Set(['applications', 'full-access']),
    profiles: new Set(['read-only', 'jobs', 'applications', 'full-access']),
};

const getApiKeyFromRequest = (req = {}) => (
    req.headers?.['x-api-key']
    || req.query?.api_key
    || req.query?.apiKey
    || req.body?.api_key
    || req.body?.apiKey
    || null
);

const getWidgetTokenFromRequest = (req = {}) => (
    req.headers?.['x-widget-token']
    || req.query?.widget_token
    || req.query?.widgetToken
    || null
);

const normalizeHost = (value = '') => {
    const input = String(value || '').trim();
    if (!input) return '';
    try {
        const parsed = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
        return String(parsed.hostname || '').toLowerCase();
    } catch (_error) {
        return input.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    }
};

const isScopeAllowed = (apiKey, requiredScope) => {
    if (!requiredScope) return true;
    const availableScopes = SCOPE_ACCESS[requiredScope] || new Set(['full-access']);
    const keyScope = String(apiKey?.scope || 'read-only').toLowerCase();
    return availableScopes.has(keyScope);
};

const resolveKeyFromWidgetToken = async ({ req, widgetToken }) => {
    const requestOrigin = req.headers?.origin || req.headers?.referer || '';
    const requestDomain = normalizeHost(requestOrigin);

    const tokenPayload = verifyWidgetToken({
        token: widgetToken,
        requestDomain,
    });

    if (!tokenPayload?.sub) {
        throw new Error('Invalid widget token payload');
    }

    const apiKeyDoc = await ApiKey.findOne({
        _id: tokenPayload.sub,
        isActive: true,
        revoked: { $ne: true },
    }).select('+key +scope +rateLimitTier +rateLimit +planType +tier +ownerId +employerId +organization +allowedDomains +usageMetrics +usageCount +isActive +revoked +keyId');

    if (!apiKeyDoc) {
        throw new Error('Widget token key not found');
    }

    return {
        apiKeyDoc,
        tokenPayload,
    };
};

const consumeBurstGuard = async ({ apiKeyId }) => {
    const key = `ext:burst:${String(apiKeyId)}:${Math.floor(Date.now() / BURST_WINDOW_MS)}`;
    const count = await redisClient.incr(key);
    if (count === 1) {
        await redisClient.pExpire(key, BURST_WINDOW_MS);
    }

    return {
        allowed: count <= BURST_MAX_REQUESTS,
        count,
        max: BURST_MAX_REQUESTS,
    };
};

const incrementUsageMetrics = async ({ apiKeyDoc, burstViolation = false }) => {
    apiKeyDoc.usageCount = Number(apiKeyDoc.usageCount || 0) + 1;
    apiKeyDoc.lastUsedAt = new Date();

    const metrics = apiKeyDoc.usageMetrics || {};
    metrics.totalCalls = Number(metrics.totalCalls || 0) + 1;
    metrics.lastCallAt = new Date();
    if (burstViolation) {
        metrics.burstViolations = Number(metrics.burstViolations || 0) + 1;
        metrics.abuseSignals = Number(metrics.abuseSignals || 0) + 1;
    }

    apiKeyDoc.usageMetrics = metrics;

    if (Number(metrics.abuseSignals || 0) >= MAX_ABUSE_SIGNALS) {
        apiKeyDoc.isActive = false;
        apiKeyDoc.revoked = true;
        apiKeyDoc.revokedAt = new Date();
    }

    await apiKeyDoc.save();
};

const applyPublicApiGuard = (requiredScope) => async (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const ipAddress = readIpAddress(req);
    const rawApiKey = getApiKeyFromRequest(req);
    const widgetToken = getWidgetTokenFromRequest(req);

    try {
        let apiKeyDoc = null;
        let authSource = 'api_key';

        if (widgetToken) {
            const resolved = await resolveKeyFromWidgetToken({ req, widgetToken });
            apiKeyDoc = resolved.apiKeyDoc;
            authSource = 'widget_token';
            req.widgetTokenPayload = resolved.tokenPayload;
        } else if (rawApiKey) {
            apiKeyDoc = await findApiKeyByRawValue(rawApiKey);
        }

        if (!apiKeyDoc || apiKeyDoc.isActive === false || apiKeyDoc.revoked === true) {
            await consumeInvalidApiKeyAttempt({ ipAddress });
            return res.status(401).json({ message: 'Invalid or inactive API key' });
        }

        if (!isScopeAllowed(apiKeyDoc, requiredScope)) {
            return res.status(403).json({ message: 'API key scope does not allow this endpoint' });
        }

        const rateLimit = toRateLimitPerHour(apiKeyDoc);
        const rateStatus = await consumeApiRateLimit({
            apiKeyId: apiKeyDoc._id,
            limitPerHour: rateLimit,
        });

        if (!rateStatus.allowed) {
            return res.status(429).json({
                message: 'Rate limit exceeded',
                retryAfterMs: rateStatus.retryAfterMs,
            });
        }

        const burstStatus = await consumeBurstGuard({ apiKeyId: apiKeyDoc._id });
        const burstViolation = !burstStatus.allowed;

        await incrementUsageMetrics({
            apiKeyDoc,
            burstViolation,
        });

        const billing = await trackApiUsageForBilling({
            apiKey: apiKeyDoc,
            statusCode: 200,
            burstViolation,
        });

        if (billing?.policy?.blocked) {
            return res.status(billing.policy.status).json({ message: billing.policy.message });
        }

        req.externalApiKey = apiKeyDoc;
        req.tenantContext = resolveTenantContextFromApiKey(apiKeyDoc);
        req.externalAuthSource = authSource;

        res.on('finish', () => {
            const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            const isSuccess = res.statusCode >= 200 && res.statusCode < 400;

            const metrics = apiKeyDoc.usageMetrics || {};
            if (isSuccess) {
                metrics.successfulCalls = Number(metrics.successfulCalls || 0) + 1;
            } else {
                metrics.failedCalls = Number(metrics.failedCalls || 0) + 1;
            }
            apiKeyDoc.usageMetrics = metrics;
            apiKeyDoc.save().catch(() => null);

            void ApiAuditLog.create({
                apiKeyId: apiKeyDoc._id,
                endpoint: req.originalUrl,
                ip: ipAddress,
                responseStatus: res.statusCode,
                latency: Number(latencyMs.toFixed(2)),
                timestamp: new Date(),
            });

            void appendPlatformAuditLog({
                eventType: 'api.key.request',
                actorType: 'api_key',
                actorId: apiKeyDoc._id,
                apiKeyId: apiKeyDoc._id,
                tenantId: req.tenantContext?.tenantId || null,
                route: req.originalUrl,
                method: req.method,
                action: 'api_request',
                status: res.statusCode,
                metadata: {
                    requiredScope,
                    authSource,
                    ipAddress,
                    latencyMs: Number(latencyMs.toFixed(2)),
                    burstViolation,
                    keyId: apiKeyDoc.keyId || null,
                },
            });
        });

        return next();
    } catch (error) {
        void appendPlatformAuditLog({
            eventType: 'api.key.auth_failed',
            actorType: 'system',
            actorId: null,
            apiKeyId: null,
            tenantId: null,
            route: req.originalUrl,
            method: req.method,
            action: 'auth_failed',
            status: 401,
            metadata: {
                ipAddress,
                message: error.message,
            },
        });

        return res.status(401).json({ message: 'Public API authentication failed' });
    }
};

module.exports = {
    applyPublicApiGuard,
};
