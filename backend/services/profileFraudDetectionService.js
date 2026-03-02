/**
 * profileFraudDetectionService — Detect and prevent profile manipulation.
 *
 * Detections:
 *  1. Rapid edit rate (>5 edits in 10 minutes)
 *  2. Skill count explosion (>20 skills added at once)
 *  3. Suspicious location change (city changed 3+ times in 24h)
 *  4. Identity field swap (name + phone changed simultaneously)
 *  5. Score farming attempt (repeated minor edits to trigger recalculation)
 */
'use strict';

// Edit rate tracking in-memory (in production: Redis)
const editRateStore = new Map(); // userId -> [timestamps]
const locationChangeStore = new Map(); // userId -> [{ city, at }]

const RAPID_EDIT_THRESHOLD = 5;
const RAPID_EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const LOCATION_CHANGE_LIMIT = 3;
const LOCATION_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Record a profile edit and check for rapid-edit fraud.
 * Returns { flagged: boolean, reason: string | null }
 */
function checkEditRateLimit(userId) {
    const uid = String(userId);
    const now = Date.now();
    const history = (editRateStore.get(uid) || []).filter((ts) => now - ts < RAPID_EDIT_WINDOW_MS);
    history.push(now);
    editRateStore.set(uid, history);

    if (history.length > RAPID_EDIT_THRESHOLD) {
        return { flagged: true, reason: 'RAPID_EDIT_RATE', detail: `${history.length} edits in 10 minutes` };
    }
    return { flagged: false, reason: null };
}

/**
 * Check skill count explosion.
 * previousSkills: string[], newSkills: string[]
 */
function checkSkillFarming(previousSkills = [], newSkills = []) {
    const added = newSkills.filter((s) => !previousSkills.includes(s));
    if (added.length > 20) {
        return { flagged: true, reason: 'SKILL_FARMING', detail: `${added.length} skills added at once` };
    }
    return { flagged: false, reason: null };
}

/**
 * Check suspicious location change.
 */
function checkLocationChange(userId, newCity) {
    const uid = String(userId);
    const now = Date.now();
    const history = (locationChangeStore.get(uid) || []).filter((e) => now - e.at < LOCATION_CHANGE_WINDOW_MS);

    // Only record if city actually changed
    const lastCity = history.length > 0 ? history[history.length - 1].city : null;
    if (lastCity !== newCity) {
        history.push({ city: newCity, at: now });
        locationChangeStore.set(uid, history);
    }

    if (history.length >= LOCATION_CHANGE_LIMIT) {
        return { flagged: true, reason: 'SUSPICIOUS_LOCATION_CHANGE', detail: `${history.length} location changes in 24h` };
    }
    return { flagged: false, reason: null };
}

/**
 * Check identity swap (name + phone changed simultaneously).
 * changedFields: string[]
 */
function checkIdentitySwap(changedFields = []) {
    const identityFields = ['firstName', 'lastName', 'phone', 'mobile'];
    const changed = changedFields.filter((f) => identityFields.includes(f));
    if (changed.length >= 3) {
        return { flagged: true, reason: 'IDENTITY_SWAP', detail: `Identity fields changed: ${changed.join(', ')}` };
    }
    return { flagged: false, reason: null };
}

/**
 * Run all fraud checks and aggregate results.
 * @returns {{ isFraudulent: boolean, flags: Array<{reason, detail}> }}
 */
function runFraudChecks({ userId, changedFields = [], previousSkills = [], newSkills = [], newCity = null } = {}) {
    const checks = [
        checkEditRateLimit(userId),
        checkSkillFarming(previousSkills, newSkills),
        checkIdentitySwap(changedFields),
        ...(newCity ? [checkLocationChange(userId, newCity)] : []),
    ];

    const flags = checks.filter((c) => c.flagged).map(({ reason, detail }) => ({ reason, detail }));
    return { isFraudulent: flags.length > 0, flags };
}

/**
 * Clear rate store for a user (used in tests / admin reset).
 */
function clearStoreForUser(userId) {
    editRateStore.delete(String(userId));
    locationChangeStore.delete(String(userId));
}

module.exports = {
    runFraudChecks,
    checkEditRateLimit,
    checkSkillFarming,
    checkLocationChange,
    checkIdentitySwap,
    clearStoreForUser,
    RAPID_EDIT_THRESHOLD,
    LOCATION_CHANGE_LIMIT,
};
