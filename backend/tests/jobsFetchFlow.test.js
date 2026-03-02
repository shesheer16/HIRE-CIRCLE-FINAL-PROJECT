const jobRoutes = require('../routes/jobRoutes');

describe('jobs fetch flow', () => {
  it('protects GET /api/jobs route', () => {
    const layer = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/' && entry.route.methods.get);
    expect(layer).toBeTruthy();
    expect(layer.route.stack[0].name).toBe('protect');
  });
});
