jest.mock('../models/Application', () => ({
    find: jest.fn(),
}));

jest.mock('../models/Job', () => ({
    find: jest.fn(),
}));

jest.mock('../models/MatchPerformanceMetric', () => ({
    find: jest.fn(),
}));

jest.mock('../models/MatchRun', () => ({
    find: jest.fn(),
}));

const Application = require('../models/Application');
const Job = require('../models/Job');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchRun = require('../models/MatchRun');
const { filterJobsByApplyIntent } = require('../services/matchIntentFilterService');

const chain = (value) => ({
    select: () => ({
        lean: async () => value,
    }),
});

describe('matchIntentFilterService', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('blocks all jobs when worker ignores 3+ strong matches in 7 days', async () => {
        MatchPerformanceMetric.find.mockReturnValueOnce(chain([
            { jobId: 'job-1' },
            { jobId: 'job-2' },
            { jobId: 'job-3' },
            { jobId: 'job-4' },
        ]));

        Application.find
            .mockReturnValueOnce(chain([]))
            .mockReturnValueOnce(chain([]));

        MatchRun.find.mockReturnValueOnce(chain([]));
        Job.find.mockReturnValueOnce(chain([]));

        const result = await filterJobsByApplyIntent({
            worker: { _id: 'worker-1', roleProfiles: [] },
            jobs: [{ _id: 'job-10', title: 'Driver', maxSalary: 20000 }],
        });

        expect(result.blocked).toBe(true);
        expect(result.jobs).toEqual([]);
        expect(result.reasons.STRONG_MATCH_IGNORE_STREAK).toBe(1);
    });

    it('filters recently rejected similar jobs and salary mismatch trend', async () => {
        MatchPerformanceMetric.find.mockReturnValueOnce(chain([]));

        Application.find
            .mockReturnValueOnce(chain([{ job: 'job-old' }]))
            .mockReturnValueOnce(chain([]));

        Job.find.mockReturnValueOnce(chain([{ _id: 'job-old', title: 'Delivery Driver' }]));
        MatchRun.find.mockReturnValueOnce(chain([
            { rejectReasonCounts: { SALARY_OUTSIDE_RANGE: 2 } },
            { rejectReasonCounts: { SALARY_OUTSIDE_RANGE: 2 } },
        ]));

        const result = await filterJobsByApplyIntent({
            worker: {
                _id: 'worker-1',
                roleProfiles: [{ expectedSalary: 30000 }],
            },
            jobs: [
                { _id: 'job-1', title: 'Driver', maxSalary: 22000 },
                { _id: 'job-2', title: 'Cook', maxSalary: 18000 },
                { _id: 'job-3', title: 'Housekeeping', maxSalary: 35000 },
            ],
        });

        expect(result.blocked).toBe(false);
        expect(result.jobs.map((row) => row._id)).toEqual(['job-3']);
        expect(result.reasons.RECENT_SIMILAR_REJECTION + result.reasons.SALARY_MISMATCH_TREND).toBe(2);
        expect(result.reasons.SALARY_MISMATCH_TREND).toBeGreaterThanOrEqual(1);
    });
});
