const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const Post = require('../models/Post');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const { fetchRankedPosts, normalizePostTypeList } = require('../services/feedRankingService');
const { resolveStructuredLocationFields } = require('../utils/locationFields');
const { rankPulseItemsByViewerLocation } = require('../services/pulseRankingService');

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

const buildRankingWindow = (page, limit) => Math.min(
    MAX_LIMIT,
    Math.max(limit, Math.min(MAX_LIMIT, page * limit * 3), 20)
);

const paginateItems = (items = [], page = 1, limit = 20) => {
    const safeItems = Array.isArray(items) ? items : [];
    const start = Math.max(0, (page - 1) * limit);
    return safeItems.slice(start, start + limit);
};

const resolvePulseViewerLocation = async (user = {}) => {
    const safeUserId = user?._id;
    if (!safeUserId) {
        return resolveStructuredLocationFields({});
    }

    const activeRole = String(user?.activeRole || '').trim().toLowerCase();
    const workerQuery = WorkerProfile.findOne({ user: safeUserId })
        .select('district mandal city panchayat locationLabel')
        .lean();
    const employerQuery = EmployerProfile.findOne({ user: safeUserId })
        .select('district mandal location locationLabel')
        .lean();

    const [workerProfile, employerProfile] = await Promise.all([workerQuery, employerQuery]);
    const primaryProfile = activeRole === 'employer'
        ? (employerProfile || workerProfile)
        : (workerProfile || employerProfile);

    return resolveStructuredLocationFields({
        district: primaryProfile?.district,
        mandal: primaryProfile?.mandal,
        city: primaryProfile?.city || user?.city,
        locality: primaryProfile?.mandal,
        panchayat: primaryProfile?.panchayat,
        location: primaryProfile?.location,
        locationLabel: primaryProfile?.locationLabel,
    });
};

const buildPulseLocationLabel = (job = {}) => [String(job?.mandal || '').trim(), String(job?.district || '').trim()]
    .filter(Boolean)
    .join(', ')
    || String(job?.locationLabel || job?.location || '').trim();

const toPulseItemFromPost = (post = {}, job = null) => ({
    id: String(post._id),
    postId: String(post._id),
    jobId: String(post?.meta?.jobId || '').trim(),
    postType: post.postType || 'status',
    title: job?.title || post.content || 'Update',
    employer: job?.companyName || post?.author?.name || post?.user?.name || 'Member',
    distance: buildPulseLocationLabel(job) || 'Nearby',
    location: buildPulseLocationLabel(job) || 'Nearby',
    district: String(job?.district || '').trim(),
    mandal: String(job?.mandal || '').trim(),
    locationLabel: buildPulseLocationLabel(job) || 'Nearby',
    pay: post.postType === 'job' ? (job?.salaryRange || 'See details') : null,
    urgent: post.postType === 'job',
    timePosted: post.createdAt,
    category: String(post.postType || 'status').toUpperCase(),
    visibility: post.visibility || 'public',
    engagementScore: Number(post.engagementScore || 0),
    interactionCount: Number(post.interactionCount || 0),
    createdAt: post.createdAt,
    canApply: String(post.postType || '').toLowerCase() === 'job' && Boolean(String(post?.meta?.jobId || '').trim()),
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
        postId: '',
        jobId: String(job._id),
        postType: 'job',
        title: job.title || 'Open role',
        employer: job.companyName || 'Employer',
        distance: buildPulseLocationLabel(job) || 'Nearby',
        location: buildPulseLocationLabel(job) || 'Nearby',
        district: String(job?.district || '').trim(),
        mandal: String(job?.mandal || '').trim(),
        locationLabel: buildPulseLocationLabel(job) || 'Nearby',
        pay: job.salaryRange || 'Negotiable',
        urgent: Boolean(job.isPulse),
        timePosted: job.createdAt,
        category: 'JOB',
        visibility: 'public',
        engagementScore,
        interactionCount: Number(job.viewCount || 0),
        createdAt: job.createdAt,
        canApply: true,
    };
};

router.get('/', protect, async (req, res) => {
    try {
        const page = normalizePage(req.query.page);
        const limit = normalizeLimit(req.query.limit, 20);
        const rankingWindow = buildRankingWindow(page, limit);
        const requestedTypes = normalizePostTypeList(req.query.types || []);
        const pulseTypes = requestedTypes.length > 0
            ? requestedTypes
            : ['job', 'bounty', 'community', 'academy', 'status'];
        const viewerLocation = await resolvePulseViewerLocation(req.user);

        const ranked = await fetchRankedPosts({
            viewerId: req.user?._id,
            page: 1,
            limit: rankingWindow,
            visibility: 'public',
            postTypes: pulseTypes,
        });

        if (ranked.posts.length > 0) {
            const filteredPosts = ranked.posts.filter((post) => {
                const isJobPost = String(post?.postType || post?.type || '').toLowerCase() === 'job';
                if (!isJobPost) return false;
                const jobId = String(post?.meta?.jobId || post?.jobId || '').trim();
                return Boolean(jobId);
            });
            const jobIds = filteredPosts
                .map((post) => String(post?.meta?.jobId || post?.jobId || '').trim())
                .filter(Boolean);
            const jobsById = new Map(
                (await Job.find({ _id: { $in: jobIds } })
                    .select('_id title companyName location district mandal locationLabel salaryRange isPulse createdAt viewCount')
                    .lean())
                    .map((job) => [String(job?._id || ''), job])
            );
            const liveJobPosts = filteredPosts.filter((post) => {
                const jobId = String(post?.meta?.jobId || post?.jobId || '').trim();
                return Boolean(jobId) && jobsById.has(jobId);
            });
            if (liveJobPosts.length > 0) {
                const rankedItems = rankPulseItemsByViewerLocation({
                    items: liveJobPosts.map((post) => {
                        const jobId = String(post?.meta?.jobId || post?.jobId || '').trim();
                        return toPulseItemFromPost(post, jobsById.get(jobId) || null);
                    }),
                    viewerLocation,
                });
                return res.json({
                    items: paginateItems(rankedItems, page, limit),
                    page,
                    limit,
                    hasMore: (page * limit) < liveJobPosts.length,
                    total: liveJobPosts.length,
                    source: 'posts',
                });
            }
        }

        const fallbackJobs = await Job.find({
            isOpen: true,
            status: 'active',
        })
            .sort({ createdAt: -1, _id: 1 })
            .limit(rankingWindow)
            .lean();

        const totalFallback = await Job.countDocuments({ isOpen: true, status: 'active' });
        const fallbackHasMore = (page * limit) < totalFallback;
        const fallbackItems = rankPulseItemsByViewerLocation({
            items: fallbackJobs.map(toPulseItemFromJob),
            viewerLocation,
        });

        // Persist derived job posts so future pulse fetches remain deterministic on PostModel.
        const existingPostIds = new Set(
            (await Post.find({ postType: 'job', 'meta.jobId': { $in: fallbackJobs.map((job) => String(job._id)) } })
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
            await Post.insertMany(newRows, { ordered: false }).catch(() => { });
        }

        return res.json({
            items: paginateItems(fallbackItems, page, limit),
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
