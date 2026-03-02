require('dotenv').config();

const axios = require('axios');
const connectDB = require('../config/db');
const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchModelReport = require('../models/MatchModelReport');
const Notification = require('../models/Notification');
const User = require('../models/userModel');
const { getMatchPerformanceAlerts } = require('../services/matchMetricsService');
const { executeWithCircuitBreaker } = require('../services/circuitBreakerService');
const { getMatchQualityTargets } = require('../config/matchQualityTargets');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ratio = (num, den) => (den > 0 ? num / den : 0);
const ADMIN_BATCH_SIZE = 500;
const ADMIN_HARD_CAP = 5000;

const evaluateRetrainNeed = ({
    currentHireRate,
    previousHireRate,
    holdoutAuc,
    labeledEvents,
    minAucThreshold,
    driftDropThreshold,
    minLabeledEvents,
    significantBelowTarget = false,
}) => {
    const aucDrop = Number.isFinite(holdoutAuc) && holdoutAuc < minAucThreshold;
    const conversionDrop = previousHireRate > 0
        ? ((previousHireRate - currentHireRate) / previousHireRate) >= driftDropThreshold
        : false;
    const sufficientData = labeledEvents >= minLabeledEvents;
    const benchmarkUnderTarget = Boolean(significantBelowTarget);

    return {
        aucDrop,
        conversionDrop,
        benchmarkUnderTarget,
        sufficientData,
        retrainNeeded: sufficientData && (aucDrop || conversionDrop || benchmarkUnderTarget),
    };
};

const computeWindowMetrics = async ({ from, to }) => {
    const [applications, interviews, hires, offersExtended, offersAccepted, labeledEvents] = await Promise.all([
        MatchPerformanceMetric.countDocuments({
            eventName: 'APPLICATION_CREATED',
            timestamp: { $gte: from, $lte: to },
        }),
        MatchPerformanceMetric.countDocuments({
            eventName: { $in: ['APPLICATION_INTERVIEWED', 'APPLICATION_SHORTLISTED'] },
            timestamp: { $gte: from, $lte: to },
        }),
        MatchPerformanceMetric.countDocuments({
            eventName: 'APPLICATION_HIRED',
            timestamp: { $gte: from, $lte: to },
        }),
        MatchPerformanceMetric.countDocuments({
            eventName: 'OFFER_EXTENDED',
            timestamp: { $gte: from, $lte: to },
        }),
        MatchPerformanceMetric.countDocuments({
            eventName: 'OFFER_ACCEPTED',
            timestamp: { $gte: from, $lte: to },
        }),
        MatchPerformanceMetric.countDocuments({
            eventName: { $in: ['APPLICATION_CREATED', 'APPLICATION_HIRED', 'WORKER_JOINED'] },
            timestamp: { $gte: from, $lte: to },
        }),
    ]);

    const offerDenominator = offersExtended > 0 ? offersExtended : hires;
    const offerNumerator = offersAccepted > 0 ? offersAccepted : hires;

    return {
        applications,
        interviews,
        hires,
        offersExtended,
        offersAccepted,
        postInterviewHireRate: ratio(hires, interviews),
        offerAcceptanceRate: ratio(offerNumerator, offerDenominator),
        labeledEvents,
        hireRate: ratio(hires, applications),
    };
};

const emitAdminAlert = async ({ title, message, payload }) => {
    const adminIds = [];
    let lastSeenId = null;

    while (adminIds.length < ADMIN_HARD_CAP) {
        const remaining = ADMIN_HARD_CAP - adminIds.length;
        const batch = await User.find({
            isAdmin: true,
            ...(lastSeenId ? { _id: { $gt: lastSeenId } } : {}),
        })
            .select('_id')
            .sort({ _id: 1 })
            .limit(Math.min(ADMIN_BATCH_SIZE, remaining))
            .lean();

        if (!batch.length) break;

        adminIds.push(...batch.map((row) => row._id));
        lastSeenId = batch[batch.length - 1]._id;
    }

    if (adminIds.length >= ADMIN_HARD_CAP && lastSeenId) {
        const hasMoreAdmins = await User.findOne({
            isAdmin: true,
            _id: { $gt: lastSeenId },
        }).select('_id').lean();
        if (hasMoreAdmins) {
            console.warn(`[match-retrain-check] admin alert hard cap reached at ${ADMIN_HARD_CAP}; additional admins skipped`);
        }
    }

    if (!adminIds.length) return 0;

    await Notification.insertMany(
        adminIds.map((adminUserId) => ({
            user: adminUserId,
            type: 'status_update',
            title,
            message,
            relatedData: {
                nudgeType: 'match_retrain_alert',
                payload,
            },
            isRead: false,
        })),
        { ordered: false }
    );

    return adminIds.length;
};

const triggerRetrain = async ({ reason, context }) => {
    const triggerUrl = String(process.env.MATCH_RETRAIN_TRIGGER_URL || '').trim();
    if (!triggerUrl) {
        return { triggered: false, mode: 'none', message: 'No retrain trigger URL configured' };
    }

    const token = String(process.env.MATCH_RETRAIN_TRIGGER_TOKEN || '').trim();
    const headers = token
        ? {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }
        : { 'Content-Type': 'application/json' };

    await executeWithCircuitBreaker(
        'external_api',
        async () => axios.post(
            triggerUrl,
            {
                reason,
                context,
                triggeredAt: new Date().toISOString(),
            },
            { headers, timeout: 10000 }
        ),
        {
            failureThreshold: Number.parseInt(process.env.EXTERNAL_API_CIRCUIT_FAILURE_THRESHOLD || '4', 10),
            cooldownMs: Number.parseInt(process.env.EXTERNAL_API_CIRCUIT_COOLDOWN_MS || String(45 * 1000), 10),
            timeoutMs: Number.parseInt(process.env.EXTERNAL_API_CIRCUIT_TIMEOUT_MS || '10000', 10),
        }
    );

    return { triggered: true, mode: 'webhook', message: 'Retrain trigger dispatched' };
};

const runMatchRetrainCheck = async () => {
    const minAucThreshold = Number.parseFloat(process.env.MATCH_RETRAIN_MIN_AUC || '0.78');
    const driftDropThreshold = Number.parseFloat(process.env.MATCH_RETRAIN_CONVERSION_DROP || '0.2');
    const minLabeledEvents = Number.parseInt(process.env.MATCH_RETRAIN_MIN_LABELED_EVENTS || '300', 10);
    const windowDays = Number.parseInt(process.env.MATCH_RETRAIN_WINDOW_DAYS || '30', 10);
    const qualityTargets = getMatchQualityTargets();

    const now = new Date();
    const currentFrom = new Date(now.getTime() - windowDays * MS_PER_DAY);
    const previousFrom = new Date(currentFrom.getTime() - windowDays * MS_PER_DAY);

    const [currentWindow, previousWindow, latestReport, performanceSnapshot] = await Promise.all([
        computeWindowMetrics({ from: currentFrom, to: now }),
        computeWindowMetrics({ from: previousFrom, to: currentFrom }),
        MatchModelReport.findOne().sort({ createdAt: -1 }).lean(),
        getMatchPerformanceAlerts({
            from: currentFrom,
            to: now,
            defaultDays: windowDays,
        }),
    ]);

    const targetMetrics = [
        {
            key: 'interviewRate',
            current: Number(performanceSnapshot?.metrics?.interviewRate || 0),
            target: Number(performanceSnapshot?.targets?.interviewRateTarget || qualityTargets.interviewRateTarget),
            denominator: Number(performanceSnapshot?.metrics?.counts?.matchesServed || 0),
        },
        {
            key: 'postInterviewHireRate',
            current: Number(performanceSnapshot?.metrics?.postInterviewHireRate || 0),
            target: Number(
                performanceSnapshot?.targets?.postInterviewHireRateTarget || qualityTargets.postInterviewHireRateTarget
            ),
            denominator: Number(performanceSnapshot?.metrics?.counts?.interviewCount || 0),
        },
        {
            key: 'offerAcceptanceRate',
            current: Number(performanceSnapshot?.metrics?.offerAcceptanceRate || 0),
            target: Number(performanceSnapshot?.targets?.offerAcceptanceTarget || qualityTargets.offerAcceptanceTarget),
            denominator: Number(performanceSnapshot?.metrics?.counts?.offerDenominator || 0),
        },
    ];

    const significantGapThreshold = Number(qualityTargets.retrainSignificantGap || 0.15);
    const minTargetSample = Math.max(1, Number(qualityTargets.minimumSampleSize || 20));
    const significantTargetBreaches = targetMetrics.filter((metric) => {
        if (!Number.isFinite(metric.target) || metric.target <= 0) return false;
        if (metric.denominator < minTargetSample) return false;
        const threshold = metric.target * (1 - significantGapThreshold);
        return metric.current < threshold;
    });

    const holdoutAuc = Number(latestReport?.aggregateMetrics?.holdoutAuc);
    const evaluation = evaluateRetrainNeed({
        currentHireRate: currentWindow.hireRate,
        previousHireRate: previousWindow.hireRate,
        holdoutAuc,
        labeledEvents: currentWindow.labeledEvents,
        minAucThreshold,
        driftDropThreshold,
        minLabeledEvents,
        significantBelowTarget: significantTargetBreaches.length > 0,
    });

    const context = {
        windowDays,
        currentWindow,
        previousWindow,
        performanceSnapshot: {
            targets: performanceSnapshot?.targets || null,
            metrics: performanceSnapshot?.metrics || null,
            breachedAlerts: performanceSnapshot?.alerts || [],
            significantTargetBreaches,
        },
        holdoutAuc: Number.isFinite(holdoutAuc) ? holdoutAuc : null,
        thresholds: {
            minAucThreshold,
            driftDropThreshold,
            minLabeledEvents,
        },
        evaluation,
    };

    if (!evaluation.retrainNeeded) {
        return {
            retrainNeeded: false,
            context,
        };
    }

    const reasons = [];
    if (evaluation.aucDrop) reasons.push('auc_drop');
    if (evaluation.conversionDrop) reasons.push('conversion_drop');
    if (evaluation.benchmarkUnderTarget) reasons.push('target_gap');

    const alertTitle = 'Match model retrain recommended';
    const alertMessage = `Signals detected (${reasons.join(', ')}) with labeled events ${currentWindow.labeledEvents}.`;

    const [alertsSent, triggerResult] = await Promise.all([
        emitAdminAlert({
            title: alertTitle,
            message: alertMessage,
            payload: context,
        }),
        triggerRetrain({
            reason: reasons.join(','),
            context,
        }).catch((error) => ({
            triggered: false,
            mode: 'webhook',
            message: error?.message || 'Trigger failed',
        })),
    ]);

    return {
        retrainNeeded: true,
        reasons,
        alertsSent,
        triggerResult,
        context,
    };
};

const main = async () => {
    await connectDB();
    const result = await runMatchRetrainCheck();
    console.log(JSON.stringify({
        event: 'match_retrain_check',
        ...result,
    }));
    process.exit(0);
};

if (require.main === module) {
    main().catch((error) => {
        console.warn('[match-retrain-check] failed:', error.message);
        process.exit(1);
    });
}

module.exports = {
    evaluateRetrainNeed,
    runMatchRetrainCheck,
};
