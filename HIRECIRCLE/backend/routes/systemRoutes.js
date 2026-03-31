const express = require('express');

const { getExtendedHealthSnapshot } = require('../services/systemHealthService');
const { getDegradationState } = require('../services/degradationService');
const { getResilienceState } = require('../services/resilienceStateService');
const { getMonitoringSnapshot, acknowledgeSystemAlert } = require('../services/systemMonitoringService');
const { getUserDailyAiUsage, calculateAiCostPerHire } = require('../services/aiCostOptimizationService');
const { startupIntegrityCheck } = require('../services/startupIntegrityService');
const { appendPlatformAuditLog } = require('../services/platformAuditService');
const { getEdgeCdnPolicySnapshot } = require('../services/edgeCdnPolicyService');
const { getRegionReplicationSnapshot } = require('../services/regionReplicationService');
const {
    getGlobalScaleAutopilotSnapshot,
    runGlobalScaleAutopilotTick,
} = require('../services/globalScaleAutopilotService');
const AiUsageMetric = require('../models/AiUsageMetric');
const SystemAlert = require('../models/SystemAlert');

const router = express.Router();

router.get('/health/extended', async (req, res) => {
    try {
        const force = String(req.query.force || '').toLowerCase() === 'true';
        const io = req.app.get('io') || null;

        const snapshot = await getExtendedHealthSnapshot({ io, force });
        return res.status(200).json(snapshot);
    } catch (error) {
        return res.status(500).json({
            status: 'critical',
            message: 'Failed to fetch system health snapshot',
            error: error.message,
            degradation: getDegradationState(),
            resilience: getResilienceState(),
        });
    }
});

router.get('/alerts', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || '50', 10)));
        const rows = await SystemAlert.find({})
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();

        const monitoring = await getMonitoringSnapshot();

        return res.json({
            success: true,
            data: rows,
            monitoring,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch alerts',
            error: error.message,
        });
    }
});

router.post('/alerts/:id/ack', async (req, res) => {
    try {
        const updated = await acknowledgeSystemAlert(req.params.id);
        if (!updated) {
            return res.status(404).json({ success: false, message: 'Alert not found' });
        }

        return res.json({ success: true, data: updated });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to acknowledge alert', error: error.message });
    }
});

router.get('/startup-integrity', async (_req, res) => {
    try {
        const result = startupIntegrityCheck({ strict: false });
        return res.status(result.passed ? 200 : 503).json(result);
    } catch (error) {
        return res.status(500).json({ passed: false, message: error.message });
    }
});

router.get('/ai/usage', async (req, res) => {
    try {
        const userId = String(req.query.userId || '').trim() || null;
        const from = req.query.from || null;
        const to = req.query.to || null;
        const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit || '100', 10)));

        const [daily, costPerHire, recentEvents] = await Promise.all([
            getUserDailyAiUsage({ userId }).catch(() => ({ totalTokens: 0, totalCostUsd: 0, callCount: 0 })),
            userId
                ? calculateAiCostPerHire({ userId, from, to }).catch(() => ({ totalCostUsd: 0, hires: 0, aiCostPerHireUsd: 0 }))
                : Promise.resolve({ totalCostUsd: 0, hires: 0, aiCostPerHireUsd: 0 }),
            AiUsageMetric.find(userId ? { userId } : {})
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean(),
        ]);

        return res.json({
            success: true,
            daily,
            costPerHire,
            events: recentEvents,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch AI usage', error: error.message });
    }
});

router.get('/global-scale', async (req, res) => {
    try {
        const forceTick = String(req.query.force || '').toLowerCase() === 'true';
        if (forceTick) {
            await runGlobalScaleAutopilotTick();
        }

        return res.json({
            success: true,
            data: {
                autopilot: getGlobalScaleAutopilotSnapshot(),
                edgePolicy: getEdgeCdnPolicySnapshot(),
                replication: getRegionReplicationSnapshot(),
                degradation: getDegradationState(),
                resilience: getResilienceState(),
            },
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch global-scale snapshot',
            error: error.message,
        });
    }
});

router.post('/internal/replication/events', async (req, res) => {
    try {
        const configuredSharedKey = String(process.env.REGION_REPLICATION_SHARED_KEY || '').trim();
        if (configuredSharedKey) {
            const suppliedKey = String(req.headers['x-replication-key'] || '').trim();
            if (!suppliedKey || suppliedKey !== configuredSharedKey) {
                return res.status(401).json({ success: false, message: 'Invalid replication signature' });
            }
        }

        const payload = req.body || {};
        const eventId = String(payload.eventId || '').trim();
        const eventType = String(payload.eventType || '').trim();
        if (!eventId || !eventType) {
            return res.status(400).json({ success: false, message: 'eventId and eventType are required' });
        }

        await appendPlatformAuditLog({
            eventType: 'region.replication.received',
            actorType: 'system',
            action: 'replication_receive',
            status: 202,
            metadata: {
                eventId,
                eventType,
                sourceRegion: payload.sourceRegion || null,
                entityType: payload.entityType || null,
                entityId: payload.entityId || null,
            },
        });

        return res.status(202).json({
            success: true,
            replicated: true,
            eventId,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Replication ingest failed',
            error: error.message,
        });
    }
});

module.exports = router;
