const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { sendPushNotificationForUser } = require('./pushService');

const createAndSendBehaviorNotification = async ({
    userId,
    title,
    message,
    notificationType = 'status_update',
    relatedData = {},
    pushEventType = 'promotions',
    dedupeKey = null,
    dedupeWindowHours = 6,
}) => {
    if (!userId || !title || !message) return null;

    if (dedupeKey) {
        const since = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000);
        const existing = await Notification.findOne({
            user: userId,
            'relatedData.dedupeKey': dedupeKey,
            createdAt: { $gte: since },
        }).select('_id').lean();

        if (existing?._id) {
            return null;
        }
    }

    const [notification, user] = await Promise.all([
        Notification.create({
            user: userId,
            type: notificationType,
            title,
            message,
            relatedData: {
                ...relatedData,
                ...(dedupeKey ? { dedupeKey } : {}),
            },
        }),
        User.findById(userId).select('pushTokens notificationPreferences').lean(),
    ]);

    await sendPushNotificationForUser(
        user,
        title,
        message,
        relatedData,
        pushEventType
    );

    return notification;
};

const sendReengagementPushes = async ({ inactiveDays = 5, cooldownDays = 5, batchSize = 500 } = {}) => {
    const inactivityThreshold = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
    const cooldownThreshold = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

    const users = await User.find({
        isDeleted: { $ne: true },
        updatedAt: { $lt: inactivityThreshold },
    })
        .select('_id name pushTokens notificationPreferences')
        .limit(batchSize)
        .lean();

    let sentCount = 0;

    for (const user of users) {
        const recent = await Notification.findOne({
            user: user._id,
            'relatedData.nudgeType': 'growth_reengagement_5d',
            createdAt: { $gte: cooldownThreshold },
        }).select('_id').lean();

        if (recent?._id) continue;

        const title = 'New opportunities are waiting';
        const message = `Hi ${String(user.name || '').split(' ')[0] || 'there'}, come back to see fresh matches and updates.`;

        await createAndSendBehaviorNotification({
            userId: user._id,
            title,
            message,
            notificationType: 'reengagement_nudge',
            relatedData: {
                nudgeType: 'growth_reengagement_5d',
            },
            pushEventType: 'promotions',
            dedupeKey: `growth_reengagement_5d:${String(user._id)}`,
            dedupeWindowHours: 24 * cooldownDays,
        });

        sentCount += 1;
    }

    return {
        scannedUsers: users.length,
        sentCount,
    };
};

module.exports = {
    createAndSendBehaviorNotification,
    sendReengagementPushes,
};
