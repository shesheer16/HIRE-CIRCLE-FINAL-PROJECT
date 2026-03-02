const crypto = require('crypto');
const fs = require('fs');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const InterviewSignal = require('../models/InterviewSignal');
const {
    REQUIRED_SLOT_FIELDS,
    ALL_SLOT_FIELDS,
    FALLBACK_SLOT_QUESTIONS,
} = require('../config/smartInterviewSlotConfig');
const { getNextMissingSlot } = require('./smartInterviewGapDetector');
const { generateFollowUpQuestion } = require('./smartInterviewQuestionGenerator');
const { extractSlotsFromTranscript } = require('./smartInterviewSlotEngine');
const {
    detectSalaryRealismSignal,
    detectExperienceSkillConsistencySignal,
    computeProfileQualityScore,
} = require('./smartInterviewQualityService');
const {
    deriveCommunicationMetrics,
    mergeCommunicationMetrics,
} = require('./communicationMetricsService');
const { mergeSlots } = require('./smartInterviewSlotEngine');
const {
    EMPLOYER_PRIMARY_ROLE,
    hasEmployerPrimaryRole,
    isRecruiter,
} = require('../utils/roleGuards');
const { startOfUtcDay, utcDateKey } = require('../utils/timezone');

const toInterviewRole = (user = {}) => {
    if (hasEmployerPrimaryRole(user) || isRecruiter(user)) return EMPLOYER_PRIMARY_ROLE;
    return 'worker';
};

const buildInterviewIdempotencyKey = ({ userId, videoHash }) => {
    return crypto
        .createHash('sha256')
        .update(`${String(userId || '')}:${String(videoHash || '')}`)
        .digest('hex');
};

const computeFileSha256 = async (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};

let dailyProcessingCountCache = {
    dateKey: null,
    value: 0,
    expiresAt: 0,
};

const HYBRID_DEFAULT_MAX_STEPS = 8;
const REQUIRED_CONFIDENCE_COMPLETE_THRESHOLD = 0.75;
const AMBIGUOUS_CONFIDENCE_THRESHOLD = 0.6;
const DUPLICATE_TURN_WINDOW_MS = Number.parseInt(process.env.INTERVIEW_DUPLICATE_TURN_WINDOW_MS || String(30 * 1000), 10);
const STAGNATION_GUARD_THRESHOLD = Number.parseInt(process.env.INTERVIEW_STAGNATION_GUARD_THRESHOLD || '2', 10);
const SILENCE_TIMEOUT_MS = Number.parseInt(process.env.SMART_INTERVIEW_SILENCE_TIMEOUT_MS || '15000', 10);
const MAX_TRANSCRIPT_CHARS = Number.parseInt(process.env.SMART_INTERVIEW_MAX_TRANSCRIPT_CHARS || '10000', 10);
const MAX_SESSION_DURATION_MS = Number.parseInt(process.env.SMART_INTERVIEW_MAX_DURATION_MS || String(20 * 60 * 1000), 10);
const MAX_CLARIFICATION_LOOPS = Number.parseInt(process.env.SMART_INTERVIEW_MAX_CLARIFICATION_LOOPS || '6', 10);
const RETRYABLE_EXTRACTION_ERROR_PATTERN = /(timeout|network|socket|econnreset|temporarily unavailable|fetch failed|gateway|503|500|circuit open|ai_provider|rate limit|429|invalid json|not valid json|empty model response|ai returned empty|malformed|service unavailable)/i;

const buildInterviewError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const parsePossibleNumber = (value) => {
    const normalized = String(value ?? '').replace(/[^0-9.-]/g, '').trim();
    if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') {
        return null;
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
};

const normalizeShift = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('day')) return 'day';
    if (normalized.includes('night')) return 'night';
    if (normalized.includes('flex')) return 'flexible';
    return null;
};

const normalizeAvailability = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.includes('full')) return 'full-time';
    if (normalized.includes('part')) return 'part-time';
    if (normalized.includes('contract')) return 'contract';
    return null;
};

const sanitizeOverrideValue = (field, value) => {
    if (value === null || value === undefined) return null;

    switch (field) {
        case 'fullName':
        case 'city':
        case 'primaryRole':
        case 'licenseType': {
            const normalized = String(value).trim();
            return normalized || null;
        }
        case 'primarySkills':
        case 'certifications':
        case 'languages': {
            const items = Array.isArray(value)
                ? value
                : String(value || '')
                    .split(',')
                    .map((item) => item.trim());
            return items.filter(Boolean);
        }
        case 'totalExperienceYears':
        case 'expectedSalary':
        case 'preferredWorkRadius':
            return parsePossibleNumber(value);
        case 'shiftPreference':
            return normalizeShift(value);
        case 'availabilityType':
            return normalizeAvailability(value);
        case 'vehicleOwned':
            if (typeof value === 'boolean') return value;
            if (['true', 'yes', '1'].includes(String(value).toLowerCase())) return true;
            if (['false', 'no', '0'].includes(String(value).toLowerCase())) return false;
            return null;
        default:
            return null;
    }
};

const averageRequiredConfidence = (slotConfidence = {}) => {
    if (!REQUIRED_SLOT_FIELDS.length) return 0;
    const total = REQUIRED_SLOT_FIELDS.reduce((acc, field) => acc + Number(slotConfidence[field] || 0), 0);
    return Number((total / REQUIRED_SLOT_FIELDS.length).toFixed(4));
};

const recalculateAmbiguousFields = (slotState = {}, slotConfidence = {}) => {
    return REQUIRED_SLOT_FIELDS.filter((field) => {
        const confidence = Number(slotConfidence[field] || 0);
        const valuePresent = hasValue(slotState[field]);
        return !valuePresent || confidence < AMBIGUOUS_CONFIDENCE_THRESHOLD;
    });
};

const areRequiredSlotsComplete = (slotState = {}, slotConfidence = {}) => {
    return REQUIRED_SLOT_FIELDS.every((field) => {
        const confidence = Number(slotConfidence[field] || 0);
        return hasValue(slotState[field]) && confidence >= REQUIRED_CONFIDENCE_COMPLETE_THRESHOLD;
    });
};

const evaluateHybridCompletion = ({
    slotState = {},
    slotConfidence = {},
    missingSlot,
    ambiguousFields = [],
    interviewStep = 0,
    maxSteps = HYBRID_DEFAULT_MAX_STEPS,
}) => {
    const requiredComplete = areRequiredSlotsComplete(slotState, slotConfidence);
    const reachedMaxSteps = Number(interviewStep || 0) >= Number(maxSteps || HYBRID_DEFAULT_MAX_STEPS);
    const noMissingAndNoAmbiguous = !missingSlot && (!ambiguousFields || ambiguousFields.length === 0);
    const noAmbiguities = !ambiguousFields || ambiguousFields.length === 0;
    const requiredAndClear = requiredComplete && noAmbiguities;

    const interviewComplete = reachedMaxSteps || requiredAndClear || noMissingAndNoAmbiguous;
    return {
        interviewComplete,
        requiredComplete,
        reachedMaxSteps,
        noMissingAndNoAmbiguous,
        requiredAndClear,
        noAmbiguities,
    };
};

const mapExtractedDataToSlots = (extractedData = {}) => {
    const slotState = {
        fullName: extractedData?.name || null,
        city: extractedData?.location || extractedData?.city || null,
        primaryRole: extractedData?.roleTitle || extractedData?.jobTitle || null,
        primarySkills: Array.isArray(extractedData?.skills)
            ? extractedData.skills
            : Array.isArray(extractedData?.requiredSkills)
                ? extractedData.requiredSkills
                : [],
        totalExperienceYears: parsePossibleNumber(extractedData?.experienceYears ?? extractedData?.totalExperienceYears),
        shiftPreference: normalizeShift(extractedData?.preferredShift ?? extractedData?.shift),
        expectedSalary: parsePossibleNumber(extractedData?.expectedSalary ?? extractedData?.salaryRange),
        availabilityType: normalizeAvailability(extractedData?.availabilityType),
        certifications: Array.isArray(extractedData?.certifications) ? extractedData.certifications : [],
        languages: Array.isArray(extractedData?.languages) ? extractedData.languages : [],
        vehicleOwned: typeof extractedData?.vehicleOwned === 'boolean' ? extractedData.vehicleOwned : null,
        licenseType: extractedData?.licenseType || null,
        preferredWorkRadius: parsePossibleNumber(extractedData?.preferredWorkRadius),
    };

    const baseConfidenceRaw = Number(extractedData?.confidenceScore);
    const baseConfidence = Number.isFinite(baseConfidenceRaw)
        ? (baseConfidenceRaw > 1 ? Math.max(0, Math.min(1, baseConfidenceRaw / 100)) : Math.max(0, Math.min(1, baseConfidenceRaw)))
        : 0.7;

    const slotConfidence = {};
    for (const field of ALL_SLOT_FIELDS) {
        slotConfidence[field] = hasValue(slotState[field]) ? baseConfidence : 0;
    }

    const ambiguousFields = recalculateAmbiguousFields(slotState, slotConfidence);
    const missingSlot = getNextMissingSlot(slotState, slotConfidence);
    const completionEval = evaluateHybridCompletion({
        slotState,
        slotConfidence,
        missingSlot,
        ambiguousFields,
        interviewStep: 0,
        maxSteps: HYBRID_DEFAULT_MAX_STEPS,
    });

    return {
        slotState,
        slotConfidence,
        ambiguousFields,
        missingSlot,
        interviewComplete: completionEval.interviewComplete,
    };
};

const computeAverageClarifications = (job = {}) => {
    const steps = Number(job.interviewStep || 0);
    if (!steps) return 0;
    const triggered = Number(job.clarificationTriggeredCount || 0);
    return Number((triggered / steps).toFixed(3));
};

const buildClarificationHint = (field, question, contextText = null) => {
    if (!field || !question) return null;
    return {
        [field]: {
            question,
            contextText: contextText || null,
        },
    };
};

const mergeClarificationHints = (...sources) => {
    const merged = {};
    sources.forEach((source) => {
        if (!source || typeof source !== 'object') return;
        Object.entries(source).forEach(([field, hint]) => {
            if (!field || !hint || typeof hint !== 'object') return;
            merged[field] = {
                ...(merged[field] || {}),
                ...hint,
            };
        });
    });
    return merged;
};

const getRawMetrics = (job = {}) => (job?.rawMetrics && typeof job.rawMetrics === 'object' ? job.rawMetrics : {});

const isSilenceTranscript = (transcript = '') => {
    const normalized = String(transcript || '').trim().toLowerCase();
    if (!normalized) return true;
    if (!/[a-z0-9]/i.test(normalized)) return true;
    const stripped = normalized.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!stripped) return true;
    return [
        '...',
        'uh',
        'um',
        'hmm',
        'mmm',
        'noise',
        'silent',
        'silence',
        'no answer',
        'skip',
    ].includes(stripped);
};

const isRetryableExtractionError = (error) => RETRYABLE_EXTRACTION_ERROR_PATTERN.test(String(error?.message || error || ''));

const getInterviewStartTimestamp = (job = {}) => {
    const startedAt = job?.startedAt || job?.createdAt;
    const timestamp = startedAt ? new Date(startedAt).getTime() : NaN;
    return Number.isFinite(timestamp) ? timestamp : Date.now();
};

const isSessionExpired = (job = {}) => {
    const startedAtTs = getInterviewStartTimestamp(job);
    return (Date.now() - startedAtTs) > MAX_SESSION_DURATION_MS;
};

const getClarificationLoopCount = (job = {}) => (
    Number(job?.clarificationTriggeredCount || 0)
    + Number(job?.clarificationResolvedCount || 0)
    + Number(job?.clarificationSkippedCount || 0)
);

const extractSlotsWithRetry = async ({ transcript, slotState, slotConfidence }) => {
    try {
        return await extractSlotsFromTranscript(transcript, slotState, slotConfidence);
    } catch (firstError) {
        if (!isRetryableExtractionError(firstError)) {
            throw firstError;
        }
        try {
            return await extractSlotsFromTranscript(transcript, slotState, slotConfidence);
        } catch (secondError) {
            // Keep the session alive on transient provider/network failure without inventing fields.
            const fallback = mergeSlots({
                transcript,
                existingSlotState: slotState || {},
                existingSlotConfidence: slotConfidence || {},
                extracted: { confidence: {} },
            });
            return {
                ...fallback,
                fallbackReason: String(secondError?.message || firstError?.message || 'extraction_unavailable'),
            };
        }
    }
};

const buildStateSignature = ({ slotState = {}, slotConfidence = {}, missingSlot = null, ambiguousFields = [] }) => {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({
            slotState,
            slotConfidence,
            missingSlot,
            ambiguousFields: Array.isArray(ambiguousFields) ? ambiguousFields : [],
        }))
        .digest('hex');
};

const applySmartInterviewQualitySignals = async ({
    slotState = {},
    slotConfidence = {},
    baseAmbiguousFields = [],
    interviewStep = 0,
    maxSteps = HYBRID_DEFAULT_MAX_STEPS,
    clarificationTriggeredCount = 0,
    clarificationResolvedCount = 0,
    transcriptChunk = '',
    existingRawMetrics = {},
}) => {
    const ambiguousFieldSet = new Set(baseAmbiguousFields);
    let clarificationHints = {};
    const salaryOutlierConfirmed = Boolean(existingRawMetrics.salaryOutlierConfirmed);

    const salarySignal = await detectSalaryRealismSignal({ slotState });
    if (salarySignal.salaryOutlierFlag && !salaryOutlierConfirmed) {
        ambiguousFieldSet.add('expectedSalary');
        clarificationHints = mergeClarificationHints(
            clarificationHints,
            buildClarificationHint(
                'expectedSalary',
                salarySignal.clarificationHint,
                Number.isFinite(Number(salarySignal.salaryMedianForRoleCity))
                    ? `Typical range median is around \u20b9${Math.round(Number(salarySignal.salaryMedianForRoleCity)).toLocaleString('en-IN')}.`
                    : null
            )
        );
    }

    const experienceSkillSignal = detectExperienceSkillConsistencySignal({ slotState });
    if (experienceSkillSignal.experienceSkillConsistencyFlag) {
        ambiguousFieldSet.add('totalExperienceYears');
        clarificationHints = mergeClarificationHints(
            clarificationHints,
            buildClarificationHint(
                'totalExperienceYears',
                experienceSkillSignal.clarificationHint,
                'Your listed skills usually require professional project experience.'
            )
        );
    }

    const profileQuality = computeProfileQualityScore({
        slotState,
        slotConfidence,
        requiredFields: REQUIRED_SLOT_FIELDS,
        clarificationTriggeredCount,
        clarificationResolvedCount,
        interviewStep,
        maxSteps,
        ambiguousFieldsCount: ambiguousFieldSet.size,
    });

    const transcript = String(transcriptChunk || '').trim();
    const previousCommunicationMetrics = existingRawMetrics.communicationMetricsAggregate || {};
    let communicationMetricsAggregate = previousCommunicationMetrics;

    if (transcript) {
        const currentCommunication = deriveCommunicationMetrics(transcript);
        communicationMetricsAggregate = mergeCommunicationMetrics(
            previousCommunicationMetrics,
            {
                ...currentCommunication,
                samples: 1,
            }
        );
    }

    const communicationClarityScore = Number(
        communicationMetricsAggregate.communicationClarityScore
        ?? existingRawMetrics.communicationClarityScore
        ?? 0
    );
    const confidenceLanguageScore = Number(
        communicationMetricsAggregate.confidenceLanguageScore
        ?? existingRawMetrics.confidenceLanguageScore
        ?? 0
    );

    return {
        ambiguousFields: Array.from(ambiguousFieldSet),
        clarificationHints,
        qualityMetrics: {
            ...profileQuality,
            salaryOutlierFlag: Boolean(salarySignal.salaryOutlierFlag),
            salaryOutlierConfirmed,
            salaryMedianForRoleCity: salarySignal.salaryMedianForRoleCity ?? null,
            salaryRealismRatio: salarySignal.salaryRealismRatio ?? null,
            experienceSkillConsistencyFlag: Boolean(experienceSkillSignal.experienceSkillConsistencyFlag),
            communicationClarityScore: Number.isFinite(communicationClarityScore)
                ? Number(communicationClarityScore.toFixed(4))
                : 0,
            confidenceLanguageScore: Number.isFinite(confidenceLanguageScore)
                ? Number(confidenceLanguageScore.toFixed(4))
                : 0,
            communicationMetricsAggregate,
        },
    };
};

const toHybridPayload = (job = {}) => ({
    slotState: job.slotState || {},
    slotConfidence: job.slotConfidence || {},
    ambiguousFields: Array.isArray(job.ambiguousFields) ? job.ambiguousFields : [],
    missingSlot: job.missingSlot || null,
    interviewComplete: Boolean(job.interviewComplete),
    interviewStep: Number(job.interviewStep || 0),
    maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
    adaptiveQuestion: job.adaptiveQuestion || null,
    clarificationMode: Array.isArray(job.ambiguousFields) && job.ambiguousFields.length > 0,
    clarificationTriggeredCount: Number(job.clarificationTriggeredCount || 0),
    clarificationResolvedCount: Number(job.clarificationResolvedCount || 0),
    clarificationSkippedCount: Number(job.clarificationSkippedCount || 0),
    averageClarificationsPerInterview: computeAverageClarifications(job),
    clarificationHints: job.clarificationHints || {},
    latestTranscriptSnippet: job.latestTranscriptSnippet || null,
    profileQualityScore: Number(job.rawMetrics?.profileQualityScore || 0),
    slotCompletenessRatio: Number(job.rawMetrics?.slotCompletenessRatio || 0),
    ambiguityRate: Number(job.rawMetrics?.ambiguityRate || 0),
    communicationClarityScore: Number(job.rawMetrics?.communicationClarityScore || 0),
    confidenceLanguageScore: Number(job.rawMetrics?.confidenceLanguageScore || 0),
    salaryOutlierFlag: Boolean(job.rawMetrics?.salaryOutlierFlag),
    salaryOutlierConfirmed: Boolean(job.rawMetrics?.salaryOutlierConfirmed),
    salaryMedianForRoleCity: job.rawMetrics?.salaryMedianForRoleCity ?? null,
    salaryRealismRatio: job.rawMetrics?.salaryRealismRatio ?? null,
    clarificationBudgetExceeded: Boolean(job.rawMetrics?.clarificationBudgetExceeded),
    extractionFallbackReason: job.rawMetrics?.extractionFallbackReason || null,
});

const hydrateHybridContractFromExtractedData = async (job) => {
    if (!job || job.slotState && Object.keys(job.slotState).length) {
        return toHybridPayload(job);
    }
    if (!job.extractedData || typeof job.extractedData !== 'object') {
        return toHybridPayload(job);
    }

    const hydrated = mapExtractedDataToSlots(job.extractedData);
    const existingRawMetrics = getRawMetrics(job);
    const qualitySignal = await applySmartInterviewQualitySignals({
        slotState: hydrated.slotState,
        slotConfidence: hydrated.slotConfidence,
        baseAmbiguousFields: hydrated.ambiguousFields,
        interviewStep: Number(job.interviewStep || 0),
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
        clarificationTriggeredCount: Number(job.clarificationTriggeredCount || 0),
        clarificationResolvedCount: Number(job.clarificationResolvedCount || 0),
        transcriptChunk: '',
        existingRawMetrics,
    });
    const rawMissingSlot = getNextMissingSlot(hydrated.slotState, hydrated.slotConfidence);
    const completionEval = evaluateHybridCompletion({
        slotState: hydrated.slotState,
        slotConfidence: hydrated.slotConfidence,
        missingSlot: rawMissingSlot,
        ambiguousFields: qualitySignal.ambiguousFields,
        interviewStep: Number(job.interviewStep || 0),
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
    });
    const effectiveMissingSlot = completionEval.interviewComplete ? null : rawMissingSlot;

    job.slotState = hydrated.slotState;
    job.slotConfidence = hydrated.slotConfidence;
    job.ambiguousFields = qualitySignal.ambiguousFields;
    job.missingSlot = effectiveMissingSlot;
    job.interviewComplete = completionEval.interviewComplete;
    job.clarificationHints = qualitySignal.clarificationHints;
    job.adaptiveQuestion = effectiveMissingSlot && !qualitySignal.ambiguousFields.length
        ? await generateFollowUpQuestion(effectiveMissingSlot, hydrated.slotState)
        : null;
    job.rawMetrics = {
        ...existingRawMetrics,
        confidenceScore: averageRequiredConfidence(hydrated.slotConfidence),
        profileQualityScore: qualitySignal.qualityMetrics.profileQualityScore,
        slotCompletenessRatio: qualitySignal.qualityMetrics.slotCompletenessRatio,
        ambiguityRate: qualitySignal.qualityMetrics.ambiguityRate,
        communicationClarityScore: qualitySignal.qualityMetrics.communicationClarityScore,
        confidenceLanguageScore: qualitySignal.qualityMetrics.confidenceLanguageScore,
        salaryOutlierFlag: qualitySignal.qualityMetrics.salaryOutlierFlag,
        salaryMedianForRoleCity: qualitySignal.qualityMetrics.salaryMedianForRoleCity,
        salaryRealismRatio: qualitySignal.qualityMetrics.salaryRealismRatio,
        experienceSkillConsistencyFlag: qualitySignal.qualityMetrics.experienceSkillConsistencyFlag,
        communicationMetricsAggregate: qualitySignal.qualityMetrics.communicationMetricsAggregate,
    };
    await job.save();
    return toHybridPayload(job);
};

const createHybridInterviewSession = async ({ user, maxSteps }) => {
    if (!user?._id) {
        throw buildInterviewError('Authenticated user is required to start Smart Interview.', 401);
    }

    const existingActive = await InterviewProcessingJob.findOne({
        userId: user._id,
        status: { $in: ['pending', 'processing'] },
        videoUrl: { $regex: /^hybrid:\/\/session\// },
    }).sort({ createdAt: -1 });

    if (existingActive) {
        if (!isSessionExpired(existingActive)) {
            existingActive._reusedSession = true;
            return existingActive;
        }

        existingActive.status = 'failed';
        existingActive.errorMessage = 'Interview session expired due to inactivity.';
        existingActive.completedAt = new Date();
        existingActive.turnLockUntil = null;
        if (typeof existingActive.save === 'function') {
            await existingActive.save();
        } else {
            await InterviewProcessingJob.updateOne(
                { _id: existingActive._id },
                {
                    $set: {
                        status: 'failed',
                        errorMessage: 'Interview session expired due to inactivity.',
                        completedAt: new Date(),
                        turnLockUntil: null,
                    },
                }
            );
        }
    }

    const role = toInterviewRole(user);
    const videoHash = crypto.randomBytes(16).toString('hex');
    const idempotencyKey = crypto
        .createHash('sha256')
        .update(`hybrid:${String(user?._id || '')}:${Date.now()}:${videoHash}`)
        .digest('hex');

    const slotState = {};
    const slotConfidence = {};
    const missingSlot = getNextMissingSlot(slotState, slotConfidence);
    const adaptiveQuestion = await generateFollowUpQuestion(missingSlot, slotState);
    const effectiveMaxSteps = Math.min(8, Math.max(1, Number(maxSteps || HYBRID_DEFAULT_MAX_STEPS)));
    const initialStateSignature = buildStateSignature({
        slotState,
        slotConfidence,
        missingSlot,
        ambiguousFields: [],
    });

    try {
        const job = await InterviewProcessingJob.create({
            userId: user._id,
            role,
            videoUrl: `hybrid://session/${idempotencyKey}`,
            videoHash,
            idempotencyKey,
            status: 'processing',
            startedAt: new Date(),
            slotState,
            slotConfidence,
            ambiguousFields: [],
            missingSlot,
            interviewComplete: false,
            interviewStep: 0,
            maxSteps: effectiveMaxSteps,
            adaptiveQuestion,
            lastStateSignature: initialStateSignature,
            stagnationCount: 0,
        });

        return job;
    } catch (error) {
        if (Number(error?.code) === 11000) {
            const fallbackActiveJob = await InterviewProcessingJob.findOne({
                userId: user._id,
                status: { $in: ['pending', 'processing'] },
                videoUrl: { $regex: /^hybrid:\/\/session\// },
            }).sort({ createdAt: -1 });
            if (fallbackActiveJob) {
                fallbackActiveJob._reusedSession = true;
                return fallbackActiveJob;
            }
        }
        throw buildInterviewError('Unable to start Smart Interview session right now.', 503);
    }
};

const processHybridTurn = async ({ job, transcriptChunk }) => {
    if (!job || typeof job !== 'object') {
        throw buildInterviewError('Invalid interview job', 400);
    }
    const jobIdentity = String(job._id || job.id || job.idempotencyKey || job.userId || 'standalone');

    if (job.status === 'failed') {
        throw buildInterviewError('Interview session has failed. Please restart.', 409);
    }

    if (isSessionExpired(job)) {
        job.status = 'failed';
        job.errorMessage = 'Interview session expired due to inactivity.';
        job.completedAt = job.completedAt || new Date();
        job.turnLockUntil = null;
        if (typeof job.save === 'function') {
            await job.save();
        }
        throw buildInterviewError('Interview session expired. Please restart to continue.', 410);
    }

    if (job.status === 'completed' || job.interviewComplete) {
        job.turnLockUntil = null;
        if (typeof job.save === 'function') {
            await job.save();
        }
        return toHybridPayload(job);
    }

    const normalizedTranscript = String(transcriptChunk || '').trim();
    if (!normalizedTranscript) {
        throw buildInterviewError('transcriptChunk is required', 400);
    }
    if (normalizedTranscript.length > MAX_TRANSCRIPT_CHARS) {
        throw buildInterviewError(`transcriptChunk exceeds max length of ${MAX_TRANSCRIPT_CHARS} characters`, 413);
    }

    const existingRawMetrics = {
        ...getRawMetrics(job),
    };

    if (isSilenceTranscript(normalizedTranscript)) {
        const nowMs = Date.now();
        const silenceSinceTs = Number(existingRawMetrics.silenceSinceTs || nowMs);
        const silenceElapsedMs = nowMs - silenceSinceTs;
        const silenceEvents = Number(existingRawMetrics.silenceEvents || 0) + 1;

        job.rawMetrics = {
            ...existingRawMetrics,
            silenceSinceTs,
            silenceEvents,
            lastSilenceAt: new Date(),
        };
        job.latestTranscriptSnippet = null;
        job.turnLockUntil = null;
        job.adaptiveQuestion = job.adaptiveQuestion
            || FALLBACK_SLOT_QUESTIONS[job.missingSlot]
            || 'Please answer in one short sentence.';

        if (silenceElapsedMs >= SILENCE_TIMEOUT_MS) {
            if (typeof job.save === 'function') {
                await job.save();
            }
            const timeoutError = new Error('Silence timeout exceeded. Please provide a verbal response.');
            timeoutError.statusCode = 408;
            throw timeoutError;
        }

        if (typeof job.save === 'function') {
            await job.save();
        }

        return {
            ...toHybridPayload(job),
            silenceDetected: true,
            retrySuggested: true,
        };
    }
    existingRawMetrics.silenceSinceTs = null;

    const turnSignature = crypto
        .createHash('sha256')
        .update(`${jobIdentity}:${normalizedTranscript.toLowerCase()}`)
        .digest('hex');
    const duplicateWindowActive = Boolean(
        job.lastTurnSignature
        && job.lastTurnAt
        && job.lastTurnSignature === turnSignature
        && ((Date.now() - new Date(job.lastTurnAt).getTime()) <= DUPLICATE_TURN_WINDOW_MS)
    );
    if (duplicateWindowActive) {
        job.turnLockUntil = null;
        if (typeof job.save === 'function') {
            await job.save();
        }
        return toHybridPayload(job);
    }

    const extraction = await extractSlotsWithRetry({
        transcript: normalizedTranscript,
        slotState: job.slotState || {},
        slotConfidence: job.slotConfidence || {},
    });

    const nextStep = Math.min(Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS), Number(job.interviewStep || 0) + 1);
    const previousExpectedSalary = parsePossibleNumber(job?.slotState?.expectedSalary);
    const nextExpectedSalary = parsePossibleNumber(extraction?.slotState?.expectedSalary);
    if (
        Number.isFinite(previousExpectedSalary)
        && Number.isFinite(nextExpectedSalary)
        && previousExpectedSalary !== nextExpectedSalary
    ) {
        existingRawMetrics.salaryOutlierConfirmed = false;
    }
    const baseAmbiguousFields = recalculateAmbiguousFields(extraction.slotState, extraction.slotConfidence);
    const qualitySignal = await applySmartInterviewQualitySignals({
        slotState: extraction.slotState,
        slotConfidence: extraction.slotConfidence,
        baseAmbiguousFields,
        interviewStep: nextStep,
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
        clarificationTriggeredCount: Number(job.clarificationTriggeredCount || 0),
        clarificationResolvedCount: Number(job.clarificationResolvedCount || 0),
        transcriptChunk: normalizedTranscript,
        existingRawMetrics,
    });
    const clarificationLoopCount = getClarificationLoopCount(job);
    const clarificationBudgetExceeded = clarificationLoopCount >= MAX_CLARIFICATION_LOOPS;
    const ambiguousFields = clarificationBudgetExceeded ? [] : qualitySignal.ambiguousFields;
    const rawMissingSlot = getNextMissingSlot(extraction.slotState, extraction.slotConfidence);
    const completionEval = evaluateHybridCompletion({
        slotState: extraction.slotState,
        slotConfidence: extraction.slotConfidence,
        missingSlot: rawMissingSlot,
        ambiguousFields,
        interviewStep: nextStep,
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
    });
    const nextStateSignature = buildStateSignature({
        slotState: extraction.slotState,
        slotConfidence: extraction.slotConfidence,
        missingSlot: rawMissingSlot,
        ambiguousFields,
    });
    const previousStateSignature = String(job.lastStateSignature || '');
    const stagnationCount = previousStateSignature && previousStateSignature === nextStateSignature
        ? Number(job.stagnationCount || 0) + 1
        : 0;
    const maxStepValue = Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS);
    const shouldForceCompleteForStagnation = (
        !completionEval.interviewComplete
        && stagnationCount >= STAGNATION_GUARD_THRESHOLD
        && nextStep >= Math.max(1, maxStepValue - 1)
    );
    const shouldForceCompleteForClarificationBudget = (
        clarificationBudgetExceeded
        && !completionEval.interviewComplete
        && nextStep >= Math.max(1, maxStepValue - 1)
    );
    const interviewComplete = (
        completionEval.interviewComplete
        || shouldForceCompleteForStagnation
        || shouldForceCompleteForClarificationBudget
    );
    const missingSlot = interviewComplete ? null : rawMissingSlot;
    const leadingAmbiguousField = ambiguousFields[0] || null;
    const ambiguousQuestion = leadingAmbiguousField
        ? qualitySignal.clarificationHints?.[leadingAmbiguousField]?.question || FALLBACK_SLOT_QUESTIONS[leadingAmbiguousField]
        : null;
    const adaptiveQuestion = interviewComplete
        ? null
        : ambiguousFields.length
            ? ambiguousQuestion
            : await generateFollowUpQuestion(missingSlot, extraction.slotState);

    job.slotState = extraction.slotState;
    job.slotConfidence = extraction.slotConfidence;
    job.ambiguousFields = ambiguousFields;
    job.missingSlot = missingSlot;
    job.interviewStep = nextStep;
    job.interviewComplete = interviewComplete;
    job.adaptiveQuestion = adaptiveQuestion;
    job.latestTranscriptSnippet = normalizedTranscript.slice(0, 220) || null;
    job.lastTurnSignature = turnSignature;
    job.lastTurnAt = new Date();
    job.lastStateSignature = nextStateSignature;
    job.stagnationCount = stagnationCount;
    job.clarificationHints = qualitySignal.clarificationHints;
    if (ambiguousFields.length) {
        job.clarificationTriggeredCount = Number(job.clarificationTriggeredCount || 0) + 1;
    }

    job.rawMetrics = {
        ...existingRawMetrics,
        confidenceScore: averageRequiredConfidence(job.slotConfidence),
        profileQualityScore: qualitySignal.qualityMetrics.profileQualityScore,
        slotCompletenessRatio: qualitySignal.qualityMetrics.slotCompletenessRatio,
        ambiguityRate: qualitySignal.qualityMetrics.ambiguityRate,
        communicationClarityScore: qualitySignal.qualityMetrics.communicationClarityScore,
        confidenceLanguageScore: qualitySignal.qualityMetrics.confidenceLanguageScore,
        salaryOutlierFlag: qualitySignal.qualityMetrics.salaryOutlierFlag,
        salaryOutlierConfirmed: qualitySignal.qualityMetrics.salaryOutlierConfirmed,
        salaryMedianForRoleCity: qualitySignal.qualityMetrics.salaryMedianForRoleCity,
        salaryRealismRatio: qualitySignal.qualityMetrics.salaryRealismRatio,
        experienceSkillConsistencyFlag: qualitySignal.qualityMetrics.experienceSkillConsistencyFlag,
        communicationMetricsAggregate: qualitySignal.qualityMetrics.communicationMetricsAggregate,
        stagnationCount,
        clarificationBudgetExceeded,
        extractionFallbackReason: extraction?.fallbackReason || null,
    };

    if (interviewComplete) {
        job.status = 'completed';
        job.completedAt = job.completedAt || new Date();
    }
    job.turnLockUntil = null;

    if (
        qualitySignal.qualityMetrics.salaryOutlierFlag
        && !Boolean(existingRawMetrics.salaryOutlierFlag)
    ) {
        await trackInterviewEvent({
            userId: job.userId,
            eventName: 'SMART_INTERVIEW_SALARY_OUTLIER_FLAGGED',
            processingId: job._id,
            role: job.role,
            durationMs: 0,
        });
    }

    if (typeof job.save === 'function') {
        await job.save();
    }
    return toHybridPayload(job);
};

const applyClarificationOverride = async ({ job, overrideField, value, skip = false }) => {
    if (!job || typeof job !== 'object') {
        throw buildInterviewError('Invalid interview job', 400);
    }
    if (isSessionExpired(job)) {
        job.status = 'failed';
        job.errorMessage = 'Interview session expired due to inactivity.';
        job.completedAt = job.completedAt || new Date();
        job.turnLockUntil = null;
        if (typeof job.save === 'function') {
            await job.save();
        }
        throw buildInterviewError('Interview session expired. Please restart to continue.', 410);
    }

    const field = String(overrideField || '').trim();
    if (!ALL_SLOT_FIELDS.includes(field)) {
        throw buildInterviewError('Invalid overrideField', 400);
    }

    const slotState = { ...(job.slotState || {}) };
    const slotConfidence = { ...(job.slotConfidence || {}) };
    if (skip) {
        job.clarificationSkippedCount = Number(job.clarificationSkippedCount || 0) + 1;
    } else {
        const sanitized = sanitizeOverrideValue(field, value);
        if (!hasValue(sanitized)) {
            throw buildInterviewError('Invalid override value', 400);
        }

        slotState[field] = sanitized;
        slotConfidence[field] = 1;
        job.clarificationResolvedCount = Number(job.clarificationResolvedCount || 0) + 1;
    }

    const existingRawMetrics = {
        ...getRawMetrics(job),
    };
    if (field === 'expectedSalary' && !skip) {
        existingRawMetrics.salaryOutlierConfirmed = true;
    }
    const baseAmbiguousFields = recalculateAmbiguousFields(slotState, slotConfidence);
    const qualitySignal = await applySmartInterviewQualitySignals({
        slotState,
        slotConfidence,
        baseAmbiguousFields,
        interviewStep: Number(job.interviewStep || 0),
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
        clarificationTriggeredCount: Number(job.clarificationTriggeredCount || 0),
        clarificationResolvedCount: Number(job.clarificationResolvedCount || 0),
        transcriptChunk: '',
        existingRawMetrics,
    });
    const clarificationLoopCount = getClarificationLoopCount(job);
    const clarificationBudgetExceeded = clarificationLoopCount >= MAX_CLARIFICATION_LOOPS;
    const ambiguousFields = clarificationBudgetExceeded ? [] : qualitySignal.ambiguousFields;
    const rawMissingSlot = getNextMissingSlot(slotState, slotConfidence);
    const completionEval = evaluateHybridCompletion({
        slotState,
        slotConfidence,
        missingSlot: rawMissingSlot,
        ambiguousFields,
        interviewStep: Number(job.interviewStep || 0),
        maxSteps: Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS),
    });
    const interviewComplete = completionEval.interviewComplete
        || (clarificationBudgetExceeded && Number(job.interviewStep || 0) >= Math.max(1, Number(job.maxSteps || HYBRID_DEFAULT_MAX_STEPS) - 1));
    const missingSlot = interviewComplete ? null : rawMissingSlot;

    job.slotState = slotState;
    job.slotConfidence = slotConfidence;
    job.ambiguousFields = ambiguousFields;
    job.missingSlot = missingSlot;
    job.interviewComplete = interviewComplete;
    job.clarificationHints = qualitySignal.clarificationHints;
    job.adaptiveQuestion = interviewComplete
        ? null
        : ambiguousFields.length
            ? (qualitySignal.clarificationHints?.[ambiguousFields[0]]?.question || FALLBACK_SLOT_QUESTIONS[ambiguousFields[0]] || null)
            : (FALLBACK_SLOT_QUESTIONS[missingSlot] || null);
    job.rawMetrics = {
        ...existingRawMetrics,
        confidenceScore: averageRequiredConfidence(slotConfidence),
        profileQualityScore: qualitySignal.qualityMetrics.profileQualityScore,
        slotCompletenessRatio: qualitySignal.qualityMetrics.slotCompletenessRatio,
        ambiguityRate: qualitySignal.qualityMetrics.ambiguityRate,
        communicationClarityScore: qualitySignal.qualityMetrics.communicationClarityScore,
        confidenceLanguageScore: qualitySignal.qualityMetrics.confidenceLanguageScore,
        salaryOutlierFlag: qualitySignal.qualityMetrics.salaryOutlierFlag,
        salaryOutlierConfirmed: qualitySignal.qualityMetrics.salaryOutlierConfirmed,
        salaryMedianForRoleCity: qualitySignal.qualityMetrics.salaryMedianForRoleCity,
        salaryRealismRatio: qualitySignal.qualityMetrics.salaryRealismRatio,
        experienceSkillConsistencyFlag: qualitySignal.qualityMetrics.experienceSkillConsistencyFlag,
        communicationMetricsAggregate: qualitySignal.qualityMetrics.communicationMetricsAggregate,
        clarificationBudgetExceeded,
    };
    job.lastStateSignature = buildStateSignature({
        slotState,
        slotConfidence,
        missingSlot,
        ambiguousFields,
    });
    job.stagnationCount = 0;

    if (interviewComplete) {
        job.status = 'completed';
        job.completedAt = job.completedAt || new Date();
    }
    job.turnLockUntil = null;

    await job.save();
    return toHybridPayload(job);
};

const getDailyProcessingCount = async () => {
    const now = Date.now();
    const currentDateKey = utcDateKey(now);

    if (
        dailyProcessingCountCache.expiresAt > now &&
        dailyProcessingCountCache.dateKey === currentDateKey
    ) {
        return dailyProcessingCountCache.value;
    }

    const startOfDay = startOfUtcDay(now);

    const count = await InterviewProcessingJob.countDocuments({
        createdAt: { $gte: startOfDay },
    });

    dailyProcessingCountCache = {
        dateKey: currentDateKey,
        value: count,
        expiresAt: now + 30_000,
    };

    return count;
};

const transitionProcessingStatus = async ({
    processingId,
    fromStatus,
    toStatus,
    set = {},
    unset = {},
}) => {
    const allowedTransitions = {
        pending: new Set(['processing']),
        processing: new Set(['completed', 'failed']),
        failed: new Set(['pending']),
        completed: new Set(),
    };

    if (!allowedTransitions[fromStatus]?.has(toStatus)) {
        console.warn(`Invalid interview status transition attempted: ${fromStatus} -> ${toStatus}`);
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }

    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;

    return InterviewProcessingJob.updateOne(
        { _id: processingId, status: fromStatus },
        update
    );
};

const trackInterviewEvent = async ({
    userId,
    eventName,
    processingId,
    role,
    durationMs,
    errorType,
}) => {
    if (!eventName) return;

    try {
        await AnalyticsEvent.create({
            user: userId || null,
            eventName,
            metadata: {
                processingId: processingId ? String(processingId) : null,
                role: role || null,
                durationMs: Number.isFinite(durationMs) ? durationMs : null,
                errorType: errorType || null,
            },
        });
    } catch (error) {
        console.warn('Interview analytics tracking failed:', error.message);
    }
};

const markProfileConfirmed = async ({ processingId, userId }) => {
    if (!processingId) return null;

    return InterviewProcessingJob.findOneAndUpdate(
        { _id: processingId, userId },
        { $set: { profileConfirmedAt: new Date() } },
        { new: true }
    );
};

const markJobConfirmed = async ({ processingId, userId }) => {
    if (!processingId) return null;

    return InterviewProcessingJob.findOneAndUpdate(
        { _id: processingId, userId },
        { $set: { jobConfirmedAt: new Date() } },
        { new: true }
    );
};

const finalizeInterviewSignalIfEligible = async ({ processingId, userId }) => {
    if (!processingId) return { finalized: false, reason: 'missing_processing_id' };

    const job = await InterviewProcessingJob.findOne({ _id: processingId, userId });
    if (!job) return { finalized: false, reason: 'processing_not_found' };
    if (job.status !== 'completed') return { finalized: false, reason: 'processing_not_completed' };
    if (job.signalFinalizedAt) return { finalized: true, reason: 'already_finalized' };

    const needsJobConfirmation = job.role === EMPLOYER_PRIMARY_ROLE;
    if (!job.profileConfirmedAt) return { finalized: false, reason: 'profile_not_confirmed' };
    if (needsJobConfirmation && !job.jobConfirmedAt) return { finalized: false, reason: 'job_not_confirmed' };

    await InterviewSignal.findOneAndUpdate(
        { processingId: job._id },
        {
            $setOnInsert: {
                userId: job.userId,
                role: job.role,
                processingId: job._id,
                videoDuration: job.rawMetrics?.videoDuration ?? null,
                transcriptWordCount: job.rawMetrics?.transcriptWordCount ?? null,
                confidenceScore: job.rawMetrics?.confidenceScore ?? null,
            },
        },
        { upsert: true, new: true }
    );

    await InterviewProcessingJob.updateOne(
        { _id: job._id, signalFinalizedAt: null },
        { $set: { signalFinalizedAt: new Date() } }
    );

    return { finalized: true, reason: 'created' };
};

module.exports = {
    HYBRID_DEFAULT_MAX_STEPS,
    toInterviewRole,
    buildInterviewIdempotencyKey,
    computeFileSha256,
    getDailyProcessingCount,
    transitionProcessingStatus,
    trackInterviewEvent,
    createHybridInterviewSession,
    processHybridTurn,
    applyClarificationOverride,
    hydrateHybridContractFromExtractedData,
    toHybridPayload,
    mapExtractedDataToSlots,
    markProfileConfirmed,
    markJobConfirmed,
    finalizeInterviewSignalIfEligible,
};
