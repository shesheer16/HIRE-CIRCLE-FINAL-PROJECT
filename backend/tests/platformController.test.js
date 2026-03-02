jest.mock('../models/Job', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findById: jest.fn(),
}));

jest.mock('../match/matchEngineV2', () => ({
    evaluateBestRoleForJob: jest.fn(),
    mapTier: jest.fn(),
}));

jest.mock('../match/applyProbabilisticOverlay', () => ({
    applyOverlay: jest.fn(),
}));

jest.mock('../services/matchQualityIntelligenceService', () => ({
    buildMatchIntelligenceContext: jest.fn(),
}));

jest.mock('../services/predictiveFillService', () => ({
    predictTimeToFill: jest.fn(),
}));

jest.mock('../services/retentionPredictionService', () => ({
    predictRetention: jest.fn(),
}));

jest.mock('../services/cityLiquidityService', () => ({
    getLatestCityLiquidity: jest.fn(),
}));

jest.mock('../services/tenantIsolationService', () => ({
    assertTenantAccessToEmployer: jest.fn(),
    getTenantEmployerIds: jest.fn(),
}));

const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const matchEngineV2 = require('../match/matchEngineV2');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
const { buildMatchIntelligenceContext } = require('../services/matchQualityIntelligenceService');
const { predictTimeToFill } = require('../services/predictiveFillService');
const { predictRetention } = require('../services/retentionPredictionService');
const { getLatestCityLiquidity } = require('../services/cityLiquidityService');
const { assertTenantAccessToEmployer, getTenantEmployerIds } = require('../services/tenantIsolationService');

const {
    platformMatch,
    platformPredictFill,
    platformPredictRetention,
    platformCityLiquidity,
} = require('../controllers/platformController');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('platformController', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        assertTenantAccessToEmployer.mockResolvedValue(true);
        getTenantEmployerIds.mockResolvedValue([]);
        Job.findById.mockReturnValue({
            lean: jest.fn().mockResolvedValue(null),
        });
        WorkerProfile.findById.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(null),
            }),
        });
    });

    it('returns match payload for valid external worker+job payload', async () => {
        buildMatchIntelligenceContext.mockResolvedValue({
            dynamicThresholds: { STRONG: 0.82, GOOD: 0.7, POSSIBLE: 0.62 },
            getScoringContextForJob: () => ({}),
        });
        matchEngineV2.evaluateBestRoleForJob.mockReturnValue({
            accepted: true,
            roleData: { roleName: 'Driver', skills: ['Driving'] },
            tier: 'GOOD',
            finalScore: 0.74,
            baseScore: 0.72,
            skillScore: 0.9,
            experienceScore: 0.8,
            salaryFitScore: 0.85,
            distanceScore: 1,
            profileCompletenessMultiplier: 0.9,
            reliabilityScore: 0.95,
            explainability: { confidenceScore: 0.81 },
        });
        applyOverlay.mockResolvedValue({
            matchProbability: 0.88,
            tier: 'STRONG',
            probabilisticFallbackUsed: false,
            explainability: { confidenceScore: 0.9 },
            matchModelVersionUsed: 'v100',
        });

        const req = {
            body: {
                worker: {
                    city: 'Hyderabad',
                    preferredShift: 'Day',
                    roleProfiles: [{ roleName: 'Driver', skills: ['Driving'], expectedSalary: 18000 }],
                    hasCompletedProfile: true,
                },
                job: {
                    title: 'Driver',
                    location: 'Hyderabad',
                    requirements: ['Driving'],
                    maxSalary: 22000,
                    shift: 'Day',
                },
            },
            platformClient: { apiKeyId: 'key-1' },
        };
        const res = mockRes();
        await platformMatch(req, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            accepted: true,
            tier: 'STRONG',
            matchProbability: 0.88,
            deterministicScore: 0.72,
            probabilisticScore: 0.88,
        }));
    });

    it('rejects platform match when worker roleProfiles are missing', async () => {
        const req = {
            body: {
                worker: { city: 'Hyderabad', roleProfiles: [] },
                job: { title: 'Driver', location: 'Hyderabad' },
            },
        };
        const res = mockRes();

        await platformMatch(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('roleProfiles'),
        }));
    });

    it('returns predict fill response', async () => {
        Job.findById.mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                _id: 'job-1',
                employerId: 'emp-1',
                title: 'Driver',
                location: 'Hyderabad',
            }),
        });
        predictTimeToFill.mockResolvedValue({
            expectedDaysToFill: 9.5,
            confidenceRange: { lowDays: 7, highDays: 12, confidenceScore: 0.8 },
        });
        const req = { method: 'POST', body: { jobId: 'job-1' } };
        const res = mockRes();
        await platformPredictFill(req, res);

        expect(predictTimeToFill).toHaveBeenCalledWith(expect.objectContaining({
            jobId: 'job-1',
            jobData: expect.objectContaining({ _id: 'job-1' }),
        }));
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ expectedDaysToFill: 9.5 }),
        }));
    });

    it('returns retention prediction response', async () => {
        WorkerProfile.findById.mockReturnValue({
            populate: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    _id: 'w1',
                    roleProfiles: [{ roleName: 'Driver', skills: ['Driving'] }],
                    user: { _id: 'user-1', hasCompletedProfile: true, isVerified: true },
                }),
            }),
        });
        Job.findById.mockReturnValue({
            lean: jest.fn().mockResolvedValue({
                _id: 'j1',
                employerId: 'emp-1',
                title: 'Driver',
                location: 'Hyderabad',
            }),
        });
        predictRetention.mockResolvedValue({
            probabilityStays30d: 0.71,
            riskCategory: 'LOW',
        });
        const req = { body: { workerId: 'w1', jobId: 'j1' } };
        const res = mockRes();
        await platformPredictRetention(req, res);

        expect(predictRetention).toHaveBeenCalledWith({ workerId: 'w1', jobId: 'j1' });
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({ riskCategory: 'LOW' }),
        }));
    });

    it('returns city liquidity rows', async () => {
        getLatestCityLiquidity.mockResolvedValue([{ city: 'Hyderabad', workersPerJob: 3.2 }]);
        const req = { query: { city: 'Hyderabad', limit: '10' } };
        const res = mockRes();
        await platformCityLiquidity(req, res);

        expect(getLatestCityLiquidity).toHaveBeenCalledWith({ city: 'Hyderabad', limit: 10 });
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: [{ city: 'Hyderabad', workersPerJob: 3.2 }],
        });
    });
});
