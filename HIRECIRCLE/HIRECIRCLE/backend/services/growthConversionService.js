const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const { createAndSendBehaviorNotification } = require('./growthNotificationService');

const getConversionNudges = async ({ user }) => {
    if (!user?._id) {
        return {
            nudges: [],
            banner: null,
        };
    }

    const nudges = [];
    const isEmployer = String(user.activeRole || user.primaryRole || '').toLowerCase() === 'employer';

    if (!isEmployer) {
        const workerProfile = await WorkerProfile.findOne({ user: user._id })
            .select('interviewVerified roleProfiles')
            .lean();

        if (!user.hasCompletedProfile) {
            nudges.push({
                key: 'profile_incomplete',
                message: 'Your profile is incomplete. Add a few details to improve discoverability.',
                priority: 'medium',
            });
            nudges.push({
                key: 'match_unlock_banner',
                message: 'Complete profile to unlock more matches.',
                priority: 'low',
            });
        }

        if (!workerProfile?.interviewVerified) {
            nudges.push({
                key: 'interview_incomplete',
                message: 'Finish your Smart Interview to unlock better-ranked opportunities.',
                priority: 'medium',
            });
        }
    } else {
        const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const stalePendingCount = await Application.countDocuments({
            employer: user._id,
            status: { $in: ['applied', 'pending', 'requested'] },
            createdAt: { $lt: staleThreshold },
        });

        if (stalePendingCount > 0) {
            nudges.push({
                key: 'employer_slow_response',
                message: `You have ${stalePendingCount} pending applications waiting for response. Faster replies increase conversion.`,
                priority: 'medium',
            });
        }
    }

    return {
        nudges,
        banner: nudges.find((nudge) => nudge.key === 'match_unlock_banner')?.message || null,
    };
};

const sendEmployerSlowResponseReminders = async ({ maxEmployers = 300, staleHours = 48 } = {}) => {
    const staleThreshold = new Date(Date.now() - staleHours * 60 * 60 * 1000);

    const rows = await Application.aggregate([
        {
            $match: {
                status: { $in: ['applied', 'pending', 'requested'] },
                createdAt: { $lt: staleThreshold },
            },
        },
        {
            $group: {
                _id: '$employer',
                staleCount: { $sum: 1 },
            },
        },
        { $sort: { staleCount: -1 } },
        { $limit: maxEmployers },
    ]);

    const employerIds = rows.map((row) => row._id);
    const users = await User.find({ _id: { $in: employerIds } })
        .select('_id name pushTokens notificationPreferences')
        .lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    let sentCount = 0;

    for (const row of rows) {
        const employer = usersById.get(String(row._id));
        if (!employer) continue;

        const staleCount = Number(row.staleCount || 0);
        const title = 'Applications are waiting';
        const message = `You have ${staleCount} pending applications. Responding sooner improves hiring outcomes.`;

        await createAndSendBehaviorNotification({
            userId: employer._id,
            title,
            message,
            notificationType: 'status_update',
            pushEventType: 'application',
            relatedData: {
                nudgeType: 'employer_slow_response',
                staleCount,
            },
            dedupeKey: `employer_slow_response:${String(employer._id)}`,
            dedupeWindowHours: 24,
        });

        sentCount += 1;
    }

    return {
        targetedEmployers: rows.length,
        sentCount,
    };
};

module.exports = {
    getConversionNudges,
    sendEmployerSlowResponseReminders,
};
