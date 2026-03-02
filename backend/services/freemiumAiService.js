'use strict';
/**
 * freemiumAiService.js
 * Feature #76 — Freemium AI Smart Suggestions
 *
 * Gates AI features behind a freemium/premium quota system.
 * Non-disruptive: additive layer.
 */

const FREEMIUM_QUOTAS = {
    free: { aiSuggestions: 3, aiJobRecs: 5, aiSkillExtract: 5, aiInterviewHints: 3 },
    starter: { aiSuggestions: 20, aiJobRecs: 50, aiSkillExtract: 50, aiInterviewHints: 20 },
    pro: { aiSuggestions: Infinity, aiJobRecs: Infinity, aiSkillExtract: Infinity, aiInterviewHints: Infinity },
    enterprise: { aiSuggestions: Infinity, aiJobRecs: Infinity, aiSkillExtract: Infinity, aiInterviewHints: Infinity },
};

const FEATURE_KEYS = Object.keys(FREEMIUM_QUOTAS.free);

/**
 * Check if a user has quota remaining for a feature.
 */
function hasQuota(planKey, featureKey, usedCount) {
    const quota = FREEMIUM_QUOTAS[planKey] ?? FREEMIUM_QUOTAS.free;
    const limit = quota[featureKey] ?? 0;
    return limit === Infinity || Number(usedCount) < limit;
}

/**
 * Get remaining quota for a feature.
 */
function getRemainingQuota(planKey, featureKey, usedCount) {
    const quota = FREEMIUM_QUOTAS[planKey] ?? FREEMIUM_QUOTAS.free;
    const limit = quota[featureKey] ?? 0;
    if (limit === Infinity) return Infinity;
    return Math.max(0, limit - Number(usedCount));
}

/**
 * Build a quota summary for a user's plan.
 */
function buildQuotaSummary(planKey, usageMap = {}) {
    const quota = FREEMIUM_QUOTAS[planKey] ?? FREEMIUM_QUOTAS.free;
    return FEATURE_KEYS.map((key) => {
        const limit = quota[key];
        const used = Number(usageMap[key] || 0);
        return {
            feature: key,
            limit: limit === Infinity ? 'unlimited' : limit,
            used,
            remaining: limit === Infinity ? 'unlimited' : Math.max(0, limit - used),
            exhausted: limit !== Infinity && used >= limit,
        };
    });
}

/**
 * Get the upgrade CTA for an exhausted feature.
 */
function getUpgradeCTA(planKey, featureKey) {
    if (planKey === 'pro' || planKey === 'enterprise') return null;
    const nextPlan = planKey === 'free' ? 'Starter' : 'Pro';
    return `You've used your free ${featureKey} quota. Upgrade to ${nextPlan} for more AI features.`;
}

module.exports = {
    FREEMIUM_QUOTAS,
    FEATURE_KEYS,
    hasQuota,
    getRemainingQuota,
    buildQuotaSummary,
    getUpgradeCTA,
};
