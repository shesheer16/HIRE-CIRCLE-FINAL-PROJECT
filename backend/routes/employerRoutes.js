const express = require('express');

const {
    getEmployerTierController,
    getEmployerLockInSummaryController,
    getEmployerAnalyticsMetricsController,
    registerEmployerWebhookController,
    listEmployerWebhooksController,
} = require('../controllers/employerController');
const { createWidgetSessionTokenController } = require('../controllers/widgetController');
const { protect, employer } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/tier', protect, employer, getEmployerTierController);
router.get('/lock-in-summary', protect, employer, getEmployerLockInSummaryController);
router.get('/metrics', protect, employer, getEmployerAnalyticsMetricsController);
router.post('/webhooks', protect, employer, registerEmployerWebhookController);
router.get('/webhooks', protect, employer, listEmployerWebhooksController);
router.post('/widget/session-token', protect, employer, createWidgetSessionTokenController);

module.exports = router;
