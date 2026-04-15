'use strict';
/**
 * aiSentimentService.js
 * Feature #88 — AI Sentiment Analysis of Chat Messages
 *
 * Lightweight sentiment analysis (positive/neutral/negative) on chat messages.
 * Uses Gemini AI with keyword fallback.
 *
 * Used for: conflict detection, employer tone analysis, support escalation triggers.
 * Non-disruptive: additive. No chat architecture changes.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const resolveGeminiApiKey = () => {
    const key = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (key && !String(process.env.GEMINI_API_KEY || '').trim()) {
        process.env.GEMINI_API_KEY = key;
    }
    if (key && !String(process.env.GOOGLE_API_KEY || '').trim()) {
        process.env.GOOGLE_API_KEY = key;
    }
    return key;
};

// Simple keyword fallback
const POSITIVE_WORDS = ['great', 'excellent', 'good', 'thanks', 'offer', 'accepted', 'hired', 'perfect', 'love', 'happy', 'confirmed'];
const NEGATIVE_WORDS = ['scam', 'fraud', 'lie', 'cheat', 'terrible', 'awful', 'reject', 'cancel', 'never', 'block', 'report', 'abuse', 'threat'];

/**
 * Analyze sentiment of a message.
 * @param {string} text
 * @returns {Promise<{sentiment: 'positive'|'neutral'|'negative', score: number, flagged: boolean}>}
 */
async function analyzeSentiment(text) {
    const clean = String(text || '').trim().toLowerCase();
    if (!clean || clean.length < 3) return { sentiment: 'neutral', score: 50, flagged: false };

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return keywordSentiment(clean);

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Analyze the sentiment of this message. Reply ONLY with a JSON object: {"sentiment":"positive"|"neutral"|"negative","score":0-100,"flagged":true|false}. Flagged means abusive/threatening/scam content.\n\nMessage: "${clean.slice(0, 500)}"`;

        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const match = raw.match(/\{.*\}/s);
        if (!match) return keywordSentiment(clean);

        const parsed = JSON.parse(match[0]);
        return {
            sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
            score: Math.min(100, Math.max(0, Number(parsed.score || 50))),
            flagged: !!parsed.flagged,
        };
    } catch (_err) {
        return keywordSentiment(clean);
    }
}

function keywordSentiment(text) {
    const posCount = POSITIVE_WORDS.filter((w) => text.includes(w)).length;
    const negCount = NEGATIVE_WORDS.filter((w) => text.includes(w)).length;
    const flagged = negCount >= 2;
    if (negCount > posCount) return { sentiment: 'negative', score: Math.max(10, 40 - negCount * 10), flagged };
    if (posCount > negCount) return { sentiment: 'positive', score: Math.min(90, 60 + posCount * 10), flagged };
    return { sentiment: 'neutral', score: 50, flagged };
}

module.exports = { analyzeSentiment };
