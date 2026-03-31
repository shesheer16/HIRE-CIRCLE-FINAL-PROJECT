const JOB_TRANSITION_MAP = Object.freeze({
    DRAFT: Object.freeze(['OPEN']),
    OPEN: Object.freeze(['PAUSED', 'FILLED', 'CLOSED']),
    PAUSED: Object.freeze(['OPEN']),
    FILLED: Object.freeze([]),
    CLOSED: Object.freeze([]),
    ARCHIVED: Object.freeze([]),
    EXPIRED: Object.freeze([]),
});

const KNOWN_JOB_STATUSES = Object.freeze(Object.keys(JOB_TRANSITION_MAP));

const normalizeJobStatus = (status, fallback = 'OPEN') => {
    const normalized = String(status || '').trim().toUpperCase();
    if (!normalized) return fallback;
    return KNOWN_JOB_STATUSES.includes(normalized) ? normalized : fallback;
};

const canTransitionJobStatus = ({ fromStatus, toStatus, allowNoop = true }) => {
    const from = normalizeJobStatus(fromStatus, '__INVALID__');
    const to = normalizeJobStatus(toStatus, '__INVALID__');

    if (!KNOWN_JOB_STATUSES.includes(from)) {
        return {
            valid: false,
            fromStatus: String(fromStatus || ''),
            toStatus: to,
            reason: `Unknown current status: ${String(fromStatus || '')}`,
        };
    }

    if (!KNOWN_JOB_STATUSES.includes(to)) {
        return {
            valid: false,
            fromStatus: from,
            toStatus: String(toStatus || ''),
            reason: `Unknown target status: ${String(toStatus || '')}`,
        };
    }

    if (from === to) {
        return {
            valid: Boolean(allowNoop),
            fromStatus: from,
            toStatus: to,
            reason: allowNoop ? 'noop' : `No-op transition not allowed: ${from} -> ${to}`,
        };
    }

    const allowedTargets = JOB_TRANSITION_MAP[from] || [];
    const valid = allowedTargets.includes(to);
    return {
        valid,
        fromStatus: from,
        toStatus: to,
        reason: valid ? 'ok' : `Invalid transition: ${from} -> ${to}`,
    };
};

module.exports = {
    JOB_TRANSITION_MAP,
    KNOWN_JOB_STATUSES,
    normalizeJobStatus,
    canTransitionJobStatus,
};

