const axios = require('axios');

const eventPreferenceMap = {
    new_job_recommendations: 'notifyNewJobRecommendations',
    interview_ready: 'notifyInterviewReady',
    application_status: 'notifyApplicationStatus',
    promotions: 'notifyPromotions',
    match: 'notifyMatch',
    application: 'notifyApplication',
    hire: 'notifyHire',
};

const canSendPushForUser = (user, eventType = 'generic') => {
    const prefs = user?.notificationPreferences || {};
    if (prefs.pushEnabled === false) return false;

    const mappedKey = eventPreferenceMap[String(eventType || '').toLowerCase()];
    if (!mappedKey) return true;
    if (prefs[mappedKey] === false) return false;
    return true;
};

const sendPushNotification = async (pushTokens, title, body, data = {}) => {
    const messages = (pushTokens || [])
        .filter(token => typeof token === 'string' && token.startsWith('ExponentPushToken'))
        .map(token => ({
            to: token,
            sound: 'default',
            title,
            body,
            data,
            priority: 'high',
        }));

    if (messages.length === 0) return;

    try {
        await axios.post('https://exp.host/--/api/v2/push/send', messages, {
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
        });
    } catch (err) {
        console.warn('Push notification failed:', err.message);
        // Non-blocking — never throw, just log
    }
};

const sendPushNotificationForUser = async (user, title, body, data = {}, eventType = 'generic') => {
    if (!user || !canSendPushForUser(user, eventType)) return;
    await sendPushNotification(user.pushTokens || [], title, body, data);
};

module.exports = {
    sendPushNotification,
    sendPushNotificationForUser,
    canSendPushForUser,
};
