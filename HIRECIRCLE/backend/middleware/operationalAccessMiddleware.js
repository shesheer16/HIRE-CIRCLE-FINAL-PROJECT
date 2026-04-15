const AdminUser = require('../models/AdminUser');
const { verifyAdminToken } = require('../services/adminAuthService');

const isProductionRuntime = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const resolveOpsAccessToken = () => String(process.env.OPS_ACCESS_TOKEN || '').trim();

const readBearerToken = (req = {}) => {
    const header = String(req.headers?.authorization || '');
    if (!header.startsWith('Bearer ')) {
        return '';
    }
    return header.slice(7).trim();
};

const isAuthorizedAdminRequest = async (req) => {
    const token = readBearerToken(req);
    if (!token) return false;

    try {
        const payload = verifyAdminToken(token);
        if (String(payload?.scope || '') !== 'admin_control' || !payload?.adminId) {
            return false;
        }

        const adminUser = await AdminUser.findById(payload.adminId).select('_id isActive');
        return Boolean(adminUser?._id && adminUser.isActive);
    } catch (_error) {
        return false;
    }
};

const requireOperationalAccess = async (req, res, next) => {
    if (!isProductionRuntime()) {
        return next();
    }

    const opsAccessToken = resolveOpsAccessToken();
    const providedOpsToken = String(req.headers['x-ops-token'] || '').trim();
    if (opsAccessToken && providedOpsToken && providedOpsToken === opsAccessToken) {
        return next();
    }

    if (await isAuthorizedAdminRequest(req)) {
        return next();
    }

    return res.status(404).json({ message: 'Not found' });
};

module.exports = {
    requireOperationalAccess,
};
