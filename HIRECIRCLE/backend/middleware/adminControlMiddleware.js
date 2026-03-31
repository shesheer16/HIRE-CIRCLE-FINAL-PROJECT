const AdminUser = require('../models/AdminUser');
const { verifyAdminToken } = require('../services/adminAuthService');

const requireAdminControl = async (req, res, next) => {
    try {
        const authHeader = String(req.headers.authorization || '');
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Admin token is required' });
        }

        const token = authHeader.slice(7).trim();
        const payload = verifyAdminToken(token);

        if (String(payload?.scope || '') !== 'admin_control' || !payload?.adminId) {
            return res.status(403).json({ message: 'Invalid admin token scope' });
        }

        const adminUser = await AdminUser.findById(payload.adminId).select('-password');
        if (!adminUser || !adminUser.isActive) {
            return res.status(403).json({ message: 'Admin access denied' });
        }

        req.admin = {
            _id: adminUser._id,
            role: adminUser.role,
            email: adminUser.email,
            name: adminUser.name,
        };

        return next();
    } catch (error) {
        return res.status(401).json({ message: 'Admin authentication failed' });
    }
};

module.exports = {
    requireAdminControl,
};
