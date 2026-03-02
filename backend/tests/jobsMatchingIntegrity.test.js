const { rankJobsForWorker } = require('../match/matchEngineV2');

describe('jobs matching integrity', () => {
  it('never returns NaN or Infinity scores', () => {
    const worker = {
      _id: 'worker-1',
      firstName: 'Arun',
      city: 'Hyderabad',
      roleProfiles: [{ roleName: 'Driver', skills: ['Driving'], expectedSalary: 25000, experienceInRole: 2 }],
      interviewVerified: true,
    };
    const workerUser = { hasCompletedProfile: true, isVerified: true };
    const jobs = [{ _id: 'job-1', title: 'Driver', location: 'Hyderabad', requirements: ['Driving'], maxSalary: 28000, shift: 'Flexible', isOpen: true }];

    const result = rankJobsForWorker({ worker, workerUser, jobs });
    expect(result.matches).toHaveLength(1);
    expect(Number.isFinite(result.matches[0].finalScore)).toBe(true);
    expect(Number.isFinite(result.matches[0].matchScore)).toBe(true);
  });
});
