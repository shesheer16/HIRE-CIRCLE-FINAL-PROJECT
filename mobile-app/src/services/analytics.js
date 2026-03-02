import { logger } from '../utils/logger';

const MAX_QUEUE_SIZE = 500;
const analyticsQueue = [];

const normalizePayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }
    return payload;
};

export const trackEvent = (eventName, payload = {}) => {
    if (!eventName || typeof eventName !== 'string') {
        return;
    }

    const event = {
        name: eventName,
        payload: normalizePayload(payload),
        timestamp: Date.now(),
    };

    analyticsQueue.push(event);
    if (analyticsQueue.length > MAX_QUEUE_SIZE) {
        analyticsQueue.shift();
    }

    if (__DEV__) {
        logger.log('[analytics]', event.name, event.payload);
    }
};

export const getAnalyticsQueue = () => analyticsQueue.slice();

export const clearAnalyticsQueue = () => {
    analyticsQueue.length = 0;
};

export const getAnalyticsSummary = () => {
    const eventCounts = analyticsQueue.reduce((acc, event) => {
        const key = String(event?.name || 'UNKNOWN');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return {
        totalEvents: analyticsQueue.length,
        eventCounts,
        lastEventAt: analyticsQueue.length > 0 ? analyticsQueue[analyticsQueue.length - 1].timestamp : null,
    };
};

export const logAnalyticsSummary = (datasetSummary = null) => {
    if (!__DEV__) return;
    const analyticsSummary = getAnalyticsSummary();
    logger.log('[analytics-metrics]', {
        dataset: datasetSummary,
        analytics: analyticsSummary,
    });
};
