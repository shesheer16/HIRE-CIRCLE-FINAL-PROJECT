const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Message = require('../models/Message');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const GrowthMetrics = require('../models/GrowthMetrics');

const toDateKey = (date) => {
    const value = new Date(date);
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const safeDiv = (num, den) => (den > 0 ? num / den : 0);

const hasRetentionActivity = async ({ userId, signupAt, dayOffset }) => {
    const start = new Date(new Date(signupAt).getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const eventExists = await AnalyticsEvent.exists({
        user: userId,
        createdAt: {
            $gte: start,
            $lt: end,
        },
    });

    if (eventExists) return true;

    const userUpdated = await User.exists({
        _id: userId,
        updatedAt: {
            $gte: start,
            $lt: end,
        },
    });

    return Boolean(userUpdated);
};

const computeGrowthMetricsForWindow = async ({ windowStart, windowEnd }) => {
    const [signups, applicationsInWindow, chatRows] = await Promise.all([
        User.find({
            createdAt: {
                $gte: windowStart,
                $lt: windowEnd,
            },
        }).select('_id createdAt isVerified hasCompletedProfile').lean(),
        Application.find({
            createdAt: {
                $gte: windowStart,
                $lt: windowEnd,
            },
        }).select('_id worker status').lean(),
        Message.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: windowStart,
                        $lt: windowEnd,
                    },
                },
            },
            {
                $group: {
                    _id: '$sender',
                },
            },
        ]),
    ]);

    const signupIds = signups.map((row) => row._id);

    const [workerProfiles, employerResponsesCount] = await Promise.all([
        WorkerProfile.find({
            user: { $in: signupIds },
        }).select('_id user interviewVerified').lean(),
        Application.countDocuments({
            createdAt: {
                $gte: windowStart,
                $lt: windowEnd,
            },
            status: {
                $in: [
                    'shortlisted',
                    'interview_requested',
                    'interview_completed',
                    'offer_sent',
                    'offer_accepted',
                    'offer_declined',
                    'rejected',
                    'hired',
                ],
            },
        }),
    ]);

    const otpVerified = signups.filter((row) => row.isVerified).length;
    const otpDropOff = Math.max(0, signups.length - otpVerified);

    const interviewsCompleted = signups.filter((row) => {
        if (row.hasCompletedProfile) return true;
        const workerProfile = workerProfiles.find((profile) => String(profile.user) === String(row._id));
        return Boolean(workerProfile?.interviewVerified);
    }).length;

    const applicationsSubmitted = applicationsInWindow.filter((row) => {
        const workerIdSet = new Set(workerProfiles.map((profile) => String(profile._id)));
        return workerIdSet.has(String(row.worker));
    }).length;

    const chatEngagedUsers = Number(chatRows.length || 0);

    const retentionChecks = await Promise.all(signups.map(async (signup) => {
        const [d1, d7, d30] = await Promise.all([
            hasRetentionActivity({ userId: signup._id, signupAt: signup.createdAt, dayOffset: 1 }),
            hasRetentionActivity({ userId: signup._id, signupAt: signup.createdAt, dayOffset: 7 }),
            hasRetentionActivity({ userId: signup._id, signupAt: signup.createdAt, dayOffset: 30 }),
        ]);

        return {
            d1,
            d7,
            d30,
        };
    }));

    const retainedDay1 = retentionChecks.filter((item) => item.d1).length;
    const retainedDay7 = retentionChecks.filter((item) => item.d7).length;
    const retainedDay30 = retentionChecks.filter((item) => item.d30).length;

    const counters = {
        signups: signups.length,
        otpVerified,
        otpDropOff,
        interviewsCompleted,
        applicationsSubmitted,
        employerResponses: employerResponsesCount,
        chatEngagedUsers,
        retainedDay1,
        retainedDay7,
        retainedDay30,
    };

    const rates = {
        signupConversionRate: Number(safeDiv(otpVerified, Math.max(signups.length, 1)).toFixed(4)),
        otpDropOffRate: Number(safeDiv(otpDropOff, Math.max(signups.length, 1)).toFixed(4)),
        interviewCompletionRate: Number(safeDiv(interviewsCompleted, Math.max(otpVerified, 1)).toFixed(4)),
        jobApplyRate: Number(safeDiv(applicationsSubmitted, Math.max(interviewsCompleted, 1)).toFixed(4)),
        employerResponseRate: Number(safeDiv(employerResponsesCount, Math.max(applicationsInWindow.length, 1)).toFixed(4)),
        chatEngagementRate: Number(safeDiv(chatEngagedUsers, Math.max(applicationsInWindow.length, 1)).toFixed(4)),
        retentionDay1Rate: Number(safeDiv(retainedDay1, Math.max(signups.length, 1)).toFixed(4)),
        retentionDay7Rate: Number(safeDiv(retainedDay7, Math.max(signups.length, 1)).toFixed(4)),
        retentionDay30Rate: Number(safeDiv(retainedDay30, Math.max(signups.length, 1)).toFixed(4)),
    };

    return {
        windowStart,
        windowEnd,
        dateKey: toDateKey(windowStart),
        counters,
        rates,
    };
};

const upsertGrowthMetricsForDay = async (date = new Date()) => {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const computed = await computeGrowthMetricsForWindow({
        windowStart: start,
        windowEnd: end,
    });

    return GrowthMetrics.findOneAndUpdate(
        { dateKey: computed.dateKey },
        {
            $set: {
                windowStart: computed.windowStart,
                windowEnd: computed.windowEnd,
                counters: computed.counters,
                rates: computed.rates,
                computedAt: new Date(),
            },
        },
        { upsert: true, new: true }
    ).lean();
};

const getLatestGrowthMetrics = async () => GrowthMetrics.findOne({}).sort({ computedAt: -1 }).lean();

module.exports = {
    computeGrowthMetricsForWindow,
    upsertGrowthMetricsForDay,
    getLatestGrowthMetrics,
};
