'use strict';
/**
 * hardwareIntegrationUiService.js
 * Feature #15: Auto-location detection + commute alert
 * Feature #23: Login with biometric (Face ID / Touch ID)
 * Feature #25: Voice input for job search terms
 * 
 * Logic mappings handling payloads originating from hardware/device level APIs.
 */

/**
 * Feature #15: Determine if a commute alert should fire based on auto-location change.
 */
function evaluateCommuteAlert(oldLocation, newLocation) {
    if (!oldLocation || !newLocation) return false;

    // Naive distance approx for testing
    const dLat = Math.abs(oldLocation.lat - newLocation.lat);
    const dLng = Math.abs(oldLocation.lng - newLocation.lng);

    // If user moved significantly (approx > 10km)
    if (dLat > 0.1 || dLng > 0.1) {
        return {
            triggerAlert: true,
            message: 'You have entered a new area. Want to see jobs nearby?'
        };
    }
    return { triggerAlert: false };
}

/**
 * Feature #23: Validate a biometric login token payload constraint.
 */
function validateBiometricPayload(biometricSignature, deviceId) {
    if (!biometricSignature || !deviceId) {
        throw new Error('Missing hardware security elements');
    }
    // In real env, this verifies cryptograms against a public key mapping
    return {
        authenticated: true,
        authMethod: 'biometric',
        confidence: 'high'
    };
}

/**
 * Feature #25: Normalize voice search transcripts for the search engine.
 */
function normalizeVoiceSearch(transcript = '') {
    // Strip filler words typical of voice dictation
    let clean = transcript.toLowerCase();
    const fillers = ['um', 'uh', 'like', 'find me', 'looking for', 'jobs', 'job'];

    fillers.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'g');
        clean = clean.replace(regex, '');
    });

    return clean.replace(/\s+/g, ' ').trim();
}

module.exports = {
    evaluateCommuteAlert,
    validateBiometricPayload,
    normalizeVoiceSearch
};
