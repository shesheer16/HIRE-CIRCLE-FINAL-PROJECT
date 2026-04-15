const Application = require('../models/Application');
const CitySkillGraph = require('../models/CitySkillGraph');
const Job = require('../models/Job');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const normalizeText = (value, fallback = 'unknown') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const getTopRisingRolesPerCity = async ({ day }) => {
    const recentFrom = new Date(day.getTime() - (14 * 24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (28 * 24 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recentRows, priorRows] = await Promise.all([
        Job.aggregate([
            { $match: { createdAt: { $gte: recentFrom, $lte: day } } },
            { $group: { _id: { city: '$location', role: '$title' }, count: { $sum: 1 } } },
        ]),
        Job.aggregate([
            { $match: { createdAt: { $gte: priorFrom, $lte: priorTo } } },
            { $group: { _id: { city: '$location', role: '$title' }, count: { $sum: 1 } } },
        ]),
    ]);

    const priorMap = new Map(
        priorRows.map((row) => [`${normalizeText(row._id?.city)}::${normalizeText(row._id?.role)}`, Number(row.count || 0)])
    );

    return recentRows
        .map((row) => {
            const city = normalizeText(row._id?.city);
            const role = normalizeText(row._id?.role);
            const recentCount = Number(row.count || 0);
            const priorCount = Number(priorMap.get(`${city}::${role}`) || 0);
            const delta = recentCount - priorCount;
            const growthRate = priorCount > 0 ? (delta / priorCount) : (recentCount > 0 ? 1 : 0);
            return {
                city,
                roleCluster: role,
                recentCount,
                priorCount,
                growthRate: Number(growthRate.toFixed(4)),
            };
        })
        .filter((row) => row.growthRate > 0)
        .sort((a, b) => b.growthRate - a.growthRate)
        .slice(0, 20);
};

const getSalaryInflationTrends = async ({ day }) => {
    const recentFrom = new Date(day.getTime() - (30 * 24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (60 * 24 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recentRows, priorRows] = await Promise.all([
        Job.aggregate([
            { $match: { createdAt: { $gte: recentFrom, $lte: day } } },
            { $group: { _id: '$location', avgMaxSalary: { $avg: '$maxSalary' }, count: { $sum: 1 } } },
        ]),
        Job.aggregate([
            { $match: { createdAt: { $gte: priorFrom, $lte: priorTo } } },
            { $group: { _id: '$location', avgMaxSalary: { $avg: '$maxSalary' }, count: { $sum: 1 } } },
        ]),
    ]);

    const priorMap = new Map(
        priorRows.map((row) => [normalizeText(row._id), Number(row.avgMaxSalary || 0)])
    );

    return recentRows
        .map((row) => {
            const city = normalizeText(row._id);
            const current = Number(row.avgMaxSalary || 0);
            const previous = Number(priorMap.get(city) || 0);
            const inflation = previous > 0 ? (current - previous) / previous : 0;
            return {
                city,
                avgMaxSalaryRecent: Number(current.toFixed(2)),
                avgMaxSalaryPrior: Number(previous.toFixed(2)),
                inflationRate: Number(inflation.toFixed(4)),
                sampleSize: Number(row.count || 0),
            };
        })
        .sort((a, b) => b.inflationRate - a.inflationRate)
        .slice(0, 20);
};

const getSkillDemandShift = async () => {
    const rows = await CitySkillGraph.aggregate([
        { $sort: { city: 1, roleCluster: 1, skill: 1, computedDay: -1 } },
        {
            $group: {
                _id: { city: '$city', roleCluster: '$roleCluster', skill: '$skill' },
                latest: { $first: '$$ROOT' },
                previous: { $push: '$$ROOT' },
            },
        },
    ]);

    return rows
        .map((row) => {
            const latest = row.latest;
            const previous = row.previous[1];
            const latestFreq = Number(latest?.coOccurrenceFrequency || 0);
            const previousFreq = Number(previous?.coOccurrenceFrequency || 0);
            const delta = latestFreq - previousFreq;
            const growthRate = previousFreq > 0 ? (delta / previousFreq) : (latestFreq > 0 ? 1 : 0);

            return {
                city: latest?.city || 'unknown',
                roleCluster: latest?.roleCluster || 'general',
                skill: latest?.skill || 'unknown',
                frequencyRecent: latestFreq,
                frequencyPrior: previousFreq,
                growthRate: Number(growthRate.toFixed(4)),
            };
        })
        .filter((row) => row.growthRate > 0)
        .sort((a, b) => b.growthRate - a.growthRate)
        .slice(0, 30);
};

const getEmployerChurnClusters = async ({ day }) => {
    const threshold = new Date(day.getTime() - (30 * 24 * 60 * 60 * 1000));

    const rows = await Application.aggregate([
        {
            $group: {
                _id: '$employer',
                totalApplications: { $sum: 1 },
                lastActivityAt: { $max: '$updatedAt' },
                hires: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                    },
                },
            },
        },
    ]);

    return rows
        .map((row) => {
            const last = row.lastActivityAt ? new Date(row.lastActivityAt) : new Date(0);
            const inactiveDays = Math.floor((day.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
            const cluster = inactiveDays > 60
                ? 'HIGH_CHURN_RISK'
                : inactiveDays > 30
                    ? 'MEDIUM_CHURN_RISK'
                    : 'STABLE';
            const score = clamp((inactiveDays / 90) * 0.7 + (row.hires === 0 ? 0.3 : 0), 0, 1);

            return {
                employerId: row._id,
                cluster,
                churnRiskScore: Number(score.toFixed(4)),
                inactiveDays,
                totalApplications: Number(row.totalApplications || 0),
                hires: Number(row.hires || 0),
                isPast30dThreshold: last < threshold,
            };
        })
        .sort((a, b) => b.churnRiskScore - a.churnRiskScore)
        .slice(0, 50);
};

const getWorkerChurnClusters = async ({ day }) => {
    const rows = await WorkerEngagementScore.find({})
        .select('workerId userId score computedAt applicationFrequency30d retentionSuccessRate')
        .sort({ score: 1, computedAt: -1 })
        .limit(500)
        .lean();

    return rows
        .map((row) => {
            const inactivityDays = Math.floor((day.getTime() - new Date(row.computedAt || 0).getTime()) / (24 * 60 * 60 * 1000));
            const churnRisk = clamp((1 - Number(row.score || 0)) * 0.7 + (inactivityDays > 15 ? 0.3 : 0), 0, 1);
            const cluster = churnRisk > 0.75
                ? 'HIGH_CHURN_RISK'
                : churnRisk > 0.5
                    ? 'MEDIUM_CHURN_RISK'
                    : 'STABLE';
            return {
                workerId: row.workerId,
                userId: row.userId || null,
                cluster,
                churnRiskScore: Number(churnRisk.toFixed(4)),
                engagementScore: Number(row.score || 0),
                inactivityDays,
                applicationFrequency30d: Number(row.applicationFrequency30d || 0),
                retentionSuccessRate: Number(row.retentionSuccessRate || 0),
            };
        })
        .sort((a, b) => b.churnRiskScore - a.churnRiskScore)
        .slice(0, 100);
};

const getMarketInsights = async ({ day = new Date() } = {}) => {
    const [risingRoles, salaryInflationTrends, skillDemandShift, employerChurnClusters, workerChurnClusters] = await Promise.all([
        getTopRisingRolesPerCity({ day }),
        getSalaryInflationTrends({ day }),
        getSkillDemandShift(),
        getEmployerChurnClusters({ day }),
        getWorkerChurnClusters({ day }),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        topRisingRolesPerCity: risingRoles,
        salaryInflationTrends,
        skillDemandShift,
        employerChurnClusters,
        workerChurnClusters,
    };
};

module.exports = {
    getMarketInsights,
};
