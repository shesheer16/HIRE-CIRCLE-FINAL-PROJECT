'use strict';
/**
 * deepLinkService.js
 * Feature #45 — Deep Link Shareable Job Cards
 *
 * Generates shareable deep links for job listings.
 * Format: hire://jobs/<jobId> (universal link)
 * Web fallback: https://<domain>/jobs/<jobId>
 *
 * Non-disruptive: additive utility. No routing changes.
 */

const APP_SCHEME = process.env.APP_DEEP_LINK_SCHEME || 'hireapp';
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'https://hireapp.in';

/**
 * Generate a deep link for a job.
 * @param {string} jobId
 * @param {{ title?: string, company?: string }} meta
 */
function generateJobDeepLink(jobId, meta = {}) {
    if (!jobId) throw Object.assign(new Error('jobId required'), { code: 400 });

    const appLink = `${APP_SCHEME}://jobs/${jobId}`;
    const webLink = `${WEB_BASE_URL}/jobs/${jobId}`;

    // Promotional branch.io-style link (falls back to web if app not installed)
    const shareText = meta.title && meta.company
        ? `Check out this job: ${meta.title} at ${meta.company}`
        : 'Check out this job opportunity';

    return {
        jobId: String(jobId),
        appLink,
        webLink,
        shareText: `${shareText}\n${webLink}`,
        schema: 'universal_link_v1',
    };
}

/**
 * Generate a shareable profile deep link.
 */
function generateProfileDeepLink(userId, name = '') {
    if (!userId) throw Object.assign(new Error('userId required'), { code: 400 });
    const webLink = `${WEB_BASE_URL}/profiles/${userId}`;
    const appLink = `${APP_SCHEME}://profiles/${userId}`;
    return {
        userId: String(userId),
        appLink,
        webLink,
        shareText: name ? `Connect with ${name} on HireApp\n${webLink}` : `View profile on HireApp\n${webLink}`,
    };
}

module.exports = { generateJobDeepLink, generateProfileDeepLink };
