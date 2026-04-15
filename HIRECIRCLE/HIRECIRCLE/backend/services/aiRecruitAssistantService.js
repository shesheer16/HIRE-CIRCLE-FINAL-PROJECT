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

const normalizeShift = (value, fallback = 'Flexible') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'day') return 'Day';
    if (normalized === 'night') return 'Night';
    if (normalized === 'flexible') return 'Flexible';
    return fallback;
};

const WORKER_ROLE_FALLBACKS = {
    student: { skills: ['Communication', 'Basic computer use', 'Teamwork', 'Documentation'], salaryHint: 18000, preferredShift: 'Flexible' },
    fresher: { skills: ['Customer handling', 'Documentation', 'Problem solving', 'Follow-through'], salaryHint: 22000, preferredShift: 'Day' },
    'delivery / logistics': { skills: ['Delivery support', 'Inventory checks', 'Packing', 'Route knowledge'], salaryHint: 25000, preferredShift: 'Flexible' },
    'skilled trades': { skills: ['Troubleshooting', 'Repair work', 'Installation', 'Safety compliance'], salaryHint: 30000, preferredShift: 'Day' },
    'construction / civil': { skills: ['Site safety', 'Concrete work', 'Material planning', 'Team coordination'], salaryHint: 28000, preferredShift: 'Day' },
    'manufacturing / factory': { skills: ['Machine handling', 'SOP compliance', 'Quality checks', 'Line discipline'], salaryHint: 27000, preferredShift: 'Day' },
    'retail / hospitality': { skills: ['POS billing', 'Customer interaction', 'Service etiquette', 'Stock handling'], salaryHint: 22000, preferredShift: 'Flexible' },
    'healthcare / care': { skills: ['Patient support', 'Hygiene protocol', 'Record handling', 'Empathy'], salaryHint: 26000, preferredShift: 'Day' },
    'security / facility': { skills: ['Access control', 'Incident reporting', 'Patrolling', 'Emergency response'], salaryHint: 24000, preferredShift: 'Night' },
    'software / tech': { skills: ['JavaScript', 'React', 'Node.js', 'Testing'], salaryHint: 45000, preferredShift: 'Day' },
    'finance / admin': { skills: ['Excel', 'Data validation', 'Documentation', 'Payroll support'], salaryHint: 28000, preferredShift: 'Day' },
    'sales / marketing': { skills: ['Lead generation', 'Client communication', 'Negotiation', 'CRM updates'], salaryHint: 30000, preferredShift: 'Flexible' },
    'support / service': { skills: ['Customer handling', 'Ticket resolution', 'Escalation handling', 'SLA adherence'], salaryHint: 24000, preferredShift: 'Flexible' },
    other: { skills: ['Communication', 'Teamwork', 'Reliability', 'Problem solving'], salaryHint: 25000, preferredShift: 'Flexible' },
};

/**
 * Generate interview questions for a job (employer-facing).
 * Feature #85
 */
async function suggestInterviewQuestions(jobTitle, skills = []) {
    const apiKey = resolveGeminiApiKey();
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

    const apiKey = resolveGeminiApiKey();
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

/**
 * AI assist for worker profile setup.
 * Returns practical skills + salary/shift hints for the selected role.
 */
async function suggestWorkerProfile(roleName = '', roleCategory = '', context = {}) {
    const normalizedRoleCategory = String(roleCategory || '').trim();
    const fallbackConfig = WORKER_ROLE_FALLBACKS[normalizedRoleCategory.toLowerCase()] || WORKER_ROLE_FALLBACKS.other;
    const fallback = {
        skills: fallbackConfig.skills,
        salaryHint: fallbackConfig.salaryHint,
        preferredShift: normalizeShift(fallbackConfig.preferredShift, 'Flexible'),
        source: 'fallback',
    };

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) return fallback;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const prompt = `
You are assisting a worker profile setup in a hiring marketplace.
Role category: "${normalizedRoleCategory || 'Other'}"
Role title: "${String(roleName || '').trim() || 'Not specified'}"
Context (optional): "${String(context || '').slice(0, 250)}"

Return ONLY JSON with this exact shape:
{
  "skills": ["4-8 practical skill keywords"],
  "salaryHint": 0,
  "preferredShift": "Day|Night|Flexible"
}

Rules:
- Keep skills short and realistic for hiring filters.
- salaryHint is a monthly INR integer estimate for India market.
- No markdown, no explanation.
`;
        const result = await model.generateContent(prompt);
        const raw = result?.response?.text?.()?.trim() || '';
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return fallback;

        const parsed = JSON.parse(match[0]);
        const skills = Array.isArray(parsed?.skills)
            ? parsed.skills
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, 8)
            : fallback.skills;
        const salaryHintValue = Number(parsed?.salaryHint);
        const salaryHint = Number.isFinite(salaryHintValue) && salaryHintValue > 0
            ? Math.round(salaryHintValue)
            : fallback.salaryHint;
        const preferredShift = normalizeShift(parsed?.preferredShift, fallback.preferredShift);

        return {
            skills: skills.length ? skills : fallback.skills,
            salaryHint,
            preferredShift,
            source: 'ai',
        };
    } catch (_err) {
        return fallback;
    }
}

module.exports = {
    suggestInterviewQuestions,
    predictCandidateFit,
    getAiCandidateSuggestions,
    suggestReplies,
    suggestWorkerProfile,
};
