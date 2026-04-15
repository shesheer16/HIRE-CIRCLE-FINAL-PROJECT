const crypto = require('crypto');

const { Integration } = require('../models/Integration');
const IntegrationToken = require('../models/IntegrationToken');
const { encryptValue } = require('../utils/secureCrypto');
const { appendPlatformAuditLog } = require('./platformAuditService');

const CONNECTOR_MAP = {
    SLACK: 'slack',
    EMAIL_AUTOMATION: 'email_automation',
    CALENDAR_SYNC: 'calendar_sync',
    CRM_EXPORT: 'crm_export',
    PAYROLL: 'payroll',
    BACKGROUND_CHECK: 'background_check',
};

const normalizeIntegrationType = (type = '') => String(type || '').trim().toUpperCase();

const buildAccessToken = ({ oauthCode, ownerId }) => {
    const seed = `${String(oauthCode || '')}:${String(ownerId || '')}:${Date.now()}`;
    return `itok_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 48)}`;
};

const getTokenPrefix = (token = '') => String(token || '').slice(0, 12);

const hashToken = (token = '') => crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex');

const connectIntegration = async ({
    ownerId,
    tenantId = null,
    name = null,
    type,
    provider = 'generic',
    scopes = [],
    oauthCode,
    expiresInSeconds = 3600,
} = {}) => {
    const normalizedType = normalizeIntegrationType(type);
    const connector = CONNECTOR_MAP[normalizedType];

    if (!connector) {
        throw new Error('Unsupported integration type');
    }

    if (!oauthCode) {
        throw new Error('oauthCode is required');
    }

    const integration = await Integration.create({
        ownerId,
        tenantId,
        name: name || `${normalizedType} Integration`,
        type: normalizedType,
        connector,
        provider,
        oauthSafe: true,
        encryptedTokens: true,
        revokable: true,
        scopes: Array.isArray(scopes) ? scopes : [],
        status: 'active',
        config: {
            authMode: 'oauth2',
            connectedAt: new Date().toISOString(),
        },
    });

    const accessToken = buildAccessToken({ oauthCode, ownerId });
    const encryptedAccessToken = encryptValue(accessToken);

    await IntegrationToken.create({
        ownerId,
        tenantId,
        integrationId: integration._id,
        tokenHash: hashToken(accessToken),
        tokenEncrypted: encryptedAccessToken.encrypted,
        tokenIv: encryptedAccessToken.iv,
        tokenTag: encryptedAccessToken.tag,
        tokenPrefix: getTokenPrefix(accessToken),
        scopes: Array.isArray(scopes) ? scopes : [],
        revoked: false,
        expiresAt: new Date(Date.now() + Math.max(60, Number(expiresInSeconds || 3600)) * 1000),
    });

    await appendPlatformAuditLog({
        eventType: 'integration.connected',
        actorType: 'user',
        actorId: ownerId,
        tenantId,
        resourceType: 'integration',
        resourceId: integration._id,
        action: 'connect',
        status: 201,
        metadata: {
            type: normalizedType,
            provider,
            scopes,
        },
    });

    return integration;
};

const listIntegrations = async ({ ownerId, tenantId = null } = {}) => (
    Integration.find({ ownerId, tenantId }).sort({ createdAt: -1 }).lean()
);

const revokeIntegration = async ({ ownerId, tenantId = null, integrationId } = {}) => {
    const integration = await Integration.findOneAndUpdate(
        {
            _id: integrationId,
            ownerId,
            tenantId,
        },
        {
            $set: {
                status: 'revoked',
            },
        },
        {
            new: true,
        }
    );

    if (!integration) {
        return null;
    }

    await IntegrationToken.updateMany(
        {
            integrationId,
            ownerId,
        },
        {
            $set: {
                revoked: true,
            },
        }
    );

    await appendPlatformAuditLog({
        eventType: 'integration.revoked',
        actorType: 'user',
        actorId: ownerId,
        tenantId,
        resourceType: 'integration',
        resourceId: integrationId,
        action: 'revoke',
        status: 200,
    });

    return integration;
};

const refreshIntegrationToken = async ({ ownerId, tenantId = null, integrationId } = {}) => {
    const integration = await Integration.findOne({
        _id: integrationId,
        ownerId,
        tenantId,
        status: { $in: ['active', 'error'] },
    }).lean();

    if (!integration) {
        throw new Error('Integration not found');
    }

    const tokenRecord = await IntegrationToken.findOne({
        integrationId,
        ownerId,
        revoked: false,
    }).select('+tokenHash +tokenEncrypted +tokenIv +tokenTag +refreshTokenEncrypted +refreshTokenIv +refreshTokenTag');

    if (!tokenRecord) {
        throw new Error('Active integration token not found');
    }

    const refreshedToken = buildAccessToken({
        oauthCode: crypto.randomUUID(),
        ownerId,
    });
    const encrypted = encryptValue(refreshedToken);

    tokenRecord.tokenHash = hashToken(refreshedToken);
    tokenRecord.tokenEncrypted = encrypted.encrypted;
    tokenRecord.tokenIv = encrypted.iv;
    tokenRecord.tokenTag = encrypted.tag;
    tokenRecord.tokenPrefix = getTokenPrefix(refreshedToken);
    tokenRecord.expiresAt = new Date(Date.now() + (60 * 60 * 1000));
    await tokenRecord.save();

    await Integration.findByIdAndUpdate(integrationId, {
        $set: {
            status: 'active',
            syncError: null,
            lastSync: new Date(),
        },
    });

    await appendPlatformAuditLog({
        eventType: 'integration.token_refreshed',
        actorType: 'user',
        actorId: ownerId,
        tenantId,
        resourceType: 'integration',
        resourceId: integrationId,
        action: 'refresh_token',
        status: 200,
    });

    return {
        integrationId,
        expiresAt: tokenRecord.expiresAt,
    };
};

const findExpiredTokens = async ({ limit = 100 } = {}) => {
    const now = new Date();
    return IntegrationToken.find({
        revoked: false,
        expiresAt: { $lte: now },
    })
        .limit(limit)
        .lean();
};

module.exports = {
    connectIntegration,
    listIntegrations,
    revokeIntegration,
    refreshIntegrationToken,
    findExpiredTokens,
};
