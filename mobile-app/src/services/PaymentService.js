import client from '../api/client';

export const createPaymentIntent = async ({ provider = 'stripe', intentType, amount, currency = 'INR', referenceId, metadata = {} }) => client.post('/api/payment/intent', {
    provider,
    intentType,
    amount,
    currency,
    referenceId,
    metadata,
});

export const verifyPayment = async ({ paymentRecordId, provider, providerIntentId, providerOrderId, providerPaymentId, signature }) => client.post('/api/payment/verify', {
    paymentRecordId,
    provider,
    providerIntentId,
    providerOrderId,
    providerPaymentId,
    signature,
});

export const refundPayment = async ({ paymentRecordId, amount, reason }) => client.post('/api/payment/refund', {
    paymentRecordId,
    amount,
    reason,
});
