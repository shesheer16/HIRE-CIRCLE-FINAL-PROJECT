const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const memoryFlags = new Map();
const FLAG_PREFIX = 'system_flag:';

const getSystemFlag = async (key, fallback = false) => {
    const normalizedKey = `${FLAG_PREFIX}${key}`;
    try {
        if (redisClient?.isOpen) {
            const value = await redisClient.get(normalizedKey);
            if (value === null || value === undefined) return fallback;
            return value === 'true';
        }
    } catch (error) {
        logger.warn(`System flag read failed for ${key}: ${error.message}`);
    }

    if (!memoryFlags.has(normalizedKey)) return fallback;
    return memoryFlags.get(normalizedKey) === true;
};

const setSystemFlag = async (key, value, ttlSeconds = null) => {
    const normalizedKey = `${FLAG_PREFIX}${key}`;
    const normalizedValue = Boolean(value);

    try {
        if (redisClient?.isOpen) {
            if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
                await redisClient.setEx(normalizedKey, ttlSeconds, String(normalizedValue));
            } else {
                await redisClient.set(normalizedKey, String(normalizedValue));
            }
            return;
        }
    } catch (error) {
        logger.warn(`System flag write failed for ${key}: ${error.message}`);
    }

    memoryFlags.set(normalizedKey, normalizedValue);
};

module.exports = {
    getSystemFlag,
    setSystemFlag,
};
