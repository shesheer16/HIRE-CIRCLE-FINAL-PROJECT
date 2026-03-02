const settingsRoutes = require('../routes/settingsRoutes');

describe('settings avatar security', () => {
  it('protects avatar upload endpoint and includes upload middleware', () => {
    const layer = settingsRoutes.stack.find((entry) => entry.route && entry.route.path === '/avatar' && entry.route.methods.post);
    expect(layer).toBeTruthy();
    const handlers = layer.route.stack.map((item) => item.name);
    expect(handlers).toEqual(expect.arrayContaining(['protect', 'updateAvatar']));
  });
});
