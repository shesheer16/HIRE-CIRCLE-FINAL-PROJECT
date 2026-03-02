'use strict';
/**
 * partnerCrossSellService.js
 * Feature #78 — Cross-Sell Industry Partner Services
 *
 * Manages partner service listings and cross-sell recommendation logic.
 * Non-disruptive: additive layer.
 */

const PARTNER_CATEGORIES = ['insurance', 'banking', 'transport', 'training', 'health', 'tools', 'telecom'];

/**
 * An example in-memory partner catalog (production: DB-backed).
 */
const SAMPLE_PARTNERS = [
    { id: 'p1', name: 'QuickLoans', category: 'banking', cta: 'Get instant salary advance', commissionPct: 5 },
    { id: 'p2', name: 'SafeDrive', category: 'insurance', cta: 'Insure your vehicle from ₹299', commissionPct: 8 },
    { id: 'p3', name: 'SkillUp', category: 'training', cta: 'Certify your skills online', commissionPct: 10 },
    { id: 'p4', name: 'DataFlex', category: 'telecom', cta: 'Affordable data plans for gig workers', commissionPct: 3 },
];

/**
 * Get partners relevant to a worker's job category.
 */
function getRelevantPartners(jobCategory, existing = SAMPLE_PARTNERS) {
    // Simple relevance: training always relevant; others by category affinity
    return existing.filter((p) => {
        if (p.category === 'training') return true;
        const affinity = {
            delivery: ['insurance', 'transport', 'banking'],
            security: ['insurance', 'health'],
            driver: ['insurance', 'transport'],
            office: ['banking', 'tools', 'training'],
            healthcare: ['health', 'insurance'],
        };
        const cats = affinity[String(jobCategory).toLowerCase()] || [];
        return cats.includes(p.category);
    });
}

/**
 * Build a cross-sell click event record.
 */
function buildCrossSellEvent(userId, partnerId, jobCategory) {
    if (!userId || !partnerId) throw Object.assign(new Error('userId and partnerId required'), { code: 400 });
    return {
        userId: String(userId),
        partnerId: String(partnerId),
        jobCategory: String(jobCategory || 'unknown'),
        clickedAt: new Date(),
        eventType: 'cross_sell_click',
    };
}

/**
 * Compute commission earned from a confirmed conversion.
 */
function computeCommission(partner, transactionValue) {
    const val = Number(transactionValue || 0);
    const pct = Number(partner?.commissionPct || 0);
    return Math.round((val * pct) / 100);
}

module.exports = {
    PARTNER_CATEGORIES,
    SAMPLE_PARTNERS,
    getRelevantPartners,
    buildCrossSellEvent,
    computeCommission,
};
