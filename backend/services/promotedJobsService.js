'use strict';
/**
 * promotedJobsService.js
 * Feature #65 — Promoted Jobs Filter / Top Placement
 *
 * Handles the "promoted" badge and top placement logic for job listings.
 * Additive: does not touch the base job feed controller.
 */

const PROMOTION_TIERS = {
    standard: { label: 'Promoted', position: 'top', durationDays: 7, price: 499 },
    premium: { label: 'Featured', position: 'banner', durationDays: 14, price: 1299 },
    spotlight: { label: 'Spotlight', position: 'hero', durationDays: 30, price: 2999 },
};

/**
 * Build a promotion record for a job.
 */
function buildPromotionRecord(jobId, employerId, tier = 'standard') {
    const config = PROMOTION_TIERS[tier];
    if (!config) {
        throw Object.assign(new Error(`Invalid promotion tier. Allowed: ${Object.keys(PROMOTION_TIERS).join(', ')}`), { code: 400 });
    }
    if (!jobId || !employerId) {
        throw Object.assign(new Error('jobId and employerId are required'), { code: 400 });
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.durationDays);
    return {
        jobId: String(jobId),
        employerId: String(employerId),
        tier,
        label: config.label,
        position: config.position,
        price: config.price,
        startedAt: new Date(),
        expiresAt,
        active: true,
    };
}

/**
 * Check if a promotion record is currently active.
 */
function isPromotionActive(record) {
    if (!record || !record.active) return false;
    return new Date(record.expiresAt) > new Date();
}

/**
 * Inject promotion metadata into a list of jobs.
 * Promoted jobs bubble to the front.
 */
function sortWithPromotions(jobs, promotionMap = {}) {
    return [...jobs].sort((a, b) => {
        const pa = promotionMap[String(a._id)] ? 1 : 0;
        const pb = promotionMap[String(b._id)] ? 1 : 0;
        return pb - pa;
    });
}

/**
 * Compute promotion spend for reporting.
 */
function computePromotionSpend(records) {
    return records.reduce((total, r) => total + (r.price || 0), 0);
}

module.exports = {
    PROMOTION_TIERS,
    buildPromotionRecord,
    isPromotionActive,
    sortWithPromotions,
    computePromotionSpend,
};
