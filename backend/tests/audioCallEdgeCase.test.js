const CallSession = require('../models/CallSession');

describe('audio call edge cases', () => {
  it('keeps startedAt and endedAt nullable for missed calls', () => {
    const doc = new CallSession({
      roomId: 'room-3',
      applicationId: '507f191e810c19729de860ea',
      callerId: '507f191e810c19729de860eb',
      calleeId: '507f191e810c19729de860ec',
      status: 'timeout',
    });

    expect(doc.startedAt).toBeNull();
    expect(doc.endedAt).toBeNull();
  });
});
