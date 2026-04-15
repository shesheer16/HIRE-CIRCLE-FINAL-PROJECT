const AnalyticsEvent = require('../models/AnalyticsEvent');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const Job = require('../models/Job');
const MarketAnomaly = require('../models/MarketAnomaly');
const { detectSecurityAnomalies } = require('./securityAnomalyIntelligenceService');

const upsertAnomaly = async ({
    signature,
    type,
    city = 'global',
    severity = 'medium',
    value = 0,
    baseline = 0,
    threshold = 0,
    detectedAt = new Date(),
    message,
    metadata = {},
}) => {
    const result = await MarketAnomaly.findOneAndUpdate(
        { signature },
        {
            $setOnInsert: {
                signature,
                type,
                city,
                severity,
                value,
                baseline,
                threshold,
                detectedAt,
                message,
                metadata,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return result;
};

const detectLiquidityAnomalies = async ({ day = new Date() }) => {
    const anomalies = [];

    const latestRows = await CityLiquidityScore.aggregate([
        { $sort: { city: 1, day: -1 } },
        {
            $group: {
                _id: '$city',
                latest: { $first: '$$ROOT' },
                previous: { $push: '$$ROOT' },
            },
        },
    ]);

    for (const row of latestRows) {
        const city = row._id;
        const latest = row.latest;
        const previous = row.previous[1] || null;

        if (previous) {
            const employerDrop = previous.activeEmployers30d > 0
                ? (previous.activeEmployers30d - latest.activeEmployers30d) / previous.activeEmployers30d
                : 0;
            if (employerDrop > 0.2) {
                anomalies.push(await upsertAnomaly({
                    signature: `SUDDEN_EMPLOYER_DROP:${city}:${latest.day.toISOString().slice(0, 10)}`,
                    type: 'SUDDEN_EMPLOYER_DROP',
                    city,
                    severity: employerDrop > 0.35 ? 'critical' : 'high',
                    value: latest.activeEmployers30d,
                    baseline: previous.activeEmployers30d,
                    threshold: 0.2,
                    detectedAt: day,
                    message: `Employer activity dropped ${(employerDrop * 100).toFixed(1)}% in ${city}.`,
                }));
            }

            const workerDrop = previous.activeWorkers30d > 0
                ? (previous.activeWorkers30d - latest.activeWorkers30d) / previous.activeWorkers30d
                : 0;
            if (workerDrop > 0.2) {
                anomalies.push(await upsertAnomaly({
                    signature: `WORKER_INACTIVITY_SPIKE:${city}:${latest.day.toISOString().slice(0, 10)}`,
                    type: 'WORKER_INACTIVITY_SPIKE',
                    city,
                    severity: workerDrop > 0.35 ? 'critical' : 'high',
                    value: latest.activeWorkers30d,
                    baseline: previous.activeWorkers30d,
                    threshold: 0.2,
                    detectedAt: day,
                    message: `Worker activity dropped ${(workerDrop * 100).toFixed(1)}% in ${city}.`,
                }));
            }
        }
    }

    return anomalies.filter(Boolean);
};

const detectSalaryInflation = async ({ day = new Date() }) => {
    const anomalies = [];
    const recentFrom = new Date(day.getTime() - (7 * 24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (14 * 24 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const cities = await Job.distinct('location', { status: 'active' });
    for (const city of cities) {
        const [recent, prior] = await Promise.all([
            Job.aggregate([
                { $match: { location: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), createdAt: { $gte: recentFrom, $lte: day } } },
                { $group: { _id: null, avgMaxSalary: { $avg: '$maxSalary' } } },
            ]),
            Job.aggregate([
                { $match: { location: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), createdAt: { $gte: priorFrom, $lte: priorTo } } },
                { $group: { _id: null, avgMaxSalary: { $avg: '$maxSalary' } } },
            ]),
        ]);

        const recentAvg = Number(recent[0]?.avgMaxSalary || 0);
        const priorAvg = Number(prior[0]?.avgMaxSalary || 0);
        if (priorAvg <= 0) continue;

        const inflation = (recentAvg - priorAvg) / priorAvg;
        if (inflation > 0.25) {
            anomalies.push(await upsertAnomaly({
                signature: `SALARY_INFLATION:${city}:${new Date(day).toISOString().slice(0, 10)}`,
                type: 'SALARY_INFLATION',
                city,
                severity: inflation > 0.4 ? 'critical' : 'high',
                value: Number(recentAvg.toFixed(2)),
                baseline: Number(priorAvg.toFixed(2)),
                threshold: 0.25,
                detectedAt: day,
                message: `Salary inflation detected in ${city}: ${(inflation * 100).toFixed(1)}% over prior week.`,
            }));
        }
    }

    return anomalies.filter(Boolean);
};

const detectIpClusterSpikes = async ({ day = new Date() }) => {
    const from24h = new Date(day.getTime() - (24 * 60 * 60 * 1000));

    const rows = await AnalyticsEvent.aggregate([
        {
            $match: {
                createdAt: { $gte: from24h, $lte: day },
                eventName: { $in: ['signup', 'USER_REGISTERED', 'user_registered'] },
            },
        },
        {
            $project: {
                ip: {
                    $ifNull: ['$metadata.ipAddress', '$metadata.ip'],
                },
                city: {
                    $ifNull: ['$metadata.city', 'global'],
                },
            },
        },
        {
            $match: {
                ip: { $type: 'string' },
            },
        },
        {
            $group: {
                _id: {
                    ip: '$ip',
                    city: '$city',
                },
                count: { $sum: 1 },
            },
        },
        {
            $match: {
                count: { $gte: 20 },
            },
        },
    ]);

    const anomalies = [];
    for (const row of rows) {
        const ip = String(row._id?.ip || 'unknown');
        const city = String(row._id?.city || 'global');
        anomalies.push(await upsertAnomaly({
            signature: `MASS_PROFILE_CREATION_IP_CLUSTER:${ip}:${city}:${new Date(day).toISOString().slice(0, 10)}`,
            type: 'MASS_PROFILE_CREATION_IP_CLUSTER',
            city,
            severity: row.count > 50 ? 'critical' : 'high',
            value: row.count,
            baseline: 5,
            threshold: 20,
            detectedAt: day,
            message: `Mass profile creation spike detected from IP cluster ${ip} in ${city}.`,
            metadata: {
                ip,
            },
        }));
    }

    return anomalies.filter(Boolean);
};

const detectMarketAnomalies = async ({ day = new Date() } = {}) => {
    const [liquidity, salaryInflation, ipClusters, securityAnomalies] = await Promise.all([
        detectLiquidityAnomalies({ day }),
        detectSalaryInflation({ day }),
        detectIpClusterSpikes({ day }),
        detectSecurityAnomalies({ day }),
    ]);

    return [...liquidity, ...salaryInflation, ...ipClusters, ...securityAnomalies].filter(Boolean);
};

const getMarketAlerts = async ({ city = null, limit = 100 } = {}) => {
    const query = city
        ? { city: new RegExp(`^${String(city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        : {};

    return MarketAnomaly.find(query)
        .sort({ detectedAt: -1, severity: -1 })
        .limit(Number(limit) || 100)
        .lean();
};

module.exports = {
    detectMarketAnomalies,
    getMarketAlerts,
};
