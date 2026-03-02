const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Post = require('../models/Post');
const Job = require('../models/Job');
const { fetchRankedPosts, normalizePostTypeList } = require('../services/feedRankingService');

const MAX_LIMIT = 30;

const normalizeLimit = (value, fallback = 20) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(MAX_LIMIT, parsed);
};

const normalizePage = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
};

const toPulseItemFromPost = (post = {}) => ({
    id: String(post._id),
    postType: post.postType || 'status',
    title: post.content || 'Update',
    employer: post?.author?.name || post?.user?.name || 'Member',
    distance: 'Nearby',
    pay: post.postType === 'job' ? 'See details' : null,
    urgent: post.postType === 'job',
    timePosted: post.createdAt,
    category: String(post.postType || 'status').toUpperCase(),
    visibility: post.visibility || 'public',
    engagementScore: Number(post.engagementScore || 0),
    interactionCount: Number(post.interactionCount || 0),
    createdAt: post.createdAt,
});

const computeRecencyWeight = (createdAt) => {
    const ageMs = Date.now() - new Date(createdAt || Date.now()).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return Math.max(0, 1 - (ageHours / 72));
};

const toPulseItemFromJob = (job = {}) => {
    const recencyWeight = computeRecencyWeight(job.createdAt);
    const interactionWeight = Math.min(1, Number(job.viewCount || 0) / 50);
    const trustWeight = 0.1;
    const engagementScore = Number((recencyWeight + interactionWeight + trustWeight).toFixed(4));

    return {
        id: String(job._id),
        postType: 'job',
        title: job.title || 'Open role',
        employer: job.companyName || 'Employer',
        distance: job.location || 'Nearby',
        pay: job.salaryRange || 'Negotiable',
        urgent: Boolean(job.isPulse),
        timePosted: job.createdAt,
        category: 'JOB',
        visibility: 'public',
        engagementScore,
        interactionCount: Number(job.viewCount || 0),
        createdAt: job.createdAt,
    };
};

router.get('/', protect, async (req, res) => {
    try {
        const page = normalizePage(req.query.page);
        const limit = normalizeLimit(req.query.limit, 20);
        const requestedTypes = normalizePostTypeList(req.query.types || []);
        const pulseTypes = requestedTypes.length > 0
            ? requestedTypes
            : ['job', 'bounty', 'community', 'academy', 'status'];

        const ranked = await fetchRankedPosts({
            viewerId: req.user?._id,
            page,
            limit,
            visibility: 'public',
            postTypes: pulseTypes,
        });

        if (ranked.posts.length > 0) {
            return res.json({
                items: ranked.posts.map(toPulseItemFromPost),
                page: ranked.page,
                limit: ranked.limit,
                hasMore: ranked.hasMore,
                total: ranked.total,
                source: 'posts',
            });
        }

        const fallbackJobs = await Job.find({
            isOpen: true,
            status: 'active',
        })
            .sort({ createdAt: -1, _id: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const totalFallback = await Job.countDocuments({ isOpen: true, status: 'active' });
        const fallbackHasMore = (page * limit) < totalFallback;
        const fallbackItems = fallbackJobs.map(toPulseItemFromJob);

        // Persist derived job posts so future pulse fetches remain deterministic on PostModel.
        const existingPostIds = new Set(
            (await Post.find({ postType: 'job', 'meta.jobId': { $in: fallbackItems.map((item) => item.id) } })
                .select('meta.jobId')
                .lean())
                .map((row) => String(row?.meta?.jobId || ''))
                .filter(Boolean)
        );

        const newRows = fallbackJobs
            .filter((job) => !existingPostIds.has(String(job._id)))
            .map((job) => ({
                user: job.employerId,
                authorId: job.employerId,
                postType: 'job',
                type: 'job',
                content: `${job.title} · ${job.companyName}`,
                visibility: 'public',
                engagementScore: computeRecencyWeight(job.createdAt) + 0.1,
                interactionCount: Number(job.viewCount || 0),
                trustWeight: 0.1,
                media: [],
                mediaUrl: '',
                meta: {
                    jobId: String(job._id),
                },
            }));
        if (newRows.length > 0) {
            await Post.insertMany(newRows, { ordered: false }).catch(() => {});
        }

        return res.json({
            items: fallbackItems,
            page,
            limit,
            hasMore: fallbackHasMore,
            total: totalFallback,
            source: 'jobs',
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load pulse items' });
    }
});

module.exports = router;
