const express = require('express');
const router = express.Router();
const { createCheckoutSession, stripeWebhook, createFeaturedListingSession, subscribeApiTier } = require('../controllers/paymentController');
const {
    createPaymentIntent,
    verifyPayment,
    refundPayment,
    paymentWebhook,
} = require('../controllers/financialController');
const { protect } = require('../middleware/authMiddleware');

const jsonParser = express.json({ limit: '2mb' });
router.use((req, res, next) => {
    if (String(req.path || '').startsWith('/webhook')) {
        next();
        return;
    }
    jsonParser(req, res, next);
});

router.post('/intent', protect, createPaymentIntent);
router.post('/verify', protect, verifyPayment);
router.post('/refund', protect, refundPayment);

router.post('/create-checkout-session', protect, createCheckoutSession);
router.post('/create-featured-listing', protect, createFeaturedListingSession);
router.post('/subscribe-api-tier', protect, subscribeApiTier);

// Note: Stripe Webhook specifically requires the raw body buffer, NOT parsed JSON!
// we handle this in index.js to use express.raw({type: 'application/json'})
router.post('/webhook', express.raw({ type: 'application/json' }), stripeWebhook);
router.post('/webhook/:provider', express.raw({ type: 'application/json' }), paymentWebhook);

module.exports = router;
