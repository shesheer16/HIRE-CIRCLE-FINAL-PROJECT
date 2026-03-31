const { Event, EVENT_TYPES } = require('../models/Event');
const logger = require('../utils/logger');

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

const toObjectId = (value) => {
    if (!value) return null;
    return value;
};

const logPlatformEvent = async ({ type, userId = null, meta = {} }) => {
    if (!EVENT_TYPE_SET.has(String(type || ''))) {
        throw new Error(`Unsupported platform event type: ${type}`);
    }

    return Event.create({
        type,
        userId: toObjectId(userId),
        meta: meta && typeof meta === 'object' ? meta : {},
    });
};

const safeLogPlatformEvent = (payload) => {
    setImmediate(async () => {
        try {
            await logPlatformEvent(payload);
        } catch (error) {
            logger.warn(`platform event log failed: ${error.message}`);
        }
    });
};

module.exports = {
    EVENT_TYPES,
    logPlatformEvent,
    safeLogPlatformEvent,
};
