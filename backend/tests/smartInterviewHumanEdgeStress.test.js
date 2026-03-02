process.env.SMART_INTERVIEW_SILENCE_TIMEOUT_MS = '1000';
process.env.SMART_INTERVIEW_MAX_DURATION_MS = '200';

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
        slotCompletenessRatio: 0.4,
        ambiguityRate: 0.5,
        clarificationResolutionRate: 1,
        speedScore: 0.8,
    }),
}));

const { extractSlotsFromTranscript } = require('../services/smartInterviewSlotEngine');
const { processHybridTurn } = require('../services/interviewProcessingService');

const createJob = (overrides = {}) => ({
    _id: 'job-human-edge',
    userId: 'user-1',
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

describe('smart interview human edge stress', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('blocks duplicate submit within lock window and preserves single state', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: { primaryRole: 'driver' },
            slotConfidence: { primaryRole: 0.9 },
            missingSlot: 'city',
            ambiguousFields: ['city'],
            interviewComplete: false,
        });

        const job = createJob();

        const first = await processHybridTurn({
            job,
            transcriptChunk: 'I am a driver',
        });
        const second = await processHybridTurn({
            job,
            transcriptChunk: 'I am a driver',
        });

        expect(first.interviewStep).toBe(1);
        expect(second.interviewStep).toBe(1);
        expect(extractSlotsFromTranscript).toHaveBeenCalledTimes(1);
    });

    it('rejects prolonged silence without corrupting session state', async () => {
        const job = createJob({
            rawMetrics: {
                silenceSinceTs: Date.now() - 1500,
            },
        });

        await expect(processHybridTurn({
            job,
            transcriptChunk: '...',
        })).rejects.toMatchObject({
            statusCode: 408,
        });

        expect(job.status).toBe('processing');
        expect(job.save).toHaveBeenCalled();
    });

    it('survives rapid next-turn spam without crashing or over-incrementing beyond max steps', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: { primaryRole: 'driver' },
            slotConfidence: { primaryRole: 0.85 },
            missingSlot: 'city',
            ambiguousFields: ['city'],
            interviewComplete: false,
        });

        const job = createJob();

        for (let i = 0; i < 20; i += 1) {
            // unique text avoids duplicate turn suppression and stresses turn progression cap
            // eslint-disable-next-line no-await-in-loop
            await processHybridTurn({
                job,
                transcriptChunk: `driver response ${i}`,
            });
        }

        expect(job.interviewStep).toBeLessThanOrEqual(job.maxSteps);
        expect(job.status).toBe('completed');
    });

    it('expires stale interview sessions safely instead of crashing', async () => {
        extractSlotsFromTranscript.mockResolvedValue({
            slotState: {},
            slotConfidence: {},
            missingSlot: 'fullName',
            ambiguousFields: ['fullName'],
            interviewComplete: false,
        });

        const job = createJob({
            startedAt: new Date(Date.now() - 1000),
        });

        await expect(processHybridTurn({
            job,
            transcriptChunk: 'hello',
        })).rejects.toMatchObject({
            statusCode: 410,
        });

        expect(job.status).toBe('failed');
        expect(job.save).toHaveBeenCalled();
    });
});
