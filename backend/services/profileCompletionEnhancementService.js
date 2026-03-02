'use strict';

/**
 * profileCompletionEnhancementService.js
 * 
 * Provides a highly competitive, non-disruptive layer for the visual Profile Progress Bar.
 * Analyzes an existing WorkerProfile without mutating data, outputting:
 * 1. Visual % Completion.
 * 2. Improve-profile suggestions based on missing fields.
 * 3. Conversion hints to drive user behavior towards trust-building actions.
 */

const WorkerProfile = require('../models/WorkerProfile');

const PROFILE_FIELDS = [
    { key: 'avatar', weight: 15, hint: 'Add a professional photo to get up to 3x more interview requests.' },
    { key: 'roleProfiles', weight: 20, isArray: true, hint: 'Add your specific skills and expected salary to match with precision.' },
    { key: 'totalExperience', weight: 10, hint: 'Specify your years of experience to qualify for senior roles.' },
    { key: 'language', weight: 5, hint: 'Add your spoken languages to improve communication trust with employers.' },
    { key: 'licenses', weight: 10, isArray: true, hint: 'List mandatory licenses or certifications to unlock verified jobs.' },
    { key: 'videoIntroduction.videoUrl', weight: 20, nested: true, hint: 'Record a 30-second Video Introduction to stand out to premium employers.' },
    { key: 'interviewVerified', weight: 20, isBoolean: true, hint: 'Complete the AI Smart Interview to earn the "Top Candidate" badge.' }
];

function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Computes the enhanced profile completion metrics.
 * @param {String} workerId (maps to User ObjectId)
 */
async function getProfileCompletionMetrics(workerId) {
    const profile = await WorkerProfile.findOne({ user: workerId }).lean();

    if (!profile) {
        return {
            completionPercentage: 0,
            suggestions: ['Create your basic profile to start getting matches.'],
            conversionHints: ['Fully completed profiles get hired 5x faster.'],
            status: 'incomplete'
        };
    }

    let earnedWeight = 0;
    let totalWeight = 0;
    const suggestions = [];

    for (const field of PROFILE_FIELDS) {
        totalWeight += field.weight;
        let isFilled = false;

        if (field.nested) {
            const val = getNestedValue(profile, field.key);
            isFilled = Boolean(val);
        } else if (field.isArray) {
            const arr = profile[field.key];
            isFilled = Array.isArray(arr) && arr.length > 0;
        } else if (field.isBoolean) {
            isFilled = profile[field.key] === true;
        } else {
            const val = profile[field.key];
            isFilled = val !== null && val !== undefined && val !== '';
        }

        if (isFilled) {
            earnedWeight += field.weight;
        } else {
            suggestions.push(field.hint);
        }
    }

    // Normalize to 0-100 just in case weights don't perfectly equal 100
    const completionPercentage = Math.round((earnedWeight / totalWeight) * 100);

    // Compute dynamic conversion hints based on current progress
    const conversionHints = [];
    if (completionPercentage === 100) {
        conversionHints.push('Your profile is in the top 1% for completeness! Employers are actively reviewing it.');
    } else if (completionPercentage >= 80) {
        conversionHints.push('Almost there! Completing the final details can boost your visibility by 40%.');
    } else if (completionPercentage >= 50) {
        conversionHints.push('You have a solid foundation, but premium employers filter out incomplete profiles.');
    } else {
        conversionHints.push('Your low completion rate is hiding you from top matches. Add more details!');
    }

    if (!profile.videoIntroduction || !profile.videoIntroduction.videoUrl) {
        conversionHints.push('Profiles with video introductions receive 60% higher employer engagement.');
    }

    let visualStatus = 'poor';
    if (completionPercentage >= 90) visualStatus = 'excellent';
    else if (completionPercentage >= 65) visualStatus = 'good';
    else if (completionPercentage >= 40) visualStatus = 'fair';

    return {
        completionPercentage,
        visualStatus,
        suggestions, // Actionable UI hints for missing fields
        conversionHints // Psychological drivers for completion
    };
}

module.exports = {
    getProfileCompletionMetrics,
    PROFILE_FIELDS
};
