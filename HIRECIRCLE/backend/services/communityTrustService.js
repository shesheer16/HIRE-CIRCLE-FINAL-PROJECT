const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const Report = require('../models/Report');
const ReputationProfile = require('../models/ReputationProfile');
const CommunityTrustScore = require('../models/CommunityTrustScore');

const clamp = (value, min = 0, max = 100) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const safeDiv = (numerator, denominator) => {
    const den = Number(denominator || 0);
    if (den <= 0) return 0;
    return Number(numerator || 0) / den;
};

const computeCommunityTrustScore = async ({ circleId, upsert = true }) => {
    if (!circleId) return null;

    const circle = await Circle.findById(circleId).lean();
    if (!circle) return null;

    const memberIds = Array.isArray(circle.memberIds) && circle.memberIds.length
        ? circle.memberIds
        : Array.isArray(circle.members)
            ? circle.members
            : [];

    const since30d = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const [reputationRows, postCount30d, reportsRows] = await Promise.all([
        ReputationProfile.find({ userId: { $in: memberIds } })
            .select('overallTrustScore')
            .lean(),
        CirclePost.countDocuments({
            circle: circle._id,
            createdAt: { $gte: since30d },
        }),
        Report.aggregate([
            {
                $match: {
                    targetType: { $in: ['circle', 'circle_post'] },
                    createdAt: { $gte: since30d },
                    status: { $in: ['approved', 'removed'] },
                },
            },
            {
                $group: {
                    _id: '$targetType',
                    count: { $sum: 1 },
                },
            },
        ]),
    ]);

    const memberTrustAverage = reputationRows.length
        ? clamp(
            reputationRows.reduce((sum, row) => sum + Number(row.overallTrustScore || 50), 0) / reputationRows.length,
            0,
            100
        )
        : 50;

    const moderationQueue = Array.isArray(circle.moderationQueue) ? circle.moderationQueue : [];
    const moderationPending = moderationQueue.filter((item) => String(item?.status || '') === 'pending').length;
    const moderationResolved = moderationQueue.filter((item) => ['resolved', 'dismissed'].includes(String(item?.status || ''))).length;
    const moderationTotal = moderationQueue.length;
    const moderationEffectiveness = clamp(
        moderationTotal > 0
            ? safeDiv(moderationResolved, moderationTotal) * 100
            : 75,
        0,
        100
    );

    const harmfulReports = reportsRows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const activityDenominator = Math.max(1, Number(postCount30d) + Number(memberIds.length || 0));
    const disputeRatio = clamp(safeDiv(harmfulReports, activityDenominator) * 100, 0, 100);

    const activityQuality = clamp(
        (Math.min(1, safeDiv(postCount30d, 40)) * 70)
        + (Math.min(1, safeDiv(memberIds.length, 150)) * 30),
        0,
        100
    );

    const communityTrustScore = clamp(
        (memberTrustAverage * 0.45)
        + ((100 - disputeRatio) * 0.2)
        + (activityQuality * 0.2)
        + (moderationEffectiveness * 0.15),
        0,
        100
    );

    const payload = {
        circleId: circle._id,
        communityTrustScore: Number(communityTrustScore.toFixed(2)),
        memberTrustAverage: Number(memberTrustAverage.toFixed(2)),
        disputeRatio: Number(disputeRatio.toFixed(2)),
        activityQuality: Number(activityQuality.toFixed(2)),
        moderationEffectiveness: Number(moderationEffectiveness.toFixed(2)),
        computedAt: new Date(),
        metadata: {
            memberCount: memberIds.length,
            postCount30d,
            harmfulReports,
            moderationPending,
            moderationResolved,
            moderationTotal,
        },
    };

    if (!upsert) return payload;

    return CommunityTrustScore.findOneAndUpdate(
        { circleId: circle._id },
        { $set: payload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const computeCommunityTrustScoresBatch = async ({ limit = 500 } = {}) => {
    const circles = await Circle.find({})
        .sort({ createdAt: -1 })
        .limit(Math.max(1, Math.min(2000, Number(limit) || 500)))
        .select('_id')
        .lean();

    const scores = [];
    for (const circle of circles) {
        const score = await computeCommunityTrustScore({ circleId: circle._id, upsert: true });
        if (score) scores.push(score);
    }
    return scores;
};

module.exports = {
    computeCommunityTrustScore,
    computeCommunityTrustScoresBatch,
};
