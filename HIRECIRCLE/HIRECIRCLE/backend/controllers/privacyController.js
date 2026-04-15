const User = require('../models/userModel');
const { getLegalConfigForCountry } = require('../services/legalConfigService');

const normalizeConsentType = (value) => String(value || '').trim().toLowerCase();

const getPrivacyPolicy = async (req, res) => {
    try {
        const country = String(req.query.country || req.headers['x-country-code'] || 'DEFAULT').trim().toUpperCase();
        const legalConfig = await getLegalConfigForCountry(country);

        return res.json({
            success: true,
            country: legalConfig.country,
            privacyPolicyUrl: legalConfig.privacyURL,
            termsUrl: legalConfig.termsURL,
            complianceFlags: legalConfig.complianceFlags || [],
            metadata: legalConfig.metadata || {},
            effectiveAt: legalConfig.updatedAt || legalConfig.createdAt || new Date().toISOString(),
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to load privacy policy' });
    }
};

const updateConsent = async (req, res) => {
    try {
        const consentType = normalizeConsentType(req.body?.consentType);
        const version = String(req.body?.version || '1.0.0').trim();
        const granted = Boolean(req.body?.granted);

        if (!consentType) {
            return res.status(400).json({ success: false, message: 'consentType is required' });
        }

        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const existingIndex = Array.isArray(user.consentRecords)
            ? user.consentRecords.findIndex((row) => normalizeConsentType(row.consentType) === consentType)
            : -1;

        const payload = {
            consentType,
            version,
            granted,
            grantedAt: new Date(),
            revokedAt: granted ? null : new Date(),
            source: String(req.body?.source || 'app').trim() || 'app',
            ipAddress: req.ip || null,
            userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
        };

        if (existingIndex >= 0) {
            user.consentRecords[existingIndex] = payload;
        } else {
            user.consentRecords.push(payload);
        }

        await user.save();

        return res.json({
            success: true,
            consent: payload,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to update consent' });
    }
};

const scheduleAccountDeletion = async (req, res) => {
    try {
        const graceDays = Math.max(1, Number.parseInt(process.env.ACCOUNT_DELETION_GRACE_DAYS || '14', 10));
        const purgeAfter = new Date(Date.now() + (graceDays * 24 * 60 * 60 * 1000));

        const user = await User.findById(req.user._id);
        if (!user || user.isDeleted) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.deletionLifecycle = {
            status: 'scheduled',
            requestedAt: new Date(),
            purgeAfter,
            cancelledAt: null,
            reason: String(req.body?.reason || 'user_requested').trim() || 'user_requested',
        };
        user.isDeleted = true;
        user.deletedAt = new Date();
        user.notificationPreferences = {
            ...user.notificationPreferences,
            pushEnabled: false,
            smsEnabled: false,
            emailEnabled: false,
        };
        user.pushTokens = [];

        await user.save();

        return res.json({
            success: true,
            message: `Account scheduled for deletion after ${graceDays} day(s).`,
            status: user.deletionLifecycle.status,
            purgeAfter: user.deletionLifecycle.purgeAfter,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to schedule account deletion' });
    }
};

const getDeletionStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('deletionLifecycle deletedAt isDeleted');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.json({
            success: true,
            isDeleted: Boolean(user.isDeleted),
            deletedAt: user.deletedAt || null,
            deletionLifecycle: user.deletionLifecycle || null,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to read deletion status' });
    }
};

module.exports = {
    getPrivacyPolicy,
    updateConsent,
    scheduleAccountDeletion,
    getDeletionStatus,
};
