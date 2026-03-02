const CallSession = require('../models/CallSession');

describe('video call flow', () => {
  it('keeps call session schema aligned to signaling flow', () => {
    const doc = new CallSession({
      roomId: 'room-1',
      applicationId: '507f191e810c19729de860ea',
      callerId: '507f191e810c19729de860eb',
      calleeId: '507f191e810c19729de860ec',
    });

    expect(doc.status).toBe('ringing');
    expect(doc.offer).toBeNull();
    expect(doc.answer).toBeNull();
    expect(Array.isArray(doc.iceCandidates)).toBe(true);
  });
});
