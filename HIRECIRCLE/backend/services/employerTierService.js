const mongoose = require('mongoose');

const Application = require('../models/Application');
const EmployerTier = require('../models/EmployerTier');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const RevenueEvent = require('../models/RevenueEvent');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const toObjectId = (value) => (
    mongoose.Types.ObjectId.isValid(value)
        ? new mongoose.Types.ObjectId(value)
        : value
);

const getTierFromScore = (score) => {
    if (score >= 0.82) return 'Platinum';
    if (score >= 0.68) return 'Gold';
    if (score >= 0.54) return 'Silver';
    return 'Standard';
};

const getTierBoost = (tier) => {
    if (tier === 'Platinum') return { rankingBoostMultiplier: 1.05, candidateSurfacingPriority: 4 };
    if (tier === 'Gold') return { rankingBoostMultiplier: 1.03, candidateSurfacingPriority: 3 };
    if (tier === 'Silver') return { rankingBoostMultiplier: 1.01, candidateSurfacingPriority: 2 };
    return { rankingBoostMultiplier: 1, candidateSurfacingPriority: 1 };
};

const computeEmployerTierForEmployer = async ({ employerId, upsert = true }) => {
    const safeEmployerId = toObjectId(employerId);

    const [appStatsRows, paymentRows, lifecycleRows] = await Promise.all([
        Application.aggregate([
            { $match: { employer: safeEmployerId } },
            {
                $group: {
                    _id: null,
                    totalApplications: { $sum: 1 },
                    shortlisted: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0],
                        },
                    },
                    hires: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                    avgResponseMs: {
                        $avg: { $subtract: ['$updatedAt', '$createdAt'] },
                    },
                },
            },
        ]),
        RevenueEvent.aggregate([
            { $match: { employerId: safeEmployerId } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                },
            },
        ]),
        HiringLifecycleEvent.aggregate([
            {
                $match: {
                    employerId: safeEmployerId,
                    eventType: { $in: ['APPLICATION_HIRED', 'RETENTION_30D'] },
                },
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const appStats = appStatsRows[0] || {
        totalApplications: 0,
        shortlisted: 0,
        hires: 0,
        avgResponseMs: 72 * 60 * 60 * 1000,
    };

    const paymentSucceeded = Number((paymentRows.find((row) => row._id === 'succeeded') || {}).count || 0);
    const paymentFailed = Number((paymentRows.find((row) => row._id === 'failed') || {}).count || 0);

    const hiredEvents = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || appStats.hires || 0);
    const retainedEvents = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);

    const hireCompletionRate = clamp01(safeDiv(appStats.hires, Math.max(appStats.shortlisted, 1)));
    const paymentReliability = clamp01(safeDiv(paymentSucceeded, Math.max(paymentSucceeded + paymentFailed, 1)));
    const retention30dRate = clamp01(safeDiv(retainedEvents, Math.max(hiredEvents, 1)));
    const responseTimeHours = Number(appStats.avgResponseMs || 0) / (1000 * 60 * 60);
    const responseScore = clamp01(1 - safeDiv(responseTimeHours, 72));

    const score = clamp01(
        (hireCompletionRate * 0.35)
        + (paymentReliability * 0.25)
        + (retention30dRate * 0.25)
        + (responseScore * 0.15)
    );

    const tier = getTierFromScore(score);
    const boost = getTierBoost(tier);

    const payload = {
        employerId: safeEmployerId,
        tier,
        score,
        hireCompletionRate,
        paymentReliability,
        retention30dRate,
        responseTimeHours: Number(responseTimeHours.toFixed(2)),
        rankingBoostMultiplier: boost.rankingBoostMultiplier,
        candidateSurfacingPriority: boost.candidateSurfacingPriority,
        computedAt: new Date(),
    };

    if (!upsert) return payload;

    return EmployerTier.findOneAndUpdate(
        { employerId: safeEmployerId },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const getEmployerTier = async ({ employerId, computeIfMissing = true }) => {
    const safeEmployerId = toObjectId(employerId);
    let tier = await EmployerTier.findOne({ employerId: safeEmployerId }).lean();

    if (!tier && computeIfMissing) {
        tier = await computeEmployerTierForEmployer({ employerId: safeEmployerId, upsert: true });
    }

    return tier;
};

const getEmployerTierMap = async ({ employerIds = [], computeMissing = true } = {}) => {
    const uniqueIds = Array.from(new Set(
        employerIds.map((id) => String(id || '').trim()).filter(Boolean)
    ));

    if (!uniqueIds.length) return new Map();

    const safeIds = uniqueIds.map((id) => toObjectId(id));
    const docs = await EmployerTier.find({ employerId: { $in: safeIds } }).lean();
    const map = new Map(docs.map((doc) => [String(doc.employerId), doc]));

    if (computeMissing) {
        for (const id of safeIds) {
            const key = String(id);
            if (!map.has(key)) {
                const computed = await computeEmployerTierForEmployer({ employerId: id, upsert: true });
                if (computed) map.set(key, computed);
            }
        }
    }

    return map;
};

module.exports = {
    computeEmployerTierForEmployer,
    getEmployerTier,
    getEmployerTierMap,
};
