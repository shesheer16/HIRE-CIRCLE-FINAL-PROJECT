const { getResilienceState } = require('../services/resilienceStateService');
const { isDegradationActive } = require('../services/degradationService');

const loadBuckets = new Map();

const ADAPTIVE_WINDOW_MS = Number.parseInt(process.env.ADAPTIVE_RATE_LIMIT_WINDOW_MS || String(10 * 1000), 10);
const ADAPTIVE_NON_CRITICAL_MAX = Number.parseInt(process.env.ADAPTIVE_NON_CRITICAL_MAX || '40', 10);
const ADAPTIVE_DELAY_MS = Number.parseInt(process.env.ADAPTIVE_NON_CRITICAL_DELAY_MS || '150', 10);

const CORE_PREFIXES = [
    '/health',
    '/api/health',
    '/system/health/extended',
    '/api/auth',
    '/api/users/login',
    '/api/payment/webhook',
    '/api/v2/interview-processing/latest',
];

const keyForRequest = (req) => {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
    const route = String(req.baseUrl || req.path || '');
    return `${ip}:${route}`;
};

const consumeBucket = (key, max, windowMs) => {
    const now = Date.now();
    const existing = loadBuckets.get(key);

    if (!existing || (now - existing.startedAt) >= windowMs) {
        loadBuckets.set(key, { startedAt: now, count: 1 });
        return { allowed: true, remaining: Math.max(0, max - 1) };
    }

    existing.count += 1;
    loadBuckets.set(key, existing);

    return {
        allowed: existing.count <= max,
        remaining: Math.max(0, max - existing.count),
    };
};

const isCoreEndpoint = (path) => {
    const normalized = String(path || '').toLowerCase();
    return CORE_PREFIXES.some((prefix) => normalized.startsWith(String(prefix).toLowerCase()));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

const adaptiveLoadMiddleware = async (req, res, next) => {
    const state = getResilienceState();
    const adaptiveEnabled = isDegradationActive('adaptiveRateLimitingEnabled') || state.highLoadActive;

    if (!adaptiveEnabled) {
        return next();
    }

    const path = `${req.baseUrl || ''}${req.path || ''}`;
    const core = isCoreEndpoint(path);

    res.setHeader('x-adaptive-rate-mode', 'enabled');
    res.setHeader('x-system-load-score', String(state.loadScore));

    if (core) {
        return next();
    }

    const bucketKey = keyForRequest(req);
    const result = consumeBucket(bucketKey, ADAPTIVE_NON_CRITICAL_MAX, ADAPTIVE_WINDOW_MS);
    if (!result.allowed) {
        return res.status(429).json({
            success: false,
            message: 'System load is high. Non-critical endpoint temporarily throttled.',
        });
    }

    if (ADAPTIVE_DELAY_MS > 0) {
        await sleep(ADAPTIVE_DELAY_MS);
    }

    return next();
};

module.exports = {
    adaptiveLoadMiddleware,
    isCoreEndpoint,
};
