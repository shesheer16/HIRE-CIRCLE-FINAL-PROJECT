jest.mock('axios', () => ({
    post: jest.fn(),
}));

jest.mock('../models/MatchPerformanceMetric', () => ({
    countDocuments: jest.fn(),
}));

jest.mock('../models/MatchModelReport', () => ({
    findOne: jest.fn(),
}));

jest.mock('../models/Notification', () => ({
    insertMany: jest.fn(),
}));

jest.mock('../models/userModel', () => ({
    find: jest.fn(),
}));

jest.mock('../services/matchMetricsService', () => ({
    getMatchPerformanceAlerts: jest.fn(),
}));

const axios = require('axios');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchModelReport = require('../models/MatchModelReport');
const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { getMatchPerformanceAlerts } = require('../services/matchMetricsService');

const {
    evaluateRetrainNeed,
    runMatchRetrainCheck,
} = require('../cron/matchRetrainCheck');

describe('matchRetrainCheck cron', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.MATCH_RETRAIN_TRIGGER_URL = 'https://example.com/retrain';
        process.env.MATCH_RETRAIN_TRIGGER_TOKEN = 'token';
        process.env.MATCH_RETRAIN_MIN_LABELED_EVENTS = '300';
    });

    afterEach(() => {
        delete process.env.MATCH_RETRAIN_TRIGGER_URL;
        delete process.env.MATCH_RETRAIN_TRIGGER_TOKEN;
        delete process.env.MATCH_RETRAIN_MIN_LABELED_EVENTS;
    });

    it('flags retrain for AUC/conversion drift with sufficient data', () => {
        const result = evaluateRetrainNeed({
            currentHireRate: 0.1,
            previousHireRate: 0.3,
            holdoutAuc: 0.72,
            labeledEvents: 500,
            minAucThreshold: 0.78,
            driftDropThreshold: 0.2,
            minLabeledEvents: 300,
        });

        expect(result.retrainNeeded).toBe(true);
        expect(result.aucDrop).toBe(true);
        expect(result.conversionDrop).toBe(true);
    });

    it('flags retrain when benchmark targets are significantly below threshold', () => {
        const result = evaluateRetrainNeed({
            currentHireRate: 0.22,
            previousHireRate: 0.24,
            holdoutAuc: 0.82,
            labeledEvents: 500,
            minAucThreshold: 0.78,
            driftDropThreshold: 0.2,
            minLabeledEvents: 300,
            significantBelowTarget: true,
        });

        expect(result.retrainNeeded).toBe(true);
        expect(result.benchmarkUnderTarget).toBe(true);
        expect(result.aucDrop).toBe(false);
        expect(result.conversionDrop).toBe(false);
    });

    it('triggers admin alert + webhook under simulated drift', async () => {
        const makeFindChain = (rows) => ({
            select: () => ({
                sort: () => ({
                    limit: () => ({
                        lean: async () => rows,
                    }),
                }),
            }),
        });

        MatchPerformanceMetric.countDocuments
            .mockResolvedValueOnce(100) // current applications
            .mockResolvedValueOnce(30) // current interviews
            .mockResolvedValueOnce(10) // current hires
            .mockResolvedValueOnce(12) // current offers extended
            .mockResolvedValueOnce(9) // current offers accepted
            .mockResolvedValueOnce(500) // current labeled
            .mockResolvedValueOnce(120) // previous applications
            .mockResolvedValueOnce(40) // previous interviews
            .mockResolvedValueOnce(36) // previous hires
            .mockResolvedValueOnce(40) // previous offers extended
            .mockResolvedValueOnce(33) // previous offers accepted
            .mockResolvedValueOnce(520); // previous labeled

        MatchModelReport.findOne.mockReturnValue({
            sort: () => ({
                lean: async () => ({
                    aggregateMetrics: { holdoutAuc: 0.74 },
                }),
            }),
        });
        getMatchPerformanceAlerts.mockResolvedValue({
            targets: {
                interviewRateTarget: 0.1,
                postInterviewHireRateTarget: 0.35,
                offerAcceptanceTarget: 0.78,
            },
            metrics: {
                interviewRate: 0.12,
                postInterviewHireRate: 0.33,
                offerAcceptanceRate: 0.75,
                counts: {
                    matchesServed: 100,
                    interviewCount: 30,
                    offerDenominator: 12,
                },
            },
            alerts: [
                { metric: 'postInterviewHireRate', current: 0.33, target: 0.35, severity: 'low' },
            ],
            trends: [],
        });

        User.find
            .mockReturnValueOnce(makeFindChain([{ _id: 'admin-1' }]))
            .mockReturnValueOnce(makeFindChain([]));

        Notification.insertMany.mockResolvedValue([]);
        axios.post.mockResolvedValue({ status: 200 });

        const result = await runMatchRetrainCheck();

        expect(result.retrainNeeded).toBe(true);
        expect(result.alertsSent).toBe(1);
        expect(result.triggerResult.triggered).toBe(true);
        expect(Notification.insertMany).toHaveBeenCalled();
        expect(axios.post).toHaveBeenCalled();
    });
});
