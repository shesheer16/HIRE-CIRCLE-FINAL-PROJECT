const { processWebhook, createPaymentIntentRecord } = require('../services/financial/paymentOrchestrationService');
const { createSubscriptionCheckoutSession } = require('../services/financial/subscriptionBillingService');
const User = require('../models/userModel');
const {
    executeWithCircuitBreaker,
    CircuitOpenError,
} = require('../services/circuitBreakerService');
const {
    incrementPaymentFailureCounter,
} = require('../services/systemMonitoringService');
const {
    isDegradationActive,
    setDegradationFlag,
} = require('../services/degradationService');

const resolveFrontendUrl = () => {
    const frontendUrl = String(process.env.FRONTEND_URL || '').trim();
    if (!frontendUrl) {
        throw new Error('FRONTEND_URL is not configured');
    }
    return frontendUrl.replace(/\/$/, '');
};

const withPaymentCircuit = async (executor) => executeWithCircuitBreaker(
    'payment_provider',
    executor,
    {
        failureThreshold: Number.parseInt(process.env.PAYMENT_CIRCUIT_FAILURE_THRESHOLD || '4', 10),
        cooldownMs: Number.parseInt(process.env.PAYMENT_CIRCUIT_COOLDOWN_MS || String(45 * 1000), 10),
        timeoutMs: Number.parseInt(process.env.PAYMENT_PROVIDER_TIMEOUT_MS || '8000', 10),
    }
);

const isPaymentWriteBlocked = () => isDegradationActive('paymentWriteBlocked');

const guardPaymentWrites = (res) => {
    if (!isPaymentWriteBlocked()) return false;
    res.status(503).json({
        message: 'Payment provider is temporarily degraded. New escrow/payment writes are paused.',
        code: 'PAYMENT_WRITE_BLOCKED',
    });
    return true;
};

const markPaymentFailure = async (reason) => {
    await incrementPaymentFailureCounter({ reason: reason || 'payment_provider_failure' });
    setDegradationFlag('paymentWriteBlocked', true, reason || 'payment_provider_failure', 120000);
};

const clearPaymentBlock = () => {
    setDegradationFlag('paymentWriteBlocked', false, null);
};

const toPaymentErrorResponse = (res, error, fallbackMessage) => {
    if (error instanceof CircuitOpenError) {
        return res.status(503).json({ message: 'Payment provider is temporarily unavailable. Please retry shortly.' });
    }
    return res.status(500).json({ message: error?.message || fallbackMessage });
};

const createCheckoutSession = async (req, res) => {
    if (guardPaymentWrites(res)) return;

    try {
        const user = await User.findById(req.user._id).select('email');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const frontendUrl = resolveFrontendUrl();
        const successUrl = String(req.body?.successUrl || `${frontendUrl}/success`);
        const cancelUrl = String(req.body?.cancelUrl || `${frontendUrl}/cancel`);
        const planType = String(req.body?.planId || 'pro');

        const session = await withPaymentCircuit(async () => createSubscriptionCheckoutSession({
            user,
            planType,
            successUrl,
            cancelUrl,
        }));

        clearPaymentBlock();
        return res.json({ sessionUrl: session.sessionUrl, sessionId: session.sessionId });
    } catch (error) {
        await markPaymentFailure(error?.message || 'checkout_session_failed');
        return toPaymentErrorResponse(res, error, 'Payment setup failed');
    }
};

const stripeWebhook = async (req, res) => {
    try {
        const result = await withPaymentCircuit(async () => processWebhook({
            provider: 'stripe',
            rawBody: req.body,
            headers: req.headers,
        }));

        clearPaymentBlock();
        return res.status(200).json({ received: true, duplicate: result.duplicate });
    } catch (error) {
        await markPaymentFailure(error?.message || 'webhook_failed');
        if (error instanceof CircuitOpenError) {
            return res.status(503).json({ received: false, message: 'Payment provider unavailable' });
        }
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }
};

const createFeaturedListingSession = async (req, res) => {
    if (guardPaymentWrites(res)) return;

    try {
        const featuredAmount = Number(process.env.FEATURED_LISTING_AMOUNT_INR || 499);
        const payment = await withPaymentCircuit(async () => createPaymentIntentRecord({
            userId: req.user._id,
            provider: String(req.body?.provider || 'stripe').toLowerCase(),
            intentType: 'featured_job',
            amount: featuredAmount,
            currency: String(req.body?.currency || 'INR').toUpperCase(),
            referenceId: req.body?.jobId ? String(req.body.jobId) : null,
            metadata: {
                jobId: req.body?.jobId ? String(req.body.jobId) : null,
                source: 'featured_listing',
            },
            idempotencyKey: String(req.headers['idempotency-key'] || '').trim() || null,
        }));

        clearPaymentBlock();
        return res.status(200).json({
            paymentRecordId: payment.paymentRecord._id,
            providerIntentId: payment.providerResponse.providerIntentId,
            providerOrderId: payment.providerResponse.providerOrderId,
            clientSecret: payment.providerResponse.clientSecret || null,
        });
    } catch (error) {
        await markPaymentFailure(error?.message || 'featured_checkout_failed');
        return toPaymentErrorResponse(res, error, 'Failed to create checkout session for featured listing');
    }
};

const subscribeApiTier = async (req, res) => {
    if (guardPaymentWrites(res)) return;

    try {
        const tierId = String(req.body?.tierId || '').trim();
        if (!tierId) {
            return res.status(400).json({ message: 'tierId is required' });
        }

        const user = await User.findById(req.user._id).select('email');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const frontendUrl = resolveFrontendUrl();
        const session = await withPaymentCircuit(async () => createSubscriptionCheckoutSession({
            user,
            planType: tierId === 'enterprise' ? 'enterprise' : 'pro',
            successUrl: `${frontendUrl}/billing/success`,
            cancelUrl: `${frontendUrl}/billing/cancel`,
        }));

        clearPaymentBlock();
        return res.json({
            message: 'API Enterprise Billing subscription initiated',
            tierId,
            sessionUrl: session.sessionUrl,
            sessionId: session.sessionId,
        });
    } catch (error) {
        await markPaymentFailure(error?.message || 'api_tier_subscribe_failed');
        return toPaymentErrorResponse(res, error, 'Failed to subscribe API tier');
    }
};

module.exports = {
    createCheckoutSession,
    stripeWebhook,
    createFeaturedListingSession,
    subscribeApiTier,
};
