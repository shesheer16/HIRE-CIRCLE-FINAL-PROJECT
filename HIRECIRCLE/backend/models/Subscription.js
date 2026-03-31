const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        planType: {
            type: String,
            enum: ['free', 'pro', 'enterprise'],
            default: 'free',
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'inactive', 'expired', 'cancelled', 'paused', 'trial', 'grace'],
            default: 'inactive',
            index: true,
        },
        provider: {
            type: String,
            enum: ['stripe', 'razorpay', 'none'],
            default: 'none',
            index: true,
        },
        providerSubscriptionId: {
            type: String,
            default: null,
            index: true,
        },
        billingPeriod: {
            type: String,
            enum: ['monthly', 'yearly', 'none'],
            default: 'monthly',
        },
        startDate: {
            type: Date,
            default: Date.now,
        },
        gracePeriodEndsAt: {
            type: Date,
            default: null,
            index: true,
        },
        cancelledAt: {
            type: Date,
            default: null,
        },
        expiryDate: {
            type: Date,
            default: null,
            index: true,
        },
        featureOverrides: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
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

subscriptionSchema.index({ userId: 1, status: 1, expiryDate: -1 });
subscriptionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
