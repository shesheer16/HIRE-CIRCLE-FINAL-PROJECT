const express = require('express');

const { protect, employer } = require('../middleware/authMiddleware');
const {
    externalSecurityHeaders,
    externalApiKeyAuth,
    requireExternalScope,
    externalTierRateLimit,
    externalReplayGuard,
} = require('../middleware/externalApiMiddleware');
const {
    startAuditTimer,
    persistAuditLogOnFinish,
} = require('../services/externalAuditService');
const {
    getExternalJobs,
    getExternalApplications,
    getExternalCandidates,
    getExternalMatches,
    getExternalAnalytics,
} = require('../controllers/externalApiController');
const {
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
} = require('../controllers/externalDashboardController');

const router = express.Router();

router.use(externalSecurityHeaders);

const externalDataRouter = express.Router();
externalDataRouter.use(startAuditTimer);
externalDataRouter.use(persistAuditLogOnFinish);
externalDataRouter.use(externalApiKeyAuth);
externalDataRouter.use(externalTierRateLimit);
externalDataRouter.use(externalReplayGuard);

externalDataRouter.get('/jobs', requireExternalScope(['read-only', 'jobs', 'full-access']), getExternalJobs);
externalDataRouter.get('/applications', requireExternalScope(['read-only', 'applications', 'full-access']), getExternalApplications);
externalDataRouter.get('/candidates', requireExternalScope(['read-only', 'applications', 'full-access']), getExternalCandidates);
externalDataRouter.get('/matches', requireExternalScope(['read-only', 'applications', 'full-access']), getExternalMatches);
externalDataRouter.get('/analytics', requireExternalScope(['read-only', 'jobs', 'applications', 'full-access']), getExternalAnalytics);

router.use('/', externalDataRouter);

const dashboardRouter = express.Router();
dashboardRouter.use(protect, employer);

dashboardRouter.get('/api-keys', listApiKeys);
dashboardRouter.post('/api-keys', generateApiKey);
dashboardRouter.post('/api-keys/:id/revoke', revokeApiKeyById);

dashboardRouter.get('/webhook-events', listWebhookEventTypes);
dashboardRouter.get('/webhooks', listWebhooks);
dashboardRouter.post('/webhooks', createWebhook);
dashboardRouter.post('/webhooks/:id/test', testWebhook);
dashboardRouter.get('/webhook-logs', listWebhookLogs);

dashboardRouter.get('/integrations', listIntegrations);
dashboardRouter.post('/integrations', createIntegration);
dashboardRouter.post('/integrations/:id/sync', triggerIntegrationSync);
dashboardRouter.get('/integrations/:id/tokens', listIntegrationTokens);
dashboardRouter.post('/integrations/:id/tokens', createIntegrationToken);
dashboardRouter.post('/integrations/:id/tokens/:tokenId/revoke', revokeIntegrationToken);

dashboardRouter.get('/audit-logs', listApiAuditLogs);
dashboardRouter.get('/oauth/providers', listOAuthProviders);
dashboardRouter.post('/oauth/providers', createOAuthProvider);

router.use('/dashboard', dashboardRouter);

module.exports = router;
