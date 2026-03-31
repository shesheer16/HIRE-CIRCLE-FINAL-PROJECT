const express = require('express');

const {
    getTrustGraphBreakdown,
    recomputeMoatState,
    bootstrapHireFeedback,
    submitHireFeedback,
    getHireFeedbackStatusController,
    getOrCreateEnterpriseWorkspaceController,
    bulkImportEnterpriseJobsController,
    upsertEnterpriseTeamMemberController,
    getEnterpriseCollaborationController,
    getEnterpriseAnalyticsController,
    getEnterpriseSlaController,
    computeRegionDominanceController,
    getRegionDominanceController,
    runAbuseDetectionController,
    runNetworkEffectLoopsController,
    runScaleSimulationController,
    getStrategicCompetitorCheck,
} = require('../controllers/moatController');
const { protect, employer } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/trust-breakdown', protect, getTrustGraphBreakdown);
router.post('/recompute', protect, recomputeMoatState);

router.post('/feedback/bootstrap', protect, bootstrapHireFeedback);
router.post('/feedback/submit', protect, submitHireFeedback);
router.get('/feedback/:applicationId', protect, getHireFeedbackStatusController);

router.post('/enterprise/workspace', protect, employer, getOrCreateEnterpriseWorkspaceController);
router.post('/enterprise/bulk-import', protect, employer, bulkImportEnterpriseJobsController);
router.post('/enterprise/team-member', protect, employer, upsertEnterpriseTeamMemberController);
router.get('/enterprise/collaboration', protect, employer, getEnterpriseCollaborationController);
router.get('/enterprise/analytics', protect, employer, getEnterpriseAnalyticsController);
router.get('/enterprise/sla', protect, employer, getEnterpriseSlaController);

router.post('/market/region-dominance/compute', protect, computeRegionDominanceController);
router.get('/market/region-dominance', protect, getRegionDominanceController);

router.post('/abuse/evaluate', protect, runAbuseDetectionController);
router.post('/network-effect/run', protect, runNetworkEffectLoopsController);

router.get('/competitor-check', protect, getStrategicCompetitorCheck);
router.post('/scale/simulate', protect, runScaleSimulationController);

module.exports = router;
