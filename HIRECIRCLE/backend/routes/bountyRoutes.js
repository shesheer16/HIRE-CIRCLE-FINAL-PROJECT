const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const Bounty = require('../models/Bounty');
const Post = require('../models/Post');
const { bountyCreateSchema } = require('../schemas/requestSchemas');
const { isRegionFeatureEnabled } = require('../services/regionFeatureFlagService');
const { resolveUserRoleContract, normalizeActiveRole } = require('../utils/userRoleContract');
const { sanitizeText } = require('../utils/sanitizeText');
const logger = require('../utils/logger');

const MAX_LIMIT = 30;
const STATUS_ORDER = {
    open: 0,
    reviewing: 1,
    completed: 2,
    expired: 3,
};
const ALLOWED_TRANSITIONS = {
    open: new Set(['reviewing', 'completed', 'expired']),
    reviewing: new Set(['completed', 'expired']),
    completed: new Set(),
    expired: new Set(),
};
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());

const sanitizeLimit = (value, fallback = 20) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(MAX_LIMIT, parsed);
};

const sanitizePage = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 1;
    return parsed;
};

const normalizeStatus = (value, fallback = 'open') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(STATUS_ORDER, normalized)) return normalized;
    return fallback;
};

const toBountyDto = (bounty = {}) => ({
    _id: bounty._id,
    creatorId: bounty?.creatorId?._id || bounty.creatorId,
    creatorName: bounty?.creatorId?.name || null,
    title: bounty.title,
    description: bounty.description || '',
    reward: Number(bounty.reward || 0),
    deadline: bounty.deadline,
    submissions: Array.isArray(bounty.submissions) ? bounty.submissions : [],
    winnerId: bounty.winnerId || null,
    status: normalizeStatus(bounty.status),
    chatRoomId: `bounty_${String(bounty._id || '')}`,
    createdAt: bounty.createdAt,
    updatedAt: bounty.updatedAt,
});

const ensureBountyFeatureEnabled = async (req, res, next) => {
    try {
        const enabled = await isRegionFeatureEnabled({
            key: 'FEATURE_BOUNTIES',
            user: req.user,
            fallback: true,
        });
        if (!enabled) {
            return res.status(403).json({ message: 'Bounties are not enabled in your region' });
        }
        return next();
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to evaluate regional feature policy' });
    }
};

router.get('/', protect, ensureBountyFeatureEnabled, async (req, res) => {
    try {
        const page = sanitizePage(req.query.page);
        const limit = sanitizeLimit(req.query.limit, 20);
        const status = String(req.query.status || '').trim().toLowerCase();

        const query = {};
        if (status && Object.prototype.hasOwnProperty.call(STATUS_ORDER, status)) {
            query.status = status;
        }

        const rows = await Bounty.find(query)
            .sort({ createdAt: -1, _id: 1 })
            .populate('creatorId', 'name')
            .lean();

        rows.sort((left, right) => {
            const leftOrder = STATUS_ORDER[normalizeStatus(left.status)];
            const rightOrder = STATUS_ORDER[normalizeStatus(right.status)];
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;

            const leftEpoch = new Date(left.createdAt || 0).getTime();
            const rightEpoch = new Date(right.createdAt || 0).getTime();
            if (rightEpoch !== leftEpoch) return rightEpoch - leftEpoch;

            return String(left._id).localeCompare(String(right._id));
        });

        const start = (page - 1) * limit;
        const end = start + limit;
        const paged = rows.slice(start, end);

        return res.json({
            bounties: paged.map(toBountyDto),
            page,
            limit,
            total: rows.length,
            hasMore: end < rows.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load bounties' });
    }
});

router.get('/mine', protect, ensureBountyFeatureEnabled, async (req, res) => {
    try {
        const userId = String(req.user?._id || '');
        const bounties = await Bounty.find({
            $or: [
                { creatorId: req.user._id },
                { 'submissions.userId': req.user._id },
                { winnerId: req.user._id },
            ],
        })
            .sort({ createdAt: -1 })
            .populate('creatorId', 'name')
            .lean();

        return res.json({
            bounties: bounties
                .map(toBountyDto)
                .map((item) => ({
                    ...item,
                    isCreator: String(item.creatorId || '') === userId,
                    isWinner: String(item.winnerId || '') === userId,
                })),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load user bounties' });
    }
});

router.post('/', protect, ensureBountyFeatureEnabled, validate({ body: bountyCreateSchema }), async (req, res) => {
    try {
        const roleContract = resolveUserRoleContract(req.user || {});
        const activeRole = normalizeActiveRole(roleContract?.activeRole || req.user?.activeRole || req.user?.role, 'worker');
        const canCreateBounty = activeRole === 'employer'
            ? true
            : Boolean(roleContract?.capabilities?.canCreateBounty);
        if (!canCreateBounty) {
            return res.status(403).json({ message: 'Current active role cannot create bounties' });
        }

        const title = sanitizeText(req.body?.title || '', { maxLength: 120 });
        const description = sanitizeText(req.body?.description || '', { maxLength: 2000 });
        const reward = Number(req.body?.reward || 0);
        const deadline = new Date(req.body?.deadline);

        if (!title) return res.status(400).json({ message: 'title is required' });
        if (!Number.isFinite(reward) || reward <= 0) {
            return res.status(400).json({ message: 'reward must be a positive number' });
        }
        if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
            return res.status(400).json({ message: 'deadline must be a future date' });
        }

        const bounty = await Bounty.create({
            creatorId: req.user._id,
            title,
            description,
            reward,
            deadline,
            status: 'open',
        });

        await Promise.resolve(Post.create({
            user: req.user._id,
            authorId: req.user._id,
            postType: 'bounty',
            type: 'bounty',
            visibility: 'public',
            content: `Bounty: ${title} · Reward ${Math.round(reward).toLocaleString()} ${String(req.user?.currencyCode || 'INR').toUpperCase()}`,
            media: [],
            mediaUrl: '',
            trustWeight: Number(req.user?.isVerified ? 0.2 : 0) + Number(req.user?.hasCompletedProfile ? 0.1 : 0),
            meta: {
                bountyId: String(bounty._id),
            },
        })).catch(() => {});

        return res.status(201).json({
            bounty: toBountyDto(bounty.toObject()),
        });
    } catch (error) {
        logger.warn({
            event: 'bounty_create_failed',
            message: error?.message || 'unknown error',
            userId: String(req.user?._id || ''),
        });
        if (error?.name === 'ValidationError' || error?.name === 'CastError') {
            return res.status(400).json({ message: 'Invalid bounty payload' });
        }
        if (Number(error?.code) === 11000) {
            return res.status(409).json({ message: 'Duplicate bounty' });
        }
        return res.status(500).json({ message: 'Failed to create bounty' });
    }
});

router.post('/:id/submit', protect, ensureBountyFeatureEnabled, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid bounty id' });
        }
        const bounty = await Bounty.findById(req.params.id);
        if (!bounty) {
            return res.status(404).json({ message: 'Bounty not found' });
        }

        if (!['open', 'reviewing'].includes(normalizeStatus(bounty.status))) {
            return res.status(400).json({ message: 'Bounty is not accepting submissions' });
        }

        const existingSubmission = (bounty.submissions || []).find(
            (item) => String(item.userId) === String(req.user._id)
        );
        if (existingSubmission) {
            return res.status(409).json({ message: 'Submission already exists for this bounty' });
        }

        bounty.submissions.push({
            userId: req.user._id,
            message: sanitizeText(req.body?.message || '', { maxLength: 2000 }),
            attachmentUrl: sanitizeText(req.body?.attachmentUrl || '', { maxLength: 1200 }),
            submittedAt: new Date(),
        });
        await bounty.save();

        return res.status(201).json({
            bounty: toBountyDto(bounty.toObject()),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to submit bounty entry' });
    }
});

router.put('/:id/status', protect, ensureBountyFeatureEnabled, async (req, res) => {
    try {
        if (!isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: 'Invalid bounty id' });
        }
        const bounty = await Bounty.findById(req.params.id);
        if (!bounty) {
            return res.status(404).json({ message: 'Bounty not found' });
        }

        if (String(bounty.creatorId) !== String(req.user._id)) {
            return res.status(403).json({ message: 'Only the bounty creator can update status' });
        }

        const currentStatus = normalizeStatus(bounty.status);
        const targetStatus = normalizeStatus(req.body?.status, currentStatus);
        if (targetStatus === currentStatus) {
            return res.json({ bounty: toBountyDto(bounty.toObject()) });
        }

        if (!ALLOWED_TRANSITIONS[currentStatus].has(targetStatus)) {
            return res.status(400).json({ message: `Invalid status transition: ${currentStatus} -> ${targetStatus}` });
        }

        if (targetStatus === 'completed') {
            const winnerId = String(req.body?.winnerId || '').trim();
            if (!winnerId) {
                return res.status(400).json({ message: 'winnerId is required when completing bounty' });
            }
            const hasWinnerSubmission = (bounty.submissions || []).some((item) => String(item.userId) === winnerId);
            if (!hasWinnerSubmission) {
                return res.status(400).json({ message: 'winnerId must reference an existing submission' });
            }
            bounty.winnerId = winnerId;
        }

        bounty.status = targetStatus;
        await bounty.save();

        return res.json({
            bounty: toBountyDto(bounty.toObject()),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to update bounty status' });
    }
});

module.exports = router;
