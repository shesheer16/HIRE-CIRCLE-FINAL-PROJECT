const mongoose = require('mongoose');
const { getMatchesForCandidate } = require('../controllers/matchingController');
const { buildNearQuery } = require('../services/geoDiscoveryService');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');

jest.mock('../models/Job');
jest.mock('../models/WorkerProfile');
jest.mock('../models/userModel');
jest.mock('../models/UserBehaviorProfile', () => ({
    findOne: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/ReputationProfile', () => ({
    find: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/WorkerEngagementScore', () => ({
    find: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/MatchRun', () => ({
    create: jest.fn().mockResolvedValue({ _id: '123' }),
    find: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/MatchLog', () => ({
    insertMany: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/Application', () => ({
    find: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/MatchOutcomeModel', () => ({}));
jest.mock('../models/MatchPerformanceMetric', () => ({
    find: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
}));
jest.mock('../models/MatchModel', () => {
    const mockFindOne = jest.fn().mockReturnThis();
    const mockSort = jest.fn().mockReturnThis();
    const mockSelect = jest.fn().mockReturnThis();
    const mockLean = jest.fn().mockResolvedValue(null);
    return {
        findOne: mockFindOne,
        sort: mockSort,
        select: mockSelect,
        lean: mockLean,
    };
});

jest.mock('../services/geoMatchService', () => ({
    isCrossBorderAllowed: jest.fn(() => false),
    filterJobsByGeo: jest.fn(({ jobs }) => ({ jobs })),
}));
jest.mock('../services/workerEngagementService', () => ({
    computeWorkerEngagementScore: jest.fn().mockResolvedValue({ score: 50 }),
}));
jest.mock('../services/growthNotificationService', () => ({
    createAndSendBehaviorNotification: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/monetizationIntelligenceService', () => ({
    recordFeatureUsage: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/hiringProbabilityEngine', () => ({
    predictHiringProbability: jest.fn().mockResolvedValue({ predictedHireProbability: 0.8, explainability: {} }),
    getSimilarJobOutcomeSignals: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/decisionExplainabilityService', () => ({
    explainMatchDecision: jest.fn().mockReturnValue({ summary: 'Test summary' }),
    explainRankingDecision: jest.fn().mockReturnValue('Test ranking why'),
}));
jest.mock('../services/matchQualityIntelligenceService', () => ({
    buildMatchIntelligenceContext: jest.fn(() => Promise.resolve({
        dynamicThresholds: { POSSIBLE: 0.1 },
        getScoringContextForJob: jest.fn(() => ({})),
    })),
}));

jest.mock('../services/matchIntentFilterService', () => ({
    filterJobsByApplyIntent: jest.fn(({ jobs }) => Promise.resolve({ jobs, blocked: false })),
}));
jest.mock('../match/matchEngineV2', () => ({
    rankJobsForWorker: jest.fn(({ jobs }) => ({
        matches: jobs.map((job) => ({
            job,
            matchScore: 90,
            finalScore: 0.9,
            tier: 'STRONG',
            roleUsed: 'Test Role',
        })),
    })),
    mapTier: jest.fn(() => 'STRONG'),
    toLegacyTierLabel: jest.fn(() => 'STRONG'),
    sortScoredMatches: jest.fn(() => 0),
}));

describe('Map-Based Discovery: Distance Display Calculation', () => {
    let mockReq, mockRes, mockWorker, mockUser;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {
            user: { _id: new mongoose.Types.ObjectId() },
            query: { radiusKm: 50 },
        };

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };

        mockUser = {
            _id: mockReq.user._id,
            hasCompletedProfile: true,
            pushTokens: [],
            isVerified: true,
        };

        // Worker located in Mumbai roughly (lng, lat)
        mockWorker = {
            _id: new mongoose.Types.ObjectId(),
            user: mockUser._id,
            isAvailable: true,
            roleProfiles: [{ role: 'Test Role' }],
            geo: {
                type: 'Point',
                coordinates: [72.8777, 19.0760],
            },
        };

        User.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue(mockUser),
        });

        WorkerProfile.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(mockWorker),
        });
    });

    it('should calculate distanceKm correctly for nearby jobs in matchingController', async () => {
        // Job located in Pune roughly (~120km away)
        Job.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Test Job in Pune',
                    geo: { type: 'Point', coordinates: [73.8567, 18.5204] } // Pune coordinates
                },
            ]),
        });

        await getMatchesForCandidate(mockReq, mockRes);
        expect(mockRes.json).toHaveBeenCalledTimes(1);

        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData.length).toBe(1);

        // Assert distance computation is injected onto the job card safely
        expect(responseData[0]).toHaveProperty('distanceKm');
        expect(responseData[0].distanceKm).toBeGreaterThan(115);
        expect(responseData[0].distanceKm).toBeLessThan(125);
        // It should also append it to labels visually
        const labels = responseData[0].labels;
        expect(labels.some(l => l.includes('km away'))).toBe(true);
    });

    it('should safely fall back to null distance if coordinates are omitted (0,0)', async () => {
        Job.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                {
                    _id: new mongoose.Types.ObjectId(),
                    title: 'Job Without Coordinates',
                    geo: { type: 'Point', coordinates: [0, 0] }
                },
            ]),
        });

        await getMatchesForCandidate(mockReq, mockRes);
        expect(mockRes.json).toHaveBeenCalledTimes(1);

        const responseData = mockRes.json.mock.calls[0][0];
        expect(responseData[0].distanceKm).toBeNull();
        expect(responseData[0].labels.some(l => l.includes('km away'))).toBe(false);
    });
});
