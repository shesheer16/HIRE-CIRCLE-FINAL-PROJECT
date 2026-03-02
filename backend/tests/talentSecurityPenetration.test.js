const matchingRoutes = require('../routes/matchingRoutes');

describe('talent security penetration', () => {
  it('applies auth middleware to all talent matching endpoints', () => {
    const protectedRoutes = matchingRoutes.stack
      .filter((entry) => entry.route)
      .map((entry) => entry.route.stack.map((layer) => layer.name));

    expect(protectedRoutes.length).toBeGreaterThan(0);
    protectedRoutes.forEach((handlers) => {
      expect(handlers[0]).toBe('protect');
    });
  });
});
