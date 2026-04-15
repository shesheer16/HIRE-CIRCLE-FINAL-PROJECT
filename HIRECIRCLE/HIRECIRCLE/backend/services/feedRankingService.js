const mongoose = require('mongoose');
const Post = require('../models/Post');
const Job = require('../models/Job');
const {
    buildAuthorBehaviorMap,
    rankPostsWithIntelligence,
} = require('./contentIntelligenceEngine');

const MAX_FEED_LIMIT = 30;
const FEED_RECENCY_HALF_LIFE_HOURS = Number.parseInt(
    process.env.FEED_RECENCY_HALF_LIFE_HOURS || '72',
    10
);

const sanitizeLimit = (value, fallback = 20) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(MAX_FEED_LIMIT, parsed);
};

const sanitizePage = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
};

const normalizePostTypeList = (types = []) => {
    const list = Array.isArray(types) ? types : [types];
    const normalized = list
        .flatMap((item) => String(item || '').split(','))
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    return Array.from(new Set(normalized));
};

const normalizeJobId = (value) => {
    const raw = String(value || '').trim();
    if (!raw || !mongoose.isValidObjectId(raw)) return null;
    return raw;
};

const filterOrphanedJobPosts = async (rows = []) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const jobPostRows = safeRows.filter((row) => String(row?.postType || row?.type || '').toLowerCase() === 'job');
    if (!jobPostRows.length) return safeRows;

    const requestedJobIds = Array.from(new Set(
        jobPostRows
            .map((row) => normalizeJobId(row?.meta?.jobId || row?.jobId))
            .filter(Boolean)
    ));
    if (!requestedJobIds.length) {
        return safeRows.filter((row) => String(row?.postType || row?.type || '').toLowerCase() !== 'job');
    }

    const existingJobs = await Job.find({
        _id: { $in: requestedJobIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
        .select('_id')
        .lean();
    const existingJobIds = new Set(existingJobs.map((job) => String(job?._id || '').trim()).filter(Boolean));

    return safeRows.filter((row) => {
        const isJobPost = String(row?.postType || row?.type || '').toLowerCase() === 'job';
        if (!isJobPost) return true;
        const jobId = normalizeJobId(row?.meta?.jobId || row?.jobId);
        if (!jobId) return false;
        return existingJobIds.has(jobId);
    });
};

const buildVisibilityMatch = ({ viewerId, visibility }) => {
    const normalizedVisibility = String(visibility || '').trim().toLowerCase();
    const baseVisibility = normalizedVisibility || 'public';
    const viewerObjectId = mongoose.isValidObjectId(viewerId)
        ? new mongoose.Types.ObjectId(viewerId)
        : null;

    if (baseVisibility === 'private' && viewerObjectId) {
        return {
            $or: [
                { visibility: 'private', authorId: viewerObjectId },
                { visibility: 'public' },
            ],
        };
    }

    if (baseVisibility === 'connections' || baseVisibility === 'community') {
        return {
            visibility: { $in: ['public', baseVisibility] },
        };
    }

    return { visibility: 'public' };
};

const buildFeedMatch = ({ viewerId, postTypes, visibility }) => {
    const visibilityMatch = buildVisibilityMatch({ viewerId, visibility });
    const postTypeList = normalizePostTypeList(postTypes);

    const match = {
        ...visibilityMatch,
    };

    if (postTypeList.length > 0) {
        match.postType = { $in: postTypeList };
    }

    return match;
};

const rankedFeedPipeline = ({ match, page, limit }) => {
    const skip = (page - 1) * limit;

    return [
        { $match: match },
        {
            $addFields: {
                likeCount: { $size: { $ifNull: ['$likes', []] } },
                commentCount: { $size: { $ifNull: ['$comments', []] } },
                vouchCount: { $size: { $ifNull: ['$vouches', []] } },
                ageHours: {
                    $divide: [
                        { $subtract: ['$$NOW', '$createdAt'] },
                        1000 * 60 * 60,
                    ],
                },
            },
        },
        {
            $lookup: {
                from: 'users',
                localField: 'authorId',
                foreignField: '_id',
                as: 'authorDocs',
                pipeline: [
                    { $project: { name: 1, isVerified: 1, hasCompletedProfile: 1, activeRole: 1, primaryRole: 1 } },
                ],
            },
        },
        {
            $lookup: {
                from: 'communitytrustscores',
                let: { communityId: '$meta.communityId' },
                pipeline: [
                    {
                        $addFields: {
                            circleIdText: { $toString: '$circleId' },
                        },
                    },
                    {
                        $match: {
                            $expr: { $eq: ['$circleIdText', '$$communityId'] },
                        },
                    },
                    {
                        $project: {
                            communityTrustScore: 1,
                        },
                    },
                ],
                as: 'communityTrustDocs',
            },
        },
        {
            $addFields: {
                author: { $first: '$authorDocs' },
                communityTrustScore: {
                    $ifNull: [{ $first: '$communityTrustDocs.communityTrustScore' }, 50],
                },
                interactionWeight: {
                    $min: [
                        1,
                        {
                            $divide: [
                                { $add: ['$likeCount', { $multiply: ['$commentCount', 2] }, { $multiply: ['$vouchCount', 2] }] },
                                50,
                            ],
                        },
                    ],
                },
                recencyWeight: {
                    $max: [
                        0,
                        {
                            $subtract: [
                                1,
                                {
                                    $divide: [
                                        '$ageHours',
                                        Math.max(1, FEED_RECENCY_HALF_LIFE_HOURS),
                                    ],
                                },
                            ],
                        },
                    ],
                },
                trustWeight: {
                    $add: [
                        { $cond: [{ $eq: ['$author.isVerified', true] }, 0.2, 0] },
                        { $cond: [{ $eq: ['$author.hasCompletedProfile', true] }, 0.1, 0] },
                    ],
                },
            },
        },
        {
            $addFields: {
                communityTrustMultiplier: {
                    $cond: [
                        { $eq: ['$postType', 'community'] },
                        {
                            $max: [
                                0.55,
                                {
                                    $divide: ['$communityTrustScore', 100],
                                },
                            ],
                        },
                        1,
                    ],
                },
            },
        },
        {
            $addFields: {
                engagementScore: {
                    $multiply: [
                        { $add: ['$recencyWeight', '$interactionWeight', '$trustWeight'] },
                        '$communityTrustMultiplier',
                    ],
                },
                interactionCount: {
                    $add: ['$likeCount', '$commentCount', '$vouchCount'],
                },
            },
        },
        {
            $sort: {
                engagementScore: -1,
                createdAt: -1,
                _id: 1,
            },
        },
        { $skip: skip },
        { $limit: limit },
        {
            $project: {
                authorDocs: 0,
                communityTrustDocs: 0,
            },
        },
    ];
};

const fetchRankedPosts = async ({
    viewerId = null,
    viewer = null,
    postTypes = [],
    visibility = 'public',
    page = 1,
    limit = 20,
} = {}) => {
    const normalizedPage = sanitizePage(page);
    const normalizedLimit = sanitizeLimit(limit, 20);
    const match = buildFeedMatch({
        viewerId,
        postTypes,
        visibility,
    });

    const [rawRows, total] = await Promise.all([
        Post.aggregate(rankedFeedPipeline({
            match,
            page: normalizedPage,
            limit: normalizedLimit,
        })),
        Post.countDocuments(match),
    ]);
    const rows = await filterOrphanedJobPosts(rawRows);

    const behaviorMap = await buildAuthorBehaviorMap({ posts: rows });
    const rankedRows = rankPostsWithIntelligence({
        posts: rows,
        viewer: viewer || { _id: viewerId },
        behaviorMap,
    });

    const hasMore = (normalizedPage * normalizedLimit) < total;

    return {
        posts: rankedRows,
        page: normalizedPage,
        limit: normalizedLimit,
        total,
        hasMore,
    };
};

module.exports = {
    MAX_FEED_LIMIT,
    fetchRankedPosts,
    sanitizeLimit,
    sanitizePage,
    normalizePostTypeList,
};
