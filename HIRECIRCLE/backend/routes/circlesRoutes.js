const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { communityCreateLimiter } = require('../middleware/rateLimiters');
const { trustGuard } = require('../middleware/trustGuardMiddleware');
const { requireFeatureFlag } = require('../middleware/featureFlagMiddleware');
const Circle = require('../models/Circle');
const CirclePost = require('../models/CirclePost');
const CommunityTrustScore = require('../models/CommunityTrustScore');
const { communityCreateSchema } = require('../schemas/requestSchemas');
const Post = require('../models/Post');
const User = require('../models/userModel');
const { computeCommunityTrustScore } = require('../services/communityTrustService');
const { recordTrustEdge } = require('../services/trustGraphService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { sanitizeText } = require('../utils/sanitizeText');
const logger = require('../utils/logger');

const COMMUNITY_PRIVACY_VALUES = new Set(['public', 'request_only', 'private']);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());
router.use(requireFeatureFlag('COMMUNITIES', {
    fallback: true,
    message: 'Communities are disabled by admin',
}));

const asId = (value) => String(value || '').trim();
const isMember = (circle, userId) => {
    const safeUserId = asId(userId);
    const members = Array.isArray(circle?.memberIds) ? circle.memberIds : (Array.isArray(circle?.members) ? circle.members : []);
    return members.some((memberId) => asId(memberId) === safeUserId);
};
const isAdmin = (circle, userId) => {
    const safeUserId = asId(userId);
    const admins = Array.isArray(circle?.adminIds) ? circle.adminIds : [];
    if (admins.some((adminId) => asId(adminId) === safeUserId)) return true;
    return asId(circle?.createdBy) === safeUserId;
};

const normalizeCircleRates = (rates = []) => (
    (Array.isArray(rates) ? rates : [])
        .filter((rate) => rate && typeof rate === 'object')
        .map((rate, index) => ({
            id: asId(rate?._id || `rate-${index}`),
            service: sanitizeText(String(rate?.service || ''), { maxLength: 80 }),
            price: sanitizeText(String(rate?.price || ''), { maxLength: 40 }),
            submittedBy: asId(rate?.submittedBy || ''),
            createdAt: rate?.createdAt || null,
        }))
        .filter((rate) => rate.service && rate.price)
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
        .slice(0, 40)
);

const normalizeCircle = (circle = {}) => ({
    _id: circle._id,
    name: circle.name,
    description: circle.description || '',
    category: circle.category || circle.skill || 'general',
    adminIds: Array.isArray(circle.adminIds) ? circle.adminIds : [circle.createdBy].filter(Boolean),
    memberIds: Array.isArray(circle.memberIds) && circle.memberIds.length > 0 ? circle.memberIds : (circle.members || []),
    memberCount: Array.isArray(circle.memberIds) && circle.memberIds.length > 0
        ? circle.memberIds.length
        : (Array.isArray(circle.members) ? circle.members.length : 0),
    privacy: circle.privacy || (circle.isPrivate ? 'private' : 'public'),
    isPrivate: Boolean(circle.isPrivate),
    rates: normalizeCircleRates(circle.rates),
    communityTrustScore: Number(circle.communityTrustScore || 50),
    createdAt: circle.createdAt,
    updatedAt: circle.updatedAt,
});

const normalizeCircleForViewer = (circle = {}, userId) => {
    const safeCircle = normalizeCircle(circle);
    const creator = asId(circle?.createdBy) === asId(userId);
    const admin = isAdmin(circle, userId);
    const pendingJoinRequest = Array.isArray(circle?.joinRequests)
        ? circle.joinRequests.find((request) => (
            asId(request?.userId) === asId(userId)
            && String(request?.status || '').toLowerCase() === 'pending'
        ))
        : null;

    return {
        ...safeCircle,
        isJoined: isMember(circle, userId),
        isAdmin: admin,
        isCreator: creator,
        canDelete: creator || admin,
        joinRequestPending: Boolean(pendingJoinRequest),
    };
};

const withCommunityTrustScore = async (circles = []) => {
    if (!Array.isArray(circles) || !circles.length) return [];
    const ids = circles.map((circle) => circle._id);
    const scoreRows = await CommunityTrustScore.find({
        circleId: { $in: ids },
    })
        .select('circleId communityTrustScore')
        .lean();

    const scoreMap = new Map(
        scoreRows.map((row) => [asId(row.circleId), Number(row.communityTrustScore || 50)])
    );

    return circles
        .map((circle) => ({
            ...circle,
            communityTrustScore: scoreMap.has(asId(circle._id))
                ? scoreMap.get(asId(circle._id))
                : 50,
        }))
        .sort((left, right) => {
            const trustDiff = Number(right.communityTrustScore || 0) - Number(left.communityTrustScore || 0);
            if (trustDiff !== 0) return trustDiff;
            return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
        });
};

const getCommunityFeedHandler = async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id).lean();
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }

        const privacy = String(circle.privacy || (circle.isPrivate ? 'private' : 'public')).toLowerCase();
        if (privacy !== 'public' && !isMember(circle, req.user._id) && !isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Join this community to view feed' });
        }

        const posts = await CirclePost.find({ circle: req.params.id })
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('user', 'name primaryRole activeRole')
            .lean();

        return res.json({ posts });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load community feed' });
    }
};

router.get('/', protect, async (req, res) => {
    try {
        const category = String(req.query.category || '').trim().toLowerCase();
        const query = {};
        if (category) {
            query.category = category;
        }

        const circles = await Circle.find(query)
            .sort({ createdAt: -1 })
            .lean();
        const ranked = await withCommunityTrustScore(circles);
        res.json({ circles: ranked.map((circle) => normalizeCircleForViewer(circle, req.user._id)) });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load communities' });
    }
});

router.get('/my', protect, async (req, res) => {
    try {
        const circles = await Circle.find({
            $or: [
                { memberIds: req.user._id },
                { members: req.user._id },
            ],
        })
            .sort({ createdAt: -1 })
            .lean();
        const ranked = await withCommunityTrustScore(circles);
        res.json({ circles: ranked.map((circle) => normalizeCircleForViewer(circle, req.user._id)) });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load joined communities' });
    }
});

router.get('/:id', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circles = await withCommunityTrustScore(
            await Circle.find({ _id: req.params.id }).lean()
        );
        const circle = circles[0];
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }

        const privacy = String(circle.privacy || (circle.isPrivate ? 'private' : 'public')).toLowerCase();
        const member = isMember(circle, req.user._id);
        if (privacy !== 'public' && !member && !isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Join this community to view details' });
        }

        return res.json({
            community: normalizeCircleForViewer(circle, req.user._id),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load community details' });
    }
});

router.post('/', protect, trustGuard('community_create'), communityCreateLimiter, validate({ body: communityCreateSchema }), async (req, res) => {
    try {
        const {
            name,
            description = '',
            category = '',
            skill = '',
            privacy = 'public',
            isPrivate = false,
            avatar = '',
            location = '',
        } = req.body || {};
        const normalizedName = String(name || '').trim();
        if (!normalizedName) {
            return res.status(400).json({ message: 'Community name is required' });
        }

        const requestedPrivacy = isPrivate ? 'private' : privacy;
        const normalizedPrivacy = COMMUNITY_PRIVACY_VALUES.has(String(requestedPrivacy || '').toLowerCase())
            ? String(requestedPrivacy).toLowerCase()
            : 'public';

        const created = await Circle.create({
            name: sanitizeText(normalizedName, { maxLength: 80 }),
            description: sanitizeText(description || '', { maxLength: 2000 }),
            category: sanitizeText(String(category || skill || 'general').trim().toLowerCase() || 'general', { maxLength: 80 }),
            skill: sanitizeText(String(skill || category || '').trim(), { maxLength: 80 }),
            location: sanitizeText(String(location || '').trim(), { maxLength: 120 }),
            privacy: normalizedPrivacy,
            isPrivate: normalizedPrivacy === 'private',
            avatar: sanitizeText(String(avatar || '').trim(), { maxLength: 500 }),
            createdBy: req.user._id,
            adminIds: [req.user._id],
            memberIds: [req.user._id],
            members: [req.user._id],
        });

        await Promise.resolve(Post.create({
            user: req.user._id,
            authorId: req.user._id,
            postType: 'community',
            type: 'community',
            visibility: 'public',
            content: `Created community: ${created.name}`,
            media: [],
            mediaUrl: '',
            trustWeight: Number(req.user?.isVerified ? 0.2 : 0) + Number(req.user?.hasCompletedProfile ? 0.1 : 0),
            meta: {
                communityId: String(created._id),
                category: created.category || 'general',
            },
        })).catch(() => {});

        res.status(201).json({
            community: normalizeCircle(created.toObject()),
        });

        Promise.resolve(computeCommunityTrustScore({ circleId: created._id, upsert: true })).catch(() => null);
    } catch (error) {
        logger.warn({
            event: 'community_create_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        if (error?.name === 'ValidationError' || error?.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid community payload' });
        }
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ message: 'Community already exists' });
        }
        return res.status(500).json({ message: 'Failed to create community' });
    }
});

router.post('/:id/join', protect, trustGuard('community_join'), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }

        if (isMember(circle, req.user._id)) {
            return res.json({
                joined: true,
                pendingApproval: false,
                memberCount: Array.isArray(circle.memberIds) ? circle.memberIds.length : 0,
            });
        }

        const privacy = String(circle.privacy || (circle.isPrivate ? 'private' : 'public')).toLowerCase();
        if (privacy === 'public') {
            circle.memberIds = Array.from(new Set([...(circle.memberIds || []), req.user._id]));
            circle.members = Array.from(new Set([...(circle.members || []), req.user._id]));
            await circle.save();
            Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);
            return res.json({
                joined: true,
                pendingApproval: false,
                memberCount: Array.isArray(circle.memberIds) ? circle.memberIds.length : 0,
            });
        }

        const existingPending = Array.isArray(circle.joinRequests)
            ? circle.joinRequests.find((request) => asId(request.userId) === asId(req.user._id) && request.status === 'pending')
            : null;

        if (!existingPending) {
            circle.joinRequests = [
                ...(Array.isArray(circle.joinRequests) ? circle.joinRequests : []),
                {
                    userId: req.user._id,
                    status: 'pending',
                    requestedAt: new Date(),
                },
            ];
            await circle.save();
            Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);
        }

        return res.status(202).json({
            joined: false,
            pendingApproval: true,
            message: 'Join request submitted for moderation.',
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to process join request' });
    }
});

router.post('/:id/requests/:requestId', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.requestId)) {
            return res.status(400).json({ message: 'Invalid community request id' });
        }
        const action = String(req.body?.action || '').trim().toLowerCase();
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ message: 'action must be approve or reject' });
        }

        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Only community admins can manage join requests' });
        }

        const request = (circle.joinRequests || []).id(req.params.requestId);
        if (!request) {
            return res.status(404).json({ message: 'Join request not found' });
        }

        request.status = action === 'approve' ? 'approved' : 'rejected';
        request.reviewedAt = new Date();
        if (action === 'approve') {
            circle.memberIds = Array.from(new Set([...(circle.memberIds || []), request.userId]));
            circle.members = Array.from(new Set([...(circle.members || []), request.userId]));
        }
        await circle.save();
        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);

        const requestedUserId = String(request.userId || '').trim();
        if (requestedUserId) {
            queueNotificationDispatch({
                userId: requestedUserId,
                type: action === 'approve' ? 'community_invite' : 'status_update',
                title: action === 'approve' ? 'Community request approved' : 'Community request declined',
                message: action === 'approve'
                    ? `You can now join ${String(circle.name || 'this community')}.`
                    : `Your request to join ${String(circle.name || 'this community')} was declined.`,
                relatedData: {
                    communityId: String(circle._id),
                    action,
                },
                pushCategory: 'application_status',
            }).catch(() => {});
        }

        return res.json({
            success: true,
            requestId: request._id,
            status: request.status,
            memberCount: Array.isArray(circle.memberIds) ? circle.memberIds.length : 0,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update join request' });
    }
});

router.post('/:id/leave', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isMember(circle, req.user._id)) {
            return res.status(400).json({ message: 'You are not a member of this community' });
        }

        circle.memberIds = (circle.memberIds || []).filter((memberId) => asId(memberId) !== asId(req.user._id));
        circle.members = (circle.members || []).filter((memberId) => asId(memberId) !== asId(req.user._id));
        circle.adminIds = (circle.adminIds || []).filter((adminId) => asId(adminId) !== asId(req.user._id));

        if (!circle.adminIds.length && circle.memberIds.length > 0) {
            circle.adminIds = [circle.memberIds[0]];
        }

        await circle.save();
        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);
        return res.json({
            left: true,
            memberCount: Array.isArray(circle.memberIds) ? circle.memberIds.length : 0,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to leave community' });
    }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }

        const circle = await Circle.findById(req.params.id).lean();
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }

        const requesterId = asId(req.user?._id);
        const isCreator = asId(circle?.createdBy) === requesterId;
        const hasAdminAccess = isAdmin(circle, req.user?._id);
        if (!isCreator && !hasAdminAccess) {
            return res.status(403).json({ message: 'Only community creator/admin can delete this community' });
        }

        const circleId = circle._id;
        const circleIdText = asId(circleId);

        const [circlePostsDeleted, trustRowsDeleted, feedPostsDeleted, circleDeleted] = await Promise.all([
            CirclePost.deleteMany({ circle: circleId }),
            CommunityTrustScore.deleteMany({ circleId }),
            Post.deleteMany({
                $or: [
                    { 'meta.communityId': circleIdText },
                    { 'meta.communityId': circleId },
                    { 'meta.circleId': circleIdText },
                    { 'meta.circleId': circleId },
                    { communityId: circleId },
                ],
            }),
            Circle.deleteOne({ _id: circleId }),
        ]);

        if (!Number(circleDeleted?.deletedCount || 0)) {
            return res.status(404).json({ message: 'Community not found' });
        }

        return res.json({
            success: true,
            deleted: {
                community: 1,
                circlePosts: Number(circlePostsDeleted?.deletedCount || 0),
                trustRows: Number(trustRowsDeleted?.deletedCount || 0),
                feedPosts: Number(feedPostsDeleted?.deletedCount || 0),
            },
        });
    } catch (error) {
        logger.warn({
            event: 'community_delete_failed',
            message: error?.message || 'unknown error',
            userId: asId(req.user?._id),
            communityId: asId(req.params?.id),
        });
        return res.status(500).json({ message: 'Failed to delete community' });
    }
});

router.get('/:id/members', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id).lean();
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        const privacy = String(circle.privacy || (circle.isPrivate ? 'private' : 'public')).toLowerCase();
        if (privacy !== 'public' && !isMember(circle, req.user._id) && !isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Join this community to view members' });
        }

        const memberIds = Array.isArray(circle.memberIds) ? circle.memberIds : [];
        const admins = new Set((Array.isArray(circle.adminIds) ? circle.adminIds : []).map((id) => asId(id)));
        const users = await User.find({ _id: { $in: memberIds } })
            .select('_id name activeRole primaryRole')
            .lean();
        const members = users.map((user) => ({
            _id: user._id,
            name: user.name || 'Member',
            role: String(user.activeRole || user.primaryRole || 'worker'),
            isAdmin: admins.has(asId(user._id)),
        }));
        return res.json({
            members,
            memberCount: memberIds.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load community members' });
    }
});

router.post('/:id/rates', protect, trustGuard('community_post'), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isMember(circle, req.user._id)) {
            return res.status(403).json({ message: 'Join this community before suggesting rates' });
        }

        const service = sanitizeText(String(req.body?.service || ''), { maxLength: 80 });
        const price = sanitizeText(String(req.body?.price || ''), { maxLength: 40 });
        if (!service || !price) {
            return res.status(400).json({ message: 'service and price are required' });
        }

        const nextRates = Array.isArray(circle.rates) ? [...circle.rates] : [];
        nextRates.unshift({
            service,
            price,
            submittedBy: req.user._id,
            createdAt: new Date(),
        });
        circle.rates = nextRates.slice(0, 120);
        await circle.save();

        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);

        return res.status(201).json({
            success: true,
            rates: normalizeCircleRates(circle.rates),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to submit community rate' });
    }
});

router.get('/:id/moderation', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id).lean();
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Only community admins can view moderation queue' });
        }

        const moderationQueue = Array.isArray(circle.moderationQueue)
            ? circle.moderationQueue.filter((item) => item.status === 'pending')
            : [];
        return res.json({ moderationQueue });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load moderation queue' });
    }
});

router.post('/:id/moderation/report', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isMember(circle, req.user._id)) {
            return res.status(403).json({ message: 'Only community members can report content' });
        }

        const targetId = String(req.body?.targetId || '').trim();
        if (!targetId) {
            return res.status(400).json({ message: 'targetId is required' });
        }

        circle.moderationQueue = [
            ...(Array.isArray(circle.moderationQueue) ? circle.moderationQueue : []),
            {
                targetType: String(req.body?.targetType || 'post'),
                targetId: sanitizeText(targetId, { maxLength: 120 }),
                reason: sanitizeText(req.body?.reason || '', { maxLength: 500 }),
                reportedBy: req.user._id,
                status: 'pending',
                createdAt: new Date(),
            },
        ];
        await circle.save();
        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);

        return res.status(201).json({
            success: true,
            message: 'Reported to moderation queue.',
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to report moderation item' });
    }
});

router.post('/:id/moderation/:queueId/resolve', protect, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id) || !isValidObjectId(req.params.queueId)) {
            return res.status(400).json({ message: 'Invalid moderation id' });
        }
        const action = String(req.body?.action || '').trim().toLowerCase();
        if (!['resolve', 'dismiss'].includes(action)) {
            return res.status(400).json({ message: 'action must be resolve or dismiss' });
        }

        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isAdmin(circle, req.user._id)) {
            return res.status(403).json({ message: 'Only community admins can resolve moderation items' });
        }

        const item = (circle.moderationQueue || []).id(req.params.queueId);
        if (!item) {
            return res.status(404).json({ message: 'Moderation item not found' });
        }

        item.status = action === 'resolve' ? 'resolved' : 'dismissed';
        item.resolvedAt = new Date();
        item.moderatorId = req.user._id;
        await circle.save();
        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);

        return res.json({
            success: true,
            queueId: item._id,
            status: item.status,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to resolve moderation item' });
    }
});

router.get('/:id/posts', protect, getCommunityFeedHandler);
router.get('/:id/feed', protect, getCommunityFeedHandler);

router.post('/:id/posts', protect, trustGuard('community_post'), async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid community id' });
        }
        const circle = await Circle.findById(req.params.id);
        if (!circle) {
            return res.status(404).json({ message: 'Community not found' });
        }
        if (!isMember(circle, req.user._id)) {
            return res.status(403).json({ message: 'Join this community before posting' });
        }

        const text = sanitizeText(req.body?.text || '', { maxLength: 5000 });
        if (!text) {
            return res.status(400).json({ message: 'Post text is required' });
        }

        const post = await CirclePost.create({
            circle: circle._id,
            user: req.user._id,
            text,
        });

        const populated = await CirclePost.findById(post._id).populate('user', 'name primaryRole activeRole').lean();
        await recordTrustEdge({
            fromUserId: req.user._id,
            toUserId: circle.createdBy,
            edgeType: 'community_interaction',
            weight: 42,
            qualityScore: 8,
            negative: false,
            referenceType: 'circle_post',
            referenceId: String(post._id),
            metadata: {
                circleId: String(circle._id),
            },
        }).catch(() => null);
        Promise.resolve(computeCommunityTrustScore({ circleId: circle._id, upsert: true })).catch(() => null);
        res.status(201).json({ post: populated });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create community post' });
    }
});

module.exports = router;
