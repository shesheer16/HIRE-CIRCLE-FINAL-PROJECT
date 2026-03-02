process.env.SMART_INTERVIEW_SILENCE_TIMEOUT_MS = '2000';

jest.mock('../services/smartInterviewQuestionGenerator', () => ({
    generateFollowUpQuestion: jest.fn().mockResolvedValue('Please share one more detail.'),
}));

jest.mock('../services/smartInterviewSlotEngine', () => {
    const actual = jest.requireActual('../services/smartInterviewSlotEngine');
    return {
        ...actual,
        extractSlotsFromTranscript: jest.fn(),
    };
});

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

const { extractSlotsFromTranscript, mergeSlots } = require('../services/smartInterviewSlotEngine');
const { processHybridTurn } = require('../services/interviewProcessingService');

const createJob = (overrides = {}) => ({
    _id: 'job-1',
    userId: 'user-1',
    role: 'worker',
    status: 'processing',
    slotState: {},
    slotConfidence: {},
    ambiguousFields: [],
    interviewStep: 0,
    maxSteps: 8,
    clarificationTriggeredCount: 0,
    rawMetrics: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

describe('smart interview human edge guards', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('rejects empty transcript chunks', async () => {
        const job = createJob();
        await expect(processHybridTurn({
            job,
            transcriptChunk: '   ',
        })).rejects.toThrow('transcriptChunk is required');
    });

    it('enforces silence timeout guard', async () => {
        const job = createJob({
            rawMetrics: {
                silenceSinceTs: Date.now() - 3000,
            },
        });

        await expect(processHybridTurn({
            job,
            transcriptChunk: '...',
        })).rejects.toMatchObject({
            message: expect.stringContaining('Silence timeout exceeded'),
            statusCode: 408,
        });
        expect(job.save).toHaveBeenCalled();
    });

    it('handles partial user answers without forcing completion', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: { primaryRole: 'driver' },
            slotConfidence: { primaryRole: 0.8 },
            missingSlot: 'city',
            ambiguousFields: ['city'],
            interviewComplete: false,
        });

        const job = createJob();
        const payload = await processHybridTurn({
            job,
            transcriptChunk: 'driver',
        });

        expect(payload.interviewStep).toBe(1);
        expect(payload.interviewComplete).toBe(false);
        expect(typeof payload.missingSlot).toBe('string');
    });

    it('retries once on transient extraction/network interruption', async () => {
        extractSlotsFromTranscript
            .mockRejectedValueOnce(new Error('network timeout while extracting slots'))
            .mockResolvedValueOnce({
                slotState: { city: 'Hyderabad' },
                slotConfidence: { city: 0.92 },
                missingSlot: 'primaryRole',
                ambiguousFields: ['primaryRole'],
                interviewComplete: false,
            });

        const job = createJob();
        const payload = await processHybridTurn({
            job,
            transcriptChunk: 'I am in Hyderabad',
        });

        expect(extractSlotsFromTranscript).toHaveBeenCalledTimes(2);
        expect(payload.slotState.city).toBe('Hyderabad');
    });

    it('prevents hallucinated fields and keeps only transcript-backed values', () => {
        const result = mergeSlots({
            transcript: 'My name is Ravi. I live in Hyderabad.',
            existingSlotState: {},
            existingSlotConfidence: {},
            extracted: {
                fullName: 'Ravi',
                city: 'Mumbai',
                expectedSalary: 25000,
                confidence: {
                    fullName: 0.95,
                    city: 0.91,
                    expectedSalary: 0.9,
                },
            },
        });

        expect(result.slotState.fullName).toBe('Ravi');
        expect(result.slotState.city).toBeUndefined();
        expect(result.slotState.expectedSalary).toBeUndefined();
        expect(result.ambiguousFields).toEqual(expect.arrayContaining(['city', 'expectedSalary']));
    });
});
