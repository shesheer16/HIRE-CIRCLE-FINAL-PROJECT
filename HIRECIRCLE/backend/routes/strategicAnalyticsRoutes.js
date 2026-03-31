const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getStrategicDashboard,
    getStrategicInsights,
    triggerStrategicAggregation,
} = require('../controllers/strategicAnalyticsController');

const router = express.Router();

router.get('/dashboard', protect, admin, getStrategicDashboard);
router.get('/insights', protect, admin, getStrategicInsights);
router.post('/run-daily', protect, admin, triggerStrategicAggregation);

module.exports = router;
