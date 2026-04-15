const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const { Webhook, WEBHOOK_EVENT_TYPES } = require('../models/Webhook');
const WebhookDeliveryLog = require('../models/WebhookDeliveryLog');
const ApiAuditLog = require('../models/ApiAuditLog');
const { Integration, INTEGRATION_TYPES } = require('../models/Integration');
const IntegrationToken = require('../models/IntegrationToken');
const { OAuthProvider, OAUTH_PROVIDER_TYPES } = require('../models/OAuthProvider');
const {
    createApiKey,
    revokeApiKey,
    normalizeRateLimitTier,
    normalizeScope,
    BASE_RATE_LIMITS_PER_HOUR,
    hashApiKey,
    getKeyPrefix,
} = require('../services/externalApiKeyService');
const {
    generateWebhookSecret,
    queueWebhookDeliveries,
    buildWebhookTestPayload,
} = require('../services/externalWebhookService');
const { queueIntegrationSyncJob } = require('../services/externalIntegrationService');
const { sendSuccess, sendError } = require('../services/externalResponseService');

const normalizeString = (value = '') => String(value || '').trim();

const validateHttpsUrl = (rawUrl = '') => {
    try {
        const parsed = new URL(String(rawUrl || '').trim());
        if (!['https:', 'http:'].includes(parsed.protocol)) return null;
        return parsed.toString();
    } catch (_error) {
        return null;
    }
};

const listApiKeys = async (req, res) => {
    try {
        const rows = await ApiKey.find({ ownerId: req.user._id })
            .sort({ createdAt: -1 })
            .select('keyPrefix ownerId scope createdAt revoked revokedAt rateLimitTier rateLimit label usageCount lastUsedAt isActive');

        const data = rows.map((row) => ({
            id: row._id,
            keyPrefix: row.keyPrefix,
            scope: row.scope,
            createdAt: row.createdAt,
            revoked: Boolean(row.revoked),
            revokedAt: row.revokedAt,
            rateLimitTier: row.rateLimitTier,
            rateLimitPerHour: row.rateLimitTier === 'enterprise' && Number(row.rateLimit || 0) > 0
                ? Number(row.rateLimit)
                : BASE_RATE_LIMITS_PER_HOUR[row.rateLimitTier] || BASE_RATE_LIMITS_PER_HOUR.basic,
            label: row.label,
            usageCount: Number(row.usageCount || 0),
            lastUsedAt: row.lastUsedAt || null,
            active: Boolean(row.isActive && !row.revoked),
        }));

        return sendSuccess(res, {
            data,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'API_KEY_LIST_FAILED',
            message: 'Failed to list API keys',
            requestId: req.correlationId || null,
        });
    }
};

const generateApiKey = async (req, res) => {
    try {
        const scope = normalizeScope(req.body?.scope);
        const rateLimitTier = normalizeRateLimitTier(req.body?.rateLimitTier);
        const rateLimit = Number.parseInt(req.body?.rateLimit, 10);
        const label = normalizeString(req.body?.label || 'External API Key');

        const created = await createApiKey({
            ownerId: req.user._id,
            scope,
            rateLimitTier,
            rateLimit: Number.isFinite(rateLimit) ? rateLimit : null,
            label,
        });

        return sendSuccess(res, {
            status: 201,
            data: {
                id: created.apiKey._id,
                rawKey: created.rawKey,
                maskedKey: created.maskedKey,
                keyPrefix: created.apiKey.keyPrefix,
                scope: created.apiKey.scope,
                rateLimitTier: created.apiKey.rateLimitTier,
                createdAt: created.apiKey.createdAt,
                warning: 'This raw API key is only shown once. Store it securely.',
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'API_KEY_CREATE_FAILED',
            message: 'Failed to create API key',
            requestId: req.correlationId || null,
        });
    }
};

const revokeApiKeyById = async (req, res) => {
    try {
        const apiKeyId = req.params.id;
        const revoked = await revokeApiKey({ apiKeyId, ownerId: req.user._id });
        if (!revoked) {
            return sendError(res, {
                status: 404,
                code: 'API_KEY_NOT_FOUND',
                message: 'API key not found',
                requestId: req.correlationId || null,
            });
        }

        return sendSuccess(res, {
            data: {
                id: revoked._id,
                revoked: true,
                revokedAt: revoked.revokedAt,
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'API_KEY_REVOKE_FAILED',
            message: 'Failed to revoke API key',
            requestId: req.correlationId || null,
        });
    }
};

const listWebhookEventTypes = async (req, res) => {
    return sendSuccess(res, {
        data: WEBHOOK_EVENT_TYPES,
        requestId: req.correlationId || null,
    });
};

const createWebhook = async (req, res) => {
    try {
        const eventType = normalizeString(req.body?.eventType);
        const targetUrl = validateHttpsUrl(req.body?.targetUrl);

        if (!WEBHOOK_EVENT_TYPES.includes(eventType)) {
            return sendError(res, {
                status: 400,
                code: 'WEBHOOK_EVENT_INVALID',
                message: 'Unsupported webhook event type',
                requestId: req.correlationId || null,
            });
        }

        if (!targetUrl) {
            return sendError(res, {
                status: 400,
                code: 'WEBHOOK_TARGET_INVALID',
                message: 'Valid webhook targetUrl is required',
                requestId: req.correlationId || null,
            });
        }

        const webhookSecret = generateWebhookSecret();
        const webhook = await Webhook.create({
            ownerId: req.user._id,
            eventType,
            targetUrl,
            secret: webhookSecret,
            active: true,
        });

        return sendSuccess(res, {
            status: 201,
            data: {
                id: webhook._id,
                ownerId: webhook.ownerId,
                eventType: webhook.eventType,
                targetUrl: webhook.targetUrl,
                active: webhook.active,
                createdAt: webhook.createdAt,
                secret: webhookSecret,
                warning: 'This webhook secret is only shown once. Store it securely.',
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'WEBHOOK_CREATE_FAILED',
            message: 'Failed to create webhook',
            requestId: req.correlationId || null,
        });
    }
};

const listWebhooks = async (req, res) => {
    try {
        const webhooks = await Webhook.find({ ownerId: req.user._id })
            .sort({ createdAt: -1 })
            .select('eventType targetUrl active consecutiveFailures failureThreshold disabledAt createdAt updatedAt lastDeliveryAt');

        return sendSuccess(res, {
            data: webhooks,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'WEBHOOK_LIST_FAILED',
            message: 'Failed to list webhooks',
            requestId: req.correlationId || null,
        });
    }
};

const testWebhook = async (req, res) => {
    try {
        const webhook = await Webhook.findOne({
            _id: req.params.id,
            ownerId: req.user._id,
        }).select('eventType ownerId');

        if (!webhook) {
            return sendError(res, {
                status: 404,
                code: 'WEBHOOK_NOT_FOUND',
                message: 'Webhook not found',
                requestId: req.correlationId || null,
            });
        }

        const payload = buildWebhookTestPayload({
            ownerId: req.user._id,
            eventType: webhook.eventType,
        });

        const queued = await queueWebhookDeliveries({
            ownerId: webhook.ownerId,
            eventType: webhook.eventType,
            payload,
            idempotencySeed: `test:${webhook._id}:${Date.now()}`,
        });

        return sendSuccess(res, {
            data: {
                queued: queued.queued,
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'WEBHOOK_TEST_FAILED',
            message: 'Failed to queue webhook test event',
            requestId: req.correlationId || null,
        });
    }
};

const listWebhookLogs = async (req, res) => {
    try {
        const webhookId = normalizeString(req.query.webhookId);
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));

        const webhookFilter = { ownerId: req.user._id };
        if (webhookId) webhookFilter._id = webhookId;

        const ownerWebhookIds = await Webhook.find(webhookFilter).distinct('_id');

        const logs = await WebhookDeliveryLog.find({
            ownerId: req.user._id,
            webhookId: { $in: ownerWebhookIds },
        })
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('webhookId eventType targetUrl idempotencyKey status responseStatus latency attempt maxAttempts nextRetryAt lastError createdAt updatedAt');

        return sendSuccess(res, {
            data: logs,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'WEBHOOK_LOGS_FETCH_FAILED',
            message: 'Failed to fetch webhook logs',
            requestId: req.correlationId || null,
        });
    }
};

const createIntegration = async (req, res) => {
    try {
        const type = normalizeString(req.body?.type || '').toUpperCase();
        const connector = normalizeString(req.body?.connector || '');

        if (!INTEGRATION_TYPES.includes(type)) {
            return sendError(res, {
                status: 400,
                code: 'INTEGRATION_TYPE_INVALID',
                message: 'Unsupported integration type',
                requestId: req.correlationId || null,
            });
        }

        const connectorByType = {
            ATS: 'generic_ats_sync',
            CRM: 'generic_crm_sync',
            HRIS: 'generic_hris_push',
        };

        const resolvedConnector = connector || connectorByType[type];
        if (!resolvedConnector) {
            return sendError(res, {
                status: 400,
                code: 'INTEGRATION_CONNECTOR_REQUIRED',
                message: 'Connector is required',
                requestId: req.correlationId || null,
            });
        }

        const integration = await Integration.create({
            ownerId: req.user._id,
            name: normalizeString(req.body?.name || `${type} Integration`),
            type,
            connector: resolvedConnector,
            config: req.body?.config || {},
            status: 'active',
            lastSync: null,
            syncError: null,
        });

        await queueIntegrationSyncJob({
            integrationId: integration._id,
            ownerId: req.user._id,
            trigger: 'create',
        });

        return sendSuccess(res, {
            status: 201,
            data: integration,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_CREATE_FAILED',
            message: 'Failed to create integration',
            requestId: req.correlationId || null,
        });
    }
};

const listIntegrations = async (req, res) => {
    try {
        const rows = await Integration.find({ ownerId: req.user._id })
            .sort({ createdAt: -1 })
            .select('name type connector status config lastSync syncError createdAt updatedAt');

        return sendSuccess(res, {
            data: rows,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_LIST_FAILED',
            message: 'Failed to list integrations',
            requestId: req.correlationId || null,
        });
    }
};

const triggerIntegrationSync = async (req, res) => {
    try {
        const integration = await Integration.findOne({
            _id: req.params.id,
            ownerId: req.user._id,
        }).select('_id ownerId status');

        if (!integration) {
            return sendError(res, {
                status: 404,
                code: 'INTEGRATION_NOT_FOUND',
                message: 'Integration not found',
                requestId: req.correlationId || null,
            });
        }

        await queueIntegrationSyncJob({
            integrationId: integration._id,
            ownerId: integration.ownerId,
            trigger: 'manual',
        });

        return sendSuccess(res, {
            data: {
                queued: true,
                integrationId: integration._id,
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_SYNC_TRIGGER_FAILED',
            message: 'Failed to trigger integration sync',
            requestId: req.correlationId || null,
        });
    }
};

const listApiAuditLogs = async (req, res) => {
    try {
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
        const apiKeyIds = await ApiKey.find({ ownerId: req.user._id }).distinct('_id');

        const logs = await ApiAuditLog.find({ apiKeyId: { $in: apiKeyIds } })
            .sort({ timestamp: -1 })
            .limit(limit)
            .select('apiKeyId endpoint ip responseStatus latency timestamp');

        return sendSuccess(res, {
            data: logs,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'AUDIT_LOGS_FETCH_FAILED',
            message: 'Failed to load API audit logs',
            requestId: req.correlationId || null,
        });
    }
};

const listOAuthProviders = async (req, res) => {
    try {
        const providers = await OAuthProvider.find({ ownerId: req.user._id })
            .sort({ createdAt: -1 })
            .select('provider clientId authUrl tokenUrl scopes active createdAt updatedAt');

        return sendSuccess(res, {
            data: providers,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'OAUTH_PROVIDER_LIST_FAILED',
            message: 'Failed to list OAuth providers',
            requestId: req.correlationId || null,
        });
    }
};

const listIntegrationTokens = async (req, res) => {
    try {
        const integration = await Integration.findOne({
            _id: req.params.id,
            ownerId: req.user._id,
        }).select('_id ownerId');

        if (!integration) {
            return sendError(res, {
                status: 404,
                code: 'INTEGRATION_NOT_FOUND',
                message: 'Integration not found',
                requestId: req.correlationId || null,
            });
        }

        const rows = await IntegrationToken.find({
            integrationId: integration._id,
            ownerId: req.user._id,
        })
            .sort({ createdAt: -1 })
            .select('tokenPrefix scopes revoked expiresAt createdAt updatedAt');

        return sendSuccess(res, {
            data: rows,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_TOKEN_LIST_FAILED',
            message: 'Failed to list integration tokens',
            requestId: req.correlationId || null,
        });
    }
};

const createIntegrationToken = async (req, res) => {
    try {
        const integration = await Integration.findOne({
            _id: req.params.id,
            ownerId: req.user._id,
        }).select('_id ownerId');

        if (!integration) {
            return sendError(res, {
                status: 404,
                code: 'INTEGRATION_NOT_FOUND',
                message: 'Integration not found',
                requestId: req.correlationId || null,
            });
        }

        const rawToken = `int_${crypto.randomBytes(24).toString('hex')}`;
        const tokenHash = hashApiKey(rawToken);
        const tokenPrefix = getKeyPrefix(rawToken);
        const scopes = Array.isArray(req.body?.scopes)
            ? req.body.scopes.map((item) => normalizeString(item)).filter(Boolean)
            : ['sync'];
        const expiresInDays = Number.parseInt(req.body?.expiresInDays, 10);
        const expiresAt = Number.isFinite(expiresInDays) && expiresInDays > 0
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : null;

        const token = await IntegrationToken.create({
            ownerId: req.user._id,
            integrationId: integration._id,
            tokenHash,
            tokenPrefix,
            scopes,
            revoked: false,
            expiresAt,
        });

        return sendSuccess(res, {
            status: 201,
            data: {
                id: token._id,
                tokenPrefix: token.tokenPrefix,
                scopes: token.scopes,
                expiresAt: token.expiresAt,
                rawToken,
                warning: 'This integration token is shown once. Store it securely.',
            },
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_TOKEN_CREATE_FAILED',
            message: 'Failed to create integration token',
            requestId: req.correlationId || null,
        });
    }
};

const revokeIntegrationToken = async (req, res) => {
    try {
        const updated = await IntegrationToken.findOneAndUpdate(
            {
                _id: req.params.tokenId,
                integrationId: req.params.id,
                ownerId: req.user._id,
            },
            {
                $set: { revoked: true },
            },
            { new: true }
        ).select('tokenPrefix revoked updatedAt');

        if (!updated) {
            return sendError(res, {
                status: 404,
                code: 'INTEGRATION_TOKEN_NOT_FOUND',
                message: 'Integration token not found',
                requestId: req.correlationId || null,
            });
        }

        return sendSuccess(res, {
            data: updated,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'INTEGRATION_TOKEN_REVOKE_FAILED',
            message: 'Failed to revoke integration token',
            requestId: req.correlationId || null,
        });
    }
};

const createOAuthProvider = async (req, res) => {
    try {
        const provider = normalizeString(req.body?.provider).toLowerCase();
        if (!OAUTH_PROVIDER_TYPES.includes(provider)) {
            return sendError(res, {
                status: 400,
                code: 'OAUTH_PROVIDER_INVALID',
                message: 'Unsupported OAuth provider',
                requestId: req.correlationId || null,
            });
        }

        const row = await OAuthProvider.findOneAndUpdate(
            { ownerId: req.user._id, provider },
            {
                $set: {
                    ownerId: req.user._id,
                    provider,
                    clientId: normalizeString(req.body?.clientId),
                    clientSecretRef: normalizeString(req.body?.clientSecretRef) || null,
                    authUrl: normalizeString(req.body?.authUrl) || null,
                    tokenUrl: normalizeString(req.body?.tokenUrl) || null,
                    scopes: Array.isArray(req.body?.scopes) ? req.body.scopes.map((item) => normalizeString(item)).filter(Boolean) : [],
                    active: req.body?.active !== false,
                },
            },
            { new: true, upsert: true }
        ).select('provider clientId authUrl tokenUrl scopes active createdAt updatedAt');

        return sendSuccess(res, {
            status: 201,
            data: row,
            requestId: req.correlationId || null,
        });
    } catch (_error) {
        return sendError(res, {
            status: 500,
            code: 'OAUTH_PROVIDER_CREATE_FAILED',
            message: 'Failed to save OAuth provider',
            requestId: req.correlationId || null,
        });
    }
};

module.exports = {
    listApiKeys,
    generateApiKey,
    revokeApiKeyById,
    listWebhookEventTypes,
    createWebhook,
    listWebhooks,
    testWebhook,
    listWebhookLogs,
    createIntegration,
    listIntegrations,
    triggerIntegrationSync,
    listIntegrationTokens,
    createIntegrationToken,
    revokeIntegrationToken,
    listApiAuditLogs,
    listOAuthProviders,
    createOAuthProvider,
};
