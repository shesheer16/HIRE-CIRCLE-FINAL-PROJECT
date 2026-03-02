'use strict';
/**
 * interviewReportService.js
 * Feature #80 — Custom Interview Analysis Report (Paid)
 *
 * Generates structured interview analysis reports from transcript/rating data.
 * Non-disruptive: additive layer. Uses pure computation (no DB writes).
 */

const REPORT_TIERS = {
    basic: { name: 'Basic Report', price: 299, sections: ['summary', 'rating', 'top_skills'] },
    standard: { name: 'Standard Report', price: 699, sections: ['summary', 'rating', 'top_skills', 'gaps', 'tips'] },
    premium: { name: 'Premium Report', price: 1499, sections: ['summary', 'rating', 'top_skills', 'gaps', 'tips', 'benchmark', 'custom_feedback'] },
};

/**
 * Build a structured interview analysis report.
 */
function buildInterviewReport(tier, interviewData = {}) {
    const config = REPORT_TIERS[tier];
    if (!config) throw Object.assign(new Error(`Invalid tier. Allowed: ${Object.keys(REPORT_TIERS).join(', ')}`), { code: 400 });

    const {
        candidateName = 'Candidate',
        jobTitle = 'Position',
        rating = 0,
        transcript = '',
        skills = [],
        gaps = [],
    } = interviewData;

    const sections = {};

    if (config.sections.includes('summary')) {
        sections.summary = `Interview analysis for ${candidateName} applying for ${jobTitle}.`;
    }
    if (config.sections.includes('rating')) {
        sections.rating = {
            score: Number(rating),
            band: rating >= 80 ? 'Excellent' : rating >= 60 ? 'Good' : rating >= 40 ? 'Average' : 'Poor',
        };
    }
    if (config.sections.includes('top_skills')) {
        sections.topSkills = skills.slice(0, 5);
    }
    if (config.sections.includes('gaps')) {
        sections.gaps = gaps.length > 0 ? gaps : ['No specific gaps identified'];
    }
    if (config.sections.includes('tips')) {
        sections.improvementTips = generateTips(rating, skills, gaps);
    }
    if (config.sections.includes('benchmark')) {
        sections.benchmark = {
            industryAvgRating: 65,
            candidateVsIndustry: Number(rating) > 65 ? 'Above average' : 'Below average',
        };
    }
    if (config.sections.includes('custom_feedback')) {
        sections.customFeedback = `Based on the interview, ${candidateName} demonstrates ${skills.length > 2 ? 'strong' : 'moderate'} overall capability.`;
    }

    return {
        reportId: `RPT-${Date.now()}`,
        tier,
        tierName: config.name,
        price: config.price,
        generatedAt: new Date(),
        candidate: candidateName,
        jobTitle,
        sections,
    };
}

function generateTips(rating, skills, gaps) {
    const tips = [];
    if (Number(rating) < 60) tips.push('Practice answering competency-based questions using the STAR method.');
    if (skills.length < 3) tips.push('Highlight more relevant technical skills during the interview.');
    if (gaps.length > 0) tips.push(`Work on bridging skill gaps: ${gaps.slice(0, 2).join(', ')}.`);
    if (tips.length === 0) tips.push('Maintain your strong performance and continue refining your communication style.');
    return tips;
}

/**
 * Validate a report ID format.
 */
function validateReportId(reportId) {
    return /^RPT-\d+$/.test(String(reportId || ''));
}

/**
 * Compute rating band label.
 */
function getRatingBand(score) {
    const s = Number(score);
    if (s >= 80) return 'Excellent';
    if (s >= 60) return 'Good';
    if (s >= 40) return 'Average';
    return 'Poor';
}

module.exports = {
    REPORT_TIERS,
    buildInterviewReport,
    validateReportId,
    getRatingBand,
    generateTips,
};
