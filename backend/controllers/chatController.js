const Message = require('../models/Message');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { recordTrustEdge } = require('../services/trustGraphService');
const { resolvePagination } = require('../utils/pagination');
const { sanitizeText } = require('../utils/sanitizeText');
const CHAT_ENABLED_STATUSES = new Set([
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'hired',
    // Legacy compatibility.
    'accepted',
    'offer_proposed',
    'interview',
]);

// Get Chat History (Paginated)
const getChatHistory = async (req, res) => {
    try {
        const { applicationId } = req.params;

        // Defensive check: If applicationId is not a valid 24-character hex ObjectId, return empty history gracefully
        if (!applicationId || !applicationId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(200).json([]);
        }

        const application = await Application.findById(applicationId).select('employer worker status');
        if (!application) {
            return res.status(200).json([]);
        }

        const workerProfile = await WorkerProfile.findById(application.worker).select('user');
        const isEmployer = String(application.employer) === String(req.user._id);
        const isWorker = String(workerProfile?.user) === String(req.user._id);
        if (!isEmployer && !isWorker) {
            return res.status(403).json({ message: 'Not authorized to view this chat' });
        }

        if (!CHAT_ENABLED_STATUSES.has(String(application.status || '').toLowerCase())) {
            return res.status(403).json({ message: 'Chat is available after acceptance' });
        }

        const { page, limit, skip } = resolvePagination({
            page: req.query.page,
            limit: req.query.limit,
            defaultLimit: 20,
            maxLimit: 100,
        });

        const messages = await Message.find({ applicationId })
            .sort({ createdAt: -1 }) // Latest first for UI
            .skip(skip)
            .limit(limit)
            .populate('sender', 'name firstName role');

        // Inverse because we fetched latest first, but usually clients re-reverse or append.
        // Returning as is (Latest is index 0) is fine for "inverted" FlatLists.
        res.status(200).json(messages);
    } catch (error) {
        console.warn("Get History Error:", error);
        res.status(500).json({ message: "Failed to fetch history", error: error.message });
    }
};

// Send Message (REST Fallback / if needed for some flows, usually done via Socket)
const sendMessageREST = async (req, res) => {
    try {
        const { applicationId, text } = req.body;
        const sender = req.user._id;

        const application = await Application.findById(applicationId).select('employer worker status');
        if (!application) {
            return res.status(404).json({ message: 'Application not found' });
        }

        const workerProfile = await WorkerProfile.findById(application.worker).select('user');
        const isEmployer = String(application.employer) === String(sender);
        const isWorker = String(workerProfile?.user) === String(sender);
        if (!isEmployer && !isWorker) {
            return res.status(403).json({ message: 'Not authorized to message in this chat' });
        }

        if (!CHAT_ENABLED_STATUSES.has(String(application.status || '').toLowerCase())) {
            return res.status(403).json({ message: 'Chat is available after acceptance' });
        }

        const sanitizedText = sanitizeText(text || '', { maxLength: 5000 });
        if (!sanitizedText) {
            return res.status(400).json({ message: 'Message text is required' });
        }

        const message = await Message.create({
            applicationId,
            sender,
            text: sanitizedText
        });

        await Application.updateOne(
            { _id: application._id },
            {
                $set: {
                    conversationLastActiveAt: new Date(),
                    lastActivityAt: new Date(),
                },
            }
        );

        const fullMsg = await message.populate('sender', 'name firstName role');
        const receiverUserId = isEmployer ? workerProfile?.user : application.employer;
        if (receiverUserId) {
            await recordTrustEdge({
                fromUserId: sender,
                toUserId: receiverUserId,
                edgeType: 'messaged',
                weight: 20,
                qualityScore: 4,
                negative: false,
                referenceType: 'message',
                referenceId: String(message._id),
                metadata: {
                    applicationId: String(application._id),
                    transport: 'rest',
                },
            }).catch(() => null);
        }
        if (receiverUserId) {
            await queueNotificationDispatch({
                userId: receiverUserId,
                type: 'message_received',
                title: 'New Message',
                message: sanitizedText,
                relatedData: {
                    applicationId: String(application._id),
                    messageId: String(message._id),
                },
                pushCategory: 'application_status',
            });
        }

        safeLogPlatformEvent({
            type: 'message_sent',
            userId: sender,
            meta: {
                applicationId: String(application._id),
                messageId: String(message._id),
            },
        });
        setImmediate(() => {
            enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(sender),
                    reason: 'message_sent_rest',
                },
            }).catch(() => {});
        });

        setImmediate(async () => {
            try {
                await trackFunnelStage({
                    userId: sender,
                    stage: 'chat',
                    source: 'chat_rest_send',
                    metadata: {
                        applicationId: String(applicationId),
                    },
                });
                await recordFeatureUsage({
                    userId: sender,
                    featureKey: 'chat_message_sent',
                    metadata: {
                        applicationId: String(applicationId),
                    },
                });
            } catch (_error) {
                // Non-blocking analytics path.
            }
        });

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
