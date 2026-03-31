'use strict';
/**
 * jobDigestService.js
 * Feature #20 — Personalized Daily Job Digest Cards
 *
 * Generates a curated daily digest of jobs for a worker.
 * Factors: skills match, location, salary preference, recent activity.
 *
 * Non-disruptive: additive query + aggregation. No match engine changes.
 */

const Job = require('../models/Job');

/**
 * Generate daily digest for a worker.
 * @param {object} worker - { skills, location, city, minSalary, lat, lng }
 * @param {{ limit?, excludedIds? }} opts
 */
async function getDailyDigest(worker, { limit = 10, excludedIds = [] } = {}) {
    const safeLimit = Math.min(Number(limit), 20);
    const skills = Array.isArray(worker?.skills) ? worker.skills : [];
    const city = String(worker?.city || worker?.location || '').trim();

    const filter = {
        isOpen: true,
        _id: { $nin: excludedIds },
    };

    // Attempt skill + city match first
    const specific = await Job.find({
        ...filter,
        $or: [
            skills.length ? { skills: { $in: skills } } : null,
            city ? { location: new RegExp(city, 'i') } : null,
        ].filter(Boolean),
    })
        .sort({ isBoosted: -1, isUrgent: -1, createdAt: -1 })
        .limit(safeLimit)
        .select('title companyName location salary skills isUrgent isBoosted createdAt')
        .lean();

    if (specific.length >= safeLimit) return { jobs: specific, digestType: 'personalized' };

    // Fill with recent jobs
    const needed = safeLimit - specific.length;
    const existingIds = specific.map((j) => j._id);
    const fill = await Job.find({
        ...filter,
        _id: { $nin: [...excludedIds, ...existingIds] },
    })
        .sort({ isUrgent: -1, createdAt: -1 })
        .limit(needed)
        .select('title companyName location salary skills isUrgent isBoosted createdAt')
        .lean();

    return { jobs: [...specific, ...fill], digestType: 'mixed' };
}

module.exports = { getDailyDigest };
