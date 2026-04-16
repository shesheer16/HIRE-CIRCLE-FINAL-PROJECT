'use strict';
/**
 * aiVoiceRatingService.js
 * Feature #81 — AI Voice Interview Rating Assistance
 * Feature #82 — AI Real-Time Interview Skill Hints
 * Feature #87 — Voice Summarizer for Interviews
 *
 * Post-interview AI analysis: tone rating, skill identification, summary.
 * Non-disruptive: additive AI layer. No interview state machine changes.
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

/**
 * Rate interview transcript for communication quality.
 * Feature #81
 */
async function rateInterviewTranscript(transcript) {
    const text = String(transcript || '').trim();
    if (!text || text.length < 50) return { rating: null, feedback: 'Transcript too short to analyze.' };

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return { rating: 60, feedback: 'AI unavailable. Please review manually.' };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Rate this job interview response on communication, confidence, and relevance. Return ONLY JSON: {"rating":0-100,"feedback":"brief feedback","strengths":[],"improvements":[]}\n\nTranscript:\n${text.slice(0, 3000)}`;
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const match = raw.match(/\{.*\}/s);
        if (!match) return { rating: 60, feedback: 'Could not parse AI response.' };
        const parsed = JSON.parse(match[0]);
        return {
            rating: Math.min(100, Math.max(0, Number(parsed.rating || 60))),
            feedback: parsed.feedback || '',
            strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 3) : [],
            improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 3) : [],
        };
    } catch (_err) {
        return { rating: 60, feedback: 'AI review unavailable.' };
    }
}

/**
 * Generate a concise summary of an interview transcript.
 * Feature #87
 */
async function summarizeInterview(transcript) {
    const text = String(transcript || '').trim();
    if (!text) return { summary: 'No transcript available.' };

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return { summary: 'AI summarization unavailable.', wordCount: 0 };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Summarize this job interview transcript in 3-4 bullet points, highlighting key skills mentioned and overall impression. Be concise.\n\nTranscript:\n${text.slice(0, 3000)}`;
        const result = await model.generateContent(prompt);
        const summary = result.response.text().trim();
        return { summary, wordCount: summary.split(/\s+/).length };
    } catch (_err) {
        return { summary: 'AI summarization failed.', wordCount: 0 };
    }
}

/**
 * Real-time skill hints during interview (Feature #82).
 * Takes current question and partial response, returns improvement hints.
 */
async function getRealTimeSkillHint(currentQuestion, partialAnswer) {
    const q = String(currentQuestion || '').trim();
    const a = String(partialAnswer || '').trim();
    if (!q) return { hint: null };

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return { hint: 'Mention specific examples from your experience.' };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Question: "${q}"\nCurrent answer attempt: "${a.slice(0, 500)}"\n\nGive ONE short coaching tip (max 20 words) to improve the answer. Return only the tip, no explanation.`;
        const result = await model.generateContent(prompt);
        const hint = result.response.text().trim().slice(0, 120);
        return { hint };
    } catch (_err) {
        return { hint: 'Use the STAR method: Situation, Task, Action, Result.' };
    }
}

module.exports = { rateInterviewTranscript, summarizeInterview, getRealTimeSkillHint };
