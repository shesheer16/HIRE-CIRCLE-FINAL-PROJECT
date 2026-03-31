const crypto = require('crypto');
const mongoose = require('mongoose');

const AiUsageMetric = require('../models/AiUsageMetric');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { emitStructuredAlert } = require('./systemMonitoringService');
const { startOfUtcDay, addUtcDays } = require('../utils/timezone');

const DEFAULT_MODEL_PRICING = Object.freeze({
    // Conservative defaults in USD per 1K tokens.
    'gemini-1.5-flash': { inputPer1k: 0.00035, outputPer1k: 0.00105 },
    'gemini-flash-latest': { inputPer1k: 0.00035, outputPer1k: 0.00105 },
    'gemini-1.5-pro': { inputPer1k: 0.0035, outputPer1k: 0.0105 },
    'gemini-pro': { inputPer1k: 0.0035, outputPer1k: 0.0105 },
});

const DAILY_TOKEN_CAP = Number.parseInt(process.env.AI_DAILY_TOKEN_CAP || '250000', 10);
const DAILY_COST_CAP_USD = Number.parseFloat(process.env.AI_DAILY_COST_CAP_USD || '25');
const ABUSE_WINDOW_SECONDS = Number.parseInt(process.env.AI_ABUSE_WINDOW_SECONDS || '60', 10);
const ABUSE_MAX_CALLS_PER_WINDOW = Number.parseInt(process.env.AI_ABUSE_MAX_CALLS_PER_WINDOW || '80', 10);

const localAbuseBuckets = new Map();
const inFlightBatch = new Map();
const hasDatabaseConnection = () => Number(mongoose?.connection?.readyState || 0) === 1;

const parsePricingOverrides = () => {
    const raw = String(process.env.AI_MODEL_PRICING_JSON || '').trim();
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return parsed;
    } catch (_error) {
        return {};
    }
};

const normalizeModel = (value) => String(value || '').trim().toLowerCase();

const estimateTokensFromText = (value) => {
    const chars = String(value || '').length;
    // Typical rough estimate for English tokenization.
    return Math.max(0, Math.ceil(chars / 4));
};

const getModelPricing = (modelName) => {
    const normalized = normalizeModel(modelName);
    const overrides = parsePricingOverrides();
    const override = overrides[normalized] || overrides[modelName];
    const base = DEFAULT_MODEL_PRICING[normalized] || DEFAULT_MODEL_PRICING['gemini-1.5-flash'];

    if (!override || typeof override !== 'object') return base;

    return {
        inputPer1k: Number.isFinite(Number(override.inputPer1k)) ? Number(override.inputPer1k) : base.inputPer1k,
        outputPer1k: Number.isFinite(Number(override.outputPer1k)) ? Number(override.outputPer1k) : base.outputPer1k,
    };
};

const estimateUsage = ({ model, prompt = '', output = '', inputTokens = null, outputTokens = null } = {}) => {
    const estimatedInputTokens = Number.isFinite(Number(inputTokens))
        ? Math.max(0, Math.round(Number(inputTokens)))
        : estimateTokensFromText(prompt);
    const estimatedOutputTokens = Number.isFinite(Number(outputTokens))
        ? Math.max(0, Math.round(Number(outputTokens)))
        : estimateTokensFromText(output);
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;

    const pricing = getModelPricing(model);
    const estimatedCostUsd = Number(((estimatedInputTokens / 1000) * pricing.inputPer1k
        + (estimatedOutputTokens / 1000) * pricing.outputPer1k).toFixed(6));

    return {
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedTotalTokens,
        estimatedCostUsd,
    };
};

const getUsageWindow = (date = new Date()) => {
    const from = startOfUtcDay(date);
    const to = addUtcDays(from, 1);
    return { from, to };
};

const getUserDailyAiUsage = async ({ userId, date = new Date() } = {}) => {
    if (!userId) {
        return {
            totalTokens: 0,
            totalCostUsd: 0,
            callCount: 0,
        };
    }
    if (!hasDatabaseConnection()) {
        return {
            totalTokens: 0,
            totalCostUsd: 0,
            callCount: 0,
        };
    }

    const { from, to } = getUsageWindow(date);
    const rows = await AiUsageMetric.aggregate([
        {
            $match: {
                userId,
                createdAt: { $gte: from, $lt: to },
                status: { $in: ['success', 'failed'] },
            },
        },
        {
            $group: {
                _id: null,
                totalTokens: { $sum: '$estimatedTotalTokens' },
                totalCostUsd: { $sum: '$estimatedCostUsd' },
                callCount: { $sum: 1 },
            },
        },
    ]);

    return {
        totalTokens: Number(rows[0]?.totalTokens || 0),
        totalCostUsd: Number(Number(rows[0]?.totalCostUsd || 0).toFixed(6)),
        callCount: Number(rows[0]?.callCount || 0),
    };
};

const buildAbuseKey = ({ userId = null, rateLimitKey = 'global' } = {}) => {
    const uid = String(userId || '').trim();
    if (uid) return `ai-abuse:user:${uid}`;
    return `ai-abuse:key:${String(rateLimitKey || 'global')}`;
};

const detectHighFrequencyAbuse = async ({ userId = null, rateLimitKey = 'global' } = {}) => {
    const key = buildAbuseKey({ userId, rateLimitKey });

    if (redisClient?.isOpen && typeof redisClient.incr === 'function' && typeof redisClient.expire === 'function') {
        try {
            const count = await redisClient.incr(key);
            if (count === 1) {
                await redisClient.expire(key, ABUSE_WINDOW_SECONDS);
            }
            return {
                abusive: count > ABUSE_MAX_CALLS_PER_WINDOW,
                count,
            };
        } catch (error) {
            logger.warn({ event: 'ai_abuse_counter_fallback', message: error.message });
        }
    }

    const nowBucket = Math.floor(Date.now() / (ABUSE_WINDOW_SECONDS * 1000));
    const existing = localAbuseBuckets.get(key);
    if (!existing || existing.bucket !== nowBucket) {
        localAbuseBuckets.set(key, { bucket: nowBucket, count: 1 });
        return { abusive: false, count: 1 };
    }

    existing.count += 1;
    localAbuseBuckets.set(key, existing);
    return {
        abusive: existing.count > ABUSE_MAX_CALLS_PER_WINDOW,
        count: existing.count,
    };
};

const assertAiBudget = async ({ userId = null } = {}) => {
    if (!userId) return { allowed: true, reason: null, daily: null };

    const daily = await getUserDailyAiUsage({ userId });
    const tokenExceeded = daily.totalTokens >= DAILY_TOKEN_CAP;
    const costExceeded = daily.totalCostUsd >= DAILY_COST_CAP_USD;

    if (!tokenExceeded && !costExceeded) {
        return { allowed: true, reason: null, daily };
    }

    const reason = tokenExceeded ? 'daily_token_cap_exceeded' : 'daily_cost_cap_exceeded';

    await emitStructuredAlert({
        alertType: 'ai_budget_cap_exceeded',
        metric: 'ai_failure_spike',
        value: tokenExceeded ? daily.totalTokens : daily.totalCostUsd,
        threshold: tokenExceeded ? DAILY_TOKEN_CAP : DAILY_COST_CAP_USD,
        severity: 'critical',
        source: 'ai_cost_guardrail',
        message: 'AI daily budget exceeded for user',
        details: {
            userId: String(userId),
            reason,
            totalTokens: daily.totalTokens,
            totalCostUsd: daily.totalCostUsd,
            suggestedAction: 'Throttle AI traffic for this user tier or require top-up.',
        },
    }).catch(() => {});

    return {
        allowed: false,
        reason,
        daily,
    };
};

const recordAiUsage = async ({
    userId = null,
    interviewProcessingId = null,
    operation = 'generic',
    provider = 'gemini',
    model,
    fallbackModel = null,
    region = 'unknown',
    prompt = '',
    output = '',
    inputTokens = null,
    outputTokens = null,
    status = 'success',
    error = null,
    metadata = {},
} = {}) => {
    const usage = estimateUsage({ model, prompt, output, inputTokens, outputTokens });
    if (!hasDatabaseConnection()) {
        return {
            row: null,
            usage,
        };
    }

    const row = await AiUsageMetric.create({
        userId: userId || null,
        interviewProcessingId: interviewProcessingId || null,
        operation,
        provider,
        model: String(model || 'unknown'),
        fallbackModel: fallbackModel || null,
        region: String(region || 'unknown'),
        promptChars: String(prompt || '').length,
        outputChars: String(output || '').length,
        estimatedInputTokens: usage.estimatedInputTokens,
        estimatedOutputTokens: usage.estimatedOutputTokens,
        estimatedTotalTokens: usage.estimatedTotalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
        status,
        error: error ? String(error) : null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });

    return {
        row,
        usage,
    };
};

const calculateAiCostPerHire = async ({ userId, from = null, to = null } = {}) => {
    if (!userId) {
        return {
            totalCostUsd: 0,
            hires: 0,
            aiCostPerHireUsd: 0,
        };
    }
    if (!hasDatabaseConnection()) {
        return {
            totalCostUsd: 0,
            hires: 0,
            aiCostPerHireUsd: 0,
        };
    }

    const dateMatch = {};
    if (from) dateMatch.$gte = new Date(from);
    if (to) dateMatch.$lte = new Date(to);

    const match = {
        userId,
        status: 'success',
    };
    if (Object.keys(dateMatch).length) {
        match.createdAt = dateMatch;
    }

    const [totals] = await AiUsageMetric.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalCostUsd: { $sum: '$estimatedCostUsd' },
            },
        },
    ]);

    const HireRecord = require('../models/HireRecord');
    const hires = await HireRecord.countDocuments({
        employerId: userId,
        ...(Object.keys(dateMatch).length ? { createdAt: dateMatch } : {}),
    });

    const totalCostUsd = Number(Number(totals?.totalCostUsd || 0).toFixed(6));
    const aiCostPerHireUsd = hires > 0
        ? Number((totalCostUsd / hires).toFixed(6))
        : totalCostUsd;

    return {
        totalCostUsd,
        hires,
        aiCostPerHireUsd,
    };
};

const createBatchKey = ({ model, prompt = '', metadata = {} } = {}) => {
    const normalized = JSON.stringify({
        model: String(model || 'unknown').toLowerCase(),
        prompt: String(prompt || '').trim(),
        operation: metadata?.operation || 'generic',
    });
    return crypto.createHash('sha1').update(normalized).digest('hex');
};

const executeSmartBatch = async ({ model, prompt, metadata = {}, ttlMs = 300, executor } = {}) => {
    const key = createBatchKey({ model, prompt, metadata });
    const existing = inFlightBatch.get(key);
    if (existing) {
        return existing.promise;
    }

    const promise = Promise.resolve()
        .then(() => executor())
        .finally(() => {
            setTimeout(() => {
                inFlightBatch.delete(key);
            }, Math.max(1, Number(ttlMs || 0)));
        });

    inFlightBatch.set(key, {
        createdAt: Date.now(),
        promise,
    });

    return promise;
};

module.exports = {
    estimateTokensFromText,
    getModelPricing,
    estimateUsage,
    recordAiUsage,
    assertAiBudget,
    detectHighFrequencyAbuse,
    getUserDailyAiUsage,
    calculateAiCostPerHire,
    executeSmartBatch,
};
