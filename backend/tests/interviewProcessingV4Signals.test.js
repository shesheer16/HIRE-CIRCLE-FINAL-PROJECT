jest.mock('../services/smartInterviewQuestionGenerator', () => ({
    generateFollowUpQuestion: jest.fn().mockResolvedValue('What is your expected salary?'),
}));

jest.mock('../services/smartInterviewSlotEngine', () => ({
    extractSlotsFromTranscript: jest.fn(),
}));

jest.mock('../models/AnalyticsEvent', () => ({
    create: jest.fn().mockResolvedValue({ _id: 'evt-1' }),
}));

jest.mock('../services/smartInterviewQualityService', () => ({
    detectSalaryRealismSignal: jest.fn().mockResolvedValue({
        salaryOutlierFlag: true,
        salaryMedianForRoleCity: 30000,
        salaryRealismRatio: 3.2,
        clarificationHint: 'That seems above typical range for this role. Is that correct?',
    }),
    detectExperienceSkillConsistencySignal: jest.fn().mockReturnValue({
        experienceSkillConsistencyFlag: false,
        clarificationHint: null,
    }),
    computeProfileQualityScore: jest.fn().mockReturnValue({
        profileQualityScore: 0.84,
        requiredConfidenceAverage: 0.92,
        slotCompletenessRatio: 1,
        ambiguityRate: 0.125,
        clarificationResolutionRate: 1,
        speedScore: 0.85,
    }),
}));

const { extractSlotsFromTranscript } = require('../services/smartInterviewSlotEngine');
const {
    processHybridTurn,
    applyClarificationOverride,
} = require('../services/interviewProcessingService');

describe('interviewProcessingService V4 quality signals', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('keeps interview open for salary clarification and completes after override confirmation', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: {
                fullName: 'Lokesh Kumar',
                city: 'Hyderabad',
                primaryRole: 'Driver',
                primarySkills: ['Driving'],
                totalExperienceYears: 3,
                shiftPreference: 'day',
                expectedSalary: 96000,
                availabilityType: 'full-time',
            },
            slotConfidence: {
                fullName: 0.95,
                city: 0.95,
                primaryRole: 0.95,
                primarySkills: 0.95,
                totalExperienceYears: 0.95,
                shiftPreference: 0.95,
                expectedSalary: 0.95,
                availabilityType: 0.95,
            },
            missingSlot: null,
            ambiguousFields: [],
            interviewComplete: true,
        });

        const job = {
            _id: 'processing-1',
            userId: 'user-1',
            role: 'worker',
            slotState: {},
            slotConfidence: {},
            ambiguousFields: [],
            interviewStep: 0,
            maxSteps: 8,
            status: 'processing',
            clarificationTriggeredCount: 0,
            clarificationResolvedCount: 0,
            clarificationSkippedCount: 0,
            rawMetrics: {},
            save: jest.fn().mockResolvedValue(undefined),
        };

        const firstTurn = await processHybridTurn({
            job,
            transcriptChunk: 'I am a driver and expecting 96000 salary',
        });

        expect(firstTurn.interviewComplete).toBe(false);
        expect(firstTurn.ambiguousFields).toContain('expectedSalary');
        expect(firstTurn.adaptiveQuestion).toContain('above typical range');
        expect(firstTurn.salaryOutlierFlag).toBe(true);

        const resolved = await applyClarificationOverride({
            job,
            overrideField: 'expectedSalary',
            value: 96000,
            skip: false,
        });

        expect(resolved.slotState.expectedSalary).toBe(96000);
        expect(resolved.slotConfidence.expectedSalary).toBe(1);
        expect(resolved.ambiguousFields).not.toContain('expectedSalary');
        expect(resolved.interviewComplete).toBe(true);
        expect(job.rawMetrics.salaryOutlierConfirmed).toBe(true);
        expect(job.status).toBe('completed');
    });

    it('does not re-trigger salary outlier clarification once explicitly confirmed', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: {
                fullName: 'Lokesh Kumar',
                city: 'Hyderabad',
                primaryRole: 'Driver',
                primarySkills: ['Driving'],
                totalExperienceYears: 3,
                shiftPreference: 'day',
                expectedSalary: 96000,
                availabilityType: 'full-time',
            },
            slotConfidence: {
                fullName: 0.95,
                city: 0.95,
                primaryRole: 0.95,
                primarySkills: 0.95,
                totalExperienceYears: 0.95,
                shiftPreference: 0.95,
                expectedSalary: 0.95,
                availabilityType: 0.95,
            },
            missingSlot: null,
            ambiguousFields: [],
            interviewComplete: true,
        });

        const job = {
            _id: 'processing-2',
            userId: 'user-2',
            role: 'worker',
            slotState: {},
            slotConfidence: {},
            ambiguousFields: [],
            interviewStep: 0,
            maxSteps: 8,
            status: 'processing',
            clarificationTriggeredCount: 0,
            clarificationResolvedCount: 0,
            clarificationSkippedCount: 0,
            rawMetrics: {
                salaryOutlierConfirmed: true,
            },
            save: jest.fn().mockResolvedValue(undefined),
        };

        const turn = await processHybridTurn({
            job,
            transcriptChunk: 'I am still expecting 96000 salary.',
        });

        expect(turn.ambiguousFields).not.toContain('expectedSalary');
        expect(turn.interviewComplete).toBe(true);
    });
});
