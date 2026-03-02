const { canTransition } = require('../workflow/applicationStateMachine');

describe('applications withdraw flow', () => {
  it('allows withdraw from active phases and blocks reopen from withdrawn', () => {
    expect(canTransition({ fromStatus: 'applied', toStatus: 'withdrawn' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'offer_sent', toStatus: 'withdrawn' }).valid).toBe(true);
    expect(canTransition({ fromStatus: 'withdrawn', toStatus: 'applied' }).valid).toBe(false);
  });
});
