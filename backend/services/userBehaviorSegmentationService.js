'use strict';
/**
 * userBehaviorSegmentationService.js
 * Feature #38: User interest tags & aggregations
 * Feature #43: Retargeted job cards based on behavior
 * Feature #46: Connection recommended jobs carousel
 * Feature #47: User behavior segmentation engine
 * Feature #57: Recent searches cloud UI
 * 
 * Non-disruptive logic to analyze user actions and output segmented data.
 */

const SEGMENTS = {
    ACTIVE_SEEKER: 'active_seeker',     // High swipe/apply volume
    PASSIVE_BROWSER: 'passive_browser', // High swipe/save, low apply
    NIGHT_OWL: 'night_owl',             // High activity late night
    CHURN_RISK: 'churn_risk'            // Dropping activity
};

/**
 * Feature #47: Segment users based on behavior metrics.
 */
function segmentUser(metrics = { dailySwipes: 0, dailyApplies: 0, lastActiveDaysAgo: 0, nightActivityPct: 0 }) {
    if (metrics.lastActiveDaysAgo > 14) return SEGMENTS.CHURN_RISK;
    if (metrics.nightActivityPct > 0.6) return SEGMENTS.NIGHT_OWL;
    if (metrics.dailySwipes > 20 && metrics.dailyApplies >= 2) return SEGMENTS.ACTIVE_SEEKER;
    if (metrics.dailySwipes > 10 && metrics.dailyApplies === 0) return SEGMENTS.PASSIVE_BROWSER;
    return 'standard';
}

/**
 * Feature #38: Aggregate interest tags based on viewed/saved job categories.
 */
function aggregateInterestTags(jobInteractions = []) {
    const tags = {};
    jobInteractions.forEach(action => {
        const cat = action.category;
        if (!cat) return;
        const weight = action.type === 'apply' ? 3 : action.type === 'save' ? 2 : 1;
        tags[cat] = (tags[cat] || 0) + weight;
    });

    return Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(t => t[0]);
}

/**
 * Feature #43 & #46: Build retargeted job list ranking.
 * Ranks jobs based on behavior match (similarity to their interest tags).
 */
function rankRetargetedJobs(jobs = [], interestTags = []) {
    if (!interestTags.length) return jobs;

    return [...jobs].sort((a, b) => {
        const aMatch = interestTags.includes(a.category) ? 1 : 0;
        const bMatch = interestTags.includes(b.category) ? 1 : 0;
        return bMatch - aMatch;
    });
}

/**
 * Feature #57: Recent searches cloud UI formatting.
 */
function buildSearchCloud(recentQueries = []) {
    const freq = {};
    recentQueries.forEach(q => {
        const normalized = q.toLowerCase().trim();
        freq[normalized] = (freq[normalized] || 0) + 1;
    });
    return Object.entries(freq)
        .map(([text, count]) => ({ text, count, weight: Math.min(count * 10, 100) }))
        .sort((a, b) => b.count - a.count);
}

module.exports = {
    SEGMENTS,
    segmentUser,
    aggregateInterestTags,
    rankRetargetedJobs,
    buildSearchCloud
};
