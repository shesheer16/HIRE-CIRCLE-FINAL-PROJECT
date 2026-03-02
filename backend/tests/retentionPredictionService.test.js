jest.mock('../models/Application', () => ({
    find: jest.fn(),
    aggregate: jest.fn(),
}));

jest.mock('../models/EmployerTier', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/HiringLifecycleEvent', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    findById: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    findById: jest.fn(),
}));

const Application = require('../models/Application');
const EmployerTier = require('../models/EmployerTier');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const { predictRetention } = require('../services/retentionPredictionService');

describe('retentionPredictionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns explainable retention probability and risk category', async () => {
        WorkerProfile.findById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: 'worker-1',
                    preferredShift: 'Day',
                    city: 'Hyderabad',
                    roleProfiles: [{ expectedSalary: 18000 }],
                }),
            }),
        });

        Job.findById.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    _id: 'job-1',
                    employerId: 'emp-1',
                    shift: 'Day',
                    title: 'Driver',
                    location: 'Hyderabad',
                }),
            }),
        });

        Application.find.mockReturnValue({
            sort: () => ({
                limit: () => ({
                    populate: () => ({
                        select: () => ({
                            lean: async () => ([
                                {
                                    status: 'hired',
                                    job: { shift: 'Day', maxSalary: 19000, title: 'Driver', location: 'Hyderabad' },
                                },
                                {
                                    status: 'shortlisted',
                                    job: { shift: 'Night', maxSalary: 20000, title: 'Driver', location: 'Hyderabad' },
                                },
                            ]),
                        }),
                    }),
                }),
            }),
        });

        HiringLifecycleEvent.aggregate
            .mockResolvedValueOnce([
                { _id: 'APPLICATION_HIRED', count: 10 },
                { _id: 'RETENTION_30D', count: 7 },
            ]);

        EmployerTier.findOne.mockReturnValue({
            select: () => ({
                lean: async () => ({
                    retention30dRate: 0.68,
                }),
            }),
        });

        Application.aggregate
            .mockResolvedValueOnce([{ _id: null, count: 80 }])
            .mockResolvedValueOnce([{ _id: null, count: 24 }]);

        const result = await predictRetention({
            workerId: 'worker-1',
            jobId: 'job-1',
        });

        expect(result.probabilityStays30d).toBeGreaterThan(0);
        expect(result.probabilityStays30d).toBeLessThanOrEqual(1);
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(result.riskCategory);
        expect(result.explainability).toEqual(expect.objectContaining({
            shiftAdherenceScore: expect.any(Number),
            employerRetentionScore: expect.any(Number),
            roleClusterVolatility: expect.any(Number),
        }));
    });
});
