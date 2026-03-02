jest.mock('../models/EmployerTier', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../models/RevenueEvent', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../services/cityLiquidityService', () => ({
    getLatestCityLiquidity: jest.fn(),
}));

jest.mock('../services/cityExpansionSignalService', () => ({
    getLatestCityExpansionSignals: jest.fn(),
}));

jest.mock('../services/marketAnomalyService', () => ({
    getMarketAlerts: jest.fn(),
}));

jest.mock('../models/userModel', () => ({}));
jest.mock('../models/Job', () => ({}));
jest.mock('../models/Application', () => ({}));
jest.mock('../models/WorkerProfile', () => ({}));
jest.mock('../models/BetaCode', () => ({}));
jest.mock('../models/CityEmployerPipeline', () => ({}));
jest.mock('../models/MatchModelReport', () => ({}));
jest.mock('../match/matchModelCalibration', () => ({
    getAndPersistCalibrationSuggestion: jest.fn(),
}));
jest.mock('../services/matchMetricsService', () => ({
    getMatchPerformanceAlerts: jest.fn(),
}));

const EmployerTier = require('../models/EmployerTier');
const RevenueEvent = require('../models/RevenueEvent');
const { getLatestCityLiquidity } = require('../services/cityLiquidityService');
const { getLatestCityExpansionSignals } = require('../services/cityExpansionSignalService');
const { getMarketAlerts } = require('../services/marketAnomalyService');
const {
    getCityLiquidity,
    getMarketAlertsController,
    getMarketControlOverview,
} = require('../controllers/adminController');

const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

describe('admin market control controllers', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns city liquidity summary and counts market bands', async () => {
        getLatestCityLiquidity.mockResolvedValue([
            { city: 'Hyderabad', workersPerJob: 1.5, fillRate: 0.32, marketBand: 'under_supplied' },
            { city: 'Bengaluru', workersPerJob: 4.1, fillRate: 0.54, marketBand: 'balanced' },
            { city: 'Mumbai', workersPerJob: 8.2, fillRate: 0.49, marketBand: 'over_supplied' },
        ]);

        const req = { query: {} };
        const res = mockRes();
        await getCityLiquidity(req, res);

        expect(getLatestCityLiquidity).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            summary: {
                underSuppliedCities: 1,
                overSuppliedCities: 1,
            },
            data: expect.any(Array),
        }));
    });

    it('returns market alerts payload', async () => {
        getMarketAlerts.mockResolvedValue([
            { _id: 'a1', type: 'SUDDEN_EMPLOYER_DROP', severity: 'high', city: 'Hyderabad' },
        ]);

        const req = { query: { city: 'Hyderabad' } };
        const res = mockRes();
        await getMarketAlertsController(req, res);

        expect(getMarketAlerts).toHaveBeenCalledWith({ city: 'Hyderabad', limit: 100 });
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: expect.any(Array),
        });
    });

    it('returns market control overview with tier share and expansion readiness', async () => {
        getLatestCityLiquidity.mockResolvedValue([
            { city: 'Hyderabad', workersPerJob: 1.9, fillRate: 0.51, marketBand: 'under_supplied' },
        ]);
        getLatestCityExpansionSignals.mockResolvedValue([
            { city: 'Hyderabad', expansionReadinessScore: 0.78, readinessStatus: 'READY_FOR_SCALE' },
        ]);
        EmployerTier.aggregate.mockResolvedValue([
            { _id: 'Platinum', count: 2 },
            { _id: 'Gold', count: 2 },
        ]);
        RevenueEvent.aggregate.mockResolvedValue([
            { _id: 'Hyderabad', revenueInr: 120000 },
        ]);

        const req = { query: {} };
        const res = mockRes();
        await getMarketControlOverview(req, res);

        expect(getLatestCityLiquidity).toHaveBeenCalledWith({ limit: 200 });
        expect(getLatestCityExpansionSignals).toHaveBeenCalledWith({ limit: 200 });
        expect(EmployerTier.aggregate).toHaveBeenCalledTimes(1);
        expect(RevenueEvent.aggregate).toHaveBeenCalledTimes(1);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            success: true,
            data: expect.objectContaining({
                cityLiquidity: expect.any(Array),
                tierDistribution: expect.arrayContaining([
                    expect.objectContaining({ tier: 'Platinum', share: 0.5 }),
                    expect.objectContaining({ tier: 'Gold', share: 0.5 }),
                ]),
                revenuePerCity: expect.arrayContaining([
                    expect.objectContaining({ city: 'Hyderabad', revenueInr: 120000 }),
                ]),
                expansionReadiness: expect.arrayContaining([
                    expect.objectContaining({ city: 'Hyderabad', readinessStatus: 'READY_FOR_SCALE' }),
                ]),
            }),
        }));
    });
});
