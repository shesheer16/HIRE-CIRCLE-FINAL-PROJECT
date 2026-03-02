const {
    extractApiKeyFromRequest,
    findApiKeyByRawValue,
    normalizeScope,
    toRateLimitPerHour,
    maskApiKey,
} = require('../services/externalApiKeyService');
const {
    readIpAddress,
    consumeApiRateLimit,
    consumeInvalidApiKeyAttempt,
    consumeReplayGuardAttempt,
} = require('../services/externalRateLimitService');
const { sendError } = require('../services/externalResponseService');

const scopeOrder = {
    'read-only': 1,
    jobs: 2,
    applications: 2,
    'full-access': 3,
};

const hasScope = ({ keyScope, allowedScopes = [] }) => {
    const normalizedKeyScope = normalizeScope(keyScope);
    if (normalizedKeyScope === 'full-access') return true;
    return (Array.isArray(allowedScopes) ? allowedScopes : []).includes(normalizedKeyScope);
};

const externalSecurityHeaders = (req, res, next) => {
    res.setHeader('x-api-version', 'v1');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return next();
};

const externalApiKeyAuth = async (req, res, next) => {
    try {
        const rawApiKey = extractApiKeyFromRequest(req);

        if (!rawApiKey) {
            return sendError(res, {
                status: 401,
                code: 'API_KEY_REQUIRED',
                message: 'External API key is required via X-API-Key header',
                requestId: req.correlationId || null,
            });
        }

        const apiKeyDoc = await findApiKeyByRawValue(rawApiKey);

        if (!apiKeyDoc) {
            const invalidAttempt = await consumeInvalidApiKeyAttempt({ ipAddress: readIpAddress(req) });

            if (!invalidAttempt.allowed) {
                return sendError(res, {
                    status: 429,
                    code: 'API_KEY_BRUTE_GUARD',
                    message: 'Too many invalid API key attempts from this IP',
                    requestId: req.correlationId || null,
                });
            }

            return sendError(res, {
                status: 401,
                code: 'API_KEY_INVALID',
                message: 'Invalid external API key',
                requestId: req.correlationId || null,
            });
        }

        if (apiKeyDoc.revoked || apiKeyDoc.isActive === false) {
            return sendError(res, {
                status: 403,
                code: 'API_KEY_REVOKED',
                message: 'This API key has been revoked',
                requestId: req.correlationId || null,
            });
        }

        req.externalApiKey = apiKeyDoc;
        req.externalApiClient = {
            apiKeyId: String(apiKeyDoc._id),
            ownerId: apiKeyDoc.ownerId || apiKeyDoc.employerId || null,
            organizationId: apiKeyDoc.organization || null,
            scope: normalizeScope(apiKeyDoc.scope),
            rateLimitTier: apiKeyDoc.rateLimitTier,
            maskedKey: maskApiKey(rawApiKey),
        };

        next();
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'API_AUTH_FAILED',
            message: 'External API authentication failed',
            requestId: req.correlationId || null,
        });
    }
};

const requireExternalScope = (allowedScopes = []) => {
    return (req, res, next) => {
        if (!req.externalApiKey) {
            return sendError(res, {
                status: 500,
                code: 'AUTH_CONTEXT_MISSING',
                message: 'External auth context missing',
                requestId: req.correlationId || null,
            });
        }

        const keyScope = normalizeScope(req.externalApiKey.scope);
        if (!hasScope({ keyScope, allowedScopes })) {
            return sendError(res, {
                status: 403,
                code: 'SCOPE_FORBIDDEN',
                message: `API key scope '${keyScope}' is not allowed for this endpoint`,
                requestId: req.correlationId || null,
            });
        }

        return next();
    };
};

const externalTierRateLimit = async (req, res, next) => {
    try {
        if (!req.externalApiKey?._id) {
            return sendError(res, {
                status: 500,
                code: 'RATE_LIMIT_CONTEXT_MISSING',
                message: 'Missing API key context for rate limiting',
                requestId: req.correlationId || null,
            });
        }

        const limitPerHour = toRateLimitPerHour(req.externalApiKey);
        const result = await consumeApiRateLimit({
            apiKeyId: req.externalApiKey._id,
            limitPerHour,
        });

        res.setHeader('x-ratelimit-limit', String(limitPerHour));
        res.setHeader('x-ratelimit-remaining', String(result.remaining));
        res.setHeader('x-ratelimit-reset', String(Math.ceil(result.retryAfterMs / 1000)));

        if (!result.allowed) {
            res.setHeader('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
            return sendError(res, {
                status: 429,
                code: 'RATE_LIMIT_EXCEEDED',
                message: 'External API rate limit exceeded for current tier',
                details: {
                    limitPerHour,
                    retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000),
                },
                requestId: req.correlationId || null,
            });
        }

        return next();
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'RATE_LIMITER_UNAVAILABLE',
            message: 'External rate limiter unavailable',
            requestId: req.correlationId || null,
        });
    }
};

const externalReplayGuard = async (req, res, next) => {
    try {
        const method = String(req.method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
            return next();
        }

        const idempotencyKey = String(req.headers['x-idempotency-key'] || '').trim();
        if (!idempotencyKey) {
            return next();
        }

        const result = await consumeReplayGuardAttempt({
            apiKeyId: req.externalApiKey?._id || 'unknown',
            idempotencyKey,
        });

        if (!result.allowed) {
            return sendError(res, {
                status: 409,
                code: 'REPLAY_BLOCKED',
                message: 'Replay request blocked by idempotency policy',
                requestId: req.correlationId || null,
            });
        }

        return next();
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'REPLAY_GUARD_ERROR',
            message: 'Replay guard failed',
            requestId: req.correlationId || null,
        });
    }
};

module.exports = {
    externalSecurityHeaders,
    externalApiKeyAuth,
    requireExternalScope,
    externalTierRateLimit,
    externalReplayGuard,
    scopeOrder,
};
