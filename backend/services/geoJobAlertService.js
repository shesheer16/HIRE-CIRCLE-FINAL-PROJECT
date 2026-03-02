'use strict';
/**
 * geoJobAlertService.js
 * Feature #18 — Push Notifications for New Jobs in Radius
 *
 * Background-job compatible service:
 *  - Finds users with alertEnabled saved searches
 *  - Queries jobs posted since last alert
 *  - Dispatches push notification via notificationEngineService
 *  - Updates lastAlertSentAt to prevent duplicates
 *
 * Called by a background job on a schedule (realtime/daily/weekly buckets).
 * Non-disruptive: read-only on jobs, additive on SavedSearch.
 */

const SavedSearch = require('../models/SavedSearch');
const Job = require('../models/Job');
const { getAlertableSearches } = require('./savedSearchService');
const { queueNotificationDispatch } = require('./notificationEngineService');

/**
 * Process all alertable saved searches for a given frequency bucket.
 * @param {'realtime'|'daily'|'weekly'} frequency
 */
async function processGeoJobAlerts(frequency = 'daily') {
    const searches = await getAlertableSearches(frequency);
    const results = { processed: 0, notified: 0, skipped: 0 };

    for (const search of searches) {
        try {
            const sinceDate = search.lastAlertSentAt || search.createdAt;
            const { keyword, location, radiusKm, minSalary, skills } = search.filters || {};

            const query = {
                isOpen: true,
                createdAt: { $gt: sinceDate },
            };

            if (keyword) query.title = { $regex: keyword, $options: 'i' };
            if (location) query.location = { $regex: location, $options: 'i' };
            if (skills && skills.length > 0) {
                query.skills = { $elemMatch: { $in: skills } };
            }

            const newJobs = await Job.find(query)
                .sort({ createdAt: -1 })
                .limit(5)
                .select('title companyName location salary')
                .lean();

            results.processed++;

            if (newJobs.length === 0) {
                results.skipped++;
                continue;
            }

            const topJob = newJobs[0];
            const plural = newJobs.length > 1 ? `and ${newJobs.length - 1} more` : '';

            await queueNotificationDispatch({
                userId: String(search.userId),
                type: 'saved_search_alert',
                title: `🔔 New jobs for "${search.name}"`,
                message: `${topJob.title} at ${topJob.companyName}${plural ? ' ' + plural : ''}`,
                relatedData: {
                    searchId: String(search._id),
                    jobIds: newJobs.map((j) => String(j._id)),
                },
                pushCategory: 'job_alert',
            });

            await SavedSearch.updateOne(
                { _id: search._id },
                { lastAlertSentAt: new Date() }
            );

            results.notified++;
        } catch (err) {
            results.skipped++;
        }
    }

    return results;
}

module.exports = { processGeoJobAlerts };
