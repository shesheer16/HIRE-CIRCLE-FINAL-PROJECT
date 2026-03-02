const createChatServiceBoundary = () => ({
    name: 'chat-service',
    mount(app) {
        app.use('/api/chat', require('../../routes/chatRoutes'));
    },
});

module.exports = {
    createChatServiceBoundary,
};
