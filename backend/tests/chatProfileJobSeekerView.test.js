jest.mock('../models/Application', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/EmployerProfile', () => ({
  findOne: jest.fn(),
}));

const Application = require('../models/Application');
const EmployerProfile = require('../models/EmployerProfile');
const { getApplicationById } = require('../controllers/applicationController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('chat profile job seeker view', () => {
  it('returns employer panel details without internal applicant leakage', async () => {
    const appDoc = {
      _id: 'app-3',
      status: 'offer_sent',
      sla: { employerResponseHours: 7 },
      job: {
        title: 'Driver',
        location: 'Pune',
        salaryRange: '22000-30000',
        shift: 'Day',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
      },
      employer: {
        _id: '507f191e810c19729de860eb',
        name: 'FleetOps',
        trustScore: 80,
        responseScore: 71,
        verificationSignals: { companyRegistrationVerified: true },
      },
      worker: {
        _id: '507f191e810c19729de860ef',
        user: { _id: '507f191e810c19729de860ea' },
      },
      toObject() {
        return {
          _id: this._id,
          status: this.status,
          job: this.job,
          employer: this.employer,
          worker: this.worker,
          sla: this.sla,
        };
      },
    };

    Application.findById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(appDoc),
        }),
      }),
    });

    EmployerProfile.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        companyName: 'FleetOps',
        industry: 'Transport',
        website: 'https://fleetops.example',
      }),
    });

    const req = {
      params: { id: 'app-3' },
      user: { _id: '507f191e810c19729de860ea' },
    };
    const res = mockRes();

    await getApplicationById(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.chatProfile.employer.companyName).toBe('FleetOps');
    expect(payload.chatProfile.employer.jobDetails.title).toBe('Driver');
    expect(payload.chatProfile.employer.jobDetails.shift).toBe('Day');
    expect(payload.chatProfile.employer).not.toHaveProperty('otherApplicants');
  });
});
