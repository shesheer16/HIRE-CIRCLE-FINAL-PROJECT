const createInterviewServiceBoundary = () => ({
    name: 'interview-service',
    mount(app) {
        app.use('/api/upload', require('../../routes/uploadRoutes'));
        app.use('/api/v2/upload', require('../../routes/uploadV2Routes'));
        app.use('/api/v2/interview-processing', require('../../routes/interviewProcessingRoutes'));
    },
});

module.exports = {
    createInterviewServiceBoundary,
};
