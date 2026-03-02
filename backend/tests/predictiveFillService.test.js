jest.mock('../models/CityLiquidityScore', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/CitySkillGraph', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/EmployerTier', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    findById: jest.fn(),
    countDocuments: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    countDocuments: jest.fn(),
}));

const CityLiquidityScore = require('../models/CityLiquidityScore');
const CitySkillGraph = require('../models/CitySkillGraph');
const EmployerTier = require('../models/EmployerTier');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const { predictTimeToFill } = require('../services/predictiveFillService');

describe('predictiveFillService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('predicts time to fill with bounded output and confidence range', async () => {
        Job.findById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: 'job-1',
                    title: 'Driver',
                    location: 'Hyderabad',
                    maxSalary: 22000,
                    salaryRange: '18k-22k',
                    employerId: 'emp-1',
                }),
            }),
        });
        CityLiquidityScore.findOne.mockReturnValue({
            sort: () => ({
                select: () => ({
                    lean: async () => ({
                        workersPerJob: 2.3,
                        avgTimeToFill: 8.5,
                        fillRate: 0.52,
                        activeWorkers30d: 1200,
                        openJobs: 480,
                    }),
                }),
            }),
        });
        EmployerTier.findOne.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    tier: 'Gold',
                }),
            }),
        });
        CitySkillGraph.findOne.mockReturnValue({
            sort: () => ({
                select: () => ({
                    lean: async () => ({
                        hireSuccessProbability: 0.62,
                    }),
                }),
            }),
        });
        WorkerProfile.countDocuments.mockResolvedValue(450);
        Job.countDocuments.mockResolvedValue(220);

        const result = await predictTimeToFill({ jobId: 'job-1' });

        expect(result.expectedDaysToFill).toBeGreaterThan(0);
        expect(result.expectedDaysToFill).toBeLessThanOrEqual(120);
        expect(result.confidenceRange.lowDays).toBeLessThan(result.confidenceRange.highDays);
        expect(result.explainability.skillScarcity.source).toBe('city_skill_graph');
    });
});
