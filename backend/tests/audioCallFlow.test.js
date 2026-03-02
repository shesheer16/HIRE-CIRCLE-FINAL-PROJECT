const CallSession = require('../models/CallSession');

describe('audio call flow', () => {
  it('supports lifecycle statuses used by audio signaling', () => {
    const statuses = CallSession.schema.path('status').enumValues;
    expect(statuses).toEqual(expect.arrayContaining(['ringing', 'active', 'rejected', 'ended', 'timeout']));
  });
});
