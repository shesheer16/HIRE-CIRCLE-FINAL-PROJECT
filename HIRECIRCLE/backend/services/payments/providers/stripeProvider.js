const Stripe = require('stripe');

const ZERO_DECIMAL_CURRENCIES = new Set([
    'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

const requireStripeClient = () => {
    const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    return new Stripe(secretKey);
};

const toMinorUnits = (amount, currency = 'INR') => {
    const normalizedCurrency = String(currency || 'INR').toLowerCase();
    const baseAmount = Number(amount);
    if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
        throw new Error('Invalid payment amount');
    }
    return ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)
        ? Math.round(baseAmount)
        : Math.round(baseAmount * 100);
};

const toMajorUnits = (amount, currency = 'INR') => {
    const normalizedCurrency = String(currency || 'INR').toLowerCase();
    if (ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) {
        return Number(amount || 0);
    }
    return Number(amount || 0) / 100;
};

const createPaymentIntent = async ({ amount, currency = 'INR', metadata = {}, idempotencyKey }) => {
    const stripe = requireStripeClient();
    const intent = await stripe.paymentIntents.create(
        {
            amount: toMinorUnits(amount, currency),
            currency: String(currency || 'INR').toLowerCase(),
            metadata,
            capture_method: 'automatic',
        },
        idempotencyKey ? { idempotencyKey } : {}
    );

    return {
        provider: 'stripe',
        providerIntentId: intent.id,
        providerOrderId: null,
        providerPaymentId: null,
        status: intent.status,
        amount: toMajorUnits(intent.amount, intent.currency),
        currency: String(intent.currency || currency || 'INR').toUpperCase(),
        clientSecret: intent.client_secret,
        raw: intent,
    };
};

const verifyPayment = async ({ providerIntentId, providerPaymentId, amount, currency = 'INR' }) => {
    const stripe = requireStripeClient();
    const intentId = providerIntentId || providerPaymentId;
    if (!intentId) {
        throw new Error('Missing Stripe payment identifier');
    }

    const intent = await stripe.paymentIntents.retrieve(String(intentId));
    const paidAmount = toMajorUnits(intent.amount_received || intent.amount, intent.currency);
    const expectedAmount = Number(amount);
    if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(paidAmount - expectedAmount) > 0.0001) {
        throw new Error('Amount mismatch in Stripe verification');
    }

    const expectedCurrency = String(currency || 'INR').toUpperCase();
    const actualCurrency = String(intent.currency || '').toUpperCase();
    if (expectedCurrency && actualCurrency && expectedCurrency !== actualCurrency) {
        throw new Error('Currency mismatch in Stripe verification');
    }

    const succeeded = new Set(['succeeded', 'processing', 'requires_capture']);

    return {
        provider: 'stripe',
        isVerified: succeeded.has(String(intent.status || '').toLowerCase()),
        status: intent.status,
        amount: paidAmount,
        currency: actualCurrency || expectedCurrency,
        providerIntentId: intent.id,
        providerPaymentId: intent.latest_charge || null,
        paymentMethodFingerprint: intent.payment_method || null,
        raw: intent,
    };
};

const handleWebhook = async ({ rawBody, signature }) => {
    const stripe = requireStripeClient();
    const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
        throw new Error('Missing stripe-signature header');
    }

    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    return {
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        payload: event,
    };
};

const refundPayment = async ({ providerPaymentId, providerIntentId, amount = null }) => {
    const stripe = requireStripeClient();
    const refundRequest = {};

    if (providerPaymentId) {
        refundRequest.charge = String(providerPaymentId);
    } else if (providerIntentId) {
        refundRequest.payment_intent = String(providerIntentId);
    } else {
        throw new Error('Missing Stripe payment identifier for refund');
    }

    if (Number.isFinite(Number(amount)) && Number(amount) > 0) {
        refundRequest.amount = toMinorUnits(Number(amount), 'INR');
    }

    const refund = await stripe.refunds.create(refundRequest);

    return {
        provider: 'stripe',
        providerRefundId: refund.id,
        status: refund.status,
        raw: refund,
    };
};

module.exports = {
    createPaymentIntent,
    verifyPayment,
    handleWebhook,
    refundPayment,
};
