const Application = require('../models/Application');

describe('my jobs detail integrity', () => {
  it('indexes employer status timeline for stable stats queries', () => {
    const indexes = Application.schema.indexes();
    const employerStatus = indexes.some(([spec]) => spec.employer === 1 && spec.status === 1 && spec.updatedAt === -1);
    expect(employerStatus).toBe(true);
  });
});
