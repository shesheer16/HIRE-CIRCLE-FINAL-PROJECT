'use strict';

/**
 * verificationStatusService.js
 * 
 * Provides the visual layer for the Verification Status Panel (Phase 23).
 * It reads existing trust flags from the User model and returns UI-ready definitions
 * including verification status, visual color indicators, and informative tooltips 
 * to educate users on why verification matters.
 */

const User = require('../models/userModel');

/**
 * Maps system verification state to visual tooltips and status.
 * @param {String} userId 
 */
async function getVerificationPanelData(userId) {
    const user = await User.findById(userId).select('isEmailVerified phoneNumber verificationSignals roles').lean();

    if (!user) {
        throw new Error('User not found');
    }

    const isEmployer = user.roles && user.roles.includes('employer');

    const panel = [];

    // 1. Phone Verification
    const hasPhone = Boolean(user.phoneNumber);
    panel.push({
        id: 'phone_verification',
        label: 'Phone Verified',
        isVerified: hasPhone,
        color: hasPhone ? 'green' : 'gray',
        tooltip: hasPhone
            ? 'Your phone is verified. Employers can contact you instantly.'
            : 'Verify phone to show employers you are reachable and increase trust by 15%.'
    });

    // 2. Email Verification
    const hasEmail = Boolean(user.isEmailVerified);
    panel.push({
        id: 'email_verification',
        label: 'Email Verified',
        isVerified: hasEmail,
        color: hasEmail ? 'green' : 'gray',
        tooltip: hasEmail
            ? 'Email is verified. You will receive important updates.'
            : 'Verify your email to secure your account and recover it easily.'
    });

    // 3. Identity Verification
    const hasId = Boolean(user.verificationSignals?.govtIdVerified);
    panel.push({
        id: 'identity_verification',
        label: 'Identity Verified',
        isVerified: hasId,
        color: hasId ? 'blue' : 'gray', // Blue for high trust
        tooltip: hasId
            ? 'Your Government ID is verified. You have the highest trust badge.'
            : 'Verify your identity to unlock premium employer matches and instant messaging.'
    });

    // 4. Employer Verification (Only if the user acts as an employer)
    if (isEmployer) {
        const hasCompany = Boolean(user.verificationSignals?.companyRegistrationVerified);
        panel.push({
            id: 'employer_verification',
            label: 'Company Verified',
            isVerified: hasCompany,
            color: hasCompany ? 'purple' : 'gray',
            tooltip: hasCompany
                ? 'Your company is verified. Candidates trust your job postings.'
                : 'Verify your company registration to increase candidate application rates by 3x.'
        });
    }

    const completedCount = panel.filter(p => p.isVerified).length;
    const totalCount = panel.length;

    let overallTrustLevel = 'Standard';
    if (completedCount === totalCount) overallTrustLevel = 'Maximum Trust';
    else if (completedCount >= 2) overallTrustLevel = 'High Trust';

    return {
        verifications: panel,
        summary: {
            completed: completedCount,
            total: totalCount,
            overallTrustLevel,
            trustMessage: `Your profile has a ${overallTrustLevel} rating.`
        }
    };
}

module.exports = {
    getVerificationPanelData
};
