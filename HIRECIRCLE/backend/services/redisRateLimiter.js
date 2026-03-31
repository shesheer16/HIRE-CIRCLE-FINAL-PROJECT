const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const fallbackBuckets = new Map();

const isRedisReady = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.incr === 'function'
    && typeof redisClient.pExpire === 'function'
);

const normalizeIp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('::ffff:')) {
        return raw.slice(7);
    }
    return raw;
};

const firstForwardedIp = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return normalizeIp(raw.split(',')[0]);
};

const readIp = (req) => {
    const expressResolvedIp = normalizeIp(req?.ip);
    if (expressResolvedIp) {
        return expressResolvedIp;
    }

    const trustProxy = Boolean(req?.app?.get?.('trust proxy'));
    if (trustProxy) {
        const trustedForwardedIp = firstForwardedIp(req?.headers?.['x-forwarded-for']);
        if (trustedForwardedIp) {
            return trustedForwardedIp;
        }
    }

    return normalizeIp(req?.socket?.remoteAddress || req?.connection?.remoteAddress) || 'unknown';
};

const safeNow = () => Date.now();

const localConsume = (key, windowMs, max) => {
    const now = safeNow();
    const current = fallbackBuckets.get(key);
    if (!current || (now - current.startedAt) >= windowMs) {
        fallbackBuckets.set(key, { startedAt: now, count: 1 });
        return { allowed: true, remaining: Math.max(0, max - 1), retryAfterMs: windowMs };
    }

    current.count += 1;
    fallbackBuckets.set(key, current);

    const retryAfterMs = Math.max(1, windowMs - (now - current.startedAt));
    return {
        allowed: current.count <= max,
        remaining: Math.max(0, max - current.count),
        retryAfterMs,
    };
};

const createRedisRateLimiter = ({
    namespace = 'api',
    windowMs = 60 * 1000,
    max = 60,
    keyGenerator = null,
    message = 'Too many requests',
    skip = null,
    strictRedis = false,
} = {}) => {
    return async (req, res, next) => {
        try {
            if (typeof skip === 'function' && skip(req)) {
                return next();
            }

            const keyPart = typeof keyGenerator === 'function'
                ? String(keyGenerator(req))
                : String(readIp(req));
            const rateKey = `rl:${namespace}:${keyPart}`;
            const resolvedMaxRaw = typeof max === 'function' ? await max(req) : max;
            const maxAllowed = Math.max(
                1,
                Number.isFinite(Number(resolvedMaxRaw))
                    ? Number(resolvedMaxRaw)
                    : 1
            );

            let result = null;

            if (isRedisReady()) {
                const count = await redisClient.incr(rateKey);
                if (count === 1) {
                    await redisClient.pExpire(rateKey, windowMs);
                }
                const ttl = await redisClient.pTTL(rateKey);
                const retryAfterMs = Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs;
                result = {
                    allowed: count <= maxAllowed,
                    remaining: Math.max(0, maxAllowed - count),
                    retryAfterMs,
                };
            } else {
                if (strictRedis) {
                    return res.status(503).json({
                        success: false,
                        message: 'Rate limiter unavailable',
                    });
                }
                result = localConsume(rateKey, windowMs, maxAllowed);
            }

            res.setHeader('x-ratelimit-limit', String(maxAllowed));
            res.setHeader('x-ratelimit-remaining', String(result.remaining));
            res.setHeader('x-ratelimit-reset', String(Math.ceil(result.retryAfterMs / 1000)));

            if (result.allowed) {
                return next();
            }

            res.setHeader('retry-after', String(Math.ceil(result.retryAfterMs / 1000)));
            return res.status(429).json({
                success: false,
                message,
            });
        } catch (error) {
            logger.warn({
                event: 'rate_limiter_error',
                namespace,
                message: error.message,
            });
            return next();
        }
    };
};

module.exports = {
    createRedisRateLimiter,
    readIp,
};
