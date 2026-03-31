const MatchLog = require('../models/MatchLog');
const MatchOutcomeModel = require('../models/MatchOutcomeModel');
const InterviewQualityScore = require('../models/InterviewQualityScore');
const UserBehaviorProfile = require('../models/UserBehaviorProfile');
const UserChurnRiskModel = require('../models/UserChurnRiskModel');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);

const getMatchSuccessTrend = async ({ from, to }) => {
    const rows = await MatchOutcomeModel.aggregate([
        {
            $match: {
                createdAt: { $gte: from, $lte: to },
            },
        },
        {
            $group: {
                _id: {
                    day: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    },
                },
                total: { $sum: 1 },
                hired: {
                    $sum: {
                        $cond: [{ $eq: ['$hired', true] }, 1, 0],
                    },
                },
            },
        },
        {
            $sort: {
                '_id.day': 1,
            },
        },
    ]);

    return rows.map((row) => ({
        day: row._id.day,
        totalOutcomes: Number(row.total || 0),
        hires: Number(row.hired || 0),
        successRate: Number(clamp01(safeDiv(row.hired, Math.max(row.total, 1))).toFixed(4)),
    }));
};

const getInterviewQualityTrend = async ({ from, to }) => {
    const rows = await InterviewQualityScore.aggregate([
        {
            $match: {
                createdAt: { $gte: from, $lte: to },
            },
        },
        {
            $group: {
                _id: {
                    day: {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    },
                },
                avgQuality: { $avg: '$overallQualityScore' },
                samples: { $sum: 1 },
            },
        },
        {
            $sort: {
                '_id.day': 1,
            },
        },
    ]);

    return rows.map((row) => ({
        day: row._id.day,
        avgQuality: Number(clamp01(row.avgQuality || 0).toFixed(4)),
        samples: Number(row.samples || 0),
    }));
};

const getEngagementHeatmap = async ({ from }) => {
    const rows = await UserBehaviorProfile.find({
        computedAt: { $gte: from },
    })
        .select('engagementScore reliabilityScore completionRate')
        .lean();

    const buckets = {
        high: { users: 0, avgReliability: 0 },
        medium: { users: 0, avgReliability: 0 },
        low: { users: 0, avgReliability: 0 },
    };

    rows.forEach((row) => {
        const engagement = clamp01(row.engagementScore || 0);
        const reliability = clamp01(row.reliabilityScore || 0);
        const bucket = engagement >= 0.66 ? 'high' : engagement >= 0.4 ? 'medium' : 'low';
        buckets[bucket].users += 1;
        buckets[bucket].avgReliability += reliability;
    });

    Object.values(buckets).forEach((bucket) => {
        bucket.avgReliability = Number(clamp01(safeDiv(bucket.avgReliability, Math.max(bucket.users, 1))).toFixed(4));
    });

    return buckets;
};

const getHiringProbabilityDistribution = async ({ from, to }) => {
    const rows = await MatchLog.find({
        createdAt: { $gte: from, $lte: to },
    })
        .select('finalScore')
        .lean();

    const distribution = {
        '0.00-0.24': 0,
        '0.25-0.49': 0,
        '0.50-0.74': 0,
        '0.75-1.00': 0,
    };

    rows.forEach((row) => {
        const value = clamp01(row.finalScore || 0);
        if (value < 0.25) distribution['0.00-0.24'] += 1;
        else if (value < 0.5) distribution['0.25-0.49'] += 1;
        else if (value < 0.75) distribution['0.50-0.74'] += 1;
        else distribution['0.75-1.00'] += 1;
    });

    return distribution;
};

const getChurnRiskDistribution = async () => {
    const rows = await UserChurnRiskModel.aggregate([
        {
            $group: {
                _id: '$churnRiskLevel',
                count: { $sum: 1 },
            },
        },
    ]);

    const baseline = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
    };

    rows.forEach((row) => {
        if (!row._id) return;
        baseline[row._id] = Number(row.count || 0);
    });

    return baseline;
};

const getIntelligenceDashboard = async ({ days = 30 } = {}) => {
    const boundedDays = clamp(days, 7, 180);
    const to = new Date();
    const from = new Date(to.getTime() - (boundedDays * 24 * 60 * 60 * 1000));

    const [
        matchSuccessTrend,
        interviewQualityTrend,
        engagementHeatmap,
        hiringProbabilityDistribution,
        churnRiskDistribution,
    ] = await Promise.all([
        getMatchSuccessTrend({ from, to }),
        getInterviewQualityTrend({ from, to }),
        getEngagementHeatmap({ from }),
        getHiringProbabilityDistribution({ from, to }),
        getChurnRiskDistribution(),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        timeWindowDays: boundedDays,
        matchSuccessTrend,
        interviewQualityTrend,
        engagementHeatmap,
        hiringProbabilityDistribution,
        churnRiskDistribution,
    };
};

module.exports = {
    getIntelligenceDashboard,
};
