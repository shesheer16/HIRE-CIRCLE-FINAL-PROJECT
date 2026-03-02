const { canTransition } = require('../workflow/applicationStateMachine');

describe('job apply integration', () => {
  it('allows apply path and blocks duplicate terminal overwrites', () => {
    expect(canTransition({ fromStatus: 'applied', toStatus: 'shortlisted' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'hired', toStatus: 'applied' }).valid).toBe(false);
  });
});
