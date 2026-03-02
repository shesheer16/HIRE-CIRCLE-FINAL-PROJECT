const { canTransition } = require('../workflow/applicationStateMachine');

describe('applications state machine hardening', () => {
  it('permits only legal transitions through hiring pipeline', () => {
    expect(canTransition({ fromStatus: 'applied', toStatus: 'shortlisted' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'shortlisted', toStatus: 'interview_requested' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'interview_requested', toStatus: 'offer_sent' }).valid).toBe(false);
    expect(canTransition({ fromStatus: 'offer_sent', toStatus: 'hired' }).valid).toBe(false);
    expect(canTransition({ fromStatus: 'offer_accepted', toStatus: 'hired' }).valid).toBe(true);
  });
});
