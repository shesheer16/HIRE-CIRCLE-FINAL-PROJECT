const mongoose = require('mongoose');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');

const escrowSchema = new mongoose.Schema(
    {
        jobId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true,
        },
        employerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        workerId: {
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
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
        },
        displayCurrency: {
            type: String,
            default: null,
            uppercase: true,
        },
        status: {
            type: String,
            enum: ['funded', 'released', 'refunded', 'disputed'],
            required: true,
            default: 'funded',
            index: true,
        },
        paymentProvider: {
            type: String,
            enum: ['stripe', 'razorpay'],
            required: true,
            index: true,
        },
        paymentReferenceId: {
            type: String,
            required: true,
            index: true,
        },
        fundTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FinancialTransaction',
            default: null,
        },
        workerCreditTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FinancialTransaction',
            default: null,
        },
        commissionTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FinancialTransaction',
            default: null,
        },
        refundTransactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FinancialTransaction',
            default: null,
        },
        disputeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Dispute',
            default: null,
        },
        isFrozen: {
            type: Boolean,
            default: false,
            index: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
            index: true,
        },
        releasedAt: {
            type: Date,
            default: null,
        },
        refundedAt: {
            type: Date,
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

escrowSchema.index({ jobId: 1, workerId: 1, status: 1 });
escrowSchema.index({ paymentReferenceId: 1, paymentProvider: 1 }, { unique: true });

module.exports = mongoose.model('Escrow', escrowSchema);
