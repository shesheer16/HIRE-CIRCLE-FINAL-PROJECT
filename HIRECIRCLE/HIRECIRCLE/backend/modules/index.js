const { createAuthServiceBoundary } = require('./auth-service');
const { createInterviewServiceBoundary } = require('./interview-service');
const { createMatchServiceBoundary } = require('./match-service');
const { createChatServiceBoundary } = require('./chat-service');
const { createFeedServiceBoundary } = require('./feed-service');
const { createAdminServiceBoundary } = require('./admin-service');
const { createNotificationServiceBoundary } = require('./notification-service');

const buildServiceBoundaries = () => ([
    createAuthServiceBoundary(),
    createInterviewServiceBoundary(),
    createMatchServiceBoundary(),
    createChatServiceBoundary(),
    createFeedServiceBoundary(),
    createAdminServiceBoundary(),
    createNotificationServiceBoundary(),
]);

const mountServiceBoundaries = (app) => {
    const boundaries = buildServiceBoundaries();
    boundaries.forEach((boundary) => {
        boundary.mount(app);
    });
    return boundaries.map((boundary) => boundary.name);
};

module.exports = {
    buildServiceBoundaries,
    mountServiceBoundaries,
};
