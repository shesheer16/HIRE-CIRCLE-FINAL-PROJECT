const mongoose = require('mongoose');

const apiBillingUsageSchema = new mongoose.Schema(
    {
        apiKeyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ApiKey',
            required: true,
            index: true,
        },
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        organization: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Organization',
            default: null,
            index: true,
        },
        monthBucket: {
            type: String,
            required: true,
            index: true,
        },
        planType: {
            type: String,
            enum: ['free', 'partner', 'enterprise'],
            default: 'free',
            index: true,
        },
        includedCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        totalCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        overageCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        successfulCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        failedCalls: {
            type: Number,
            default: 0,
            min: 0,
        },
        burstViolations: {
            type: Number,
            default: 0,
            min: 0,
        },
        lastCallAt: {
            type: Date,
            default: null,
        },
        lastOverageChargedBlock: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
);

apiBillingUsageSchema.index({ apiKeyId: 1, monthBucket: 1 }, { unique: true });
apiBillingUsageSchema.index({ organization: 1, monthBucket: 1, totalCalls: -1 });

module.exports = mongoose.model('ApiBillingUsage', apiBillingUsageSchema);
