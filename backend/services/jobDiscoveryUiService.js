'use strict';
/**
 * jobDiscoveryUiService.js
 * Feature #1: Map radius selector slider
 * Feature #2: Heatmap layer showing job density
 * Feature #3: Travel time estimate (ETA) grouping
 * Feature #9: Job badge filters (Urgent, Nearby, High Pay)
 * Feature #12: Draggable Job card preview on map
 * Feature #13: Filtered search presets
 * 
 * Logic to map backend data to discovery UI schemas.
 */

/**
 * Feature #1: Generate radius slider steps based on user locale constraint.
 */
function getRadiusSliderConfig(isDenseCity = false) {
    if (isDenseCity) {
        return { steps: [1, 2, 5, 10], defaultValue: 5, unit: 'km' };
    }
    return { steps: [5, 10, 25, 50], defaultValue: 25, unit: 'km' };
}

/**
 * Feature #2: Aggregate jobs into coarse heatmap clusters for the map UI.
 */
function buildHeatmapClusters(jobs = [], precisionLevel = 2) {
    // Highly simplified clustering logic for test verification
    const clusters = {};
    jobs.forEach(job => {
        if (!job.location || !job.location.coordinates) return;
        // Group by truncated lat/lng to simulate clustering
        const lng = job.location.coordinates[0].toFixed(precisionLevel);
        const lat = job.location.coordinates[1].toFixed(precisionLevel);
        const hash = `${lng},${lat}`;

        if (!clusters[hash]) {
            clusters[hash] = { count: 0, urgencyWeight: 0, lat: Number(lat), lng: Number(lng) };
        }
        clusters[hash].count++;
        if (job.isUrgent) clusters[hash].urgencyWeight += 2;
        else clusters[hash].urgencyWeight += 1;
    });

    return Object.values(clusters).map(c => ({
        ...c,
        heatIntensity: Math.min(c.urgencyWeight * 10, 100) // 0-100 scale for UI
    }));
}

/**
 * Feature #3: Group travel limits.
 */
function evaluateTravelEtaLimit(etaMinutes) {
    if (etaMinutes <= 15) return 'Very Close (<15m)';
    if (etaMinutes <= 30) return 'Nearby (<30m)';
    if (etaMinutes <= 60) return 'Commutable (<1h)';
    return 'Far (>1h)';
}

/**
 * Feature #12: Build map pin metadata to support draggable preview cards.
 */
function buildMapPinPayload(job) {
    if (!job) return null;
    return {
        id: job._id,
        previewTitle: job.title,
        salaryPreview: typeof job.maxSalary === 'number' ? job.maxSalary : null,
        draggable: true,
        snapToCard: true
    };
}

/**
 * Feature #13: Generate common search filter presets.
 */
function getSearchPresets() {
    return [
        { id: 'high_pay', label: 'High Paying', filters: { minSalary: 50000 } },
        { id: 'nearby', label: 'Very Close', filters: { maxDistance: 5 } },
        { id: 'urgent', label: 'Actively Hiring', filters: { isUrgent: true } },
        { id: 'no_exp', label: 'Entry Level', filters: { experienceYears: 0 } }
    ];
}

module.exports = {
    getRadiusSliderConfig,
    buildHeatmapClusters,
    evaluateTravelEtaLimit,
    buildMapPinPayload,
    getSearchPresets
};
