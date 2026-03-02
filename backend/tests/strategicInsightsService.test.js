jest.mock('../models/DailyJobMetrics', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/DailyFinancialMetrics', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/DailyTrustMetrics', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/DailyRegionMetrics', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/SkillTrendWeekly', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/StrategicInsight', () => ({
    create: jest.fn(),
    find: jest.fn(),
}));

const DailyJobMetrics = require('../models/DailyJobMetrics');
const DailyFinancialMetrics = require('../models/DailyFinancialMetrics');
const DailyTrustMetrics = require('../models/DailyTrustMetrics');
const DailyRegionMetrics = require('../models/DailyRegionMetrics');
const SkillTrendWeekly = require('../models/SkillTrendWeekly');
const StrategicInsight = require('../models/StrategicInsight');

const { generateDeterministicInsights } = require('../services/strategicInsightsService');

const leanResult = (value) => ({
    lean: jest.fn().mockResolvedValue(value),
});

const sortedLeanResult = (value) => ({
    sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(value),
    }),
});

describe('strategicInsightsService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        StrategicInsight.create.mockImplementation(async (payload) => payload);
    });

    it('creates deterministic insights for interview drop and trust velocity', async () => {
        DailyJobMetrics.findOne
            .mockReturnValueOnce(leanResult({
                dateKey: '2026-02-28',
                interviewCompletionRate: 0.22,
                hireSuccessRate: 0.18,
            }))
            .mockReturnValueOnce(sortedLeanResult({
                dateKey: '2026-02-27',
                interviewCompletionRate: 0.32,
            }));

        DailyFinancialMetrics.findOne.mockReturnValueOnce(leanResult({
            dateKey: '2026-02-28',
            escrowReleaseRate: 0.5,
        }));

        DailyTrustMetrics.findOne
            .mockReturnValueOnce(leanResult({
                dateKey: '2026-02-28',
                highTrustCloseSpeedMultiplier: 2.2,
                highTrustHireSpeedHours: 18,
                lowTrustHireSpeedHours: 40,
            }))
            .mockReturnValueOnce(sortedLeanResult({
                dateKey: '2026-02-27',
                highTrustCloseSpeedMultiplier: 1.7,
            }));

        SkillTrendWeekly.findOne.mockReturnValueOnce({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    weekKey: '2026-W09',
                    skill: 'delivery',
                    growthRateWoW: 0.24,
                    searchedCount: 300,
                    hiredCount: 80,
                }),
            }),
        });

        DailyRegionMetrics.findOne.mockReturnValueOnce({
            sort: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue({
                    dateKey: '2026-02-28',
                    region: 'IN-HYD',
                    revenue: 50000,
                    revenuePerActiveUser: 120,
                    conversionRate: 0.21,
                }),
            }),
        });

        const result = await generateDeterministicInsights({ dateKey: '2026-02-28' });

        expect(result.createdCount).toBeGreaterThanOrEqual(4);
        const createdTypes = StrategicInsight.create.mock.calls.map((call) => call[0].insightType);
        expect(createdTypes).toContain('INTERVIEW_COMPLETION_DROP');
        expect(createdTypes).toContain('HIGH_TRUST_FASTER_HIRING');
        expect(createdTypes).toContain('SKILL_GROWTH_SPIKE');
        expect(createdTypes).toContain('TOP_REVENUE_REGION');
    });
});
