'use strict';
/**
 * jobCardEngagementService.js
 * Feature #44: Job expiry countdown timer
 * Feature #45: Deep link shareable job cards
 * Feature #51: Exit intent job suggestions
 * Feature #58: Preview job salary ranges
 * 
 * Non-disruptive logic converting raw db records to engagement-optimized UI representations.
 */

/**
 * Feature #44: Job expiry countdown timer.
 * Returns human-readable countdown string (e.g., "Closure in 2d 4h") or null.
 */
function computeExpiryCountdown(expiryDate) {
    if (!expiryDate) return null;
    const msLeft = new Date(expiryDate) - new Date();
    if (msLeft <= 0) return 'Expired';

    const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
    const hours = Math.floor((msLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 7) return null; // Only show countdown if within 7 days
    if (days === 0 && hours === 0) return 'Closing soon';
    if (days === 0) return `Closing in ${hours}h`;
    return `Closing in ${days}d ${hours}h`;
}

/**
 * Feature #45: Deep link shareable job cards.
 * Generates semantic sharing URI scheme.
 */
function generateJobDeepLink(jobId, jobTitle = 'Job', companyName = 'Company') {
    if (!jobId) throw new Error('jobId required for deep link');

    // e.g. hireapp://job/123?title=Delivery&co=FastCo
    const safeTitle = encodeURIComponent(jobTitle);
    const safeCo = encodeURIComponent(companyName);
    return `hireapp://job/${jobId}?title=${safeTitle}&co=${safeCo}`;
}

/**
 * Feature #51: Exit intent job suggestions.
 * If user attempts to leave app / back navigation, provide 2 quick high-match jobs.
 */
function buildExitIntentSuggestions(rankedJobs = []) {
    // Take the top 2 highly matched jobs the user hasn't focused on yet
    return rankedJobs.slice(0, 2);
}

/**
 * Feature #58: Preview job salary ranges.
 * Formats a clean "₹15K - ₹25K" string from min/max.
 */
function formatSalaryRangePreview(minSalary, maxSalary, currency = '₹') {
    if (!minSalary && !maxSalary) return 'Salary undisclosed';
    if (minSalary && !maxSalary) return `${currency}${formatNumber(minSalary)}+`;
    if (!minSalary && maxSalary) return `Up to ${currency}${formatNumber(maxSalary)}`;
    if (minSalary === maxSalary) return `${currency}${formatNumber(minSalary)}`;
    return `${currency}${formatNumber(minSalary)} - ${currency}${formatNumber(maxSalary)}`;
}

function formatNumber(num) {
    const val = Number(num);
    if (val >= 100000) return (val / 100000).toFixed(1).replace(/\.0$/, '') + 'L';
    if (val >= 1000) return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(val);
}

module.exports = {
    computeExpiryCountdown,
    generateJobDeepLink,
    buildExitIntentSuggestions,
    formatSalaryRangePreview
};
