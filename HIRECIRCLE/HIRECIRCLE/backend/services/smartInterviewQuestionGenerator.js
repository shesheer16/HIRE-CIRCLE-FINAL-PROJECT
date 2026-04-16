const { FALLBACK_SLOT_QUESTIONS } = require('../config/smartInterviewSlotConfig');
const { guardedGeminiGenerateText } = require('./aiGuardrailService');

const DEFAULT_MODEL = process.env.SMART_INTERVIEW_GEMINI_MODEL || process.env.AI_DEFAULT_MODEL || 'gemini-2.0-flash';
const isProductionRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const sanitizeQuestion = (text, fallback) => {
    const cleaned = String(text || '')
        .replace(/```/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return fallback;

    const words = cleaned.split(' ').filter(Boolean);
    if (words.length > 20) {
        return `${words.slice(0, 20).join(' ')}?`.replace(/\?+$/, '?');
    }
    return cleaned;
};

const askGeminiForQuestion = async ({ missingSlot, slotState }) => {
    const prompt = [
        'You are a structured hiring assistant.',
        `The missing field is: ${missingSlot}.`,
        'Ask ONE short conversational question to collect this information.',
        'Do not ask multiple questions.',
        'Keep it under 20 words.',
        'Return only the question text.',
        `Current confirmed fields: ${JSON.stringify(slotState || {})}`,
    ].join('\n');

    return guardedGeminiGenerateText({
        prompt,
        model: DEFAULT_MODEL,
        rateLimitKey: `slot_question:${missingSlot}`,
        temperature: 0.1,
        maxOutputTokens: 60,
        timeoutMs: 6000,
    });
};

const generateFollowUpQuestion = async (missingSlot, slotState = {}) => {
    const fallback = FALLBACK_SLOT_QUESTIONS[missingSlot] || 'Could you share that detail clearly?';
    if (!missingSlot) return null;

    try {
        const raw = await askGeminiForQuestion({ missingSlot, slotState });
        return sanitizeQuestion(raw, fallback);
    } catch (error) {
        if (isProductionRuntime()) {
            throw error;
        }
        return fallback;
    }
};

module.exports = {
    generateFollowUpQuestion,
};
