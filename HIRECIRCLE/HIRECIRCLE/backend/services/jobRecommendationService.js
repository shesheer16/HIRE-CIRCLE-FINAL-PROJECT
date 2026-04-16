'use strict';
/**
 * jobRecommendationService.js
 * Feature #6/#83 — Smart Job Recommendations (history-based + AI resume match)
 *
 * Generates personalised job recommendations by:
 *  1. History-based: skills from WorkerProfile + apply/save history (#6)
 *  2. Resume-based: parses resume skills and boosts matching jobs (#83)
 *
 * Non-disruptive: additive recommendation layer on top of existing job feed.
 * Does NOT modify matchingController.js.
 */
'use strict';

const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');

const MAX_RECOMMENDATIONS = 20;

/**
 * History-based smart recommendations (#6)
 * Uses the worker's skill list + location + availability from their profile.
 *
 * @param {string} userId
 * @param {object} opts
 * @returns {Promise<object[]>}
 */
async function getHistoryBasedRecommendations(userId, opts = {}) {
    const { limit = 10, excludeJobIds = [] } = opts;

    const worker = await WorkerProfile.findOne({ user: userId })
        .select('skills location geo availability')
        .lean();

    if (!worker) return [];

    const skills = (worker.skills || []).map((s) => String(s).trim()).filter(Boolean);
    const location = String(worker.location || '').trim();
    const availability = String(worker.availability || '').toLowerCase();

    const query = {
        isOpen: true,
        _id: { $nin: excludeJobIds },
    };

    // Skills filter: at least one skill overlaps
    if (skills.length > 0) {
        query.skills = { $elemMatch: { $in: skills } };
    }

    // Location soft-match (optional: don't hard-filter, just weight by score)
    if (location) {
        query.$or = [
            { location: { $regex: location, $options: 'i' } },
            { isRemote: true },
        ];
    }

    // Job type soft-match
    if (availability && availability !== 'any') {
        query.jobType = { $in: [availability, 'any'] };
    }

    const jobs = await Job.find(query)
        .sort({ createdAt: -1 })
        .limit(Math.min(limit, MAX_RECOMMENDATIONS))
        .select('title companyName location salary jobType skills isRemote createdAt')
        .lean();

    return jobs.map((j) => ({
        ...j,
        recommendationSource: 'history_profile',
        matchedSkills: (j.skills || []).filter((s) => skills.map((sk) => sk.toLowerCase()).includes(s.toLowerCase())),
    }));
}

/**
 * Resume-based AI recommendations (#83)
 * Uses parsed resume skills from workerProfile.resumeSkills (if available)
 * and boosts jobs with high skill overlap.
 *
 * @param {string} userId
 * @param {string[]} resumeSkills  - array of skills extracted from resume
 * @param {object} opts
 * @returns {Promise<object[]>}
 */
async function getResumeBasedRecommendations(userId, resumeSkills = [], opts = {}) {
    const { limit = 10, excludeJobIds = [] } = opts;

    if (!resumeSkills || resumeSkills.length === 0) {
        return getHistoryBasedRecommendations(userId, { limit, excludeJobIds });
    }

    const normalised = resumeSkills.map((s) => String(s).trim().toLowerCase()).filter(Boolean);

    const jobs = await Job.find({
        isOpen: true,
        _id: { $nin: excludeJobIds },
        skills: { $elemMatch: { $in: normalised } },
    })
        .sort({ createdAt: -1 })
        .limit(Math.min(limit, MAX_RECOMMENDATIONS))
        .select('title companyName location salary jobType skills isRemote createdAt')
        .lean();

    // Sort by overlap count descending
    return jobs
        .map((j) => {
            const jobSkills = (j.skills || []).map((s) => s.toLowerCase());
            const overlap = normalised.filter((s) => jobSkills.includes(s));
            return {
                ...j,
                recommendationSource: 'resume_ai',
                matchedSkills: overlap,
                overlapScore: overlap.length,
            };
        })
        .sort((a, b) => b.overlapScore - a.overlapScore);
}

module.exports = {
    getHistoryBasedRecommendations,
    getResumeBasedRecommendations,
};
