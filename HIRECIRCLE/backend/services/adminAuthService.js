const jwt = require('jsonwebtoken');
const AdminUser = require('../models/AdminUser');

const resolveAdminJwtSecret = () => String(process.env.ADMIN_JWT_SECRET || '').trim();

const issueAdminToken = (adminUser) => {
    const secret = resolveAdminJwtSecret();
    if (!secret) {
        throw new Error('Admin JWT secret is not configured');
    }

    return jwt.sign(
        {
            adminId: String(adminUser?._id || ''),
            scope: 'admin_control',
            role: String(adminUser?.role || 'moderator'),
        },
        secret,
        {
            expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '12h',
        }
    );
};

const verifyAdminToken = (token) => {
    const secret = resolveAdminJwtSecret();
    if (!secret) {
        throw new Error('Admin JWT secret is not configured');
    }

    return jwt.verify(String(token || ''), secret);
};

const ensureBootstrapAdmin = async () => {
    const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
    const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '').trim();
    const name = String(process.env.ADMIN_BOOTSTRAP_NAME || 'Platform Admin').trim();

    if (!email || !password) return null;

    const existing = await AdminUser.findOne({ email });
    if (existing) return existing;

    return AdminUser.create({
        name,
        email,
        password,
        role: 'super_admin',
        isActive: true,
    });
};

module.exports = {
    issueAdminToken,
    verifyAdminToken,
    ensureBootstrapAdmin,
};
