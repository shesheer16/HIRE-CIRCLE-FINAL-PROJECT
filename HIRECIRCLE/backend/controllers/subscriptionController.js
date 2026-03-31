const { getActiveSubscription, upsertSubscription, FEATURES, hasFeatureAccess } = require('../services/subscriptionService');

const getMySubscription = async (req, res) => {
    try {
        const subscription = await getActiveSubscription({ userId: req.user._id });
        const features = {
            premiumBadge: await hasFeatureAccess({ userId: req.user._id, feature: FEATURES.PREMIUM_BADGE }),
            unlimitedApplications: await hasFeatureAccess({ userId: req.user._id, feature: FEATURES.UNLIMITED_APPLICATIONS }),
            priorityListing: await hasFeatureAccess({ userId: req.user._id, feature: FEATURES.PRIORITY_LISTING }),
            analyticsAccess: await hasFeatureAccess({ userId: req.user._id, feature: FEATURES.ANALYTICS_ACCESS }),
        };

        return res.json({
            success: true,
            subscription,
            features,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch subscription' });
    }
};

const upsertUserSubscription = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        const planType = String(req.body?.planType || 'free').trim().toLowerCase();
        const status = String(req.body?.status || 'active').trim().toLowerCase();
        const startDate = req.body?.startDate ? new Date(req.body.startDate) : new Date();
        const expiryDate = req.body?.expiryDate ? new Date(req.body.expiryDate) : null;

        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const subscription = await upsertSubscription({
            userId,
            planType,
            status,
            startDate,
            expiryDate,
            metadata: {
                updatedByAdmin: req.admin?._id || null,
            },
        });

        return res.json({
            success: true,
            subscription,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update subscription' });
    }
};

module.exports = {
    getMySubscription,
    upsertUserSubscription,
};
