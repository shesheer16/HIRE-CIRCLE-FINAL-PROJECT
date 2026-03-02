'use strict';
/**
 * showcaseTalentService.js
 * Feature #64 — Showcase Talent Premium Feature
 *
 * Lets premium workers "showcase" their profile for top visibility.
 * Non-disruptive: additive layer. Does NOT modify match engine.
 */

const SHOWCASE_TIERS = {
    standard: { durationDays: 7, visibilityMultiplier: 1.5, price: 299 },
    featured: { durationDays: 14, visibilityMultiplier: 2.0, price: 599 },
    spotlight: { durationDays: 30, visibilityMultiplier: 3.0, price: 999 },
};

/**
 * Build a showcase record for a worker.
 */
function buildShowcaseRecord(userId, tier = 'standard') {
    const config = SHOWCASE_TIERS[tier];
    if (!config) {
        throw Object.assign(new Error(`Invalid tier. Allowed: ${Object.keys(SHOWCASE_TIERS).join(', ')}`), { code: 400 });
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.durationDays);
    return {
        userId: String(userId),
        tier,
        visibilityMultiplier: config.visibilityMultiplier,
        price: config.price,
        activatedAt: new Date(),
        expiresAt,
        active: true,
    };
}

/**
 * Check if a showcase record is still active.
 */
function isShowcaseActive(record) {
    if (!record || !record.active) return false;
    return new Date(record.expiresAt) > new Date();
}

/**
 * Get the effective visibility multiplier for a worker (1.0 if no active showcase).
 */
function getVisibilityMultiplier(record) {
    if (!isShowcaseActive(record)) return 1.0;
    return record.visibilityMultiplier || 1.0;
}

/**
 * Filter/rank a list of profiles, placing showcased workers first.
 */
function rankWithShowcase(profiles) {
    return [...profiles].sort((a, b) => {
        const ma = a._showcaseMultiplier || 1;
        const mb = b._showcaseMultiplier || 1;
        return mb - ma;
    });
}

module.exports = {
    SHOWCASE_TIERS,
    buildShowcaseRecord,
    isShowcaseActive,
    getVisibilityMultiplier,
    rankWithShowcase,
};
