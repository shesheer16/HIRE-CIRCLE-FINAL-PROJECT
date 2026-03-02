jest.mock('../models/AiUsageMetric', () => ({
    aggregate: jest.fn(),
}));

jest.mock('../services/resilienceStateService', () => ({
    getResilienceState: jest.fn(),
}));

jest.mock('../services/systemMonitoringService', () => ({
    getMonitoringSnapshot: jest.fn(),
    emitStructuredAlert: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/degradationService', () => ({
    setDegradationFlag: jest.fn(),
    getDegradationState: jest.fn(() => ({
        adaptiveRateLimitingEnabled: false,
    })),
}));

jest.mock('../services/platformAuditService', () => ({
    appendPlatformAuditLog: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/regionReplicationService', () => ({
    getRegionReplicationSnapshot: jest.fn(() => ({
        enabled: true,
        running: true,
        queueDepth: 0,
        inFlight: 0,
        stats: {},
    })),
}));

const AiUsageMetric = require('../models/AiUsageMetric');
const mongoose = require('mongoose');
const { getResilienceState } = require('../services/resilienceStateService');
const { getMonitoringSnapshot } = require('../services/systemMonitoringService');
const { setDegradationFlag } = require('../services/degradationService');

const {
    runGlobalScaleAutopilotTick,
    getGlobalScaleAutopilotSnapshot,
    __test__,
} = require('../services/globalScaleAutopilotService');

describe('globalScaleAutopilotService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        __test__.resetForTests();
        mongoose.connection.readyState = 1;
    });

    it('enables AI guardrails when daily AI budget is in critical zone', async () => {
        AiUsageMetric.aggregate
            .mockResolvedValueOnce([{ dailyCostUsd: 260, totalTokens: 120000, totalCalls: 240 }])
            .mockResolvedValueOnce([{ _id: 'gemini-1.5-pro', totalCostUsd: 200, calls: 100 }])
            .mockResolvedValueOnce([{ _id: 'ap-south-1', totalCostUsd: 260, calls: 240 }]);

        getResilienceState.mockReturnValue({
            loadScore: 20,
            memoryUsagePercent: 40,
            queueDepth: 10,
            queueBackpressureActive: false,
            highLoadActive: false,
        });
        getMonitoringSnapshot.mockResolvedValue({ apiErrorRatePercent: 1 });

        await runGlobalScaleAutopilotTick();
        const snapshot = getGlobalScaleAutopilotSnapshot();

        expect(snapshot.ai.mode).toBe('critical');
        expect(snapshot.mode).toBe('critical');
        expect(setDegradationFlag).toHaveBeenCalledWith('aiManualFallbackEnabled', true, 'ai_budget_critical');
        expect(setDegradationFlag).toHaveBeenCalledWith('adaptiveRateLimitingEnabled', true, 'ai_budget_critical');
    });

    it('applies queue and infra protections when load and queue pressure rise', async () => {
        AiUsageMetric.aggregate
            .mockResolvedValueOnce([{ dailyCostUsd: 12, totalTokens: 10000, totalCalls: 20 }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);

        getResilienceState.mockReturnValue({
            loadScore: 86,
            memoryUsagePercent: 90,
            queueDepth: 2300,
            queueBackpressureActive: true,
            highLoadActive: true,
        });
        getMonitoringSnapshot.mockResolvedValue({ apiErrorRatePercent: 14 });

        await runGlobalScaleAutopilotTick();
        const snapshot = getGlobalScaleAutopilotSnapshot();

        expect(snapshot.infra.mode).toBe('critical');
        expect(snapshot.mode).toBe('critical');
        expect(setDegradationFlag).toHaveBeenCalledWith('queuePaused', true, 'queue_backpressure');
        expect(setDegradationFlag).toHaveBeenCalledWith('smartInterviewPaused', true, 'queue_backpressure');
        expect(setDegradationFlag).toHaveBeenCalledWith('heavyAnalyticsPaused', true, 'infra_critical');
    });
});
