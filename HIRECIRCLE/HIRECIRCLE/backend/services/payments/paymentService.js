const stripeProvider = require('./providers/stripeProvider');
const razorpayProvider = require('./providers/razorpayProvider');

const providers = {
    stripe: stripeProvider,
    razorpay: razorpayProvider,
};

const getProvider = (providerName) => {
    const key = String(providerName || '').trim().toLowerCase();
    const provider = providers[key];
    if (!provider) {
        throw new Error(`Unsupported payment provider: ${providerName}`);
    }
    return provider;
};

const createPaymentIntent = async ({ provider, ...payload }) => {
    const client = getProvider(provider);
    return client.createPaymentIntent(payload);
};

const verifyPayment = async ({ provider, ...payload }) => {
    const client = getProvider(provider);
    return client.verifyPayment(payload);
};

const handleWebhook = async ({ provider, ...payload }) => {
    const client = getProvider(provider);
    return client.handleWebhook(payload);
};

const refundPayment = async ({ provider, ...payload }) => {
    const client = getProvider(provider);
    return client.refundPayment(payload);
};

module.exports = {
    createPaymentIntent,
    verifyPayment,
    handleWebhook,
    refundPayment,
};
