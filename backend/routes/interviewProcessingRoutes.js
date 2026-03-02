const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { smartInterviewStartLimiter } = require('../middleware/rateLimiters');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const {
    createHybridInterviewSession,
    processHybridTurn,
    applyClarificationOverride,
    hydrateHybridContractFromExtractedData,
} = require('../services/interviewProcessingService');
const {
    enqueueInterviewJob,
    isQueueConfigured,
} = require('../services/sqsInterviewQueue');
const logger = require('../utils/logger');
const {
    objectIdParamSchema,
    smartInterviewStartSchema,
    smartInterviewTurnSchema,
} = require('../schemas/requestSchemas');
const { isDegradationActive } = require('../services/degradationService');

const router = express.Router();
const TURN_LOCK_WINDOW_MS = Number.parseInt(process.env.INTERVIEW_TURN_LOCK_WINDOW_MS || '15000', 10);

const resolveInterviewStatusCode = (error, fallbackStatus = 503) => {
    const explicitStatus = Number(error?.statusCode || error?.status || 0);
    if (explicitStatus >= 400 && explicitStatus < 600) {
        return explicitStatus;
    }

    const message = String(error?.message || '').toLowerCase();
    if (!message) return fallbackStatus;
    if (message.includes('not found')) return 404;
    if (message.includes('required') || message.includes('invalid')) return 400;
    if (message.includes('conflict') || message.includes('already')) return 409;
    if (message.includes('expired') || message.includes('timeout')) return 408;
    if (message.includes('rate limit') || message.includes('too many requests')) return 429;
    if (message.includes('paused') || message.includes('queue') || message.includes('unavailable')) return 503;
    return fallbackStatus;
};

const sendInterviewError = (res, error, {
    fallbackStatus = 503,
    fallbackMessage = 'Smart Interview request failed.',
    logEvent = 'smart_interview_route_error',
} = {}) => {
    const statusCode = resolveInterviewStatusCode(error, fallbackStatus);
    const message = String(error?.message || '').trim() || fallbackMessage;
    logger.warn({ event: logEvent, statusCode, message });
    return res.status(statusCode).json({ message });
};

router.get('/latest', protect, async (req, res) => {
    try {
        const latest = await InterviewProcessingJob.findOne({
            userId: req.user._id,
            status: { $in: ['pending', 'processing'] },
            videoUrl: { $regex: /^hybrid:\/\/session\// },
        })
            .sort({ createdAt: -1 })
            .select('_id status');

        if (!latest) {
            return res.json({ processingId: null, status: null });
        }

        return res.json({
            processingId: latest._id,
            status: latest.status,
        });
    } catch (error) {
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to fetch latest interview processing status.',
            logEvent: 'interview_latest_status_error',
        });
    }
});

router.get('/:id', protect, validate({ params: objectIdParamSchema }), async (req, res) => {
    try {
        const processingJob = await InterviewProcessingJob.findOne({
            _id: req.params.id,
            userId: req.user._id,
            videoUrl: { $regex: /^hybrid:\/\/session\// },
        }).select(`
            status
            extractedData
            createdJobId
            errorMessage
            slotState
            slotConfidence
            ambiguousFields
            missingSlot
            interviewComplete
            interviewStep
            maxSteps
            adaptiveQuestion
            clarificationTriggeredCount
            clarificationResolvedCount
            clarificationSkippedCount
        `);

        if (!processingJob) {
            return res.status(404).json({ message: 'Interview processing job not found.' });
        }

        const hybridState = await hydrateHybridContractFromExtractedData(processingJob);

        return res.json({
            processingId: processingJob._id,
            status: processingJob.status,
            extractedData: processingJob.extractedData || null,
            createdJobId: processingJob.createdJobId || null,
            errorMessage: processingJob.errorMessage || null,
            ...hybridState,
        });
    } catch (error) {
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to fetch interview processing status.',
            logEvent: 'interview_processing_status_error',
        });
    }
});

router.post('/hybrid/start', protect, smartInterviewStartLimiter, validate({ body: smartInterviewStartSchema }), async (req, res) => {
    if (isDegradationActive('smartInterviewPaused') || isDegradationActive('queuePaused')) {
        return res.status(503).json({ message: 'Smart Interview is temporarily paused due to high system load.' });
    }

    try {
        const processingJob = await createHybridInterviewSession({
            user: req.user,
            maxSteps: req.body?.maxSteps,
        });
        const hybridState = await hydrateHybridContractFromExtractedData(processingJob);
        const reusedSession = Boolean(processingJob?._reusedSession);

        return res.status(reusedSession ? 200 : 201).json({
            success: true,
            reusedSession,
            processingId: processingJob._id,
            ...hybridState,
        });
    } catch (error) {
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to start hybrid interview session.',
            logEvent: 'hybrid_interview_start_error',
        });
    }
});

router.post('/:id/hybrid-turn', protect, validate({ params: objectIdParamSchema, body: smartInterviewTurnSchema }), async (req, res) => {
    if (isDegradationActive('smartInterviewPaused') || isDegradationActive('queuePaused')) {
        return res.status(503).json({ message: 'Smart Interview is temporarily paused due to high system load.' });
    }

    let processingJob = null;
    try {
        const transcriptChunk = String(req.body?.transcriptChunk || '').trim();
        if (!transcriptChunk) {
            return res.status(400).json({ message: 'transcriptChunk is required.' });
        }

        const now = new Date();
        const lockUntil = new Date(Date.now() + TURN_LOCK_WINDOW_MS);
        processingJob = await InterviewProcessingJob.findOneAndUpdate(
            {
                _id: req.params.id,
                userId: req.user._id,
                videoUrl: { $regex: /^hybrid:\/\/session\// },
                $or: [
                    { turnLockUntil: null },
                    { turnLockUntil: { $lte: now } },
                ],
            },
            {
                $set: {
                    turnLockUntil: lockUntil,
                },
            },
            { new: true }
        );
        if (!processingJob) {
            const existingJob = await InterviewProcessingJob.findOne({
                _id: req.params.id,
                userId: req.user._id,
                videoUrl: { $regex: /^hybrid:\/\/session\// },
            }).select('_id');
            if (!existingJob) {
                return res.status(404).json({ message: 'Interview processing job not found.' });
            }
            return res.status(409).json({ message: 'Another turn is currently being processed. Please retry.' });
        }

        const payload = await processHybridTurn({
            job: processingJob,
            transcriptChunk,
        });

        return res.json({
            success: true,
            processingId: processingJob._id,
            ...payload,
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode >= 400 && statusCode < 500) {
            return res.status(statusCode).json({ message: error.message || 'Failed to process interview turn.' });
        }
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to process interview turn.',
            logEvent: 'hybrid_interview_turn_error',
        });
    } finally {
        if (processingJob?._id) {
            await InterviewProcessingJob.updateOne(
                { _id: processingJob._id, userId: req.user._id },
                { $set: { turnLockUntil: null } }
            );
        }
    }
});

router.post('/:id/clarification', protect, validate({ params: objectIdParamSchema }), async (req, res) => {
    if (isDegradationActive('smartInterviewPaused') || isDegradationActive('queuePaused')) {
        return res.status(503).json({ message: 'Smart Interview is temporarily paused due to high system load.' });
    }

    let processingJob = null;
    try {
        const overrideField = req.body?.overrideField;
        if (!overrideField) {
            return res.status(400).json({ message: 'overrideField is required.' });
        }

        const now = new Date();
        const lockUntil = new Date(Date.now() + TURN_LOCK_WINDOW_MS);
        processingJob = await InterviewProcessingJob.findOneAndUpdate(
            {
                _id: req.params.id,
                userId: req.user._id,
                videoUrl: { $regex: /^hybrid:\/\/session\// },
                $or: [
                    { turnLockUntil: null },
                    { turnLockUntil: { $lte: now } },
                ],
            },
            {
                $set: {
                    turnLockUntil: lockUntil,
                },
            },
            { new: true }
        );
        if (!processingJob) {
            const existingJob = await InterviewProcessingJob.findOne({
                _id: req.params.id,
                userId: req.user._id,
                videoUrl: { $regex: /^hybrid:\/\/session\// },
            }).select('_id');
            if (!existingJob) {
                return res.status(404).json({ message: 'Interview processing job not found.' });
            }
            return res.status(409).json({ message: 'Another turn is currently being processed. Please retry.' });
        }

        const payload = await applyClarificationOverride({
            job: processingJob,
            overrideField,
            value: req.body?.value,
            skip: Boolean(req.body?.skip),
        });

        return res.json({
            success: true,
            processingId: processingJob._id,
            ...payload,
        });
    } catch (error) {
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to apply clarification override.',
            logEvent: 'hybrid_clarification_override_error',
        });
    } finally {
        if (processingJob?._id) {
            await InterviewProcessingJob.updateOne(
                { _id: processingJob._id, userId: req.user._id },
                { $set: { turnLockUntil: null } }
            );
        }
    }
});

router.post('/:id/retry', protect, validate({ params: objectIdParamSchema }), async (req, res) => {
    if (isDegradationActive('queuePaused')) {
        return res.status(503).json({ message: 'Interview queue is temporarily paused due to system load.' });
    }

    try {
        const job = await InterviewProcessingJob.findOne({
            _id: req.params.id,
            userId: req.user._id,
            videoUrl: { $regex: /^hybrid:\/\/session\// },
        }).select('_id status userId role videoUrl');

        if (!job) {
            return res.status(404).json({ message: 'Interview processing job not found.' });
        }

        if (job.status !== 'failed') {
            return res.status(400).json({ message: 'Only failed jobs can be retried manually.' });
        }

        if (!isQueueConfigured()) {
            return res.status(503).json({ message: 'Interview queue is not configured.' });
        }

        await InterviewProcessingJob.updateOne(
            { _id: job._id, status: 'failed' },
            {
                $set: {
                    status: 'pending',
                    errorMessage: null,
                    startedAt: null,
                    completedAt: null,
                },
            }
        );

        await enqueueInterviewJob({
            processingId: String(job._id),
            userId: String(job.userId),
            role: String(job.role || 'worker'),
            videoUrl: String(job.videoUrl || ''),
            manualRetry: true,
        });

        return res.status(202).json({
            success: true,
            processingId: job._id,
            status: 'pending',
            message: 'Manual retry queued successfully.',
        });
    } catch (error) {
        return sendInterviewError(res, error, {
            fallbackStatus: 503,
            fallbackMessage: 'Failed to retry interview processing job.',
            logEvent: 'hybrid_retry_error',
        });
    }
});

module.exports = router;
