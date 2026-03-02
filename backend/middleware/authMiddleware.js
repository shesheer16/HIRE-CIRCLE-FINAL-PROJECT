const User = require('../models/userModel');
const { isRecruiter } = require('../utils/roleGuards');
const { applyRoleContractToUser } = require('../utils/userRoleContract');
const logger = require('../utils/logger');
const { verifyAccessToken } = require('../utils/tokenService');

const resolveTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const issuedBeforePasswordChange = (decoded = {}, user = {}) => {
    const issuedAtMs = Number(decoded?.iat || 0) * 1000;
    const changedAtMs = user?.passwordChangedAt ? new Date(user.passwordChangedAt).getTime() : 0;
    if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) return false;
    if (!Number.isFinite(changedAtMs) || changedAtMs <= 0) return false;
    return issuedAtMs < (changedAtMs - 1000);
};

const protect = async (req, res, next) => {
    const authorizationHeader = String(req.headers.authorization || '');
    if (!authorizationHeader.toLowerCase().startsWith('bearer ')) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const token = authorizationHeader.slice(7).trim();
    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token' });
    }

    try {
        const decoded = await verifyAccessToken(token);
        const user = await User.findById(decoded.id).select('-password');
        if (!user || user.isDeleted) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        if (user.isBanned) {
            return res.status(403).json({ message: 'Account is banned' });
        }
        const tokenVersion = resolveTokenVersion(decoded?.tv);
        const currentVersion = resolveTokenVersion(user?.tokenVersion);
        if (tokenVersion !== currentVersion) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
        if (issuedBeforePasswordChange(decoded, user)) {
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }

        req.user = applyRoleContractToUser(user);
        req.auth = decoded;
        req.authToken = token;
        return next();
    } catch (error) {
        logger.security({
            event: 'auth_token_verification_failed',
            message: error.message,
            path: req.originalUrl,
            method: req.method,
        });
        return res.status(401).json({ message: 'Not authorized, token failed' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        res.status(403).json({ message: 'Not authorized as an admin' });
    }
};

const employer = (req, res, next) => {
    if (req.user && isRecruiter(req.user)) {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized as an employer' });
    }
};

module.exports = { protect, admin, employer };
