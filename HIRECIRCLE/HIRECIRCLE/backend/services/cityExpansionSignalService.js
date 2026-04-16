const CityExpansionSignal = require('../models/CityExpansionSignal');
const CityHiringDailySnapshot = require('../models/CityHiringDailySnapshot');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const RevenueEvent = require('../models/RevenueEvent');
const { startOfUtcDay } = require('../utils/timezone');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const trendRatio = (recent, prior) => {
    if (prior <= 0 && recent <= 0) return 0;
    if (prior <= 0 && recent > 0) return 1;
    return (recent - prior) / prior;
};

const computeTrendScore = (recent, prior) => clamp01(0.5 + (trendRatio(recent, prior) * 0.5));

const aggregateSnapshotPeriod = async ({ city, from, to }) => {
    const rows = await CityHiringDailySnapshot.aggregate([
        {
            $match: {
                city: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                day: { $gte: from, $lte: to },
            },
        },
        {
            $group: {
                _id: null,
                applications: { $sum: '$metrics.applications' },
                hired: { $sum: '$metrics.hired' },
                retention30d: { $sum: '$metrics.retention30d' },
            },
        },
    ]);

    return rows[0] || { applications: 0, hired: 0, retention30d: 0 };
};

const aggregateBoostRevenue = async ({ city, from, to }) => {
    const rows = await RevenueEvent.aggregate([
        {
            $match: {
                city: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
                eventType: 'boost_purchase',
                status: 'succeeded',
                settledAt: { $gte: from, $lte: to },
            },
        },
        {
            $group: {
                _id: null,
                amountInr: { $sum: '$amountInr' },
            },
        },
    ]);

    return Number(rows[0]?.amountInr || 0);
};

const computeCityExpansionSignal = async ({ city, day = new Date() }) => {
    const dayStart = startOfUtcDay(day);

    const latestLiquidity = await CityLiquidityScore.findOne({
        city: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    })
        .sort({ day: -1 })
        .lean();

    if (!latestLiquidity) return null;

    const recentFrom = new Date(dayStart.getTime() - (14 * 24 * 60 * 60 * 1000));
    const priorFrom = new Date(dayStart.getTime() - (28 * 24 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recentSnapshot, priorSnapshot, recentBoostRevenue, priorBoostRevenue] = await Promise.all([
        aggregateSnapshotPeriod({ city, from: recentFrom, to: dayStart }),
        aggregateSnapshotPeriod({ city, from: priorFrom, to: priorTo }),
        aggregateBoostRevenue({ city, from: recentFrom, to: dayStart }),
        aggregateBoostRevenue({ city, from: priorFrom, to: priorTo }),
    ]);

    const workerSupplyScore = clamp01(safeDiv(latestLiquidity.activeWorkers30d, Math.max(latestLiquidity.openJobs * 3, 1)));
    const employerDemandScore = clamp01(safeDiv(latestLiquidity.openJobs, Math.max(latestLiquidity.activeEmployers30d, 1)));

    const recentFillRate = safeDiv(recentSnapshot.hired, Math.max(recentSnapshot.applications, 1));
    const priorFillRate = safeDiv(priorSnapshot.hired, Math.max(priorSnapshot.applications, 1));

    const recentRetentionRate = safeDiv(recentSnapshot.retention30d, Math.max(recentSnapshot.hired, 1));
    const priorRetentionRate = safeDiv(priorSnapshot.retention30d, Math.max(priorSnapshot.hired, 1));

    const fillRateTrend = computeTrendScore(recentFillRate, priorFillRate);
    const retention30dTrend = computeTrendScore(recentRetentionRate, priorRetentionRate);
    const boostRevenueTrend = computeTrendScore(recentBoostRevenue, priorBoostRevenue);

    const expansionReadinessScore = clamp01(
        (workerSupplyScore * 0.25)
        + (employerDemandScore * 0.2)
        + (fillRateTrend * 0.2)
        + (retention30dTrend * 0.2)
        + (boostRevenueTrend * 0.15)
    );

    const readinessStatus = expansionReadinessScore > 0.72
        ? 'READY_FOR_SCALE'
        : expansionReadinessScore > 0.58
            ? 'WATCHLIST'
            : 'NOT_READY';

    return CityExpansionSignal.findOneAndUpdate(
        { city, day: dayStart },
        {
            $set: {
                city,
                day: dayStart,
                workerSupplyScore,
                employerDemandScore,
                fillRateTrend,
                retention30dTrend,
                boostRevenueTrend,
                expansionReadinessScore,
                readinessStatus,
                metadata: {
                    recentFillRate,
                    priorFillRate,
                    recentRetentionRate,
                    priorRetentionRate,
                    recentBoostRevenue,
                    priorBoostRevenue,
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const computeCityExpansionSignals = async ({ day = new Date() } = {}) => {
    const cities = await CityLiquidityScore.distinct('city');
    const rows = [];

    for (const city of cities) {
        const row = await computeCityExpansionSignal({ city, day });
        if (row) rows.push(row);
    }

    return rows;
};

const getLatestCityExpansionSignals = async ({ city = null, limit = 100 } = {}) => {
    const query = city
        ? { city: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        : {};

    return CityExpansionSignal.aggregate([
        { $match: query },
        { $sort: { city: 1, day: -1 } },
        {
            $group: {
                _id: '$city',
                doc: { $first: '$$ROOT' },
            },
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { expansionReadinessScore: -1, city: 1 } },
        { $limit: Number(limit) || 100 },
    ]);
};

module.exports = {
    computeCityExpansionSignal,
    computeCityExpansionSignals,
    getLatestCityExpansionSignals,
};
