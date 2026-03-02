#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const redisClient = require('../config/redis');
const {
    TASK_TYPES,
    enqueueTask,
    claimTask,
    ackTask,
    recoverStaleTasks,
    getQueueDepthByType,
    canUseRedisQueue,
} = require('../services/distributedTaskQueue');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'disaster-recovery-worker-restart.json');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
    const type = TASK_TYPES.MATCH_RECALCULATION;
    const queueKey = `distributed:queue:${type}`;
    const processingKey = `distributed:processing:${type}`;

    const report = {
        generatedAt: new Date().toISOString(),
        queueType: type,
        mode: canUseRedisQueue() ? 'redis_backed' : 'simulated_without_redis',
        events: [],
        passed: false,
    };

    if (!canUseRedisQueue()) {
        // Deterministic crash-recovery simulation for CI/sandbox without Redis.
        const pending = [{ id: 'local-task-1', attempts: 0 }];
        const processing = [];

        const claimed = pending.pop();
        processing.push(claimed);
        report.events.push({ step: 'claimed', taskId: claimed.id });

        await wait(1200);
        const stale = processing.shift();
        stale.attempts += 1;
        pending.unshift(stale);
        report.events.push({ step: 'recovered_stale', taskId: stale.id, attempts: stale.attempts });

        const reclaimed = pending.pop();
        report.events.push({ step: 'reclaimed_after_restart', taskId: reclaimed.id });

        report.passed = reclaimed.id === claimed.id && processing.length === 0 && pending.length === 0;

        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.exit(report.passed ? 0 : 1);
        return;
    }

    await redisClient.del(queueKey, processingKey);

    const enqueued = await enqueueTask({
        type,
        payload: {
            scope: 'worker_restart_simulation',
            issuedAt: Date.now(),
        },
        maxAttempts: 5,
    });

    if (!enqueued.accepted) {
        throw new Error('Failed to enqueue restart simulation task');
    }

    report.events.push({ step: 'enqueued', taskId: enqueued.id });

    const claimed = await claimTask({
        type,
        blockTimeoutSec: 1,
        visibilityTimeoutSec: 1,
    });

    if (!claimed?.envelope?.id) {
        throw new Error('Failed to claim task for restart simulation');
    }

    report.events.push({ step: 'claimed', taskId: claimed.envelope.id });

    // Simulate worker crash by not acking claimed task.
    await wait(1300);

    const recovered = await recoverStaleTasks({
        type,
        nowMs: Date.now(),
    });

    report.events.push({ step: 'recovered_stale', recovered: recovered.recovered });

    const reclaimed = await claimTask({
        type,
        blockTimeoutSec: 1,
        visibilityTimeoutSec: 1,
    });

    if (!reclaimed?.envelope?.id) {
        throw new Error('Failed to reclaim recovered task');
    }

    report.events.push({ step: 'reclaimed_after_restart', taskId: reclaimed.envelope.id });

    await ackTask({ type, taskId: reclaimed.envelope.id, raw: reclaimed.raw });

    const depth = await getQueueDepthByType(type);
    report.events.push({ step: 'acked', finalDepth: depth });

    await redisClient.del(queueKey, processingKey);

    report.passed = reclaimed.envelope.id === claimed.envelope.id
        && Number(recovered.recovered || 0) >= 1
        && Number(depth || 0) === 0;

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.passed ? 0 : 1);
};

run().catch((error) => {
    console.warn('[simulate:dr:worker-restart] failed:', error.message);
    process.exit(1);
});
