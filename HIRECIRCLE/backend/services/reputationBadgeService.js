const BadgeDefinition = require('../models/BadgeDefinition');
const UserBadge = require('../models/UserBadge');
const User = require('../models/userModel');

const DEFAULT_BADGE_DEFINITIONS = [
    {
        badgeKey: 'verified_professional',
        name: 'Verified Professional',
        description: 'Verified account with strong trust consistency.',
        criteria: {
            minTrustScore: 70,
            requireVerifiedUser: true,
            requireCompletedProfile: true,
        },
    },
    {
        badgeKey: 'fast_responder',
        name: 'Fast Responder',
        description: 'Maintains strong response behavior.',
        criteria: {
            minResponseScore: 85,
        },
    },
    {
        badgeKey: 'top_employer',
        name: 'Top Employer',
        description: 'High-volume hiring with consistent outcomes.',
        criteria: {
            minHireSuccessScore: 75,
            minVerifiedHires: 10,
            requireEmployerRole: true,
        },
    },
    {
        badgeKey: 'high_completion_rate',
        name: 'High Completion Rate',
        description: 'Sustained completion rate over verified hires.',
        criteria: {
            minCompletionRate: 85,
            minVerifiedHires: 5,
        },
    },
    {
        badgeKey: 'trusted_community_leader',
        name: 'Trusted Community Leader',
        description: 'Strong trust and healthy community influence.',
        criteria: {
            minNetworkAuthorityScore: 70,
            minCommunityInfluence: 70,
        },
    },
    {
        badgeKey: 'escrow_reliable',
        name: 'Escrow Reliable',
        description: 'Reliable delivery and low dispute impact in escrow-linked activity.',
        criteria: {
            maxDisputeRate: 12,
            minVerifiedHires: 3,
        },
    },
    {
        badgeKey: 'dispute_free',
        name: 'Dispute-Free',
        description: 'No material dispute signals in recent activity.',
        criteria: {
            maxDisputeRate: 0.5,
            maxReportRate: 1.5,
        },
    },
];

const clamp = (value, min = 0, max = 100) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.max(min, Math.min(max, parsed));
};

const upsertBadgeDefinition = async (definition) => {
    return BadgeDefinition.findOneAndUpdate(
        { badgeKey: definition.badgeKey },
        {
            $set: {
                name: definition.name,
                description: definition.description,
                criteria: definition.criteria,
                active: true,
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
};

const ensureBadgeDefinitions = async () => {
    await Promise.all(DEFAULT_BADGE_DEFINITIONS.map((definition) => upsertBadgeDefinition(definition)));
    return BadgeDefinition.find({ active: true }).lean();
};

const determineEligibleBadges = ({ definitions = [], user = null, reputationProfile = null }) => {
    const trust = clamp(reputationProfile?.overallTrustScore, 0, 100);
    const response = clamp(reputationProfile?.responseScore, 0, 100);
    const hireSuccess = clamp(reputationProfile?.hireSuccessScore, 0, 100);
    const completionRate = clamp(reputationProfile?.completionRate, 0, 100);
    const networkAuthority = clamp(reputationProfile?.networkAuthorityScore, 0, 100);
    const communityInfluence = clamp(reputationProfile?.communityInfluence, 0, 100);
    const disputeRate = clamp(reputationProfile?.disputeRate, 0, 100);
    const reportRate = clamp(reputationProfile?.reportRate, 0, 100);
    const verifiedHires = Number(reputationProfile?.verifiedHires || 0);
    const isEmployer = String(user?.activeRole || '').toLowerCase() === 'employer';

    return definitions
        .filter((definition) => {
            const criteria = definition.criteria || {};
            if (Number.isFinite(criteria.minTrustScore) && trust < Number(criteria.minTrustScore)) return false;
            if (Number.isFinite(criteria.minResponseScore) && response < Number(criteria.minResponseScore)) return false;
            if (Number.isFinite(criteria.minHireSuccessScore) && hireSuccess < Number(criteria.minHireSuccessScore)) return false;
            if (Number.isFinite(criteria.minCompletionRate) && completionRate < Number(criteria.minCompletionRate)) return false;
            if (Number.isFinite(criteria.minNetworkAuthorityScore) && networkAuthority < Number(criteria.minNetworkAuthorityScore)) return false;
            if (Number.isFinite(criteria.minCommunityInfluence) && communityInfluence < Number(criteria.minCommunityInfluence)) return false;
            if (Number.isFinite(criteria.maxDisputeRate) && disputeRate > Number(criteria.maxDisputeRate)) return false;
            if (Number.isFinite(criteria.maxReportRate) && reportRate > Number(criteria.maxReportRate)) return false;
            if (Number.isFinite(criteria.minVerifiedHires) && verifiedHires < Number(criteria.minVerifiedHires)) return false;
            if (criteria.requireVerifiedUser && !user?.isVerified) return false;
            if (criteria.requireCompletedProfile && !user?.hasCompletedProfile) return false;
            if (criteria.requireEmployerRole && !isEmployer) return false;
            return true;
        })
        .map((definition) => definition.badgeKey);
};

const syncUserBadges = async ({ userId, reputationProfile, adminOverrideBadgeKeys = [] }) => {
    if (!userId || !reputationProfile) return [];

    const [definitions, user] = await Promise.all([
        ensureBadgeDefinitions(),
        User.findById(userId).select('isVerified hasCompletedProfile activeRole').lean(),
    ]);

    const autoBadgeKeys = determineEligibleBadges({
        definitions,
        user,
        reputationProfile,
    });
    const activeAutoSet = new Set(autoBadgeKeys);
    const adminOverrideSet = new Set((Array.isArray(adminOverrideBadgeKeys) ? adminOverrideBadgeKeys : []).map((item) => String(item || '').toLowerCase()));

    const definitionByKey = new Map(definitions.map((definition) => [definition.badgeKey, definition]));
    const allTargetBadgeKeys = new Set([...activeAutoSet, ...adminOverrideSet]);

    const operations = [];
    for (const badgeKey of allTargetBadgeKeys) {
        const definition = definitionByKey.get(badgeKey);
        if (!definition) continue;
        const source = adminOverrideSet.has(badgeKey) ? 'admin_override' : 'auto';

        operations.push(
            UserBadge.findOneAndUpdate(
                { userId, badgeKey },
                {
                    $set: {
                        badgeName: definition.name,
                        source,
                        awardedAt: new Date(),
                        active: true,
                        criteriaSnapshot: definition.criteria || {},
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            )
        );
    }

    await Promise.all(operations);

    await UserBadge.updateMany(
        {
            userId,
            badgeKey: { $nin: Array.from(allTargetBadgeKeys) },
            source: 'auto',
        },
        { $set: { active: false } }
    );

    return UserBadge.find({ userId, active: true })
        .sort({ awardedAt: -1 })
        .lean();
};

module.exports = {
    DEFAULT_BADGE_DEFINITIONS,
    ensureBadgeDefinitions,
    determineEligibleBadges,
    syncUserBadges,
};
