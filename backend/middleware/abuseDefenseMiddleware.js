const { enforceAbuseAction } = require('../services/abuseDefenseService');

const abuseDefenseGuard = (action = 'unknown') => async (req, res, next) => {
    try {
        const userId = req.user?._id;
        if (!userId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const result = await enforceAbuseAction({ userId, action });
        if (!result.allowed) {
            return res.status(429).json({
                message: result.reason,
                abuseSignals: result.result?.signals || [],
                blocked: true,
            });
        }

        req.abuseDefense = result.result || null;
        return next();
    } catch (error) {
        return res.status(500).json({ message: 'Abuse defense guard failed' });
    }
};

module.exports = {
    abuseDefenseGuard,
};
