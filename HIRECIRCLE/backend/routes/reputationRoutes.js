const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getMyReputation,
    getUserReputation,
    getMyTrustExplanation,
    endorse,
    getEndorsements,
    getMyHireHistory,
    rateHireRecord,
    adminRecomputeReputation,
    adminSyncHireRecordFromApplication,
    adminScanNetworkRisks,
    adminListNetworkRiskFlags,
    adminComputeCommunityTrust,
    adminOverrideUserBadges,
} = require('../controllers/reputationController');

router.get('/me', protect, getMyReputation);
router.get('/me/explanation', protect, getMyTrustExplanation);
router.get('/me/hire-history', protect, getMyHireHistory);
router.post('/endorsements', protect, endorse);
router.get('/endorsements/:userId', protect, getEndorsements);
router.post('/hire-records/:hireRecordId/rate', protect, rateHireRecord);
router.get('/users/:userId', protect, getUserReputation);

router.post('/admin/recompute/:userId', protect, admin, adminRecomputeReputation);
router.post('/admin/sync-hire-record/:applicationId', protect, admin, adminSyncHireRecordFromApplication);
router.post('/admin/network-risk/scan', protect, admin, adminScanNetworkRisks);
router.get('/admin/network-risk/flags', protect, admin, adminListNetworkRiskFlags);
router.post('/admin/community/:circleId/trust', protect, admin, adminComputeCommunityTrust);
router.post('/admin/badges/:userId/override', protect, admin, adminOverrideUserBadges);

module.exports = router;
