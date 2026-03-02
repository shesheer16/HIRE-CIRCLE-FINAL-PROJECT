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

describe('chat profile employer view', () => {
  it('returns candidate profile panel fields for employer-side chat', async () => {
    const applicationDoc = {
      _id: 'app-1',
      status: 'shortlisted',
      sla: { employerResponseHours: 5 },
      job: {
        title: 'Warehouse Lead',
        location: 'Hyderabad',
        salaryRange: '25000-40000',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      employer: {
        _id: '507f191e810c19729de860eb',
        name: 'Acme Logistics',
        trustScore: 81,
        responseScore: 77,
        verificationSignals: { companyRegistrationVerified: true },
      },
      worker: {
        _id: '507f191e810c19729de860ef',
        user: {
          _id: '507f191e810c19729de860ea',
          trustScore: 92,
          responseScore: 88,
        },
        firstName: 'Asha',
        lastName: 'K',
        totalExperience: 4,
        isAvailable: true,
        interviewVerified: true,
        roleProfiles: [{ roleName: 'Loader', skills: ['Loading', 'Dispatch'], expectedSalary: 32000 }],
        videoIntroduction: { transcript: 'I have four years of warehouse operations experience.' },
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
          populate: jest.fn().mockResolvedValue(applicationDoc),
        }),
      }),
    });

    EmployerProfile.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        companyName: 'Acme Logistics',
        industry: 'Logistics',
        location: 'Hyderabad',
      }),
    });

    const req = {
      params: { id: 'app-1' },
      user: { _id: '507f191e810c19729de860eb' },
    };
    const res = mockRes();

    await getApplicationById(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.chatProfile.candidate.name).toContain('Asha');
    expect(payload.chatProfile.candidate.skills).toEqual(expect.arrayContaining(['Loading']));
    expect(payload.chatProfile.candidate.profileCompleteness).toBeGreaterThan(0);
    expect(payload.chatProfile.candidate.salaryExpectation).toBe(32000);
  });
});
