jest.mock('../models/InterviewProcessingJob', () => ({
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../services/smartInterviewQuestionGenerator', () => ({
    generateFollowUpQuestion: jest.fn().mockResolvedValue('What is your city?'),
}));

jest.mock('../services/smartInterviewSlotEngine', () => ({
    extractSlotsFromTranscript: jest.fn().mockResolvedValue({
        slotState: { primaryRole: 'driver' },
        slotConfidence: { primaryRole: 0.9 },
        missingSlot: 'city',
        ambiguousFields: ['city'],
        interviewComplete: false,
    }),
    mergeSlots: jest.fn(),
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
        profileQualityScore: 0.75,
        requiredConfidenceAverage: 0.75,
        slotCompletenessRatio: 0.45,
        ambiguityRate: 0.55,
        clarificationResolutionRate: 1,
        speedScore: 0.8,
    }),
}));

const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const {
    createHybridInterviewSession,
    processHybridTurn,
} = require('../services/interviewProcessingService');

const createChainableFindResult = (value) => ({
    sort: jest.fn().mockResolvedValue(value),
});

describe('smart interview concurrency protection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('reuses single active session per user', async () => {
        const activeJob = {
            _id: 'active-session-id',
            status: 'processing',
            startedAt: new Date(),
            save: jest.fn().mockResolvedValue(undefined),
        };

        InterviewProcessingJob.findOne.mockReturnValueOnce(createChainableFindResult(activeJob));

        const result = await createHybridInterviewSession({
            user: { _id: 'user-1' },
            maxSteps: 8,
        });

        expect(result).toBe(activeJob);
        expect(result._reusedSession).toBe(true);
        expect(InterviewProcessingJob.create).not.toHaveBeenCalled();
    });

    it('expires stale active session then creates a fresh one', async () => {
        const staleJob = {
            _id: 'stale-session-id',
            status: 'processing',
            startedAt: new Date(Date.now() - (30 * 60 * 1000)),
            save: jest.fn().mockResolvedValue(undefined),
        };
        const newJob = {
            _id: 'new-session-id',
            status: 'processing',
            startedAt: new Date(),
        };

        InterviewProcessingJob.findOne.mockReturnValueOnce(createChainableFindResult(staleJob));
        InterviewProcessingJob.create.mockResolvedValueOnce(newJob);

        const result = await createHybridInterviewSession({
            user: { _id: 'user-2' },
            maxSteps: 8,
        });

        expect(staleJob.status).toBe('failed');
        expect(staleJob.save).toHaveBeenCalled();
        expect(InterviewProcessingJob.create).toHaveBeenCalledTimes(1);
        expect(result).toBe(newJob);
    });

    it('handles duplicate finalization call idempotently', async () => {
        const completedJob = {
            _id: 'completed-job-id',
            userId: 'user-3',
            status: 'completed',
            interviewComplete: true,
            slotState: { primaryRole: 'driver' },
            slotConfidence: { primaryRole: 1 },
            ambiguousFields: [],
            interviewStep: 4,
            maxSteps: 8,
            rawMetrics: {},
            save: jest.fn().mockResolvedValue(undefined),
        };

        const first = await processHybridTurn({
            job: completedJob,
            transcriptChunk: 'I am done',
        });
        const second = await processHybridTurn({
            job: completedJob,
            transcriptChunk: 'I am done',
        });

        expect(first.interviewComplete).toBe(true);
        expect(second.interviewComplete).toBe(true);
        expect(second.interviewStep).toBe(4);
        expect(completedJob.save).toHaveBeenCalledTimes(2);
    });
});
