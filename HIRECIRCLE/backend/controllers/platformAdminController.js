const ApiKey = require('../models/ApiKey');
const ApiAuditLog = require('../models/ApiAuditLog');
const ApiBillingUsage = require('../models/ApiBillingUsage');
const PlatformAuditLog = require('../models/PlatformAuditLog');
const {
    createApiKey,
} = require('../services/externalApiKeyService');
const { appendPlatformAuditLog } = require('../services/platformAuditService');

const sanitizeApiKeyDoc = (doc = null) => {
    if (!doc) return null;
    return {
        id: doc._id,
        keyId: doc.keyId,
        keyPrefix: doc.keyPrefix || doc.keyPattern || null,
        ownerId: doc.ownerId || doc.employerId || null,
        organization: doc.organization || null,
        scope: doc.scope,
        rateLimitTier: doc.rateLimitTier,
        rateLimit: doc.rateLimit,
        isActive: doc.isActive,
        revoked: doc.revoked,
        revokedAt: doc.revokedAt,
        usageCount: doc.usageCount || 0,
        usageMetrics: doc.usageMetrics || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

const generatePlatformApiKey = async (req, res) => {
    try {
        const payload = req.body || {};
        if (!payload.ownerId) {
            return res.status(400).json({ message: 'ownerId is required' });
        }

        const created = await createApiKey({
            ownerId: payload.ownerId,
            scope: payload.scope,
            rateLimitTier: payload.rateLimitTier,
            rateLimit: payload.rateLimit,
            allowedDomains: payload.allowedDomains,
            organization: payload.organization || null,
            label: payload.label || 'Partner API Key',
        });

        await appendPlatformAuditLog({
            eventType: 'api_key.generated',
            actorType: 'admin',
            actorId: req.admin?._id || req.user?._id || null,
            apiKeyId: created.apiKey._id,
            tenantId: payload.organization || null,
            resourceType: 'api_key',
            resourceId: created.apiKey._id,
            action: 'generate',
            status: 201,
            metadata: {
                ownerId: payload.ownerId,
                scope: created.apiKey.scope,
                rateLimitTier: created.apiKey.rateLimitTier,
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                apiKey: sanitizeApiKeyDoc(created.apiKey),
                rawKey: created.rawKey,
                maskedKey: created.maskedKey,
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to generate API key' });
    }
};

const listPlatformApiKeys = async (req, res) => {
    try {
        const page = Number.parseInt(req.query.page || '1', 10);
        const limit = Math.min(100, Number.parseInt(req.query.limit || '25', 10));
        const skip = (Math.max(1, page) - 1) * limit;

        const query = {};
        if (req.query.ownerId) query.ownerId = req.query.ownerId;
        if (req.query.organization) query.organization = req.query.organization;
        if (req.query.scope) query.scope = req.query.scope;
        if (req.query.active !== undefined) query.isActive = String(req.query.active) === 'true';

        const [rows, total] = await Promise.all([
            ApiKey.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            ApiKey.countDocuments(query),
        ]);

        return res.json({
            success: true,
            data: rows.map((row) => sanitizeApiKeyDoc(row)),
            pagination: {
                total,
                page: Math.max(1, page),
                limit,
                pages: Math.max(1, Math.ceil(total / limit)),
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to list API keys' });
    }
};

const revokePlatformApiKey = async (req, res) => {
    try {
        const apiKeyId = String(req.params.apiKeyId || '').trim();
        const key = await ApiKey.findById(apiKeyId);
        if (!key) {
            return res.status(404).json({ message: 'API key not found' });
        }

        key.revoked = true;
        key.isActive = false;
        key.revokedAt = new Date();
        await key.save();

        await appendPlatformAuditLog({
            eventType: 'api_key.revoked',
            actorType: 'admin',
            actorId: req.admin?._id || req.user?._id || null,
            apiKeyId: key._id,
            tenantId: key.organization || null,
            resourceType: 'api_key',
            resourceId: key._id,
            action: 'revoke',
            status: 200,
        });

        return res.json({
            success: true,
            data: sanitizeApiKeyDoc(key),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to revoke API key' });
    }
};

const rotatePlatformApiKey = async (req, res) => {
    try {
        const apiKeyId = String(req.params.apiKeyId || '').trim();
        const existing = await ApiKey.findById(apiKeyId);
        if (!existing) {
            return res.status(404).json({ message: 'API key not found' });
        }

        existing.revoked = true;
        existing.isActive = false;
        existing.revokedAt = new Date();
        await existing.save();

        const created = await createApiKey({
            ownerId: existing.ownerId || existing.employerId,
            scope: existing.scope,
            rateLimitTier: existing.rateLimitTier,
            rateLimit: existing.rateLimit,
            allowedDomains: existing.allowedDomains,
            organization: existing.organization || null,
            label: existing.label || 'Rotated API Key',
        });

        await appendPlatformAuditLog({
            eventType: 'api_key.rotated',
            actorType: 'admin',
            actorId: req.admin?._id || req.user?._id || null,
            apiKeyId: created.apiKey._id,
            tenantId: existing.organization || null,
            resourceType: 'api_key',
            resourceId: created.apiKey._id,
            action: 'rotate',
            status: 201,
            metadata: {
                previousApiKeyId: String(existing._id),
            },
        });

        return res.json({
            success: true,
            data: {
                newApiKey: sanitizeApiKeyDoc(created.apiKey),
                rawKey: created.rawKey,
                maskedKey: created.maskedKey,
                previousApiKeyId: existing._id,
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to rotate API key' });
    }
};

const getPlatformApiKeyUsage = async (req, res) => {
    try {
        const apiKeyId = String(req.params.apiKeyId || '').trim();

        const [apiKey, recentCalls, billingRows, auditRows] = await Promise.all([
            ApiKey.findById(apiKeyId).lean(),
            ApiAuditLog.find({ apiKeyId }).sort({ timestamp: -1 }).limit(200).lean(),
            ApiBillingUsage.find({ apiKeyId }).sort({ monthBucket: -1 }).limit(12).lean(),
            PlatformAuditLog.find({ apiKeyId }).sort({ createdAt: -1 }).limit(200).lean(),
        ]);

        if (!apiKey) {
            return res.status(404).json({ message: 'API key not found' });
        }

        return res.json({
            success: true,
            data: {
                apiKey: sanitizeApiKeyDoc(apiKey),
                recentCalls,
                billing: billingRows,
                platformAudit: auditRows,
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to fetch API key usage' });
    }
};

module.exports = {
    generatePlatformApiKey,
    listPlatformApiKeys,
    revokePlatformApiKey,
    rotatePlatformApiKey,
    getPlatformApiKeyUsage,
};
