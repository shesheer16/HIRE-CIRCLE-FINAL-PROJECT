const settingsRoutes = require('../routes/settingsRoutes');

describe('settings account edit flow', () => {
  it('protects account update endpoint', () => {
    const layer = settingsRoutes.stack.find((entry) => entry.route && entry.route.path === '/' && entry.route.methods.put);
    expect(layer).toBeTruthy();
    expect(layer.route.stack[0].name).toBe('protect');
  });
});
