'use strict';
/**
 * userEngagementConfigService.js
 * Feature #42: 2-step job alert frequency toggles
 * Feature #49: In-app messages flagged as important
 * Feature #53: Delayed push personalization (evening jobs)
 * 
 * Non-disruptive configuration getters/setters for engagement preferences.
 */

const DEFAULT_ALERT_FREQUENCY = 'instant'; // instant, daily, weekly, never

/**
 * Feature #42: Check if a user should receive an alert right now based on frequency configs.
 */
function shouldQueueJobAlert(frequencyOverride, jobUrgency = 'normal') {
    const freq = frequencyOverride || DEFAULT_ALERT_FREQUENCY;
    if (freq === 'never') return false;
    if (freq === 'instant') return true;

    // If daily/weekly, return false for immediate push unless job is highly urgent
    if (jobUrgency === 'high') return true;

    return false; // Otherwise batched via cron
}

/**
 * Feature #53: Determine optimal push delivery hour based on preference or defaults.
 * "Delayed push personalization (evening jobs)"
 */
function getOptimalPushHour(userPreference = null) {
    if (userPreference === 'morning') return 9;
    if (userPreference === 'evening') return 19;

    // Default to 18:00 (6 PM) for gig workers who usually browse after day shifts
    return 18;
}

/**
 * Feature #49: Flag message as important based on sender role or keywords.
 */
function flagMessageImportance(messageText = '', senderRole = 'user') {
    if (senderRole === 'system' || senderRole === 'admin') return true;

    const impKeywords = ['offer', 'hired', 'interview', 'urgent', 'action required'];
    const textLower = String(messageText).toLowerCase();

    return impKeywords.some(kw => textLower.includes(kw));
}

module.exports = {
    DEFAULT_ALERT_FREQUENCY,
    shouldQueueJobAlert,
    getOptimalPushHour,
    flagMessageImportance
};
