jest.mock('../models/Job', () => ({
    find: jest.fn(),
}));

const Job = require('../models/Job');
const {
    detectSalaryRealismSignal,
    detectExperienceSkillConsistencySignal,
    computeProfileQualityScore,
} = require('../services/smartInterviewQualityService');

const buildFindChain = (rows) => {
    const chain = {
        select: jest.fn(() => chain),
        sort: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        lean: jest.fn().mockResolvedValue(rows),
    };
    return chain;
};

describe('smartInterviewQualityService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('flags salary outlier when expected salary exceeds 2.5x city-role median', async () => {
        const jobs = [
            { minSalary: 22000, maxSalary: 28000 },
            { minSalary: 24000, maxSalary: 30000 },
            { minSalary: 20000, maxSalary: 26000 },
            { minSalary: 21000, maxSalary: 27000 },
            { minSalary: 23000, maxSalary: 29000 },
            { minSalary: 25000, maxSalary: 32000 },
            { minSalary: 24000, maxSalary: 31000 },
            { minSalary: 26000, maxSalary: 33000 },
        ];
        Job.find.mockReturnValueOnce(buildFindChain(jobs));

        const signal = await detectSalaryRealismSignal({
            slotState: {
                city: 'Hyderabad',
                primaryRole: 'Driver',
                expectedSalary: 100000,
            },
        });

        expect(signal.salaryOutlierFlag).toBe(true);
        expect(signal.salaryMedianForRoleCity).toBeGreaterThan(0);
        expect(signal.salaryRealismRatio).toBeGreaterThan(2.5);
        expect(signal.clarificationHint).toContain('above typical range');
    });

    it('does not flag salary when expected salary is within realistic range', async () => {
        const jobs = [
            { minSalary: 22000, maxSalary: 28000 },
            { minSalary: 24000, maxSalary: 30000 },
            { minSalary: 20000, maxSalary: 26000 },
            { minSalary: 21000, maxSalary: 27000 },
            { minSalary: 23000, maxSalary: 29000 },
            { minSalary: 25000, maxSalary: 32000 },
            { minSalary: 24000, maxSalary: 31000 },
            { minSalary: 26000, maxSalary: 33000 },
        ];
        Job.find.mockReturnValueOnce(buildFindChain(jobs));

        const signal = await detectSalaryRealismSignal({
            slotState: {
                city: 'Secunderabad',
                primaryRole: 'Warehouse Supervisor',
                expectedSalary: 30000,
            },
        });

        expect(signal.salaryOutlierFlag).toBe(false);
        expect(signal.clarificationHint).toBeNull();
    });

    it('flags advanced skill mismatch when experience is less than one year', () => {
        const signal = detectExperienceSkillConsistencySignal({
            slotState: {
                totalExperienceYears: 0,
                primarySkills: ['Team Management', 'Inventory Control'],
            },
        });

        expect(signal.experienceSkillConsistencyFlag).toBe(true);
        expect(signal.clarificationHint).toContain('worked professionally');
    });

    it('computes bounded profileQualityScore', () => {
        const quality = computeProfileQualityScore({
            slotState: {
                fullName: 'Lokesh',
                city: 'Hyderabad',
                primaryRole: 'Driver',
                primarySkills: ['Driving'],
                totalExperienceYears: 3,
                shiftPreference: 'day',
                expectedSalary: 22000,
                availabilityType: 'full-time',
            },
            slotConfidence: {
                fullName: 0.95,
                city: 0.92,
                primaryRole: 0.9,
                primarySkills: 0.93,
                totalExperienceYears: 0.94,
                shiftPreference: 0.9,
                expectedSalary: 0.91,
                availabilityType: 0.92,
            },
            requiredFields: [
                'fullName',
                'city',
                'primaryRole',
                'primarySkills',
                'totalExperienceYears',
                'shiftPreference',
                'expectedSalary',
                'availabilityType',
            ],
            clarificationTriggeredCount: 2,
            clarificationResolvedCount: 2,
            interviewStep: 4,
            maxSteps: 8,
            ambiguousFieldsCount: 1,
        });

        expect(quality.profileQualityScore).toBeGreaterThanOrEqual(0);
        expect(quality.profileQualityScore).toBeLessThanOrEqual(1);
        expect(quality.slotCompletenessRatio).toBeGreaterThan(0.9);
        expect(quality.ambiguityRate).toBeGreaterThanOrEqual(0);
        expect(quality.ambiguityRate).toBeLessThanOrEqual(1);
    });
});
