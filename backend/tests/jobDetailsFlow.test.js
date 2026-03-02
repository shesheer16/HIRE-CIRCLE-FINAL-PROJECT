const Job = require('../models/Job');

describe('job details flow', () => {
  it('requires key details and preserves salary as string field', () => {
    expect(Job.schema.path('title').isRequired).toBeTruthy();
    expect(Job.schema.path('location').isRequired).toBeTruthy();
    expect(Job.schema.path('salaryRange').instance).toBe('String');
  });
});
