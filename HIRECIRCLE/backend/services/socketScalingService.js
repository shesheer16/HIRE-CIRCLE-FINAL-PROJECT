const redis = require('redis');
const logger = require('../utils/logger');
const redisClient = require('../config/redis');

let createAdapter = null;
try {
    ({ createAdapter } = require('@socket.io/redis-adapter'));
} catch (_error) {
    createAdapter = null;
}

const socketFallbackRateState = new Map();
const socketFallbackDedupeState = new Map();

const isRedisReady = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.incr === 'function'
    && typeof redisClient.pExpire === 'function'
);

const consumeSocketRateLimit = async ({
    namespace = 'socket',
    key,
    limit,
    windowMs,
}) => {
    const safeKey = `socket:rl:${namespace}:${String(key || 'unknown')}`;
    const safeLimit = Math.max(1, Number(limit || 1));
    const safeWindowMs = Math.max(250, Number(windowMs || 1000));

    if (isRedisReady()) {
        const count = await redisClient.incr(safeKey);
        if (count === 1) {
            await redisClient.pExpire(safeKey, safeWindowMs);
        }
        return count <= safeLimit;
    }

    const now = Date.now();
    const current = socketFallbackRateState.get(safeKey);
    if (!current || (now - current.startedAt) >= safeWindowMs) {
        socketFallbackRateState.set(safeKey, { startedAt: now, count: 1 });
        return true;
    }
    current.count += 1;
    socketFallbackRateState.set(safeKey, current);
    return current.count <= safeLimit;
};

const rememberSocketMessageId = async ({
    namespace = 'message',
    key,
    dedupeWindowMs,
}) => {
    const rawKey = String(key || '').trim();
    if (!rawKey) return false;

    const cacheKey = `socket:dedupe:${namespace}:${rawKey}`;
    const safeWindow = Math.max(1000, Number(dedupeWindowMs || (2 * 60 * 1000)));

    if (isRedisReady() && typeof redisClient.set === 'function') {
        const result = await redisClient.set(cacheKey, '1', { NX: true, PX: safeWindow });
        return result !== 'OK';
    }

    const now = Date.now();
    const seenAt = socketFallbackDedupeState.get(cacheKey);
    if (seenAt && (now - seenAt) <= safeWindow) {
        return true;
    }
    socketFallbackDedupeState.set(cacheKey, now);
    return false;
};

const attachRedisAdapterToSocketIo = async (io) => {
    if (!io || !createAdapter) {
        return {
            enabled: false,
            reason: createAdapter ? 'invalid_io' : 'redis_adapter_dependency_missing',
        };
    }

    const redisUrl = String(process.env.REDIS_URL || '').trim();
    if (!redisUrl) {
        return { enabled: false, reason: 'redis_url_missing' };
    }

    const pubClient = redis.createClient({ url: redisUrl });
    const subClient = pubClient.duplicate();

    await pubClient.connect();
    await subClient.connect();

    io.adapter(createAdapter(pubClient, subClient));

    logger.info({
        event: 'socket_redis_adapter_enabled',
    });

    return {
        enabled: true,
        pubClient,
        subClient,
    };
};

module.exports = {
    attachRedisAdapterToSocketIo,
    consumeSocketRateLimit,
    rememberSocketMessageId,
};
