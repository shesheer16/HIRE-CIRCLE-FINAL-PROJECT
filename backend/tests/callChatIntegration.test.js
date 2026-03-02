const CallSession = require('../models/CallSession');

describe('call chat integration', () => {
  it('captures timing fields for call history persistence', () => {
    const started = new Date('2026-01-01T01:00:00.000Z');
    const ended = new Date('2026-01-01T01:05:00.000Z');

    const call = new CallSession({
      roomId: 'room-4',
      applicationId: '507f191e810c19729de860ea',
      callerId: '507f191e810c19729de860eb',
      calleeId: '507f191e810c19729de860ec',
      status: 'ended',
      startedAt: started,
      endedAt: ended,
    });

    expect(call.startedAt.toISOString()).toBe(started.toISOString());
    expect(call.endedAt.toISOString()).toBe(ended.toISOString());
  });
});
