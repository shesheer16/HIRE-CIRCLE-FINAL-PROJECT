const createNotificationServiceBoundary = () => ({
    name: 'notification-service',
    mount(app) {
        app.use('/api/notifications', require('../../routes/notificationRoutes'));
    },
});

module.exports = {
    createNotificationServiceBoundary,
};
