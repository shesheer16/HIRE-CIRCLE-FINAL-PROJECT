const LEGACY_STATUS_ALIASES = Object.freeze({
    requested: 'applied',
    pending: 'applied',
    apply: 'applied',
    interview: 'interview_requested',
    accepted: 'offer_accepted',
    offer_proposed: 'offer_sent',
    shortlisted_by_employer: 'shortlisted',
    interview_scheduled: 'interview_requested',
    offered: 'offer_sent',
    hired_candidate: 'hired',
});

const STATUS_LABEL_MAP = Object.freeze({
    applied: 'Applied',
    shortlisted: 'Shortlisted',
    interview_requested: 'Interview',
    interview_completed: 'Interview',
    offer_sent: 'Offer',
    offer_accepted: 'Offer',
    hired: 'Hired',
    rejected: 'Rejected',
    withdrawn: 'Rejected',
    expired: 'Rejected',
    offer_declined: 'Rejected',
    archived: 'Archived',
});

export const APPLICATION_FILTER_STATUS_GROUPS = Object.freeze({
    All: null,
    Applied: new Set(['applied']),
    Shortlisted: new Set(['shortlisted']),
    Interview: new Set(['interview_requested', 'interview_completed']),
    Offer: new Set(['offer_sent', 'offer_accepted']),
    Hired: new Set(['hired']),
    Rejected: new Set(['rejected', 'withdrawn', 'expired', 'offer_declined']),
    Archived: new Set(['archived']),
});

export const APPLICATION_FILTER_OPTIONS = Object.freeze([
    'All',
    'Applied',
    'Shortlisted',
    'Interview',
    'Offer',
    'Hired',
    'Rejected',
    'Archived',
]);

export const APPLICATION_STATUS_COLOR_MAP = Object.freeze({
    Applied: '#94a3b8',
    Shortlisted: '#f59e0b',
    Interview: '#9333ea',
    Offer: '#0ea5e9',
    Hired: '#10b981',
    Rejected: '#ef4444',
    Archived: '#64748b',
});

export const CHAT_READY_APPLICATION_STATUSES = new Set([
    'shortlisted',
    'interview_requested',
    'interview_completed',
    'offer_sent',
    'offer_accepted',
    'hired',
]);

export const APPLICATION_TIMELINE_MILESTONES = Object.freeze([
    { key: 'applied', label: 'Applied', icon: '📝', matches: ['applied'] },
    { key: 'shortlisted', label: 'Shortlisted', icon: '⭐', matches: ['shortlisted'] },
    { key: 'interview', label: 'Interview', icon: '📅', matches: ['interview_requested', 'interview_completed'] },
    { key: 'offer', label: 'Offer', icon: '📬', matches: ['offer_sent', 'offer_accepted'] },
    { key: 'hired', label: 'Hired', icon: '✅', matches: ['hired'] },
    { key: 'escrow_funded', label: 'Escrow Funded', icon: '🔐', matches: ['escrow_funded'] },
    { key: 'work_started', label: 'Work Started', icon: '🚀', matches: ['work_started'] },
    { key: 'work_completed', label: 'Work Completed', icon: '🏁', matches: ['work_completed'] },
    { key: 'payment_released', label: 'Payment Released', icon: '💸', matches: ['payment_released'] },
]);

export const normalizeApplicationStatus = (status, fallback = 'applied') => {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return fallback;
    return LEGACY_STATUS_ALIASES[normalized] || normalized;
};

export const getApplicationStatusLabel = (status) => (
    STATUS_LABEL_MAP[normalizeApplicationStatus(status)] || 'Applied'
);

export const isChatReadyForApplicationStatus = (status) => (
    CHAT_READY_APPLICATION_STATUSES.has(normalizeApplicationStatus(status))
);

export const doesApplicationStatusMatchFilter = (status, filter = 'All') => {
    const allowedStatuses = APPLICATION_FILTER_STATUS_GROUPS[filter] || null;
    if (!allowedStatuses) return true;
    return allowedStatuses.has(normalizeApplicationStatus(status));
};

export const findTimelineEventForMilestone = (timeline = [], milestone = {}) => {
    const matches = Array.isArray(milestone?.matches) && milestone.matches.length
        ? milestone.matches
        : [milestone?.key];

    return (Array.isArray(timeline) ? timeline : []).find((event = {}) => (
        matches.includes(normalizeApplicationStatus(event?.eventType))
        || matches.includes(normalizeApplicationStatus(event?.type))
        || matches.includes(normalizeApplicationStatus(event?.event))
    )) || null;
};
