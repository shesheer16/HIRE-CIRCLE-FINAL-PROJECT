const { canTransition } = require('../workflow/applicationStateMachine');

describe('talent shortlist flow', () => {
  it('allows shortlist progression and blocks illegal jumps', () => {
    expect(canTransition({ fromStatus: 'applied', toStatus: 'shortlisted' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'applied', toStatus: 'hired' }).valid).toBe(false);
  });
});
