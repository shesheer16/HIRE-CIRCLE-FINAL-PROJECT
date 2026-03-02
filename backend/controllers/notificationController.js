const Notification = require('../models/Notification');
const User = require('../models/userModel');

// @desc Get all notifications for logged in user
// @route GET /api/notifications
const getMyNotifications = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const startIndex = (page - 1) * limit;

        const notifications = await Notification.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .skip(startIndex)
            .limit(limit);

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
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }

        res.json(notification);
    } catch (error) {
        console.warn("Mark Read Error:", error);
        res.status(500).json({ message: "Failed to mark as read" });
    }
};

// @desc Mark all notifications as read
// @route PUT /api/notifications
const markAllNotificationsRead = async (req, res) => {
    try {
        await Notification.updateMany(
            { user: req.user._id, isRead: false },
            { $set: { isRead: true } }
        );

        res.json({ message: "All notifications marked as read" });
    } catch (error) {
        console.warn("Mark All Read Error:", error);
        res.status(500).json({ message: "Failed to mark all as read" });
    }
};

// @desc Register Expo push token for logged in user
// @route POST /api/notifications/register-token
const registerPushToken = async (req, res) => {
    try {
        const { token, platform } = req.body;

        if (!token || typeof token !== 'string') {
            return res.status(400).json({ message: 'Valid token is required' });
        }

        await User.findByIdAndUpdate(
            req.user._id,
            { $addToSet: { pushTokens: token } },
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

        // Socket emission can be enabled here when live notification fan-out is required.
        return notif;
    } catch (error) {
        console.warn("Failed to create notification:", error.message);
    }
};

module.exports = {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    registerPushToken,
    createNotification
};
