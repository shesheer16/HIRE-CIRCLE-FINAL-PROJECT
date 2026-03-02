const CallSession = require('../models/CallSession');

describe('video call concurrency', () => {
  it('exposes indexes required for active call sweeps', () => {
    const indexes = CallSession.schema.indexes();
    const hasStatusTimeoutIndex = indexes.some(([spec]) => spec.status === 1 && spec.timeoutAt === 1);
    const hasAppCreatedIndex = indexes.some(([spec]) => spec.applicationId === 1 && spec.createdAt === -1);

    expect(hasStatusTimeoutIndex).toBe(true);
    expect(hasAppCreatedIndex).toBe(true);
  });
});
