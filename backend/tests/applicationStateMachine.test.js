const {
    normalizeApplicationStatus,
    canTransition,
    getAllowedTransitions,
    isTerminalStatus,
} = require('../workflow/applicationStateMachine');

describe('applicationStateMachine', () => {
    it('normalizes legacy status aliases', () => {
        expect(normalizeApplicationStatus('pending')).toBe('applied');
        expect(normalizeApplicationStatus('offer_proposed')).toBe('offer_sent');
        expect(normalizeApplicationStatus('accepted')).toBe('interview_requested');
    });

    it('allows valid transitions and blocks illegal jumps', () => {
        expect(canTransition({ fromStatus: 'applied', toStatus: 'shortlisted' }).valid).toBe(true);
        expect(canTransition({ fromStatus: 'applied', toStatus: 'hired' }).valid).toBe(false);
    });

    it('marks terminal statuses and exposes allowed transition list', () => {
        expect(isTerminalStatus('hired')).toBe(true);
        expect(isTerminalStatus('rejected')).toBe(true);
        expect(isTerminalStatus('applied')).toBe(false);
        expect(getAllowedTransitions('offer_accepted')).toEqual(['hired', 'rejected']);
    });
});
