'use strict';
/**
 * boostJobService.js
 * Feature #61 — Boost Job Listing (paid visibility promotion)
 *
 * Allows employers to pay to boost a job listing for increased visibility.
 * Boost tiers: Standard (3d), Pro (7d), Premium (14d)
 * Non-disruptive: adds `isBoosted`, `boostTier`, `boostExpiresAt` fields
 * to job queries — no match engine changes.
 */

const Job = require('../models/Job');

const BOOST_TIERS = {
    standard: { durationDays: 3, sortWeight: 10 },
    pro: { durationDays: 7, sortWeight: 25 },
    premium: { durationDays: 14, sortWeight: 50 },
};

/**
 * Apply a boost to a job (called after payment confirmation).
 * @param {string} jobId
 * @param {string} employerId - must own the job
 * @param {'standard'|'pro'|'premium'} tier
 */
async function boostJob(jobId, employerId, tier) {
    if (!BOOST_TIERS[tier]) {
        throw Object.assign(
            new Error(`Invalid boost tier. Allowed: ${Object.keys(BOOST_TIERS).join(', ')}`),
            { code: 400 }
        );
    }

    const job = await Job.findOne({ _id: jobId, employer: employerId });
    if (!job) throw Object.assign(new Error('Job not found or not authorized'), { code: 404 });
    if (!job.isOpen) throw Object.assign(new Error('Cannot boost a closed job'), { code: 400 });

    const { durationDays, sortWeight } = BOOST_TIERS[tier];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await Job.updateOne(
        { _id: jobId },
        {
            $set: {
                isBoosted: true,
                boostTier: tier,
                boostExpiresAt: expiresAt,
                boostSortWeight: sortWeight,
            },
        }
    );

    return {
        boosted: true,
        jobId,
        tier,
        expiresAt: expiresAt.toISOString(),
        durationDays,
    };
}

/**
 * Remove a boost (called on expiry or manual cancel).
 */
async function clearBoost(jobId) {
    await Job.updateOne(
        { _id: jobId },
        {
            $set: {
                isBoosted: false,
                boostTier: null,
                boostExpiresAt: null,
                boostSortWeight: 0,
            },
        }
    );
    return { cleared: true };
}

/**
 * Query helper: get active boost metadata for a job.
 */
async function getBoostStatus(jobId) {
    const job = await Job.findById(jobId)
        .select('isBoosted boostTier boostExpiresAt boostSortWeight')
        .lean();
    if (!job) throw Object.assign(new Error('Job not found'), { code: 404 });

    const isActive = job.isBoosted && job.boostExpiresAt && new Date(job.boostExpiresAt) > new Date();
    return {
        isBoosted: !!isActive,
        tier: isActive ? job.boostTier : null,
        expiresAt: job.boostExpiresAt || null,
        expired: job.isBoosted && !isActive,
    };
}

module.exports = { boostJob, clearBoost, getBoostStatus, BOOST_TIERS };
