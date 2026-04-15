const Notification = require('../models/Notification');
const User = require('../models/userModel');
const mongoose = require('mongoose');
const { getSocketIoServer } = require('../services/sessionService');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

const toPositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || '').trim());

const emitNotificationSocketEvents = ({ userId, notification, unreadCount = null }) => {
    try {
        const safeUserId = String(userId || '').trim();
        if (!safeUserId) return;
        const io = getSocketIoServer();
        if (!io) return;

        const payload = {
            notification,
            unreadCount: Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : undefined,
        };
        io.to(`user_${safeUserId}`).emit('notification_created', payload);
        io.to(`user_${safeUserId}`).emit('NOTIFICATION_CREATED', payload);
    } catch (_error) {
        // Non-blocking emit path.
    }
};

const emitNotificationReadSocketEvents = ({ userId, notificationId = null, unreadCount = null, all = false }) => {
    try {
        const safeUserId = String(userId || '').trim();
        if (!safeUserId) return;
        const io = getSocketIoServer();
        if (!io) return;

        const payload = {
            notificationId: notificationId ? String(notificationId) : null,
            unreadCount: Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : undefined,
            all: Boolean(all),
        };
        io.to(`user_${safeUserId}`).emit('notification_read', payload);
        io.to(`user_${safeUserId}`).emit('NOTIFICATION_READ', payload);
    } catch (_error) {
        // Non-blocking emit path.
    }
};

// @desc Get all notifications for logged in user
// @route GET /api/notifications
const getMyNotifications = async (req, res) => {
    try {
        const page = toPositiveInt(req.query.page, 1);
        const requestedLimit = toPositiveInt(req.query.limit, DEFAULT_PAGE_SIZE);
        const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
        const startIndex = (page - 1) * limit;

        const notifications = await Notification.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit)
            .lean();

        const total = await Notification.countDocuments({ user: req.user._id });
        const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });

        res.json({
            notifications,
            total,
            unreadCount,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.warn("Fetch Notifications Error:", error);
        res.status(500).json({ message: "Failed to load notifications" });
    }
};

// @desc Mark a single notification as read
// @route PUT /api/notifications/:id/read
const markNotificationRead = async (req, res) => {
    try {
        const notificationId = String(req.params.id || '').trim();
        if (!isValidObjectId(notificationId)) {
            return res.status(400).json({ message: 'Invalid notification id' });
        }

        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, user: req.user._id },
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        const unreadCount = await Notification.countDocuments({ user: req.user._id, isRead: false });
        emitNotificationReadSocketEvents({
            userId: req.user._id,
            notificationId,
            unreadCount,
            all: false,
        });

        res.json({
            notification,
            unreadCount,
        });
    } catch (error) {
        console.warn("Mark Read Error:", error);
        res.status(500).json({ message: "Failed to mark as read" });
    }
};

// @desc Mark all notifications as read
// @route PUT /api/notifications
const markAllNotificationsRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            { user: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );

        emitNotificationReadSocketEvents({
            userId: req.user._id,
            unreadCount: 0,
            all: true,
        });

        res.json({
            message: "All notifications marked as read",
            modifiedCount: Number(result?.modifiedCount || 0),
            unreadCount: 0,
        });
    } catch (error) {
        console.warn("Mark All Read Error:", error);
        res.status(500).json({ message: "Failed to mark all as read" });
    }
};

// @desc Delete (clear) all notifications for logged in user
// @route DELETE /api/notifications
const clearAllNotifications = async (req, res) => {
    try {
        const result = await Notification.deleteMany({ user: req.user._id });
        emitNotificationReadSocketEvents({
            userId: req.user._id,
            unreadCount: 0,
            all: true,
        });
        res.json({
            message: 'All notifications cleared',
            deletedCount: Number(result?.deletedCount || 0),
            unreadCount: 0,
        });
    } catch (error) {
        console.warn('Clear All Notifications Error:', error);
        res.status(500).json({ message: 'Failed to clear notifications' });
    }
};

// @desc Register Expo push token for logged in user
// @route POST /api/notifications/register-token
const registerPushToken = async (req, res) => {
    try {
        const { token, platform } = req.body || {};
        const normalizedToken = String(token || '').trim();

        if (!normalizedToken) {
            return res.status(400).json({ message: 'Valid token is required' });
        }
        if (!EXPO_PUSH_TOKEN_PATTERN.test(normalizedToken)) {
            return res.status(400).json({ message: 'Invalid Expo push token format' });
        }

        await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { pushTokens: normalizedToken } },
            { new: true }
        );

        return res.json({ success: true, platform: platform || 'unknown' });
    } catch (error) {
        console.warn('Register Token Error:', error.message);
        return res.status(500).json({ success: false, message: 'Failed to register token' });
    }
};

// Internal Utility to create notification (Not exported as an API route)
const createNotification = async ({ user, type, title, message, relatedData }) => {
    try {
        const notif = await Notification.create({
            user,
            type,
            title,
            message,
            relatedData
        });
        const unreadCount = await Notification.countDocuments({ user, isRead: false }).catch(() => null);
        emitNotificationSocketEvents({
            userId: user,
            notification: notif,
            unreadCount,
        });
        return notif;
    } catch (error) {
        console.warn("Failed to create notification:", error.message);
    }
};

module.exports = {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    clearAllNotifications,
    registerPushToken,
    createNotification
};
