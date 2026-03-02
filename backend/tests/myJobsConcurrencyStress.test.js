const Job = require('../models/Job');

describe('my jobs concurrency stress', () => {
  it('keeps employer + status + createdAt index for high-volume fetches', () => {
    const indexes = Job.schema.indexes();
    const hasIndex = indexes.some(([spec]) => spec.employerId === 1 && spec.status === 1 && spec.createdAt === -1);
    expect(hasIndex).toBe(true);
  });
});
