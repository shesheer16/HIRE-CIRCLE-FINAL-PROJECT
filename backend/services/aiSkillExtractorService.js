'use strict';
/**
 * aiSkillExtractorService.js
 * Feature #84 — AI Auto Skills Extractor from Bio
 * Feature #14 — Automatic Skill Suggestions from Text Input
 *
 * Uses Gemini AI to extract skills from free-form bio text.
 * Falls back to a keyword dictionary when Gemini key absent.
 *
 * Non-disruptive: additive service. No match engine changes.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// Keyword fallback dictionary (covers most common gig/blue-collar skills)
const SKILL_KEYWORD_DICT = [
    'driving', 'delivery', 'warehouse', 'forklift', 'customer service',
    'cashier', 'billing', 'inventory', 'cleaning', 'housekeeping',
    'cooking', 'chef', 'electrician', 'plumber', 'carpenter', 'painter',
    'security guard', 'data entry', 'excel', 'tally', 'customer handling',
    'pos billing', 'last-mile delivery', 'packing', 'loading', 'sales',
    'field sales', 'insurance', 'banking', 'telecalling', 'receptionist',
    'nurse', 'nursing', 'medical', 'lab', 'hospital', 'pharmacist',
    'react', 'node.js', 'python', 'java', 'sql', 'devops', 'docker',
    'kubernetes', 'aws', 'azure', 'machine learning', 'data science',
    'photography', 'video editing', 'graphic design', 'photoshop',
    'tailoring', 'stitching', 'beautician', 'makeup', 'spa',
    'teaching', 'tutor', 'trainer', 'coaching',
];

/**
 * Extract skills from bio text using AI (with fallback to keyword match).
 *
 * @param {string} bioText
 * @returns {Promise<string[]>} array of extracted skill strings
 */
async function extractSkillsFromBio(bioText) {
    const text = String(bioText || '').trim();
    if (!text || text.length < 5) return [];

    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
        return keywordFallback(text);
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Extract a list of professional skills from this bio. Return ONLY a JSON array of skill strings, max 20 skills, no explanation:\n\n${text.slice(0, 2000)}`;
        const result = await model.generateContent(prompt);
        const raw = result.response.text().trim();

        // Extract JSON array from response
        const match = raw.match(/\[.*\]/s);
        if (!match) return keywordFallback(text);

        const parsed = JSON.parse(match[0]);
        if (!Array.isArray(parsed)) return keywordFallback(text);

        return parsed
            .filter((s) => typeof s === 'string' && s.trim().length > 1)
            .map((s) => s.trim().toLowerCase())
            .slice(0, 20);
    } catch (_err) {
        return keywordFallback(text);
    }
}

/**
 * Suggest skills as user types (autocomplete).
 * @param {string} input - partial skill string
 * @param {string[]} existingSkills - already added skills to exclude
 * @returns {string[]}
 */
function suggestSkills(input, existingSkills = []) {
    const query = String(input || '').toLowerCase().trim();
    if (!query || query.length < 2) return [];

    const existing = existingSkills.map((s) => s.toLowerCase());
    return SKILL_KEYWORD_DICT
        .filter((s) => s.includes(query) && !existing.includes(s))
        .slice(0, 8);
}

/**
 * Keyword-based fallback skill extraction.
 */
function keywordFallback(text) {
    const lower = text.toLowerCase();
    return SKILL_KEYWORD_DICT.filter((skill) => lower.includes(skill));
}

module.exports = { extractSkillsFromBio, suggestSkills, SKILL_KEYWORD_DICT };
