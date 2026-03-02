const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { sendPushNotificationForUser } = require('./pushService');
const { enqueueBackgroundJob } = require('./backgroundQueueService');

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
