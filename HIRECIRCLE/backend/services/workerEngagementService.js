const mongoose = require('mongoose');

const Application = require('../models/Application');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Notification = require('../models/Notification');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');
const WorkerProfile = require('../models/WorkerProfile');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const toObjectId = (value) => (
    mongoose.Types.ObjectId.isValid(value)
        ? new mongoose.Types.ObjectId(value)
        : value
);

const computeWorkerEngagementScore = async ({ workerId, upsert = true, withNudge = false }) => {
    const safeWorkerId = toObjectId(workerId);
    const worker = await WorkerProfile.findById(safeWorkerId)
        .select('_id user interviewVerified')
        .lean();

    if (!worker) return null;

    const since30d = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));

    const [appStatsRows, lifecycleRows] = await Promise.all([
        Application.aggregate([
            {
                $match: {
                    worker: safeWorkerId,
                    createdAt: { $gte: since30d },
                },
            },
            {
                $group: {
                    _id: null,
                    totalApplications: { $sum: 1 },
                    shortlisted: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0],
                        },
                    },
                    hires: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                    avgResponseMs: {
                        $avg: { $subtract: ['$updatedAt', '$createdAt'] },
                    },
                },
            },
        ]),
        HiringLifecycleEvent.aggregate([
            {
                $match: {
                    workerId: safeWorkerId,
                    occurredAt: { $gte: since30d },
                    eventType: { $in: ['APPLICATION_HIRED', 'RETENTION_30D'] },
                },
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const appStats = appStatsRows[0] || {
        totalApplications: 0,
        shortlisted: 0,
        hires: 0,
        avgResponseMs: 72 * 60 * 60 * 1000,
    };

    const hiredEvents = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || appStats.hires || 0);
    const retainedEvents = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);

    const interviewFactor = worker.interviewVerified ? 1 : 0;
    const applicationFrequency30d = Number(appStats.totalApplications || 0);
    const applicationFrequencyFactor = clamp01(safeDiv(applicationFrequency30d, 20));
    const shortlistRatio = clamp01(safeDiv(appStats.shortlisted, Math.max(appStats.totalApplications, 1)));
    const avgResponseHours = Number((Number(appStats.avgResponseMs || 0) / (1000 * 60 * 60)).toFixed(2));
    const responseFactor = clamp01(1 - safeDiv(avgResponseHours, 72));
    const retentionSuccessRate = clamp01(safeDiv(retainedEvents, Math.max(hiredEvents, 1)));

    const score = clamp01(
        (interviewFactor * 0.2)
        + (applicationFrequencyFactor * 0.2)
        + (shortlistRatio * 0.25)
        + (responseFactor * 0.15)
        + (retentionSuccessRate * 0.2)
    );

    const badgeEligible = score >= 0.75 && Boolean(worker.interviewVerified);

    const payload = {
        workerId: worker._id,
        userId: worker.user || null,
        score,
        interviewVerified: Boolean(worker.interviewVerified),
        applicationFrequency30d,
        shortlistRatio,
        avgResponseHours,
        retentionSuccessRate,
        badgeEligible,
        computedAt: new Date(),
    };

    let result = payload;
    if (upsert) {
        result = await WorkerEngagementScore.findOneAndUpdate(
            { workerId: worker._id },
            { $set: payload },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
    }

    if (withNudge && worker.user && score < 0.35) {
        const recentlyNudged = await Notification.findOne({
            user: worker.user,
            type: 'status_update',
            'relatedData.nudgeType': 'worker_reengagement',
            createdAt: { $gte: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)) },
        })
            .select('_id')
            .lean();

        if (!recentlyNudged) {
            await Notification.create({
                user: worker.user,
                type: 'status_update',
                title: 'Profile activity nudge',
                message: 'Complete one application today to improve your visibility to recruiters.',
                relatedData: {
                    nudgeType: 'worker_reengagement',
                },
            });
        }
    }

    return result;
};

const computeWorkerEngagementScoresBatch = async ({ batchSize = 500, hardCap = 5000 } = {}) => {
    const scores = [];
    let processed = 0;
    let lastSeenId = null;

    while (processed < hardCap) {
        const remaining = hardCap - processed;
        const limit = Math.min(batchSize, remaining);

        const query = {
            ...(lastSeenId ? { _id: { $gt: lastSeenId } } : {}),
        };

        const workers = await WorkerProfile.find(query)
            .sort({ _id: 1 })
            .limit(limit)
            .select('_id')
            .lean();

        if (!workers.length) break;

        for (const worker of workers) {
            const score = await computeWorkerEngagementScore({
                workerId: worker._id,
                upsert: true,
                withNudge: true,
            });
            if (score) scores.push(score);
        }

        processed += workers.length;
        lastSeenId = workers[workers.length - 1]._id;

        if (workers.length < limit) break;
    }

    if (processed >= hardCap && lastSeenId) {
        console.warn(`[worker-engagement] hard cap ${hardCap} reached; additional workers skipped`);
    }

    return scores;
};

module.exports = {
    computeWorkerEngagementScore,
    computeWorkerEngagementScoresBatch,
};
