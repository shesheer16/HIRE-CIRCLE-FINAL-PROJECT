const UserBehaviorProfile = require('../models/UserBehaviorProfile');

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);
const normalizeText = (value, fallback = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const toAgeHours = (createdAt) => {
    const ms = Date.now() - new Date(createdAt || 0).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return ms / (1000 * 60 * 60);
};

const resolveEngagementVelocity = (post = {}) => {
    const interactionCount = Number(post.interactionCount || 0);
    const ageHours = toAgeHours(post.createdAt);
    return clamp01(interactionCount / Math.max(ageHours + 1, 1) / 6);
};

const resolveTrustWeight = ({ post = {}, authorBehavior = null }) => {
    const author = post.author || {};
    const verified = author.isVerified ? 0.22 : 0;
    const completedProfile = author.hasCompletedProfile ? 0.12 : 0;

    const behaviorTrust = authorBehavior
        ? clamp01((Number(authorBehavior.reliabilityScore || 0) * 0.65) + (Number(authorBehavior.completionRate || 0) * 0.35))
        : 0.5;

    const spamPenalty = authorBehavior
        ? clamp(1 - (1 - Number(authorBehavior.reliabilityScore || 0)) * 0.35, 0.75, 1)
        : 1;

    return clamp01((verified + completedProfile + (behaviorTrust * 0.66)) * spamPenalty);
};

const resolveUserRelevance = ({ post = {}, viewer = {} }) => {
    const viewerRole = normalizeText(viewer.activeRole || viewer.primaryRole || 'worker', 'worker');
    const postType = normalizeText(post.postType || post.type || 'status', 'status');

    const roleMap = {
        worker: {
            job: 1,
            academy: 0.8,
            community: 0.7,
            bounty: 0.6,
            status: 0.5,
        },
        employer: {
            job: 0.65,
            academy: 0.55,
            community: 0.72,
            bounty: 0.9,
            status: 0.5,
        },
    };

    const bucket = roleMap[viewerRole] || roleMap.worker;
    return clamp01(bucket[postType] ?? 0.5);
};

const resolveCommunityAffinity = ({ post = {}, viewer = {} }) => {
    const viewerCity = normalizeText(viewer.city || '', '');
    const postCity = normalizeText(post?.meta?.city || post?.location?.city || '', '');
    const sameCity = viewerCity && postCity && viewerCity === postCity;

    const sharedVisibility = ['community', 'connections'].includes(normalizeText(post.visibility, 'public')) ? 0.2 : 0;
    const cityBoost = sameCity ? 0.4 : 0;
    const baseline = 0.4;

    return clamp01(baseline + sharedVisibility + cityBoost);
};

const rankPostsWithIntelligence = ({ posts = [], viewer = {}, behaviorMap = new Map() } = {}) => {
    if (!Array.isArray(posts) || posts.length === 0) return [];

    const ranked = posts.map((post) => {
        const authorId = String(post.authorId || post.author?._id || post.user || '');
        const authorBehavior = behaviorMap.get(authorId) || null;

        const engagementVelocity = resolveEngagementVelocity(post);
        const trustWeight = resolveTrustWeight({ post, authorBehavior });
        const userRelevance = resolveUserRelevance({ post, viewer });
        const communityAffinity = resolveCommunityAffinity({ post, viewer });

        const intelligenceScore = clamp01(
            (engagementVelocity * 0.32)
            + (trustWeight * 0.27)
            + (userRelevance * 0.23)
            + (communityAffinity * 0.18)
        );

        return {
            ...post,
            intelligenceScore: Number(intelligenceScore.toFixed(4)),
            intelligenceExplainability: {
                engagementVelocity: Number(engagementVelocity.toFixed(4)),
                trustWeight: Number(trustWeight.toFixed(4)),
                userRelevance: Number(userRelevance.toFixed(4)),
                communityAffinity: Number(communityAffinity.toFixed(4)),
                rankingPolicy: 'deterministic_weighted_v2',
                antiManipulation: {
                    randomBoosting: false,
                    spamPenaltyApplied: Boolean(authorBehavior),
                },
            },
        };
    });

    ranked.sort((left, right) => {
        const rightScore = Number(right.intelligenceScore || right.engagementScore || 0);
        const leftScore = Number(left.intelligenceScore || left.engagementScore || 0);
        if (rightScore !== leftScore) return rightScore - leftScore;

        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });

    return ranked;
};

const buildAuthorBehaviorMap = async ({ posts = [] } = {}) => {
    const authorIds = Array.from(new Set(
        posts
            .map((post) => String(post.authorId || post.author?._id || post.user || '').trim())
            .filter(Boolean)
    ));

    if (!authorIds.length) return new Map();

    const rows = await UserBehaviorProfile.find({
        userId: { $in: authorIds },
    })
        .select('userId reliabilityScore completionRate engagementScore')
        .lean();

    return new Map(rows.map((row) => [String(row.userId), row]));
};

module.exports = {
    rankPostsWithIntelligence,
    buildAuthorBehaviorMap,
    resolveEngagementVelocity,
    resolveTrustWeight,
    resolveUserRelevance,
    resolveCommunityAffinity,
};
