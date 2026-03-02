'use strict';
/**
 * premiumSubscriptionService.js
 * Feature #63 — Premium Subscription for Employers
 * Feature #73 — Subscription Perks (free applies, priority)
 *
 * Thin additive layer on top of subscriptionService.
 * Manages employer plan tiers and perks resolution.
 */

const PLANS = {
    free: {
        name: 'Free',
        price: 0,
        jobPostLimit: 3,
        boostedPosts: 0,
        candidateInsights: false,
        prioritySupport: false,
        freeApplies: 0,
        smartSuggestions: false,
    },
    starter: {
        name: 'Starter',
        price: 999,
        jobPostLimit: 10,
        boostedPosts: 1,
        candidateInsights: false,
        prioritySupport: false,
        freeApplies: 50,
        smartSuggestions: true,
    },
    pro: {
        name: 'Pro',
        price: 2999,
        jobPostLimit: 50,
        boostedPosts: 5,
        candidateInsights: true,
        prioritySupport: false,
        freeApplies: 200,
        smartSuggestions: true,
    },
    enterprise: {
        name: 'Enterprise',
        price: 9999,
        jobPostLimit: Infinity,
        boostedPosts: 20,
        candidateInsights: true,
        prioritySupport: true,
        freeApplies: Infinity,
        smartSuggestions: true,
    },
};

const PLAN_RANK = { free: 0, starter: 1, pro: 2, enterprise: 3 };

/**
 * Get plan details for a given plan key.
 */
function getPlanDetails(planKey = 'free') {
    return PLANS[planKey] || PLANS.free;
}

/**
 * Check if a plan has a specific perk/feature.
 */
function hasPlanFeature(planKey, featureKey) {
    const plan = getPlanDetails(planKey);
    return !!plan[featureKey];
}

/**
 * Compare two plans — returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function comparePlans(planA, planB) {
    const ra = PLAN_RANK[planA] ?? 0;
    const rb = PLAN_RANK[planB] ?? 0;
    return ra > rb ? 1 : ra < rb ? -1 : 0;
}

/**
 * Build the upgrade prompt for a user on a lower plan.
 */
function buildUpgradePrompt(currentPlan, requiredPlan) {
    const current = getPlanDetails(currentPlan);
    const required = getPlanDetails(requiredPlan);
    return {
        canAccess: comparePlans(currentPlan, requiredPlan) >= 0,
        currentPlan: current.name,
        requiredPlan: required.name,
        upgradeMessage: comparePlans(currentPlan, requiredPlan) < 0
            ? `Upgrade to ${required.name} to unlock this feature.`
            : null,
    };
}

/**
 * Get perks summary for a subscriber.
 */
function getPerksSummary(planKey) {
    const plan = getPlanDetails(planKey);
    return {
        plan: plan.name,
        freeApplies: plan.freeApplies,
        priorityPlacement: plan.boostedPosts > 0,
        candidateInsights: plan.candidateInsights,
        smartSuggestions: plan.smartSuggestions,
        prioritySupport: plan.prioritySupport,
    };
}

module.exports = {
    PLANS,
    PLAN_RANK,
    getPlanDetails,
    hasPlanFeature,
    comparePlans,
    buildUpgradePrompt,
    getPerksSummary,
};
