'use strict';
/**
 * premiumPreviewService.js
 * Feature #79 — Matched Job Preview Unlocked with Premium
 *
 * Gates full job detail view behind premium/credit unlock.
 * Workers on free plan see a blurred/limited preview.
 * Non-disruptive: additive layer.
 */

const PREVIEW_LEVELS = {
    locked: { fields: ['title', 'location', 'jobType'], blurred: true },
    partial: { fields: ['title', 'location', 'jobType', 'salary', 'skills'], blurred: false },
    full: { fields: ['title', 'location', 'jobType', 'salary', 'skills', 'companyName', 'description', 'contactEmail'], blurred: false },
};

const UNLOCK_COST_CREDITS = 5; // credits to unlock one full job preview

/**
 * Determine the preview level a user has for a job.
 * @param {string} planKey - 'free' | 'starter' | 'pro' | 'enterprise'
 * @param {boolean} explicitly_unlocked - if user spent credits to unlock
 */
function getPreviewLevel(planKey, explicitly_unlocked = false) {
    if (explicitly_unlocked || planKey === 'pro' || planKey === 'enterprise') return 'full';
    if (planKey === 'starter') return 'partial';
    return 'locked';
}

/**
 * Filter job fields based on preview level.
 */
function applyPreviewFilter(job, previewLevel) {
    const config = PREVIEW_LEVELS[previewLevel] || PREVIEW_LEVELS.locked;
    const filtered = {};
    config.fields.forEach((f) => {
        filtered[f] = job[f] !== undefined ? job[f] : null;
    });
    filtered._previewLevel = previewLevel;
    filtered._blurred = config.blurred;
    return filtered;
}

/**
 * Check if a user needs to spend credits to unlock a job preview.
 */
function needsCreditUnlock(planKey) {
    return planKey === 'free' || planKey === 'starter';
}

/**
 * Build an unlock record when a user spends credits.
 */
function buildUnlockRecord(userId, jobId) {
    if (!userId || !jobId) throw Object.assign(new Error('userId and jobId required'), { code: 400 });
    return {
        userId: String(userId),
        jobId: String(jobId),
        creditsSpent: UNLOCK_COST_CREDITS,
        unlockedAt: new Date(),
    };
}

module.exports = {
    PREVIEW_LEVELS,
    UNLOCK_COST_CREDITS,
    getPreviewLevel,
    applyPreviewFilter,
    needsCreditUnlock,
    buildUnlockRecord,
};
