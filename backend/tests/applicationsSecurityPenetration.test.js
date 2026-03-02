const applicationRoutes = require('../routes/applicationRoutes');

describe('applications security penetration', () => {
  it('enforces auth on all application endpoints', () => {
    const appRouteLayers = applicationRoutes.stack.filter((entry) => entry.route);
    expect(appRouteLayers.length).toBeGreaterThan(0);
    appRouteLayers.forEach((layer) => {
      expect(layer.route.stack[0].name).toBe('protect');
    });
  });
});
