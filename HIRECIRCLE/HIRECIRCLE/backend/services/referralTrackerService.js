'use strict';
/**
 * referralTrackerService.js
 * Feature #31 — Referral Bonus Tracker UI
 * Feature #75 — Referral Commission Program UI
 *
 * Tracks referral signups and commission accrual per user.
 * Non-disruptive: reads from existing referralService, adds UI-layer tracking.
 */

const User = require('../models/userModel');

/**
 * Get referral dashboard data for a user.
 */
async function getReferralDashboard(userId) {
    const user = await User.findById(userId)
        .select('referralCode referredBy referralCount referralEarnings')
        .lean();
    if (!user) throw Object.assign(new Error('User not found'), { code: 404 });

    return {
        referralCode: user.referralCode || null,
        totalReferrals: Number(user.referralCount || 0),
        totalEarnings: Number(user.referralEarnings || 0),
        pendingBonus: 0, // Expanded when payment integration hooks in
        shareText: user.referralCode
            ? `Join HireApp with my referral code: ${user.referralCode} and get a hiring advantage!`
            : null,
    };
}

module.exports = { getReferralDashboard };
