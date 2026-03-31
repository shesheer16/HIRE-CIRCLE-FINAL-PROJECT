const User = require('../models/userModel');
const UserFeatureUsage = require('../models/UserFeatureUsage');

const POWER_USER_THRESHOLDS = {
    worker: 25,
    employer: 15,
};

const PLAN_PROMPTS = {
    worker: {
        title: 'Unlock more matches with Pro',
        message: 'You are using Hire frequently. Upgrade to access advanced match visibility and priority profile boosts.',
    },
    employer: {
        title: 'Scale hiring faster with Pro',
        message: 'Your team is actively hiring. Upgrade to unlock higher active jobs, premium insights, and faster talent discovery.',
    },
};

const recordFeatureUsage = async ({ userId, featureKey, increment = 1, metadata = {} }) => {
    if (!userId || !featureKey) return null;

    return UserFeatureUsage.findOneAndUpdate(
        { user: userId, featureKey: String(featureKey).trim() },
        {
            $setOnInsert: {
                user: userId,
                featureKey: String(featureKey).trim(),
            },
            $inc: {
                usageCount: Math.max(1, Number(increment || 1)),
            },
            $set: {
                lastUsedAt: new Date(),
                metadata,
            },
        },
        { upsert: true, new: true }
    ).lean();
};

const getUserUsageSummary = async ({ userId }) => {
    const rows = await UserFeatureUsage.find({ user: userId })
        .sort({ usageCount: -1, lastUsedAt: -1 })
        .lean();

    const totalUsage = rows.reduce((sum, row) => sum + Number(row.usageCount || 0), 0);

    return {
        totalUsage,
        topFeatures: rows.slice(0, 5).map((row) => ({
            featureKey: row.featureKey,
            usageCount: Number(row.usageCount || 0),
            lastUsedAt: row.lastUsedAt,
        })),
        allFeatures: rows,
    };
};

const detectPowerUser = ({ totalUsage, role = 'worker' }) => {
    const normalizedRole = String(role || 'worker').toLowerCase() === 'employer' ? 'employer' : 'worker';
    const threshold = POWER_USER_THRESHOLDS[normalizedRole];
    return Number(totalUsage || 0) >= threshold;
};

const getMonetizationIntelligence = async ({ userId }) => {
    const user = await User.findById(userId)
        .select('subscription.plan activeRole role')
        .lean();
    if (!user) return null;

    const summary = await getUserUsageSummary({ userId });
    const role = String(user.activeRole || user.role || 'worker').toLowerCase() === 'employer'
        ? 'employer'
        : 'worker';
    const powerUser = detectPowerUser({ totalUsage: summary.totalUsage, role });
    const plan = String(user?.subscription?.plan || 'free').toLowerCase();
    const shouldPromptUpgrade = plan === 'free' && powerUser;

    return {
        role,
        plan,
        usage: summary,
        powerUser,
        shouldPromptUpgrade,
        upgradePrompt: shouldPromptUpgrade
            ? {
                ...PLAN_PROMPTS[role],
                cta: 'Upgrade Plan',
            }
            : null,
    };
};

module.exports = {
    recordFeatureUsage,
    getUserUsageSummary,
    detectPowerUser,
    getMonetizationIntelligence,
};
