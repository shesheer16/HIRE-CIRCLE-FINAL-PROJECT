const User = require('../models/userModel');
const Report = require('../models/Report');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const Post = require('../models/Post');
const WorkerProfile = require('../models/WorkerProfile');
const UserTrustScore = require('../models/UserTrustScore');
const Notification = require('../models/Notification');
const { recalculateReputationProfile } = require('./reputationEngineService');
const { emitStructuredAlert } = require('./systemMonitoringService');
const { enforceAbuseAction } = require('./abuseDefenseService');
const { recomputeTrustGraphForUser } = require('./trustGraphService');
const { computeBadgeForUser } = require('./verificationBadgeService');

const ALERT_COOLDOWN_MS = Number.parseInt(process.env.TRUST_ALERT_COOLDOWN_MS || String(6 * 60 * 60 * 1000), 10);
const RESTRICTED_THRESHOLD = Number.parseInt(process.env.TRUST_RESTRICTED_THRESHOLD || '35', 10);
const FLAGGED_THRESHOLD = Number.parseInt(process.env.TRUST_FLAGGED_THRESHOLD || '55', 10);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const classifyTrustStatus = (score) => {
    if (score < RESTRICTED_THRESHOLD) return 'restricted';
    if (score < FLAGGED_THRESHOLD) return 'flagged';
    if (score < 75) return 'watch';
    return 'healthy';
};

const computePenalty = ({
    reportCount,
    rejectedApplications,
    spamBehaviorScore,
    otpAbuseCount,
    rapidJobPostCount,
    messageFloodCount,
    responseScore = 100,
}) => {
    const reportPenalty = Math.min(reportCount * 8, 40);
    const rejectionPenalty = Math.min(rejectedApplications * 1.5, 15);
    const spamPenalty = Math.min(spamBehaviorScore * 3, 18);
    const otpPenalty = Math.min(otpAbuseCount * 6, 24);
    const rapidPostPenalty = rapidJobPostCount > 6 ? 18 : rapidJobPostCount > 3 ? 8 : 0;
    const floodPenalty = messageFloodCount > 30 ? 20 : messageFloodCount > 15 ? 8 : 0;
    const responsePenalty = responseScore < 40
        ? 14
        : responseScore < 60
            ? 8
            : responseScore < 80
                ? 3
                : 0;

    return reportPenalty + rejectionPenalty + spamPenalty + otpPenalty + rapidPostPenalty + floodPenalty + responsePenalty;
};

const resolveWorkerProfileId = async (userId) => {
    const workerProfile = await WorkerProfile.findOne({ user: userId }).select('_id').lean();
    return workerProfile?._id || null;
};

const recalculateUserTrustScore = async ({ userId, reason = 'manual' }) => {
    if (!userId) return null;

    const now = Date.now();
    const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
    const oneHourAgo = new Date(now - (60 * 60 * 1000));
    const twentyFourHoursAgo = new Date(now - (24 * 60 * 60 * 1000));

    const [workerProfileId, user] = await Promise.all([
        resolveWorkerProfileId(userId),
        User.findById(userId).lean(),
    ]);

    if (!user || user.isDeleted) {
        return null;
    }

    const [
        reportCount,
        rejectedApplications,
        recentPosts,
        otpAbuseCount,
        rapidJobPostCount,
        messageFloodCount,
    ] = await Promise.all([
        Report.countDocuments({ targetType: 'user', targetId: String(userId), status: { $in: ['pending', 'approved', 'removed'] } }),
        workerProfileId
            ? Application.countDocuments({ worker: workerProfileId, status: 'rejected' })
            : 0,
        Post.countDocuments({ user: userId, createdAt: { $gte: twentyFourHoursAgo } }),
        Number(user.otpAttemptCount || 0) + Number(user.otpRequestCount || 0) + (user.otpBlockedUntil ? 1 : 0),
        Job.countDocuments({ employerId: userId, createdAt: { $gte: oneHourAgo } }),
        Message.countDocuments({ sender: userId, createdAt: { $gte: tenMinutesAgo } }),
    ]);

    const spamBehaviorScore = recentPosts > 15 ? 5 : recentPosts > 8 ? 3 : recentPosts > 5 ? 2 : 0;
    const responseScore = Number.isFinite(Number(user.responseScore)) ? Number(user.responseScore) : 100;
    const penalty = computePenalty({
        reportCount,
        rejectedApplications,
        spamBehaviorScore,
        otpAbuseCount,
        rapidJobPostCount,
        messageFloodCount,
        responseScore,
    });

    const legacyScore = clamp(100 - penalty, 0, 100);
    const [reputationProfile, badgeProfile, trustGraphProfile] = await Promise.all([
        recalculateReputationProfile({
            userId,
            reason: `trust_engine:${reason}`,
        }).catch(() => null),
        computeBadgeForUser({
            userId,
            reason: `trust_engine:${reason}`,
        }).catch(() => null),
        recomputeTrustGraphForUser({
            userId,
            reason: `trust_engine:${reason}`,
        }).catch(() => null),
    ]);

    const reputationScore = Number(reputationProfile?.overallTrustScore || legacyScore);
    const trustGraphScore = Number(trustGraphProfile?.trustGraphScore || 0);
    const score = clamp(
        (legacyScore * 0.25)
        + (reputationScore * 0.50)
        + (trustGraphScore * 0.25),
        0,
        100
    );
    const status = classifyTrustStatus(score);
    const isFlagged = status === 'flagged' || status === 'restricted';

    const reasons = [];
    if (reportCount > 0) reasons.push(`report_count:${reportCount}`);
    if (rejectedApplications > 10) reasons.push(`high_rejection_rate:${rejectedApplications}`);
    if (spamBehaviorScore > 0) reasons.push(`spam_behavior:${spamBehaviorScore}`);
    if (otpAbuseCount > 3) reasons.push(`otp_abuse:${otpAbuseCount}`);
    if (rapidJobPostCount > 3) reasons.push(`rapid_job_posting:${rapidJobPostCount}`);
    if (messageFloodCount > 15) reasons.push(`message_flood:${messageFloodCount}`);
    if (responseScore < 80) reasons.push(`response_score_low:${responseScore.toFixed(1)}`);
    if (reputationProfile?.decayPenalty > 0) reasons.push(`decay_penalty:${Number(reputationProfile.decayPenalty).toFixed(2)}`);
    if (reputationProfile?.disputeImpactPenalty > 0) reasons.push(`dispute_impact:${Number(reputationProfile.disputeImpactPenalty).toFixed(2)}`);
    if (trustGraphScore > 0) reasons.push(`trust_graph:${trustGraphScore.toFixed(2)}`);
    if (badgeProfile?.tier) reasons.push(`badge_tier:${badgeProfile.tier}`);

    const trustDoc = await UserTrustScore.findOneAndUpdate(
        { userId },
        {
            $set: {
                reportCount,
                rejectedApplications,
                spamBehaviorScore,
                otpAbuseCount,
                rapidJobPostCount,
                messageFloodCount,
                score,
                reliabilityScore: Number(trustGraphProfile?.reliabilityScore || 0),
                hiringSuccessScore: Number(trustGraphProfile?.hiringSuccessScore || 0),
                responseScore: Number(trustGraphProfile?.responseScore || 0),
                completionScore: Number(trustGraphProfile?.completionScore || 0),
                referralScore: Number(trustGraphProfile?.referralScore || 0),
                trustGraphScore: Number(trustGraphProfile?.trustGraphScore || trustGraphScore || 0),
                rankingMultiplier: Number(trustGraphProfile?.rankingMultiplier || badgeProfile?.rankingBoostMultiplier || 1),
                visibilityMultiplier: Number(trustGraphProfile?.visibilityMultiplier || badgeProfile?.visibilityBoostMultiplier || 1),
                badgeTier: trustGraphProfile?.badgeTier || badgeProfile?.tier || 'Basic',
                status,
                isFlagged,
                reasons,
                lastEvaluatedAt: new Date(),
                metadata: {
                    reason,
                    evaluatedAt: new Date().toISOString(),
                    legacyScore,
                    reputationScore,
                    trustGraphScore,
                    responseScore,
                    reputationProfileId: reputationProfile?._id ? String(reputationProfile._id) : null,
                },
            },
        },
        { upsert: true, new: true }
    );

    await User.findByIdAndUpdate(userId, {
        $set: {
            trustScore: score,
            trustStatus: status,
            isFlagged,
            trustVisibilityMultiplier: Number(reputationProfile?.visibilityMultiplier || 1),
            networkAuthorityScore: Number(reputationProfile?.networkAuthorityScore || 50),
            hireSuccessScore: Number(reputationProfile?.hireSuccessScore || 0),
            responseScore: Number(reputationProfile?.responseScore || 50),
            trustGraphScore: Number(trustGraphScore || 0),
            verificationBadgeTier: trustGraphProfile?.badgeTier || badgeProfile?.tier || 'Basic',
            actionLimitsUntil: status === 'restricted' ? new Date(now + (60 * 60 * 1000)) : null,
        },
    });

    if (isFlagged) {
        const cooldownBoundary = new Date(now - ALERT_COOLDOWN_MS);
        const existingAlert = await Notification.findOne({
            user: userId,
            type: 'abuse_alert',
            createdAt: { $gte: cooldownBoundary },
        }).lean();

        if (!existingAlert) {
            const adminUsers = await User.find({ isAdmin: true }).select('_id').lean();
            if (adminUsers.length) {
                await Notification.insertMany(adminUsers.map((adminUser) => ({
                    user: adminUser._id,
                    type: 'abuse_alert',
                    title: 'User flagged by trust engine',
                    message: `User ${String(userId)} crossed trust threshold (${score}).`,
                    relatedData: {
                        flaggedUserId: String(userId),
                        score,
                        reasons,
                    },
                    isRead: false,
                })));
            }
        }

        await emitStructuredAlert({
            alertType: 'abuse_user_flagged',
            metric: 'error_count',
            value: Number(score),
            threshold: FLAGGED_THRESHOLD,
            severity: status === 'restricted' ? 'critical' : 'warning',
            source: 'trust_engine',
            message: `User ${String(userId)} flagged by trust engine`,
            details: {
                userId: String(userId),
                score: Number(score),
                status,
                reasons,
            },
            rateLimitWindowSeconds: Math.floor(ALERT_COOLDOWN_MS / 1000),
        });
    }

    return trustDoc;
};

const shouldBlockFlaggedAction = (trust = {}) => {
    const reportCount = Number(trust.reportCount || 0);
    const otpAbuseCount = Number(trust.otpAbuseCount || 0);
    const rapidJobPostCount = Number(trust.rapidJobPostCount || 0);
    const messageFloodCount = Number(trust.messageFloodCount || 0);
    const spamBehaviorScore = Number(trust.spamBehaviorScore || 0);
    const rejectedApplications = Number(trust.rejectedApplications || 0);

    return (
        reportCount >= 2
        || otpAbuseCount >= 3
        || rapidJobPostCount >= 4
        || messageFloodCount >= 16
        || spamBehaviorScore >= 2
        || rejectedApplications >= 20
    );
};

const enforceTrustForAction = async ({ userId, action }) => {
    const abuse = await enforceAbuseAction({ userId, action });
    if (!abuse.allowed) {
        return {
            allowed: false,
            reason: abuse.reason || 'Action blocked by abuse defense',
            trust: null,
            abuse: abuse.result || null,
        };
    }

    const trust = await recalculateUserTrustScore({ userId, reason: `action:${action}` });
    if (!trust) {
        return { allowed: true, reason: null, trust: null };
    }

    if (trust.status === 'restricted') {
        return {
            allowed: false,
            reason: 'Action temporarily restricted due to abuse risk',
            trust,
        };
    }

    if (trust.status === 'flagged' && ['job_post', 'message_sent'].includes(String(action || ''))) {
        if (!shouldBlockFlaggedAction(trust)) {
            return { allowed: true, reason: null, trust };
        }
        return {
            allowed: false,
            reason: 'Action blocked pending trust review',
            trust,
        };
    }

    return { allowed: true, reason: null, trust };
};

module.exports = {
    recalculateUserTrustScore,
    enforceTrustForAction,
    shouldBlockFlaggedAction,
};
