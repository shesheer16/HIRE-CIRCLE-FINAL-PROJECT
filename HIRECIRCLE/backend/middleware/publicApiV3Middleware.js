const ApiAuditLog = require('../models/ApiAuditLog');
const redisClient = require('../config/redis');
const {
    consumeApiRateLimit,
    consumeInvalidApiKeyAttempt,
    readIpAddress,
} = require('../services/externalRateLimitService');
const {
    API_KEY_TRANSPORT,
    resolveApiKeyFromRequest,
    findApiKeyByRawValue,
    toRateLimitPerHour,
} = require('../services/externalApiKeyService');
const { trackApiUsageForBilling } = require('../services/apiBillingService');
const {
    resolveTenantContextFromApiKey,
} = require('../services/tenantIsolationService');
const { appendPlatformAuditLog } = require('../services/platformAuditService');
const {
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
} = require('../services/widgetTokenService');

const BURST_WINDOW_MS = Number.parseInt(process.env.PUBLIC_API_BURST_WINDOW_MS || '60000', 10);
const BURST_MAX_REQUESTS = Number.parseInt(process.env.PUBLIC_API_BURST_MAX_REQUESTS || '120', 10);
const MAX_ABUSE_SIGNALS = Number.parseInt(process.env.PUBLIC_API_MAX_ABUSE_SIGNALS || '10', 10);

const SCOPE_ACCESS = {
    jobs: new Set(['jobs', 'read-only', 'full-access']),
    applications: new Set(['applications', 'full-access']),
    profiles: new Set(['read-only', 'jobs', 'applications', 'full-access']),
};

const getWidgetTokenFromRequest = (req = {}) => (
    req.headers?.['x-widget-token']
    || req.query?.widget_token
    || req.query?.widgetToken
    || null
);

const isScopeAllowed = (apiKey, requiredScope) => {
    if (!requiredScope) return true;
    const availableScopes = SCOPE_ACCESS[requiredScope] || new Set(['full-access']);
    const keyScope = String(apiKey?.scope || 'read-only').toLowerCase();
    return availableScopes.has(keyScope);
};

const resolveKeyFromWidgetToken = async ({ req, widgetToken }) => {
    const requestDomain = resolveWidgetRequestDomain(req);
    const { apiKeyDoc, tokenPayload } = await resolveApiKeyFromWidgetToken({
        token: widgetToken,
        requestDomain,
    });

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

const applyLegacyApiKeyTransportHeaders = (res, transport) => {
    if (!res || typeof res.setHeader !== 'function') {
        return;
    }

    res.setHeader('Deprecation', 'true');
    res.setHeader('Warning', '299 - "API key query/body transport is deprecated; use the X-API-Key header instead."');
    res.setHeader('X-API-Key-Transport', transport);
};

const resolveApiKeyAuthSource = (transport) => {
    if (transport === API_KEY_TRANSPORT.query) return 'api_key_query';
    if (transport === API_KEY_TRANSPORT.body) return 'api_key_body';
    return 'api_key';
};

const applyPublicApiGuard = (requiredScope) => async (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const ipAddress = readIpAddress(req);
    const apiKeyRequest = resolveApiKeyFromRequest(req);
    const rawApiKey = apiKeyRequest.apiKey;
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
            authSource = resolveApiKeyAuthSource(apiKeyRequest.transport);
            if (apiKeyRequest.isLegacyTransport) {
                applyLegacyApiKeyTransportHeaders(res, apiKeyRequest.transport);
            }
        } else if (apiKeyRequest.legacyTransportBlocked) {
            return res.status(401).json({ message: 'API key is required via the X-API-Key header' });
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
