const { rankWorkersForJob } = require('../match/matchEngineV2');

describe('talent match integrity', () => {
  it('returns deterministic ranking with finite scores', () => {
    const job = {
      _id: 'job-1',
      title: 'Warehouse Associate',
      location: 'Hyderabad',
      shift: 'Flexible',
      maxSalary: 35000,
      requirements: ['Loading', 'Inventory'],
    };

    const candidate = {
      worker: {
        _id: 'worker-1',
        firstName: 'A',
        city: 'Hyderabad',
        preferredShift: 'Flexible',
        roleProfiles: [{ roleName: 'Warehouse Associate', skills: ['Loading', 'Inventory'], expectedSalary: 28000, experienceInRole: 3 }],
      },
      user: { hasCompletedProfile: true, isVerified: true },
      trustMetrics: { trustScore: 88, hireSuccessScore: 62, responseScore: 80 },
    };

    const runA = rankWorkersForJob({ job, candidates: [candidate] });
    const runB = rankWorkersForJob({ job, candidates: [candidate] });

    expect(runA.matches).toHaveLength(1);
    expect(runA.matches[0].finalScore).toBe(runB.matches[0].finalScore);
    expect(Number.isFinite(runA.matches[0].finalScore)).toBe(true);
  });
});
