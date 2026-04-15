const crypto = require('crypto');
const axios = require('axios');

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

const requireRazorpayCredentials = () => {
    const keyId = String(process.env.RAZORPAY_KEY_ID || '').trim();
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '').trim();

    if (!keyId || !keySecret) {
        throw new Error('Razorpay credentials are not configured');
    }

    return { keyId, keySecret };
};

const requestRazorpay = async ({ method, path, data = null }) => {
    const { keyId, keySecret } = requireRazorpayCredentials();
    const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    const response = await axios({
        method,
        url: `${RAZORPAY_API_BASE}${path}`,
        headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/json',
        },
        data,
        timeout: 15000,
    });

    return response.data;
};

const toMinorUnits = (amount) => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('Invalid payment amount');
    }
    return Math.round(parsed * 100);
};

const toMajorUnits = (amount) => Number(amount || 0) / 100;

const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
    const { keySecret } = requireRazorpayCredentials();
    const payload = `${String(orderId || '')}|${String(paymentId || '')}`;
    const expectedSignature = crypto.createHmac('sha256', keySecret).update(payload).digest('hex');
    return expectedSignature === String(signature || '');
};

const createPaymentIntent = async ({ amount, currency = 'INR', metadata = {}, idempotencyKey }) => {
    const order = await requestRazorpay({
        method: 'post',
        path: '/orders',
        data: {
            amount: toMinorUnits(amount),
            currency: String(currency || 'INR').toUpperCase(),
            receipt: String(idempotencyKey || metadata.referenceId || `receipt_${Date.now()}`),
            notes: metadata,
        },
    });

    return {
        provider: 'razorpay',
        providerIntentId: order.id,
        providerOrderId: order.id,
        providerPaymentId: null,
        status: order.status,
        amount: toMajorUnits(order.amount),
        currency: String(order.currency || currency || 'INR').toUpperCase(),
        clientSecret: null,
        raw: order,
    };
};

const verifyPayment = async ({ providerOrderId, providerPaymentId, signature, amount, currency = 'INR' }) => {
    if (!providerPaymentId) {
        throw new Error('Missing Razorpay payment identifier');
    }

    if (providerOrderId && signature) {
        const signatureValid = verifyPaymentSignature({
            orderId: providerOrderId,
            paymentId: providerPaymentId,
            signature,
        });

        if (!signatureValid) {
            throw new Error('Invalid Razorpay payment signature');
        }
    }

    const payment = await requestRazorpay({
        method: 'get',
        path: `/payments/${String(providerPaymentId)}`,
    });

    const paidAmount = toMajorUnits(payment.amount);
    const expectedAmount = Number(amount);
    if (Number.isFinite(expectedAmount) && expectedAmount > 0 && Math.abs(paidAmount - expectedAmount) > 0.0001) {
        throw new Error('Amount mismatch in Razorpay verification');
    }

    const expectedCurrency = String(currency || 'INR').toUpperCase();
    const actualCurrency = String(payment.currency || '').toUpperCase();
    if (expectedCurrency && actualCurrency && expectedCurrency !== actualCurrency) {
        throw new Error('Currency mismatch in Razorpay verification');
    }

    return {
        provider: 'razorpay',
        isVerified: String(payment.status || '').toLowerCase() === 'captured',
        status: payment.status,
        amount: paidAmount,
        currency: actualCurrency || expectedCurrency,
        providerIntentId: payment.order_id || providerOrderId || null,
        providerOrderId: payment.order_id || providerOrderId || null,
        providerPaymentId: payment.id,
        paymentMethodFingerprint: `${payment.method || 'unknown'}:${payment.card_id || payment.vpa || payment.id}`,
        raw: payment,
    };
};

const handleWebhook = async ({ rawBody, signature }) => {
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    if (!secret) {
        throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
    }

    if (!signature) {
        throw new Error('Missing x-razorpay-signature header');
    }

    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (computed !== String(signature)) {
        throw new Error('Invalid Razorpay webhook signature');
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    } catch (error) {
        throw new Error('Invalid Razorpay webhook payload');
    }

    return {
        provider: 'razorpay',
        eventId: payload?.payload?.payment?.entity?.id || payload?.payload?.order?.entity?.id || `rzp_${Date.now()}`,
        eventType: payload?.event || 'unknown',
        payload,
    };
};

const refundPayment = async ({ providerPaymentId, amount = null }) => {
    if (!providerPaymentId) {
        throw new Error('Missing Razorpay payment identifier for refund');
    }

    const payload = {};
    if (Number.isFinite(Number(amount)) && Number(amount) > 0) {
        payload.amount = toMinorUnits(amount);
    }

    const refund = await requestRazorpay({
        method: 'post',
        path: `/payments/${String(providerPaymentId)}/refund`,
        data: payload,
    });

    return {
        provider: 'razorpay',
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
