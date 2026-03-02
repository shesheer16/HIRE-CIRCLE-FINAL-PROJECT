const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Report = require('../models/Report');
const Dispute = require('../models/Dispute');
const FraudFlag = require('../models/FraudFlag');
const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const Endorsement = require('../models/Endorsement');
const HireRecord = require('../models/HireRecord');
const Referral = require('../models/Referral');
const ReputationProfile = require('../models/ReputationProfile');
const UserBadge = require('../models/UserBadge');
const NetworkRiskFlag = require('../models/NetworkRiskFlag');
const Notification = require('../models/Notification');
const { getUserEndorsementStats } = require('./endorsementService');
const { calculateNetworkAuthorityScore } = require('./trustGraphService');
const { syncUserBadges } = require('./reputationBadgeService');

const TRUST_RESTRICTED_THRESHOLD = Number.parseInt(process.env.TRUST_RESTRICTED_THRESHOLD || '35', 10);
const TRUST_FLAGGED_THRESHOLD = Number.parseInt(process.env.TRUST_FLAGGED_THRESHOLD || '55', 10);
const TRUST_DECAY_START_DAYS = Number.parseInt(process.env.TRUST_DECAY_START_DAYS || '30', 10);

const WEIGHTS = Object.freeze({
    reliability: 0.24,
    response: 0.14,
    hireSuccess: 0.2,
    engagement: 0.14,
    networkAuthority: 0.16,
    disputeControl: 0.07,
    reportControl: 0.05,
});

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

const asId = (value) => String(value || '').trim();

const classifyTrustStatus = (score) => {
    if (score < TRUST_RESTRICTED_THRESHOLD) return 'restricted';
    if (score < TRUST_FLAGGED_THRESHOLD) return 'flagged';
    if (score < 75) return 'watch';
    return 'healthy';
};

const toPct = (value) => Number(clamp(value, 0, 100).toFixed(2));

const computeResponseScore = ({ avgResponseHours, responseEvents }) => {
    if (responseEvents <= 0) return 50;
    const speedScore = clamp(100 - (Number(avgResponseHours || 0) * 4), 0, 100);
    const consistencyBoost = clamp(Math.log10(Math.max(1, Number(responseEvents || 0))) * 10, 0, 12);
    return toPct(speedScore + consistencyBoost);
};

const computeDecayPenalty = ({ lastActivityAt, recentHireCount }) => {
    const activityDate = lastActivityAt ? new Date(lastActivityAt) : null;
    if (!activityDate || Number.isNaN(activityDate.getTime())) return 12;

    const daysSinceActivity = safeDiv(Date.now() - activityDate.getTime(), 24 * 60 * 60 * 1000);
    if (daysSinceActivity <= TRUST_DECAY_START_DAYS) return 0;

    const raw = (daysSinceActivity - TRUST_DECAY_START_DAYS) * 0.08;
    const hireProtection = Math.min(4, Number(recentHireCount || 0) * 0.4);
    return toPct(clamp(raw - hireProtection, 0, 16));
};

const computeDisputeImpact = ({
    disputesRaised,
    disputesLost,
    fraudOpenCount,
    fraudSeverityScore,
    refundAbuseCount,
    openRiskFlags,
}) => {
    const penalty = clamp(
        (Number(disputesRaised || 0) * 1.3)
        + (Number(disputesLost || 0) * 2.1)
        + (Number(fraudOpenCount || 0) * 2.8)
        + (Number(fraudSeverityScore || 0) * 0.07)
        + (Number(refundAbuseCount || 0) * 3.4)
        + (Number(openRiskFlags || 0) * 1.6),
        0,
        35
    );

    const visibilityMultiplier = Number(clamp(1 - (penalty / 55), 0.4, 1).toFixed(3));
    const adminReviewRequired = penalty >= 10 || Number(fraudOpenCount || 0) >= 2 || Number(openRiskFlags || 0) >= 2;

    return {
        penalty: toPct(penalty),
        visibilityMultiplier,
        adminReviewRequired,
    };
};

const buildBreakdown = ({
    reliabilityScore,
    responseScore,
    hireSuccessScore,
    engagementQuality,
    networkAuthorityScore,
    disputeRate,
    reportRate,
}) => {
    return [
        {
            key: 'reliability',
            label: 'Reliability',
            value: toPct(reliabilityScore),
            weight: WEIGHTS.reliability,
            contribution: Number((reliabilityScore * WEIGHTS.reliability).toFixed(3)),
        },
        {
            key: 'response',
            label: 'Response Behavior',
            value: toPct(responseScore),
            weight: WEIGHTS.response,
            contribution: Number((responseScore * WEIGHTS.response).toFixed(3)),
        },
        {
            key: 'hire_success',
            label: 'Hire Success',
            value: toPct(hireSuccessScore),
            weight: WEIGHTS.hireSuccess,
            contribution: Number((hireSuccessScore * WEIGHTS.hireSuccess).toFixed(3)),
        },
        {
            key: 'engagement',
            label: 'Engagement Quality',
            value: toPct(engagementQuality),
            weight: WEIGHTS.engagement,
            contribution: Number((engagementQuality * WEIGHTS.engagement).toFixed(3)),
        },
        {
            key: 'network_authority',
            label: 'Network Authority',
            value: toPct(networkAuthorityScore),
            weight: WEIGHTS.networkAuthority,
            contribution: Number((networkAuthorityScore * WEIGHTS.networkAuthority).toFixed(3)),
        },
        {
            key: 'dispute_control',
            label: 'Dispute Control',
            value: toPct(100 - disputeRate),
            weight: WEIGHTS.disputeControl,
            contribution: Number(((100 - disputeRate) * WEIGHTS.disputeControl).toFixed(3)),
        },
        {
            key: 'report_control',
            label: 'Report Control',
            value: toPct(100 - reportRate),
            weight: WEIGHTS.reportControl,
            contribution: Number(((100 - reportRate) * WEIGHTS.reportControl).toFixed(3)),
        },
    ];
};

const resolveLastActivityAt = (signals = []) => {
    const epochs = signals
        .map((value) => (value ? new Date(value).getTime() : NaN))
        .filter((value) => Number.isFinite(value));
    if (!epochs.length) return null;
    return new Date(Math.max(...epochs));
};

const buildTrustScoreExplanation = (profile = {}) => {
    const trustScore = Number(profile.overallTrustScore || 0);
    const breakdown = Array.isArray(profile.breakdown) ? profile.breakdown : [];
    const topFactors = [...breakdown]
        .sort((left, right) => Number(right.contribution || 0) - Number(left.contribution || 0))
        .slice(0, 3)
        .map((item) => `${item.label}: ${Number(item.value || 0).toFixed(1)}`);

    const penaltySummary = [];
    if (Number(profile.decayPenalty || 0) > 0) penaltySummary.push(`decay -${Number(profile.decayPenalty).toFixed(1)}`);
    if (Number(profile.disputeImpactPenalty || 0) > 0) penaltySummary.push(`dispute impact -${Number(profile.disputeImpactPenalty).toFixed(1)}`);

    return {
        title: `Why your trust score is ${Math.round(trustScore)}`,
        trustScore: toPct(trustScore),
        topFactors,
        penalties: penaltySummary,
        formula: 'weighted_sum(components) - decay_penalty - dispute_impact_penalty',
        components: breakdown,
    };
};

const getUserRegion = ({ user, workerProfile }) => {
    const workerCity = String(workerProfile?.city || '').trim();
    const userCity = String(user?.city || '').trim();
    const region = workerCity || userCity || 'global';
    return region.toLowerCase();
};

const recomputeAuthorityRank = async ({ userId, region, overallTrustScore, networkAuthorityScore }) => {
    const higherCount = await ReputationProfile.countDocuments({
        'authorityRank.region': region,
        $or: [
            { overallTrustScore: { $gt: overallTrustScore } },
            {
                overallTrustScore,
                networkAuthorityScore: { $gt: networkAuthorityScore },
            },
        ],
    });
    const totalInRegion = await ReputationProfile.countDocuments({
        'authorityRank.region': region,
    });

    const rank = higherCount + 1;
    const percentile = totalInRegion > 0
        ? clamp(((totalInRegion - rank + 1) / totalInRegion) * 100, 0, 100)
        : 100;

    return {
        region,
        rank,
        percentile: Number(percentile.toFixed(2)),
        totalInRegion,
    };
};

const recalculateReputationProfile = async ({ userId, reason = 'manual' }) => {
    if (!userId) return null;
    const user = await User.findById(userId).lean();
    if (!user || user.isDeleted) return null;

    const [workerProfile, endorsementStats, authority, openRiskFlags] = await Promise.all([
        WorkerProfile.findOne({ user: userId }).select('_id city').lean(),
        getUserEndorsementStats({ userId }),
        calculateNetworkAuthorityScore({ userId }),
        NetworkRiskFlag.countDocuments({
            users: userId,
            status: { $in: ['open', 'reviewing'] },
        }),
    ]);

    const workerProfileId = workerProfile?._id || null;

    const [
        employerApplications,
        workerApplications,
        reportsAgainst,
        disputesRaisedRows,
        fraudFlags,
        hireRecords,
        messagesCount30d,
        circleMembershipCount,
        circleAdminCount,
        circlePosts30d,
        completedReferrals,
    ] = await Promise.all([
        Application.find({
            employer: userId,
            status: {
                $in: [
                    'shortlisted',
                    'interview_requested',
                    'interview_completed',
                    'offer_sent',
                    'offer_accepted',
                    'hired',
                    // Legacy compatibility.
                    'accepted',
                ],
            },
        })
            .select('createdAt updatedAt')
            .lean(),
        workerProfileId
            ? Application.find({
                worker: workerProfileId,
                status: {
                    $in: [
                        'shortlisted',
                        'interview_requested',
                        'interview_completed',
                        'offer_sent',
                        'offer_accepted',
                        'hired',
                        // Legacy compatibility.
                        'accepted',
                    ],
                },
            })
                .select('createdAt updatedAt')
                .lean()
            : [],
        Report.countDocuments({
            targetType: 'user',
            targetId: asId(userId),
            status: { $in: ['pending', 'approved', 'removed'] },
        }),
        Dispute.find({
            raisedBy: userId,
            status: { $in: ['open', 'under_review', 'resolved', 'rejected'] },
        })
            .select('status adminDecision createdAt')
            .lean(),
        FraudFlag.find({
            userId,
            status: { $in: ['open', 'reviewing'] },
        })
            .select('score flagType')
            .lean(),
        HireRecord.find({
            $or: [{ employerId: userId }, { workerId: userId }],
        })
            .select('success ratingFromEmployer ratingFromWorker completionTimestamp')
            .lean(),
        Message.countDocuments({
            sender: userId,
            createdAt: { $gte: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)) },
        }),
        Circle.countDocuments({
            $or: [
                { memberIds: userId },
                { members: userId },
            ],
        }),
        Circle.countDocuments({
            adminIds: userId,
        }),
        CirclePost.countDocuments({
            user: userId,
            createdAt: { $gte: new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)) },
        }),
        Referral.countDocuments({
            $or: [{ referrerId: userId }, { referrer: userId }],
            status: 'completed',
        }),
    ]);

    const responseRows = [...employerApplications, ...workerApplications];
    const responseEvents = responseRows.length;
    const avgResponseHours = responseEvents > 0
        ? responseRows.reduce((sum, row) => {
            const diffMs = Math.max(0, new Date(row.updatedAt || 0).getTime() - new Date(row.createdAt || 0).getTime());
            return sum + (diffMs / (1000 * 60 * 60));
        }, 0) / responseEvents
        : 18;
    const responseScore = computeResponseScore({ avgResponseHours, responseEvents });

    const totalHires = hireRecords.length;
    const successfulHires = hireRecords.filter((row) => row.success).length;
    const completionRate = toPct(totalHires > 0 ? safeDiv(successfulHires, totalHires) * 100 : 0);
    const ratings = hireRecords
        .flatMap((row) => [row.ratingFromEmployer, row.ratingFromWorker])
        .filter((value) => Number.isFinite(Number(value)));
    const avgRating = ratings.length ? safeDiv(ratings.reduce((sum, value) => sum + Number(value), 0), ratings.length) : 4;
    const hireSuccessScore = toPct((completionRate * 0.75) + (((avgRating / 5) * 100) * 0.25));

    const disputesRaised = disputesRaisedRows.length;
    const disputesLost = disputesRaisedRows.filter((row) => row.status === 'rejected').length;
    const interactionVolume = Math.max(10, totalHires + responseEvents + messagesCount30d);
    const disputeRate = toPct(safeDiv(disputesRaised, interactionVolume) * 100);
    const reportRate = toPct(safeDiv(reportsAgainst, interactionVolume) * 100);

    const fraudOpenCount = fraudFlags.length;
    const fraudSeverityScore = fraudFlags.reduce((sum, row) => sum + Number(row.score || 0), 0);
    const refundAbuseCount = fraudFlags.filter((row) => ['rapid_refund', 'escrow_abuse'].includes(String(row.flagType || ''))).length;
    const disputeImpact = computeDisputeImpact({
        disputesRaised,
        disputesLost,
        fraudOpenCount,
        fraudSeverityScore,
        refundAbuseCount,
        openRiskFlags,
    });

    const engagementVolumeScore = clamp(
        (Math.min(1, safeDiv(messagesCount30d, 80)) * 35)
        + (Math.min(1, safeDiv(circlePosts30d, 20)) * 25)
        + (Math.min(1, safeDiv(endorsementStats.count, 20)) * 20)
        + (Math.min(1, safeDiv(completedReferrals, 10)) * 20),
        0,
        100
    );
    const engagementQuality = toPct((engagementVolumeScore * 0.6) + (hireSuccessScore * 0.25) + (responseScore * 0.15));

    const reliabilityScore = toPct(
        (completionRate * 0.55)
        + (responseScore * 0.2)
        + ((100 - disputeRate) * 0.15)
        + ((100 - reportRate) * 0.1)
    );

    const lastActivityAt = resolveLastActivityAt([
        ...responseRows.map((row) => row.updatedAt || row.createdAt),
        ...hireRecords.map((row) => row.completionTimestamp),
    ]);
    const recentHireCount = hireRecords.filter((row) => {
        const ts = new Date(row.completionTimestamp || 0).getTime();
        return Number.isFinite(ts) && ts >= (Date.now() - (60 * 24 * 60 * 60 * 1000));
    }).length;
    const decayPenalty = computeDecayPenalty({ lastActivityAt, recentHireCount });

    const breakdown = buildBreakdown({
        reliabilityScore,
        responseScore,
        hireSuccessScore,
        engagementQuality,
        networkAuthorityScore: authority.score,
        disputeRate,
        reportRate,
    });

    const weightedBaseScore = breakdown.reduce((sum, item) => sum + Number(item.contribution || 0), 0);
    const overallTrustScore = toPct(clamp(weightedBaseScore - decayPenalty - disputeImpact.penalty, 0, 100));

    const region = getUserRegion({ user, workerProfile });
    const authorityRank = await recomputeAuthorityRank({
        userId,
        region,
        overallTrustScore,
        networkAuthorityScore: authority.score,
    });

    const communityInfluence = toPct(
        (Math.min(1, safeDiv(circleMembershipCount, 30)) * 30)
        + (Math.min(1, safeDiv(circleAdminCount, 8)) * 25)
        + (Math.min(1, safeDiv(circlePosts30d, 24)) * 20)
        + (Math.min(1, safeDiv(endorsementStats.count, 25)) * 15)
        + (Math.min(1, safeDiv(authority.score, 100)) * 10)
    );

    const profilePayload = {
        userId,
        reliabilityScore,
        responseScore,
        hireSuccessScore,
        disputeRate,
        reportRate,
        engagementQuality,
        overallTrustScore,
        updatedAt: new Date(),
        networkAuthorityScore: authority.score,
        completionRate,
        verifiedHires: successfulHires,
        endorsementsCount: endorsementStats.count,
        communityInfluence,
        authorityRank: {
            region,
            rank: authorityRank.rank,
            percentile: authorityRank.percentile,
        },
        visibilityMultiplier: disputeImpact.visibilityMultiplier,
        disputeImpactPenalty: disputeImpact.penalty,
        decayPenalty,
        adminReviewRequired: disputeImpact.adminReviewRequired,
        breakdown,
        metadata: {
            reason,
            avgResponseHours: Number(avgResponseHours.toFixed(3)),
            responseEvents,
            totalHires,
            successfulHires,
            avgRating: Number(avgRating.toFixed(3)),
            endorsementStats,
            authority: {
                edgeCount: authority.edgeCount,
                positiveDelta: authority.positiveDelta,
                negativeDelta: authority.negativeDelta,
            },
            fraud: {
                fraudOpenCount,
                fraudSeverityScore,
                refundAbuseCount,
            },
            reportsAgainst,
            disputesRaised,
            disputesLost,
            openRiskFlags,
            interactionVolume,
            activity: {
                messagesCount30d,
                circleMembershipCount,
                circleAdminCount,
                circlePosts30d,
                completedReferrals,
            },
            authorityRankTotalInRegion: authorityRank.totalInRegion,
            recomputedAt: new Date().toISOString(),
        },
    };

    const profile = await ReputationProfile.findOneAndUpdate(
        { userId },
        { $set: profilePayload },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    const trustStatus = classifyTrustStatus(profile.overallTrustScore);
    const isFlagged = ['flagged', 'restricted'].includes(trustStatus);
    await User.findByIdAndUpdate(userId, {
        $set: {
            trustScore: profile.overallTrustScore,
            trustStatus,
            isFlagged,
            trustVisibilityMultiplier: profile.visibilityMultiplier,
            networkAuthorityScore: profile.networkAuthorityScore,
            hireSuccessScore: profile.hireSuccessScore,
            responseScore: profile.responseScore,
            actionLimitsUntil: trustStatus === 'restricted' ? new Date(Date.now() + (60 * 60 * 1000)) : null,
        },
    });

    if (profile.adminReviewRequired) {
        const cooldownBoundary = new Date(Date.now() - (6 * 60 * 60 * 1000));
        const existingAlert = await Notification.findOne({
            type: 'abuse_alert',
            createdAt: { $gte: cooldownBoundary },
            message: new RegExp(String(userId), 'i'),
        }).lean();

        if (!existingAlert) {
            const adminUsers = await User.find({ isAdmin: true }).select('_id').lean();
            if (adminUsers.length) {
                await Notification.insertMany(adminUsers.map((adminUser) => ({
                    user: adminUser._id,
                    type: 'abuse_alert',
                    title: 'Trust review required',
                    message: `User ${String(userId)} reached trust review threshold.`,
                    isRead: false,
                })));
            }
        }
    }

    const badges = await syncUserBadges({
        userId,
        reputationProfile: profile,
    });

    return {
        ...profile,
        badges,
    };
};

const getReputationProfile = async ({ userId, recompute = false }) => {
    if (!userId) return null;
    if (recompute) {
        return recalculateReputationProfile({ userId, reason: 'on_demand' });
    }
    const profile = await ReputationProfile.findOne({ userId }).lean();
    if (profile) return profile;
    return recalculateReputationProfile({ userId, reason: 'bootstrap' });
};

const getProfileAuthoritySnapshot = async ({ userId, recompute = false }) => {
    const profile = await getReputationProfile({ userId, recompute });
    if (!profile) return null;

    const badges = await UserBadge.find({ userId, active: true })
        .select('badgeKey badgeName source awardedAt')
        .sort({ awardedAt: -1 })
        .lean()
        .catch(() => []);

    return {
        trustScore: toPct(profile.overallTrustScore),
        completionRate: toPct(profile.completionRate),
        endorsements: Number(profile.endorsementsCount || 0),
        verifiedHires: Number(profile.verifiedHires || 0),
        authorityRank: {
            region: profile.authorityRank?.region || 'global',
            rank: Number(profile.authorityRank?.rank || 1),
            percentile: Number(profile.authorityRank?.percentile || 100),
        },
        communityInfluence: toPct(profile.communityInfluence),
        networkAuthorityScore: toPct(profile.networkAuthorityScore),
        responseScore: toPct(profile.responseScore),
        hireSuccessScore: toPct(profile.hireSuccessScore),
        visibilityMultiplier: Number(profile.visibilityMultiplier || 1),
        badges,
        explanation: buildTrustScoreExplanation(profile),
        updatedAt: profile.updatedAt || null,
    };
};

const recalculateReputationBatch = async ({ limit = 1000 } = {}) => {
    const users = await User.find({ isDeleted: { $ne: true } })
        .sort({ _id: 1 })
        .limit(Math.max(1, Math.min(10000, Number(limit) || 1000)))
        .select('_id')
        .lean();

    const updated = [];
    for (const user of users) {
        const profile = await recalculateReputationProfile({
            userId: user._id,
            reason: 'batch_recompute',
        });
        if (profile) updated.push(profile);
    }
    return updated;
};

module.exports = {
    WEIGHTS,
    classifyTrustStatus,
    computeDecayPenalty,
    computeDisputeImpact,
    buildTrustScoreExplanation,
    recalculateReputationProfile,
    getReputationProfile,
    getProfileAuthoritySnapshot,
    recalculateReputationBatch,
};
