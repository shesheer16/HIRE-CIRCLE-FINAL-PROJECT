const mongoose = require('mongoose');
const crypto = require('crypto');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');

const withdrawalRequestSchema = new mongoose.Schema(
    {
        withdrawalRequestId: {
            type: String,
            required: true,
            default: () => `wd_${crypto.randomUUID()}`,
            index: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
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
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        baseCurrency: {
            type: String,
            required: true,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        status: {
            type: String,
            enum: ['requested', 'approved', 'rejected', 'processed'],
            default: 'requested',
            index: true,
        },
        requestedAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        processedAt: {
            type: Date,
            default: null,
        },
        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        payoutReferenceId: {
            type: String,
            default: null,
        },
        rejectionReason: {
            type: String,
            default: null,
        },
        idempotencyKey: {
            type: String,
            required: true,
            index: true,
        },
        requestBodyHash: {
            type: String,
            required: true,
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

withdrawalRequestSchema.index({ userId: 1, status: 1, requestedAt: -1 });
withdrawalRequestSchema.index(
    { withdrawalRequestId: 1 },
    {
        unique: true,
        partialFilterExpression: { withdrawalRequestId: { $type: 'string' } },
    }
);
withdrawalRequestSchema.index(
    { idempotencyKey: 1 },
    {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    }
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
