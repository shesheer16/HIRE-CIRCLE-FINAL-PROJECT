const { canTransition } = require('../workflow/applicationStateMachine');

describe('applications escrow integration', () => {
  it('keeps hired as terminal stage for downstream escrow trigger', () => {
    expect(canTransition({ fromStatus: 'offer_accepted', toStatus: 'hired' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'hired', toStatus: 'offer_sent' }).valid).toBe(false);
  });
});
