const { getFeatureFlag } = require('../services/featureFlagService');

const requireFeatureFlag = (flagKey, { fallback = true, message = 'Feature is disabled' } = {}) => async (req, res, next) => {
    try {
        const enabled = await getFeatureFlag(flagKey, fallback);
        if (!enabled) {
            return res.status(403).json({ message });
        }

        return next();
    } catch (error) {
        return res.status(500).json({ message: 'Feature flag check failed' });
    }
};

module.exports = {
    requireFeatureFlag,
};
