'use strict';
/**
 * darkModeService.js
 * Feature #10 — Dark Mode + System Theme Sync
 *
 * Backend: persists user's theme preference (system/light/dark) in userModel.
 * Mobile: ThemeContext reads this preference and merges with device appearance.
 */

const User = require('../models/userModel');

const VALID_THEMES = ['system', 'light', 'dark'];

/**
 * Persist theme preference for a user.
 */
async function setThemePreference(userId, theme) {
    if (!VALID_THEMES.includes(theme)) {
        throw Object.assign(
            new Error(`Invalid theme. Allowed: ${VALID_THEMES.join(', ')}`),
            { code: 400 }
        );
    }
    await User.updateOne(
        { _id: userId },
        { $set: { 'preferences.theme': theme } }
    );
    return { theme };
}

/**
 * Retrieve theme preference for a user.
 */
async function getThemePreference(userId) {
    const user = await User.findById(userId).select('preferences.theme').lean();
    return { theme: user?.preferences?.theme || 'system' };
}

module.exports = { setThemePreference, getThemePreference, VALID_THEMES };
