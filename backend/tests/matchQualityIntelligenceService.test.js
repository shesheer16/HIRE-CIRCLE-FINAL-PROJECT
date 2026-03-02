jest.mock('../models/Application', () => ({
    aggregate: jest.fn(),
    find: jest.fn(),
}));

jest.mock('../models/HiringLifecycleEvent', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(),
}));

jest.mock('../models/MatchPerformanceMetric', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../models/MatchRun', () => ({
    find: jest.fn(),
}));

jest.mock('../models/WorkerProfile', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/CityLiquidityScore', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/EmployerTier', () => ({
    find: jest.fn(),
}));

const Application = require('../models/Application');
const CityLiquidityScore = require('../models/CityLiquidityScore');
const EmployerTier = require('../models/EmployerTier');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchRun = require('../models/MatchRun');
const WorkerProfile = require('../models/WorkerProfile');
const { buildMatchIntelligenceContext } = require('../services/matchQualityIntelligenceService');

jest.setTimeout(15000);

const chain = (value) => ({
    select: () => ({
        lean: async () => value,
    }),
});

describe('matchQualityIntelligenceService', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('raises possible threshold and boosts skill weighting when conversions underperform', async () => {
        const employerId = '507f191e810c19729de860ea';

        MatchPerformanceMetric.aggregate.mockResolvedValueOnce([
            { _id: { eventName: 'MATCH_RECOMMENDATION_VIEWED', tier: 'STRONG' }, count: 100 },
            { _id: { eventName: 'MATCH_RECOMMENDATION_VIEWED', tier: 'GOOD' }, count: 100 },
            { _id: { eventName: 'MATCH_RECOMMENDATION_VIEWED', tier: 'POSSIBLE' }, count: 100 },
            { _id: { eventName: 'APPLICATION_CREATED', tier: 'STRONG' }, count: 40 },
            { _id: { eventName: 'APPLICATION_CREATED', tier: 'GOOD' }, count: 20 },
            { _id: { eventName: 'APPLICATION_CREATED', tier: 'POSSIBLE' }, count: 40 },
            { _id: { eventName: 'APPLICATION_HIRED', tier: 'POSSIBLE' }, count: 1 },
        ]);

        WorkerProfile.countDocuments.mockResolvedValueOnce(4500);
        CityLiquidityScore.findOne.mockReturnValueOnce({
            sort: () => ({
                select: () => ({
                    lean: async () => ({
                        workersPerJob: 1.8,
                    }),
                }),
            }),
        });

        Application.find.mockReturnValueOnce(chain([
            { job: 'job-1', status: 'shortlisted' },
            { job: 'job-1', status: 'hired' },
        ]));

        MatchRun.find.mockReturnValueOnce(chain([
            { rejectReasonCounts: { SALARY_OUTSIDE_RANGE: 1 } },
        ]));

        Job.find.mockReturnValueOnce(chain([
            { _id: 'job-1', shift: 'Day' },
        ]));

        Application.aggregate.mockResolvedValueOnce([
            {
                _id: employerId,
                totalApplications: 10,
                shortlisted: 4,
                offersExtended: 2,
                offersAccepted: 1,
                hires: 2,
                avgResponseMs: 6 * 60 * 60 * 1000,
            },
        ]);

        HiringLifecycleEvent.aggregate.mockResolvedValueOnce([
            { _id: { employerId, eventType: 'APPLICATION_HIRED' }, count: 2 },
            { _id: { employerId, eventType: 'RETENTION_30D' }, count: 1 },
        ]);
        EmployerTier.find.mockReturnValueOnce({
            lean: async () => ([
                {
                    employerId,
                    tier: 'Gold',
                    rankingBoostMultiplier: 1.03,
                },
            ]),
        });

        const context = await buildMatchIntelligenceContext({
            worker: {
                _id: 'worker-1',
                city: 'Hyderabad',
                preferredShift: 'Day',
                roleProfiles: [{ expectedSalary: 22000 }],
            },
            jobs: [
                {
                    _id: 'job-1',
                    employerId,
                    location: 'Hyderabad',
                    title: 'Driver',
                },
            ],
            cityHint: 'Hyderabad',
        });

        expect(context.dynamicThresholds.POSSIBLE).toBe(0.63);

        const scoringContext = context.getScoringContextForJob({ employerId });
        expect(scoringContext.skillWeightDelta).toBeGreaterThan(0);
        expect(scoringContext.distanceWeightExponent).toBeLessThan(1);
        expect(scoringContext.employerQualityScore).toBeGreaterThanOrEqual(0.9);
        expect(scoringContext.employerQualityScore).toBeLessThanOrEqual(1.1);
    });
});
