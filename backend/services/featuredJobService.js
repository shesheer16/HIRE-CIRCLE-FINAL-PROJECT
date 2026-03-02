'use strict';
/**
 * featuredJobService.js
 * Feature #62 — Featured Job Positions Carousel
 * Feature #65 — Promoted Jobs Filter Top Placement
 *
 * Returns a curated list of featured/promoted jobs for the carousel.
 * Priority: premium-tier boost > standard-boost > recent + urgent.
 *
 * Non-disruptive: additive query layer. No match engine changes.
 */

const Job = require('../models/Job');

const FEATURED_LIMIT = 10;

/**
 * Get featured jobs for carousel display.
 * @param {{ lat?: number, lng?: number, limit?: number }} opts
 */
async function getFeaturedJobs({ lat, lng, limit = FEATURED_LIMIT } = {}) {
    const safeLimit = Math.min(Number(limit), 20);

    // Priority 1: premium boosted jobs
    const premium = await Job.find({
        isOpen: true,
        isBoosted: true,
        boostTier: 'premium',
        boostExpiresAt: { $gt: new Date() },
    })
        .sort({ createdAt: -1 })
        .limit(Math.ceil(safeLimit / 2))
        .select('title companyName location salary isBoosted boostTier isUrgent skills geo')
        .lean();

    // Priority 2: pro-tier boost
    const remaining = safeLimit - premium.length;
    const pro = remaining > 0
        ? await Job.find({
            isOpen: true,
            isBoosted: true,
            boostTier: 'pro',
            boostExpiresAt: { $gt: new Date() },
            _id: { $nin: premium.map((j) => j._id) },
        })
            .sort({ createdAt: -1 })
            .limit(remaining)
            .select('title companyName location salary isBoosted boostTier isUrgent skills geo')
            .lean()
        : [];

    const combined = [...premium, ...pro];

    // Fill rest with urgent/recent if needed
    if (combined.length < safeLimit) {
        const fill = await Job.find({
            isOpen: true,
            isUrgent: true,
            _id: { $nin: combined.map((j) => j._id) },
        })
            .sort({ createdAt: -1 })
            .limit(safeLimit - combined.length)
            .select('title companyName location salary isBoosted boostTier isUrgent skills geo')
            .lean();
        combined.push(...fill);
    }

    return combined.map((j) => ({
        ...j,
        featuredLabel: j.boostTier === 'premium' ? 'Featured ⭐' : j.boostTier === 'pro' ? 'Promoted' : '🔥 Urgent',
    }));
}

/**
 * Get promoted jobs (top-placement filter).
 */
async function getPromotedJobs(limit = 5) {
    return Job.find({
        isOpen: true,
        isBoosted: true,
        boostExpiresAt: { $gt: new Date() },
    })
        .sort({ boostTier: -1, createdAt: -1 })
        .limit(Math.min(limit, 20))
        .select('title companyName location salary boostTier isUrgent')
        .lean();
}

module.exports = { getFeaturedJobs, getPromotedJobs };
