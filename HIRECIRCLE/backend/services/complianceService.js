'use strict';
/**
 * complianceService.js
 * Feature #99 — Age/Identity Rules & Compliance Warnings
 * Feature #93 — Two-Factor Authentication (Optional)
 * Feature #92 — Video Verification Steps for Users
 *
 * Handles compliance checks and 2FA state management.
 * Non-disruptive: additive guardrails. No core auth flow changes.
 */

const User = require('../models/userModel');

const MIN_AGE_YEARS = 18;

/**
 * Check if user meets age compliance requirements.
 */
function checkAgeCompliance(dateOfBirth) {
    if (!dateOfBirth) return { compliant: null, message: 'Date of birth not provided.' };
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return { compliant: false, message: 'Invalid date of birth.' };

    const ageMs = Date.now() - dob.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);

    return ageYears >= MIN_AGE_YEARS
        ? { compliant: true, ageYears: Math.floor(ageYears), message: 'Age requirement met.' }
        : { compliant: false, ageYears: Math.floor(ageYears), message: `Must be at least ${MIN_AGE_YEARS} years old.` };
}

/**
 * Get compliance summary for a user.
 */
async function getUserComplianceSummary(userId) {
    const user = await User.findById(userId)
        .select('dateOfBirth isEmailVerified isPhoneVerified twoFactorEnabled videoVerified')
        .lean();

    if (!user) throw Object.assign(new Error('User not found'), { code: 404 });

    const ageCheck = checkAgeCompliance(user.dateOfBirth);

    return {
        ageCompliant: ageCheck.compliant,
        ageMessage: ageCheck.message,
        emailVerified: Boolean(user.isEmailVerified),
        phoneVerified: Boolean(user.isPhoneVerified),
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        videoVerified: Boolean(user.videoVerified),
        complianceScore: [
            ageCheck.compliant,
            user.isEmailVerified,
            user.isPhoneVerified,
        ].filter(Boolean).length,
        maxComplianceScore: 3,
    };
}

/**
 * Enable/disable 2FA for a user.
 * Feature #93
 */
async function setTwoFactor(userId, enabled) {
    await User.updateOne({ _id: userId }, { $set: { twoFactorEnabled: !!enabled } });
    return { userId: String(userId), twoFactorEnabled: !!enabled };
}

/**
 * Mark user video-verified (after admin/AI review).
 * Feature #92
 */
async function markVideoVerified(userId, verified = true) {
    await User.updateOne({ _id: userId }, { $set: { videoVerified: !!verified } });
    return { userId: String(userId), videoVerified: !!verified };
}

module.exports = {
    checkAgeCompliance,
    getUserComplianceSummary,
    setTwoFactor,
    markVideoVerified,
    MIN_AGE_YEARS,
};
