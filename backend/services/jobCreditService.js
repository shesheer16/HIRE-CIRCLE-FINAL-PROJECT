'use strict';
/**
 * jobCreditService.js
 * Feature #72 — Job Promotion Credit System
 * Feature #74 — In-App Currency for Boosts
 *
 * Manages job promotion credits (JPC) and in-app boost tokens.
 * Non-disruptive: additive on top of existing creditSystemService structure.
 */

const CREDIT_ACTIONS = {
    post_job: { cost: 10, label: 'Post a Job' },
    boost_job: { cost: 25, label: 'Boost Job for 7 days' },
    feature_job: { cost: 50, label: 'Feature Job for 14 days' },
    spotlight_job: { cost: 100, label: 'Spotlight Job for 30 days' },
    view_insight: { cost: 5, label: 'View Applicant Insight' },
    unlock_contact: { cost: 15, label: 'Unlock Candidate Contact' },
};

const EARN_ACTIONS = {
    first_hire: { credits: 50, label: 'First successful hire' },
    profile_complete: { credits: 20, label: 'Complete company profile' },
    referral_signup: { credits: 30, label: 'Referred employer signed up' },
    purchase_pack: { credits: 0, label: 'Purchased credit pack' }, // dynamic
};

const CREDIT_PACKS = {
    starter: { credits: 100, price: 499, bonus: 0 },
    growth: { credits: 300, price: 1299, bonus: 50 },
    pro: { credits: 700, price: 2499, bonus: 150 },
    elite: { credits: 2000, price: 5999, bonus: 500 },
};

/**
 * Get cost of an action.
 */
function getActionCost(actionKey) {
    return CREDIT_ACTIONS[actionKey]?.cost ?? null;
}

/**
 * Check if a balance covers an action.
 */
function canAffordAction(balance, actionKey) {
    const cost = getActionCost(actionKey);
    if (cost === null) return false;
    return Number(balance) >= cost;
}

/**
 * Build a credit pack purchase record.
 */
function buildPackPurchase(userId, packKey) {
    const pack = CREDIT_PACKS[packKey];
    if (!pack) throw Object.assign(new Error(`Invalid pack. Allowed: ${Object.keys(CREDIT_PACKS).join(', ')}`), { code: 400 });
    if (!userId) throw Object.assign(new Error('userId required'), { code: 400 });
    return {
        userId: String(userId),
        packKey,
        creditsReceived: pack.credits + pack.bonus,
        baseCredits: pack.credits,
        bonusCredits: pack.bonus,
        price: pack.price,
        purchasedAt: new Date(),
    };
}

/**
 * Compute total credits after a series of transactions.
 */
function computeBalance(transactions = []) {
    return transactions.reduce((bal, tx) => {
        if (tx.type === 'earn') return bal + (tx.amount || 0);
        if (tx.type === 'spend') return bal - (tx.amount || 0);
        return bal;
    }, 0);
}

module.exports = {
    CREDIT_ACTIONS,
    EARN_ACTIONS,
    CREDIT_PACKS,
    getActionCost,
    canAffordAction,
    buildPackPurchase,
    computeBalance,
};
