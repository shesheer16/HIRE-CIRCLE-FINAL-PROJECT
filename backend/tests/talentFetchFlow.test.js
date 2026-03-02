const matchingRoutes = require('../routes/matchingRoutes');

describe('talent fetch flow', () => {
  it('protects employer talent fetch route with auth middleware', () => {
    const layer = matchingRoutes.stack.find((entry) => entry.route && entry.route.path === '/employer/:jobId' && entry.route.methods.get);
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((item) => item.name);
    expect(handlers[0]).toBe('protect');
  });
});
