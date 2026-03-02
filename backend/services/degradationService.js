const logger = require('../utils/logger');

const DEFAULT_DEGRADATION_STATE = {
    aiManualFallbackEnabled: false,
    redisMinimalMode: false,
    paymentWriteBlocked: false,
    queuePaused: false,
    smartInterviewPaused: false,
    heavyAnalyticsPaused: false,
    adaptiveRateLimitingEnabled: false,
    lastUpdatedAt: null,
};

const state = {
    ...DEFAULT_DEGRADATION_STATE,
    reasons: {},
    expiresAt: {},
};

const now = () => Date.now();

const touch = () => {
    state.lastUpdatedAt = new Date().toISOString();
};

const normalizeFlag = (flag) => String(flag || '').trim();

const clearExpired = () => {
    const currentTs = now();
    Object.entries(state.expiresAt).forEach(([flag, expiry]) => {
        if (!expiry || expiry > currentTs) return;
        if (Object.prototype.hasOwnProperty.call(state, flag)) {
            state[flag] = false;
            delete state.reasons[flag];
            delete state.expiresAt[flag];
        }
    });
};

const setDegradationFlag = (flag, enabled, reason = null, ttlMs = null) => {
    clearExpired();

    const normalizedFlag = normalizeFlag(flag);
    if (!normalizedFlag || !Object.prototype.hasOwnProperty.call(state, normalizedFlag)) {
        return false;
    }

    const nextValue = Boolean(enabled);
    if (state[normalizedFlag] === nextValue && (!reason || state.reasons[normalizedFlag] === reason)) {
        return true;
    }

    state[normalizedFlag] = nextValue;

    if (nextValue && reason) {
        state.reasons[normalizedFlag] = String(reason);
    } else if (!nextValue) {
        delete state.reasons[normalizedFlag];
    }

    if (nextValue && Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0) {
        state.expiresAt[normalizedFlag] = now() + Number(ttlMs);
    } else {
        delete state.expiresAt[normalizedFlag];
    }

    touch();

    logger.warn({
        event: 'degradation_flag_updated',
        flag: normalizedFlag,
        enabled: nextValue,
        reason: reason || null,
        ttlMs: Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : null,
        at: state.lastUpdatedAt,
    });

    return true;
};

const setManyDegradationFlags = (payload = {}, reason = null) => {
    Object.entries(payload || {}).forEach(([flag, enabled]) => {
        setDegradationFlag(flag, enabled, reason, null);
    });
};

const getDegradationState = () => {
    clearExpired();
    return {
        aiManualFallbackEnabled: state.aiManualFallbackEnabled,
        redisMinimalMode: state.redisMinimalMode,
        paymentWriteBlocked: state.paymentWriteBlocked,
        queuePaused: state.queuePaused,
        smartInterviewPaused: state.smartInterviewPaused,
        heavyAnalyticsPaused: state.heavyAnalyticsPaused,
        adaptiveRateLimitingEnabled: state.adaptiveRateLimitingEnabled,
        reasons: { ...state.reasons },
        lastUpdatedAt: state.lastUpdatedAt,
    };
};

const isDegradationActive = (flag) => {
    clearExpired();
    const normalizedFlag = normalizeFlag(flag);
    if (!normalizedFlag || !Object.prototype.hasOwnProperty.call(state, normalizedFlag)) {
        return false;
    }
    return Boolean(state[normalizedFlag]);
};

module.exports = {
    DEFAULT_DEGRADATION_STATE,
    setDegradationFlag,
    setManyDegradationFlags,
    getDegradationState,
    isDegradationActive,
};
