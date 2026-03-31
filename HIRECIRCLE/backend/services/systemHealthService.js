const mongoose = require('mongoose');

const redisClient = require('../config/redis');
const SystemHealth = require('../models/SystemHealth');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const logger = require('../utils/logger');
const {
    getInterviewQueueDepth,
    isQueueConfigured,
} = require('./sqsInterviewQueue');
const { getRuntimeSystemMetrics } = require('./runtimeMetricsService');
const { getMonitoringSnapshot, recordQueueBacklog, emitStructuredAlert } = require('./systemMonitoringService');
const { executeWithCircuitBreaker, getAllCircuitStates } = require('./circuitBreakerService');
const { getDegradationState, setDegradationFlag } = require('./degradationService');
const { updateResilienceState, getResilienceState } = require('./resilienceStateService');
const { guardedGeminiGenerateText } = require('./aiGuardrailService');

const HEALTH_CHECK_INTERVAL_MS = Number.parseInt(process.env.SYSTEM_HEALTH_CHECK_INTERVAL_MS || String(30 * 1000), 10);
const QUEUE_BACKPRESSURE_DEPTH = Number.parseInt(process.env.QUEUE_BACKPRESSURE_DEPTH || '1500', 10);
const QUEUE_CRITICAL_DEPTH = Number.parseInt(process.env.QUEUE_CRITICAL_DEPTH || '2500', 10);
const PROVIDER_HEALTHCHECK_TIMEOUT_MS = Number.parseInt(process.env.PROVIDER_HEALTHCHECK_TIMEOUT_MS || '3000', 10);

let monitorTimer = null;
let latestSnapshot = null;
let isRunning = false;

const nowIso = () => new Date().toISOString();

const toStatus = ({ ok, degraded = false, critical = false }) => {
    if (!ok || critical) return 'critical';
    if (degraded) return 'degraded';
    return 'healthy';
};

const persistHealth = async (record) => {
    const payload = {
        serviceName: record.serviceName,
        status: record.status,
        latency: record.latency,
        errorRate: record.errorRate,
        lastCheckedAt: new Date(record.lastCheckedAt),
        details: record.details || {},
    };

    try {
        await SystemHealth.updateOne(
            { serviceName: payload.serviceName },
            { $set: payload },
            { upsert: true }
        );
    } catch (error) {
        logger.warn({
            event: 'system_health_persist_failed',
            serviceName: payload.serviceName,
            message: error.message,
        });
    }
};

const buildRecord = ({ serviceName, status, latency, errorRate = 0, details = {} }) => ({
    serviceName,
    status,
    latency: Number.isFinite(Number(latency)) ? Number(latency) : 0,
    errorRate: Number.isFinite(Number(errorRate)) ? Number(errorRate) : 0,
    lastCheckedAt: nowIso(),
    details,
});

const isAiHealthcheckDisabled = () => {
    const runtime = String(process.env.NODE_ENV || '').toLowerCase();
    const defaultValue = runtime === 'production' ? 'false' : 'true';
    const normalized = String(process.env.AI_HEALTHCHECK_DISABLED || defaultValue).toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const checkDbHealth = async () => {
    const startedAt = Date.now();

    try {
        const connection = mongoose.connection;
        const readyState = Number(connection?.readyState || 0);
        if (!connection || readyState !== 1) {
            return buildRecord({
                serviceName: 'db_connectivity',
                status: 'critical',
                latency: Date.now() - startedAt,
                errorRate: 1,
                details: {
                    readyState,
                    message: 'MongoDB connection is not ready',
                },
            });
        }

        await connection.db.admin().command({ ping: 1 });
        const latency = Date.now() - startedAt;

        return buildRecord({
            serviceName: 'db_connectivity',
            status: latency > Number.parseInt(process.env.DB_HEALTH_DEGRADED_LATENCY_MS || '300', 10)
                ? 'degraded'
                : 'healthy',
            latency,
            details: {
                readyState,
                host: connection.host,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'db_connectivity',
            status: 'critical',
            latency: Date.now() - startedAt,
            errorRate: 1,
            details: {
                message: error.message,
            },
        });
    }
};

const checkRedisHealth = async () => {
    const startedAt = Date.now();

    try {
        const pong = await redisClient.get('__system_health_ping__');
        const latency = Date.now() - startedAt;
        const open = Boolean(redisClient?.isOpen);

        return buildRecord({
            serviceName: 'redis_connectivity',
            status: toStatus({
                ok: open,
                degraded: open && latency > Number.parseInt(process.env.REDIS_HEALTH_DEGRADED_LATENCY_MS || '150', 10),
                critical: !open,
            }),
            latency,
            errorRate: open ? 0 : 1,
            details: {
                isOpen: open,
                pingValue: pong,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'redis_connectivity',
            status: 'critical',
            latency: Date.now() - startedAt,
            errorRate: 1,
            details: {
                message: error.message,
            },
        });
    }
};

const checkQueueWorkersHealth = async () => {
    const startedAt = Date.now();

    try {
        const [queueDepth, staleCount, failedRecentCount] = await Promise.all([
            isQueueConfigured() ? getInterviewQueueDepth() : 0,
            InterviewProcessingJob.countDocuments({
                status: 'processing',
                startedAt: { $lt: new Date(Date.now() - (Number.parseInt(process.env.INTERVIEW_PROCESSING_STALE_MINUTES || '15', 10) * 60 * 1000)) },
            }),
            InterviewProcessingJob.countDocuments({
                status: 'failed',
                updatedAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
            }),
        ]);

        const latency = Date.now() - startedAt;
        await recordQueueBacklog({ queueDepth });

        const status = queueDepth >= QUEUE_CRITICAL_DEPTH || staleCount > 0
            ? 'critical'
            : queueDepth >= QUEUE_BACKPRESSURE_DEPTH || failedRecentCount > 25
                ? 'degraded'
                : 'healthy';

        updateResilienceState({
            queueDepth,
            queueBackpressureActive: queueDepth >= QUEUE_BACKPRESSURE_DEPTH,
            workerHealthy: status !== 'critical',
        });

        return buildRecord({
            serviceName: 'queue_workers',
            status,
            latency,
            errorRate: Number((failedRecentCount / Math.max(1, queueDepth + failedRecentCount)).toFixed(4)),
            details: {
                queueConfigured: isQueueConfigured(),
                queueDepth,
                staleCount,
                failedRecentCount,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'queue_workers',
            status: 'critical',
            latency: Date.now() - startedAt,
            errorRate: 1,
            details: {
                message: error.message,
            },
        });
    }
};

const checkSocketLayerHealth = async (io = null) => {
    const startedAt = Date.now();

    try {
        const runtimeMetrics = await getRuntimeSystemMetrics();
        const socketConnections = io?.engine?.clientsCount || runtimeMetrics.activeConnections || 0;
        updateResilienceState({ socketConnections });

        return buildRecord({
            serviceName: 'socket_layer',
            status: 'healthy',
            latency: Date.now() - startedAt,
            details: {
                socketConnections,
                activeUsers: runtimeMetrics.activeUsers,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'socket_layer',
            status: 'degraded',
            latency: Date.now() - startedAt,
            errorRate: 0.5,
            details: {
                message: error.message,
            },
        });
    }
};

const checkPaymentProviderHealth = async () => {
    const startedAt = Date.now();
    const stripeKey = String(process.env.STRIPE_SECRET_KEY || '').trim();

    if (!stripeKey) {
        return buildRecord({
            serviceName: 'payment_provider_connectivity',
            status: 'degraded',
            latency: 0,
            errorRate: 0,
            details: {
                configured: false,
                message: 'Stripe key missing',
            },
        });
    }

    try {
        const result = await executeWithCircuitBreaker(
            'payment_provider',
            async () => {
                const stripe = require('stripe')(stripeKey, { timeout: PROVIDER_HEALTHCHECK_TIMEOUT_MS });
                const account = await stripe.accounts.retrieve();
                return { accountId: account?.id || null };
            },
            {
                failureThreshold: Number.parseInt(process.env.PAYMENT_CIRCUIT_FAILURE_THRESHOLD || '4', 10),
                cooldownMs: Number.parseInt(process.env.PAYMENT_CIRCUIT_COOLDOWN_MS || String(45 * 1000), 10),
                timeoutMs: PROVIDER_HEALTHCHECK_TIMEOUT_MS,
            }
        );

        return buildRecord({
            serviceName: 'payment_provider_connectivity',
            status: 'healthy',
            latency: Date.now() - startedAt,
            details: {
                configured: true,
                accountId: result?.accountId || null,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'payment_provider_connectivity',
            status: 'critical',
            latency: Date.now() - startedAt,
            errorRate: 1,
            details: {
                configured: true,
                message: error.message,
            },
        });
    }
};

const checkAiProviderHealth = async () => {
    const startedAt = Date.now();
    if (isAiHealthcheckDisabled()) {
        return buildRecord({
            serviceName: 'ai_provider_connectivity',
            status: 'degraded',
            latency: 0,
            errorRate: 0,
            details: {
                configured: true,
                skipped: true,
                message: 'AI provider healthcheck disabled',
            },
        });
    }
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        return buildRecord({
            serviceName: 'ai_provider_connectivity',
            status: 'degraded',
            latency: 0,
            errorRate: 0,
            details: {
                configured: false,
                message: 'GEMINI_API_KEY missing',
            },
        });
    }

    try {
        await executeWithCircuitBreaker(
            'ai_provider',
            async () => {
                const model = String(
                    process.env.AI_HEALTHCHECK_MODEL
                    || process.env.SMART_INTERVIEW_GEMINI_MODEL
                    || process.env.AI_DEFAULT_MODEL
                    || 'gemini-2.0-flash'
                );
                await guardedGeminiGenerateText({
                    prompt: 'Respond with: ok',
                    model,
                    rateLimitKey: 'ai_healthcheck',
                    maxOutputTokens: 4,
                    temperature: 0,
                    timeoutMs: PROVIDER_HEALTHCHECK_TIMEOUT_MS,
                    allowPii: true,
                });
            },
            {
                failureThreshold: Number.parseInt(process.env.AI_CIRCUIT_FAILURE_THRESHOLD || '4', 10),
                cooldownMs: Number.parseInt(process.env.AI_CIRCUIT_COOLDOWN_MS || String(45 * 1000), 10),
                timeoutMs: PROVIDER_HEALTHCHECK_TIMEOUT_MS,
            }
        );

        return buildRecord({
            serviceName: 'ai_provider_connectivity',
            status: 'healthy',
            latency: Date.now() - startedAt,
            details: {
                configured: true,
            },
        });
    } catch (error) {
        return buildRecord({
            serviceName: 'ai_provider_connectivity',
            status: 'critical',
            latency: Date.now() - startedAt,
            errorRate: 1,
            details: {
                configured: true,
                message: error.message,
            },
        });
    }
};

const applyDegradationPolicy = async (records = []) => {
    const index = Object.fromEntries(records.map((record) => [record.serviceName, record]));

    const aiCritical = index.ai_provider_connectivity?.status === 'critical';
    const redisUnhealthy = ['degraded', 'critical'].includes(index.redis_connectivity?.status);
    const paymentCritical = index.payment_provider_connectivity?.status === 'critical';

    const queueRecord = index.queue_workers;
    const queueDepth = Number(queueRecord?.details?.queueDepth || 0);
    const queueConfigured = Boolean(queueRecord?.details?.queueConfigured);
    // Only enforce queue backpressure when actual backlog exists.
    const queueBackpressure = queueConfigured
        && (
            queueDepth >= QUEUE_BACKPRESSURE_DEPTH
            || (queueRecord?.status === 'critical' && queueDepth > 0)
        );

    setDegradationFlag('aiManualFallbackEnabled', aiCritical, aiCritical ? 'ai_provider_unhealthy' : null);
    setDegradationFlag('redisMinimalMode', redisUnhealthy, redisUnhealthy ? 'redis_unhealthy' : null);
    setDegradationFlag('paymentWriteBlocked', paymentCritical, paymentCritical ? 'payment_provider_unhealthy' : null);
    setDegradationFlag('queuePaused', queueBackpressure, queueBackpressure ? 'queue_backpressure' : null);
    setDegradationFlag('smartInterviewPaused', queueBackpressure, queueBackpressure ? 'queue_backpressure' : null);
    setDegradationFlag('heavyAnalyticsPaused', queueBackpressure, queueBackpressure ? 'queue_backpressure' : null);

    if (queueBackpressure) {
        await emitStructuredAlert({
            alertType: 'queue_backpressure_mode_enabled',
            metric: 'queue_backlog_spike',
            value: queueDepth,
            threshold: QUEUE_BACKPRESSURE_DEPTH,
            severity: 'critical',
            source: 'queue',
            message: 'Backpressure mode enabled due to queue depth',
            details: {
                queueDepth,
                queueStatus: queueRecord?.status || 'unknown',
            },
        });
    }
};

const runHealthChecks = async ({ io = null } = {}) => {
    if (isRunning) {
        return latestSnapshot;
    }

    isRunning = true;

    try {
        const [db, redis, queueWorkers, socketLayer, paymentProvider, aiProvider, monitoring] = await Promise.all([
            checkDbHealth(),
            checkRedisHealth(),
            checkQueueWorkersHealth(),
            checkSocketLayerHealth(io),
            checkPaymentProviderHealth(),
            checkAiProviderHealth(),
            getMonitoringSnapshot(),
        ]);

        const records = [db, redis, queueWorkers, socketLayer, paymentProvider, aiProvider];

        await Promise.all(records.map((record) => persistHealth(record)));
        await applyDegradationPolicy(records);

        const criticalCount = records.filter((row) => row.status === 'critical').length;
        const degradedCount = records.filter((row) => row.status === 'degraded').length;

        const overallStatus = criticalCount > 0
            ? 'critical'
            : degradedCount > 0
                ? 'degraded'
                : 'healthy';

        latestSnapshot = {
            status: overallStatus,
            generatedAt: nowIso(),
            services: records,
            monitoring,
            degradation: getDegradationState(),
            circuitBreakers: getAllCircuitStates(),
            resilience: getResilienceState(),
            summary: {
                total: records.length,
                healthy: records.filter((row) => row.status === 'healthy').length,
                degraded: degradedCount,
                critical: criticalCount,
            },
        };

        return latestSnapshot;
    } finally {
        isRunning = false;
    }
};

const getExtendedHealthSnapshot = async ({ io = null, force = false } = {}) => {
    if (!force && latestSnapshot) {
        const staleMs = Number.parseInt(process.env.SYSTEM_HEALTH_CACHE_MS || '5000', 10);
        const age = Date.now() - new Date(latestSnapshot.generatedAt).getTime();
        if (age <= staleMs) {
            return latestSnapshot;
        }
    }

    return runHealthChecks({ io });
};

const startSystemHealthMonitoring = ({ io = null } = {}) => {
    if (monitorTimer) {
        return;
    }

    monitorTimer = setInterval(() => {
        void runHealthChecks({ io }).catch((error) => {
            logger.warn({
                event: 'system_health_monitor_failed',
                message: error.message,
            });
        });
    }, Math.max(5000, HEALTH_CHECK_INTERVAL_MS));

    if (typeof monitorTimer.unref === 'function') {
        monitorTimer.unref();
    }

    void runHealthChecks({ io }).catch((error) => {
        logger.warn({
            event: 'system_health_initial_run_failed',
            message: error.message,
        });
    });
};

const stopSystemHealthMonitoring = () => {
    if (!monitorTimer) return;
    clearInterval(monitorTimer);
    monitorTimer = null;
};

module.exports = {
    runHealthChecks,
    getExtendedHealthSnapshot,
    startSystemHealthMonitoring,
    stopSystemHealthMonitoring,
};
