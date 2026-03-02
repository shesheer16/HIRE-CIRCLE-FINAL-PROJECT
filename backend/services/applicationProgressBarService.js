'use strict';

/**
 * applicationProgressBarService.js
 * 
 * Maps complex internal application state machine statuses (15+ states)
 * into a simple, linear 4-step visual progress bar for the UI (Phase 28).
 * 
 * Steps:
 * 1. Applied (Reviewing)
 * 2. Interview (Scheduled/Completed)
 * 3. Offer (Proposed/Accepted/Escrow)
 * 4. Hired (Working/Released)
 */

const { CANONICAL_APPLICATION_STATUSES } = require('../workflow/applicationStateMachine');

const VISUAL_STEPS = [
    { id: 'applied', label: 'Applied', index: 0 },
    { id: 'interview', label: 'Interview', index: 1 },
    { id: 'offer', label: 'Offer & Escrow', index: 2 },
    { id: 'hired', label: 'Hired', index: 3 }
];

// Map internal statuses to the highest achieved visual step index
const STATUS_TO_STEP_MAP = {
    'applied': 0,
    'reviewed': 0,
    'rejected': 0,
    'withdrawn': 0,

    'interview_scheduled': 1,
    'interview_completed': 1,

    'offer_sent': 2,
    'offer_accepted': 2,
    'offer_declined': 2,
    'escrow_funded': 2,

    'work_started': 3,
    'payment_released': 3,
    'hired': 3,
    'completed': 3,
    'disputed': 3,

    // Legacy maps
    'requested': 0,
    'pending': 0,
    'accepted': 1,
    'offer_proposed': 2
};

/**
 * Derives the visual progress state for an application.
 * @param {String} currentStatus Internal DB status string
 * @returns {Object} ProgressBar definition
 */
function getVisualProgress(currentStatus) {
    const rawStatus = String(currentStatus || 'applied').toLowerCase();

    // If it's a completely unknown status, default to step 0
    let currentStepIndex = STATUS_TO_STEP_MAP[rawStatus];
    if (currentStepIndex === undefined) {
        currentStepIndex = 0;
    }

    // Handle terminal/failed states visually
    const isTerminalFailure = ['rejected', 'withdrawn', 'offer_declined', 'disputed'].includes(rawStatus);

    const steps = VISUAL_STEPS.map(step => {
        let state = 'upcoming'; // default

        if (step.index < currentStepIndex) {
            state = 'completed';
        } else if (step.index === currentStepIndex) {
            state = isTerminalFailure ? 'failed' : 'active';
        }

        return {
            ...step,
            state
        };
    });

    let overallMessage = '';

    if (isTerminalFailure) {
        if (rawStatus === 'rejected') overallMessage = 'Application was not selected.';
        else if (rawStatus === 'withdrawn') overallMessage = 'Application was withdrawn.';
        else if (rawStatus === 'offer_declined') overallMessage = 'You declined the offer.';
        else if (rawStatus === 'disputed') overallMessage = 'This job is currently under dispute.';
    } else {
        if (currentStepIndex === 0) overallMessage = 'The employer is reviewing your application.';
        if (currentStepIndex === 1) overallMessage = 'You are in the interview stage.';
        if (currentStepIndex === 2) overallMessage = 'Offer and payment details are being finalized.';
        if (currentStepIndex === 3) overallMessage = 'You are hired for this job!';
    }

    return {
        currentVisualStepIndex: currentStepIndex,
        isTerminalFailure,
        overallMessage,
        steps
    };
}

module.exports = {
    VISUAL_STEPS,
    getVisualProgress
};
