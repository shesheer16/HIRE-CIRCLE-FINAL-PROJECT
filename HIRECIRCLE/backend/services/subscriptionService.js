const Subscription = require('../models/Subscription');
const User = require('../models/userModel');
const { getFeatureFlag } = require('./featureFlagService');

const PLAN_RANK = {
    free: 0,
    pro: 1,
    enterprise: 2,
};

const FEATURES = {
    PREMIUM_BADGE: 'premium_badge',
    UNLIMITED_APPLICATIONS: 'unlimited_applications',
    PRIORITY_LISTING: 'priority_listing',
    ANALYTICS_ACCESS: 'analytics_access',
};

const planIncludesFeature = (planType, feature) => {
    const rank = PLAN_RANK[String(planType || 'free')] || 0;

    if (feature === FEATURES.PREMIUM_BADGE) return rank >= 1;
    if (feature === FEATURES.UNLIMITED_APPLICATIONS) return rank >= 1;
    if (feature === FEATURES.PRIORITY_LISTING) return rank >= 1;
    if (feature === FEATURES.ANALYTICS_ACCESS) return rank >= 1;
    return false;
};

const resolveLegacyPlan = (userDoc) => {
    const plan = String(userDoc?.subscription?.plan || 'free').toLowerCase();
    if (plan === 'enterprise') return 'enterprise';
    if (plan === 'pro') return 'pro';
    return 'free';
};

const getActiveSubscription = async ({ userId }) => {
    if (!userId) return null;

    const now = new Date();
    const row = await Subscription.findOne({
        userId,
        status: { $in: ['active', 'trial'] },
        $or: [
            { expiryDate: null },
            { expiryDate: { $gt: now } },
        ],
    })
        .sort({ createdAt: -1 })
        .lean();

    if (row) {
        return {
            source: 'subscription_model',
            planType: row.planType,
            status: row.status,
            startDate: row.startDate,
            expiryDate: row.expiryDate,
            featureOverrides: row.featureOverrides || {},
        };
    }

    const user = await User.findById(userId).select('subscription').lean();
    const legacyPlan = resolveLegacyPlan(user);
    return {
        source: 'user_model',
        planType: legacyPlan,
        status: legacyPlan === 'free' ? 'inactive' : 'active',
        startDate: null,
        expiryDate: user?.subscription?.nextBillingDate || null,
        featureOverrides: {},
    };
};

const hasFeatureAccess = async ({ userId, feature }) => {
    if ([
        FEATURES.PREMIUM_BADGE,
        FEATURES.UNLIMITED_APPLICATIONS,
        FEATURES.PRIORITY_LISTING,
        FEATURES.ANALYTICS_ACCESS,
    ].includes(feature)) {
        const premiumFeaturesEnabled = await getFeatureFlag('PREMIUM_FEATURES', true);
        if (!premiumFeaturesEnabled) {
            return false;
        }
    }

    const subscription = await getActiveSubscription({ userId });
    if (!subscription) return false;

    const override = subscription.featureOverrides?.[feature];
    if (typeof override === 'boolean') {
        return override;
    }

    return planIncludesFeature(subscription.planType, feature);
};

const upsertSubscription = async ({ userId, planType = 'free', status = 'active', startDate = new Date(), expiryDate = null, metadata = {} }) => {
    if (!userId) throw new Error('userId is required');

    return Subscription.findOneAndUpdate(
        { userId },
        {
            $set: {
                planType,
                status,
                startDate,
                expiryDate,
                metadata,
            },
        },
        { upsert: true, new: true }
    );
};

module.exports = {
    FEATURES,
    getActiveSubscription,
    hasFeatureAccess,
    upsertSubscription,
};
