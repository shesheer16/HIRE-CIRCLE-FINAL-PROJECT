const crypto = require('crypto');

const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const Referral = require('../models/Referral');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const { buildReferralInviteLink } = require('./growthLinkService');
const {
    validateReferralRelationship,
    computeReferralDepth,
    attachReferralDepthAndGraph,
} = require('./referralGraphService');
const { recordTrustEdge } = require('./trustGraphService');

const DEFAULT_REWARD_TYPE = 'credit_unlock';

const rewardCreditsByType = {
    credit_unlock: 1,
    referral_bonus: 2,
    premium_unlock: 3,
};

const normalizeRewardType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_REWARD_TYPE;
    return Object.prototype.hasOwnProperty.call(rewardCreditsByType, normalized)
        ? normalized
        : DEFAULT_REWARD_TYPE;
};

const generateReferralCode = () => `${crypto.randomBytes(3).toString('hex').toUpperCase()}${Date.now().toString().slice(-4)}`;

const ensureUserReferralCode = async (userId) => {
    const user = await User.findById(userId).select('referralCode');
    if (!user) return null;

    if (user.referralCode) {
        return user.referralCode;
    }

    let code = null;
    for (let i = 0; i < 5; i += 1) {
        const candidate = generateReferralCode();
        const exists = await User.exists({ referralCode: candidate });
        if (!exists) {
            code = candidate;
            break;
        }
    }

    if (!code) {
        code = generateReferralCode();
    }

    await User.updateOne({ _id: userId }, { $set: { referralCode: code } });
    return code;
};

const ensureReferralForSignup = async ({ referrerId, referredUserId, rewardType = DEFAULT_REWARD_TYPE }) => {
    if (!referrerId || !referredUserId) return null;

    const relationValidation = await validateReferralRelationship({ referrerId, referredUserId });
    if (!relationValidation.valid) {
        await AnalyticsEvent.create({
            user: referredUserId,
            eventName: 'REFERRAL_BLOCKED',
            metadata: {
                referrerId: String(referrerId),
                referredUserId: String(referredUserId),
                reason: relationValidation.reason,
            },
        });
        return null;
    }

    const normalizedRewardType = normalizeRewardType(rewardType);
    const depth = await computeReferralDepth({ referrerId });
    const result = await Referral.findOneAndUpdate(
        { referrerId, referredUserId },
        {
            $setOnInsert: {
                referrerId,
                referredUserId,
                rewardType: normalizedRewardType,
                depth,
                status: 'pending',
                createdAt: new Date(),
            },
            $set: {
                referrer: referrerId,
                rewardType: normalizedRewardType,
                depth,
                chainSignature: `${String(referrerId)}>${String(referredUserId)}`,
            },
        },
        { upsert: true, new: true }
    );

    await attachReferralDepthAndGraph({ referral: result.toObject() });

    await AnalyticsEvent.create({
        user: referredUserId,
        eventName: 'REFERRAL_SIGNUP_TRACKED',
        metadata: {
            referrerId: String(referrerId),
            referralId: String(result?._id || ''),
            rewardType: normalizedRewardType,
            depth,
        },
    });

    return result;
};

const isInterviewComplete = async (userId) => {
    const [user, workerProfile] = await Promise.all([
        User.findById(userId).select('hasCompletedProfile').lean(),
        WorkerProfile.findOne({ user: userId }).select('interviewVerified').lean(),
    ]);

    return Boolean(user?.hasCompletedProfile || workerProfile?.interviewVerified);
};

const hasFirstApplication = async (userId) => {
    const workerProfile = await WorkerProfile.findOne({ user: userId }).select('_id').lean();
    if (!workerProfile?._id) return false;

    const exists = await Application.exists({ worker: workerProfile._id });
    return Boolean(exists);
};

const evaluateReferralEligibility = async ({ referredUserId }) => {
    if (!referredUserId) {
        return {
            eligible: false,
            reason: 'missing_referred_user',
        };
    }

    const referral = await Referral.findOne({
        referredUserId,
        status: { $in: ['pending', 'in_progress'] },
    });

    if (!referral) {
        return {
            eligible: false,
            reason: 'no_pending_referral',
        };
    }

    const [interviewComplete, applied] = await Promise.all([
        isInterviewComplete(referredUserId),
        hasFirstApplication(referredUserId),
    ]);

    if (!interviewComplete || !applied) {
        const nextStatus = interviewComplete || applied ? 'in_progress' : 'pending';
        await Referral.updateOne(
            { _id: referral._id },
            { $set: { status: nextStatus } }
        );

        return {
            eligible: false,
            reason: interviewComplete ? 'awaiting_first_application' : 'awaiting_interview_completion',
            status: nextStatus,
        };
    }

    const rewardType = normalizeRewardType(referral.rewardType);
    const creditReward = rewardCreditsByType[rewardType] || 1;

    const [updatedReferral, referrer] = await Promise.all([
        Referral.findOneAndUpdate(
            { _id: referral._id, status: { $in: ['pending', 'in_progress'] } },
            {
                $set: {
                    status: 'completed',
                    completedAt: new Date(),
                    referredUserId,
                    referrerId: referral.referrerId || referral.referrer,
                    rewardType,
                },
            },
            { new: true }
        ),
        User.findById(referral.referrerId || referral.referrer),
    ]);

    if (!updatedReferral || !referrer) {
        return {
            eligible: false,
            reason: 'reward_already_processed',
        };
    }

    const currentCredits = Number(referrer?.subscription?.credits || 0);
    referrer.subscription = {
        ...(referrer.subscription || {}),
        credits: currentCredits + creditReward,
    };
    await referrer.save({ validateBeforeSave: false });

    await AnalyticsEvent.create({
        user: referrer._id,
        eventName: 'REFERRAL_REWARD_GRANTED',
        metadata: {
            referredUserId: String(referredUserId),
            referralId: String(updatedReferral._id),
            rewardType,
            creditReward,
        },
    });

    await recordTrustEdge({
        fromUserId: referrer._id,
        toUserId: referredUserId,
        edgeType: 'referred',
        weight: 70,
        qualityScore: 15,
        negative: false,
        referenceType: 'referral',
        referenceId: String(updatedReferral._id),
        metadata: {
            rewardType,
            creditReward,
        },
    }).catch(() => null);

    try {
        const { recalculateReputationProfile } = require('./reputationEngineService');
        const { scanNetworkRisks } = require('./networkRiskService');
        await Promise.all([
            recalculateReputationProfile({ userId: referrer._id, reason: 'referral_completed' }),
            recalculateReputationProfile({ userId: referredUserId, reason: 'referred_signup' }),
        ]);
        await scanNetworkRisks({ sinceDays: 120 });
    } catch (_error) {
        // Non-blocking trust side effects.
    }

    try {
        const { recomputeUserNetworkScore } = require('./networkScoreService');
        await recomputeUserNetworkScore({ userId: referrer._id });
    } catch (_error) {
        // Non-blocking side effect.
    }

    return {
        eligible: true,
        status: 'completed',
        rewardType,
        creditReward,
        referralId: String(updatedReferral._id),
    };
};

const getReferralDashboard = async ({ userId }) => {
    const user = await User.findById(userId)
        .select('referralCode subscription.credits')
        .lean();
    if (!user) return null;

    const referralCode = user.referralCode || await ensureUserReferralCode(userId);
    const inviteLink = buildReferralInviteLink(referralCode);

    const referrals = await Referral.find({
        $or: [
            { referrerId: userId },
            { referrer: userId },
        ],
    })
        .sort({ createdAt: -1 })
        .lean();

    const completedReferrals = referrals.filter((row) => row.status === 'completed');

    return {
        referralCode,
        inviteLink,
        totalReferrals: referrals.length,
        pendingReferrals: referrals.filter((row) => row.status === 'pending' || row.status === 'in_progress').length,
        completedReferrals: completedReferrals.length,
        creditsEarned: Number(user?.subscription?.credits || 0),
        rewardsGranted: completedReferrals.reduce((sum, row) => {
            const rewardType = normalizeRewardType(row.rewardType);
            return sum + (rewardCreditsByType[rewardType] || 1);
        }, 0),
        referrals,
    };
};

module.exports = {
    DEFAULT_REWARD_TYPE,
    rewardCreditsByType,
    normalizeRewardType,
    ensureUserReferralCode,
    ensureReferralForSignup,
    evaluateReferralEligibility,
    getReferralDashboard,
};
