const Application = require('../models/Application');
const Escrow = require('../models/Escrow');
const EmployerProfile = require('../models/EmployerProfile');
const Organization = require('../models/Organization');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const { UserVerificationBadge } = require('../models/UserVerificationBadge');
const mongoose = require('mongoose');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const safeDiv = (num, den) => (Number(den) > 0 ? Number(num || 0) / Number(den) : 0);
const safeString = (value) => String(value || '').trim();
const hasDatabaseConnection = () => Number(mongoose?.connection?.readyState || 0) === 1;
const buildBasicBadge = (userId, reason = 'no_db') => ({
    userId,
    tier: 'Basic',
    signals: {
        govtIdVerified: false,
        companyRegistrationVerified: false,
        escrowUsageCount: 0,
        successfulHiresCount: 0,
    },
    rankingBoostMultiplier: 1,
    visibilityBoostMultiplier: 1,
    trustBoostPoints: 0,
    computedAt: new Date(),
    metadata: {
        reason,
        hireEfficiency: 0,
        computedAt: new Date().toISOString(),
    },
});

const TIER_MULTIPLIERS = {
    Basic: {
        rankingBoostMultiplier: 1,
        visibilityBoostMultiplier: 1,
        trustBoostPoints: 0,
    },
    Verified: {
        rankingBoostMultiplier: 1.03,
        visibilityBoostMultiplier: 1.05,
        trustBoostPoints: 4,
    },
    Pro: {
        rankingBoostMultiplier: 1.06,
        visibilityBoostMultiplier: 1.1,
        trustBoostPoints: 8,
    },
    'Enterprise Verified': {
        rankingBoostMultiplier: 1.1,
        visibilityBoostMultiplier: 1.15,
        trustBoostPoints: 12,
    },
};

const resolveBadgeTier = ({ user, signals, org, hireEfficiency }) => {
    const hasEnterprisePlan = String(user?.subscription?.plan || '').toLowerCase() === 'enterprise';
    const isEnterpriseOrg = String(org?.subscriptionTier || '').toLowerCase() === 'enterprise';

    if (
        signals.companyRegistrationVerified
        && signals.successfulHiresCount >= 10
        && signals.escrowUsageCount >= 5
        && (hasEnterprisePlan || isEnterpriseOrg)
    ) {
        return 'Enterprise Verified';
    }

    const hasProPlan = ['pro', 'enterprise'].includes(String(user?.subscription?.plan || '').toLowerCase());
    if (
        (signals.govtIdVerified || signals.companyRegistrationVerified)
        && (signals.successfulHiresCount >= 5 || hasProPlan)
        && signals.escrowUsageCount >= 2
        && hireEfficiency >= 0.2
    ) {
        return 'Pro';
    }

    if (
        signals.govtIdVerified
        || signals.companyRegistrationVerified
        || signals.successfulHiresCount >= 2
        || signals.escrowUsageCount >= 1
    ) {
        return 'Verified';
    }

    return 'Basic';
};

const getSuccessfulHiresCount = async ({ userId, workerProfileId = null }) => {
    const [asEmployer, asWorker] = await Promise.all([
        Application.countDocuments({ employer: userId, status: 'hired' }),
        workerProfileId
            ? Application.countDocuments({ worker: workerProfileId, status: 'hired' })
            : 0,
    ]);

    return Number(asEmployer || 0) + Number(asWorker || 0);
};

const computeBadgeForUser = async ({ userId, reason = 'manual' }) => {
    if (!hasDatabaseConnection()) {
        return buildBasicBadge(userId, reason || 'no_db');
    }

    const user = await User.findById(userId)
        .select('isVerified organizationId subscription.plan orgRole verificationSignals')
        .lean();
    if (!user) return null;

    const [workerProfile, employerProfile, org] = await Promise.all([
        WorkerProfile.findOne({ user: userId }).select('_id').lean(),
        EmployerProfile.findOne({ user: userId }).select('companyName website').lean(),
        user.organizationId
            ? Organization.findById(user.organizationId).select('subscriptionTier').lean()
            : Promise.resolve(null),
    ]);

    const successfulHiresCount = await getSuccessfulHiresCount({
        userId,
        workerProfileId: workerProfile?._id || null,
    });

    const [escrowUsageCount, appAggRows] = await Promise.all([
        Escrow.countDocuments({
            $or: [{ employerId: userId }, { workerId: userId }],
            status: { $in: ['funded', 'released', 'refunded', 'disputed'] },
        }),
        Application.aggregate([
            {
                $match: {
                    $or: [
                        { employer: userId },
                        ...(workerProfile?._id ? [{ worker: workerProfile._id }] : []),
                    ],
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    hires: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                },
            },
        ]),
    ]);

    const appAgg = appAggRows[0] || { total: 0, hires: 0 };
    const hireEfficiency = clamp(safeDiv(appAgg.hires, Math.max(appAgg.total, 1)), 0, 1);

    const signals = {
        govtIdVerified: Boolean(user.isVerified || user?.verificationSignals?.govtIdVerified),
        companyRegistrationVerified: Boolean(
            user?.verificationSignals?.companyRegistrationVerified
            || (safeString(employerProfile?.companyName) && safeString(employerProfile?.website))
            || (user.organizationId && ['admin', 'hiring_manager'].includes(String(user.orgRole || '').toLowerCase()))
        ),
        escrowUsageCount: Number(escrowUsageCount || 0),
        successfulHiresCount: Number(successfulHiresCount || 0),
    };

    const tier = resolveBadgeTier({
        user,
        signals,
        org,
        hireEfficiency,
    });

    const multipliers = TIER_MULTIPLIERS[tier] || TIER_MULTIPLIERS.Basic;

    return UserVerificationBadge.findOneAndUpdate(
        { userId },
        {
            $set: {
                tier,
                signals,
                rankingBoostMultiplier: Number(multipliers.rankingBoostMultiplier || 1),
                visibilityBoostMultiplier: Number(multipliers.visibilityBoostMultiplier || 1),
                trustBoostPoints: Number(multipliers.trustBoostPoints || 0),
                computedAt: new Date(),
                metadata: {
                    reason,
                    hireEfficiency: Number(hireEfficiency.toFixed(4)),
                    computedAt: new Date().toISOString(),
                },
            },
        },
        { upsert: true, new: true }
    ).lean();
};

const getBadgeForUser = async ({ userId, computeIfMissing = true }) => {
    if (!userId) return null;
    if (!hasDatabaseConnection()) {
        return buildBasicBadge(userId, 'no_db');
    }

    let badge = await UserVerificationBadge.findOne({ userId }).lean();
    if (!badge && computeIfMissing) {
        badge = await computeBadgeForUser({ userId, reason: 'get_badge' });
    }

    return badge;
};

const getBadgeMap = async ({ userIds = [], computeMissing = true }) => {
    const uniqueUserIds = Array.from(new Set(
        (Array.isArray(userIds) ? userIds : [])
            .map((id) => safeString(id))
            .filter(Boolean)
    ));

    if (!uniqueUserIds.length) return new Map();
    if (!hasDatabaseConnection()) {
        return new Map(uniqueUserIds.map((userId) => [userId, buildBasicBadge(userId, 'no_db')]));
    }

    const badges = await UserVerificationBadge.find({ userId: { $in: uniqueUserIds } }).lean();
    const map = new Map(badges.map((row) => [String(row.userId), row]));

    if (computeMissing) {
        for (const userId of uniqueUserIds) {
            if (!map.has(userId)) {
                const computed = await computeBadgeForUser({ userId, reason: 'batch_missing' });
                if (computed) map.set(String(computed.userId), computed);
            }
        }
    }

    return map;
};

const resolveBadgeRankingMultiplier = (badge) => clamp(Number(badge?.rankingBoostMultiplier || 1), 1, 1.25);

module.exports = {
    TIER_MULTIPLIERS,
    computeBadgeForUser,
    getBadgeForUser,
    getBadgeMap,
    resolveBadgeRankingMultiplier,
};
