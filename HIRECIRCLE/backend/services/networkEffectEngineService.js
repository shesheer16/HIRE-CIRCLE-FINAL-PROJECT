const Application = require('../models/Application');
const Notification = require('../models/Notification');
const User = require('../models/userModel');

const hasRecentNudge = async ({ userId, nudgeType, windowHours = 24 }) => {
    const since = new Date(Date.now() - (windowHours * 60 * 60 * 1000));
    const found = await Notification.findOne({
        user: userId,
        type: 'network_effect_nudge',
        'relatedData.nudgeType': nudgeType,
        createdAt: { $gte: since },
    })
        .select('_id')
        .lean();

    return Boolean(found?._id);
};

const triggerInviteColleagueLoop = async ({ userId, successfulHires }) => {
    const nudgeType = 'invite_past_colleagues';
    const alreadySent = await hasRecentNudge({ userId, nudgeType, windowHours: 72 });
    if (alreadySent) return false;

    await Notification.create({
        user: userId,
        type: 'network_effect_nudge',
        title: 'Invite past colleagues',
        message: 'You have multiple successful hires. Invite trusted colleagues to compound your network advantage.',
        relatedData: {
            nudgeType,
            successfulHires,
        },
        isRead: false,
    });

    return true;
};

const triggerPremiumUpsellLoop = async ({ userId, repeatHireCount }) => {
    const user = await User.findById(userId).select('subscription.plan').lean();
    if (!user) return false;

    const plan = String(user?.subscription?.plan || 'free').toLowerCase();
    if (plan !== 'free') return false;

    const nudgeType = 'employer_repeat_hire_premium';
    const alreadySent = await hasRecentNudge({ userId, nudgeType, windowHours: 72 });
    if (alreadySent) return false;

    await Notification.create({
        user: userId,
        type: 'network_effect_nudge',
        title: 'Upgrade to premium hiring lanes',
        message: 'You hire repeatedly. Unlock premium subscription to accelerate repeated hiring with priority routing.',
        relatedData: {
            nudgeType,
            repeatHireCount,
        },
        isRead: false,
    });

    return true;
};

const runNetworkEffectLoopsForUser = async ({ userId }) => {
    if (!userId) return { triggered: [] };

    const [workerHires, employerHires, recentEmployerHires] = await Promise.all([
        (async () => {
            const workerProfile = await require('../models/WorkerProfile').findOne({ user: userId }).select('_id').lean();
            if (!workerProfile?._id) return 0;
            return Application.countDocuments({ worker: workerProfile._id, status: 'hired' });
        })(),
        Application.countDocuments({ employer: userId, status: 'hired' }),
        Application.countDocuments({
            employer: userId,
            status: 'hired',
            updatedAt: { $gte: new Date(Date.now() - (120 * 24 * 60 * 60 * 1000)) },
        }),
    ]);

    const successfulHires = Number(workerHires || 0) + Number(employerHires || 0);
    const triggered = [];

    if (successfulHires > 3) {
        const sent = await triggerInviteColleagueLoop({ userId, successfulHires });
        if (sent) triggered.push('invite_past_colleagues');
    }

    if (Number(recentEmployerHires || 0) >= 4) {
        const sent = await triggerPremiumUpsellLoop({
            userId,
            repeatHireCount: Number(recentEmployerHires || 0),
        });
        if (sent) triggered.push('premium_subscription_suggestion');
    }

    return {
        userId: String(userId),
        successfulHires,
        repeatEmployerHires: Number(recentEmployerHires || 0),
        triggered,
    };
};

module.exports = {
    runNetworkEffectLoopsForUser,
};
