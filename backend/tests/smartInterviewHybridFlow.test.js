jest.mock('../services/smartInterviewQuestionGenerator', () => ({
    generateFollowUpQuestion: jest.fn(),
}));

jest.mock('../services/smartInterviewSlotEngine', () => ({
    extractSlotsFromTranscript: jest.fn(),
}));

jest.mock('../services/smartInterviewQualityService', () => ({
    detectSalaryRealismSignal: jest.fn().mockResolvedValue({
        salaryOutlierFlag: false,
        salaryMedianForRoleCity: null,
        salaryRealismRatio: null,
        clarificationHint: null,
    }),
    detectExperienceSkillConsistencySignal: jest.fn().mockReturnValue({
        experienceSkillConsistencyFlag: false,
        clarificationHint: null,
    }),
    computeProfileQualityScore: jest.fn().mockReturnValue({
        profileQualityScore: 0.7,
        requiredConfidenceAverage: 0.7,
        slotCompletenessRatio: 0.5,
        ambiguityRate: 0.4,
        clarificationResolutionRate: 1,
        speedScore: 0.8,
    }),
}));

const { generateFollowUpQuestion } = require('../services/smartInterviewQuestionGenerator');
const { extractSlotsFromTranscript } = require('../services/smartInterviewSlotEngine');
const {
    applyClarificationOverride,
    processHybridTurn,
} = require('../services/interviewProcessingService');

describe('smart interview hybrid flow', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('sets override confidence to 1.0 and keeps interviewStep unchanged', async () => {
        generateFollowUpQuestion.mockResolvedValue('What is your expected salary?');

        const job = {
            slotState: {
                fullName: 'Lokesh Kumar',
                totalExperienceYears: null,
            },
            slotConfidence: {
                fullName: 0.95,
                totalExperienceYears: 0.4,
            },
            ambiguousFields: ['totalExperienceYears'],
            interviewStep: 2,
            maxSteps: 8,
            clarificationResolvedCount: 0,
            clarificationSkippedCount: 0,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const payload = await applyClarificationOverride({
            job,
            overrideField: 'totalExperienceYears',
            value: 3,
            skip: false,
        });

        expect(payload.slotState.totalExperienceYears).toBe(3);
        expect(payload.slotConfidence.totalExperienceYears).toBe(1);
        expect(payload.ambiguousFields).not.toContain('totalExperienceYears');
        expect(payload.interviewStep).toBe(2);
        expect(payload.clarificationResolvedCount).toBe(1);
        expect(job.save).toHaveBeenCalled();
    });

    it('resumes hybrid flow and increments step only on transcript turns', async () => {
        extractSlotsFromTranscript
            .mockResolvedValueOnce({
                slotState: {
                    fullName: 'Lokesh Kumar',
                    city: 'Hyderabad',
                },
                slotConfidence: {
                    fullName: 0.95,
                    city: 0.92,
                },
                missingSlot: 'primaryRole',
                ambiguousFields: [],
                interviewComplete: false,
            })
            .mockResolvedValueOnce({
                slotState: {
                    fullName: 'Lokesh Kumar',
                    city: 'Hyderabad',
                    primaryRole: 'Driver',
                    primarySkills: ['Driving'],
                    totalExperienceYears: 3,
                    shiftPreference: 'day',
                    expectedSalary: 22000,
                    availabilityType: 'full-time',
                },
                slotConfidence: {
                    fullName: 1,
                    city: 1,
                    primaryRole: 1,
                    primarySkills: 1,
                    totalExperienceYears: 1,
                    shiftPreference: 1,
                    expectedSalary: 1,
                    availabilityType: 1,
                },
                missingSlot: null,
                ambiguousFields: [],
                interviewComplete: true,
            });

        generateFollowUpQuestion.mockResolvedValue('What is your primary role?');

        const job = {
            slotState: {},
            slotConfidence: {},
            ambiguousFields: [],
            interviewStep: 0,
            maxSteps: 8,
            status: 'processing',
            clarificationTriggeredCount: 0,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const firstTurn = await processHybridTurn({
            job,
            transcriptChunk: 'My name is Lokesh. I live in Hyderabad.',
        });
        expect(firstTurn.interviewStep).toBe(1);
        expect(firstTurn.interviewComplete).toBe(false);
        expect(firstTurn.adaptiveQuestion).toContain('primary role');
        expect(firstTurn.ambiguousFields).toContain('primaryRole');

        const secondTurn = await processHybridTurn({
            job,
            transcriptChunk: 'I am a driver with 3 years experience.',
        });
        expect(secondTurn.interviewStep).toBe(2);
        expect(secondTurn.interviewComplete).toBe(true);
        expect(secondTurn.adaptiveQuestion).toBeNull();
        expect(job.status).toBe('completed');
    });

    it('handles multiple ambiguities sequentially and keeps one unresolved after single override', async () => {
        const job = {
            slotState: {
                fullName: 'Lokesh Kumar',
                totalExperienceYears: null,
                expectedSalary: null,
            },
            slotConfidence: {
                fullName: 0.95,
                totalExperienceYears: 0.3,
                expectedSalary: 0.2,
            },
            ambiguousFields: ['totalExperienceYears', 'expectedSalary'],
            interviewStep: 1,
            maxSteps: 8,
            status: 'processing',
            clarificationResolvedCount: 0,
            clarificationSkippedCount: 0,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const payload = await applyClarificationOverride({
            job,
            overrideField: 'totalExperienceYears',
            value: 2,
            skip: false,
        });

        expect(payload.slotState.totalExperienceYears).toBe(2);
        expect(payload.slotConfidence.totalExperienceYears).toBe(1);
        expect(payload.ambiguousFields).toContain('expectedSalary');
        expect(payload.ambiguousFields).not.toContain('totalExperienceYears');
        expect(payload.interviewComplete).toBe(false);
    });

    it('forces completion when maxSteps is reached even on weak answers', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: {
                fullName: 'Lokesh',
            },
            slotConfidence: {
                fullName: 0.4,
            },
            missingSlot: 'city',
            ambiguousFields: ['city', 'primaryRole'],
            interviewComplete: false,
        });

        const job = {
            slotState: { fullName: 'Lokesh' },
            slotConfidence: { fullName: 0.4 },
            ambiguousFields: ['city'],
            interviewStep: 7,
            maxSteps: 8,
            status: 'processing',
            clarificationTriggeredCount: 0,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const result = await processHybridTurn({
            job,
            transcriptChunk: 'some time, not sure',
        });

        expect(result.interviewStep).toBe(8);
        expect(result.interviewComplete).toBe(true);
        expect(result.adaptiveQuestion).toBeNull();
        expect(job.status).toBe('completed');
    });

    it('keeps interview incomplete on weak answers before maxSteps', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: {
                fullName: 'Lokesh',
            },
            slotConfidence: {
                fullName: 0.5,
            },
            missingSlot: 'city',
            ambiguousFields: ['city'],
            interviewComplete: false,
        });

        const job = {
            slotState: { fullName: 'Lokesh' },
            slotConfidence: { fullName: 0.5 },
            ambiguousFields: ['city'],
            interviewStep: 1,
            maxSteps: 8,
            status: 'processing',
            clarificationTriggeredCount: 0,
            save: jest.fn().mockResolvedValue(undefined),
        };

        const result = await processHybridTurn({
            job,
            transcriptChunk: 'not sure',
        });

        expect(result.interviewStep).toBe(2);
        expect(result.interviewComplete).toBe(false);
        expect(result.ambiguousFields.length).toBeGreaterThan(0);
    });
});
