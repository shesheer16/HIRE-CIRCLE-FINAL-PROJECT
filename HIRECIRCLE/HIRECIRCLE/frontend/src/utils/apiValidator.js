import { logger } from './logger';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export class ApiValidationError extends Error {
    constructor(endpoint, message, issues = []) {
        super(message);
        this.name = 'ApiValidationError';
        this.endpoint = endpoint;
        this.issues = issues;
    }
}

const fail = (endpoint, message, issues = []) => {
    throw new ApiValidationError(endpoint, message, issues);
};

const ensureArray = (endpoint, value, label) => {
    if (!Array.isArray(value)) {
        fail(endpoint, `${label} is not an array`, [{ path: label, expected: 'array', received: typeof value }]);
    }
    return value;
};

const ensureObject = (endpoint, value, label) => {
    if (!isObject(value)) {
        fail(endpoint, `${label} is not an object`, [{ path: label, expected: 'object', received: typeof value }]);
    }
    return value;
};

export const logValidationError = (error, fallbackEndpoint = 'unknown') => {
    const endpoint = error?.endpoint || fallbackEndpoint;
    const payload = {
        type: error?.name || 'ValidationError',
        endpoint,
        message: error?.message || 'Response validation failed',
        issues: error?.issues || [],
    };
    logger.error('[API_VALIDATION_ERROR]', payload);
};

export const validateJobsResponse = (payload) => {
    const endpoint = '/api/matches/candidate';
    const root = isObject(payload) ? payload : {};
    const matches = Array.isArray(payload) ? payload : root.matches;
    const list = ensureArray(endpoint, matches, 'matches');

    list.forEach((item, index) => {
        if (!isObject(item)) {
            fail(endpoint, 'Invalid match item', [{ path: `matches[${index}]`, expected: 'object', received: typeof item }]);
        }
    });

    return list;
};

export const validateApplicationsResponse = (payload) => {
    const endpoint = '/api/applications';
    const root = isObject(payload) ? payload : {};
    const applications = Array.isArray(payload) ? payload : root.data;
    const list = ensureArray(endpoint, applications, 'applications');

    list.forEach((item, index) => {
        if (!isObject(item)) {
            fail(endpoint, 'Invalid application item', [{ path: `applications[${index}]`, expected: 'object', received: typeof item }]);
        }
    });

    return list;
};

export const validateChatMessagesResponse = (payload, applicationId) => {
    const endpoint = `/api/chat/${applicationId || ':id'}`;
    const messages = ensureArray(endpoint, payload, 'messages');

    messages.forEach((item, index) => {
        if (!isObject(item)) {
            fail(endpoint, 'Invalid chat message item', [{ path: `messages[${index}]`, expected: 'object', received: typeof item }]);
        }
    });

    return messages;
};

export const validateProfileResponse = (payload) => {
    const endpoint = '/api/users/profile';
    const root = ensureObject(endpoint, payload, 'response');
    const profile = root.profile;
    ensureObject(endpoint, profile, 'profile');
    return profile;
};

export const validateNotificationsResponse = (payload) => {
    const endpoint = '/api/notifications';
    const root = ensureObject(endpoint, payload, 'response');
    const notifications = ensureArray(endpoint, root.notifications, 'notifications');

    notifications.forEach((item, index) => {
        if (!isObject(item)) {
            fail(endpoint, 'Invalid notification item', [{ path: `notifications[${index}]`, expected: 'object', received: typeof item }]);
        }
    });

    return notifications;
};
