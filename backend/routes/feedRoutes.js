const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { trustGuard } = require('../middleware/trustGuardMiddleware');
const Post = require('../models/Post');
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
