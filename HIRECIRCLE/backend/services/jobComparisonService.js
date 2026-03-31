'use strict';
/**
 * jobComparisonService.js
 * Feature #59 — Job Comparison Screen
 *
 * Side-by-side comparison of up to 3 jobs. Returns normalized comparison object
 * with salary, location, skills, urgency, distance fields.
 *
 * Non-disruptive: pure query + formatting. No match engine changes.
 */

const Job = require('../models/Job');

const MAX_COMPARE = 3;

/**
 * Fetch and compare multiple jobs.
 * @param {string[]} jobIds
 * @param {{ lat?: number, lng?: number }} workerLocation - for distance calc
 */
async function compareJobs(jobIds, workerLocation = {}) {
    if (!Array.isArray(jobIds) || jobIds.length < 2 || jobIds.length > MAX_COMPARE) {
        throw Object.assign(new Error(`Provide 2-${MAX_COMPARE} job IDs to compare`), { code: 400 });
    }

    const jobs = await Job.find({ _id: { $in: jobIds }, isOpen: true })
        .select('title companyName location salary minSalary maxSalary jobType skills isRemote createdAt isBoosted boostTier isUrgent geo')
        .lean();

    if (jobs.length < 2) throw Object.assign(new Error('Could not find 2 or more open jobs with those IDs'), { code: 404 });

    const { haversineDistanceKm } = require('./geoDiscoveryService');

    return jobs.map((job) => {
        const salaryDisplay = job.maxSalary
            ? `₹${(job.minSalary || 0).toLocaleString()} – ₹${job.maxSalary.toLocaleString()}`
            : job.salary ? `₹${Number(job.salary).toLocaleString()}` : 'Negotiable';

        let distanceKm = null;
        if (workerLocation.lat && workerLocation.lng && job.geo?.coordinates?.length === 2) {
            distanceKm = haversineDistanceKm(
                workerLocation.lat, workerLocation.lng,
                job.geo.coordinates[1], job.geo.coordinates[0],
            );
            distanceKm = Math.round(distanceKm * 10) / 10;
        }

        return {
            jobId: String(job._id),
            title: job.title,
            company: job.companyName,
            location: job.location,
            salaryDisplay,
            jobType: job.jobType,
            skills: job.skills || [],
            isRemote: job.isRemote || false,
            isBoosted: job.isBoosted || false,
            boostTier: job.boostTier || null,
            isUrgent: job.isUrgent || false,
            distanceKm,
            postedDaysAgo: Math.floor((Date.now() - new Date(job.createdAt)) / (1000 * 60 * 60 * 24)),
        };
    });
}

module.exports = { compareJobs, MAX_COMPARE };
