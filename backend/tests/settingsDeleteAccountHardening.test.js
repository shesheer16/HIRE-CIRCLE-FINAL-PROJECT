const settingsRoutes = require('../routes/settingsRoutes');

describe('settings delete account hardening', () => {
  it('requires auth for account deletion endpoint', () => {
    const layer = settingsRoutes.stack.find((entry) => entry.route && entry.route.path === '/account' && entry.route.methods.delete);
    expect(layer).toBeTruthy();
    expect(layer.route.stack[0].name).toBe('protect');
  });
});
