const jobRoutes = require('../routes/jobRoutes');

describe('my jobs fetch flow', () => {
  it('protects GET /my-jobs behind auth + employer middleware', () => {
    const layer = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/my-jobs' && entry.route.methods.get);
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((item) => item.name);
    expect(handlers).toEqual(expect.arrayContaining(['protect', 'employer']));
  });
});
