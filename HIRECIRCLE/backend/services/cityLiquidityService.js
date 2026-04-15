const mongoose = require('mongoose');

const Application = require('../models/Application');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const MarketAnomaly = require('../models/MarketAnomaly');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const { recruiterRoleQuery } = require('../utils/roleGuards');
const { startOfUtcDay } = require('../utils/timezone');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cityRegex = (city) => new RegExp(`^${escapeRegex(city)}$`, 'i');

const toObjectId = (value) => (
    mongoose.Types.ObjectId.isValid(value)
        ? new mongoose.Types.ObjectId(value)
        : value
);

const getCityUniverse = async () => {
    const [jobCities, workerCities] = await Promise.all([
        Job.distinct('location', { status: 'active' }),
        WorkerProfile.distinct('city', {}),
    ]);

    return Array.from(new Set(
        [...jobCities, ...workerCities]
            .map((city) => String(city || '').trim())
            .filter(Boolean)
    ));
};

const computeForCity = async ({ city, day = new Date() }) => {
    const start30d = new Date(day.getTime() - (30 * 24 * 60 * 60 * 1000));

    const [activeWorkers30d, openJobs, employerIds] = await Promise.all([
        WorkerProfile.countDocuments({
            city: cityRegex(city),
            $or: [
                { lastActiveAt: { $gte: start30d } },
                { updatedAt: { $gte: start30d } },
            ],
        }),
        Job.countDocuments({
            location: cityRegex(city),
            isOpen: true,
            status: 'active',
        }),
        Job.distinct('employerId', {
            location: cityRegex(city),
            createdAt: { $gte: start30d },
        }),
    ]);

    const activeEmployers30d = employerIds.length
        ? await User.countDocuments({
            _id: { $in: employerIds.map((id) => toObjectId(id)) },
            role: recruiterRoleQuery(),
        })
        : 0;

    const [applicationRows, lifecycleRows] = await Promise.all([
        Application.aggregate([
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: '$jobDoc' },
            {
                $match: {
                    'jobDoc.location': cityRegex(city),
                    createdAt: { $gte: start30d },
                },
            },
            {
                $group: {
                    _id: null,
                    totalApplications: { $sum: 1 },
                    hiredApplications: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                    avgTimeToFillMs: {
                        $avg: {
                            $cond: [
                                { $eq: ['$status', 'hired'] },
                                { $subtract: ['$updatedAt', '$createdAt'] },
                                null,
                            ],
                        },
                    },
                },
            },
        ]),
        HiringLifecycleEvent.aggregate([
            {
                $match: {
                    city: cityRegex(city),
                    occurredAt: { $gte: start30d },
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

    const apps = applicationRows[0] || {
        totalApplications: 0,
        hiredApplications: 0,
        avgTimeToFillMs: 0,
    };

    const hiredEvents = Number((lifecycleRows.find((row) => row._id === 'APPLICATION_HIRED') || {}).count || 0);
    const retainedEvents = Number((lifecycleRows.find((row) => row._id === 'RETENTION_30D') || {}).count || 0);

    const workersPerJob = Number(safeDiv(activeWorkers30d, Math.max(openJobs, 1)).toFixed(2));
    const avgTimeToFill = Number(safeDiv(apps.avgTimeToFillMs, 1000 * 60 * 60 * 24).toFixed(2));
    const fillRate = clamp01(safeDiv(apps.hiredApplications, Math.max(apps.totalApplications, 1)));
    const churnRate = clamp01(1 - safeDiv(retainedEvents, Math.max(hiredEvents, 1)));

    const marketBand = workersPerJob < 2
        ? 'under_supplied'
        : workersPerJob > 6
            ? 'over_supplied'
            : 'balanced';

    const acquisitionAlertTriggered = marketBand === 'under_supplied';

    const dayStart = startOfUtcDay(day);

    const record = await CityLiquidityScore.findOneAndUpdate(
        { city, day: dayStart },
        {
            $set: {
                city,
                day: dayStart,
                activeWorkers30d,
                activeEmployers30d,
                openJobs,
                workersPerJob,
                avgTimeToFill,
                fillRate,
                churnRate,
                marketBand,
                acquisitionAlertTriggered,
                metadata: {
                    totalApplications30d: Number(apps.totalApplications || 0),
                    hiredApplications30d: Number(apps.hiredApplications || 0),
                    hiredEvents30d: hiredEvents,
                    retainedEvents30d: retainedEvents,
                },
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    if (marketBand !== 'balanced') {
        const signature = `${marketBand}:${city}:${dayStart.toISOString().slice(0, 10)}`;
        await MarketAnomaly.updateOne(
            { signature },
            {
                $setOnInsert: {
                    signature,
                    type: marketBand === 'under_supplied' ? 'CITY_UNDER_SUPPLIED' : 'CITY_OVER_SUPPLIED',
                    city,
                    severity: marketBand === 'under_supplied' ? 'high' : 'medium',
                    value: workersPerJob,
                    baseline: 4,
                    threshold: marketBand === 'under_supplied' ? 2 : 6,
                    detectedAt: dayStart,
                    message: marketBand === 'under_supplied'
                        ? `City ${city} is under supplied (workers/job=${workersPerJob}).`
                        : `City ${city} is over supplied (workers/job=${workersPerJob}).`,
                    metadata: {
                        source: 'city_liquidity_compute',
                    },
                },
            },
            { upsert: true }
        );

        await AnalyticsEvent.create({
            user: null,
            eventName: 'CITY_ACQUISITION_CAMPAIGN_TRIGGERED',
            metadata: {
                city,
                marketBand,
                workersPerJob,
                triggeredAt: dayStart,
            },
        });
    }

    return record;
};

const computeDailyCityLiquidity = async ({ day = new Date() } = {}) => {
    const cities = await getCityUniverse();
    const records = [];

    for (const city of cities) {
        const row = await computeForCity({ city, day });
        records.push(row);
    }

    return records;
};

const getLatestCityLiquidity = async ({ city = null, limit = 100 } = {}) => {
    const query = city ? { city: cityRegex(city) } : {};

    const pipeline = [
        { $match: query },
        { $sort: { city: 1, day: -1 } },
        {
            $group: {
                _id: '$city',
                doc: { $first: '$$ROOT' },
            },
        },
        { $replaceRoot: { newRoot: '$doc' } },
        { $sort: { workersPerJob: 1, city: 1 } },
        { $limit: Number(limit) || 100 },
    ];

    return CityLiquidityScore.aggregate(pipeline);
};

module.exports = {
    computeDailyCityLiquidity,
    getLatestCityLiquidity,
};
