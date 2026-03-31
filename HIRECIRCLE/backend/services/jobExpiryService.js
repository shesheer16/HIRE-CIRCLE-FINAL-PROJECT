'use strict';
/**
 * jobExpiryService.js
 * Feature #34 — In-App Reminders (Jobs Closing Soon)
 * Feature #39 — Auto Job Expiry Reminder
 * Feature #44 — Job Expiry Countdown Timer
 *
 * Manages job expiry tracking and generates countdown/reminder payloads.
 * Non-disruptive: reads from Job model. No lifecycle changes.
 */

const Job = require('../models/Job');

/**
 * Get jobs expiring within N hours for notification dispatch.
 * @param {number} withinHours
 */
async function getJobsExpiringWithin(withinHours = 24) {
    const now = new Date();
    const cutoff = new Date(now.getTime() + withinHours * 60 * 60 * 1000);

    return Job.find({
        isOpen: true,
        expiresAt: { $gte: now, $lte: cutoff },
    })
        .select('_id title employer companyName expiresAt')
        .lean();
}

/**
 * Get countdown data for a job card.
 * @param {Date|string} expiresAt
 */
function getCountdownData(expiresAt) {
    if (!expiresAt) return null;
    const now = Date.now();
    const expMs = new Date(expiresAt).getTime();
    const msLeft = expMs - now;

    if (msLeft <= 0) return { expired: true, label: 'Expired', msLeft: 0, urgency: 'expired' };

    const hours = Math.floor(msLeft / (1000 * 60 * 60));
    const mins = Math.floor((msLeft % (1000 * 60 * 60)) / (1000 * 60));

    let label, urgency;
    if (hours < 1) { label = `${mins}m left`; urgency = 'critical'; }
    else if (hours < 6) { label = `${hours}h ${mins}m left`; urgency = 'high'; }
    else if (hours < 24) { label = `${hours}h left`; urgency = 'medium'; }
    else { label = `${Math.floor(hours / 24)}d left`; urgency = 'low'; }

    return { expired: false, label, msLeft, hours, mins, urgency };
}

/**
 * Get jobs closing soon for a user's saved searches (for notification).
 */
async function getClosingSoonForUser(savedSearchFilters = [], withinHours = 24) {
    const expirySoon = await getJobsExpiringWithin(withinHours);
    return expirySoon.slice(0, 10); // Limit notifications
}

module.exports = { getJobsExpiringWithin, getCountdownData, getClosingSoonForUser };
