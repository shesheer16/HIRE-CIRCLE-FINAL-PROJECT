const createMatchServiceBoundary = () => ({
    name: 'match-service',
    mount(app) {
        app.use('/api/jobs', require('../../routes/jobRoutes'));
        app.use('/api/applications', require('../../routes/applicationRoutes'));
        app.use('/api/interviews', require('../../routes/interviewScheduleRoutes'));
        app.use('/api/offers', require('../../routes/offerRoutes'));
        app.use('/api/matches', require('../../routes/matchingRoutes'));
    },
});

module.exports = {
    createMatchServiceBoundary,
};
