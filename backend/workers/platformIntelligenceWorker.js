require('dotenv').config();

const connectDB = require('../config/db');
const logger = require('../utils/logger');
const { enqueueInterviewJob } = require('../services/sqsInterviewQueue');
const {
    getNextBackgroundJob,
    markBackgroundJobCompleted,
    markBackgroundJobFailed,
} = require('../services/backgroundQueueService');
const { dispatchNotificationNow } = require('../services/notificationEngineService');
const { computeAndStoreDailyMetrics } = require('../services/dailyMetricsService');
const { recalculateUserTrustScore } = require('../services/trustScoreService');
const { runLifecycleAutomations } = require('../services/lifecycleAutomationService');
const { runStrategicAnalyticsDaily } = require('../services/strategicAnalyticsService');
const { runWarehouseRetentionPolicy } = require('../services/warehouseRetentionService');

const sendEmail = require('../utils/sendEmail');

const POLL_WAIT_SECONDS = Number.parseInt(process.env.PLATFORM_WORKER_POLL_WAIT_SECONDS || '3', 10);
const MAX_IDLE_SLEEP_MS = Number.parseInt(process.env.PLATFORM_WORKER_IDLE_SLEEP_MS || '1000', 10);

let isRunning = true;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handlers = {
    smart_interview_processing: async (payload = {}) => {
        await enqueueInterviewJob(payload);
    },
    notification_dispatch: async (payload = {}) => {
        await dispatchNotificationNow({
            userId: payload.userId,
            type: payload.type || 'status_update',
            title: payload.title || 'Update',
            message: payload.message || 'You have a new notification.',
            relatedData: payload.relatedData || {},
            pushCategory: payload.pushCategory || 'application_status',
        });
    },
    email_sending: async (payload = {}) => {
        if (!payload.email || !payload.subject || !payload.message) {
            throw new Error('email_sending job requires email, subject, and message');
        }
        await sendEmail({
            email: payload.email,
            subject: payload.subject,
            message: payload.message,
        });
    },
    analytics_aggregation: async (payload = {}) => {
        await computeAndStoreDailyMetrics({ day: payload.day ? new Date(payload.day) : new Date(), source: 'worker' });
    },
    trust_recalculation: async (payload = {}) => {
        if (!payload.userId) {
            throw new Error('trust_recalculation job requires userId');
        }
        await recalculateUserTrustScore({ userId: payload.userId, reason: payload.reason || 'queue' });
    },
    lifecycle_automation: async (payload = {}) => {
        const summary = await runLifecycleAutomations(payload);
        logger.info(`lifecycle automation run complete: ${JSON.stringify({
            source: payload.source || 'unknown',
            runAt: summary?.runAt || null,
            offersExpired: summary?.offersExpired || 0,
            interviewReminders24h: summary?.interviewReminders24h || 0,
            interviewReminders1h: summary?.interviewReminders1h || 0,
            jobsAutoClosedOnFill: summary?.jobsAutoClosedOnFill || 0,
        })}`);
    },
    strategic_analytics_daily: async (payload = {}) => {
        await runStrategicAnalyticsDaily({
            day: payload.day ? new Date(payload.day) : new Date(Date.now() - (24 * 60 * 60 * 1000)),
            source: payload.source || 'platform_worker',
            force: Boolean(payload.force),
        });
    },
    warehouse_retention: async (payload = {}) => {
        await runWarehouseRetentionPolicy({
            now: payload.now ? new Date(payload.now) : new Date(),
            rawRetentionDays: payload.rawRetentionDays,
            batchSize: payload.batchSize,
        });
    },
};

const processJob = async (job) => {
    const handler = handlers[job.type];
    if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
    }

    await handler(job.payload || {});
};

const workerLoop = async () => {
    while (isRunning) {
        const job = await getNextBackgroundJob({ waitSeconds: POLL_WAIT_SECONDS });

        if (!job) {
            await delay(MAX_IDLE_SLEEP_MS);
            continue;
        }

        try {
            await processJob(job);
            await markBackgroundJobCompleted({ jobId: job._id });
        } catch (error) {
            logger.warn(`platform worker job failed (${job.type}): ${error.message}`);
            await markBackgroundJobFailed({ job, error });
        }
    }
};

const shutdown = async () => {
    isRunning = false;
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const start = async () => {
    await connectDB();
    logger.info('Platform intelligence worker started');
    await workerLoop();
    logger.info('Platform intelligence worker stopped');
};

if (require.main === module) {
    start().catch((error) => {
        logger.error(`Platform intelligence worker crashed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    start,
};
