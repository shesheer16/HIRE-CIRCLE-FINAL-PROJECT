const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const { getChatHistory, sendMessageREST } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');
const { trustGuard } = require('../middleware/trustGuardMiddleware');
const { abuseDefenseGuard } = require('../middleware/abuseDefenseMiddleware');
const { validate } = require('../middleware/validate');
const { chatMessageLimiter } = require('../middleware/rateLimiters');
const { uploadToS3 } = require('../services/s3Service');
const Application = require('../models/Application');
const Message = require('../models/Message');
const { chatSendSchema } = require('../schemas/requestSchemas');
const { recordTrustEdge } = require('../services/trustGraphService');
const { queueNotificationDispatch } = require('../services/notificationEngineService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const {
    runVirusScanHook,
    isValidAttachmentSignature,
    ensureExtensionMatchesMime,
} = require('../services/uploadSecurityService');
const { transcribeAudioFile } = require('../services/transcriptionService');

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
const MAX_ATTACHMENT_BYTES = Number.parseInt(process.env.CHAT_ATTACHMENT_MAX_FILE_BYTES || String(10 * 1024 * 1024), 10);
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/webp',
]);
const ALLOWED_AUDIO_MIME_TYPES = new Set([
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/x-wav',
    'audio/webm',
    'audio/ogg',
    'audio/aac',
    'audio/x-m4a',
]);
const MIME_EXTENSION_MAP = new Map([
    ['application/pdf', ['.pdf']],
    ['application/msword', ['.doc']],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['.docx']],
    ['image/jpeg', ['.jpg', '.jpeg']],
    ['image/png', ['.png']],
    ['image/webp', ['.webp']],
]);

const upload = multer({
    dest: path.join(__dirname, '../uploads/chat'),
    limits: { fileSize: MAX_ATTACHMENT_BYTES },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_ATTACHMENT_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported attachment format'));
    },
});

const voiceUpload = multer({
    dest: path.join(__dirname, '../uploads/chat-voice'),
    limits: {
        fileSize: Number.parseInt(process.env.CHAT_AUDIO_MAX_FILE_BYTES || String(12 * 1024 * 1024), 10),
    },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_AUDIO_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported audio format'));
    },
});

const computeFileHash = (filePath) => {
    const hash = crypto.createHash('sha256');
    const content = fs.readFileSync(filePath);
    hash.update(content);
    return hash.digest('hex');
};

const verifyChatAccess = async ({ applicationId, userId }) => {
    const application = await Application.findById(applicationId)
        .populate('worker', 'user')
        .select('worker employer status');
    if (!application) {
        return { ok: false, statusCode: 404, message: 'Application not found' };
    }

    const employerId = String(application.employer || '');
    const workerUserId = application.worker?.user ? String(application.worker.user) : '';
    if (![employerId, workerUserId].includes(String(userId || ''))) {
        return { ok: false, statusCode: 403, message: 'Not authorized for this chat' };
    }

    if (!CHAT_ENABLED_STATUSES.has(String(application.status || '').toLowerCase())) {
        return { ok: false, statusCode: 403, message: 'Chat is available after acceptance' };
    }

    return {
        ok: true,
        application,
    };
};

router.get('/:applicationId', protect, getChatHistory);
router.post('/', protect, trustGuard('message_sent'), abuseDefenseGuard('message_sent'), chatMessageLimiter, validate({ body: chatSendSchema }), sendMessageREST);
router.post('/upload', protect, trustGuard('message_sent'), abuseDefenseGuard('message_upload'), (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Attachment exceeds size limit' });
        }
        return res.status(400).json({ message: error.message || 'Invalid attachment upload request' });
    });
}, async (req, res) => {
    const localFilePath = req.file?.path;
    try {
        const applicationId = String(req.body?.applicationId || '').trim();
        if (!req.file || !applicationId) {
            return res.status(400).json({ message: 'file and applicationId are required' });
        }

        const normalizedMimeType = String(req.file.mimetype || '').toLowerCase();
        if (!ensureExtensionMatchesMime(req.file.originalname, normalizedMimeType, MIME_EXTENSION_MAP)) {
            return res.status(400).json({ message: 'Invalid attachment extension' });
        }
        if (!isValidAttachmentSignature(localFilePath, normalizedMimeType)) {
            return res.status(400).json({ message: 'Invalid attachment content' });
        }
        await runVirusScanHook({
            filePath: localFilePath,
            mimeType: normalizedMimeType,
            originalName: req.file.originalname,
            correlationId: req.correlationId,
        });

        const auth = await verifyChatAccess({
            applicationId,
            userId: req.user?._id,
        });
        if (!auth.ok) {
            return res.status(auth.statusCode).json({ message: auth.message });
        }

        const url = await uploadToS3(localFilePath, normalizedMimeType, { prefix: 'chat-attachments' });
        return res.status(201).json({
            success: true,
            url,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to upload attachment' });
    } finally {
        if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
    }
});

router.post('/voice-message', protect, trustGuard('message_sent'), abuseDefenseGuard('voice_message'), (req, res, next) => {
    voiceUpload.single('audio')(req, res, (error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'Audio exceeds size limit' });
        }
        return res.status(400).json({ message: error.message || 'Invalid audio upload request' });
    });
}, async (req, res) => {
    const localFilePath = req.file?.path;
    try {
        const applicationId = String(req.body?.applicationId || '').trim();
        if (!req.file || !applicationId) {
            return res.status(400).json({ message: 'audio and applicationId are required' });
        }

        const normalizedMimeType = String(req.file.mimetype || '').toLowerCase();
        if (!ALLOWED_AUDIO_MIME_TYPES.has(normalizedMimeType)) {
            return res.status(400).json({ message: 'Unsupported audio format' });
        }

        const auth = await verifyChatAccess({
            applicationId,
            userId: req.user?._id,
        });
        if (!auth.ok) {
            return res.status(auth.statusCode).json({ message: auth.message });
        }

        const dedupeKey = computeFileHash(localFilePath);
        const existing = await Message.findOne({ applicationId, dedupeKey })
            .populate('sender', 'name firstName role activeRole')
            .lean();
        if (existing) {
            return res.json({
                success: true,
                deduplicated: true,
                message: existing,
            });
        }

        const transcription = await transcribeAudioFile(localFilePath, { mimeType: normalizedMimeType });
        const audioUrl = await uploadToS3(localFilePath, normalizedMimeType, { prefix: 'chat-audio' });

        const savedMessage = await Message.create({
            applicationId,
            sender: req.user._id,
            type: 'audio',
            text: transcription.transcript,
            transcript: transcription.transcript,
            audioUrl,
            mimeType: normalizedMimeType,
            sizeBytes: Number(req.file?.size || 0),
            dedupeKey,
        });
        const fullMessage = await savedMessage.populate('sender', 'name firstName role activeRole');
        const employerId = String(auth?.application?.employer || '');
        const workerUserId = String(auth?.application?.worker?.user || '');
        const senderId = String(req.user?._id || '');
        const receiverUserId = senderId === employerId ? workerUserId : employerId;
        if (receiverUserId) {
            await recordTrustEdge({
                fromUserId: req.user._id,
                toUserId: receiverUserId,
                edgeType: 'messaged',
                weight: 24,
                qualityScore: 5,
                negative: false,
                referenceType: 'voice_message',
                referenceId: String(savedMessage._id),
                metadata: {
                    applicationId: String(applicationId),
                    transport: 'voice',
                },
            }).catch(() => null);
        }

        if (receiverUserId) {
            await queueNotificationDispatch({
                userId: receiverUserId,
                type: 'message_received',
                title: 'New Voice Message',
                message: transcription.transcript || 'You received a voice message.',
                relatedData: {
                    applicationId: String(applicationId),
                    messageId: String(savedMessage._id),
                    voice: true,
                },
                pushCategory: 'application_status',
            });
        }

        safeLogPlatformEvent({
            type: 'message_sent',
            userId: senderId,
            meta: {
                applicationId: String(applicationId),
                messageId: String(savedMessage._id),
                via: 'voice_upload',
            },
        });
        setImmediate(() => {
            enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: senderId,
                    reason: 'message_sent_voice',
                },
            }).catch(() => { });
        });

        const io = req.app.get('io');
        if (io) {
            const roomName = `chat_${applicationId}`;
            io.to(roomName).emit('new_message', fullMessage);
            io.to(roomName).emit('receiveMessage', fullMessage);
        }

        return res.status(201).json({
            success: true,
            transcript: transcription.transcript,
            audioUrl,
            message: fullMessage,
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 500);
        return res.status(statusCode).json({ message: error?.message || 'Failed to process voice message' });
    } finally {
        if (localFilePath && fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTERPRISE HUB ROUTES — Chat Intelligence Panel (Phase 1-7)
// ─────────────────────────────────────────────────────────────────────────────

const {
    uploadDocument,
    getSignedDownloadUrl,
    deleteDocument,
    listDocuments,
} = require('../services/chatDocumentService');
const {
    createNote,
    listNotes,
    editNote,
    deleteNote,
} = require('../services/chatNotesService');

const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Escrow = require('../models/Escrow');

// Phase 1/2: Hiring Timeline (immutable, chronological)
router.get('/enterprise/:applicationId/timeline', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const auth = await verifyChatAccess({ applicationId, userId: req.user._id });
        if (!auth.ok) return res.status(auth.statusCode).json({ message: auth.message });

        const events = await HiringLifecycleEvent.find({ applicationId })
            .sort({ occurredAt: 1 })
            .lean();

        return res.json({
            applicationId,
            timeline: events.map((e) => ({
                event: e.eventType,
                label: e.label || e.eventType,
                occurredAt: e.occurredAt,
                metadata: e.metadata || {},
            })),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load hiring timeline' });
    }
});

// Phase 3: Document Center — List documents
router.get('/enterprise/:applicationId/documents', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const documents = await listDocuments(applicationId, req.user._id);
        return res.json({ applicationId, documents });
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to list documents' });
    }
});

// Phase 3: Document Center — Upload document (employer uploads offer/contract; seeker uploads resume)
const documentUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = new Set(['application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg', 'image/png', 'image/webp']);
        if (allowed.has(String(file.mimetype || '').toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported document format'));
        }
    },
});
router.post('/enterprise/:applicationId/documents', protect, (req, res, next) => {
    documentUpload.single('document')(req, res, (err) => {
        if (!err) { next(); return; }
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'Document exceeds 10MB size limit' });
        }
        return res.status(400).json({ message: err.message || 'Invalid document upload' });
    });
}, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const documentType = String(req.body?.documentType || '').trim();
        if (!req.file) return res.status(400).json({ message: 'document file required' });

        const result = await uploadDocument(applicationId, req.user._id, {
            buffer: req.file.buffer,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
        }, documentType);

        return res.status(201).json({ success: true, document: result });
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to upload document' });
    }
});

// Phase 3: Document Center — Get signed download URL
router.post('/enterprise/:applicationId/documents/download', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const s3Key = String(req.body?.s3Key || '').trim();
        if (!s3Key) return res.status(400).json({ message: 's3Key required' });

        const result = await getSignedDownloadUrl(applicationId, s3Key, req.user._id);
        return res.json(result);
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to generate download URL' });
    }
});

// Phase 3: Document Center — Delete (employer + pre-hire status only)
router.delete('/enterprise/:applicationId/documents', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const s3Key = String(req.body?.s3Key || '').trim();
        if (!s3Key) return res.status(400).json({ message: 's3Key required' });

        const result = await deleteDocument(applicationId, s3Key, req.user._id);
        return res.json(result);
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to delete document' });
    }
});

// Phase 6: Escrow Status Panel (read-only)
router.get('/enterprise/:applicationId/escrow', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const auth = await verifyChatAccess({ applicationId, userId: req.user._id });
        if (!auth.ok) return res.status(auth.statusCode).json({ message: auth.message });

        const escrow = await Escrow.findOne({ applicationId })
            .select('status amount currency fundedAt releasedAt disputeStatus withdrawalInitiatedAt')
            .lean();

        if (!escrow) {
            return res.json({ applicationId, escrow: null, message: 'No escrow record found' });
        }

        return res.json({
            applicationId,
            escrow: {
                status: escrow.status,
                amountLocked: escrow.amount,
                currency: escrow.currency,
                fundedAt: escrow.fundedAt,
                releasedAt: escrow.releasedAt,
                disputeStatus: escrow.disputeStatus || null,
                withdrawalInitiatedAt: escrow.withdrawalInitiatedAt || null,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load escrow status' });
    }
});

// Phase 7: Private Employer Notes (CRUD — employer only)
router.get('/enterprise/:applicationId/notes', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const notes = await listNotes(applicationId, req.user._id);
        return res.json({ applicationId, notes });
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to load notes' });
    }
});

router.post('/enterprise/:applicationId/notes', protect, async (req, res) => {
    try {
        const { applicationId } = req.params;
        const content = String(req.body?.content || '').trim();
        const note = await createNote(applicationId, req.user._id, content);
        return res.status(201).json({ success: true, note });
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to create note' });
    }
});

router.patch('/enterprise/:applicationId/notes/:noteId', protect, async (req, res) => {
    try {
        const { noteId } = req.params;
        const content = String(req.body?.content || '').trim();
        const note = await editNote(noteId, req.user._id, content);
        return res.json({ success: true, note });
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to edit note' });
    }
});

router.delete('/enterprise/:applicationId/notes/:noteId', protect, async (req, res) => {
    try {
        const { noteId } = req.params;
        const result = await deleteNote(noteId, req.user._id);
        return res.json(result);
    } catch (error) {
        const code = Number(error?.code || 500);
        return res.status(code).json({ message: error.message || 'Failed to delete note' });
    }
});

module.exports = router;
