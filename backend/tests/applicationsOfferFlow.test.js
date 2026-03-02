const { canTransition } = require('../workflow/applicationStateMachine');

describe('applications offer flow', () => {
  it('requires accepted offer stage before hired transition', () => {
    expect(canTransition({ fromStatus: 'offer_sent', toStatus: 'offer_accepted' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'offer_sent', toStatus: 'hired' }).valid).toBe(false);
  });
});
