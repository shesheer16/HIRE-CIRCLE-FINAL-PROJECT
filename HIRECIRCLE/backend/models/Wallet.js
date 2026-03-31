const mongoose = require('mongoose');
const { DEFAULT_BASE_CURRENCY } = require('../config/currencyConfig');

const walletSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        balance: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        pendingBalance: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
        },
        currency: {
            type: String,
            required: true,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
            trim: true,
        },
        baseCurrency: {
            type: String,
            required: true,
            default: DEFAULT_BASE_CURRENCY,
            uppercase: true,
            trim: true,
        },
        kycStatus: {
            type: String,
            enum: ['not_started', 'pending', 'verified', 'rejected'],
            default: 'not_started',
            index: true,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
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

walletSchema.pre('save', function walletPreSave(next) {
    this.updatedAt = new Date();
    if (typeof next === 'function') {
        next();
    }
});

walletSchema.index({ userId: 1, currency: 1 }, { unique: true });

module.exports = mongoose.model('Wallet', walletSchema);
