const crypto = require('crypto');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');

const TASK_TYPES = Object.freeze({
    SMART_INTERVIEW_AI: 'SMART_INTERVIEW_AI',
    MATCH_RECALCULATION: 'MATCH_RECALCULATION',
    NOTIFICATION_DISPATCH: 'NOTIFICATION_DISPATCH',
    EMAIL_DISPATCH: 'EMAIL_DISPATCH',
    TRUST_SCORE_RECALCULATION: 'TRUST_SCORE_RECALCULATION',
    METRICS_AGGREGATION: 'METRICS_AGGREGATION',
    HEAVY_ANALYTICS_QUERY: 'HEAVY_ANALYTICS_QUERY',
});

const QUEUE_PREFIX = 'distributed:queue';
const PROCESSING_PREFIX = 'distributed:processing';
const PROCESSING_META_PREFIX = 'distributed:processing_meta';

const canUseRedisQueue = () => Boolean(
    redisClient
    && redisClient.isOpen
    && typeof redisClient.lPush === 'function'
    && typeof redisClient.brPopLPush === 'function'
    && typeof redisClient.lRem === 'function'
);

const toQueueKey = (type) => `${QUEUE_PREFIX}:${String(type || 'default')}`;
const toProcessingKey = (type) => `${PROCESSING_PREFIX}:${String(type || 'default')}`;
const toProcessingMetaKey = (taskId) => `${PROCESSING_META_PREFIX}:${String(taskId || '')}`;

const safeParseEnvelope = (raw) => {
    try {
        return JSON.parse(raw);
    } catch (_error) {
        return null;
    }
};

const buildTaskEnvelope = ({
    id = crypto.randomUUID(),
    type,
    payload = {},
    attempts = 0,
    maxAttempts = 5,
}) => ({
    id,
    type,
    payload,
    attempts,
    maxAttempts,
    createdAt: new Date().toISOString(),
});

const enqueueTask = async ({
    type,
    payload = {},
    maxAttempts = Number.parseInt(process.env.DISTRIBUTED_TASK_MAX_ATTEMPTS || '5', 10),
}) => {
    if (!Object.values(TASK_TYPES).includes(type)) {
        throw new Error(`Unsupported task type: ${String(type)}`);
    }

    const envelope = buildTaskEnvelope({ type, payload, maxAttempts });
    if (!canUseRedisQueue()) {
        logger.warn({
            event: 'distributed_queue_unavailable',
            taskType: type,
        });
        return {
            accepted: false,
            id: envelope.id,
        };
    }

    await redisClient.lPush(toQueueKey(type), JSON.stringify(envelope));

    return {
        accepted: true,
        id: envelope.id,
    };
};

const claimTask = async ({
    type,
    blockTimeoutSec = Number.parseInt(process.env.DISTRIBUTED_TASK_POP_TIMEOUT_SEC || '2', 10),
    visibilityTimeoutSec = Number.parseInt(process.env.DISTRIBUTED_TASK_VISIBILITY_TIMEOUT_SEC || '90', 10),
}) => {
    if (!canUseRedisQueue()) return null;
    const raw = await redisClient.brPopLPush(
        toQueueKey(type),
        toProcessingKey(type),
        Math.max(1, blockTimeoutSec)
    );
    if (!raw) return null;

    const envelope = safeParseEnvelope(raw);
    if (!envelope?.id) {
        await redisClient.lRem(toProcessingKey(type), 1, raw);
        return null;
    }

    await redisClient.hSet(toProcessingMetaKey(envelope.id), {
        type: String(type),
        claimedAtMs: String(Date.now()),
        visibilityTimeoutMs: String(Math.max(1, visibilityTimeoutSec) * 1000),
    });
    await redisClient.expire(toProcessingMetaKey(envelope.id), Math.max(60, (visibilityTimeoutSec * 2)));

    return {
        envelope,
        raw,
    };
};

const ackTask = async ({ type, taskId, raw }) => {
    if (!canUseRedisQueue()) return;
    if (raw) {
        await redisClient.lRem(toProcessingKey(type), 1, raw);
    }
    if (taskId) {
        await redisClient.del(toProcessingMetaKey(taskId));
    }
};

const nackTask = async ({ type, envelope, raw, reason = 'unknown' }) => {
    if (!canUseRedisQueue()) return;
    const attempts = Number(envelope?.attempts || 0) + 1;
    const maxAttempts = Number(envelope?.maxAttempts || 5);

    if (raw) {
        await redisClient.lRem(toProcessingKey(type), 1, raw);
    }

    if (!envelope?.id) return;
    await redisClient.del(toProcessingMetaKey(envelope.id));

    if (attempts >= maxAttempts) {
        logger.error({
            event: 'distributed_task_dead_letter',
            taskType: type,
            taskId: envelope.id,
            attempts,
            reason,
        });
        return;
    }

    const retryEnvelope = {
        ...envelope,
        attempts,
        lastError: String(reason || 'unknown'),
        lastRetriedAt: new Date().toISOString(),
    };
    await redisClient.lPush(toQueueKey(type), JSON.stringify(retryEnvelope));
};

const recoverStaleTasks = async ({
    type,
    nowMs = Date.now(),
}) => {
    if (!canUseRedisQueue()) return { recovered: 0 };

    const processingKey = toProcessingKey(type);
    const rows = await redisClient.lRange(processingKey, 0, -1);
    if (!Array.isArray(rows) || !rows.length) {
        return { recovered: 0 };
    }

    let recovered = 0;
    for (const raw of rows) {
        const envelope = safeParseEnvelope(raw);
        if (!envelope?.id) {
            await redisClient.lRem(processingKey, 1, raw);
            recovered += 1;
            continue;
        }

        const metaKey = toProcessingMetaKey(envelope.id);
        const meta = await redisClient.hGetAll(metaKey);
        const claimedAtMs = Number(meta?.claimedAtMs || 0);
        const visibilityTimeoutMs = Number(meta?.visibilityTimeoutMs || 0);
        if (!claimedAtMs || !visibilityTimeoutMs || (nowMs - claimedAtMs) < visibilityTimeoutMs) {
            continue;
        }

        await redisClient.lRem(processingKey, 1, raw);
        await redisClient.del(metaKey);

        const requeuedEnvelope = {
            ...envelope,
            attempts: Number(envelope.attempts || 0) + 1,
            recoveredAt: new Date().toISOString(),
        };
        await redisClient.lPush(toQueueKey(type), JSON.stringify(requeuedEnvelope));
        recovered += 1;
    }

    return { recovered };
};

const getQueueDepthByType = async (type) => {
    if (!canUseRedisQueue()) return 0;
    const [queued, processing] = await Promise.all([
        redisClient.lLen(toQueueKey(type)),
        redisClient.lLen(toProcessingKey(type)),
    ]);
    return Number(queued || 0) + Number(processing || 0);
};

const getQueueDepth = async () => {
    const entries = await Promise.all(
        Object.values(TASK_TYPES).map(async (type) => {
            const depth = await getQueueDepthByType(type);
            return [type, depth];
        })
    );
    return Object.fromEntries(entries);
};

module.exports = {
    TASK_TYPES,
    canUseRedisQueue,
    enqueueTask,
    claimTask,
    ackTask,
    nackTask,
    recoverStaleTasks,
    getQueueDepth,
    getQueueDepthByType,
};
