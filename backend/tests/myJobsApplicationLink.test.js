const Application = require('../models/Application');

describe('my jobs application link', () => {
  it('retains direct refs to job, worker and employer', () => {
    expect(Application.schema.path('job').options.ref).toBe('Job');
    expect(Application.schema.path('worker').options.ref).toBe('WorkerProfile');
    expect(Application.schema.path('employer').options.ref).toBe('User');
  });
});
