const createAuthServiceBoundary = () => ({
    name: 'auth-service',
    mount(app) {
        app.use('/api/users', require('../../routes/userRoutes'));
        app.use('/api/auth', require('../../routes/authRoutes'));
    },
});

module.exports = {
    createAuthServiceBoundary,
};
