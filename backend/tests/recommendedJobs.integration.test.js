jest.mock('../controllers/matchingController', () => ({
    matchCache: new Map(),
}));

jest.mock('../config/redis', () => ({
    isOpen: false,
    keys: jest.fn(),
    del: jest.fn(),
}));

jest.mock('../services/metricsService', () => ({
    publishMetric: jest.fn(),
}));

jest.mock('../services/matchMetricsService', () => ({
    recordJobFillCompletedOnce: jest.fn(),
    recordMatchPerformanceMetric: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/matchQualityIntelligenceService', () => ({
    buildMatchIntelligenceContext: jest.fn(async () => ({
        dynamicThresholds: {
            STRONG: 0.82,
            GOOD: 0.70,
            POSSIBLE: 0.62,
        },
        getScoringContextForJob: () => ({}),
    })),
}));

jest.mock('../services/matchIntentFilterService', () => ({
    filterJobsByApplyIntent: jest.fn(async ({ jobs = [] }) => ({
        jobs,
        blocked: false,
        reasons: {},
        diagnostics: {
            ignoredStrongCount: 0,
            viewedStrongCount: 0,
            salaryMismatchCount: 0,
        },
    })),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findById: jest.fn(),
    findOne: jest.fn(),
}));

jest.mock('../models/userModel', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/MatchRun', () => ({
    create: jest.fn().mockResolvedValue({ _id: 'run-1' }),
}));

jest.mock('../models/MatchLog', () => ({
    insertMany: jest.fn().mockResolvedValue([]),
}));

jest.mock('../match/matchProbabilistic', () => ({
    scoreSinglePair: jest.fn().mockResolvedValue({
        fallbackUsed: true,
        modelVersionUsed: null,
        modelKeyUsed: null,
    }),
}));

const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const { getRecommendedJobs } = require('../controllers/jobController');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const buildWorker = () => ({
    _id: 'worker-1',
    user: { _id: 'user-1', isVerified: true, hasCompletedProfile: true },
    firstName: 'Test',
    city: 'Hyderabad',
    isAvailable: true,
    interviewVerified: true,
    preferredShift: 'Flexible',
    licenses: ['Commercial'],
    roleProfiles: [
        {
            roleName: 'Driver',
            experienceInRole: 4,
            expectedSalary: 22000,
            skills: ['Driving', 'Delivery'],
        },
    ],
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastActiveAt: new Date('2026-01-02T00:00:00Z'),
});

const buildJobs = (count) => Array.from({ length: count }).map((_, index) => ({
    _id: `job-${index}`,
    title: 'Driver',
    location: 'Hyderabad',
    requirements: ['Driving'],
    maxSalary: 25000 + index,
    shift: 'Flexible',
    mandatoryLicenses: [],
    isOpen: true,
    status: 'active',
    createdAt: new Date(Date.now() - index * 1000),
}));

describe('GET /api/jobs/recommended integration-style', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns ordered top 20 recommendations with explainability', async () => {
        const worker = buildWorker();
        const jobs = buildJobs(35);

        WorkerProfile.findOne.mockReturnValue({
            populate: () => ({ lean: async () => worker }),
        });

        Job.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: async () => jobs,
                }),
            }),
        });

        const req = {
            user: { _id: 'user-1', isAdmin: false },
            query: {},
        };
        const res = mockRes();

        await getRecommendedJobs(req, res);

        expect(res.status).not.toHaveBeenCalledWith(500);
        const payload = res.json.mock.calls[0][0];
        expect(Array.isArray(payload.recommendedJobs)).toBe(true);
        expect(payload.recommendedJobs.length).toBeLessThanOrEqual(20);
        if (payload.recommendedJobs.length > 1) {
            expect(payload.recommendedJobs[0].matchProbability)
                .toBeGreaterThanOrEqual(payload.recommendedJobs[1].matchProbability);
        }
        expect(payload.recommendedJobs[0]).toHaveProperty('explainability');
    });

    it('blocks unauthorized workerId access', async () => {
        const worker = buildWorker();

        WorkerProfile.findById.mockReturnValue({
            populate: () => ({ lean: async () => worker }),
        });

        const req = {
            user: { _id: 'different-user', isAdmin: false },
            query: { workerId: 'worker-1' },
        };

        const res = mockRes();

        await getRecommendedJobs(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('hides explainability payload when FEATURE_MATCH_UI_V1 is disabled', async () => {
        const worker = buildWorker();
        const jobs = buildJobs(10);

        WorkerProfile.findOne.mockReturnValue({
            populate: () => ({ lean: async () => worker }),
        });

        Job.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    lean: async () => jobs,
                }),
            }),
        });

        const req = {
            user: {
                _id: 'user-1',
                isAdmin: false,
                featureToggles: {
                    FEATURE_MATCH_UI_V1: false,
                    FEATURE_PROBABILISTIC_MATCH: false,
                },
            },
            query: {},
        };
        const res = mockRes();

        await getRecommendedJobs(req, res);

        const payload = res.json.mock.calls[0][0];
        expect(payload.recommendedJobs.length).toBeGreaterThan(0);
        expect(payload.recommendedJobs[0].explainability).toEqual({});
    });
});
