jest.mock('../models/Application', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/EmployerProfile', () => ({
  findOne: jest.fn(),
}));

const Application = require('../models/Application');
const { getApplicationById } = require('../controllers/applicationController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('chat profile security', () => {
  it('blocks unrelated users from reading chat profile payload', async () => {
    Application.findById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue({
            _id: 'app-2',
            status: 'shortlisted',
            employer: { _id: '507f191e810c19729de860eb' },
            worker: { user: { _id: '507f191e810c19729de860ea' } },
          }),
        }),
      }),
    });

    const req = {
      params: { id: 'app-2' },
      user: { _id: '507f191e810c19729de860ff' },
    };
    const res = mockRes();

    await getApplicationById(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
