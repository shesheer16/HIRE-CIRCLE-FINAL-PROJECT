require('dotenv').config();

const connectDB = require('../config/db');
const logger = require('../utils/logger');
const {
    TASK_TYPES,
    canUseRedisQueue,
    claimTask,
    ackTask,
    nackTask,
    recoverStaleTasks,
} = require('../services/distributedTaskQueue');
const {
    runNotificationDispatchTask,
    runEmailDispatchTask,
    runTrustScoreRecalculationTask,
    runMetricsAggregationTask,
    runHeavyAnalyticsQueryTask,
    runMatchRecalculationTask,
    runSmartInterviewAiTask,
} = require('../services/distributedTaskHandlers');

const POLL_TIMEOUT_SEC = Number.parseInt(process.env.DISTRIBUTED_TASK_POP_TIMEOUT_SEC || '2', 10);
const VISIBILITY_TIMEOUT_SEC = Number.parseInt(process.env.DISTRIBUTED_TASK_VISIBILITY_TIMEOUT_SEC || '90', 10);
const RECOVERY_INTERVAL_MS = Number.parseInt(process.env.DISTRIBUTED_TASK_RECOVERY_INTERVAL_MS || String(60 * 1000), 10);

let shuttingDown = false;
let inFlightTasks = 0;
let lastRecoveryRunAt = 0;

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const taskHandlers = {
    [TASK_TYPES.SMART_INTERVIEW_AI]: runSmartInterviewAiTask,
    [TASK_TYPES.MATCH_RECALCULATION]: runMatchRecalculationTask,
    [TASK_TYPES.NOTIFICATION_DISPATCH]: runNotificationDispatchTask,
    [TASK_TYPES.EMAIL_DISPATCH]: runEmailDispatchTask,
    [TASK_TYPES.TRUST_SCORE_RECALCULATION]: runTrustScoreRecalculationTask,
    [TASK_TYPES.METRICS_AGGREGATION]: runMetricsAggregationTask,
    [TASK_TYPES.HEAVY_ANALYTICS_QUERY]: runHeavyAnalyticsQueryTask,
};

const maybeRecoverStaleTasks = async () => {
    const now = Date.now();
    if ((now - lastRecoveryRunAt) < RECOVERY_INTERVAL_MS) return;
    lastRecoveryRunAt = now;

    await Promise.all(
        Object.values(TASK_TYPES).map(async (type) => {
            const { recovered } = await recoverStaleTasks({ type, nowMs: now });
            if (recovered > 0) {
                logger.warn({
                    event: 'distributed_worker_recovered_stale_tasks',
                    taskType: type,
                    recovered,
                });
            }
        })
    );
};

const processOneTask = async (type) => {
    const claimed = await claimTask({
        type,
        blockTimeoutSec: POLL_TIMEOUT_SEC,
        visibilityTimeoutSec: VISIBILITY_TIMEOUT_SEC,
    });

    if (!claimed) return false;

    const { envelope, raw } = claimed;
    const handler = taskHandlers[type];
    if (typeof handler !== 'function') {
        await ackTask({ type, taskId: envelope?.id, raw });
        return true;
    }

    inFlightTasks += 1;
    try {
        await handler(envelope.payload || {});
        await ackTask({ type, taskId: envelope.id, raw });
    } catch (error) {
        logger.warn({
            event: 'distributed_worker_task_failed',
            taskType: type,
            taskId: envelope?.id,
            message: error.message,
        });
        await nackTask({
            type,
            envelope,
            raw,
            reason: error.message,
        });
    } finally {
        inFlightTasks = Math.max(0, inFlightTasks - 1);
    }

    return true;
};

const runLoop = async () => {
    logger.info({ event: 'distributed_worker_started' });
    const taskTypes = Object.values(TASK_TYPES);
    let cursor = 0;

    while (!shuttingDown) {
        await maybeRecoverStaleTasks();

        const type = taskTypes[cursor % taskTypes.length];
        cursor += 1;
        const processed = await processOneTask(type);
        if (!processed) {
            await waitFor(100);
        }
    }

    while (inFlightTasks > 0) {
        await waitFor(50);
    }
    logger.info({ event: 'distributed_worker_stopped' });
};

const bootstrap = async () => {
    await connectDB();

    if (!canUseRedisQueue()) {
        logger.error({
            event: 'distributed_worker_redis_unavailable',
            message: 'Distributed task queue requires Redis',
        });
        process.exit(1);
    }

    await runLoop();
};

process.on('SIGTERM', () => {
    shuttingDown = true;
});
process.on('SIGINT', () => {
    shuttingDown = true;
});

bootstrap().catch((error) => {
    logger.error({
        event: 'distributed_worker_bootstrap_failed',
        message: error.message,
    });
    process.exit(1);
});
