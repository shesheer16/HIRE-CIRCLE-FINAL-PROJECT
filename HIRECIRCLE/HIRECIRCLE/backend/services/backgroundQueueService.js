const BackgroundJob = require('../models/BackgroundJob');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { incrementRedisFailureCounter } = require('./systemMonitoringService');

const QUEUE_KEY = String(process.env.PLATFORM_QUEUE_KEY || 'platform_intelligence_queue');
const STALLED_THRESHOLD_MS = Number.parseInt(process.env.BACKGROUND_JOB_STALLED_MS || String(10 * 60 * 1000), 10);

const enqueueBackgroundJob = async ({ type, payload = {}, runAt = new Date(), maxAttempts = 3 }) => {
    if (!type) {
        throw new Error('Background job type is required');
    }

    const job = await BackgroundJob.create({
        queue: 'platform_intelligence',
        type: String(type),
        payload,
        runAt: new Date(runAt),
        maxAttempts: Number(maxAttempts) || 3,
        status: 'queued',
    });

    try {
        if (redisClient?.isOpen && typeof redisClient.rPush === 'function') {
            await redisClient.rPush(QUEUE_KEY, String(job._id));
        }
    } catch (error) {
        await incrementRedisFailureCounter({ reason: `enqueue:${error.message}` });
        logger.warn(`background enqueue redis push failed: ${error.message}`);
    }

    return job;
};

const pullNextJobIdFromRedis = async ({ waitSeconds = 1 } = {}) => {
    try {
        if (!redisClient?.isOpen || typeof redisClient.blPop !== 'function') {
            return null;
        }

        const result = await redisClient.blPop(QUEUE_KEY, waitSeconds);
        if (!result) return null;

        if (typeof result === 'object' && result.element) {
            return String(result.element);
        }

        if (Array.isArray(result) && result.length > 1) {
            return String(result[1]);
        }

        return null;
    } catch (error) {
        await incrementRedisFailureCounter({ reason: `dequeue:${error.message}` });
        logger.warn(`background dequeue redis pop failed: ${error.message}`);
        return null;
    }
};

const claimQueuedJob = async (jobId = null) => {
    const now = new Date();

    if (jobId) {
        const updated = await BackgroundJob.findOneAndUpdate(
            { _id: jobId, status: 'queued', runAt: { $lte: now } },
            {
                $set: { status: 'processing' },
                $inc: { attempts: 1 },
            },
            { new: true }
        );
        if (updated) return updated;
    }

    return BackgroundJob.findOneAndUpdate(
        { status: 'queued', runAt: { $lte: now } },
        {
            $set: { status: 'processing' },
            $inc: { attempts: 1 },
        },
        { new: true, sort: { runAt: 1, createdAt: 1 } }
    );
};

const detectAndRecoverStalledJobs = async () => {
    const staleBefore = new Date(Date.now() - STALLED_THRESHOLD_MS);

    const rows = await BackgroundJob.find({
        status: 'processing',
        updatedAt: { $lt: staleBefore },
    }).select('_id attempts maxAttempts');

    if (!rows.length) return { recovered: 0, deadLettered: 0 };

    let recovered = 0;
    let deadLettered = 0;

    for (const row of rows) {
        const attempts = Number(row.attempts || 0);
        const maxAttempts = Number(row.maxAttempts || 3);
        const canRetry = attempts < maxAttempts;

        await BackgroundJob.findByIdAndUpdate(row._id, {
            $set: {
                status: canRetry ? 'queued' : 'dead_letter',
                runAt: new Date(),
                deadLetteredAt: canRetry ? null : new Date(),
                lastError: canRetry
                    ? 'Recovered from stalled processing state'
                    : 'Moved to dead-letter after stalled processing and retry exhaustion',
            },
            ...(canRetry ? {} : {
                $push: {
                    retryHistory: 'stalled_to_dead_letter',
                },
            }),
        });

        if (canRetry) {
            recovered += 1;
            try {
                if (redisClient?.isOpen && typeof redisClient.rPush === 'function') {
                    await redisClient.rPush(QUEUE_KEY, String(row._id));
                }
            } catch (redisError) {
                await incrementRedisFailureCounter({ reason: `stalled-requeue:${redisError.message}` });
            }
        } else {
            deadLettered += 1;
        }
    }

    if (recovered || deadLettered) {
        logger.warn({
            event: 'background_queue_stalled_recovery',
            recovered,
            deadLettered,
        });
    }

    return { recovered, deadLettered };
};

const getNextBackgroundJob = async ({ waitSeconds = 1 } = {}) => {
    await detectAndRecoverStalledJobs();

    const redisJobId = await pullNextJobIdFromRedis({ waitSeconds });
    const claimed = await claimQueuedJob(redisJobId);
    if (claimed) return claimed;

    if (redisJobId) {
        return null;
    }

    return claimQueuedJob(null);
};

const markBackgroundJobCompleted = async ({ jobId }) => {
    if (!jobId) return;
    await BackgroundJob.findByIdAndUpdate(jobId, {
        $set: {
            status: 'completed',
            processedAt: new Date(),
            lastError: null,
        },
    });
};

const markBackgroundJobFailed = async ({ job, error }) => {
    if (!job?._id) return;

    const failedAttempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || 3);
    const shouldRetry = failedAttempts < maxAttempts;
    const nextRunAt = new Date(Date.now() + Math.min(60000, failedAttempts * 5000 + 2000));
    const normalizedError = String(error?.message || error || 'Unknown background job error');

    await BackgroundJob.findByIdAndUpdate(job._id, {
        $set: {
            status: shouldRetry ? 'queued' : 'dead_letter',
            runAt: shouldRetry ? nextRunAt : job.runAt,
            deadLetteredAt: shouldRetry ? null : new Date(),
            lastError: normalizedError,
            processedAt: shouldRetry ? null : new Date(),
        },
        $push: {
            retryHistory: normalizedError,
        },
    });

    logger.warn({
        event: 'background_job_failed',
        jobId: String(job._id),
        type: String(job.type || 'unknown'),
        attempts: failedAttempts,
        maxAttempts,
        movedToDeadLetter: !shouldRetry,
        error: normalizedError,
    });

    if (shouldRetry) {
        try {
            if (redisClient?.isOpen && typeof redisClient.rPush === 'function') {
                await redisClient.rPush(QUEUE_KEY, String(job._id));
            }
        } catch (redisError) {
            await incrementRedisFailureCounter({ reason: `retry:${redisError.message}` });
            logger.warn(`background retry redis push failed: ${redisError.message}`);
        }
    }
};

const retryBackgroundJobManually = async (jobId) => {
    if (!jobId) throw new Error('jobId is required');

    const job = await BackgroundJob.findById(jobId);
    if (!job) throw new Error('Background job not found');

    if (!['failed', 'dead_letter'].includes(String(job.status || ''))) {
        throw new Error('Only failed/dead-letter jobs can be retried manually');
    }

    job.status = 'queued';
    job.runAt = new Date();
    job.deadLetteredAt = null;
    job.lastError = null;
    await job.save();

    try {
        if (redisClient?.isOpen && typeof redisClient.rPush === 'function') {
            await redisClient.rPush(QUEUE_KEY, String(job._id));
        }
    } catch (redisError) {
        await incrementRedisFailureCounter({ reason: `manual-retry:${redisError.message}` });
        logger.warn(`background manual retry redis push failed: ${redisError.message}`);
    }

    return job;
};

module.exports = {
    enqueueBackgroundJob,
    getNextBackgroundJob,
    markBackgroundJobCompleted,
    markBackgroundJobFailed,
    detectAndRecoverStalledJobs,
    retryBackgroundJobManually,
};
