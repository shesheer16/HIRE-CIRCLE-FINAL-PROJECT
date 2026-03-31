const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { sendPushNotificationForUser } = require('./pushService');
const { enqueueBackgroundJob } = require('./backgroundQueueService');
const { getSocketIoServer } = require('./sessionService');

const emitRealtimeNotification = async ({ userId, notification }) => {
    const safeUserId = String(userId || '').trim();
    if (!safeUserId || !notification) return;
    const io = getSocketIoServer();
    if (!io) return;

    const unreadCount = await Notification.countDocuments({ user: safeUserId, isRead: false }).catch(() => null);
    const payload = {
        notification: (typeof notification.toObject === 'function') ? notification.toObject() : notification,
        unreadCount: Number.isFinite(Number(unreadCount)) ? Number(unreadCount) : undefined,
    };
    io.to(`user_${safeUserId}`).emit('notification_created', payload);
    io.to(`user_${safeUserId}`).emit('NOTIFICATION_CREATED', payload);
};

const createNotificationRecord = async ({ userId, type, title, message, relatedData = {} }) => Notification.create({
    user: userId,
    type,
    title,
    message,
    relatedData,
    isRead: false,
});

const queueNotificationDispatch = async ({ userId, type, title, message, relatedData = {}, pushCategory = 'application_status' }) => enqueueBackgroundJob({
    type: 'notification_dispatch',
    payload: {
        userId: String(userId),
        type,
        title,
        message,
        relatedData,
        pushCategory,
    },
});

const dispatchNotificationNow = async ({ userId, type, title, message, relatedData = {}, pushCategory = 'application_status' }) => {
    const notification = await createNotificationRecord({ userId, type, title, message, relatedData });
    await emitRealtimeNotification({ userId, notification });
    const user = await User.findById(userId).select('pushTokens notificationPreferences').lean();
    if (user) {
        await sendPushNotificationForUser(user, title, message, relatedData, pushCategory);
    }
    return notification;
};

module.exports = {
    createNotificationRecord,
    queueNotificationDispatch,
    dispatchNotificationNow,
};
