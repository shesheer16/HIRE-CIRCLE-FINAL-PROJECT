const { createRedisRateLimiter, readIp } = require('../services/redisRateLimiter');
const { isDegradationActive } = require('../services/degradationService');
const { getResilienceState } = require('../services/resilienceStateService');

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim().replace(/[^\d+]/g, '');

const resolveIdentityKey = (req) => {
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone || req.body?.phoneNumber);

    if (email) return `email:${email}`;
    if (phone) return `phone:${phone}`;
    return 'anonymous';
};

const resolveUserScopedKey = (req) => {
    const userId = String(req.user?._id || '').trim();
    if (userId) {
        return `user:${userId}`;
    }

    const email = normalizeEmail(req.body?.email);
    if (email) {
        return `email:${email}`;
    }

    return `ip:${readIp(req)}`;
};

const isTestRuntime = String(process.env.NODE_ENV || '').toLowerCase() === 'test';

const resolveAdaptiveMax = (baseMax) => {
    const base = Number(baseMax || 1);
    const resilience = getResilienceState();
    const adaptiveEnabled = isDegradationActive('adaptiveRateLimitingEnabled') || resilience.highLoadActive;
    if (!adaptiveEnabled) return Math.max(1, base);

    const tightenFactor = Number.parseFloat(process.env.ADAPTIVE_RATE_TIGHTEN_FACTOR || '0.5');
    const factor = Number.isFinite(tightenFactor) ? Math.max(0.1, Math.min(1, tightenFactor)) : 0.5;
    return Math.max(1, Math.floor(base * factor));
};

const createLimiter = ({ namespace, windowMs, max, message, keyGenerator }) => createRedisRateLimiter({
    namespace,
    windowMs,
    max: () => resolveAdaptiveMax(max),
    keyGenerator,
    skip: () => isTestRuntime,
    strictRedis: String(process.env.NODE_ENV || '').toLowerCase() === 'production',
    message,
});

const otpRequestLimiter = createLimiter({
    namespace: 'otp-request',
    windowMs: 15 * 60 * 1000,
    max: Number.parseInt(process.env.RL_OTP_REQUEST_MAX || '3', 10),
    message: 'Too many OTP requests. Try again in 15 minutes.',
    keyGenerator: (req) => `${readIp(req)}:${resolveIdentityKey(req)}`,
});

const loginAttemptLimiter = createLimiter({
    namespace: 'login-attempt',
    windowMs: 10 * 60 * 1000,
    max: Number.parseInt(process.env.RL_LOGIN_ATTEMPT_MAX || '5', 10),
    message: 'Too many login attempts. Try again in 10 minutes.',
    keyGenerator: (req) => `${readIp(req)}:${normalizeEmail(req.body?.email) || 'anonymous'}`,
});

const smartInterviewStartLimiter = createLimiter({
    namespace: 'smart-interview-start',
    windowMs: 60 * 60 * 1000,
    max: Number.parseInt(process.env.RL_SMART_INTERVIEW_START_MAX || '5', 10),
    message: 'Interview start rate limit exceeded. Try again in one hour.',
    keyGenerator: (req) => `${resolveUserScopedKey(req)}:${readIp(req)}`,
});

const applyJobLimiter = createLimiter({
    namespace: 'job-apply',
    windowMs: 60 * 60 * 1000,
    max: Number.parseInt(process.env.RL_JOB_APPLY_MAX || '30', 10),
    message: 'Application rate limit exceeded. Try again in one hour.',
    keyGenerator: (req) => `${resolveUserScopedKey(req)}:${readIp(req)}`,
});

const chatMessageLimiter = createLimiter({
    namespace: 'chat-message',
    windowMs: 60 * 1000,
    max: Number.parseInt(process.env.RL_CHAT_MESSAGE_MAX || '60', 10),
    message: 'Chat rate limit exceeded. Please slow down.',
    keyGenerator: (req) => `${resolveUserScopedKey(req)}:${readIp(req)}`,
});

const jobPostLimiter = createLimiter({
    namespace: 'job-post',
    windowMs: 60 * 60 * 1000,
    max: Number.parseInt(process.env.RL_JOB_POST_MAX || '10', 10),
    message: 'Job posting rate limit exceeded. Try again in one hour.',
    keyGenerator: (req) => `${resolveUserScopedKey(req)}:${readIp(req)}`,
});

const communityCreateLimiter = createLimiter({
    namespace: 'community-create',
    windowMs: 24 * 60 * 60 * 1000,
    max: Number.parseInt(process.env.RL_COMMUNITY_CREATE_MAX || '5', 10),
    message: 'Community creation rate limit exceeded. Try again tomorrow.',
    keyGenerator: (req) => `${resolveUserScopedKey(req)}:${readIp(req)}`,
});

module.exports = {
    otpRequestLimiter,
    loginAttemptLimiter,
    smartInterviewStartLimiter,
    applyJobLimiter,
    chatMessageLimiter,
    jobPostLimiter,
    communityCreateLimiter,
};
