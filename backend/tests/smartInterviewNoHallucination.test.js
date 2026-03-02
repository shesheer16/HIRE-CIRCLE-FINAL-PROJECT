const {
    mergeSlots,
    normalizeExtractedPayload,
} = require('../services/smartInterviewSlotEngine');

describe('smart interview no hallucination guard', () => {
    it('keeps only transcript-backed values and rejects inferred fields', () => {
        const result = mergeSlots({
            transcript: 'My name is Ramesh. I live in Hyderabad.',
            existingSlotState: {},
            existingSlotConfidence: {},
            extracted: {
                fullName: 'Ramesh',
                city: 'Hyderabad',
                expectedSalary: 55000,
                totalExperienceYears: 8,
                primarySkills: ['Java', 'Node.js'],
                confidence: {
                    fullName: 0.95,
                    city: 0.92,
                    expectedSalary: 0.91,
                    totalExperienceYears: 0.9,
                    primarySkills: 0.9,
                },
            },
        });

        expect(result.slotState.fullName).toBe('Ramesh');
        expect(result.slotState.city).toBe('Hyderabad');
        expect(result.slotState.expectedSalary).toBeUndefined();
        expect(result.slotState.totalExperienceYears).toBeUndefined();
        expect(result.slotState.primarySkills).toBeUndefined();

        expect(result.ambiguousFields).toEqual(expect.arrayContaining([
            'expectedSalary',
            'totalExperienceYears',
            'primarySkills',
        ]));
        expect(result.rejectedFields).toEqual(expect.arrayContaining([
            'expectedSalary',
            'totalExperienceYears',
            'primarySkills',
        ]));
    });

    it('rejects unknown output structures from model payload', () => {
        const result = mergeSlots({
            transcript: 'I am a delivery rider in Chennai.',
            existingSlotState: {},
            existingSlotConfidence: {},
            extracted: {
                primaryRole: 'delivery rider',
                maliciousObject: {
                    isAdmin: true,
                    role: 'superuser',
                },
                confidence: {
                    primaryRole: 0.88,
                },
            },
        });

        expect(result.slotState.primaryRole).toBe('delivery rider');
        expect(result.slotState.isAdmin).toBeUndefined();
        expect(result.slotState.role).toBeUndefined();
        expect(result.rejectedFields).toContain('maliciousObject');
    });

    it('normalizes extracted payload and throws on invalid non-object model output', () => {
        expect(() => normalizeExtractedPayload('not-an-object')).toThrow('Model response is not a valid JSON object');
    });
});
