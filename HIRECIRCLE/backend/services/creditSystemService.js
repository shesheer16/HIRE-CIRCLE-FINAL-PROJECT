'use strict';
/**
 * creditSystemService.js
 * Feature #74 — In-App Currency for Boosts
 * Feature #72 — Job Promotion Credit System
 *
 * Manages a virtual credit wallet for employers to buy/spend boost credits.
 * Credits are bought via subscription or IAP and spent on job boosts.
 *
 * Non-disruptive: additive. No escrow/payment core changes.
 */

const CreditWallet = require('../models/CreditWallet');

const CREDIT_COSTS = {
    boost_standard: 50,
    boost_pro: 150,
    boost_premium: 400,
};

/**
 * Get employer's credit balance.
 */
async function getBalance(employerId) {
    const wallet = await CreditWallet.findOne({ ownerId: String(employerId) }).lean();
    return { balance: wallet?.balance || 0, currency: 'CREDITS' };
}

/**
 * Add credits to employer wallet (after purchase).
 */
async function addCredits(employerId, amount, reason = 'purchase') {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw Object.assign(new Error('Amount must be a positive integer'), { code: 400 });
    }
    const wallet = await CreditWallet.findOneAndUpdate(
        { ownerId: String(employerId) },
        {
            $inc: { balance: amount },
            $push: { ledger: { type: 'credit', amount, reason, at: new Date() } },
            $setOnInsert: { createdAt: new Date() },
        },
        { new: true, upsert: true }
    );
    return { newBalance: wallet.balance, added: amount };
}

/**
 * Spend credits for a boost.
 */
async function spendCredits(employerId, boostType) {
    const cost = CREDIT_COSTS[boostType];
    if (!cost) throw Object.assign(new Error(`Unknown boost type: ${boostType}`), { code: 400 });

    const wallet = await CreditWallet.findOne({ ownerId: String(employerId) });
    if (!wallet || wallet.balance < cost) {
        throw Object.assign(new Error(`Insufficient credits. Need ${cost}, have ${wallet?.balance || 0}`), { code: 402 });
    }

    wallet.balance -= cost;
    wallet.ledger.push({ type: 'debit', amount: cost, reason: boostType, at: new Date() });
    await wallet.save();

    return { newBalance: wallet.balance, spent: cost, boostType };
}

module.exports = { getBalance, addCredits, spendCredits, CREDIT_COSTS };
