const Application = require('../models/Application');
const ApplicationTransitionLog = require('../models/ApplicationTransitionLog');
const Job = require('../models/Job');
const {
    normalizeSalaryBand,
    recordLifecycleEvent,
} = require('./revenueInstrumentationService');
const {
    normalizeApplicationStatus,
    canTransition,
    isCanonicalApplicationStatus,
} = require('../workflow/applicationStateMachine');

const toDurationHours = (startAt, endAt = new Date()) => {
    const start = startAt ? new Date(startAt).getTime() : NaN;
    const end = endAt ? new Date(endAt).getTime() : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Number(((end - start) / (1000 * 60 * 60)).toFixed(4));
};

const WORKFLOW_EVENT_MAP = Object.freeze({
    applied: 'APPLICATION_APPLIED',
    shortlisted: 'APPLICATION_SHORTLISTED',
    interview_requested: 'INTERVIEW_REQUESTED',
    interview_completed: 'INTERVIEW_COMPLETED',
    offer_sent: 'OFFER_SENT',
    offer_accepted: 'OFFER_ACCEPTED',
    offer_declined: 'OFFER_DECLINED',
    hired: 'APPLICATION_HIRED',
    rejected: 'APPLICATION_REJECTED',
    withdrawn: 'APPLICATION_WITHDRAWN',
});

const applySlaUpdates = ({ application, fromStatus, toStatus, actorType, now }) => {
    const nextSla = {
        ...(application.sla || {}),
    };
    const actor = String(actorType || '').toLowerCase();
    const updatedAt = application.updatedAt || application.createdAt || now;

    if (nextSla.employerResponseHours == null && fromStatus === 'applied' && ['employer', 'automation', 'system'].includes(actor)) {
        nextSla.employerResponseHours = toDurationHours(application.createdAt, now);
    }

    const candidateResponseStatuses = new Set(['interview_requested', 'offer_sent']);
    if (nextSla.candidateResponseHours == null && candidateResponseStatuses.has(fromStatus) && ['worker', 'candidate'].includes(actor)) {
        nextSla.candidateResponseHours = toDurationHours(updatedAt, now);
    }

    if (toStatus === 'hired' && nextSla.hiringDurationHours == null) {
        nextSla.hiringDurationHours = toDurationHours(application.createdAt, now);
    }

    application.sla = nextSla;
};

const applyLifecycleTimestampUpdates = ({ application, toStatus, now }) => {
    switch (toStatus) {
        case 'interview_requested':
            application.interviewRequestedAt = application.interviewRequestedAt || now;
            break;
        case 'interview_completed':
            application.interviewCompletedAt = application.interviewCompletedAt || now;
            break;
        case 'offer_sent':
            application.offerSentAt = application.offerSentAt || now;
            break;
        case 'offer_accepted':
            application.offerAcceptedAt = application.offerAcceptedAt || now;
            break;
        case 'hired':
            application.hiredAt = application.hiredAt || now;
            break;
        default:
            break;
    }
};

const resolveEventPayloadContext = async (application) => {
    const job = await Job.findById(application.job).select('location title salaryRange shift').lean();
    return {
        city: job?.location || 'Hyderabad',
        roleCluster: job?.title || 'general',
        salaryBand: normalizeSalaryBand(job?.salaryRange),
        shift: job?.shift || 'unknown',
    };
};

const transitionApplicationStatus = async ({
    applicationId = null,
    applicationDoc = null,
    nextStatus,
    actorType = 'system',
    actorId = null,
    reason = 'manual_update',
    metadata = {},
    skipValidation = false,
}) => {
    const application = applicationDoc || await Application.findById(applicationId);
    if (!application) {
        const error = new Error('Application not found');
        error.code = 'APPLICATION_NOT_FOUND';
        throw error;
    }

    const fromStatus = normalizeApplicationStatus(application.status, 'applied');
    const toStatus = normalizeApplicationStatus(nextStatus, '__invalid__');

    if (!isCanonicalApplicationStatus(toStatus)) {
        const error = new Error(`Unknown target status: ${String(nextStatus || '')}`);
        error.code = 'INVALID_TARGET_STATUS';
        throw error;
    }

    const transition = canTransition({
        fromStatus,
        toStatus,
        allowNoop: true,
    });

    if (!skipValidation && !transition.valid) {
        const error = new Error(transition.reason);
        error.code = 'INVALID_STATUS_TRANSITION';
        error.details = transition;
        throw error;
    }

    if (fromStatus === toStatus) {
        return {
            changed: false,
            application,
            fromStatus,
            toStatus,
        };
    }

    const now = new Date();
    applyLifecycleTimestampUpdates({ application, toStatus, now });
    applySlaUpdates({ application, fromStatus, toStatus, actorType, now });

    application.status = toStatus;
    application.statusChangedAt = now;
    application.lastActivityAt = now;
    if (!application.workflowMeta || typeof application.workflowMeta !== 'object') {
        application.workflowMeta = {};
    }
    if (!application.workflowMeta.remindersSent || typeof application.workflowMeta.remindersSent !== 'object') {
        application.workflowMeta.remindersSent = {
            employerNoResponse: 0,
            candidateNoResponse: 0,
            offerExpiry: 0,
        };
    }
    application.workflowMeta.lastTransitionActor = actorType;
    application.workflowMeta.lastTransitionReason = reason;
    if (application.isArchived || application.archivedAt) {
        application.isArchived = false;
        application.archivedAt = null;
    }

    await application.save();

    const transitionLog = await ApplicationTransitionLog.create({
        applicationId: application._id,
        jobId: application.job,
        employerId: application.employer,
        workerId: application.worker,
        previousStatus: fromStatus,
        nextStatus: toStatus,
        actorType,
        actorId: actorId || null,
        reason,
        metadata,
    });

    const workflowEvent = WORKFLOW_EVENT_MAP[toStatus];
    if (workflowEvent) {
        const lifecycleContext = await resolveEventPayloadContext(application);
        await recordLifecycleEvent({
            eventType: workflowEvent,
            employerId: application.employer,
            workerId: application.worker,
            userId: actorId || null,
            jobId: application.job,
            applicationId: application._id,
            city: lifecycleContext.city,
            roleCluster: lifecycleContext.roleCluster,
            salaryBand: lifecycleContext.salaryBand,
            shift: lifecycleContext.shift,
            metadata: {
                fromStatus,
                toStatus,
                actorType,
                reason,
                ...metadata,
            },
            occurredAt: now,
        });
    }

    return {
        changed: true,
        application,
        fromStatus,
        toStatus,
        transitionLog,
    };
};

module.exports = {
    transitionApplicationStatus,
    toDurationHours,
};
