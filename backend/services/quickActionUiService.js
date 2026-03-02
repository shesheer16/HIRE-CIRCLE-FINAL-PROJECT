'use strict';
/**
 * quickActionUiService.js
 * Feature #8: Job test/assessment link (optional)
 * Feature #19: More animated skeleton loaders (config)
 * Feature #24: Accept job with one tap confirmation
 * Feature #26: Floating action button contextual actions
 * 
 * UI state coordination for fast, contextual screen actions.
 */

/**
 * Feature #8: Validate and expose assessment test URI for a job card.
 */
function getAssessmentLink(job) {
    if (!job || !job.requirements || !job.requirements.assessmentUrl) return null;

    const url = String(job.requirements.assessmentUrl);
    if (url.startsWith('https://')) return url;
    return null; // Require secure 3rd party links only
}

/**
 * Feature #19: Supply the strict UI delay/layer configuration for skeletons.
 * Frontend asks backend what layout to skeletonize based on API endpoint latency.
 */
function getSkeletonConfig(routeType = 'list') {
    const configs = {
        'list': { type: 'bars', count: 5, animation: 'shimmer', delayMs: 100 },
        'card': { type: 'profile_card', animation: 'pulse', delayMs: 200 },
        'map': { type: 'map_pins', count: 10, animation: 'fade', delayMs: 0 }
    };
    return configs[routeType] || configs['list'];
}

/**
 * Feature #24: Validate a one-tap fast accept action payload.
 */
function validateOneTapAccept(offerId, userId, biometricToken) {
    if (!offerId || !userId) throw new Error('Missing payload elements');
    // If one tap accept is invoked, biometricToken must be verified (to prevent pocket dials)
    if (!biometricToken) throw new Error('One tap requires biometric confirmation in strict mode');
    return { valid: true, action: 'CONFIRM' };
}

/**
 * Feature #26: Contextual Floating Action Button states.
 * Determine what the FAB should do based on the screen context.
 */
function determineFabContext(screen = 'home', userRole = 'talent') {
    if (userRole === 'employer') {
        if (screen === 'home') return { icon: 'plus', action: 'create_job' };
        if (screen === 'messages') return { icon: 'broadcast', action: 'bulk_message' };
    } else {
        if (screen === 'home') return { icon: 'map', action: 'toggle_map' };
        if (screen === 'applications') return { icon: 'document', action: 'upload_resume' };
    }
    return null; // Hide FAB
}

module.exports = {
    getAssessmentLink,
    getSkeletonConfig,
    validateOneTapAccept,
    determineFabContext
};
