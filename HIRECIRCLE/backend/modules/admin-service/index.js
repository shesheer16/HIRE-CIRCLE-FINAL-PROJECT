const createAdminServiceBoundary = () => ({
    name: 'admin-service',
    mount(app) {
        app.use('/api/admin', require('../../routes/adminRoutes'));
        app.use('/api/analytics', require('../../routes/analyticsRoutes'));
        app.use('/api/feedback', require('../../routes/feedbackRoutes'));
        app.use('/api/insights', require('../../routes/insightRoutes'));
        app.use('/api/growth', require('../../routes/growthRoutes'));
        app.use('/api/organizations', require('../../routes/orgRoutes'));
        app.use('/api/platform', require('../../routes/platformRoutes'));
        app.use('/api/moat', require('../../routes/moatRoutes'));
        app.use('/embed', require('../../routes/embedRoutes'));
    },
});

module.exports = {
    createAdminServiceBoundary,
};
