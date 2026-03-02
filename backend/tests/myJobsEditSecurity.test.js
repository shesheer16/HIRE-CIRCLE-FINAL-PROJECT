const Job = require('../models/Job');

describe('my jobs edit security', () => {
  it('keeps employer ownership field mandatory in schema', () => {
    const employerPath = Job.schema.path('employerId');
    expect(employerPath).toBeTruthy();
    expect(employerPath.options.required).toBe(true);
  });
});
