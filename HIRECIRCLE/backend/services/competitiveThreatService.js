const AnalyticsEvent = require('../models/AnalyticsEvent');
const Application = require('../models/Application');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const CompetitiveThreatSignal = require('../models/CompetitiveThreatSignal');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const classifySeverity = (delta, medium, high, critical) => {
    if (delta >= critical) return 'critical';
    if (delta >= high) return 'high';
    if (delta >= medium) return 'medium';
    return 'low';
};

const upsertSignal = async ({
    signature,
    type,
    city = 'global',
    severity = 'medium',
    value = 0,
    baseline = 0,
    threshold = 0,
    message = '',
    detectedAt = new Date(),
    metadata = {},
}) => {
    return CompetitiveThreatSignal.findOneAndUpdate(
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
                message,
                detectedAt,
                metadata,
                status: 'open',
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const detectCityFillRateDrop = async ({ day }) => {
    const rows = await CityLiquidityScore.aggregate([
        { $sort: { city: 1, day: -1 } },
        {
            $group: {
                _id: '$city',
                latest: { $first: '$$ROOT' },
                previous: { $push: '$$ROOT' },
            },
        },
    ]);

    const signals = [];
    for (const row of rows) {
        const latest = row.latest;
        const previous = row.previous[1];
        if (!latest || !previous) continue;

        const drop = previous.fillRate > 0
            ? (previous.fillRate - latest.fillRate) / previous.fillRate
            : 0;

        if (drop > 0.2) {
            const signal = await upsertSignal({
                signature: `CITY_FILL_RATE_DROP:${row._id}:${latest.day.toISOString().slice(0, 10)}`,
                type: 'CITY_FILL_RATE_DROP',
                city: row._id,
                severity: classifySeverity(drop, 0.2, 0.3, 0.45),
                value: Number(latest.fillRate || 0),
                baseline: Number(previous.fillRate || 0),
                threshold: 0.2,
                message: `Fill rate dropped ${(drop * 100).toFixed(1)}% in ${row._id}.`,
                detectedAt: day,
                metadata: {
                    workersPerJob: latest.workersPerJob,
                },
            });
            if (signal) signals.push(signal);
        }
    }

    return signals;
};

const detectEmployerChurnSpike = async ({ day }) => {
    const recentFrom = new Date(day.getTime() - (14 * 24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (28 * 24 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recentRows, priorRows] = await Promise.all([
        Application.aggregate([
            { $match: { createdAt: { $gte: recentFrom, $lte: day } } },
            {
                $group: {
                    _id: '$employer',
                },
            },
            {
                $group: {
                    _id: null,
                    activeEmployers: { $sum: 1 },
                },
            },
        ]),
        Application.aggregate([
            { $match: { createdAt: { $gte: priorFrom, $lte: priorTo } } },
            {
                $group: {
                    _id: '$employer',
                },
            },
            {
                $group: {
                    _id: null,
                    activeEmployers: { $sum: 1 },
                },
            },
        ]),
    ]);

    const recent = Number(recentRows[0]?.activeEmployers || 0);
    const prior = Number(priorRows[0]?.activeEmployers || 0);
    if (!prior) return [];

    const drop = (prior - recent) / prior;
    if (drop <= 0.2) return [];

    const signal = await upsertSignal({
        signature: `EMPLOYER_CHURN_SPIKE:global:${new Date(day).toISOString().slice(0, 10)}`,
        type: 'EMPLOYER_CHURN_SPIKE',
        city: 'global',
        severity: classifySeverity(drop, 0.2, 0.35, 0.5),
        value: recent,
        baseline: prior,
        threshold: 0.2,
        message: `Active employer base dropped ${(drop * 100).toFixed(1)}% in the last 14 days.`,
        detectedAt: day,
    });

    return signal ? [signal] : [];
};

const detectApiUsageAnomalies = async ({ day }) => {
    const recentFrom = new Date(day.getTime() - (24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (48 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recent, prior] = await Promise.all([
        AnalyticsEvent.countDocuments({
            eventName: 'PLATFORM_API_USAGE',
            createdAt: { $gte: recentFrom, $lte: day },
        }),
        AnalyticsEvent.countDocuments({
            eventName: 'PLATFORM_API_USAGE',
            createdAt: { $gte: priorFrom, $lte: priorTo },
        }),
    ]);

    if (!prior) return [];

    const ratio = safeDiv(recent - prior, prior);
    if (Math.abs(ratio) <= 0.4) return [];

    const signal = await upsertSignal({
        signature: `API_USAGE_ANOMALY:global:${new Date(day).toISOString().slice(0, 10)}`,
        type: 'API_USAGE_ANOMALY',
        city: 'global',
        severity: classifySeverity(Math.abs(ratio), 0.4, 0.7, 1.0),
        value: recent,
        baseline: prior,
        threshold: 0.4,
        message: ratio > 0
            ? `Platform API usage spiked ${(ratio * 100).toFixed(1)}% over prior day.`
            : `Platform API usage dropped ${(Math.abs(ratio) * 100).toFixed(1)}% over prior day.`,
        detectedAt: day,
        metadata: {
            trend: ratio > 0 ? 'spike' : 'drop',
        },
    });

    return signal ? [signal] : [];
};

const detectWorkerEngagementDrop = async ({ day }) => {
    const recentFrom = new Date(day.getTime() - (24 * 60 * 60 * 1000));
    const priorFrom = new Date(day.getTime() - (48 * 60 * 60 * 1000));
    const priorTo = new Date(recentFrom.getTime() - 1);

    const [recentRows, priorRows] = await Promise.all([
        WorkerEngagementScore.aggregate([
            { $match: { computedAt: { $gte: recentFrom, $lte: day } } },
            { $group: { _id: null, avgScore: { $avg: '$score' } } },
        ]),
        WorkerEngagementScore.aggregate([
            { $match: { computedAt: { $gte: priorFrom, $lte: priorTo } } },
            { $group: { _id: null, avgScore: { $avg: '$score' } } },
        ]),
    ]);

    const recent = Number(recentRows[0]?.avgScore || 0);
    const prior = Number(priorRows[0]?.avgScore || 0);
    if (!prior) return [];

    const drop = (prior - recent) / prior;
    if (drop <= 0.15) return [];

    const signal = await upsertSignal({
        signature: `WORKER_ENGAGEMENT_DROP:global:${new Date(day).toISOString().slice(0, 10)}`,
        type: 'WORKER_ENGAGEMENT_DROP',
        city: 'global',
        severity: classifySeverity(drop, 0.15, 0.25, 0.4),
        value: Number(recent.toFixed(4)),
        baseline: Number(prior.toFixed(4)),
        threshold: 0.15,
        message: `Worker engagement average dropped ${(drop * 100).toFixed(1)}% over prior period.`,
        detectedAt: day,
    });

    return signal ? [signal] : [];
};

const detectCompetitiveThreatSignals = async ({ day = new Date() } = {}) => {
    const [fillRateDrop, employerChurn, apiAnomaly, engagementDrop] = await Promise.all([
        detectCityFillRateDrop({ day }),
        detectEmployerChurnSpike({ day }),
        detectApiUsageAnomalies({ day }),
        detectWorkerEngagementDrop({ day }),
    ]);

    return [...fillRateDrop, ...employerChurn, ...apiAnomaly, ...engagementDrop].filter(Boolean);
};

const getCompetitiveThreatSignals = async ({ city = null, limit = 100, status = null } = {}) => {
    const query = {
        ...(city ? { city: new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } : {}),
        ...(status ? { status } : {}),
    };

    return CompetitiveThreatSignal.find(query)
        .sort({ detectedAt: -1, severity: -1 })
        .limit(Number(limit) || 100)
        .lean();
};

module.exports = {
    detectCompetitiveThreatSignals,
    getCompetitiveThreatSignals,
};
