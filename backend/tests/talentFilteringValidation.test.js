const Job = require('../models/Job');

describe('talent filtering validation', () => {
  it('keeps geo indexes available for bounded talent filtering queries', () => {
    const indexes = Job.schema.indexes();
    const geoIndex = indexes.some(([spec]) => spec.countryCode === 1 && spec.regionCode === 1 && spec.createdAt === -1);
    expect(geoIndex).toBe(true);
  });
});
