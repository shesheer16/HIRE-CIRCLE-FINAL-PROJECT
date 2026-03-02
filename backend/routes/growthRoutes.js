const express = require('express');
const router = express.Router();
const {
    getReferralStats,
    getReferralDashboardController,
    getReferralInviteLinkController,
    getShareableJobLink,
    getShareableProfileLink,
    getShareableCommunityLink,
    getShareableBountyLink,
    submitReferral,
    getExperimentAssignment,
    upsertExperimentController,
    getGrowthMetrics,
    computeGrowthMetrics,
    getConversionNudgesController,
    getMonetizationIntelligenceController,
    getNetworkScoreController,
    getFunnelVisualizationController,
    getPublicWorkerProfile,
    getPublicEmployerProfile,
    getPublicJobPage,
    getPublicCommunityPage,
} = require('../controllers/growthController');
const { protect } = require('../middleware/authMiddleware');

router.get('/referrals', protect, getReferralStats);
router.get('/referrals/dashboard', protect, getReferralDashboardController);
router.get('/referrals/invite-link', protect, getReferralInviteLinkController);
router.post('/referrals', protect, submitReferral);

router.get('/share-link/profile', protect, getShareableProfileLink);
router.get('/share-link/job/:jobId', protect, getShareableJobLink);
router.get('/share-link/community/:circleId', protect, getShareableCommunityLink);
router.get('/share-link/bounty/:postId', protect, getShareableBountyLink);

router.get('/experiments/:key/assignment', protect, getExperimentAssignment);
router.post('/experiments', protect, upsertExperimentController);

router.get('/metrics', protect, getGrowthMetrics);
router.post('/metrics/compute', protect, computeGrowthMetrics);
router.get('/conversion-nudges', protect, getConversionNudgesController);
router.get('/monetization-intelligence', protect, getMonetizationIntelligenceController);
router.get('/network-score', protect, getNetworkScoreController);
router.get('/funnel', protect, getFunnelVisualizationController);

// Public SEO endpoints (no auth)
router.get('/public/workers/:slug', getPublicWorkerProfile);
router.get('/public/employers/:slug', getPublicEmployerProfile);
router.get('/public/jobs/:slug', getPublicJobPage);
router.get('/public/community/:slug', getPublicCommunityPage);

module.exports = router;
