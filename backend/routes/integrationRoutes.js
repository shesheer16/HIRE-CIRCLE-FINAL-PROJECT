const express = require('express');

const { protect } = require('../middleware/authMiddleware');
const {
    attachTenantContext,
    requireTenantResourceAccess,
} = require('../middleware/tenantIsolationMiddleware');
const {
    connectIntegrationController,
    listIntegrationsController,
    revokeIntegrationController,
    refreshIntegrationController,
} = require('../controllers/integrationController');

const router = express.Router();

router.use(protect, attachTenantContext, requireTenantResourceAccess());

router.post('/connect', connectIntegrationController);
router.get('/', listIntegrationsController);
router.post('/:integrationId/revoke', revokeIntegrationController);
router.post('/:integrationId/refresh', refreshIntegrationController);

module.exports = router;
