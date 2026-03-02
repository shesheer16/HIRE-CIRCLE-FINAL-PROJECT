const mongoose = require('mongoose');

const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { setManyDegradationFlags } = require('./degradationService');

const SHUTDOWN_DRAIN_TIMEOUT_MS = Number.parseInt(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || String(30 * 1000), 10);
const isTestRuntime = String(process.env.NODE_ENV || '').toLowerCase() === 'test';

let serverRef = null;
let shuttingDown = false;
let activeRequests = 0;
let forceExitTimer = null;
let extraClientsRef = [];
let onBeforeCloseHook = null;
let safeguardsInstalled = false;

const getActiveRequestCount = () => activeRequests;
const isShuttingDown = () => shuttingDown;

const requestTrackingMiddleware = (req, res, next) => {
    if (shuttingDown) {
        res.setHeader('connection', 'close');
        return res.status(503).json({
            success: false,
            message: 'Server is restarting. Please retry shortly.',
        });
    }

    activeRequests += 1;

    const finalize = () => {
        activeRequests = Math.max(0, activeRequests - 1);
        res.removeListener('finish', finalize);
        res.removeListener('close', finalize);
    };

    res.on('finish', finalize);
    res.on('close', finalize);

    return next();
};

const requestDrainMiddleware = requestTrackingMiddleware;

const closeDependencies = async () => {
    try {
        if (typeof onBeforeCloseHook === 'function') {
            await onBeforeCloseHook();
        }
    } catch (error) {
        logger.warn({ event: 'graceful_shutdown_before_close_hook_failed', message: error.message });
    }

    try {
        if (redisClient && typeof redisClient.quit === 'function') {
            await redisClient.quit();
        }
    } catch (error) {
        logger.warn({ event: 'graceful_shutdown_redis_close_failed', message: error.message });
    }

    if (Array.isArray(extraClientsRef)) {
        for (const client of extraClientsRef) {
            if (!client) continue;
            try {
                if (typeof client.quit === 'function') {
                    await client.quit();
                    continue;
                }
                if (typeof client.disconnect === 'function') {
                    await client.disconnect();
                }
            } catch (error) {
                logger.warn({ event: 'graceful_shutdown_extra_client_close_failed', message: error.message });
            }
        }
    }

    try {
        if (mongoose.connection.readyState === 1) {
            await mongoose.connection.close();
        }
    } catch (error) {
        logger.warn({ event: 'graceful_shutdown_mongo_close_failed', message: error.message });
    }
};

const requestGracefulShutdown = async (reason = 'unknown') => {
    if (shuttingDown) return;
    shuttingDown = true;

    setManyDegradationFlags({
        queuePaused: true,
        smartInterviewPaused: true,
        heavyAnalyticsPaused: true,
        paymentWriteBlocked: true,
        adaptiveRateLimitingEnabled: true,
    }, `graceful_shutdown:${reason}`);

    logger.warn({
        event: 'graceful_shutdown_initiated',
        reason,
        activeRequests,
        timestamp: new Date().toISOString(),
    });

    if (forceExitTimer) {
        clearTimeout(forceExitTimer);
        forceExitTimer = null;
    }

    forceExitTimer = setTimeout(() => {
        logger.error({
            event: 'graceful_shutdown_forced_exit',
            reason,
            activeRequests,
            timeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS,
        });
        if (!isTestRuntime) {
            process.exit(1);
        }
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);

    try {
        if (serverRef) {
            await new Promise((resolve) => {
                serverRef.close(() => resolve());
            });
        }

        const waitStart = Date.now();
        while (activeRequests > 0 && (Date.now() - waitStart) < SHUTDOWN_DRAIN_TIMEOUT_MS) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        await closeDependencies();
        logger.info({
            event: 'graceful_shutdown_completed',
            reason,
            remainingRequests: activeRequests,
        });

        if (!isTestRuntime) {
            process.exit(0);
        }
    } catch (error) {
        logger.error({
            event: 'graceful_shutdown_failed',
            reason,
            message: error.message,
        });
        if (!isTestRuntime) {
            process.exit(1);
        }
    } finally {
        if (forceExitTimer) {
            clearTimeout(forceExitTimer);
            forceExitTimer = null;
        }
    }
};

const installProcessSafeguards = ({ server }) => {
    serverRef = server;
    if (safeguardsInstalled) return;
    safeguardsInstalled = true;

    process.on('uncaughtException', (error) => {
        logger.error({
            event: 'uncaught_exception',
            message: error?.message || String(error),
            stack: error?.stack || null,
        });
        void requestGracefulShutdown('uncaught_exception');
    });

    process.on('unhandledRejection', (reason) => {
        logger.error({
            event: 'unhandled_promise_rejection',
            message: reason?.message || String(reason),
            stack: reason?.stack || null,
        });
        void requestGracefulShutdown('unhandled_promise_rejection');
    });

    process.on('SIGTERM', () => {
        void requestGracefulShutdown('sigterm');
    });

    process.on('SIGINT', () => {
        void requestGracefulShutdown('sigint');
    });
};

const registerGracefulShutdown = ({ server, extraClients = [], onBeforeClose = null }) => {
    if (Array.isArray(extraClients)) {
        extraClientsRef = extraClients.filter(Boolean);
    }
    if (typeof onBeforeClose === 'function') {
        onBeforeCloseHook = onBeforeClose;
    }
    installProcessSafeguards({ server });
};

const getInFlightRequestCount = () => getActiveRequestCount();

module.exports = {
    requestDrainMiddleware,
    requestTrackingMiddleware,
    installProcessSafeguards,
    registerGracefulShutdown,
    requestGracefulShutdown,
    getActiveRequestCount,
    getInFlightRequestCount,
    isShuttingDown,
};
