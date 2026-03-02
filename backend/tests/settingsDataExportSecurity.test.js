const settingsRoutes = require('../routes/settingsRoutes');

describe('settings data export security', () => {
  it('protects data export endpoint', () => {
    const layer = settingsRoutes.stack.find((entry) => entry.route && entry.route.path === '/data-download' && entry.route.methods.post);
    expect(layer).toBeTruthy();
    expect(layer.route.stack[0].name).toBe('protect');
  });
});
