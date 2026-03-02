const express = require('express');

const { protect } = require('../middleware/authMiddleware');
const { attachTenantContext } = require('../middleware/tenantIsolationMiddleware');
const {
    listAgents,
    registerAgent,
    executeAgent,
} = require('../controllers/agentMarketplaceController');

const router = express.Router();

router.use(protect, attachTenantContext);

router.get('/', listAgents);
router.post('/', registerAgent);
router.post('/:agentId/execute', executeAgent);

module.exports = router;
