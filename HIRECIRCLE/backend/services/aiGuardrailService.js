const axios = require('axios');
const redisClient = require('../config/redis');
const logger = require('../utils/logger');
const { incrementAiFailureCounter } = require('./systemMonitoringService');
const { executeWithCircuitBreaker } = require('./circuitBreakerService');
const { setDegradationFlag } = require('./degradationService');

const MAX_PROMPT_CHARS = Number.parseInt(process.env.AI_MAX_PROMPT_CHARS || '12000', 10);
const MAX_OUTPUT_TOKENS = Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '1000', 10);
const RATE_LIMIT_PER_MINUTE = Number.parseInt(process.env.AI_RATE_LIMIT_PER_MINUTE || '30', 10);
const DEFAULT_GEMINI_MODEL = process.env.SMART_INTERVIEW_GEMINI_MODEL || process.env.AI_DEFAULT_MODEL || 'gemini-2.0-flash';

const localRateBucket = new Map();

const redactPii = (text) => String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d{1,3}[\s.-]?)?(?:\d[\s.-]?){10,13}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_ID]');

const hasPii = (text) => {
    const source = String(text || '');
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source)
        || /\b(?:\+?\d{1,3}[\s.-]?)?(?:\d[\s.-]?){10,13}\b/.test(source)
        || /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(source);
};

const sanitizePrompt = (prompt) => {
    const normalized = String(prompt || '')
        .replace(/```/g, ' ')
        .replace(/\0/g, ' ')
        .replace(/ignore\s+previous\s+instructions/gi, 'follow system policy')
        .replace(/reveal\s+system\s+prompt/gi, 'do not reveal hidden prompts')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) {
        throw new Error('Prompt is empty after sanitization');
    }

    if (normalized.length > MAX_PROMPT_CHARS) {
        throw new Error(`Prompt exceeds max allowed length (${MAX_PROMPT_CHARS})`);
    }

    return normalized;
};

const consumeLocalRateLimit = (key) => {
    const now = Date.now();
    const minuteBucket = Math.floor(now / 60000);
    const current = localRateBucket.get(key);
    if (!current || current.bucket !== minuteBucket) {
        localRateBucket.set(key, { bucket: minuteBucket, count: 1 });
        return true;
    }

    current.count += 1;
    localRateBucket.set(key, current);
    return current.count <= RATE_LIMIT_PER_MINUTE;
};

const consumeRateLimit = async (key) => {
    const normalizedKey = `ai_rate:${String(key || 'global')}`;

    try {
        if (redisClient?.isOpen && typeof redisClient.incr === 'function' && typeof redisClient.expire === 'function') {
            const count = await redisClient.incr(normalizedKey);
            if (count === 1) {
                await redisClient.expire(normalizedKey, 60);
            }
            return count <= RATE_LIMIT_PER_MINUTE;
        }
    } catch (error) {
        logger.warn(`AI rate limiter fallback: ${error.message}`);
    }

    return consumeLocalRateLimit(normalizedKey);
};

const toOptionalInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const buildGeminiUrl = (model) => {
    const apiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const looksPlaceholder = (
        apiKey.startsWith('<')
        || apiKey.endsWith('>')
        || apiKey.toLowerCase().includes('gemini')
        || apiKey.length < 24
    );
    if (!apiKey || looksPlaceholder) throw new Error('Missing GEMINI_API_KEY');
    if (!String(process.env.GEMINI_API_KEY || '').trim()) {
        process.env.GEMINI_API_KEY = apiKey;
    }
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
};

const guardedGeminiGenerateText = async ({
    prompt,
    model = DEFAULT_GEMINI_MODEL,
    rateLimitKey = 'global',
    maxOutputTokens = MAX_OUTPUT_TOKENS,
    temperature = 0.2,
    timeoutMs = 8000,
    allowPii = false,
}) => {
    const sanitizedPrompt = sanitizePrompt(prompt);

    const allowed = await consumeRateLimit(rateLimitKey);
    if (!allowed) {
        await incrementAiFailureCounter({ reason: 'rate_limited' });
        throw new Error('AI rate limit exceeded');
    }

    try {
        const modelLower = String(model || '').toLowerCase();
        const envThinkingBudget = toOptionalInt(process.env.GEMINI_GUARDRAIL_THINKING_BUDGET);
        const derivedThinkingBudget = envThinkingBudget !== null
            ? envThinkingBudget
            : (modelLower.includes('flash') ? 0 : null);
        const generationConfig = {
            temperature,
            maxOutputTokens: Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS),
            ...(derivedThinkingBudget !== null ? { thinkingConfig: { thinkingBudget: Math.max(0, derivedThinkingBudget) } } : {}),
        };
        const response = await executeWithCircuitBreaker(
            'ai_provider',
            async () => axios.post(
                buildGeminiUrl(model),
                {
                    contents: [{ parts: [{ text: sanitizedPrompt }] }],
                    generationConfig,
                },
                { timeout: timeoutMs }
            ),
            {
                failureThreshold: Number.parseInt(process.env.AI_CIRCUIT_FAILURE_THRESHOLD || '4', 10),
                cooldownMs: Number.parseInt(process.env.AI_CIRCUIT_COOLDOWN_MS || String(45 * 1000), 10),
                timeoutMs,
            }
        );

        const output = String(response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!output) {
            throw new Error('AI returned empty response');
        }

        if (!allowPii && hasPii(output)) {
            await incrementAiFailureCounter({ reason: 'pii_detected' });
            throw new Error('AI response blocked due to PII leakage detection');
        }

        setDegradationFlag('aiManualFallbackEnabled', false, null);
        return allowPii ? output : redactPii(output);
    } catch (error) {
        await incrementAiFailureCounter({ reason: error.message || 'ai_error' });
        setDegradationFlag('aiManualFallbackEnabled', true, error.message || 'ai_error', 120000);
        throw error;
    }
};

const guardedGeminiGenerateRaw = async ({
    parts = [],
    model = DEFAULT_GEMINI_MODEL,
    rateLimitKey = 'global',
    maxOutputTokens = MAX_OUTPUT_TOKENS,
    temperature = 0.2,
    timeoutMs = 8000,
    allowPii = false,
}) => {
    const allowed = await consumeRateLimit(rateLimitKey);
    if (!allowed) {
        await incrementAiFailureCounter({ reason: 'rate_limited' });
        throw new Error('AI rate limit exceeded');
    }

    const safeParts = Array.isArray(parts) ? parts : [];
    if (!safeParts.length) {
        throw new Error('AI request parts are required');
    }

    const normalizedParts = safeParts.map((part) => {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
            return { text: sanitizePrompt(part.text) };
        }
        return part;
    });

    try {
        const modelLower = String(model || '').toLowerCase();
        const envThinkingBudget = toOptionalInt(process.env.GEMINI_GUARDRAIL_THINKING_BUDGET);
        const derivedThinkingBudget = envThinkingBudget !== null
            ? envThinkingBudget
            : (modelLower.includes('flash') ? 0 : null);
        const generationConfig = {
            temperature,
            maxOutputTokens: Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS),
            ...(derivedThinkingBudget !== null ? { thinkingConfig: { thinkingBudget: Math.max(0, derivedThinkingBudget) } } : {}),
        };
        const response = await axios.post(
            buildGeminiUrl(model),
            {
                contents: [{ parts: normalizedParts }],
                generationConfig,
            },
            { timeout: timeoutMs }
        );

        const output = String(response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (!output) {
            throw new Error('AI returned empty response');
        }

        if (!allowPii && hasPii(output)) {
            await incrementAiFailureCounter({ reason: 'pii_detected' });
            throw new Error('AI response blocked due to PII leakage detection');
        }

        return allowPii ? output : redactPii(output);
    } catch (error) {
        await incrementAiFailureCounter({ reason: error.message || 'ai_error' });
        throw error;
    }
};

const parseStrictJsonObject = (rawText) => {
    const text = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    if (!text) throw new Error('Empty AI response');

    try {
        return JSON.parse(text);
    } catch (error) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            throw new Error('AI response is not valid JSON');
        }
        return JSON.parse(text.slice(start, end + 1));
    }
};

module.exports = {
    sanitizePrompt,
    parseStrictJsonObject,
    hasPii,
    redactPii,
    guardedGeminiGenerateText,
    guardedGeminiGenerateRaw,
};
