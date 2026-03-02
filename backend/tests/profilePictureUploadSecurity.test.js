const settingsRoutes = require('../routes/settingsRoutes');
const { updateAvatar } = require('../controllers/settingsController');

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('profile picture upload security', () => {
  it('protects avatar endpoint with auth middleware', () => {
    const routeLayer = settingsRoutes.stack.find(
      (entry) => entry.route && entry.route.path === '/avatar' && entry.route.methods.post
    );

    expect(routeLayer).toBeTruthy();
    const handlers = routeLayer.route.stack.map((entry) => entry.name);
    expect(handlers).toEqual(expect.arrayContaining(['protect', 'updateAvatar']));
  });

  it('rejects unsupported avatar mime types', async () => {
    const req = {
      user: { _id: '507f191e810c19729de860aa', role: 'candidate', activeRole: 'worker' },
      file: {
        path: '/tmp/bad-avatar.svg',
        mimetype: 'image/svg+xml',
      },
    };
    const res = makeRes();

    await updateAvatar(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/unsupported avatar format/i),
    }));
  });

  it('requires avatar file presence', async () => {
    const req = {
      user: { _id: '507f191e810c19729de860aa', role: 'candidate', activeRole: 'worker' },
      file: null,
    };
    const res = makeRes();

    await updateAvatar(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/avatar file is required/i),
    }));
  });
});
