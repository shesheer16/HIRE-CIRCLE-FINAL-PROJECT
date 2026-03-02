'use strict';
const mongoose = require('mongoose');

/**
 * CreditWallet.js — Features #72, #74
 * Virtual credit wallet for employers.
 */
const ledgerEntrySchema = new mongoose.Schema({
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true },
    reason: { type: String, default: '' },
    at: { type: Date, default: Date.now },
}, { _id: false });

const creditWalletSchema = new mongoose.Schema({
    ownerId: { type: String, required: true, unique: true, index: true },
    balance: { type: Number, default: 0, min: 0 },
    ledger: { type: [ledgerEntrySchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

creditWalletSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('CreditWallet', creditWalletSchema);
