const mongoose = require('mongoose');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');

const transactionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['credit', 'debit'],
            required: true,
            index: true,
        },
        source: {
            type: String,
            enum: [
                'job_payment',
                'subscription',
                'referral',
                'escrow_fund',
                'escrow_release',
                'escrow_refund',
                'commission',
                'withdrawal_request',
                'withdrawal_reversal',
                'withdrawal_processed',
                'settlement',
                'payment_refund',
                'manual_adjustment',
            ],
            required: true,
            index: true,
        },
        referenceId: {
            type: String,
            required: true,
            index: true,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'reversed'],
            required: true,
            default: 'completed',
            index: true,
        },
        currency: {
            type: String,
            required: true,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        baseCurrency: {
            type: String,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        displayCurrency: {
            type: String,
            default: null,
            uppercase: true,
        },
        balanceBefore: {
            type: Number,
            required: true,
            default: 0,
        },
        balanceAfter: {
            type: Number,
            required: true,
            default: 0,
        },
        pendingBalanceBefore: {
            type: Number,
            required: true,
            default: 0,
        },
        pendingBalanceAfter: {
            type: Number,
            required: true,
            default: 0,
        },
        idempotencyKey: {
            type: String,
            default: null,
            index: true,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

const immutableError = (next) => next(new Error('FinancialTransaction is immutable'));

transactionSchema.pre('updateOne', immutableError);
transactionSchema.pre('updateMany', immutableError);
transactionSchema.pre('findOneAndUpdate', immutableError);
transactionSchema.pre('deleteOne', immutableError);
transactionSchema.pre('deleteMany', immutableError);
transactionSchema.pre('findOneAndDelete', immutableError);
transactionSchema.pre('findByIdAndDelete', immutableError);

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ referenceId: 1, source: 1 });

module.exports = mongoose.model('FinancialTransaction', transactionSchema);
