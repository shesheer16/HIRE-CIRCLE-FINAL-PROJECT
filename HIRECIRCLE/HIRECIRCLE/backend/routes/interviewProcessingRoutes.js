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
const STALE_STATUS_THRESHOLD_MS = Number.parseInt(process.env.INTERVIEW_STATUS_STALE_MS || '65000', 10);

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

const toSkillsList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const toNumberOrNull = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const normalized = String(value ?? '').replace(/,/g, '').trim();
    if (!normalized) return null;
    const numeric = Number.parseFloat(normalized);
    return Number.isFinite(numeric) ? numeric : null;
};

const buildProfileData = (processingJob = null, hybridState = {}) => {
    const extracted = (processingJob?.extractedData && typeof processingJob.extractedData === 'object')
        ? processingJob.extractedData
        : {};
    const slotState = (hybridState?.slotState && typeof hybridState.slotState === 'object')
        ? hybridState.slotState
        : {};
    const normalizedRole = String(processingJob?.role || '').toLowerCase() === 'employer' ? 'employer' : 'worker';

    if (normalizedRole === 'employer') {
        const employerSkills = toSkillsList(
            extracted.requiredSkills
            || extracted.skills
            || slotState.primarySkills
            || []
        );
        return {
            role: String(extracted.jobTitle || extracted.roleTitle || extracted.roleName || slotState.primaryRole || '').trim(),
            city: String(extracted.location || extracted.city || slotState.city || '').trim(),
            salary: String(extracted.salaryRange || extracted.expectedSalary || slotState.expectedSalary || '').trim(),
            experience: String(extracted.experienceRequired || extracted.totalExperience || slotState.totalExperienceYears || '').trim(),
            skills: employerSkills,
            transcript: String(processingJob?.latestTranscriptSnippet || '').trim(),
        };
    }

    const workerSkills = toSkillsList(
        extracted.skills
        || extracted.requiredSkills
        || slotState.primarySkills
        || []
    );
    const workerExperience = toNumberOrNull(
        extracted.experienceYears
        ?? extracted.totalExperience
        ?? slotState.totalExperienceYears
    );

    return {
        role: String(extracted.roleTitle || extracted.roleName || extracted.jobTitle || slotState.primaryRole || '').trim(),
        city: String(extracted.location || extracted.city || slotState.city || '').trim(),
        salary: String(extracted.expectedSalary || extracted.salaryRange || slotState.expectedSalary || '').trim(),
        experience: workerExperience,
        skills: workerSkills,
        transcript: String(processingJob?.latestTranscriptSnippet || '').trim(),
    };
};

router.get('/latest', protect, async (req, res) => {
    try {
        const latest = await InterviewProcessingJob.findOne({
            userId: req.user._id,
        })
            .sort({ createdAt: -1 })
            .select(`
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
                clarificationHints
                latestTranscriptSnippet
                rawMetrics
                createdAt
                updatedAt
                startedAt
                role
            `);

        if (!latest) {
            return res.json({ processingId: null, status: null });
        }

        const hybridState = await hydrateHybridContractFromExtractedData(latest);
        const statusTimestamp = latest.startedAt || latest.updatedAt || latest.createdAt || new Date();
        const statusAgeMs = Math.max(0, Date.now() - new Date(statusTimestamp).getTime());
        const staleProcessing = ['pending', 'processing'].includes(String(latest.status || '').toLowerCase())
            && statusAgeMs >= STALE_STATUS_THRESHOLD_MS;

        const statusObject = {
            processingId: latest._id,
            status: String(latest.status || '').toUpperCase(),
            profileData: buildProfileData(latest, hybridState),
            extractedData: latest.extractedData || null,
            createdJobId: latest.createdJobId || null,
            errorMessage: latest.errorMessage || null,
            statusAgeMs,
            staleProcessing,
            lastStatusUpdateAt: latest.updatedAt || latest.createdAt || null,
            ...hybridState,
        };

        console.log('STATUS_ENDPOINT_RETURN:', statusObject);
        return res.json(statusObject);
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
            clarificationHints
            latestTranscriptSnippet
            rawMetrics
            createdAt
            updatedAt
            startedAt
        `);

        if (!processingJob) {
            return res.status(404).json({ message: 'Interview processing job not found.' });
        }

        const hybridState = await hydrateHybridContractFromExtractedData(processingJob);
        const statusTimestamp = processingJob.startedAt || processingJob.updatedAt || processingJob.createdAt || new Date();
        const statusAgeMs = Math.max(0, Date.now() - new Date(statusTimestamp).getTime());
        const staleProcessing = ['pending', 'processing'].includes(String(processingJob.status || '').toLowerCase())
            && statusAgeMs >= STALE_STATUS_THRESHOLD_MS;

        const statusObject = {
            processingId: processingJob._id,
            status: String(processingJob.status || '').toUpperCase(),
            profileData: buildProfileData(processingJob, hybridState),
            extractedData: processingJob.extractedData || null,
            createdJobId: processingJob.createdJobId || null,
            errorMessage: processingJob.errorMessage || null,
            statusAgeMs,
            staleProcessing,
            lastStatusUpdateAt: processingJob.updatedAt || processingJob.createdAt || null,
            ...hybridState,
        };

        console.log('STATUS_ENDPOINT_RETURN:', statusObject);
        return res.json(statusObject);
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
