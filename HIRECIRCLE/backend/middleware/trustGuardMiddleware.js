const { enforceTrustForAction } = require('../services/trustScoreService');
const logger = require('../utils/logger');

const trustGuard = (action) => async (req, res, next) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const result = await enforceTrustForAction({
            userId,
            action,
        });

        if (!result.allowed) {
            return res.status(429).json({
                message: result.reason,
                trustStatus: result.trust?.status || null,
                trustScore: result.trust?.score || null,
            });
        }

        req.trust = result.trust || null;
        return next();
    } catch (error) {
        logger.warn('trust_guard_error', {
            action,
            userId: String(req.user?._id || ''),
            message: error?.message || String(error),
        });
        req.trust = null;
        req.trustGuardDegraded = true;
        return next();
    }
};

module.exports = {
    trustGuard,
};
