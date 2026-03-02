'use strict';

/**
 * jobUrgencyBadgeService.js
 * 
 * Provides visual urgency badges for Jobs to increase conversion on the candidate side.
 * Badges derived nondestructively from existing Job and Application metadata.
 */

const Job = require('../models/Job');
const Application = require('../models/Application');

/**
 * Computes urgency badges for a single job from a candidate's perspective.
 * @param {Object} job - Populated Mongoose Job object (lean)
 * @param {Number} matchPercentage - (Optional) Pre-computed Match Engine %
 * @returns {Array<{label: String, color: String, icon: String}>}
 */
async function getJobUrgencyBadges(job, matchPercentage = null) {
    if (!job || !job._id) return [];

    const badges = [];

    // 1. "New" Badge
    // If the job was created within the last 48 hours
    const now = new Date();
    const createdAt = new Date(job.createdAt);
    const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);

    if (hoursSinceCreation <= 48) {
        badges.push({
            label: 'New',
            color: 'green',
            icon: 'sparkles'
        });
    }

    // 2. "High Match" Badge
    // Requires >= 85% match from the Match Engine
    if (matchPercentage !== null && matchPercentage >= 85) {
        badges.push({
            label: 'High Match',
            color: 'purple',
            icon: 'bullseye'
        });
    }

    // 3. "Urgent" Badge
    // If job has `isPulse` flag (urgent shift/gig) OR expires in less than 72 hours
    const hoursUntilExpiry = job.expiresAt ? (new Date(job.expiresAt) - now) / (1000 * 60 * 60) : Infinity;

    if (job.isPulse || (hoursUntilExpiry > 0 && hoursUntilExpiry <= 72)) {
        badges.push({
            label: 'Urgent',
            color: 'red',
            icon: 'clock' // or flame
        });
    }

    // 4. "Actively Hiring" Badge
    // If employer has hired for this job recently, OR is priorityListing
    if (job.priorityListing) {
        badges.push({
            label: 'Actively Hiring',
            color: 'blue',
            icon: 'activity'
        });
    } else {
        // Fallback: check if there are recent hired applications on this job (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const recentHires = await Application.countDocuments({
            job: job._id,
            status: 'hired',
            hiredAt: { $gte: sevenDaysAgo }
        });

        if (recentHires > 0) {
            badges.push({
                label: 'Actively Hiring',
                color: 'blue',
                icon: 'activity'
            });
        }
    }

    return badges;
}

module.exports = {
    getJobUrgencyBadges
};
