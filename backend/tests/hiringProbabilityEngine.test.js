jest.mock('../models/Job', () => ({
    findById: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/MatchOutcomeModel', () => ({
    aggregate: jest.fn(),
}));

const Job = require('../models/Job');
const MatchOutcomeModel = require('../models/MatchOutcomeModel');
const {
    predictHiringProbability,
    __clearSimilarOutcomeCache,
} = require('../services/hiringProbabilityEngine');

const makeFindChain = (rows = []) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
});

describe('hiringProbabilityEngine', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __clearSimilarOutcomeCache();
    });

    it('returns bounded explainable prediction with provided historical outcomes', async () => {
        const result = await predictHiringProbability({
            matchScore: 0.82,
            employerBehaviorScore: 0.7,
            workerReliabilityScore: 0.9,
            jobUrgency: 'high',
            pastSimilarJobOutcomes: {
                hireRate: 0.64,
                sampleSize: 120,
            },
        });

        expect(result.predictedHireProbability).toBeGreaterThanOrEqual(0);
        expect(result.predictedHireProbability).toBeLessThanOrEqual(1);
        expect(result.explainability.inputSignals).toBeDefined();
        expect(result.explainability.weightedContributions).toBeDefined();
    });

    it('uses historical job outcomes when jobId is provided', async () => {
        Job.findById.mockReturnValueOnce({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'job-1',
                    location: 'Hyderabad',
                    title: 'Driver',
                }),
            }),
        });
        Job.find.mockReturnValueOnce(makeFindChain([{ _id: 'job-1' }]));
        MatchOutcomeModel.aggregate.mockResolvedValueOnce([
            { hiredCount: 7, totalCount: 10 },
        ]);

        const result = await predictHiringProbability({
            matchScore: 0.7,
            employerBehaviorScore: 0.6,
            workerReliabilityScore: 0.65,
            jobUrgency: 0.8,
            jobId: 'job-1',
        });

        expect(result.predictedHireProbability).toBeGreaterThanOrEqual(0);
        expect(result.predictedHireProbability).toBeLessThanOrEqual(1);
        expect(result.explainability.inputSignals.pastSimilarJobOutcomes.source).toBe('historical_similar_jobs');
    });

    it('caches similar outcome signals per jobId to avoid repeated heavy lookups', async () => {
        Job.findById.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'job-2',
                    location: 'Hyderabad',
                    title: 'Driver',
                }),
            }),
        });
        Job.find.mockReturnValue(makeFindChain([{ _id: 'job-2' }]));
        MatchOutcomeModel.aggregate.mockResolvedValue([{ hiredCount: 4, totalCount: 10 }]);

        await predictHiringProbability({
            matchScore: 0.7,
            employerBehaviorScore: 0.6,
            workerReliabilityScore: 0.8,
            jobUrgency: 0.6,
            jobId: 'job-2',
        });

        await predictHiringProbability({
            matchScore: 0.8,
            employerBehaviorScore: 0.7,
            workerReliabilityScore: 0.9,
            jobUrgency: 0.7,
            jobId: 'job-2',
        });

        expect(MatchOutcomeModel.aggregate).toHaveBeenCalledTimes(1);
    });
});
