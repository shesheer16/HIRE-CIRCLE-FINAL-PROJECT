const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { trustGuard } = require('../middleware/trustGuardMiddleware');
const Post = require('../models/Post');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Bounty = require('../models/Bounty');
const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const Referral = require('../models/Referral');
const { feedCreateSchema } = require('../schemas/requestSchemas');
const { fetchRankedPosts, normalizePostTypeList } = require('../services/feedRankingService');
const { getFeatureFlag } = require('../services/featureFlagService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { createAndSendBehaviorNotification } = require('../services/growthNotificationService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { recomputeUserNetworkScore } = require('../services/networkScoreService');
const { buildCacheKey, getJSON, setJSON, delByPattern, CACHE_TTL_SECONDS } = require('../services/cacheService');
const { sanitizeText } = require('../utils/sanitizeText');

const normalizeNumber = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const POST_VISIBILITY_VALUES = new Set(['public', 'connections', 'community', 'private']);
const POST_TYPE_VALUES = new Set(['job', 'bounty', 'community', 'academy', 'status']);
const LEGACY_FEED_TYPES = new Set(['text', 'voice', 'photo', 'video']);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());
const asObjectId = (value) => {
    try {
        if (!value) return null;
        if (value instanceof mongoose.Types.ObjectId) return value;
        const normalized = String(value || '').trim();
        if (!mongoose.Types.ObjectId.isValid(normalized)) return null;
        return new mongoose.Types.ObjectId(normalized);
    } catch {
        return null;
    }
};

const pickActiveRoleProfile = (workerProfile = {}) => {
    const profiles = Array.isArray(workerProfile?.roleProfiles) ? workerProfile.roleProfiles : [];
    if (!profiles.length) return null;
    return profiles.find((profile) => Boolean(profile?.activeProfile)) || profiles[0];
};

const mapWorkerProfileForClient = ({ user = {}, workerProfile = {} }) => {
    const activeRoleProfile = pickActiveRoleProfile(workerProfile);
    const displayName = String(
        user?.name
        || [workerProfile?.firstName, workerProfile?.lastName].filter(Boolean).join(' ')
        || 'Candidate'
    ).trim() || 'Candidate';
    const location = String(workerProfile?.city || user?.city || '').trim();
    const roleName = String(activeRoleProfile?.roleName || '').trim();
    const experienceYears = Number(
        workerProfile?.totalExperience
        ?? activeRoleProfile?.experienceInRole
        ?? 0
    );
    const skills = Array.isArray(activeRoleProfile?.skills)
        ? activeRoleProfile.skills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 12)
        : [];
    const summary = String(
        workerProfile?.videoIntroduction?.transcript
        || `Open to ${roleName || 'new'} opportunities.`
    ).trim();
    const trustScore = Number(user?.trustScore ?? 0);
    const responseScore = Number(user?.responseScore ?? 0);

    return {
        mode: 'candidate',
        name: displayName,
        avatar: workerProfile?.avatar || '',
        headline: roleName
            ? `${roleName} • ${location || 'Open to opportunities'}`
            : (location ? `Professional • ${location}` : 'Job Seeker Profile'),
        industryTag: 'JOB SEEKER PROFILE',
        summary: summary || 'No profile summary available yet.',
        experienceYears: Number.isFinite(experienceYears) ? Math.max(0, experienceYears) : 0,
        skills: skills.length ? skills : ['Profile setup in progress'],
        highlights: [
            { label: 'Location', value: location || 'Not specified' },
            { label: 'Availability', value: workerProfile?.isAvailable ? 'Available' : 'Limited' },
            { label: 'Trust Score', value: Number.isFinite(trustScore) ? `${Math.round(trustScore)}%` : 'N/A' },
            { label: 'Response', value: Number.isFinite(responseScore) ? `${Math.round(responseScore)}%` : 'N/A' },
        ],
        workHistory: (Array.isArray(workerProfile?.roleProfiles) ? workerProfile.roleProfiles : [])
            .slice(0, 4)
            .map((roleProfile) => ({
                roleName: String(roleProfile?.roleName || '').trim() || 'Role',
                experienceInRole: Number(roleProfile?.experienceInRole || 0),
            })),
    };
};

const mapEmployerProfileForClient = ({ user = {}, employerProfile = {} }) => {
    const companyName = String(employerProfile?.companyName || user?.name || 'Employer').trim() || 'Employer';
    const location = String(employerProfile?.location || user?.city || '').trim();
    const industry = String(employerProfile?.industry || '').trim();
    const description = String(employerProfile?.description || '').trim();
    const trustScore = Number(user?.trustScore ?? 0);
    const responseScore = Number(user?.responseScore ?? 0);

    return {
        mode: 'employer',
        name: companyName,
        avatar: employerProfile?.logoUrl || '',
        headline: `${industry || 'Hiring Team'}${location ? ` • ${location}` : ''}`,
        industryTag: 'EMPLOYER PROFILE',
        mission: description || 'Growing team and open opportunities for verified professionals.',
        industry: industry || 'Not specified',
        hq: location || 'Not specified',
        contactInfo: {
            partnership: user?.email || 'Not shared',
            support: user?.phoneNumber || 'Not shared',
            website: employerProfile?.website || 'Not shared',
        },
        highlights: [
            { label: 'Location', value: location || 'Not specified' },
            { label: 'Industry', value: industry || 'General' },
            { label: 'Trust Score', value: Number.isFinite(trustScore) ? `${Math.round(trustScore)}%` : 'N/A' },
            { label: 'Response', value: Number.isFinite(responseScore) ? `${Math.round(responseScore)}%` : 'N/A' },
        ],
    };
};

const mapPostForClient = (post = {}) => {
    const resolvedAuthor = post.author || {};
    const authorId = post.authorId || post.user || resolvedAuthor._id || null;
    const primaryRole = String(
        resolvedAuthor.activeRole
        || resolvedAuthor.primaryRole
        || post?.user?.primaryRole
        || 'worker'
    ).toLowerCase();

    return {
        ...post,
        _id: post._id,
        authorId,
        user: {
            _id: authorId,
            name: resolvedAuthor.name || post?.user?.name || 'Member',
            primaryRole: primaryRole === 'employer' ? 'employer' : 'worker',
        },
        postType: post.postType || 'status',
        type: post.type || post.postType || 'status',
        visibility: post.visibility || 'public',
        media: Array.isArray(post.media) ? post.media : [],
        mediaUrl: post.mediaUrl || post?.media?.[0]?.url || '',
    };
};

router.get('/posts', protect, async (req, res) => {
    try {
        const page = normalizeNumber(req.query.page, 1);
        const limit = normalizeNumber(req.query.limit, 20);
        const visibility = POST_VISIBILITY_VALUES.has(String(req.query.visibility || '').toLowerCase())
            ? String(req.query.visibility).toLowerCase()
            : 'public';
        const postTypes = normalizePostTypeList(req.query.types || []);

        const cacheKey = buildCacheKey('feed:posts', {
            viewerId: String(req.user?._id || ''),
            page,
            limit,
            visibility,
            postTypes,
        });
        const cached = await getJSON(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const ranked = await fetchRankedPosts({
            viewerId: req.user?._id,
            viewer: req.user || null,
            page,
            limit,
            visibility,
            postTypes,
        });
        const responsePayload = {
            posts: ranked.posts.map(mapPostForClient),
            hasMore: ranked.hasMore,
            page: ranked.page,
            limit: ranked.limit,
            total: ranked.total,
        };
        await setJSON(cacheKey, responsePayload, CACHE_TTL_SECONDS.feed);
        return res.json(responsePayload);
    } catch (error) {
        res.status(500).json({ message: 'Failed to load feed posts' });
    }
});

router.get('/profiles/:userId', protect, async (req, res) => {
    try {
        const userObjectId = asObjectId(req.params.userId);
        if (!userObjectId) {
            return res.status(400).json({ message: 'Invalid user id' });
        }

        const [user, workerProfile, employerProfile] = await Promise.all([
            User.findById(userObjectId)
                .select('name email phoneNumber city country activeRole primaryRole trustScore responseScore isDeleted')
                .lean(),
            WorkerProfile.findOne({ user: userObjectId }).lean(),
            EmployerProfile.findOne({ user: userObjectId }).lean(),
        ]);

        if (!user || user?.isDeleted) {
            return res.status(404).json({ message: 'Profile not found' });
        }

        const activeRole = String(user?.activeRole || user?.primaryRole || '').trim().toLowerCase();
        const prefersEmployerView = activeRole === 'employer';

        const mappedProfile = prefersEmployerView
            ? (employerProfile
                ? mapEmployerProfileForClient({ user, employerProfile })
                : mapWorkerProfileForClient({ user, workerProfile }))
            : (workerProfile
                ? mapWorkerProfileForClient({ user, workerProfile })
                : mapEmployerProfileForClient({ user, employerProfile }));

        return res.json({ profile: mappedProfile });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load profile details' });
    }
});

router.post('/posts', protect, trustGuard('feed_post'), validate({ body: feedCreateSchema }), async (req, res) => {
    try {
        const {
            type = 'status',
            postType = null,
            content = '',
            mediaUrl = '',
            media = [],
            visibility = 'public',
            lat,
            lng,
        } = req.body || {};
        const normalizedVisibility = POST_VISIBILITY_VALUES.has(String(visibility || '').toLowerCase())
            ? String(visibility).toLowerCase()
            : 'public';
        const normalizedType = String(type || '').toLowerCase();
        const normalizedPostType = String(postType || '').toLowerCase();
        const resolvedPostType = POST_TYPE_VALUES.has(normalizedPostType)
            ? normalizedPostType
            : (POST_TYPE_VALUES.has(normalizedType) ? normalizedType : 'status');
        if (resolvedPostType === 'bounty') {
            const bountyEnabled = await getFeatureFlag('BOUNTIES', true);
            if (!bountyEnabled) {
                return res.status(403).json({ message: 'Bounties are disabled by admin' });
            }
        }
        const resolvedLegacyType = LEGACY_FEED_TYPES.has(normalizedType)
            ? normalizedType
            : resolvedPostType;
        const normalizedMedia = Array.isArray(media)
            ? media
                .map((item) => {
                    if (!item || typeof item !== 'object') return null;
                    const url = String(item.url || '').trim();
                    if (!url) return null;
                    return {
                        url,
                        mimeType: String(item.mimeType || '').trim(),
                        sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Number(item.sizeBytes) : null,
                    };
                })
                .filter(Boolean)
            : [];

        const created = await Post.create({
            user: req.user._id,
            authorId: req.user._id,
            type: resolvedLegacyType,
            postType: resolvedPostType,
            content: sanitizeText(content, { maxLength: 5000 }),
            mediaUrl: mediaUrl || normalizedMedia[0]?.url || '',
            media: normalizedMedia,
            visibility: normalizedVisibility,
            trustWeight: Number(req.user?.isVerified ? 0.2 : 0) + Number(req.user?.hasCompletedProfile ? 0.1 : 0),
            location: {
                type: 'Point',
                coordinates: [Number(lng) || 0, Number(lat) || 0],
            },
        });

        const populated = await Post.findById(created._id)
            .populate('authorId', 'name activeRole primaryRole')
            .lean();

        const payload = mapPostForClient({
            ...populated,
            author: populated?.authorId,
        });

        if (resolvedPostType === 'bounty') {
            safeLogPlatformEvent({
                type: 'bounty_created',
                userId: req.user._id,
                meta: {
                    postId: String(created._id),
                },
            });
        }

        setImmediate(() => {
            recordFeatureUsage({
                userId: req.user._id,
                featureKey: `post_created_${resolvedPostType}`,
                metadata: {
                    postId: String(created._id),
                },
            }).catch(() => {});
            recomputeUserNetworkScore({ userId: req.user._id }).catch(() => {});
        });

        await delByPattern('cache:feed:posts:*');
        res.status(201).json({ post: payload });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create post' });
    }
});

router.post('/posts/:id/like', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid post id' });
        }
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const userId = String(req.user._id);
        const existingIndex = post.likes.findIndex((id) => String(id) === userId);
        const liked = existingIndex < 0;

        if (existingIndex >= 0) {
            post.likes.splice(existingIndex, 1);
        } else {
            post.likes.push(req.user._id);
        }

        await post.save();

        const refreshed = await Post.findById(post._id)
            .populate('authorId', 'name activeRole primaryRole')
            .lean();
        const postOwnerId = String(post.authorId || post.user || '');
        const isBountyPost = String(post.postType || post.type || '').toLowerCase() === 'bounty';

        setImmediate(() => {
            recordFeatureUsage({
                userId: req.user._id,
                featureKey: liked ? 'post_liked' : 'post_unliked',
                metadata: {
                    postId: String(post._id),
                },
            }).catch(() => {});
            recomputeUserNetworkScore({ userId: req.user._id }).catch(() => {});
            if (isBountyPost && liked && postOwnerId && postOwnerId !== userId) {
                queueNotificationDispatch({
                    userId: postOwnerId,
                    type: 'bounty_update',
                    title: 'Bounty engagement update',
                    message: 'Someone liked your bounty post.',
                    relatedData: {
                        postId: String(post._id),
                        actorId: userId,
                        action: 'like',
                    },
                    pushCategory: 'application_status',
                }).catch(() => {});
            }
        });

        await delByPattern('cache:feed:posts:*');
        res.json({
            post: mapPostForClient({
                ...refreshed,
                author: refreshed?.authorId,
            }),
            liked,
            likesCount: post.likes.length,
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to update like' });
    }
});

router.post('/posts/:id/comments', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid post id' });
        }
        const text = sanitizeText(req.body?.text || '', { maxLength: 5000 });
        if (!text) {
            return res.status(400).json({ message: 'Comment text is required' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        post.comments.push({
            user: req.user._id,
            text,
        });

        await post.save();

        const comment = post.comments[post.comments.length - 1];
        const refreshed = await Post.findById(post._id)
            .populate('authorId', 'name activeRole primaryRole')
            .lean();

        const postOwnerId = String(post.authorId || post.user || '');
        const actorId = String(req.user._id);
        const isBountyPost = String(post.postType || post.type || '').toLowerCase() === 'bounty';
        if (postOwnerId && postOwnerId !== actorId) {
            setImmediate(() => {
                createAndSendBehaviorNotification({
                    userId: postOwnerId,
                    title: 'New community reply',
                    message: 'Someone replied to your post.',
                    notificationType: 'community_reply',
                    pushEventType: 'promotions',
                    relatedData: {
                        postId: String(post._id),
                        commentId: String(comment?._id || ''),
                    },
                    dedupeKey: `community_reply:${postOwnerId}:${String(post._id)}:${actorId}`,
                    dedupeWindowHours: 1,
                }).catch(() => {});
                if (isBountyPost) {
                    queueNotificationDispatch({
                        userId: postOwnerId,
                        type: 'bounty_update',
                        title: 'Bounty comment update',
                        message: 'Someone commented on your bounty post.',
                        relatedData: {
                            postId: String(post._id),
                            commentId: String(comment?._id || ''),
                            actorId,
                            action: 'comment',
                        },
                        pushCategory: 'application_status',
                    }).catch(() => {});
                }
            });
        }

        setImmediate(() => {
            recordFeatureUsage({
                userId: req.user._id,
                featureKey: 'post_comment_created',
                metadata: {
                    postId: String(post._id),
                },
            }).catch(() => {});
            recomputeUserNetworkScore({ userId: req.user._id }).catch(() => {});
            if (postOwnerId && postOwnerId !== actorId) {
                recomputeUserNetworkScore({ userId: postOwnerId }).catch(() => {});
            }
        });

        await delByPattern('cache:feed:posts:*');
        res.status(201).json({
            post: mapPostForClient({
                ...refreshed,
                author: refreshed?.authorId,
            }),
            comment,
            commentsCount: post.comments.length,
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to add comment' });
    }
});

router.put('/posts/:id', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid post id' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const ownerId = String(post.authorId || post.user || '');
        if (ownerId !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the post owner can edit this post' });
        }

        const nextContent = sanitizeText(req.body?.content || '', { maxLength: 5000 });
        const hasContentUpdate = typeof req.body?.content !== 'undefined';
        if (hasContentUpdate && !nextContent) {
            return res.status(400).json({ message: 'content cannot be empty' });
        }

        const nextVisibility = String(req.body?.visibility || '').toLowerCase();
        if (hasContentUpdate) {
            post.content = nextContent;
        }
        if (nextVisibility) {
            if (!POST_VISIBILITY_VALUES.has(nextVisibility)) {
                return res.status(400).json({ message: 'Invalid visibility value' });
            }
            post.visibility = nextVisibility;
        }

        await post.save();
        const refreshed = await Post.findById(post._id)
            .populate('authorId', 'name activeRole primaryRole')
            .lean();
        await delByPattern('cache:feed:posts:*');
        return res.json({
            post: mapPostForClient({
                ...refreshed,
                author: refreshed?.authorId,
            }),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update post' });
    }
});

router.delete('/posts/:id', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid post id' });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        const ownerId = String(post.authorId || post.user || '');
        if (ownerId !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the post owner can delete this post' });
        }

        await Post.deleteOne({ _id: post._id });
        await delByPattern('cache:feed:posts:*');
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to delete post' });
    }
});

router.delete('/reset-connect', protect, async (req, res) => {
    try {
        const userObjectId = asObjectId(req.user?._id);
        if (!userObjectId) {
            return res.status(400).json({ success: false, message: 'Invalid user id' });
        }

        const requestedScope = String(req.query?.scope || req.body?.scope || 'self').trim().toLowerCase();
        const scope = requestedScope === 'all' ? 'all' : 'self';
        const isProduction = String(process.env.NODE_ENV || 'development').toLowerCase() === 'production';
        const allowGlobalReset = scope === 'all' && (Boolean(req.user?.isAdmin) || !isProduction);

        if (scope === 'all' && !allowGlobalReset) {
            return res.status(403).json({ success: false, message: 'Global connect reset is not allowed.' });
        }

        if (allowGlobalReset) {
            const [postsDeleted, bountiesDeleted, circlePostsDeleted, circlesDeleted, referralsDeleted] = await Promise.all([
                Post.deleteMany({}),
                Bounty.deleteMany({}),
                CirclePost.deleteMany({}),
                Circle.deleteMany({}),
                Referral.deleteMany({}),
            ]);

            await delByPattern('cache:feed:posts:*');
            return res.status(200).json({
                success: true,
                scope: 'all',
                deletedPosts: Number(postsDeleted?.deletedCount || 0),
                deletedBounties: Number(bountiesDeleted?.deletedCount || 0),
                deletedCirclePosts: Number(circlePostsDeleted?.deletedCount || 0),
                deletedCircles: Number(circlesDeleted?.deletedCount || 0),
                deletedReferrals: Number(referralsDeleted?.deletedCount || 0),
                message: 'All Connect data has been cleared.',
            });
        }

        const ownPostRows = await Post.find({
            $or: [
                { user: userObjectId },
                { authorId: userObjectId },
            ],
        }).select('_id').lean();
        const ownPostIds = ownPostRows
            .map((row) => asObjectId(row?._id))
            .filter(Boolean);

        const ownCircleRows = await Circle.find({ createdBy: userObjectId }).select('_id').lean();
        const ownCircleIds = ownCircleRows
            .map((row) => asObjectId(row?._id))
            .filter(Boolean);

        const [
            ownPostsDeleted,
            postEngagementCleanup,
            ownBountiesDeleted,
            bountySubmissionCleanup,
            bountyWinnerCleanup,
            ownCirclePostsDeleted,
            ownCirclesPostsDeleted,
            ownCirclesDeleted,
            circleMembershipCleanup,
            referralsDeleted,
        ] = await Promise.all([
            ownPostIds.length
                ? Post.deleteMany({ _id: { $in: ownPostIds } })
                : Promise.resolve({ deletedCount: 0 }),
            Post.updateMany({}, {
                $pull: {
                    likes: userObjectId,
                    vouches: userObjectId,
                    comments: { user: userObjectId },
                },
            }),
            Bounty.deleteMany({ creatorId: userObjectId }),
            Bounty.updateMany({}, {
                $pull: {
                    submissions: { userId: userObjectId },
                },
            }),
            Bounty.updateMany({ winnerId: userObjectId }, {
                $set: { winnerId: null },
            }),
            CirclePost.deleteMany({ user: userObjectId }),
            ownCircleIds.length
                ? CirclePost.deleteMany({ circle: { $in: ownCircleIds } })
                : Promise.resolve({ deletedCount: 0 }),
            ownCircleIds.length
                ? Circle.deleteMany({ _id: { $in: ownCircleIds } })
                : Promise.resolve({ deletedCount: 0 }),
            Circle.updateMany({}, {
                $pull: {
                    members: userObjectId,
                    memberIds: userObjectId,
                    adminIds: userObjectId,
                    joinRequests: { userId: userObjectId },
                    rates: { submittedBy: userObjectId },
                },
            }),
            Referral.deleteMany({
                $or: [
                    { referrerId: userObjectId },
                    { referrer: userObjectId },
                    { referredUserId: userObjectId },
                ],
            }),
        ]);

        await delByPattern('cache:feed:posts:*');
        return res.status(200).json({
            success: true,
            scope: 'self',
            deletedPosts: Number(ownPostsDeleted?.deletedCount || 0),
            cleanedPostReactions: Number(postEngagementCleanup?.modifiedCount || 0),
            deletedBounties: Number(ownBountiesDeleted?.deletedCount || 0),
            cleanedBountySubmissions: Number(bountySubmissionCleanup?.modifiedCount || 0),
            cleanedBountyWinners: Number(bountyWinnerCleanup?.modifiedCount || 0),
            deletedCirclePosts: Number(ownCirclePostsDeleted?.deletedCount || 0) + Number(ownCirclesPostsDeleted?.deletedCount || 0),
            deletedCircles: Number(ownCirclesDeleted?.deletedCount || 0),
            cleanedCircleMemberships: Number(circleMembershipCleanup?.modifiedCount || 0),
            deletedReferrals: Number(referralsDeleted?.deletedCount || 0),
            message: 'Your Connect history has been cleared.',
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to clear Connect history' });
    }
});

router.post('/posts/:id/vouch', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid post id' });
        }
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ success: false });
        }

        if (!Array.isArray(post.vouches)) {
            post.vouches = [];
        }

        const userId = String(req.user._id);
        const index = post.vouches.findIndex((id) => String(id) === userId);
        const vouched = index === -1;
        if (vouched) {
            post.vouches.push(req.user._id);
        } else {
            post.vouches.splice(index, 1);
        }

        await post.save();
        const refreshed = await Post.findById(post._id)
            .populate('authorId', 'name activeRole primaryRole')
            .lean();

        setImmediate(() => {
            recordFeatureUsage({
                userId: req.user._id,
                featureKey: vouched ? 'post_vouch_added' : 'post_vouch_removed',
                metadata: {
                    postId: String(post._id),
                },
            }).catch(() => {});
            recomputeUserNetworkScore({ userId: req.user._id }).catch(() => {});
        });

        await delByPattern('cache:feed:posts:*');
        return res.json({
            success: true,
            post: mapPostForClient({
                ...refreshed,
                author: refreshed?.authorId,
            }),
            vouched,
            vouchCount: post.vouches.length,
        });
    } catch (error) {
        return res.status(500).json({ success: false });
    }
});

module.exports = router;
