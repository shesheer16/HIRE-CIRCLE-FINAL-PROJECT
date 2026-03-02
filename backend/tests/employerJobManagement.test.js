const jobRoutes = require('../routes/jobRoutes');

describe('employer job management', () => {
  it('requires employer middleware for create/update/delete', () => {
    const createRoute = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/' && entry.route.methods.post);
    const updateRoute = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/:id' && entry.route.methods.put);
    const deleteRoute = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/:id' && entry.route.methods.delete);

    [createRoute, updateRoute, deleteRoute].forEach((routeLayer) => {
      const handlers = routeLayer.route.stack.map((item) => item.name);
      expect(handlers).toEqual(expect.arrayContaining(['protect', 'employer']));
    });
  });
});
