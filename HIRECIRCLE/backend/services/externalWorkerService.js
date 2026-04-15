const BackgroundJob = require('../models/BackgroundJob');
const logger = require('../utils/logger');
const {
    WEBHOOK_QUEUE,
    WEBHOOK_JOB_TYPE,
    processWebhookDeliveryJob,
} = require('./externalWebhookService');
const {
    INTEGRATION_QUEUE,
    INTEGRATION_JOB_TYPE,
    processIntegrationSyncJob,
} = require('./externalIntegrationService');

const SUPPORTED_QUEUES = [WEBHOOK_QUEUE, INTEGRATION_QUEUE];
const DEFAULT_POLL_MS = Number.parseInt(process.env.EXTERNAL_WORKER_POLL_MS || '3000', 10);
const DEFAULT_BATCH_SIZE = Number.parseInt(process.env.EXTERNAL_WORKER_BATCH_SIZE || '20', 10);

let loopTimer = null;
let isTickRunning = false;

const computeRetryBackoffMs = (attempt = 1) => {
    const safeAttempt = Math.max(1, Number.parseInt(attempt, 10) || 1);
    return Math.min(30 * 60 * 1000, 1000 * (2 ** (safeAttempt - 1)));
};

const claimOneJob = async () => {
    const now = new Date();

    return BackgroundJob.findOneAndUpdate(
        {
            queue: { $in: SUPPORTED_QUEUES },
            status: 'queued',
            runAt: { $lte: now },
        },
        {
            $set: {
                status: 'processing',
            },
            $inc: {
                attempts: 1,
            },
        },
        {
            sort: { runAt: 1, createdAt: 1 },
            new: true,
        }
    );
};

const completeJob = async ({ jobId, lastError = null }) => {
    await BackgroundJob.updateOne(
        { _id: jobId },
        {
            $set: {
                status: 'completed',
                processedAt: new Date(),
                lastError,
            },
        }
    );
};

const retryJob = async ({ job, reason = 'retry', runAt = null }) => {
    const attempts = Number(job.attempts || 1);
    const maxAttempts = Number(job.maxAttempts || 3);

    if (attempts >= maxAttempts) {
        await BackgroundJob.updateOne(
            { _id: job._id },
            {
                $set: {
                    status: 'failed',
                    processedAt: new Date(),
                    lastError: String(reason || 'job failed').slice(0, 500),
                },
            }
        );
        return;
    }

    const fallbackRunAt = new Date(Date.now() + computeRetryBackoffMs(attempts));
    await BackgroundJob.updateOne(
        { _id: job._id },
        {
            $set: {
                status: 'queued',
                runAt: runAt || fallbackRunAt,
                lastError: String(reason || 'retrying').slice(0, 500),
            },
        }
    );
};

const routeJob = async (job) => {
    if (job.type === WEBHOOK_JOB_TYPE) {
        return processWebhookDeliveryJob(job);
    }

    if (job.type === INTEGRATION_JOB_TYPE) {
        return processIntegrationSyncJob(job);
    }

    return {
        retry: false,
        reason: `Unsupported job type: ${job.type}`,
    };
};

const processSingleJob = async () => {
    const job = await claimOneJob();
    if (!job) return false;

    try {
        const result = await routeJob(job);

        if (result?.retry) {
            await retryJob({
                job,
                reason: result.reason,
                runAt: result.runAt,
            });
            return true;
        }

        await completeJob({
            jobId: job._id,
            lastError: result?.reason || null,
        });
        return true;
    } catch (error) {
        logger.warn({
            event: 'external_worker_job_error',
            jobId: String(job._id),
            type: job.type,
            message: error.message,
        });

        await retryJob({
            job,
            reason: error.message,
            runAt: null,
        });
        return true;
    }
};

const tick = async () => {
    if (isTickRunning) return;
    isTickRunning = true;

    try {
        for (let index = 0; index < DEFAULT_BATCH_SIZE; index += 1) {
            const processed = await processSingleJob();
            if (!processed) break;
        }
    } finally {
        isTickRunning = false;
    }
};

const startExternalWorker = () => {
    if (loopTimer) return;

    loopTimer = setInterval(() => {
        void tick();
    }, DEFAULT_POLL_MS);

    void tick();
};

const stopExternalWorker = () => {
    if (!loopTimer) return;
    clearInterval(loopTimer);
    loopTimer = null;
};

module.exports = {
    startExternalWorker,
    stopExternalWorker,
    processSingleJob,
};
