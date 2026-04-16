'use strict';
/**
 * jobSwipeService.js
 * Feature #4 — Swipe Job Cards (Tinder-style)
 * Feature #27 — Swipe for Quick Actions in List (apply/skip)
 * Feature #55 — "Not Interested" Training Button
 *
 * Manages swipe decisions (right=interested, left=not-interested, up=apply)
 * and stores them for personalization training.
 *
 * Non-disruptive: additive. No match engine changes. Uses User model only.
 */

const SwipeDecision = require('../models/SwipeDecision');

const VALID_ACTIONS = ['interested', 'not_interested', 'apply', 'skip'];

/**
 * Record a swipe decision.
 */
async function recordSwipe(userId, jobId, action) {
    if (!VALID_ACTIONS.includes(action)) {
        throw Object.assign(new Error(`Invalid action. Must be: ${VALID_ACTIONS.join(', ')}`), { code: 400 });
    }
    if (!userId || !jobId) throw Object.assign(new Error('userId and jobId required'), { code: 400 });

    // Upsert so last action wins
    await SwipeDecision.updateOne(
        { userId: String(userId), jobId: String(jobId) },
        { $set: { action, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
    );
    return { recorded: true, action };
}

/**
 * Get swiped job IDs for a user (for feed exclusion).
 */
async function getSwipedJobIds(userId, actions = ['not_interested', 'apply']) {
    const records = await SwipeDecision.find({
        userId: String(userId),
        action: { $in: actions },
    }).select('jobId').lean();
    return records.map((r) => r.jobId);
}

/**
 * Get not-interested training data for AI personalization.
 */
async function getNotInterestedJobIds(userId) {
    return getSwipedJobIds(userId, ['not_interested', 'skip']);
}

module.exports = { recordSwipe, getSwipedJobIds, getNotInterestedJobIds, VALID_ACTIONS };
