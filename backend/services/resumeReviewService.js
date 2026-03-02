'use strict';
/**
 * resumeReviewService.js
 * Feature #67 — Resume Review Paid AI Assistant
 *
 * Provides AI-powered resume analysis with fallback keyword analysis.
 * Non-disruptive: additive layer.
 */

const REVIEW_TIERS = {
    basic: { name: 'Basic Review', price: 299, checks: ['length', 'keywords', 'format'] },
    standard: { name: 'Standard Review', price: 699, checks: ['length', 'keywords', 'format', 'ats_score', 'suggestions'] },
    premium: { name: 'Premium Review', price: 1499, checks: ['length', 'keywords', 'format', 'ats_score', 'suggestions', 'industry_match', 'rewrite_tips'] },
};

const STRONG_KEYWORDS = [
    'managed', 'delivered', 'led', 'achieved', 'improved', 'optimised',
    'built', 'scaled', 'reduced', 'increased', 'launched', 'coordinated',
];
const WEAK_KEYWORDS = [
    'responsible for', 'helped', 'assisted', 'worked on', 'participated',
];

/**
 * Perform a basic keyword analysis on resume text.
 */
function analyzeResumeKeywords(resumeText) {
    const lower = String(resumeText || '').toLowerCase();
    const strongCount = STRONG_KEYWORDS.filter((k) => lower.includes(k)).length;
    const weakCount = WEAK_KEYWORDS.filter((k) => lower.includes(k)).length;
    const wordCount = lower.split(/\s+/).filter(Boolean).length;
    const atsScore = Math.min(100, Math.round((strongCount / (strongCount + weakCount + 1)) * 80 + Math.min(wordCount / 5, 20)));

    return {
        wordCount,
        strongKeywordsFound: STRONG_KEYWORDS.filter((k) => lower.includes(k)),
        weakKeywordsFound: WEAK_KEYWORDS.filter((k) => lower.includes(k)),
        atsScore,
        suggestions: weakCount > 0
            ? ['Replace weak phrases like "responsible for" with strong action verbs (e.g., "Managed", "Led").']
            : [],
    };
}

/**
 * Build a resume review order.
 */
function buildReviewOrder(userId, tier = 'basic') {
    const config = REVIEW_TIERS[tier];
    if (!config) {
        throw Object.assign(new Error(`Invalid tier. Allowed: ${Object.keys(REVIEW_TIERS).join(', ')}`), { code: 400 });
    }
    if (!userId) throw Object.assign(new Error('userId required'), { code: 400 });
    return {
        userId: String(userId),
        tier,
        tierName: config.name,
        price: config.price,
        checks: config.checks,
        status: 'pending',
        createdAt: new Date(),
    };
}

/**
 * Score a resume's length appropriateness.
 */
function scoreLengthAppropriateness(wordCount) {
    if (wordCount < 100) return { score: 30, message: 'Resume too short. Add more details.' };
    if (wordCount <= 500) return { score: 90, message: 'Good resume length.' };
    if (wordCount <= 800) return { score: 70, message: 'Slightly long. Consider condensing.' };
    return { score: 40, message: 'Resume too long. Trim to 1-2 pages.' };
}

module.exports = {
    REVIEW_TIERS,
    STRONG_KEYWORDS,
    WEAK_KEYWORDS,
    analyzeResumeKeywords,
    buildReviewOrder,
    scoreLengthAppropriateness,
};
