const redisClient = require('../config/redis');

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const asPositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const toBucketSuffix = (date = new Date()) => {
    const d = new Date(date);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`;
};

const readIpAddress = (req = {}) => {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.connection?.remoteAddress || 'unknown';
};

const consumeCounter = async ({ key, windowMs, max }) => {
    const count = await redisClient.incr(key);
    if (count === 1) {
        await redisClient.pExpire(key, windowMs);
    }
    const ttl = await redisClient.pTTL(key);
    const retryAfterMs = Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs;

    return {
        allowed: count <= max,
        remaining: Math.max(0, max - count),
        retryAfterMs,
        count,
        max,
    };
};

const consumeApiRateLimit = async ({ apiKeyId, limitPerHour }) => {
    const max = asPositiveInteger(limitPerHour, 100);
    const bucket = toBucketSuffix(new Date());
    const key = `ext:rl:key:${String(apiKeyId)}:${bucket}`;
    return consumeCounter({ key, windowMs: HOUR_MS, max });
};

const consumeInvalidApiKeyAttempt = async ({ ipAddress }) => {
    const ip = String(ipAddress || 'unknown').trim() || 'unknown';
    const bruteMax = asPositiveInteger(process.env.EXTERNAL_API_BRUTE_LIMIT_PER_10_MIN || '40', 40);
    const key = `ext:rl:invalid-key:${ip}`;
    return consumeCounter({ key, windowMs: 10 * MINUTE_MS, max: bruteMax });
};

const consumeReplayGuardAttempt = async ({ apiKeyId, idempotencyKey }) => {
    const idempotency = String(idempotencyKey || '').trim();
    if (!idempotency) {
        return {
            allowed: true,
            replay: false,
            remaining: Number.MAX_SAFE_INTEGER,
            retryAfterMs: 0,
        };
    }

    const ttlMs = asPositiveInteger(process.env.EXTERNAL_IDEMPOTENCY_TTL_MS || String(24 * HOUR_MS), 24 * HOUR_MS);
    const key = `ext:idempotency:${String(apiKeyId)}:${idempotency}`;
    const result = await consumeCounter({ key, windowMs: ttlMs, max: 1 });

    return {
        ...result,
        replay: !result.allowed,
    };
};

module.exports = {
    HOUR_MS,
    readIpAddress,
    consumeApiRateLimit,
    consumeInvalidApiKeyAttempt,
    consumeReplayGuardAttempt,
};
