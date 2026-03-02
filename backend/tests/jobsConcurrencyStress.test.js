const Job = require('../models/Job');

describe('jobs concurrency stress', () => {
  it('keeps status + open + expiry index for high-volume feed reads', () => {
    const indexes = Job.schema.indexes();
    const hasFeedIndex = indexes.some(([spec]) => spec.status === 1 && spec.isOpen === 1 && spec.expiresAt === 1);
    expect(hasFeedIndex).toBe(true);
  });
});
