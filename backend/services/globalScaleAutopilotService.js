const mongoose = require('mongoose');

const AiUsageMetric = require('../models/AiUsageMetric');
const { startOfUtcDay, addUtcDays } = require('../utils/timezone');
const { getResilienceState } = require('./resilienceStateService');
const { getMonitoringSnapshot, emitStructuredAlert } = require('./systemMonitoringService');
const { setDegradationFlag, getDegradationState } = require('./degradationService');
const { appendPlatformAuditLog } = require('./platformAuditService');
const { getRegionReplicationSnapshot } = require('./regionReplicationService');

const AUTOPILOT_INTERVAL_MS = Math.max(5000, Number.parseInt(process.env.GLOBAL_SCALE_AUTOPILOT_INTERVAL_MS || '30000', 10));
const AI_DAILY_BUDGET_USD = Math.max(1, Number.parseFloat(process.env.AI_GLOBAL_DAILY_BUDGET_USD || '250'));
const AI_WARN_RATIO = Number.parseFloat(process.env.AI_GLOBAL_WARN_RATIO || '0.75');
const AI_CRITICAL_RATIO = Number.parseFloat(process.env.AI_GLOBAL_CRITICAL_RATIO || '0.9');
const INFRA_MEMORY_WARN_PERCENT = Number.parseInt(process.env.GLOBAL_INFRA_MEMORY_WARN_PERCENT || '88', 10);
const INFRA_API_ERROR_RATE_WARN_PERCENT = Number.parseFloat(process.env.GLOBAL_INFRA_API_ERROR_RATE_WARN_PERCENT || '8');
const INFRA_LOAD_WARN_SCORE = Number.parseInt(process.env.GLOBAL_INFRA_LOAD_WARN_SCORE || '75', 10);
const INFRA_QUEUE_BACKPRESSURE_DEPTH = Number.parseInt(process.env.QUEUE_BACKPRESSURE_DEPTH || '1500', 10);

const state = {
    running: false,
    timer: null,
    startedAt: null,
    lastTickAt: null,
    tickCount: 0,
    lastDurationMs: 0,
    lastError: null,
    mode: 'normal',
    lastAiMode: 'normal',
    lastInfraMode: 'normal',
    ai: {
        mode: 'normal',
        budgetUsd: AI_DAILY_BUDGET_USD,
        dailyCostUsd: 0,
        utilizationRatio: 0,
        totalCalls: 0,
        totalTokens: 0,
        topModels: [],
        topRegions: [],
    },
    infra: {
        mode: 'normal',
        loadScore: 0,
        memoryUsagePercent: 0,
        apiErrorRatePercent: 0,
        queueDepth: 0,
        queueBackpressureActive: false,
        highLoadActive: false,
    },
    replication: {
        enabled: false,
        running: false,
        queueDepth: 0,
        inFlight: 0,
    },
    degradation: {},
};

const hasDatabaseConnection = () => Number(mongoose?.connection?.readyState || 0) === 1;

const resolveAiMode = (utilizationRatio) => {
    const usage = Number(utilizationRatio || 0);
    if (usage >= AI_CRITICAL_RATIO) return 'critical';
    if (usage >= AI_WARN_RATIO) return 'guarded';
    return 'normal';
};

const resolveInfraMode = ({
    loadScore = 0,
    memoryUsagePercent = 0,
    apiErrorRatePercent = 0,
    queueDepth = 0,
    queueBackpressureActive = false,
} = {}) => {
    const queuePressure = queueBackpressureActive || queueDepth >= INFRA_QUEUE_BACKPRESSURE_DEPTH;
    const highLoad = Number(loadScore || 0) >= INFRA_LOAD_WARN_SCORE
        || Number(memoryUsagePercent || 0) >= INFRA_MEMORY_WARN_PERCENT
        || Number(apiErrorRatePercent || 0) >= INFRA_API_ERROR_RATE_WARN_PERCENT;

    if (queuePressure && highLoad) return 'critical';
    if (queuePressure || highLoad) return 'guarded';
    return 'normal';
};

const readAiDailySummary = async () => {
    if (!hasDatabaseConnection()) {
        return {
            dailyCostUsd: 0,
            totalCalls: 0,
            totalTokens: 0,
            topModels: [],
            topRegions: [],
            utilizationRatio: 0,
            mode: 'normal',
        };
    }

    const from = startOfUtcDay(new Date());
    const to = addUtcDays(from, 1);

    const [totalsRows, modelRows, regionRows] = await Promise.all([
        AiUsageMetric.aggregate([
            {
                $match: {
                    createdAt: { $gte: from, $lt: to },
                    status: { $in: ['success', 'failed'] },
                },
            },
            {
                $group: {
                    _id: null,
                    dailyCostUsd: { $sum: '$estimatedCostUsd' },
                    totalTokens: { $sum: '$estimatedTotalTokens' },
                    totalCalls: { $sum: 1 },
                },
            },
        ]),
        AiUsageMetric.aggregate([
            {
                $match: {
                    createdAt: { $gte: from, $lt: to },
                    status: { $in: ['success', 'failed'] },
                },
            },
            {
                $group: {
                    _id: '$model',
                    totalCostUsd: { $sum: '$estimatedCostUsd' },
                    calls: { $sum: 1 },
                },
            },
            { $sort: { totalCostUsd: -1 } },
            { $limit: 3 },
        ]),
        AiUsageMetric.aggregate([
            {
                $match: {
                    createdAt: { $gte: from, $lt: to },
                    status: { $in: ['success', 'failed'] },
                },
            },
            {
                $group: {
                    _id: '$region',
                    totalCostUsd: { $sum: '$estimatedCostUsd' },
                    calls: { $sum: 1 },
                },
            },
            { $sort: { totalCostUsd: -1 } },
            { $limit: 3 },
        ]),
    ]);

    const dailyCostUsd = Number(Number(totalsRows?.[0]?.dailyCostUsd || 0).toFixed(6));
    const totalCalls = Number(totalsRows?.[0]?.totalCalls || 0);
    const totalTokens = Number(totalsRows?.[0]?.totalTokens || 0);
    const utilizationRatio = Number((dailyCostUsd / Math.max(1e-9, AI_DAILY_BUDGET_USD)).toFixed(6));

    return {
        dailyCostUsd,
        totalCalls,
        totalTokens,
        topModels: modelRows.map((row) => ({
            model: String(row._id || 'unknown'),
            totalCostUsd: Number(Number(row.totalCostUsd || 0).toFixed(6)),
            calls: Number(row.calls || 0),
        })),
        topRegions: regionRows.map((row) => ({
            region: String(row._id || 'unknown'),
            totalCostUsd: Number(Number(row.totalCostUsd || 0).toFixed(6)),
            calls: Number(row.calls || 0),
        })),
        utilizationRatio,
        mode: resolveAiMode(utilizationRatio),
    };
};

const applyAutopilotFlags = ({ aiMode, infraMode, queueDepth, queueBackpressureActive }) => {
    const queuePressure = queueBackpressureActive || Number(queueDepth || 0) >= INFRA_QUEUE_BACKPRESSURE_DEPTH;
    const highInfraPressure = infraMode !== 'normal';
    const aiPressure = aiMode !== 'normal';
    const aiCritical = aiMode === 'critical';
    const infraReason = highInfraPressure ? `infra_${infraMode}` : null;
    const aiCriticalReason = aiCritical ? 'ai_budget_critical' : null;

    setDegradationFlag('aiManualFallbackEnabled', aiPressure, aiPressure ? `ai_budget_${aiMode}` : null);
    setDegradationFlag(
        'adaptiveRateLimitingEnabled',
        highInfraPressure || aiCritical,
        aiCriticalReason || infraReason
    );
    setDegradationFlag('heavyAnalyticsPaused', highInfraPressure || aiCritical, aiCriticalReason || infraReason);
    setDegradationFlag('queuePaused', queuePressure, queuePressure ? 'queue_backpressure' : null);
    setDegradationFlag('smartInterviewPaused', queuePressure, queuePressure ? 'queue_backpressure' : null);
};

const maybeEmitModeChangeAlerts = async ({ previousAiMode, nextAiMode, previousInfraMode, nextInfraMode, ai, infra }) => {
    if (previousAiMode !== nextAiMode && nextAiMode !== 'normal') {
        await emitStructuredAlert({
            alertType: 'ai_budget_autopilot_mode_changed',
            metric: 'ai_budget_utilization_percent',
            value: Number((ai.utilizationRatio * 100).toFixed(2)),
            threshold: Number((AI_WARN_RATIO * 100).toFixed(2)),
            severity: nextAiMode === 'critical' ? 'critical' : 'warning',
            source: 'global_scale_autopilot',
            message: 'AI budget autopilot raised protection mode',
            details: {
                previousMode: previousAiMode,
                nextMode: nextAiMode,
                dailyCostUsd: ai.dailyCostUsd,
                budgetUsd: AI_DAILY_BUDGET_USD,
            },
        }).catch(() => {});
    }

    if (previousInfraMode !== nextInfraMode && nextInfraMode !== 'normal') {
        await emitStructuredAlert({
            alertType: 'infrastructure_autopilot_mode_changed',
            metric: 'system_load_score',
            value: Number(infra.loadScore || 0),
            threshold: INFRA_LOAD_WARN_SCORE,
            severity: nextInfraMode === 'critical' ? 'critical' : 'warning',
            source: 'global_scale_autopilot',
            message: 'Infrastructure autopilot raised protection mode',
            details: {
                previousMode: previousInfraMode,
                nextMode: nextInfraMode,
                memoryUsagePercent: infra.memoryUsagePercent,
                apiErrorRatePercent: infra.apiErrorRatePercent,
                queueDepth: infra.queueDepth,
            },
        }).catch(() => {});
    }
};

const runGlobalScaleAutopilotTick = async () => {
    const startedAt = Date.now();
    const previousAiMode = state.lastAiMode;
    const previousInfraMode = state.lastInfraMode;

    try {
        const [aiSummary, monitoring, replication] = await Promise.all([
            readAiDailySummary(),
            getMonitoringSnapshot().catch(() => ({})),
            Promise.resolve(getRegionReplicationSnapshot()).catch(() => ({
                enabled: false,
                running: false,
                queueDepth: 0,
                inFlight: 0,
            })),
        ]);

        const resilience = getResilienceState();
        const infraMode = resolveInfraMode({
            loadScore: resilience.loadScore,
            memoryUsagePercent: resilience.memoryUsagePercent,
            apiErrorRatePercent: Number(monitoring.apiErrorRatePercent || 0),
            queueDepth: resilience.queueDepth,
            queueBackpressureActive: resilience.queueBackpressureActive,
        });

        applyAutopilotFlags({
            aiMode: aiSummary.mode,
            infraMode,
            queueDepth: resilience.queueDepth,
            queueBackpressureActive: resilience.queueBackpressureActive,
        });

        await maybeEmitModeChangeAlerts({
            previousAiMode,
            nextAiMode: aiSummary.mode,
            previousInfraMode,
            nextInfraMode: infraMode,
            ai: aiSummary,
            infra: {
                loadScore: resilience.loadScore,
                memoryUsagePercent: resilience.memoryUsagePercent,
                apiErrorRatePercent: Number(monitoring.apiErrorRatePercent || 0),
                queueDepth: resilience.queueDepth,
            },
        });

        if (previousAiMode !== aiSummary.mode || previousInfraMode !== infraMode || state.tickCount === 0) {
            await appendPlatformAuditLog({
                eventType: 'infrastructure.autopilot.mode_changed',
                actorType: 'system',
                action: 'autopilot_tick',
                status: 200,
                metadata: {
                    previousAiMode,
                    nextAiMode: aiSummary.mode,
                    previousInfraMode,
                    nextInfraMode: infraMode,
                    aiDailyCostUsd: aiSummary.dailyCostUsd,
                    aiBudgetUsd: AI_DAILY_BUDGET_USD,
                    loadScore: resilience.loadScore,
                    queueDepth: resilience.queueDepth,
                    replicationQueueDepth: Number(replication.queueDepth || 0),
                },
            }).catch(() => {});
        }

        state.ai = {
            mode: aiSummary.mode,
            budgetUsd: AI_DAILY_BUDGET_USD,
            dailyCostUsd: aiSummary.dailyCostUsd,
            utilizationRatio: aiSummary.utilizationRatio,
            totalCalls: aiSummary.totalCalls,
            totalTokens: aiSummary.totalTokens,
            topModels: aiSummary.topModels,
            topRegions: aiSummary.topRegions,
        };
        state.infra = {
            mode: infraMode,
            loadScore: Number(resilience.loadScore || 0),
            memoryUsagePercent: Number(resilience.memoryUsagePercent || 0),
            apiErrorRatePercent: Number(monitoring.apiErrorRatePercent || 0),
            queueDepth: Number(resilience.queueDepth || 0),
            queueBackpressureActive: Boolean(resilience.queueBackpressureActive),
            highLoadActive: Boolean(resilience.highLoadActive),
        };
        state.replication = {
            enabled: Boolean(replication.enabled),
            running: Boolean(replication.running),
            queueDepth: Number(replication.queueDepth || 0),
            inFlight: Number(replication.inFlight || 0),
            stats: replication.stats || {},
        };
        state.mode = aiSummary.mode === 'critical' || infraMode === 'critical'
            ? 'critical'
            : aiSummary.mode === 'guarded' || infraMode === 'guarded'
                ? 'guarded'
                : 'normal';
        state.degradation = getDegradationState();
        state.lastAiMode = aiSummary.mode;
        state.lastInfraMode = infraMode;
        state.lastError = null;
    } catch (error) {
        state.lastError = error.message;
    } finally {
        state.lastTickAt = new Date().toISOString();
        state.tickCount += 1;
        state.lastDurationMs = Date.now() - startedAt;
    }

    return getGlobalScaleAutopilotSnapshot();
};

const startGlobalScaleAutopilot = () => {
    if (state.timer) return;
    state.running = true;
    state.startedAt = state.startedAt || new Date().toISOString();

    state.timer = setInterval(() => {
        void runGlobalScaleAutopilotTick();
    }, AUTOPILOT_INTERVAL_MS);

    if (typeof state.timer.unref === 'function') {
        state.timer.unref();
    }

    void runGlobalScaleAutopilotTick();
};

const stopGlobalScaleAutopilot = () => {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
    state.running = false;
};

const getGlobalScaleAutopilotSnapshot = () => ({
    running: state.running,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    tickCount: state.tickCount,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
    mode: state.mode,
    ai: {
        ...state.ai,
    },
    infra: {
        ...state.infra,
    },
    replication: {
        ...state.replication,
    },
    degradation: {
        ...(state.degradation || {}),
    },
});

const resetForTests = () => {
    if (state.timer) {
        clearInterval(state.timer);
    }
    state.running = false;
    state.timer = null;
    state.startedAt = null;
    state.lastTickAt = null;
    state.tickCount = 0;
    state.lastDurationMs = 0;
    state.lastError = null;
    state.mode = 'normal';
    state.lastAiMode = 'normal';
    state.lastInfraMode = 'normal';
    state.ai = {
        mode: 'normal',
        budgetUsd: AI_DAILY_BUDGET_USD,
        dailyCostUsd: 0,
        utilizationRatio: 0,
        totalCalls: 0,
        totalTokens: 0,
        topModels: [],
        topRegions: [],
    };
    state.infra = {
        mode: 'normal',
        loadScore: 0,
        memoryUsagePercent: 0,
        apiErrorRatePercent: 0,
        queueDepth: 0,
        queueBackpressureActive: false,
        highLoadActive: false,
    };
    state.replication = {
        enabled: false,
        running: false,
        queueDepth: 0,
        inFlight: 0,
    };
    state.degradation = {};
};

module.exports = {
    runGlobalScaleAutopilotTick,
    startGlobalScaleAutopilot,
    stopGlobalScaleAutopilot,
    getGlobalScaleAutopilotSnapshot,
    __test__: {
        resetForTests,
        resolveAiMode,
        resolveInfraMode,
    },
};
