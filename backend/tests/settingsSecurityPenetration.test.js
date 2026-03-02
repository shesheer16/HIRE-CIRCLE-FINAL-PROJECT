const settingsRoutes = require('../routes/settingsRoutes');

describe('settings security penetration', () => {
  it('keeps all mutation routes protected', () => {
    const mutating = settingsRoutes.stack.filter((entry) => entry.route && ['post', 'put', 'delete'].some((method) => entry.route.methods[method]));
    expect(mutating.length).toBeGreaterThan(0);
    mutating.forEach((entry) => {
      expect(entry.route.stack[0].name).toBe('protect');
    });
  });
});
