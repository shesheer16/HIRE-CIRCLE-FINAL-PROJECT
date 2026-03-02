'use strict';

/**
 * applicationProgressBarIntegrity.test.js
 * 
 * Verifies that the internal state machine accurately maps down to the 
 * 4-step linear visual progress bar (Phase 28).
 */

const { getVisualProgress } = require('../services/applicationProgressBarService');

describe('Application Progress Bar Integrity', () => {

    test('Maps basic "applied" status to Step 0', () => {
        const visual = getVisualProgress('applied');
        expect(visual.currentVisualStepIndex).toBe(0);
        expect(visual.isTerminalFailure).toBe(false);
        expect(visual.steps[0].state).toBe('active');
        expect(visual.steps[1].state).toBe('upcoming');
    });

    test('Maps "interview_scheduled" status to Step 1', () => {
        const visual = getVisualProgress('interview_scheduled');
        expect(visual.currentVisualStepIndex).toBe(1);
        expect(visual.isTerminalFailure).toBe(false);
        expect(visual.steps[0].state).toBe('completed');
        expect(visual.steps[1].state).toBe('active');
        expect(visual.steps[2].state).toBe('upcoming');
    });

    test('Maps terminal failures (e.g. "rejected") to failed visual state', () => {
        const visual = getVisualProgress('rejected');
        // Rejected stays at step 0 visually, but marked as failed
        expect(visual.currentVisualStepIndex).toBe(0);
        expect(visual.isTerminalFailure).toBe(true);
        expect(visual.steps[0].state).toBe('failed');
        expect(visual.overallMessage).toContain('not selected');
    });

    test('Maps "escrow_funded" status to Step 2', () => {
        const visual = getVisualProgress('escrow_funded');
        expect(visual.currentVisualStepIndex).toBe(2);
        expect(visual.isTerminalFailure).toBe(false);
        expect(visual.steps[1].state).toBe('completed');
        expect(visual.steps[2].state).toBe('active');
    });

    test('Maps "work_started" to final Step 3 (Hired)', () => {
        const visual = getVisualProgress('work_started');
        expect(visual.currentVisualStepIndex).toBe(3);
        expect(visual.isTerminalFailure).toBe(false);
        expect(visual.steps[2].state).toBe('completed');
        expect(visual.steps[3].state).toBe('active'); // active step is the current one
    });

    test('Handles unknown statuses smoothly with fallback', () => {
        const visual = getVisualProgress('some_weird_string');
        expect(visual.currentVisualStepIndex).toBe(0);
        expect(visual.isTerminalFailure).toBe(false);
        expect(visual.steps[0].state).toBe('active');
    });

});
