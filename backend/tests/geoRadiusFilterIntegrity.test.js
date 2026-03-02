const mongoose = require('mongoose');
const { getMatchesForCandidate } = require('../controllers/matchingController');
const { buildNearQuery } = require('../services/geoDiscoveryService');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');

// Mock out the massive dependencies so we only test the geo aspect
jest.mock('../models/Job');
jest.mock('../models/WorkerProfile');
jest.mock('../models/userModel');
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
    const mockLean = jest.fn().mockResolvedValue(null);
    return {
        findOne: mockFindOne,
        lean: mockLean,
    };
});
jest.mock('../models/Job', () => {
    const mockFind = jest.fn().mockReturnThis();
    const mockSort = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockReturnThis();
    const mockLean = jest.fn().mockResolvedValue([
        { _id: '123', title: 'Test Job 1' },
    ]);
    return {
        find: mockFind,
        sort: mockSort,
        limit: mockLimit,
        lean: mockLean,
    };
});
jest.mock('../services/matchQualityIntelligenceService', () => ({
    buildMatchIntelligenceContext: jest.fn(() => Promise.resolve({
        dynamicThresholds: { POSSIBLE: 0.1 },
        getScoringContextForJob: jest.fn(() => ({})),
    })),
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
    sortScoredMatches: jest.fn(() => 0),
}));

describe('Map-Based Discovery: Geo Radius Filter Integrity', () => {
    let mockReq;
    let mockRes;
    let mockWorker;
    let mockUser;

    beforeEach(() => {
        jest.clearAllMocks();

        mockReq = {
            user: { _id: new mongoose.Types.ObjectId() },
            query: {},
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

        mockWorker = {
            _id: new mongoose.Types.ObjectId(),
            user: mockUser._id,
            isAvailable: true,
            roleProfiles: [{ role: 'Test Role' }],
            geo: {
                type: 'Point',
                coordinates: [70.0, 20.0], // lng, lat
            },
        };

        User.findById.mockReturnValue({
            select: jest.fn().mockResolvedValue(mockUser),
        });

        WorkerProfile.findOne.mockReturnValue({
            lean: jest.fn().mockResolvedValue(mockWorker),
        });

        Job.find.mockReturnValue({
            sort: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            lean: jest.fn().mockResolvedValue([
                { _id: new mongoose.Types.ObjectId(), title: 'Test Job 1' },
            ]),
        });
    });

    it('should NOT apply geo filter if radiusKm is omitted from query', async () => {
        mockReq.query = {}; // No radius

        await getMatchesForCandidate(mockReq, mockRes);

        expect(Job.find).toHaveBeenCalledWith({
            isOpen: true,
            status: 'active',
            employerId: { $ne: mockUser._id },
        });

        // Natively sorted by desc createdAt when geo is omitted
        expect(Job.find().sort).toHaveBeenCalledWith({ createdAt: -1 });
    });

    it('should NOT apply geo filter if radiusKm is provided but worker has no valid coordinates', async () => {
        mockReq.query = { radiusKm: 25 };
        mockWorker.geo = undefined;

        await getMatchesForCandidate(mockReq, mockRes);

        expect(Job.find).toHaveBeenCalledWith({
            isOpen: true,
            status: 'active',
            employerId: { $ne: mockUser._id },
        });
    });

    it('should inject $near query and disable createdAt sort if radiusKm IS provided WITH valid coordinates', async () => {
        mockReq.query = { radiusKm: 25 };
        const geoQuery = buildNearQuery(20.0, 70.0, 25);

        await getMatchesForCandidate(mockReq, mockRes);

        expect(Job.find).toHaveBeenCalledWith({
            isOpen: true,
            status: 'active',
            employerId: { $ne: mockUser._id },
            ...geoQuery, // Injection asserted
        });

        // Sort must be undefined to let MongoDB sort by distance proximity natively
        expect(Job.find().sort).toHaveBeenCalledWith(undefined);
    });
});
