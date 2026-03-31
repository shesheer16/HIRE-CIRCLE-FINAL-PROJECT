const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const logger = require('../utils/logger');
const { emitStructuredAlert } = require('./systemMonitoringService');
const { recordMemoryUsage } = require('./systemMonitoringService');
const { setDegradationFlag } = require('./degradationService');
const { updateResilienceState } = require('./resilienceStateService');

const WATCHDOG_INTERVAL_MS = Number.parseInt(process.env.RESOURCE_WATCHDOG_INTERVAL_MS || '5000', 10);
const MEMORY_WARN_PERCENT = Number.parseInt(process.env.MEMORY_WARN_PERCENT || '82', 10);
const MEMORY_CRITICAL_PERCENT = Number.parseInt(process.env.MEMORY_CRITICAL_PERCENT || '90', 10);
const MEMORY_SHUTDOWN_PERCENT = Number.parseInt(process.env.MEMORY_SHUTDOWN_PERCENT || '95', 10);
const CPU_WARN_PERCENT = Number.parseInt(process.env.CPU_WARN_PERCENT || '80', 10);
const EVENT_LOOP_WARN_MS = Number.parseInt(process.env.EVENT_LOOP_WARN_MS || '120', 10);
const EVENT_LOOP_CRITICAL_MS = Number.parseInt(process.env.EVENT_LOOP_CRITICAL_MS || '250', 10);

let watchdogTimer = null;
let eventLoopMonitor = null;
let previousCpuUsage = process.cpuUsage();
let previousSampleAt = process.hrtime.bigint();

const toPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));

const readCpuUsagePercent = () => {
    const now = process.hrtime.bigint();
    const diffNs = Number(now - previousSampleAt);
    previousSampleAt = now;

    const current = process.cpuUsage();
    const userDiff = current.user - previousCpuUsage.user;
    const systemDiff = current.system - previousCpuUsage.system;
    previousCpuUsage = current;

    if (diffNs <= 0) return 0;

    const processCpuUs = userDiff + systemDiff;
    const elapsedUs = diffNs / 1000;
    const cores = Math.max(1, os.cpus().length);

    return toPercent((processCpuUs / (elapsedUs * cores)) * 100);
};

const readMemoryUsagePercent = () => {
    const rss = Number(process.memoryUsage().rss || 0);
    const total = Number(os.totalmem() || 1);
    return toPercent((rss / total) * 100);
};

const readEventLoopDelayMs = () => {
    if (!eventLoopMonitor) return 0;
    const meanNs = Number(eventLoopMonitor.mean || 0);
    const meanMs = meanNs / 1_000_000;
    eventLoopMonitor.reset();
    return Number.isFinite(meanMs) ? Number(meanMs.toFixed(2)) : 0;
};

const createStructuredEvent = (level, payload) => {
    const data = {
        event: 'resource_watchdog',
        ...payload,
        timestamp: new Date().toISOString(),
    };

    if (level === 'error') {
        logger.error(data);
        return;
    }

    if (level === 'warn') {
        logger.warn(data);
        return;
    }

    logger.info(data);
};

const evaluateThresholds = async ({
    cpuUsagePercent,
    memoryUsagePercent,
    eventLoopDelayMs,
    requestGracefulShutdown,
}) => {
    updateResilienceState({
        cpuUsagePercent,
        memoryUsagePercent,
        eventLoopDelayMs,
    });

    const highCpu = cpuUsagePercent >= CPU_WARN_PERCENT;
    const highMemory = memoryUsagePercent >= MEMORY_WARN_PERCENT;
    const highEventLoop = eventLoopDelayMs >= EVENT_LOOP_WARN_MS;

    const adaptiveMode = highCpu || highMemory || highEventLoop;
    setDegradationFlag('adaptiveRateLimitingEnabled', adaptiveMode, adaptiveMode ? 'resource_pressure' : null);
    await recordMemoryUsage({ memoryUsagePercent });

    if (highCpu) {
        await emitStructuredAlert({
            alertType: 'cpu_usage_spike',
            metric: 'cpu_usage_percent',
            value: cpuUsagePercent,
            threshold: CPU_WARN_PERCENT,
            severity: 'warning',
            source: 'watchdog',
            message: 'CPU usage crossed warning threshold',
            details: { cpuUsagePercent },
        });
    }

    if (highMemory) {
        await emitStructuredAlert({
            alertType: 'memory_usage_spike',
            metric: 'memory_usage_percent',
            value: memoryUsagePercent,
            threshold: MEMORY_WARN_PERCENT,
            severity: memoryUsagePercent >= MEMORY_CRITICAL_PERCENT ? 'critical' : 'warning',
            source: 'watchdog',
            message: 'Memory usage crossed warning threshold',
            details: { memoryUsagePercent },
        });
    }

    if (highEventLoop) {
        await emitStructuredAlert({
            alertType: 'event_loop_delay_spike',
            metric: 'event_loop_delay_ms',
            value: eventLoopDelayMs,
            threshold: EVENT_LOOP_WARN_MS,
            severity: eventLoopDelayMs >= EVENT_LOOP_CRITICAL_MS ? 'critical' : 'warning',
            source: 'watchdog',
            message: 'Event loop delay crossed warning threshold',
            details: { eventLoopDelayMs },
        });
    }

    if (memoryUsagePercent >= MEMORY_CRITICAL_PERCENT) {
        setDegradationFlag('smartInterviewPaused', true, 'memory_pressure');
        setDegradationFlag('heavyAnalyticsPaused', true, 'memory_pressure');
    }

    if (memoryUsagePercent >= MEMORY_SHUTDOWN_PERCENT && typeof requestGracefulShutdown === 'function') {
        createStructuredEvent('warn', {
            action: 'graceful_shutdown_triggered',
            reason: 'memory_exhaustion_prevented',
            memoryUsagePercent,
            threshold: MEMORY_SHUTDOWN_PERCENT,
        });
        requestGracefulShutdown('memory_threshold_exceeded');
    }
};

const startResourceWatchdog = ({ requestGracefulShutdown = null } = {}) => {
    if (watchdogTimer) return;

    eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
    eventLoopMonitor.enable();

    watchdogTimer = setInterval(() => {
        const cpuUsagePercent = readCpuUsagePercent();
        const memoryUsagePercent = readMemoryUsagePercent();
        const eventLoopDelayMs = readEventLoopDelayMs();

        createStructuredEvent('info', {
            action: 'sample',
            cpuUsagePercent,
            memoryUsagePercent,
            eventLoopDelayMs,
        });

        void evaluateThresholds({
            cpuUsagePercent,
            memoryUsagePercent,
            eventLoopDelayMs,
            requestGracefulShutdown,
        }).catch((error) => {
            createStructuredEvent('warn', {
                action: 'evaluate_failed',
                message: error.message,
            });
        });
    }, Math.max(1000, WATCHDOG_INTERVAL_MS));

    if (typeof watchdogTimer.unref === 'function') {
        watchdogTimer.unref();
    }
};

const stopResourceWatchdog = () => {
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }

    if (eventLoopMonitor) {
        eventLoopMonitor.disable();
        eventLoopMonitor = null;
    }
};

module.exports = {
    startResourceWatchdog,
    stopResourceWatchdog,
    __test__: {
        evaluateThresholds,
    },
};
