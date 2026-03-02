const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Event = require('../models/Event').Event;
const DailyMetrics = require('../models/DailyMetrics');
const { startOfUtcDay, endOfUtcDay } = require('../utils/timezone');

const toDayStart = (date = new Date()) => {
    return startOfUtcDay(date);
};

const toDayEnd = (date = new Date()) => {
    return endOfUtcDay(date);
};

const computeAndStoreDailyMetrics = async ({ day = new Date(), source = 'background_job' } = {}) => {
    const start = toDayStart(day);
    const end = toDayEnd(day);

    const [activeUsers, jobPosts, applications, acceptedApplications, interviewCompletions, chatEngagement] = await Promise.all([
        User.countDocuments({
            updatedAt: { $gte: start, $lte: end },
            isDeleted: { $ne: true },
        }),
        Job.countDocuments({ createdAt: { $gte: start, $lte: end } }),
        Application.countDocuments({ createdAt: { $gte: start, $lte: end } }),
        Application.countDocuments({
            status: {
                $in: [
                    'interview_completed',
                    'offer_sent',
                    'offer_accepted',
                    'hired',
                    // Legacy compatibility.
                    'accepted',
                ],
            },
            updatedAt: { $gte: start, $lte: end },
        }),
        Event.countDocuments({
            type: 'interview_complete',
            createdAt: { $gte: start, $lte: end },
        }),
        Message.countDocuments({ createdAt: { $gte: start, $lte: end } }),
    ]);

    const acceptanceRate = applications > 0
        ? Number((acceptedApplications / applications).toFixed(4))
        : 0;

    const row = await DailyMetrics.findOneAndUpdate(
        { day: start },
        {
            $set: {
                activeUsers,
                jobPosts,
                applications,
                acceptanceRate,
                interviewCompletions,
                chatEngagement,
                source,
                computedAt: new Date(),
            },
        },
        { upsert: true, new: true }
    );

    return row;
};

const getLatestDailyMetrics = async ({ limit = 30 } = {}) => DailyMetrics.find({})
    .sort({ day: -1 })
    .limit(Math.max(1, Number(limit) || 30))
    .lean();

module.exports = {
    computeAndStoreDailyMetrics,
    getLatestDailyMetrics,
};
