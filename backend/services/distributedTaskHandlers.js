const User = require('../models/userModel');
const Notification = require('../models/Notification');
const WorkerProfile = require('../models/WorkerProfile');
const { sendPushNotificationForUser } = require('./pushService');
const { computeWorkerEngagementScore } = require('./workerEngagementService');
const { recalculateUserTrustScore } = require('./trustScoreService');
const { publishMetric } = require('./metricsService');
const { getMetricsSnapshot } = require('./metricsRegistry');
const { getEmployerLockInSummary } = require('./lockInService');
const { buildCacheKey, setJSON, CACHE_TTL_SECONDS } = require('./cacheService');
const { computeAndStoreDailyMetrics } = require('./dailyMetricsService');
const { runLifecycleAutomations } = require('./lifecycleAutomationService');
const sendEmail = require('../utils/sendEmail');

const runNotificationDispatchTask = async (payload = {}) => {
    const userId = String(payload.userId || '').trim();
    if (!userId) return;

    await Notification.create({
        user: userId,
        type: String(payload.notificationType || payload.type || 'status_update'),
        title: String(payload.title || 'Notification'),
        message: String(payload.body || payload.message || ''),
        relatedData: payload.data || payload.relatedData || {},
        isRead: false,
    }).catch(() => {});

    const user = await User.findById(userId).select('pushTokens notificationPreferences');
    if (!user) return;

    await sendPushNotificationForUser(
        user,
        String(payload.title || 'Notification'),
        String(payload.body || ''),
        payload.data || {},
        String(payload.eventType || 'generic')
    );
};

const runTrustScoreRecalculationTask = async (payload = {}) => {
    const userId = String(payload.userId || '').trim();
    const workerId = String(payload.workerId || '').trim();
    if (userId) {
        await recalculateUserTrustScore({
            userId,
            reason: String(payload.reason || 'distributed_queue'),
        });
        return;
    }

    if (!workerId) return;
    const worker = await WorkerProfile.findById(workerId).select('user').lean();
    if (worker?.user) {
        await recalculateUserTrustScore({
            userId: worker.user,
            reason: String(payload.reason || 'distributed_queue_worker'),
        });
    } else {
        await computeWorkerEngagementScore({
            workerId,
            upsert: true,
            withNudge: false,
        });
    }
};

const runMetricsAggregationTask = async (payload = {}) => {
    const snapshot = getMetricsSnapshot();
    await publishMetric({
        metricName: 'ApiRequestCount',
        value: Number(snapshot?.totals?.requests || 0),
        role: 'system',
        correlationId: 'metrics-aggregation',
    });
    await publishMetric({
        metricName: 'ApiSlowRequestCount',
        value: Number(snapshot?.totals?.slowRequests || 0),
        role: 'system',
        correlationId: 'metrics-aggregation',
    });
    await computeAndStoreDailyMetrics({
        day: payload.day ? new Date(payload.day) : new Date(),
        source: 'distributed_task',
    });
    await runLifecycleAutomations();
};

const runHeavyAnalyticsQueryTask = async (payload = {}) => {
    const employerId = String(payload.employerId || '').trim();
    if (!employerId) return;

    const summary = await getEmployerLockInSummary({ employerId });
    const cacheKey = buildCacheKey('analytics:employer-summary', { employerId });
    await setJSON(cacheKey, {
        success: true,
        data: summary,
    }, CACHE_TTL_SECONDS.analytics);
};

const runEmailDispatchTask = async (payload = {}) => {
    const email = String(payload.email || '').trim();
    const subject = String(payload.subject || '').trim();
    const message = String(payload.message || '').trim();
    if (!email || !subject || !message) return;

    await sendEmail({
        email,
        subject,
        message,
    });
};

const runMatchRecalculationTask = async (payload = {}) => {
    const scope = String(payload.scope || 'generic');
    await publishMetric({
        metricName: 'MatchRecalculationRequested',
        value: 1,
        role: 'system',
        correlationId: `match-recalc-${scope}`,
        dimensions: {
            Scope: scope,
        },
    });
};

const runSmartInterviewAiTask = async () => {
    // Smart Interview AI processing already runs on dedicated SQS workers.
    // This handler exists to keep distributed task topology explicit and extensible.
    await publishMetric({
        metricName: 'SmartInterviewAsyncDispatch',
        value: 1,
        role: 'system',
        correlationId: 'smart-interview-async',
    });
};

module.exports = {
    runNotificationDispatchTask,
    runEmailDispatchTask,
    runTrustScoreRecalculationTask,
    runMetricsAggregationTask,
    runHeavyAnalyticsQueryTask,
    runMatchRecalculationTask,
    runSmartInterviewAiTask,
};
