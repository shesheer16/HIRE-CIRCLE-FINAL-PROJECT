const { enforceTrustForAction } = require('../services/trustScoreService');

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
        return res.status(500).json({ message: 'Trust guard failed' });
    }
};

module.exports = {
    trustGuard,
};
