const express = require('express');
const { requireAdminControl } = require('../middleware/adminControlMiddleware');

const {
    generatePlatformApiKey,
    listPlatformApiKeys,
    revokePlatformApiKey,
    rotatePlatformApiKey,
    getPlatformApiKeyUsage,
} = require('../controllers/platformAdminController');

const router = express.Router();

router.use(requireAdminControl);

router.post('/api-keys', generatePlatformApiKey);
router.get('/api-keys', listPlatformApiKeys);
router.post('/api-keys/:apiKeyId/revoke', revokePlatformApiKey);
router.post('/api-keys/:apiKeyId/rotate', rotatePlatformApiKey);
router.get('/api-keys/:apiKeyId/usage', getPlatformApiKeyUsage);

module.exports = router;
