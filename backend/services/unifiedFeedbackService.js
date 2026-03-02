'use strict';
/**
 * unifiedFeedbackService.js
 * Feature #52: In-app survey for feedback loops
 * Feature #55: “Not interested” training button
 * Feature #59: Job comparison screen mapping
 * Feature #60: One-tap direct call employer in place
 * Feature #31: Referral bonus tracker UI payload
 * 
 * Non-disruptive processing for user feedback edges and quick actions.
 */

/**
 * Feature #52: Determine if user should be prompted with an in-app survey.
 */
function shouldPromptSurvey(userInteractions = { applies: 0, surveysTaken: 0 }) {
    // Only prompt after every 5 applications, max 3 times total
    if (userInteractions.surveysTaken >= 3) return false;
    return userInteractions.applies > 0 && userInteractions.applies % 5 === 0;
}

/**
 * Feature #55: Process "Not Interested" click.
 * Generates an event payload to update the match engine negative weights.
 */
function processNotInterestedTraining(userId, jobCategory, reason = 'auto') {
    return {
        userId: String(userId),
        negativeCategory: String(jobCategory),
        reason,
        weightModifier: -0.2, // Drop match probability for this category by 20%
        timestamp: new Date()
    };
}

/**
 * Feature #59: Build a normalized job comparison payload from two jobs.
 */
function buildJobComparison(jobA, jobB) {
    if (!jobA || !jobB) throw new Error('Two jobs required for comparison');

    return {
        titleMatch: jobA.title === jobB.title,
        salaryDiff: (Number(jobA.maxSalary) || 0) - (Number(jobB.maxSalary) || 0),
        distanceDiff: (Number(jobA.distanceKm) || 0) - (Number(jobB.distanceKm) || 0),
        shiftTypeA: jobA.shiftType || 'unknown',
        shiftTypeB: jobB.shiftType || 'unknown'
    };
}

/**
 * Feature #60: Parse and validate employer phone for direct one-tap call.
 */
function extractDirectCallNumber(employerContact = '') {
    // Strip non-numeric, allow leading + for international
    const cleanNum = employerContact.replace(/[^\d+]/g, '');
    if (cleanNum.length >= 10) return `tel:${cleanNum}`;
    return null; // Invalid for direct call
}

/**
 * Feature #31: Build referral bonus tracker UI summary.
 */
function buildReferralTrackerSummary(referrals = []) {
    const totalSent = referrals.length;
    let pending = 0;
    let registered = 0;
    let hired = 0;

    referrals.forEach(r => {
        if (r.status === 'pending') pending++;
        if (r.status === 'registered') registered++;
        if (r.status === 'hired') hired++;
    });

    return {
        totalSent,
        pending,
        registered,
        hired,
        totalEarningsPredicted: hired * 500 // example fixed payout
    };
}

module.exports = {
    shouldPromptSurvey,
    processNotInterestedTraining,
    buildJobComparison,
    extractDirectCallNumber,
    buildReferralTrackerSummary
};
