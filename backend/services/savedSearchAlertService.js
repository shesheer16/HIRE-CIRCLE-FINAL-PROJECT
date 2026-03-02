'use strict';
/**
 * savedSearchAlertService.js
 * Feature #17: Saved searches + alert triggers
 * Feature #18: Push notifications for new jobs in radius
 * Feature #20: Personalized daily job digest cards
 * 
 * Logic to map user constraints to background query triggers.
 */

/**
 * Feature #17: Format a user's search query into a saveable background alert payload.
 */
function createSavedSearchAlert(query = '', filters = {}, userId) {
    if (!query && Object.keys(filters).length === 0) {
        throw new Error('Cannot save empty search');
    }

    // Normalize location filter to a strict geo shape for fast background evaluation
    const isRadius = filters.maxDistance && Array.isArray(filters.coordinates);

    return {
        userId,
        normalizedQuery: query.toLowerCase().trim(),
        filters,
        geoConstraint: isRadius ? true : false,
        active: true,
        frequency: 'instant' // default
    };
}

/**
 * Feature #18: Evaluate if a newly posted job triggers an existing saved radius alert.
 */
function evaluateGeoAlertTrigger(newJob, savedAlert) {
    if (!savedAlert.geoConstraint || !savedAlert.filters.coordinates) return false;
    if (!newJob.location || !newJob.location.coordinates) return false;

    const [jobLng, jobLat] = newJob.location.coordinates;
    const [alertLng, alertLat] = savedAlert.filters.coordinates;

    // Very coarse distance check for testing (1 deg ~ 111km)
    const distanceDeg = Math.sqrt(Math.pow(jobLng - alertLng, 2) + Math.pow(jobLat - alertLat, 2));
    const maxDeg = (savedAlert.filters.maxDistance || 10) / 111;

    if (distanceDeg <= maxDeg) {
        // Also check if text query matches
        if (savedAlert.normalizedQuery) {
            const jTitle = newJob.title.toLowerCase();
            if (!jTitle.includes(savedAlert.normalizedQuery)) return false;
        }
        return true;
    }
    return false;
}

/**
 * Feature #20: Generate the UI payload for a daily job digest.
 */
function buildDailyDigestWidget(userId, newJobs = []) {
    if (!newJobs.length) return null;

    // Sort highest paying to top
    const sorted = [...newJobs].sort((a, b) => (b.maxSalary || 0) - (a.maxSalary || 0));
    const topPicks = sorted.slice(0, 3);

    return {
        header: 'Your Daily Top 3 🔥',
        count: newJobs.length,
        topPicks: topPicks.map(j => ({ id: j._id, title: j.title, salary: j.maxSalary }))
    };
}

module.exports = {
    createSavedSearchAlert,
    evaluateGeoAlertTrigger,
    buildDailyDigestWidget
};
