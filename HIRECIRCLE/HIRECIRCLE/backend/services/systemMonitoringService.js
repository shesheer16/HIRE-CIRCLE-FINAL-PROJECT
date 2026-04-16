const redisClient = require('../config/redis');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const SystemAlert = require('../models/SystemAlert');

const inMemoryCounters = new Map();
const inMemoryAlertRateLimit = new Map();

const DEFAULT_THRESHOLDS = {
    error_count: Number.parseInt(process.env.ALERT_ERROR_COUNT_THRESHOLD || '20', 10),
    otp_failure_spike: Number.parseInt(process.env.ALERT_OTP_FAILURE_THRESHOLD || '15', 10),
    ai_failure_spike: Number.parseInt(process.env.ALERT_AI_FAILURE_THRESHOLD || '10', 10),
    payment_failure_spike: Number.parseInt(process.env.ALERT_PAYMENT_FAILURE_THRESHOLD || '8', 10),
    redis_failure_count: Number.parseInt(process.env.ALERT_REDIS_FAILURE_THRESHOLD || '5', 10),
    db_latency_ms: Number.parseInt(process.env.ALERT_DB_LATENCY_MS_THRESHOLD || '250', 10),
    api_latency_ms: Number.parseInt(process.env.ALERT_API_LATENCY_MS_THRESHOLD || '800', 10),
    api_error_rate_percent: Number.parseInt(process.env.ALERT_API_ERROR_RATE_PERCENT_THRESHOLD || '8', 10),
    memory_usage_percent: Number.parseInt(process.env.ALERT_MEMORY_USAGE_PERCENT_THRESHOLD || '88', 10),
    queue_backlog_spike: Number.parseInt(process.env.ALERT_QUEUE_BACKLOG_THRESHOLD || '2000', 10),
};

const ALERT_RATE_LIMIT_WINDOW_SECONDS = Number.parseInt(process.env.ALERT_RATE_LIMIT_WINDOW_SECONDS || '300', 10);

const counterKey = (metric) => `monitor:${metric}`;
const alertKey = (metric, alertType) => `monitor:alert:${metric}:${alertType}`;
const hasDatabaseConnection = () => Number(mongoose?.connection?.readyState || 0) === 1;

const resolveScalingSuggestion = (metric) => {
    const normalized = String(metric || '').toLowerCase();
    if (normalized.includes('db')) return 'Scale DB read replicas and optimize slow-query indexes.';
    if (normalized.includes('queue')) return 'Scale worker replicas and increase queue throughput.';
    if (normalized.includes('api') || normalized.includes('error')) return 'Scale API instances and activate adaptive throttling for hot routes.';
    if (normalized.includes('memory')) return 'Scale memory-optimized nodes and pause heavy background jobs.';
    if (normalized.includes('cpu')) return 'Scale horizontally and reduce CPU-heavy request paths.';
    return 'Scale horizontally and isolate hotspot services.';
};

const incrementCounter = async ({ metric, ttlSeconds = 300 }) => {
    const key = counterKey(metric);

    try {
        if (redisClient?.isOpen && typeof redisClient.incr === 'function' && typeof redisClient.expire === 'function') {
            const value = await redisClient.incr(key);
            if (value === 1) {
                await redisClient.expire(key, ttlSeconds);
            }
            return value;
        }
    } catch (error) {
        logger.warn(`monitor counter fallback for ${metric}: ${error.message}`);
    }

    const now = Date.now();
    const existing = inMemoryCounters.get(key);
    if (!existing || existing.expiresAt <= now) {
        inMemoryCounters.set(key, { value: 1, expiresAt: now + (ttlSeconds * 1000) });
        return 1;
    }

    existing.value += 1;
    inMemoryCounters.set(key, existing);
    return existing.value;
};

const getCounter = async ({ metric }) => {
    const key = counterKey(metric);

    try {
        if (redisClient?.isOpen && typeof redisClient.get === 'function') {
            const value = await redisClient.get(key);
            return Number.parseInt(value || '0', 10) || 0;
        }
    } catch (error) {
        logger.warn(`monitor get counter fallback for ${metric}: ${error.message}`);
    }

    const existing = inMemoryCounters.get(key);
    if (!existing || existing.expiresAt <= Date.now()) {
        return 0;
    }

    return existing.value;
};

const canEmitAlert = async ({ metric, alertType, windowSeconds = ALERT_RATE_LIMIT_WINDOW_SECONDS }) => {
    const key = alertKey(metric, alertType);

    try {
        if (redisClient?.isOpen && typeof redisClient.set === 'function') {
            const result = await redisClient.set(key, '1', {
                NX: true,
                EX: Math.max(1, windowSeconds),
            });
            return result === 'OK';
        }
    } catch (error) {
        logger.warn(`monitor alert rate-limit fallback for ${metric}: ${error.message}`);
    }

    const now = Date.now();
    const existingExpiry = inMemoryAlertRateLimit.get(key);
    if (existingExpiry && existingExpiry > now) {
        return false;
    }

    inMemoryAlertRateLimit.set(key, now + (Math.max(1, windowSeconds) * 1000));
    return true;
};

const emitStructuredAlert = async ({
    alertType,
    metric,
    value,
    threshold,
    severity = 'warning',
    source = null,
    message = null,
    details = {},
    rateLimitWindowSeconds = ALERT_RATE_LIMIT_WINDOW_SECONDS,
}) => {
    const shouldEmit = await canEmitAlert({
        metric,
        alertType,
        windowSeconds: rateLimitWindowSeconds,
    });

    if (!shouldEmit) {
        logger.info({
            event: 'system_alert_suppressed',
            alertType,
            metric,
            reason: 'rate_limited',
            windowSeconds: rateLimitWindowSeconds,
            timestamp: new Date().toISOString(),
        });
        return null;
    }

    const resolvedSource = source || metric || alertType;
    const resolvedMessage = message || `${alertType} threshold reached`;

    const enrichedDetails = {
        ...(details && typeof details === 'object' ? details : {}),
        scalingSuggestion: details?.scalingSuggestion || resolveScalingSuggestion(metric),
    };

    logger.warn(JSON.stringify({
        event: 'system_alert',
        alertType,
        metric,
        value,
        threshold,
        severity,
        source: resolvedSource,
        message: resolvedMessage,
        details: enrichedDetails,
        timestamp: new Date().toISOString(),
    }));
    logger.warn(JSON.stringify({
        event: 'escalation_event',
        alertType,
        metric,
        severity,
        source: resolvedSource,
        suggestion: enrichedDetails.scalingSuggestion,
        timestamp: new Date().toISOString(),
    }));

    if (!hasDatabaseConnection()) {
        return null;
    }

    try {
        return await SystemAlert.create({
            alertType,
            metric,
            value,
            threshold,
            severity,
            source: resolvedSource,
            message: resolvedMessage,
            timestamp: new Date(),
            acknowledged: false,
            details: enrichedDetails,
        });
    } catch (error) {
        logger.warn(`Failed to persist system alert: ${error.message}`);
        return null;
    }
};

const evaluateThreshold = async ({
    metric,
    value,
    alertType = metric,
    severity = 'warning',
    source = null,
    message = null,
    details = {},
}) => {
    const threshold = DEFAULT_THRESHOLDS[metric];
    if (!Number.isFinite(Number(threshold))) return null;

    if (Number(value) >= Number(threshold)) {
        return emitStructuredAlert({
            alertType,
            metric,
            value: Number(value),
            threshold: Number(threshold),
            severity,
            source,
            message,
            details,
        });
    }

    return null;
};

const incrementErrorCounter = async ({ route = null, message = null }) => {
    const value = await incrementCounter({ metric: 'error_count', ttlSeconds: 300 });
    await evaluateThreshold({
        metric: 'error_count',
        value,
        alertType: 'error_spike',
        severity: 'warning',
        source: route || 'request_pipeline',
        message: message || 'Error spike detected',
        details: { route, message },
    });
    return value;
};

const incrementOtpFailureCounter = async ({ identity = null }) => {
    const value = await incrementCounter({ metric: 'otp_failure_spike', ttlSeconds: 900 });
    await evaluateThreshold({
        metric: 'otp_failure_spike',
        value,
        alertType: 'otp_abuse_spike',
        severity: 'critical',
        source: 'auth',
        message: 'OTP abuse spike detected',
        details: { identity },
    });
    return value;
};

const incrementAiFailureCounter = async ({ reason = null }) => {
    const value = await incrementCounter({ metric: 'ai_failure_spike', ttlSeconds: 300 });
    await evaluateThreshold({
        metric: 'ai_failure_spike',
        value,
        alertType: 'ai_failure_spike',
        severity: 'critical',
        source: 'ai_provider',
        message: 'AI provider failure spike detected',
        details: { reason },
    });
    return value;
};

const incrementPaymentFailureCounter = async ({ reason = null }) => {
    const value = await incrementCounter({ metric: 'payment_failure_spike', ttlSeconds: 300 });
    await evaluateThreshold({
        metric: 'payment_failure_spike',
        value,
        alertType: 'payment_failure_spike',
        severity: 'critical',
        source: 'payment_provider',
        message: 'Payment provider failure spike detected',
        details: { reason },
    });
    return value;
};

const incrementRedisFailureCounter = async ({ reason = null }) => {
    const value = await incrementCounter({ metric: 'redis_failure_count', ttlSeconds: 300 });
    await evaluateThreshold({
        metric: 'redis_failure_count',
        value,
        alertType: 'redis_failure_spike',
        severity: 'critical',
        source: 'redis',
        message: 'Redis failure spike detected',
        details: { reason },
    });
    return value;
};

const recordDbLatency = async ({ latencyMs }) => {
    await evaluateThreshold({
        metric: 'db_latency_ms',
        value: Number(latencyMs || 0),
        alertType: 'db_latency_spike',
        severity: 'warning',
        source: 'database',
        message: 'Database latency spike detected',
        details: { latencyMs: Number(latencyMs || 0) },
    });
};

const recordMemoryUsage = async ({ memoryUsagePercent }) => {
    await evaluateThreshold({
        metric: 'memory_usage_percent',
        value: Number(memoryUsagePercent || 0),
        alertType: 'memory_usage_spike',
        severity: Number(memoryUsagePercent || 0) >= Number(DEFAULT_THRESHOLDS.memory_usage_percent || 88) ? 'critical' : 'warning',
        source: 'runtime',
        message: 'Memory usage threshold reached',
        details: { memoryUsagePercent: Number(memoryUsagePercent || 0) },
    });
};

const recordApiLatency = async ({ latencyMs, route = null, method = null, statusCode = null }) => {
    await evaluateThreshold({
        metric: 'api_latency_ms',
        value: Number(latencyMs || 0),
        alertType: 'api_latency_spike',
        severity: 'warning',
        source: 'api',
        message: 'API latency threshold reached',
        details: {
            latencyMs: Number(latencyMs || 0),
            route,
            method,
            statusCode: Number(statusCode || 0),
        },
    });
};

const recordApiRequest = async ({ statusCode = 200 } = {}) => {
    const [requestCount, errorCount] = await Promise.all([
        incrementCounter({ metric: 'api_request_count', ttlSeconds: 300 }),
        Number(statusCode) >= 500
            ? incrementCounter({ metric: 'api_error_count', ttlSeconds: 300 })
            : getCounter({ metric: 'api_error_count' }),
    ]);

    const errorRatePercent = requestCount > 0
        ? Number(((Number(errorCount || 0) / requestCount) * 100).toFixed(2))
        : 0;

    await evaluateThreshold({
        metric: 'api_error_rate_percent',
        value: errorRatePercent,
        alertType: 'api_error_rate_spike',
        severity: errorRatePercent >= Number(DEFAULT_THRESHOLDS.api_error_rate_percent || 8) ? 'critical' : 'warning',
        source: 'api',
        message: 'API error rate threshold reached',
        details: {
            requestCount,
            errorCount: Number(errorCount || 0),
            errorRatePercent,
        },
    });

    return {
        requestCount,
        errorCount: Number(errorCount || 0),
        errorRatePercent,
    };
};

const recordQueueBacklog = async ({ queueDepth }) => {
    await evaluateThreshold({
        metric: 'queue_backlog_spike',
        value: Number(queueDepth || 0),
        alertType: 'queue_backlog_spike',
        severity: 'critical',
        source: 'queue',
        message: 'Queue backlog spike detected',
        details: { queueDepth: Number(queueDepth || 0) },
    });
};

const getMonitoringSnapshot = async () => {
    const [errorCount, otpFailures, aiFailures, redisFailures, paymentFailures, apiRequestCount, apiErrorCount] = await Promise.all([
        getCounter({ metric: 'error_count' }),
        getCounter({ metric: 'otp_failure_spike' }),
        getCounter({ metric: 'ai_failure_spike' }),
        getCounter({ metric: 'redis_failure_count' }),
        getCounter({ metric: 'payment_failure_spike' }),
        getCounter({ metric: 'api_request_count' }),
        getCounter({ metric: 'api_error_count' }),
    ]);

    const apiErrorRatePercent = apiRequestCount > 0
        ? Number(((Number(apiErrorCount || 0) / apiRequestCount) * 100).toFixed(2))
        : 0;

    return {
        errorCount,
        otpFailures,
        aiFailures,
        redisFailures,
        paymentFailures,
        apiRequestCount,
        apiErrorCount,
        apiErrorRatePercent,
        thresholds: DEFAULT_THRESHOLDS,
    };
};

const acknowledgeSystemAlert = async (alertId) => {
    if (!alertId) return null;
    return SystemAlert.findByIdAndUpdate(
        alertId,
        {
            $set: {
                acknowledged: true,
                acknowledgedAt: new Date(),
            },
        },
        { new: true }
    );
};

module.exports = {
    incrementErrorCounter,
    incrementOtpFailureCounter,
    incrementAiFailureCounter,
    incrementPaymentFailureCounter,
    incrementRedisFailureCounter,
    recordDbLatency,
    recordMemoryUsage,
    recordApiLatency,
    recordApiRequest,
    recordQueueBacklog,
    emitStructuredAlert,
    getMonitoringSnapshot,
    acknowledgeSystemAlert,
    DEFAULT_THRESHOLDS,
};
