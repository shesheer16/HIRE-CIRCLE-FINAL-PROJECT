import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import client from '../api/client';
import { logger } from '../utils/logger';

// Configure notification handler
const isExpoGo = Constants.appOwnership === 'expo';
if (!isExpoGo) {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
        }),
    });
}

export const registerForPushNotifications = async () => {
    if (isExpoGo) return null;
    if (!Device.isDevice) return null; // won't work in simulator — handle gracefully

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
    }

    if (finalStatus !== 'granted') return null;

    const token = (await Notifications.getExpoPushTokenAsync()).data;

    // Register token with backend
    try {
        await client.post('/api/notifications/register-token', { token, platform: Platform.OS });
    } catch (e) {
        logger.warn('Push token registration failed:', e?.message);
    }

    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
        });
    }

    return token;
};

export const requestNotificationPermission = async () => {
    if (isExpoGo) return { granted: false };
    const current = await Notifications.getPermissionsAsync();
    if (current.status === 'granted') {
        return { granted: true, status: current.status };
    }

    const requested = await Notifications.requestPermissionsAsync();
    return { granted: requested.status === 'granted', status: requested.status };
};

export const triggerLocalNotification = async (eventType, payload = {}) => {
    if (isExpoGo) return null;

    const configMap = {
        new_message: {
            title: 'New message',
            body: payload?.senderName ? `${payload.senderName} sent a message.` : 'You have a new message.',
            data: { type: 'message', applicationId: payload?.applicationId || payload?.roomId || null },
        },
        new_applicant: {
            title: 'New applicant',
            body: payload?.jobTitle ? `New applicant for ${payload.jobTitle}.` : 'You received a new applicant.',
            data: { type: 'application', applicationId: payload?.applicationId || null },
        },
        match_alert: {
            title: 'New match alert',
            body: payload?.jobTitle ? `New match found: ${payload.jobTitle}.` : 'A new high-match job is available.',
            data: { type: 'match_alert', jobId: payload?.jobId || null },
        },
        jobs_near_you: {
            title: 'Jobs near you',
            body: payload?.city
                ? `Fresh openings are now live near ${payload.city}.`
                : 'Fresh openings are now live near you.',
            data: { type: 'jobs_near_you', city: payload?.city || null },
        },
        profile_viewed: {
            title: 'Profile activity',
            body: 'Someone viewed your profile. Keep your details updated to improve callbacks.',
            data: { type: 'profile_viewed' },
        },
        hired_today_social_proof: {
            title: 'People like you got hired today',
            body: payload?.count
                ? `${payload.count} candidates with similar profiles got hired today.`
                : 'Candidates with similar profiles got hired today.',
            data: { type: 'hired_today_social_proof', count: payload?.count || null },
        },
        daily_match_alert: {
            title: 'Daily match update',
            body: payload?.count
                ? `${payload.count} strong matches are ready for review.`
                : 'New strong matches are ready for review.',
            data: { type: 'daily_match_alert', count: payload?.count || null },
        },
        interview_reminder: {
            title: 'Interview reminder',
            body: payload?.time ? `Interview reminder: ${payload.time}` : 'Interview reminder: don’t miss your slot.',
            data: { type: 'interview_reminder', interviewId: payload?.interviewId || null },
        },
    };

    const template = configMap[eventType];
    if (!template) return null;

    try {
        return await Notifications.scheduleNotificationAsync({
            content: {
                title: template.title,
                body: template.body,
                data: template.data,
            },
            trigger: null,
        });
    } catch (error) {
        logger.warn('Local notification trigger failed:', error?.message || error);
        return null;
    }
};

export const scheduleLocalNotificationTest = async () => {
    return triggerLocalNotification('new_message', {
        senderName: 'Test Signal',
        applicationId: 'test-application-id',
    });
};
