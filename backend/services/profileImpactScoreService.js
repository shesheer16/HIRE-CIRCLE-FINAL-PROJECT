/**
 * profileImpactScoreService — Deterministic 0-100 Profile Impact Score.
 *
 * Weights:
 *  - Profile completion:        25 pts
 *  - Verification level:        20 pts
 *  - Smart Interview strength:  20 pts
 *  - Response time:             10 pts
 *  - Past hires/interviews:     10 pts
 *  - Trust score:               10 pts
 *  - Endorsements:               5 pts
 *
 * Total: 100 pts max
 * No circular inflation: trust score sourced from UserTrustScore, not from this score.
 */
'use strict';

const WEIGHTS = {
    profileCompletion: 25,
    verificationLevel: 20,
    smartInterview: 20,
    responseTime: 10,
    hiringHistory: 10,
    trustScore: 10,
    endorsements: 5,
};

/**
 * Normalize a raw 0-100 trust score into 0-10 points.
 */
function normalizeTrust(rawScore) {
    const clamped = Math.max(0, Math.min(100, Number(rawScore) || 0));
    return Math.round((clamped / 100) * WEIGHTS.trustScore);
}

/**
 * Score profile completion (0-25 pts).
 * completionPercent: 0-100
 */
function scoreCompletion(completionPercent) {
    const pct = Math.max(0, Math.min(100, Number(completionPercent) || 0));
    return Math.round((pct / 100) * WEIGHTS.profileCompletion);
}

/**
 * Score verification level (0-20 pts).
 * tier: null | 'Bronze' | 'Silver' | 'Gold' | 'Verified Pro'
 */
function scoreVerification(tier) {
    const tierMap = { 'Verified Pro': 20, Gold: 16, Silver: 10, Bronze: 5, null: 0, undefined: 0 };
    return tierMap[tier] ?? 0;
}

/**
 * Score smart interview strength (0-20 pts).
 * interviewScore: 0-100
 */
function scoreInterview(interviewScore) {
    const score = Math.max(0, Math.min(100, Number(interviewScore) || 0));
    return Math.round((score / 100) * WEIGHTS.smartInterview);
}

/**
 * Score response time (0-10 pts). Lower response time = higher score.
 * responseTimeHours: 0+ (null/undefined treated as slow)
 */
function scoreResponseTime(responseTimeHours) {
    const hours = Number(responseTimeHours);
    if (!Number.isFinite(hours) || hours <= 0) return 0;
    if (hours <= 1) return 10;
    if (hours <= 4) return 8;
    if (hours <= 12) return 5;
    if (hours <= 24) return 2;
    return 0;
}

/**
 * Score hiring/interview history (0-10 pts).
 * hireCount + interviewCount → combined activity score
 */
function scoreHistory(hireCount, interviewCount) {
    const totalActivity = (Number(hireCount) || 0) + (Number(interviewCount) || 0);
    if (totalActivity >= 20) return 10;
    if (totalActivity >= 10) return 8;
    if (totalActivity >= 5) return 5;
    if (totalActivity >= 2) return 3;
    if (totalActivity >= 1) return 1;
    return 0;
}

/**
 * Score endorsements (0-5 pts).
 */
function scoreEndorsements(endorsementCount) {
    const count = Number(endorsementCount) || 0;
    if (count >= 10) return 5;
    if (count >= 5) return 3;
    if (count >= 1) return 1;
    return 0;
}

/**
 * Compute full Profile Impact Score.
 * @returns {{ total: number, breakdown: object, percentileSummary: string }}
 */
function computeImpactScore({
    completionPercent = 0,
    verificationTier = null,
    interviewScore = 0,
    responseTimeHours = null,
    hireCount = 0,
    interviewCount = 0,
    trustScore = 0,
    endorsementCount = 0,
} = {}) {
    const breakdown = {
        profileCompletion: scoreCompletion(completionPercent),
        verificationLevel: scoreVerification(verificationTier),
        smartInterview: scoreInterview(interviewScore),
        responseTime: scoreResponseTime(responseTimeHours),
        hiringHistory: scoreHistory(hireCount, interviewCount),
        trustScore: normalizeTrust(trustScore),
        endorsements: scoreEndorsements(endorsementCount),
    };

    const total = Math.min(100, Object.values(breakdown).reduce((sum, v) => sum + v, 0));

    // Gamified improvement tip
    let improvementTip = null;
    if (breakdown.smartInterview < WEIGHTS.smartInterview) {
        improvementTip = 'Complete your Smart Interview to boost your score by up to 20 points.';
    } else if (breakdown.verificationLevel < WEIGHTS.verificationLevel) {
        improvementTip = 'Verify your profile to unlock your Gold badge and gain 16 points.';
    } else if (breakdown.profileCompletion < WEIGHTS.profileCompletion) {
        improvementTip = 'Fill in missing profile fields to earn up to 25 more points.';
    }

    // Percentile estimate (approximate based on score)
    let percentileSummary = null;
    if (total >= 85) percentileSummary = 'You rank higher than 90% of similar profiles';
    else if (total >= 70) percentileSummary = 'You rank higher than 75% of similar profiles';
    else if (total >= 55) percentileSummary = 'You rank higher than 60% of similar profiles';
    else if (total >= 40) percentileSummary = 'You rank higher than 40% of similar profiles';
    else percentileSummary = 'Complete your profile to climb the rankings';

    return { total, breakdown, percentileSummary, improvementTip };
}

module.exports = {
    computeImpactScore,
    scoreCompletion,
    scoreVerification,
    scoreInterview,
    scoreResponseTime,
    scoreHistory,
    scoreEndorsements,
    normalizeTrust,
    WEIGHTS,
};
