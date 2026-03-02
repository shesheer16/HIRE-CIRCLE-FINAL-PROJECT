'use strict';
/**
 * profileEngagementUiService.js
 * Feature #14: Automatic skill suggestions from text input
 * Feature #16: Profile completion progress bar w/ nudges
 * Feature #22: Profile bio analyzer + AI suggestions
 * Feature #28: Dynamic onboarding story screens
 * Feature #29: Microcopy gamification
 * Feature #30: Background photo upload progress indicator
 * 
 * Non-disruptive mapping layer for profile-driven UX states.
 */

/**
 * Feature #14: Suggest skills based on text input (e.g. job title or bio snippet).
 */
function suggestSkillsFromText(text = '') {
    const lowercaseText = String(text).toLowerCase();
    const suggestions = [];

    if (lowercaseText.includes('react') || lowercaseText.includes('frontend')) {
        suggestions.push('React.js', 'JavaScript', 'CSS');
    }
    if (lowercaseText.includes('delivery') || lowercaseText.includes('driver')) {
        suggestions.push('Driving License', 'Time Management', 'Route Planning');
    }
    if (lowercaseText.includes('manage') || lowercaseText.includes('lead')) {
        suggestions.push('Leadership', 'Team Management');
    }

    return suggestions.slice(0, 5); // Return top 5
}

/**
 * Feature #22: Analyze bio text and return AI improvement suggestions.
 */
function analyzeProfileBio(bioText = '') {
    const text = String(bioText).trim();
    if (!text || text.length < 20) {
        return { score: 30, feedback: 'Your bio is too short. Add more details about your experience.' };
    }
    if (!text.toLowerCase().includes('years') && !text.toLowerCase().includes('experience')) {
        return { score: 60, feedback: 'Mention your years of experience to stand out.' };
    }
    return { score: 90, feedback: 'Looks great! Very descriptive.' };
}

/**
 * Feature #28 & #29: Generate gamified microcopy based on profile completion.
 */
function generateCompletionMicrocopy(completionPercentage) {
    if (completionPercentage < 40) return "Let's get the basics down!";
    if (completionPercentage < 70) return "You're halfway there, keep going! 🚀";
    if (completionPercentage < 100) return "Almost perfect! Just a few more details.";
    return "All-Star Profile! 🌟";
}

/**
 * Feature #30: Background photo upload state tracker.
 */
function formatUploadProgress(bytesLoaded, bytesTotal) {
    if (!bytesTotal || bytesTotal <= 0) return { percent: 0, status: 'pending' };
    const percent = Math.min(Math.round((bytesLoaded / bytesTotal) * 100), 100);
    return {
        percent,
        status: percent === 100 ? 'complete' : 'uploading',
        isBackgroundSafe: true // Instructs client this can continue if app suspended
    };
}

module.exports = {
    suggestSkillsFromText,
    analyzeProfileBio,
    generateCompletionMicrocopy,
    formatUploadProgress
};
