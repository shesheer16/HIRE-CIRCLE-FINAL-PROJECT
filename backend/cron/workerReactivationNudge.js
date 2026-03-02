require('dotenv').config();

const connectDB = require('../config/db');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { sendPushNotificationForUser } = require('../services/pushService');
const { createAnalyticsEvent } = require('../services/revenueInstrumentationService');

const APPLICATION_IDLE_DAYS = Number.parseInt(process.env.WORKER_REACTIVATION_IDLE_DAYS || '14', 10);
const NUDGE_COOLDOWN_DAYS = Number.parseInt(process.env.WORKER_REACTIVATION_COOLDOWN_DAYS || '3', 10);
const CLARITY_SCORE_THRESHOLD = Number.parseFloat(process.env.WORKER_REACTIVATION_CLARITY_THRESHOLD || '0.7');
const HARD_CAP_PER_RUN = 5000;
const BATCH_SIZE = 500;
const MAX_NUDGES_PER_RUN = Math.min(
    Number.parseInt(process.env.WORKER_REACTIVATION_MAX_PER_RUN || '1000', 10),
    HARD_CAP_PER_RUN
);

const runWorkerReactivationNudge = async () => {
    const now = Date.now();
    const applicationIdleThreshold = new Date(now - APPLICATION_IDLE_DAYS * 24 * 60 * 60 * 1000);
    const cooldownThreshold = new Date(now - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);

    if (Number.parseInt(process.env.WORKER_REACTIVATION_MAX_PER_RUN || '1000', 10) > HARD_CAP_PER_RUN) {
        console.warn(`[worker-reactivation] configured max exceeded hard cap; capped at ${HARD_CAP_PER_RUN}`);
    }

    let processedProfiles = 0;
    let nudgesSent = 0;
    let lastProfileId = null;

    while (processedProfiles < MAX_NUDGES_PER_RUN) {
        const remaining = MAX_NUDGES_PER_RUN - processedProfiles;
        const pageSize = Math.min(BATCH_SIZE, remaining);
        const batchQuery = {
            interviewVerified: true,
            'interviewIntelligence.communicationClarityScore': { $lt: CLARITY_SCORE_THRESHOLD },
            ...(lastProfileId ? { _id: { $gt: lastProfileId } } : {}),
        };

        const verifiedProfiles = await WorkerProfile.find(batchQuery)
            .select('_id user city roleProfiles interviewIntelligence.communicationClarityScore')
            .sort({ _id: 1 })
            .limit(pageSize)
            .lean();

        if (!verifiedProfiles.length) break;

        processedProfiles += verifiedProfiles.length;
        lastProfileId = verifiedProfiles[verifiedProfiles.length - 1]._id;

        const workerIds = verifiedProfiles.map((profile) => profile._id);
        const userIds = verifiedProfiles.map((profile) => profile.user);

        const [recentApplications, recentNudges, users] = await Promise.all([
            Application.distinct('worker', {
                worker: { $in: workerIds },
                createdAt: { $gte: applicationIdleThreshold },
            }),
            Notification.find({
                user: { $in: userIds },
                type: 'status_update',
                'relatedData.nudgeType': 'worker_reactivation',
                createdAt: { $gte: cooldownThreshold },
            }).select('user').lean(),
            User.find({ _id: { $in: userIds } }).select('pushTokens notificationPreferences').lean(),
        ]);

        const workersWithRecentApplications = new Set(recentApplications.map((id) => String(id)));
        const usersWithRecentNudges = new Set(recentNudges.map((item) => String(item.user)));
        const usersById = new Map(users.map((user) => [String(user._id), user]));

        for (const profile of verifiedProfiles) {
            const workerKey = String(profile._id);
            const userKey = String(profile.user);

            if (workersWithRecentApplications.has(workerKey)) continue;
            if (usersWithRecentNudges.has(userKey)) continue;

            const user = usersById.get(userKey);
            if (!user) continue;

            await Notification.create({
                user: profile.user,
                type: 'status_update',
                title: 'Improve your profile to get better matches',
                message: 'Your interview is verified. Add a few details to unlock stronger matches.',
                relatedData: {
                    nudgeType: 'worker_reactivation',
                },
            });

            await sendPushNotificationForUser(
                user,
                'Improve your profile to get better matches',
                'Add a few more details and unlock better-quality job matches.',
                {
                    type: 'worker_reactivation',
                },
                'new_job_recommendations'
            );

            await createAnalyticsEvent({
                userId: profile.user,
                eventName: 'WORKER_REACTIVATION_NUDGE_SENT',
                metadata: {
                    city: profile.city || null,
                    roleCluster: profile?.roleProfiles?.[0]?.roleName || null,
                    communicationClarityScore: Number(profile?.interviewIntelligence?.communicationClarityScore || 0),
                },
            });

            nudgesSent += 1;
        }
    }

    if (processedProfiles >= MAX_NUDGES_PER_RUN && lastProfileId) {
        const hasMoreProfiles = await WorkerProfile.findOne({
            interviewVerified: true,
            _id: { $gt: lastProfileId },
        }).select('_id').lean();
        if (hasMoreProfiles) {
            console.warn(`[worker-reactivation] hard cap reached at ${MAX_NUDGES_PER_RUN} profiles; additional records were skipped`);
        }
    }

    console.log(`[worker-reactivation] processed ${processedProfiles} profiles and sent ${nudgesSent} nudges`);
};

const main = async () => {
    await connectDB();
    await runWorkerReactivationNudge();
    process.exit(0);
};

main().catch((error) => {
    console.warn('[worker-reactivation] failed:', error.message);
    process.exit(1);
});
