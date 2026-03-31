const express = require('express');

const {
    getPublicJobsV3,
    postExternalApplication,
    getEmployerPublicProfile,
    getTrustBadgeInfo,
    getSkillReputationSummary,
    registerEmployerWebhook,
    listEmployerWebhooks,
} = require('../controllers/publicV3Controller');
const { applyPublicApiGuard } = require('../middleware/publicApiV3Middleware');

const router = express.Router();

router.get('/jobs', applyPublicApiGuard('jobs'), getPublicJobsV3);
router.post('/applications', applyPublicApiGuard('applications'), postExternalApplication);
router.get('/employers/:employerId/profile', applyPublicApiGuard('profiles'), getEmployerPublicProfile);
router.get('/trust-badges/:userId', applyPublicApiGuard('profiles'), getTrustBadgeInfo);
router.get('/skills/:workerId/reputation', applyPublicApiGuard('profiles'), getSkillReputationSummary);
router.post('/webhooks', applyPublicApiGuard('applications'), registerEmployerWebhook);
router.get('/webhooks', applyPublicApiGuard('profiles'), listEmployerWebhooks);

module.exports = router;
