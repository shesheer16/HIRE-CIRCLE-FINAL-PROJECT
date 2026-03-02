const mongoose = require('mongoose');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');

const withdrawalRequestSchema = new mongoose.Schema(
    {
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

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
