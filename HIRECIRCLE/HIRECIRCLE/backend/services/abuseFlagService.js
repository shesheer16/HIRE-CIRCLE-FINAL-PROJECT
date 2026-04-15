'use strict';
/**
 * abuseFlagService.js
 * Feature #95 — Report Abuse / Block User
 *
 * Handles:
 * - User-submitted abuse reports (against another user/job/message)
 * - User blocking (bidirectional visibility suppression)
 * - Rate limiting: max 10 reports per user per day
 */
const mongoose = require('mongoose');
const AbuseSignal = require('../models/AbuseSignal');

const ABUSE_TYPES = [
    'harassment',
    'fake_job',
    'scam',
    'discrimination',
    'spam',
    'inappropriate_content',
    'impersonation',
    'other',
];

const BLOCKABLE_TYPES = ['user', 'employer'];

/**
 * Submit an abuse report
 */
async function reportAbuse({
    reporterId,
    targetType,     // 'user' | 'job' | 'message' | 'employer'
    targetId,
    abuseType,
    description = '',
}) {
    if (!ABUSE_TYPES.includes(abuseType)) {
        throw Object.assign(
            new Error(`Invalid abuse type. Allowed: ${ABUSE_TYPES.join(', ')}`),
            { code: 400 }
        );
    }
    if (!targetType || !targetId) {
        throw Object.assign(new Error('targetType and targetId required'), { code: 400 });
    }
    if (description.length > 2000) {
        throw Object.assign(new Error('Description too long (max 2000 chars)'), { code: 400 });
    }

    // Rate limit: max 10 reports per day per reporter
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayCount = await AbuseSignal.countDocuments({
        reporterId,
        createdAt: { $gte: dayStart },
    });
    if (todayCount >= 10) {
        throw Object.assign(new Error('Daily report limit reached (10/day)'), { code: 429 });
    }

    const signal = await AbuseSignal.create({
        reporterId,
        targetType,
        targetId,
        abuseType,
        description: description.trim(),
        status: 'pending',
    });

    return { reported: true, signalId: signal._id };
}

/**
 * Block a user or employer (suppresses them from all feed/matches/messages)
 * Stored as a special AbuseSignal with abuseType='block'
 */
async function blockUser(blockerId, targetUserId) {
    if (String(blockerId) === String(targetUserId)) {
        throw Object.assign(new Error('Cannot block yourself'), { code: 400 });
    }

    try {
        const signal = await AbuseSignal.create({
            reporterId: blockerId,
            targetType: 'user',
            targetId: targetUserId,
            abuseType: 'other',
            description: '__block__',
            status: 'blocked',
        });
        return { blocked: true, signalId: signal._id };
    } catch (err) {
        if (err.code === 11000) return { blocked: true, alreadyBlocked: true };
        throw err;
    }
}

/**
 * Unblock a user
 */
async function unblockUser(blockerId, targetUserId) {
    const result = await AbuseSignal.deleteOne({
        reporterId: blockerId,
        targetId: targetUserId,
        status: 'blocked',
    });
    return { unblocked: result.deletedCount > 0 };
}

/**
 * Get list of users this person has blocked
 */
async function getBlockList(userId) {
    return AbuseSignal.find({ reporterId: userId, status: 'blocked' })
        .select('targetId createdAt')
        .lean();
}

/**
 * Check if user A has blocked user B
 */
async function isBlocked(blockerId, targetUserId) {
    const found = await AbuseSignal.exists({
        reporterId: blockerId,
        targetId: targetUserId,
        status: 'blocked',
    });
    return { isBlocked: !!found };
}

module.exports = {
    reportAbuse,
    blockUser,
    unblockUser,
    getBlockList,
    isBlocked,
    ABUSE_TYPES,
};
