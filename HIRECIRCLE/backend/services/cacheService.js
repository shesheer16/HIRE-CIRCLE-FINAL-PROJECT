const crypto = require('crypto');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const CACHE_PREFIX = 'cache';

const CACHE_TTL_SECONDS = Object.freeze({
    jobs: 60,
    feed: 30,
    profile: 120,
    analytics: 300,
});

const isCacheAvailable = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.get === 'function'
    && typeof redisClient.setEx === 'function'
);

const stableStringify = (value) => {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${pairs.join(',')}}`;
};

const buildCacheKey = (namespace, payload = {}) => {
    const digest = crypto
        .createHash('sha1')
        .update(stableStringify(payload))
        .digest('hex');
    return `${CACHE_PREFIX}:${String(namespace || 'default')}:${digest}`;
};

const getJSON = async (key) => {
    if (!isCacheAvailable()) return null;
    try {
        const raw = await redisClient.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (error) {
        logger.warn({
            event: 'cache_get_failed',
            key,
            message: error.message,
        });
        return null;
    }
};

const setJSON = async (key, value, ttlSeconds) => {
    if (!isCacheAvailable()) return false;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return false;
    try {
        await redisClient.setEx(key, Math.round(ttlSeconds), JSON.stringify(value));
        return true;
    } catch (error) {
        logger.warn({
            event: 'cache_set_failed',
            key,
            message: error.message,
        });
        return false;
    }
};

const del = async (keys = []) => {
    if (!isCacheAvailable()) return 0;
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    if (!list.length) return 0;
    try {
        return await redisClient.del(list);
    } catch (error) {
        logger.warn({
            event: 'cache_del_failed',
            keys: list.length,
            message: error.message,
        });
        return 0;
    }
};

const delByPattern = async (pattern, { batchSize = 200 } = {}) => {
    if (!isCacheAvailable()) return 0;
    if (!pattern) return 0;

    const keys = [];

    try {
        if (typeof redisClient.scanIterator === 'function') {
            for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: batchSize })) {
                keys.push(key);
                if (keys.length >= batchSize) {
                    await del(keys.splice(0, keys.length));
                }
            }
        } else if (typeof redisClient.keys === 'function') {
            const matched = await redisClient.keys(pattern);
            keys.push(...matched);
        }

        if (keys.length) {
            await del(keys);
            return keys.length;
        }

        return 0;
    } catch (error) {
        logger.warn({
            event: 'cache_pattern_delete_failed',
            pattern,
            message: error.message,
        });
        return 0;
    }
};

module.exports = {
    CACHE_TTL_SECONDS,
    buildCacheKey,
    getJSON,
    setJSON,
    del,
    delByPattern,
    isCacheAvailable,
};
