'use strict';
/**
 * aiRecruitAssistantService.js
 * Feature #89 — AI Recruiter Assistant for Candidate Suggestions
 * Feature #85 — AI Suggested Questions for Employers
 * Feature #86 — AI Candidate Fit Predictor Chart
 *
 * Non-disruptive: additive AI layer. No match engine changes.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Generate interview questions for a job (employer-facing).
 * Feature #85
 */
async function suggestInterviewQuestions(jobTitle, skills = []) {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const skillList = (skills || []).slice(0, 5).join(', ') || 'general skills';

    const fallback = [
        `Tell me about your experience with ${jobTitle}.`,
        `What skills make you the best fit for this role?`,
        `Describe a challenging work situation and how you resolved it.`,
        `What is your availability and preferred work hours?`,
        `Do you have relevant certifications or documents?`,
    ];

    if (!apiKey) return { questions: fallback, source: 'fallback' };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Generate 5 interview questions for a ${jobTitle} role requiring: ${skillList}. Return ONLY a JSON array of question strings.`;
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const match = raw.match(/\[.*\]/s);
        if (!match) return { questions: fallback, source: 'fallback' };
        const questions = JSON.parse(match[0]).filter((q) => typeof q === 'string').slice(0, 5);
        return { questions: questions.length >= 3 ? questions : fallback, source: 'ai' };
    } catch (_err) {
        return { questions: fallback, source: 'fallback' };
    }
}

/**
 * Predict candidate fit score (0-100) for a job.
 * Feature #86
 */
function predictCandidateFit(worker, job) {
    const workerSkills = (worker?.skills || []).map((s) => String(s).toLowerCase());
    const jobSkills = (job?.skills || []).map((s) => String(s).toLowerCase());

    const matched = jobSkills.filter((s) => workerSkills.includes(s));
    const skillScore = jobSkills.length > 0 ? (matched.length / jobSkills.length) * 100 : 50;

    const expMin = Number(job?.minExperienceYears || 0);
    const expMax = Number(job?.maxExperienceYears || 99);
    const workerExp = Number(worker?.experienceYears || 0);
    const expScore = workerExp >= expMin && workerExp <= expMax ? 100
        : workerExp < expMin ? Math.max(0, 100 - (expMin - workerExp) * 20) : 80;

    const fit = Math.round(skillScore * 0.6 + expScore * 0.4);
    return {
        fitScore: Math.min(100, Math.max(0, fit)),
        matchedSkills: matched,
        skillCoverage: `${matched.length}/${jobSkills.length}`,
        expMatch: workerExp >= expMin,
    };
}

/**
 * Get AI recruiter candidate suggestions for a job.
 * Feature #89
 */
async function getAiCandidateSuggestions(job, candidates = []) {
    return candidates
        .map((c) => ({ ...c, fitData: predictCandidateFit(c, job) }))
        .sort((a, b) => b.fitData.fitScore - a.fitData.fitScore)
        .slice(0, 10);
}

/**
 * Auto-suggest replies for chat messages.
 * Feature #90
 */
async function suggestReplies(messageText, context = '') {
    const fallbacks = [
        'Thanks for your message. I will get back to you shortly.',
        'Noted. Can we schedule a call to discuss further?',
        'Yes, I am available. Please share the details.',
    ];

    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) return { suggestions: fallbacks, source: 'fallback' };

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `Given this hiring chat message: "${String(messageText).slice(0, 300)}", suggest 3 short professional reply options. Return ONLY a JSON array of strings.`;
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();
        const match = raw.match(/\[.*\]/s);
        if (!match) return { suggestions: fallbacks, source: 'fallback' };
        const suggestions = JSON.parse(match[0]).filter((s) => typeof s === 'string').slice(0, 3);
        return { suggestions: suggestions.length >= 2 ? suggestions : fallbacks, source: 'ai' };
    } catch (_err) {
        return { suggestions: fallbacks, source: 'fallback' };
    }
}

module.exports = {
    suggestInterviewQuestions,
    predictCandidateFit,
    getAiCandidateSuggestions,
    suggestReplies,
};
