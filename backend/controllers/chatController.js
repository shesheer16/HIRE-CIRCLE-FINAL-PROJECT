const Message = require('../models/Message');

// Get Chat History (Paginated)
const getChatHistory = async (req, res) => {
    try {
        const { applicationId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const messages = await Message.find({ applicationId })
            .sort({ createdAt: -1 }) // Latest first for UI
            .skip(skip)
            .limit(limit)
            .populate('sender', 'name firstName role');

        // Inverse because we fetched latest first, but usually clients re-reverse or append.
        // Returning as is (Latest is index 0) is fine for "inverted" FlatLists.
        res.status(200).json(messages);
    } catch (error) {
        console.error("Get History Error:", error);
        res.status(500).json({ message: "Failed to fetch history" });
    }
};

// Send Message (REST Fallback / if needed for some flows, usually done via Socket)
const sendMessageREST = async (req, res) => {
    try {
        const { applicationId, text } = req.body;
        const sender = req.user._id;

        const message = await Message.create({
            applicationId,
            sender,
            text
        });

        const fullMsg = await message.populate('sender', 'name firstName role');

        // If using hybrid, we might emit here too if we have access to io, 
        // but typically controller doesn't have 'io' scope unless passed.
        // For this architecture, we rely on the Socket Event 'sendMessage' for real-time,
        // this REST endpoint is just a backup or for non-realtime clients.

        res.status(201).json(fullMsg);
    } catch (error) {
        res.status(500).json({ message: "Message failed" });
    }
};

module.exports = { getChatHistory, sendMessageREST };
