const {
  evaluateWorkerProfileCompletion,
  evaluateEmployerProfileCompletion,
  syncUserProfileCompletionFlag,
} = require('../services/profileCompletionService');

describe('profile creation flow completion engine', () => {
  it('flags worker profile as incomplete when required fields are missing', () => {
    const completion = evaluateWorkerProfileCompletion({
      user: { name: 'Worker', isVerified: false, hasCompletedProfile: false },
      workerProfile: {
        firstName: 'Worker',
        city: '',
        roleProfiles: [],
        interviewVerified: false,
      },
    });

    expect(completion.actions.canAccessApp).toBe(false);
    expect(completion.actions.canApply).toBe(false);
    expect(completion.missingForApply).toEqual(expect.arrayContaining([
      'profile_picture',
      'city',
      'skills',
      'smart_interview',
    ]));
  });

  it('marks worker profile complete only when mandatory fields are present', () => {
    const completion = evaluateWorkerProfileCompletion({
      user: { name: 'Aarav Singh', isVerified: true, hasCompletedProfile: false, city: 'Pune' },
      workerProfile: {
        firstName: 'Aarav',
        city: 'Pune',
        avatar: 'https://assets.example.com/avatar.png',
        roleProfiles: [
          {
            roleName: 'Warehouse Associate',
            experienceInRole: 2,
            expectedSalary: 25000,
            skills: ['Inventory', 'Forklift'],
          },
        ],
        availabilityWindowDays: 15,
        interviewVerified: true,
        isAvailable: true,
      },
    });

    expect(completion.actions.canAccessApp).toBe(true);
    expect(completion.actions.canApply).toBe(true);
    expect(completion.missingForApply).toHaveLength(0);
    expect(completion.meetsProfileCompleteThreshold).toBe(true);
  });

  it('enforces employer posting gate until profile is structurally complete', () => {
    const completion = evaluateEmployerProfileCompletion({
      user: { name: 'Priya', isVerified: true, city: 'Bengaluru' },
      employerProfile: {
        companyName: 'Swift Logistics',
        logoUrl: 'https://assets.example.com/logo.png',
        description: 'Regional logistics operator',
        location: 'Bengaluru',
        industry: 'Logistics',
        contactPerson: 'Priya',
      },
    });

    expect(completion.actions.canAccessApp).toBe(true);
    expect(completion.actions.canPostJob).toBe(true);
    expect(completion.missingForPostJob).toHaveLength(0);
  });

  it('synchronizes persisted hasCompletedProfile flag with computed completion', async () => {
    const userDoc = {
      hasCompletedProfile: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const completion = { meetsProfileCompleteThreshold: true };

    const result = await syncUserProfileCompletionFlag({
      userDoc,
      completion,
    });

    expect(result).toEqual({ changed: true, hasCompletedProfile: true });
    expect(userDoc.hasCompletedProfile).toBe(true);
    expect(userDoc.save).toHaveBeenCalledTimes(1);
  });
});
