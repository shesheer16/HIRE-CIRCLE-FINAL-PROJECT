const express = require('express');
const router = express.Router();
const {
    getPlatformStats,
    getAllUsers,
    getAllJobs,
    getAllReports,
    reviewReport,
    dismissReport,
    getPlatformMetrics,
    banUser,
    disableJob,
    updateFeatureToggle,
    generateBetaCodes,
    createCityPipelineEntry,
    getCityPipelineEntries,
    updateCityPipelineEntry,
    getCityPipelineSummary,
    getMatchReport,
    getMatchCalibrationSuggestions,
    getMatchPerformanceAlertsController,
    getCityLiquidity,
    getCityExpansionSignalsController,
    getMarketAlertsController,
    getMarketControlOverview,
    getMarketInsightsController,
    getCompetitiveThreatSignalsController,
    getHiringTrajectoryController,
} = require('../controllers/adminController');
const {
    adminIntelligenceDashboard,
    adminStressValidation,
} = require('../controllers/aiOptimizationController');
const { getFeedback } = require('../controllers/betaFeedbackController');
const { requireAdminControl } = require('../middleware/adminControlMiddleware');

router.use(requireAdminControl);

router.get('/stats', getPlatformStats);
router.get('/users', getAllUsers);
router.get('/jobs', getAllJobs);
router.get('/reports', getAllReports);
router.patch('/reports/:id', reviewReport);
router.put('/reports/:id/dismiss', dismissReport);
router.get('/metrics', getPlatformMetrics);
router.patch('/ban-user', banUser);
router.patch('/disable-job', disableJob);
router.patch('/feature-toggle', updateFeatureToggle);
router.get('/feedback', getFeedback);
router.post('/beta-codes', generateBetaCodes);
router.post('/city-pipeline', createCityPipelineEntry);
router.get('/city-pipeline', getCityPipelineEntries);
router.get('/city-pipeline/summary', getCityPipelineSummary);
router.put('/city-pipeline/:id', updateCityPipelineEntry);
router.get('/match-report', getMatchReport);
router.get('/match-calibration-suggestions', getMatchCalibrationSuggestions);
router.get('/match-performance-alerts', getMatchPerformanceAlertsController);
router.get('/city-liquidity', getCityLiquidity);
router.get('/city-expansion-signals', getCityExpansionSignalsController);
router.get('/market-alerts', getMarketAlertsController);
router.get('/market-control', getMarketControlOverview);
router.get('/market-insights', getMarketInsightsController);
router.get('/competitive-threat-signals', getCompetitiveThreatSignalsController);
router.get('/hiring-trajectories', getHiringTrajectoryController);
router.get('/intelligence-dashboard', adminIntelligenceDashboard);
router.get('/intelligence-stress-validation', adminStressValidation);

module.exports = router;
