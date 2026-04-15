'use strict';
/**
 * shakeJobService.js
 * Feature #5 — Shake to Find Random Job
 *
 * Returns a random open job with some proximity bias toward user location.
 * Called by mobile accelerometer shake event.
 *
 * Non-disruptive: pure query. No match engine changes.
 */

const Job = require('../models/Job');

/**
 * Get a random open job, optionally biased toward a location.
 * @param {{ lat?: number, lng?: number }} location
 * @returns {Promise<object>}
 */
async function getRandomJob(location = {}) {
    const filter = { isOpen: true };

    // If location provided, sample from jobs within 50km first
    if (location.lat && location.lng) {
        const geoFilter = {
            ...filter,
            geo: {
                $near: {
                    $geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
                    $maxDistance: 50000,
                },
            },
        };

        try {
            const count = await Job.countDocuments(geoFilter);
            if (count > 0) {
                const skip = Math.floor(Math.random() * count);
                const job = await Job.findOne(geoFilter).skip(skip)
                    .select('title companyName location salary jobType skills isUrgent')
                    .lean();
                if (job) return { ...job, discoveryMode: 'shake_nearby' };
            }
        } catch (_) { /* fallback to global */ }
    }

    // Global fallback
    const totalCount = await Job.countDocuments(filter);
    if (totalCount === 0) throw Object.assign(new Error('No jobs available'), { code: 404 });

    const skip = Math.floor(Math.random() * Math.min(totalCount, 200));
    const job = await Job.findOne(filter).skip(skip)
        .select('title companyName location salary jobType skills isUrgent')
        .lean();

    if (!job) throw Object.assign(new Error('No jobs available'), { code: 404 });
    return { ...job, discoveryMode: 'shake_global' };
}

module.exports = { getRandomJob };
