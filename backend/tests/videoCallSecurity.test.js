const CallSession = require('../models/CallSession');

describe('video call security', () => {
  it('rejects illegal status payloads at schema validation', () => {
    const invalid = new CallSession({
      roomId: 'room-2',
      applicationId: '507f191e810c19729de860ea',
      callerId: '507f191e810c19729de860eb',
      calleeId: '507f191e810c19729de860ec',
      status: 'hijacked',
    });

    const err = invalid.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.status).toBeTruthy();
  });
});
