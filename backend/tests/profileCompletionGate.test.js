const {
  evaluateWorkerProfileCompletion,
  evaluateEmployerProfileCompletion,
  isActionAllowedByProfileCompletion,
} = require('../services/profileCompletionService');

describe('profile completion gate', () => {
  it('blocks apply action when worker mandatory fields are incomplete', () => {
    const completion = evaluateWorkerProfileCompletion({
      user: { name: 'Ravi', isVerified: true },
      workerProfile: {
        firstName: 'Ravi',
        city: 'Delhi',
        roleProfiles: [{ roleName: 'Delivery Partner', skills: ['Driving'], experienceInRole: 1 }],
        interviewVerified: false,
      },
    });

    const gate = isActionAllowedByProfileCompletion({
      action: 'apply',
      completion,
    });

    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('PROFILE_COMPLETION_REQUIRED');
    expect(gate.missingRequiredFields).toEqual(expect.arrayContaining(['profile_picture', 'expected_salary', 'smart_interview']));
  });

  it('allows apply action once worker profile is fully complete', () => {
    const completion = evaluateWorkerProfileCompletion({
      user: { name: 'Nisha', city: 'Mumbai', isVerified: true },
      workerProfile: {
        firstName: 'Nisha',
        city: 'Mumbai',
        avatar: 'https://assets.example.com/nisha.png',
        totalExperience: 3,
        availabilityWindowDays: 0,
        isAvailable: true,
        interviewVerified: true,
        roleProfiles: [{
          roleName: 'Retail Associate',
          experienceInRole: 3,
          expectedSalary: 32000,
          skills: ['Billing', 'Customer service'],
        }],
      },
    });

    const gate = isActionAllowedByProfileCompletion({
      action: 'apply',
      completion,
    });

    expect(gate.allowed).toBe(true);
    expect(gate.missingRequiredFields).toHaveLength(0);
  });

  it('blocks post_job action until employer profile has required trust fields', () => {
    const completion = evaluateEmployerProfileCompletion({
      user: { name: 'Arjun', isVerified: true, city: 'Hyderabad' },
      employerProfile: {
        companyName: 'Rapid Staffing',
        location: 'Hyderabad',
      },
    });

    const gate = isActionAllowedByProfileCompletion({
      action: 'post_job',
      completion,
    });

    expect(gate.allowed).toBe(false);
    expect(gate.missingRequiredFields).toEqual(expect.arrayContaining([
      'company_logo',
      'company_description',
      'industry',
    ]));
  });
});
