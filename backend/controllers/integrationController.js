const {
    connectIntegration,
    listIntegrations,
    revokeIntegration,
    refreshIntegrationToken,
} = require('../services/integrationPlatformService');

const connectIntegrationController = async (req, res) => {
    try {
        const payload = req.body || {};
        const integration = await connectIntegration({
            ownerId: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
            name: payload.name,
            type: payload.type,
            provider: payload.provider,
            scopes: payload.scopes,
            oauthCode: payload.oauthCode,
            expiresInSeconds: payload.expiresInSeconds,
        });

        return res.status(201).json({
            success: true,
            data: integration,
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to connect integration' });
    }
};

const listIntegrationsController = async (req, res) => {
    try {
        const rows = await listIntegrations({
            ownerId: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
        });

        return res.json({
            success: true,
            data: rows,
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to list integrations' });
    }
};

const revokeIntegrationController = async (req, res) => {
    try {
        const integration = await revokeIntegration({
            ownerId: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
            integrationId: req.params.integrationId,
        });

        if (!integration) {
            return res.status(404).json({ message: 'Integration not found' });
        }

        return res.json({
            success: true,
            data: integration,
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to revoke integration' });
    }
};

const refreshIntegrationController = async (req, res) => {
    try {
        const refreshed = await refreshIntegrationToken({
            ownerId: req.user._id,
            tenantId: req.tenantContext?.tenantId || null,
            integrationId: req.params.integrationId,
        });

        return res.json({
            success: true,
            data: refreshed,
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to refresh integration token' });
    }
};

module.exports = {
    connectIntegrationController,
    listIntegrationsController,
    revokeIntegrationController,
    refreshIntegrationController,
};
