const CallSession = require('../models/CallSession');

describe('realtime stress simulation', () => {
  it('allows bounded candidate buffer structure for ICE fan-in', () => {
    const session = new CallSession({
      roomId: 'room-5',
      applicationId: '507f191e810c19729de860ea',
      callerId: '507f191e810c19729de860eb',
      calleeId: '507f191e810c19729de860ec',
      iceCandidates: Array.from({ length: 50 }, (_, idx) => ({ id: idx })),
    });

    expect(session.iceCandidates).toHaveLength(50);
    expect(session.validateSync()).toBeUndefined();
  });
});
