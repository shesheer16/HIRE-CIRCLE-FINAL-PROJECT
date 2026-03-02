jest.mock('../services/smartInterviewQuestionGenerator', () => ({
    generateFollowUpQuestion: jest.fn().mockResolvedValue('Please share your city.'),
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
        profileQualityScore: 0.6,
        requiredConfidenceAverage: 0.6,
        slotCompletenessRatio: 0.3,
        ambiguityRate: 0.6,
        clarificationResolutionRate: 1,
        speedScore: 0.7,
    }),
}));

const { extractSlotsFromTranscript } = require('../services/smartInterviewSlotEngine');
const { processHybridTurn } = require('../services/interviewProcessingService');

const createJob = (overrides = {}) => ({
    _id: 'job-ai-resilience',
    userId: 'user-ai',
    role: 'worker',
    status: 'processing',
    startedAt: new Date(),
    slotState: {},
    slotConfidence: {},
    ambiguousFields: [],
    interviewStep: 0,
    maxSteps: 8,
    clarificationTriggeredCount: 0,
    clarificationResolvedCount: 0,
    clarificationSkippedCount: 0,
    rawMetrics: {},
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

describe('smart interview AI resilience', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('falls back safely when AI provider times out repeatedly', async () => {
        extractSlotsFromTranscript
            .mockRejectedValueOnce(new Error('network timeout from ai_provider'))
            .mockRejectedValueOnce(new Error('network timeout from ai_provider'));

        const job = createJob();
        const payload = await processHybridTurn({
            job,
            transcriptChunk: 'I am a delivery rider in Pune',
        });

        expect(payload).toBeTruthy();
        expect(payload.extractionFallbackReason).toContain('timeout');
        expect(job.status).toBe('processing');
    });

    it('falls back safely on AI 429/rate-limit response without throwing 500-level errors', async () => {
        extractSlotsFromTranscript
            .mockRejectedValueOnce(new Error('AI rate limit exceeded (429)'))
            .mockRejectedValueOnce(new Error('AI rate limit exceeded (429)'));

        const job = createJob();
        const payload = await processHybridTurn({
            job,
            transcriptChunk: 'I work in Chennai',
        });

        expect(payload.extractionFallbackReason).toMatch(/rate limit|429/i);
        expect(job.rawMetrics.extractionFallbackReason).toMatch(/rate limit|429/i);
    });

    it('falls back safely on malformed AI model output errors', async () => {
        extractSlotsFromTranscript
            .mockRejectedValueOnce(new Error('Model response is not valid JSON object'))
            .mockRejectedValueOnce(new Error('Model response is not valid JSON object'));

        const job = createJob();
        const payload = await processHybridTurn({
            job,
            transcriptChunk: 'My name is Anand and I can do warehouse ops',
        });

        expect(payload.extractionFallbackReason).toMatch(/json/i);
        expect(payload.interviewStep).toBe(1);
    });

    it('returns controlled validation error for empty transcript', async () => {
        const job = createJob();

        await expect(processHybridTurn({
            job,
            transcriptChunk: '   ',
        })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('transcriptChunk is required'),
        });
    });
});
