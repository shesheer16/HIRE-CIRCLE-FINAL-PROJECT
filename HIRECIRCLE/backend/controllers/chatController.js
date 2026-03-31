const Message = require('../models/Message');
const Application = require('../models/Application');
const Chat = require('../models/Chat');
const WorkerProfile = require('../models/WorkerProfile');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { recordTrustEdge } = require('../services/trustGraphService');
const { resolvePagination } = require('../utils/pagination');
const { sanitizeText } = require('../utils/sanitizeText');
const { normalizeApplicationStatus } = require('../workflow/applicationStateMachine');
const CHAT_ENABLED_STATUSES = new Set([
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'hired',
    // Legacy compatibility.
    'accepted',
]);

const normalizeSenderRole = (user = {}) => {
    const raw = String(user?.activeRole || user?.primaryRole || user?.role || '').trim().toLowerCase();
    if (['employer', 'recruiter'].includes(raw)) return 'employer';
    return 'worker';
};

const normalizeSenderRoleValue = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    if (['employer', 'recruiter', 'hirer', 'company'].includes(raw)) return 'employer';
    if (['worker', 'candidate', 'jobseeker', 'employee'].includes(raw)) return 'worker';
    return '';
};

// Get Chat History (Paginated)
const getChatHistory = async (req, res) => {
    try {
        const { applicationId } = req.params;
        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
            'Surrogate-Control': 'no-store',
        });

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

        const normalizedStatus = normalizeApplicationStatus(application.status, '__invalid__');
        if (!CHAT_ENABLED_STATUSES.has(normalizedStatus)) {
            return res.status(403).json({ message: 'Chat unlocks once this application is shortlisted.' });
        }
        let chat = await Chat.findOne({ applicationId }).select('_id unlocked').lean();
        if (!chat && CHAT_ENABLED_STATUSES.has(normalizedStatus)) {
            if (!workerProfile?.user) {
                return res.status(403).json({ message: 'Chat participant is unavailable for this application.' });
            }
            chat = await Chat.findOneAndUpdate(
                { applicationId },
                {
                    $setOnInsert: {
                        applicationId,
                        employerId: application.employer,
                        candidateId: workerProfile.user,
                    },
                    $set: {
                        unlocked: true,
                        unlockedAt: new Date(),
                    },
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true,
                }
            ).lean();
        }
        if (!chat?.unlocked) {
            return res.status(403).json({ message: 'Chat unlocks once this application is shortlisted.' });
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
            .populate('sender', 'name firstName role activeRole');

        const employerUserId = String(application.employer || '');
        const workerUserId = String(workerProfile?.user || '');
        const workerProfileId = String(application.worker || '');
        const requesterUserId = String(req.user?._id || '');
        const requesterActorSide = normalizeSenderRole(req.user);
        const isDualParticipantAccount = Boolean(
            requesterUserId
            && employerUserId
            && workerUserId
            && employerUserId === workerUserId
        );
        const normalizedMessages = messages.map((entry) => {
            const row = typeof entry?.toObject === 'function' ? entry.toObject() : { ...(entry || {}) };
            const senderId = String(row?.sender?._id || row?.sender || '');
            const senderRoleFromMessage = normalizeSenderRoleValue(
                row?.senderRole
                || row?.sender?.activeRole
                || row?.sender?.primaryRole
                || row?.sender?.role
            );

            if (!row?.senderRole && senderId && senderId === employerUserId && senderId !== workerUserId) {
                row.senderRole = 'employer';
            }
            if (!row?.senderRole && senderId && senderId === workerUserId && senderId !== employerUserId) {
                row.senderRole = 'worker';
            }

            const isMineByUser = Boolean(requesterUserId && senderId && senderId === requesterUserId);
            const isMineByLegacyProfile = Boolean(
                isWorker
                && workerProfileId
                && senderId
                && senderId === workerProfileId
            );
            const normalizedRole = normalizeSenderRoleValue(row?.senderRole || senderRoleFromMessage);
            const isMineByRoleFallback = Boolean(
                !senderId
                && normalizedRole
                && (
                    (isEmployer && normalizedRole === 'employer')
                    || (isWorker && normalizedRole === 'worker')
                )
            );
            if (isDualParticipantAccount && normalizedRole) {
                row.isMine = normalizedRole === requesterActorSide;
            } else {
                row.isMine = Boolean(isMineByUser || isMineByLegacyProfile || isMineByRoleFallback);
            }
            return row;
        });

        // Inverse because we fetched latest first, but usually clients re-reverse or append.
        // Returning as is (Latest is index 0) is fine for "inverted" FlatLists.
        res.status(200).json(normalizedMessages);
    } catch (error) {
        console.warn("Get History Error:", error);
        res.status(500).json({ message: "Failed to fetch history", error: error.message });
    }
};

// Send Message (REST Fallback / if needed for some flows, usually done via Socket)
const sendMessageREST = async (req, res) => {
    try {
        const { applicationId, text, clientMessageId } = req.body;
        const sender = req.user._id;
        const dedupeKey = String(clientMessageId || '').trim().slice(0, 120) || null;

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

        const normalizedStatus = normalizeApplicationStatus(application.status, '__invalid__');
        if (!CHAT_ENABLED_STATUSES.has(normalizedStatus)) {
            return res.status(403).json({ message: 'Chat unlocks once this application is shortlisted.' });
        }
        let chat = await Chat.findOne({ applicationId }).select('_id unlocked').lean();
        if (!chat && CHAT_ENABLED_STATUSES.has(normalizedStatus)) {
            if (!workerProfile?.user) {
                return res.status(403).json({ message: 'Chat participant is unavailable for this application.' });
            }
            chat = await Chat.findOneAndUpdate(
                { applicationId },
                {
                    $setOnInsert: {
                        applicationId,
                        employerId: application.employer,
                        candidateId: workerProfile.user,
                    },
                    $set: {
                        unlocked: true,
                        unlockedAt: new Date(),
                    },
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true,
                }
            ).lean();
        }
        if (!chat?.unlocked) {
            return res.status(403).json({ message: 'Chat unlocks once this application is shortlisted.' });
        }

        const sanitizedText = sanitizeText(text || '', { maxLength: 5000 });
        if (!sanitizedText) {
            return res.status(400).json({ message: 'Message text is required' });
        }

        if (dedupeKey) {
            const existingMessage = await Message.findOne({ applicationId, dedupeKey })
                .populate('sender', 'name firstName role activeRole');
            if (existingMessage) {
                return res.status(200).json(existingMessage);
            }
        }

        let message = null;
        try {
            message = await Message.create({
                applicationId,
                sender,
                senderRole: normalizeSenderRole(req.user),
                text: sanitizedText,
                dedupeKey,
            });
        } catch (createError) {
            if (Number(createError?.code) === 11000 && dedupeKey) {
                const existingMessage = await Message.findOne({ applicationId, dedupeKey })
                    .populate('sender', 'name firstName role activeRole');
                if (existingMessage) {
                    return res.status(200).json(existingMessage);
                }
            }
            throw createError;
        }

        await Application.updateOne(
            { _id: application._id },
            {
                $set: {
                    conversationLastActiveAt: new Date(),
                    lastActivityAt: new Date(),
                },
            }
        );

        const fullMsg = await message.populate('sender', 'name firstName role activeRole');
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

        const io = req.app.get('io');
        if (io) {
            const messagePayload = {
                applicationId: String(application._id),
                roomId: String(application._id),
                message: fullMsg,
                messageId: String(message._id),
                deliveredAt: new Date().toISOString(),
            };
            const roomNames = [`chat_${String(application._id)}`, `chat:${String(application._id)}`];
            for (const roomName of roomNames) {
                io.to(roomName).emit('MESSAGE_SENT', messagePayload);
                io.to(roomName).emit('MESSAGE_DELIVERED', messagePayload);
                io.to(roomName).emit('new_message', fullMsg);
                io.to(roomName).emit('receiveMessage', fullMsg);
            }
        }

        res.status(201).json(fullMsg);
    } catch (error) {
        res.status(500).json({ message: "Message failed" });
    }
};

module.exports = { getChatHistory, sendMessageREST };
