const express = require('express');

const {
    platformMatch,
    platformPredictFill,
    platformPredictRetention,
    platformCityLiquidity,
} = require('../controllers/platformController');
const {
    platformMatchOutcome,
    platformAdaptiveWeights,
    platformBehaviorProfile,
    platformInterviewQuality,
    platformHiringProbability,
    platformChurnRisk,
    platformJobSuccess,
    platformFeedIntelligence,
    platformAnomalyScan,
    platformExplainDecision,
} = require('../controllers/aiOptimizationController');
const {
    platformApiKeyGuard,
    platformApiOptionsHandler,
} = require('../middleware/platformApiMiddleware');
const { enforcePlatformReadProtection } = require('../services/dataProtectionService');

const router = express.Router();

router.use(async (req, res, next) => {
    if (req.method === 'OPTIONS') {
        return platformApiOptionsHandler(req, res);
    }
    return next();
});
router.use(platformApiKeyGuard);
router.use(enforcePlatformReadProtection);

router.post('/match', platformMatch);
router.post('/predict-fill', platformPredictFill);
router.get('/predict-fill', platformPredictFill);
router.post('/predict-retention', platformPredictRetention);
router.get('/city-liquidity', platformCityLiquidity);
router.post('/ai/match-outcome', platformMatchOutcome);
router.get('/ai/adaptive-weights', platformAdaptiveWeights);
router.post('/ai/behavior-profile', platformBehaviorProfile);
router.post('/ai/interview-quality', platformInterviewQuality);
router.post('/ai/hiring-probability', platformHiringProbability);
router.post('/ai/churn-risk', platformChurnRisk);
router.post('/ai/job-success', platformJobSuccess);
router.post('/ai/feed-ranking', platformFeedIntelligence);
router.post('/ai/anomaly-scan', platformAnomalyScan);
router.post('/ai/explain-decision', platformExplainDecision);

module.exports = router;
