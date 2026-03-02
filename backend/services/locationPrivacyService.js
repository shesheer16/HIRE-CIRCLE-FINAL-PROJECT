'use strict';
/**
 * locationPrivacyService.js
 * Feature #98 — Location Privacy Options Toggle
 *
 * Controls granularity of location shared:
 *   - EXACT: full lat/lng (default for active job seekers)
 *   - CITY:  only city name, no coordinates
 *   - OFF:   no location shared
 *
 * Non-disruptive: additive. Reads/writes user preferences only.
 */

const User = require('../models/userModel');

const PRIVACY_MODES = ['exact', 'city', 'off'];

/**
 * Set location privacy mode for a user.
 */
async function setLocationPrivacy(userId, mode) {
    if (!PRIVACY_MODES.includes(mode)) {
        throw Object.assign(new Error(`Mode must be one of: ${PRIVACY_MODES.join(', ')}`), { code: 400 });
    }
    await User.updateOne({ _id: userId }, { $set: { 'preferences.locationPrivacy': mode } });
    return { userId: String(userId), locationPrivacy: mode, updated: true };
}

/**
 * Get current location privacy mode.
 */
async function getLocationPrivacy(userId) {
    const user = await User.findById(userId).select('preferences.locationPrivacy').lean();
    return { locationPrivacy: user?.preferences?.locationPrivacy || 'exact' };
}

/**
 * Sanitize location based on privacy mode (call before sending to other users).
 */
function sanitizeLocation(rawGeo, rawCity, privacyMode = 'exact') {
    if (privacyMode === 'off') return { geo: null, city: null };
    if (privacyMode === 'city') return { geo: null, city: rawCity };
    return { geo: rawGeo, city: rawCity };
}

module.exports = { setLocationPrivacy, getLocationPrivacy, sanitizeLocation, PRIVACY_MODES };
