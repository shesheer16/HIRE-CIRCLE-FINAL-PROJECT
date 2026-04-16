const Referral = require('../models/Referral');
const User = require('../models/userModel');
const { registerReferralGraphRelation, recomputeTrustGraphForUser } = require('./trustGraphService');

const toId = (value) => String(value || '').trim();

const isSelfReferral = ({ referrerId, referredUserId }) => (
    toId(referrerId) && toId(referrerId) === toId(referredUserId)
);

const computeReferralDepth = async ({ referrerId, maxDepth = 12 }) => {
    let depth = 1;
    let currentUser = await User.findById(referrerId).select('referredBy').lean();

    while (currentUser?.referredBy && depth < maxDepth) {
        depth += 1;
        currentUser = await User.findById(currentUser.referredBy).select('referredBy').lean();
    }

    return depth;
};

const isCircularReferral = async ({ referrerId, referredUserId, maxDepth = 12 }) => {
    const referred = toId(referredUserId);
    if (!referred) return false;

    let current = await User.findById(referrerId).select('referredBy').lean();
    let steps = 0;

    while (current?.referredBy && steps < maxDepth) {
        const parentId = toId(current.referredBy);
        if (parentId === referred) {
            return true;
        }

        current = await User.findById(parentId).select('referredBy').lean();
        steps += 1;
    }

    return false;
};

const validateReferralRelationship = async ({ referrerId, referredUserId }) => {
    if (!referrerId || !referredUserId) {
        return {
            valid: false,
            reason: 'missing_participants',
        };
    }

    if (isSelfReferral({ referrerId, referredUserId })) {
        return {
            valid: false,
            reason: 'self_referral_blocked',
        };
    }

    const circular = await isCircularReferral({ referrerId, referredUserId });
    if (circular) {
        return {
            valid: false,
            reason: 'circular_referral_blocked',
        };
    }

    return {
        valid: true,
        reason: null,
    };
};

const attachReferralDepthAndGraph = async ({ referral }) => {
    if (!referral) return null;

    const depth = referral.depth || await computeReferralDepth({ referrerId: referral.referrerId || referral.referrer });
    if (Number(referral.depth || 0) !== Number(depth || 0)) {
        await Referral.updateOne({ _id: referral._id }, { $set: { depth } });
    }

    await registerReferralGraphRelation({
        referrerId: referral.referrerId || referral.referrer,
        referredUserId: referral.referredUserId,
        referralId: referral._id,
        depth,
        occurredAt: referral.completedAt || referral.updatedAt || referral.createdAt || new Date(),
    });

    return {
        ...referral,
        depth,
    };
};

const applyReferralHireBoost = async ({ referredUserId, applicationId = null }) => {
    if (!referredUserId) return null;

    const referral = await Referral.findOne({
        referredUserId,
        status: { $in: ['pending', 'in_progress', 'completed'] },
    })
        .sort({ createdAt: -1 });

    if (!referral) {
        return {
            applied: false,
            reason: 'no_referral_link',
        };
    }

    if (referral.status !== 'completed') {
        referral.status = 'completed';
        referral.completedAt = new Date();
        await referral.save();
    }

    const enriched = await attachReferralDepthAndGraph({ referral: referral.toObject() });

    const referrerId = referral.referrerId || referral.referrer;
    await recomputeTrustGraphForUser({
        userId: referrerId,
        reason: `referral_hire_boost:${toId(applicationId) || 'unknown_application'}`,
    });

    return {
        applied: true,
        referralId: String(referral._id),
        referrerId: String(referrerId),
        depth: Number(enriched?.depth || referral.depth || 1),
    };
};

module.exports = {
    validateReferralRelationship,
    computeReferralDepth,
    attachReferralDepthAndGraph,
    applyReferralHireBoost,
};
