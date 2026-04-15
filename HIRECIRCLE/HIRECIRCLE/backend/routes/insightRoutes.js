const express = require('express');
const router = express.Router();
const { getMarketTrends, getCareerPath, getEmployerIntelligence } = require('../controllers/insightController');
const { protect } = require('../middleware/authMiddleware');

router.get('/market-trends', getMarketTrends); // Publicly accessible trends
router.get('/career-path/:userId', protect, getCareerPath);
router.get('/employer/:employerId', protect, getEmployerIntelligence);

module.exports = router;
