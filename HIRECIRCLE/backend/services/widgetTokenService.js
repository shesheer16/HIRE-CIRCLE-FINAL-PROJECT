const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');

const TOKEN_TTL_SECONDS = Number.parseInt(process.env.WIDGET_TOKEN_TTL_SECONDS || '1800', 10);
const SESSION_TOKEN_TTL_SECONDS = Number.parseInt(process.env.WIDGET_SESSION_TOKEN_TTL_SECONDS || '300', 10);

const base64UrlEncode = (value = '') => Buffer.from(String(value)).toString('base64url');
const base64UrlDecode = (value = '') => Buffer.from(String(value), 'base64url').toString('utf8');

const resolveSecret = () => {
    const secret = String(process.env.WIDGET_TOKEN_SECRET || '').trim();
    if (!secret) {
        throw new Error('WIDGET_TOKEN_SECRET is required');
    }
    return secret;
};

const sign = (payload = '') => crypto
    .createHmac('sha256', resolveSecret())
    .update(String(payload))
    .digest('base64url');

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

const resolveWidgetRequestDomain = (req = {}) => normalizeHost(
    req.headers?.origin
    || req.headers?.referer
    || ''
);

const createWidgetToken = ({ apiKeyId, ownerId, tenantId = null, allowedDomain = null, ttlSeconds = TOKEN_TTL_SECONDS } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: String(apiKeyId || ''),
        ownerId: ownerId ? String(ownerId) : null,
        tenantId: tenantId ? String(tenantId) : null,
        allowedDomain: allowedDomain ? String(allowedDomain).toLowerCase() : null,
        iat: now,
        exp: now + Math.max(60, Number(ttlSeconds || TOKEN_TTL_SECONDS)),
    };

    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = sign(encodedPayload);
    return `${encodedPayload}.${signature}`;
};

const createWidgetSessionToken = ({ apiKeyId, ownerId, tenantId = null, ttlSeconds = SESSION_TOKEN_TTL_SECONDS } = {}) => (
    createWidgetToken({
        apiKeyId,
        ownerId,
        tenantId,
        allowedDomain: null,
        ttlSeconds,
    })
);

const verifyWidgetToken = ({ token, requestDomain = null } = {}) => {
    const [encodedPayload, signature] = String(token || '').split('.');
    if (!encodedPayload || !signature) {
        throw new Error('Invalid widget token format');
    }

    const expected = sign(encodedPayload);
    if (signature !== expected) {
        throw new Error('Invalid widget token signature');
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (!payload.exp || now > Number(payload.exp)) {
        throw new Error('Widget token expired');
    }

    if (payload.allowedDomain && !requestDomain) {
        throw new Error('Widget token domain required');
    }

    if (payload.allowedDomain && requestDomain) {
        const normalizedRequest = String(requestDomain || '').toLowerCase();
        const isExact = normalizedRequest === payload.allowedDomain;
        const isSubdomain = normalizedRequest.endsWith(`.${payload.allowedDomain}`);
        if (!isExact && !isSubdomain) {
            throw new Error('Widget token domain mismatch');
        }
    }

    return payload;
};

const resolveApiKeyFromWidgetToken = async ({ token, requestDomain = null } = {}) => {
    const tokenPayload = verifyWidgetToken({ token, requestDomain });
    if (!tokenPayload?.sub) {
        throw new Error('Invalid widget token payload');
    }

    const apiKeyDoc = await ApiKey.findOne({
        _id: tokenPayload.sub,
        isActive: true,
        revoked: { $ne: true },
    }).select('+key +scope +rateLimitTier +rateLimit +planType +tier +ownerId +employerId +organization +allowedDomains +usageMetrics +usageCount +isActive +revoked +keyId +requestsToday +lastResetDate');

    if (!apiKeyDoc) {
        throw new Error('Widget token key not found');
    }

    return {
        apiKeyDoc,
        tokenPayload,
    };
};

module.exports = {
    SESSION_TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS,
    createWidgetSessionToken,
    createWidgetToken,
    normalizeHost,
    resolveApiKeyFromWidgetToken,
    resolveWidgetRequestDomain,
    verifyWidgetToken,
};
