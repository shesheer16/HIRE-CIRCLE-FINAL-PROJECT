'use strict';
/**
 * payPerLeadService.js
 * Feature #69 — Pay-Per-Lead for Employers
 *
 * Employers pay per qualified application (lead) received.
 * Non-disruptive: additive billing layer.
 */

const LEAD_TIERS = {
    basic: { pricePerLead: 49, minQualityScore: 50, name: 'Basic Lead' },
    verified: { pricePerLead: 99, minQualityScore: 70, name: 'Verified Lead' },
    premium: { pricePerLead: 199, minQualityScore: 85, name: 'Premium Lead' },
};

/**
 * Calculate lead quality score based on application data.
 */
function calcLeadQualityScore(application) {
    let score = 50; // base
    if (application?.skillMatchPct >= 80) score += 20;
    else if (application?.skillMatchPct >= 60) score += 10;
    if (application?.hasResume) score += 10;
    if (application?.hasPhoto) score += 5;
    if (application?.experienceYears >= 2) score += 10;
    if (application?.isVerified) score += 5;
    return Math.min(100, score);
}

/**
 * Build a lead billing record for a specific tier.
 */
function buildLeadBillingRecord(employerId, applicationId, tier = 'basic') {
    const config = LEAD_TIERS[tier];
    if (!config) throw Object.assign(new Error(`Invalid tier. Allowed: ${Object.keys(LEAD_TIERS).join(', ')}`), { code: 400 });
    if (!employerId || !applicationId) throw Object.assign(new Error('employerId and applicationId required'), { code: 400 });
    return {
        employerId: String(employerId),
        applicationId: String(applicationId),
        tier,
        tierName: config.name,
        pricePerLead: config.pricePerLead,
        billedAt: new Date(),
        status: 'pending',
    };
}

/**
 * Compute total cost for a list of leads.
 */
function computeLeadSpend(leadRecords) {
    return leadRecords.reduce((total, r) => total + (r.pricePerLead || 0), 0);
}

/**
 * Check if an application qualifies as a lead for a given tier.
 */
function qualifiesAsLead(application, tier = 'basic') {
    const config = LEAD_TIERS[tier];
    if (!config) return false;
    const score = calcLeadQualityScore(application);
    return score >= config.minQualityScore;
}

module.exports = {
    LEAD_TIERS,
    calcLeadQualityScore,
    buildLeadBillingRecord,
    computeLeadSpend,
    qualifiesAsLead,
};
