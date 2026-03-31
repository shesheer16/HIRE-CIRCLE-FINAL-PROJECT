const CANONICAL_APPLICATION_STATUSES = Object.freeze([
    'applied',
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'offer_declined',
    'hired',
    'rejected',
    'withdrawn',
]);

const LEGACY_STATUS_ALIASES = Object.freeze({
    requested: 'applied',
    pending: 'applied',
    accepted: 'offer_accepted',
    interview: 'interview_requested',
    offer_proposed: 'offer_sent',
});

const TERMINAL_STATUSES = Object.freeze(new Set([
    'hired',
    'rejected',
    'withdrawn',
]));

const TRANSITION_MAP = Object.freeze({
    applied: Object.freeze(['shortlisted', 'rejected', 'withdrawn']),
    shortlisted: Object.freeze(['interview_requested', 'rejected', 'withdrawn']),
    interview_requested: Object.freeze(['interview_completed', 'rejected', 'withdrawn']),
    interview_completed: Object.freeze(['offer_sent', 'interview_requested', 'rejected']),
    offer_sent: Object.freeze(['offer_accepted', 'offer_declined', 'rejected', 'withdrawn']),
    offer_accepted: Object.freeze(['hired', 'rejected']),
    offer_declined: Object.freeze(['rejected']),
    hired: Object.freeze([]),
    rejected: Object.freeze([]),
    withdrawn: Object.freeze([]),
});

const EMPLOYER_PIPELINE_COLUMN = Object.freeze({
    applied: 'Applied',
    shortlisted: 'Shortlisted',
    interview_requested: 'Interviewing',
    interview_completed: 'Interviewing',
    offer_sent: 'Offer',
    offer_accepted: 'Offer',
    offer_declined: 'Offer',
    hired: 'Hired',
    rejected: 'Closed',
    withdrawn: 'Closed',
});

const WORKER_NEXT_ACTION = Object.freeze({
    applied: 'Await employer review',
    shortlisted: 'Prepare for interview',
    interview_requested: 'Respond to interview schedule',
    interview_completed: 'Await employer decision',
    offer_sent: 'Review and respond to offer',
    offer_accepted: 'Await onboarding confirmation',
    offer_declined: 'Application closed',
    hired: 'Begin onboarding',
    rejected: 'Application closed',
    withdrawn: 'Application withdrawn',
});

const STAGE_ETA_DAYS = Object.freeze({
    applied: 5,
    shortlisted: 4,
    interview_requested: 3,
    interview_completed: 3,
    offer_sent: 7,
    offer_accepted: 2,
    offer_declined: 0,
    hired: 0,
    rejected: 0,
    withdrawn: 0,
});

const normalizeApplicationStatus = (status, fallback = 'applied') => {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (CANONICAL_APPLICATION_STATUSES.includes(normalized)) return normalized;
    if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS_ALIASES, normalized)) {
        return LEGACY_STATUS_ALIASES[normalized];
    }
    return fallback;
};

const isCanonicalApplicationStatus = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    return CANONICAL_APPLICATION_STATUSES.includes(normalized);
};

const getAllowedTransitions = (fromStatus) => {
    const normalized = normalizeApplicationStatus(fromStatus);
    return [...(TRANSITION_MAP[normalized] || [])];
};

const canTransition = ({ fromStatus, toStatus, allowNoop = true }) => {
    const from = normalizeApplicationStatus(fromStatus);
    const to = normalizeApplicationStatus(toStatus, '__invalid__');

    if (!isCanonicalApplicationStatus(to)) {
        return {
            valid: false,
            reason: `Unknown target status: ${String(toStatus || '')}`,
            fromStatus: from,
            toStatus: to,
        };
    }

    if (from === to) {
        return {
            valid: Boolean(allowNoop),
            reason: allowNoop ? 'noop' : `No-op transition is disabled: ${from} -> ${to}`,
            fromStatus: from,
            toStatus: to,
        };
    }

    const allowedTargets = TRANSITION_MAP[from] || [];
    const valid = allowedTargets.includes(to);
    return {
        valid,
        reason: valid ? 'ok' : `Invalid transition: ${from} -> ${to}`,
        fromStatus: from,
        toStatus: to,
    };
};

const isTerminalStatus = (status) => TERMINAL_STATUSES.has(normalizeApplicationStatus(status));

const resolveEmployerPipelineColumn = (status) => EMPLOYER_PIPELINE_COLUMN[normalizeApplicationStatus(status)] || 'Applied';

const resolveWorkerNextAction = (status) => WORKER_NEXT_ACTION[normalizeApplicationStatus(status)] || 'Await update';

const estimateTimelineDays = (status) => {
    const normalized = normalizeApplicationStatus(status);
    return Number(STAGE_ETA_DAYS[normalized] || 0);
};

module.exports = {
    CANONICAL_APPLICATION_STATUSES,
    LEGACY_STATUS_ALIASES,
    TRANSITION_MAP,
    normalizeApplicationStatus,
    isCanonicalApplicationStatus,
    getAllowedTransitions,
    canTransition,
    isTerminalStatus,
    resolveEmployerPipelineColumn,
    resolveWorkerNextAction,
    estimateTimelineDays,
};
