const mongoose = require('mongoose');

const paymentRecordSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        provider: {
            type: String,
            enum: ['stripe', 'razorpay'],
            required: true,
            index: true,
        },
        intentType: {
            type: String,
            enum: ['escrow_funding', 'subscription', 'wallet_topup', 'featured_job', 'refund'],
            required: true,
            index: true,
        },
        referenceId: {
            type: String,
            default: null,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        currency: {
            type: String,
            required: true,
            default: 'INR',
            uppercase: true,
        },
        status: {
            type: String,
            enum: ['created', 'pending', 'captured', 'failed', 'refunded', 'cancelled'],
            required: true,
            default: 'created',
            index: true,
        },
        providerOrderId: {
            type: String,
            default: null,
            index: true,
        },
        providerPaymentId: {
            type: String,
            default: null,
            index: true,
        },
        providerIntentId: {
            type: String,
            default: null,
            index: true,
        },
        providerSubscriptionId: {
            type: String,
            default: null,
            index: true,
        },
        idempotencyKey: {
            type: String,
            default: null,
            index: true,
        },
        paymentMethodFingerprint: {
            type: String,
            default: null,
            index: true,
        },
        webhookEvents: {
            type: [String],
            default: [],
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

paymentRecordSchema.index(
    { provider: 1, providerPaymentId: 1 },
    {
        unique: true,
        partialFilterExpression: { providerPaymentId: { $type: 'string' } },
    }
);
paymentRecordSchema.index(
    { provider: 1, providerIntentId: 1 },
    {
        unique: true,
        partialFilterExpression: { providerIntentId: { $type: 'string' } },
    }
);
paymentRecordSchema.index(
    { provider: 1, providerOrderId: 1 },
    {
        unique: true,
        partialFilterExpression: { providerOrderId: { $type: 'string' } },
    }
);

module.exports = mongoose.model('PaymentRecord', paymentRecordSchema);
