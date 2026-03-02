const AdminUser = require('../models/AdminUser');
const { issueAdminToken, ensureBootstrapAdmin } = require('../services/adminAuthService');

const adminLogin = async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!email || !password) {
            return res.status(400).json({ message: 'email and password are required' });
        }

        const adminUser = await AdminUser.findOne({ email });
        if (!adminUser || !adminUser.isActive) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        const isValidPassword = await adminUser.matchPassword(password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Invalid admin credentials' });
        }

        adminUser.lastLoginAt = new Date();
        await adminUser.save();

        const token = issueAdminToken(adminUser);
        return res.json({
            success: true,
            token,
            admin: {
                _id: adminUser._id,
                name: adminUser.name,
                email: adminUser.email,
                role: adminUser.role,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Admin login failed' });
    }
};

const bootstrapAdmin = async (req, res) => {
    try {
        const existingCount = await AdminUser.countDocuments({});
        if (existingCount > 0) {
            return res.status(409).json({ message: 'Admin bootstrap already completed' });
        }

        const envAdmin = await ensureBootstrapAdmin();
        if (envAdmin) {
            const token = issueAdminToken(envAdmin);
            return res.status(201).json({
                success: true,
                token,
                admin: {
                    _id: envAdmin._id,
                    name: envAdmin.name,
                    email: envAdmin.email,
                    role: envAdmin.role,
                },
            });
        }

        const name = String(req.body?.name || 'Platform Admin').trim();
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');

        if (!email || !password) {
            return res.status(400).json({ message: 'email and password are required' });
        }

        const adminUser = await AdminUser.create({
            name,
            email,
            password,
            role: 'super_admin',
            isActive: true,
        });

        const token = issueAdminToken(adminUser);
        return res.status(201).json({
            success: true,
            token,
            admin: {
                _id: adminUser._id,
                name: adminUser.name,
                email: adminUser.email,
                role: adminUser.role,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Admin bootstrap failed' });
    }
};

module.exports = {
    adminLogin,
    bootstrapAdmin,
};
