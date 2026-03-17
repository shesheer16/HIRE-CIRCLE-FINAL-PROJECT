const {
    evaluateProfileCompletion,
    isUserProfileMarkedComplete,
    syncUserProfileCompletionFlag,
} = require('../services/profileCompletionService');

describe('profileCompletionService', () => {
    it('treats either readiness flag as complete', () => {
        expect(isUserProfileMarkedComplete({ hasCompletedProfile: true, profileComplete: false })).toBe(true);
        expect(isUserProfileMarkedComplete({ hasCompletedProfile: false, profileComplete: true })).toBe(true);
        expect(isUserProfileMarkedComplete({ hasCompletedProfile: false, profileComplete: false })).toBe(false);
    });

    it('syncs both readiness flags from completion output', async () => {
        const userDoc = {
            hasCompletedProfile: false,
            profileComplete: false,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const result = await syncUserProfileCompletionFlag({
            userDoc,
            completion: { meetsProfileCompleteThreshold: true },
        });

        expect(result).toEqual({
            changed: true,
            hasCompletedProfile: true,
            profileComplete: true,
        });
        expect(userDoc.hasCompletedProfile).toBe(true);
        expect(userDoc.profileComplete).toBe(true);
        expect(userDoc.save).toHaveBeenCalledWith({ validateBeforeSave: false });
    });

    it('marks a complete worker profile with the shared evaluator', () => {
        const completion = evaluateProfileCompletion({
            roleOverride: 'worker',
            user: {
                name: 'Lokesh',
                city: 'Madanapalle',
                isVerified: true,
            },
            workerProfile: {
                firstName: 'Lokesh',
                city: 'Madanapalle',
                isAvailable: true,
                availabilityWindowDays: 0,
                interviewVerified: true,
                roleProfiles: [
                    {
                        roleName: 'Delivery Driver',
                        skills: ['Driving'],
                        experienceInRole: 3,
                        expectedSalary: 22000,
                    },
                ],
            },
        });

        expect(completion.actions.canAccessApp).toBe(true);
        expect(completion.actions.canApply).toBe(true);
        expect(completion.meetsProfileCompleteThreshold).toBe(true);
    });

    it('treats explicit fresher experience as complete when salary and skills exist', () => {
        const completion = evaluateProfileCompletion({
            roleOverride: 'worker',
            user: {
                name: 'Teja',
                city: 'Madanapalle',
                isVerified: true,
            },
            workerProfile: {
                firstName: 'Teja',
                city: 'Madanapalle',
                isAvailable: true,
                availabilityWindowDays: 0,
                roleProfiles: [
                    {
                        roleName: 'Trainee',
                        skills: ['Communication'],
                        experienceInRole: 0,
                        expectedSalary: 18000,
                    },
                ],
            },
        });

        expect(completion.actions.canApply).toBe(true);
        expect(completion.meetsProfileCompleteThreshold).toBe(true);
    });

    it('does not require employer logo for post-job readiness when core company details exist', () => {
        const completion = evaluateProfileCompletion({
            roleOverride: 'employer',
            user: {
                name: 'Priya',
                city: 'Tirupati',
                isVerified: true,
            },
            employerProfile: {
                companyName: 'HireCircle Staffing',
                description: 'Hiring frontline teams across Andhra Pradesh.',
                location: 'Tirupati',
                industry: 'Staffing',
                contactPerson: 'Priya',
            },
        });

        expect(completion.actions.canPostJob).toBe(true);
        expect(completion.meetsProfileCompleteThreshold).toBe(true);
    });
});
