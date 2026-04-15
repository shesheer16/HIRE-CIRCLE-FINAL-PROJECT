const express = require('express');
const router = express.Router();
const {
    getEmployerHiringFunnel,
    getEmployerJobPerformance,
    getCohorts,
    getLTVPrediction,
    getExecutiveDashboard,
    getEmployerFillRateMeter,
    getCityHiringQuality,
    getRevenueLoops,
    getMatchQualityOverview,
    getMatchQualityDetail,
    getSmartInterviewQuality,
    getRegionMetrics,
} = require('../controllers/analyticsController');
const { trackEvent } = require('../controllers/eventController');
const { protect } = require('../middleware/authMiddleware');
const { isDegradationActive } = require('../services/degradationService');

const requireAnalyticsCapacity = (req, res, next) => {
    if (isDegradationActive('heavyAnalyticsPaused')) {
        return res.status(503).json({
            success: false,
            message: 'Heavy analytics is temporarily paused due to system load.',
        });
    }
    return next();
};

router.get('/employer/:employerId/hiring-funnel', protect, requireAnalyticsCapacity, getEmployerHiringFunnel);
router.get('/employer/:employerId/job-performance', protect, requireAnalyticsCapacity, getEmployerJobPerformance);
router.get('/employer/:employerId/fill-rate-meter', protect, requireAnalyticsCapacity, getEmployerFillRateMeter);
router.get('/city-hiring-quality', protect, requireAnalyticsCapacity, getCityHiringQuality);
router.get('/revenue-loops', protect, requireAnalyticsCapacity, getRevenueLoops);
router.get('/match-quality-overview', protect, requireAnalyticsCapacity, getMatchQualityOverview);
router.get('/match-quality-detail', protect, requireAnalyticsCapacity, getMatchQualityDetail);
router.get('/smart-interview-quality', protect, requireAnalyticsCapacity, getSmartInterviewQuality);
router.get('/region-metrics', protect, requireAnalyticsCapacity, getRegionMetrics);
router.get('/cohorts', protect, requireAnalyticsCapacity, getCohorts);
router.get('/ltv/:userId', protect, requireAnalyticsCapacity, getLTVPrediction);
router.get('/executive-dashboard', protect, requireAnalyticsCapacity, getExecutiveDashboard);

router.post('/track', protect, trackEvent);

module.exports = router;
