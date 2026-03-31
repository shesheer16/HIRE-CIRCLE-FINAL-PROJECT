const createFeedServiceBoundary = () => ({
    name: 'feed-service',
    mount(app) {
        app.use('/api/feed', require('../../routes/feedRoutes'));
        app.use('/api/pulse', require('../../routes/pulseRoutes'));
        app.use('/api/academy', require('../../routes/academyRoutes'));
        app.use('/api/circles', require('../../routes/circlesRoutes'));
    },
});

module.exports = {
    createFeedServiceBoundary,
};
