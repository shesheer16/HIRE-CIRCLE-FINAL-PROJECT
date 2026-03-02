const jobRoutes = require('../routes/jobRoutes');

describe('my jobs security penetration', () => {
  it('requires employer gate for mutating job routes', () => {
    const putLayer = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/:id' && entry.route.methods.put);
    const deleteLayer = jobRoutes.stack.find((entry) => entry.route && entry.route.path === '/:id' && entry.route.methods.delete);

    const putHandlers = putLayer.route.stack.map((item) => item.name);
    const deleteHandlers = deleteLayer.route.stack.map((item) => item.name);

    expect(putHandlers).toEqual(expect.arrayContaining(['protect', 'employer']));
    expect(deleteHandlers).toEqual(expect.arrayContaining(['protect', 'employer']));
  });
});
