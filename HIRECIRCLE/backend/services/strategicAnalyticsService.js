const crypto = require('crypto');
const logger = require('../utils/logger');

const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');
const EventEnvelope = require('../models/EventEnvelope');
const HiringLifecycleEvent = require('../models/HiringLifecycleEvent');
const FinancialTransaction = require('../models/FinancialTransaction');
const Escrow = require('../models/Escrow');
const PaymentRecord = require('../models/PaymentRecord');
const Subscription = require('../models/Subscription');
const UserTrustScore = require('../models/UserTrustScore');
const UserChurnRiskModel = require('../models/UserChurnRiskModel');
const EmployerProfile = require('../models/EmployerProfile');
const SystemHealth = require('../models/SystemHealth');

const WarehouseAggregationRun = require('../models/WarehouseAggregationRun');
const DailyUserMetrics = require('../models/DailyUserMetrics');
const DailyJobMetrics = require('../models/DailyJobMetrics');
const DailyFinancialMetrics = require('../models/DailyFinancialMetrics');
const DailyEngagementMetrics = require('../models/DailyEngagementMetrics');
const DailyTrustMetrics = require('../models/DailyTrustMetrics');
const DailyRegionMetrics = require('../models/DailyRegionMetrics');
const FunnelAnalyticsDaily = require('../models/FunnelAnalyticsDaily');
const CohortAnalyticsWeekly = require('../models/CohortAnalyticsWeekly');
const SkillTrendWeekly = require('../models/SkillTrendWeekly');
const EmployerSegmentSnapshotDaily = require('../models/EmployerSegmentSnapshotDaily');
const DailyPerformanceMetrics = require('../models/DailyPerformanceMetrics');

const { getQueueDepth } = require('./distributedTaskQueue');
const { generateDeterministicInsights, getLatestInsights } = require('./strategicInsightsService');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FUNNEL_STAGES = ['signup', 'otp', 'interview', 'profile_complete', 'apply', 'interview_completed', 'offer', 'hire'];
const STALE_RUN_MS = Number.parseInt(process.env.WAREHOUSE_RUN_STALE_MS || String(4 * 60 * 60 * 1000), 10);
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trial', 'grace'];
const REVENUE_CREDIT_SOURCES = ['subscription', 'commission', 'job_payment', 'escrow_release'];
const REVENUE_DEBIT_SOURCES = ['payment_refund', 'escrow_refund', 'withdrawal_processed'];

const round = (value, digits = 4) => {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    const factor = 10 ** digits;
    return Math.round(num * factor) / factor;
};

const safeDivide = (num, den) => (Number(den || 0) > 0 ? Number(num || 0) / Number(den || 0) : 0);

const toUtcDayWindow = (inputDate = new Date()) => {
    const parsed = new Date(inputDate);
    const day = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    const dayStartUTC = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0, 0));
    const dayEndUTC = new Date(dayStartUTC.getTime() + MS_PER_DAY);
    return {
        dayStartUTC,
        dayEndUTC,
        dateKey: toDateKey(dayStartUTC),
    };
};

const toDateKey = (date) => {
    const value = new Date(date);
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const startOfUtcWeek = (date) => {
    const value = new Date(date);
    const day = value.getUTCDay() || 7;
    const diff = day - 1;
    value.setUTCDate(value.getUTCDate() - diff);
    value.setUTCHours(0, 0, 0, 0);
    return value;
};

const toWeekKey = (date) => {
    const value = new Date(date);
    const day = value.getUTCDay() || 7;
    value.setUTCDate(value.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((value - yearStart) / MS_PER_DAY) + 1) / 7);
    return `${value.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

const addDays = (date, days) => new Date(new Date(date).getTime() + (Number(days || 0) * MS_PER_DAY));

const normalizeSkill = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s#+.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const categorizeBudgetBand = (budget) => {
    const value = Number(budget || 0);
    if (value >= 80000) return 'high';
    if (value >= 30000) return 'medium';
    return 'low';
};

const categorizeHiringBand = (jobsCount) => {
    const count = Number(jobsCount || 0);
    if (count >= 20) return 'high';
    if (count >= 5) return 'medium';
    return 'low';
};

const categorizeResponseBand = (avgResponseHours) => {
    const value = Number(avgResponseHours || 0);
    if (!Number.isFinite(value) || value <= 0) return 'slow';
    if (value <= 24) return 'fast';
    if (value <= 72) return 'medium';
    return 'slow';
};

const canonicalFunnelStage = (input) => {
    const value = String(input || '').trim().toLowerCase();
    if (!value) return null;
    if (value === 'interview_complete') return 'interview_completed';
    if (value === 'interview_completed') return 'interview_completed';
    if (value === 'offer_sent' || value === 'offer_proposed' || value === 'offer_accepted') return 'offer';
    if (FUNNEL_STAGES.includes(value)) return value;
    return null;
};

const createAppendOnly = async (Model, payload) => {
    try {
        const row = await Model.create(payload);
        return { created: true, duplicate: false, row };
    } catch (error) {
        if (error?.code === 11000) {
            return { created: false, duplicate: true, row: null };
        }
        throw error;
    }
};

const claimAggregationRun = async ({ jobName, windowKey, source = 'scheduler', force = false }) => {
    const now = new Date();
    const staleCutoff = new Date(Date.now() - STALE_RUN_MS);
    const runToken = crypto.randomUUID();

    if (force) {
        const forced = await WarehouseAggregationRun.findOneAndUpdate(
            { jobName, windowKey },
            {
                $set: {
                    status: 'running',
                    runToken,
                    source,
                    startedAt: now,
                    completedAt: null,
                    lastError: null,
                },
                $inc: { attempts: 1 },
            },
            { new: true }
        );
        if (forced) {
            return { acquired: true, runToken, run: forced };
        }
    }

    try {
        const created = await WarehouseAggregationRun.create({
            jobName,
            windowKey,
            runToken,
            status: 'running',
            source,
            attempts: 1,
            startedAt: now,
        });
        return { acquired: true, runToken, run: created };
    } catch (error) {
        if (error?.code !== 11000) throw error;
    }

    const existing = await WarehouseAggregationRun.findOne({ jobName, windowKey }).lean();
    if (!existing) {
        return { acquired: false, reason: 'missing_existing_run' };
    }

    if (existing.status === 'completed' && !force) {
        return { acquired: false, reason: 'already_completed', existing };
    }

    const canRecover = existing.status === 'failed'
        || (existing.status === 'running' && new Date(existing.startedAt) < staleCutoff);
    if (!canRecover && !force) {
        return { acquired: false, reason: 'already_running', existing };
    }

    const recovered = await WarehouseAggregationRun.findOneAndUpdate(
        { jobName, windowKey },
        {
            $set: {
                status: 'running',
                runToken,
                source,
                startedAt: now,
                completedAt: null,
                lastError: null,
            },
            $inc: { attempts: 1 },
        },
        { new: true }
    );

    if (!recovered) {
        return { acquired: false, reason: 'recover_failed', existing };
    }

    return { acquired: true, runToken, run: recovered };
};

const completeAggregationRun = async ({ jobName, windowKey, runToken, details = {} }) => {
    await WarehouseAggregationRun.findOneAndUpdate(
        { jobName, windowKey, runToken },
        {
            $set: {
                status: 'completed',
                completedAt: new Date(),
                details,
                lastError: null,
            },
        }
    );
};

const failAggregationRun = async ({ jobName, windowKey, runToken, error }) => {
    await WarehouseAggregationRun.findOneAndUpdate(
        { jobName, windowKey, runToken },
        {
            $set: {
                status: 'failed',
                completedAt: new Date(),
                lastError: String(error?.message || error || 'unknown'),
            },
        }
    );
};

const computeDailyUserMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const monthStart = addDays(dayEndUTC, -30);
    const signupRows = await User.find({
        createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        isDeleted: { $ne: true },
    }).select('_id createdAt').lean();
    const signupActorIds = signupRows.map((row) => String(row._id));

    const [dauActors, mauActors, retainedDay1Actors, retainedDay7Actors, retainedDay30Actors, highChurnRiskUsers] = await Promise.all([
        EventEnvelope.distinct('actorId', {
            timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC },
            actorId: { $nin: [null, ''] },
        }),
        EventEnvelope.distinct('actorId', {
            timestampUTC: { $gte: monthStart, $lt: dayEndUTC },
            actorId: { $nin: [null, ''] },
        }),
        signupActorIds.length
            ? EventEnvelope.distinct('actorId', {
                actorId: { $in: signupActorIds },
                timestampUTC: { $gte: addDays(dayStartUTC, 1), $lt: addDays(dayStartUTC, 2) },
            })
            : [],
        signupActorIds.length
            ? EventEnvelope.distinct('actorId', {
                actorId: { $in: signupActorIds },
                timestampUTC: { $gte: addDays(dayStartUTC, 7), $lt: addDays(dayStartUTC, 8) },
            })
            : [],
        signupActorIds.length
            ? EventEnvelope.distinct('actorId', {
                actorId: { $in: signupActorIds },
                timestampUTC: { $gte: addDays(dayStartUTC, 30), $lt: addDays(dayStartUTC, 31) },
            })
            : [],
        UserChurnRiskModel.countDocuments({
            churnRiskLevel: 'HIGH',
            computedAt: { $lte: dayEndUTC },
        }),
    ]);

    return createAppendOnly(DailyUserMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        dau: dauActors.length,
        mau: mauActors.length,
        newSignups: signupRows.length,
        retainedDay1: retainedDay1Actors.length,
        retainedDay7: retainedDay7Actors.length,
        retainedDay30: retainedDay30Actors.length,
        day1RetentionRate: round(safeDivide(retainedDay1Actors.length, signupRows.length), 4),
        day7RetentionRate: round(safeDivide(retainedDay7Actors.length, signupRows.length), 4),
        day30RetentionRate: round(safeDivide(retainedDay30Actors.length, signupRows.length), 4),
        highChurnRiskUsers: Number(highChurnRiskUsers || 0),
        computedAt: new Date(),
    });
};

const computeDailyJobMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const [newJobs, applicationsCreated, interviewsCompleted, offersCreated, hires, hiringTimeAgg] = await Promise.all([
        Job.countDocuments({ createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } }),
        Application.countDocuments({ createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } }),
        HiringLifecycleEvent.countDocuments({
            eventType: 'INTERVIEW_CONFIRMED',
            occurredAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        Application.countDocuments({
            status: {
                $in: [
                    'offer_sent',
                    'offer_accepted',
                    // Legacy compatibility.
                    'offer_proposed',
                    'accepted',
                ],
            },
            updatedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        Application.countDocuments({
            status: 'hired',
            updatedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        Application.aggregate([
            {
                $match: {
                    status: 'hired',
                    updatedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                },
            },
            {
                $project: {
                    hours: {
                        $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 1000 * 60 * 60],
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    avgHours: { $avg: '$hours' },
                },
            },
        ]),
    ]);

    return createAppendOnly(DailyJobMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        newJobs: Number(newJobs || 0),
        applicationsCreated: Number(applicationsCreated || 0),
        interviewsCompleted: Number(interviewsCompleted || 0),
        offersCreated: Number(offersCreated || 0),
        hires: Number(hires || 0),
        interviewCompletionRate: round(safeDivide(interviewsCompleted, applicationsCreated), 4),
        hireSuccessRate: round(safeDivide(hires, applicationsCreated), 4),
        averageHiringTimeHours: round(Number(hiringTimeAgg?.[0]?.avgHours || 0), 2),
        computedAt: new Date(),
    });
};

const convertBreakdownRows = (rows = []) => rows.map((row) => ({
    key: String(row._id || row.key || 'unknown').toUpperCase(),
    value: round(Number(row.total || row.value || 0), 2),
}));

const computeDailyFinancialMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const proPrice = Number.parseFloat(process.env.PRO_PLAN_MRR || '49');
    const enterprisePrice = Number.parseFloat(process.env.ENTERPRISE_PLAN_MRR || '299');

    const [creditsAgg, debitsAgg, escrowVolumeAgg, escrowReleased, escrowFunded, subscriptionCounts, featureRevenueRows, regionRevenueRows, trustTierRevenueRows, paymentCapturedAgg] = await Promise.all([
        FinancialTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'completed',
                    type: 'credit',
                    source: { $in: REVENUE_CREDIT_SOURCES },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                    userIds: { $addToSet: '$userId' },
                },
            },
        ]),
        FinancialTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'completed',
                    type: 'debit',
                    source: { $in: REVENUE_DEBIT_SOURCES },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                },
            },
        ]),
        Escrow.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                },
            },
        ]),
        Escrow.countDocuments({
            status: 'released',
            releasedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        Escrow.countDocuments({
            createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        Subscription.aggregate([
            {
                $match: {
                    status: { $in: ACTIVE_SUBSCRIPTION_STATUSES },
                    planType: { $in: ['pro', 'enterprise'] },
                },
            },
            {
                $group: {
                    _id: '$planType',
                    count: { $sum: 1 },
                },
            },
        ]),
        PaymentRecord.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'captured',
                },
            },
            {
                $group: {
                    _id: '$intentType',
                    total: { $sum: '$amount' },
                },
            },
        ]),
        FinancialTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'completed',
                    type: 'credit',
                    source: { $in: REVENUE_CREDIT_SOURCES },
                },
            },
            {
                $lookup: {
                    from: User.collection.name,
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userDoc',
                },
            },
            {
                $unwind: {
                    path: '$userDoc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $group: {
                    _id: { $ifNull: ['$userDoc.country', 'GLOBAL'] },
                    total: { $sum: '$amount' },
                },
            },
        ]),
        FinancialTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'completed',
                    type: 'credit',
                    source: { $in: REVENUE_CREDIT_SOURCES },
                },
            },
            {
                $lookup: {
                    from: User.collection.name,
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userDoc',
                },
            },
            {
                $unwind: {
                    path: '$userDoc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $group: {
                    _id: { $ifNull: ['$userDoc.trustStatus', 'UNKNOWN'] },
                    total: { $sum: '$amount' },
                },
            },
        ]),
        PaymentRecord.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'captured',
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                },
            },
        ]),
    ]);

    const creditTotal = Number(creditsAgg?.[0]?.total || 0);
    const debitTotal = Number(debitsAgg?.[0]?.total || 0);
    const revenueTotal = creditTotal - debitTotal;
    const revenueUsers = Array.isArray(creditsAgg?.[0]?.userIds) ? creditsAgg[0].userIds.length : 0;

    const subscriptionMap = subscriptionCounts.reduce((acc, row) => {
        acc[String(row._id || '').toLowerCase()] = Number(row.count || 0);
        return acc;
    }, {});
    const mrr = (Number(subscriptionMap.pro || 0) * proPrice) + (Number(subscriptionMap.enterprise || 0) * enterprisePrice);
    const arrProjection = mrr * 12;

    const ledgerInflow = creditTotal;
    const paymentCaptured = Number(paymentCapturedAgg?.[0]?.total || 0);

    return createAppendOnly(DailyFinancialMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        revenueTotal: round(revenueTotal, 2),
        revenuePerUser: round(safeDivide(revenueTotal, revenueUsers), 2),
        mrr: round(mrr, 2),
        arrProjection: round(arrProjection, 2),
        escrowVolume: round(Number(escrowVolumeAgg?.[0]?.total || 0), 2),
        escrowReleaseRate: round(safeDivide(escrowReleased, escrowFunded), 4),
        ledgerConsistencyDelta: round(paymentCaptured - ledgerInflow, 2),
        revenueByFeature: convertBreakdownRows(featureRevenueRows),
        revenueByRegion: convertBreakdownRows(regionRevenueRows),
        revenueByTrustTier: convertBreakdownRows(trustTierRevenueRows),
        computedAt: new Date(),
    });
};

const computeDailyEngagementMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const [messagesSent, applicationsSubmitted, activeEmployerRows, activeWorkerRows, responseAgg] = await Promise.all([
        Message.countDocuments({ createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } }),
        Application.countDocuments({ createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } }),
        Application.aggregate([
            { $match: { createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } } },
            { $group: { _id: '$employer' } },
        ]),
        Application.aggregate([
            { $match: { createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } } },
            { $group: { _id: '$worker' } },
        ]),
        Application.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: { $nin: ['applied', 'pending', 'requested'] },
                },
            },
            {
                $project: {
                    responseMinutes: {
                        $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 1000 * 60],
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    avgMinutes: { $avg: '$responseMinutes' },
                },
            },
        ]),
    ]);

    return createAppendOnly(DailyEngagementMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        messagesSent: Number(messagesSent || 0),
        applicationsSubmitted: Number(applicationsSubmitted || 0),
        activeEmployers: Number(activeEmployerRows.length || 0),
        activeWorkers: Number(activeWorkerRows.length || 0),
        averageEmployerResponseTimeMinutes: round(Number(responseAgg?.[0]?.avgMinutes || 0), 2),
        computedAt: new Date(),
    });
};

const computeDailyTrustMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const [trustAvgAgg, flaggedUsers, trustHireSpeedAgg] = await Promise.all([
        UserTrustScore.aggregate([
            { $match: { updatedAt: { $lte: dayEndUTC } } },
            { $group: { _id: null, avgScore: { $avg: '$score' } } },
        ]),
        UserTrustScore.countDocuments({
            $or: [
                { status: { $in: ['flagged', 'restricted'] } },
                { isFlagged: true },
            ],
        }),
        Application.aggregate([
            {
                $match: {
                    status: 'hired',
                    updatedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                },
            },
            {
                $lookup: {
                    from: User.collection.name,
                    localField: 'employer',
                    foreignField: '_id',
                    as: 'employerDoc',
                },
            },
            {
                $unwind: {
                    path: '$employerDoc',
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    tier: {
                        $cond: [{ $gte: [{ $ifNull: ['$employerDoc.trustScore', 100] }, 80] }, 'high', 'low'],
                    },
                    hireHours: {
                        $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 1000 * 60 * 60],
                    },
                },
            },
            {
                $group: {
                    _id: '$tier',
                    avgHireHours: { $avg: '$hireHours' },
                },
            },
        ]),
    ]);

    const trustSpeedMap = trustHireSpeedAgg.reduce((acc, row) => {
        acc[String(row._id || '').toLowerCase()] = Number(row.avgHireHours || 0);
        return acc;
    }, {});
    const highTrustHireSpeedHours = Number(trustSpeedMap.high || 0);
    const lowTrustHireSpeedHours = Number(trustSpeedMap.low || 0);
    const multiplier = highTrustHireSpeedHours > 0
        ? round(lowTrustHireSpeedHours / highTrustHireSpeedHours, 2)
        : 0;

    return createAppendOnly(DailyTrustMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        averageTrustScore: round(Number(trustAvgAgg?.[0]?.avgScore || 0), 2),
        flaggedUsers: Number(flaggedUsers || 0),
        highTrustHireSpeedHours: round(highTrustHireSpeedHours, 2),
        lowTrustHireSpeedHours: round(lowTrustHireSpeedHours, 2),
        highTrustCloseSpeedMultiplier: multiplier,
        computedAt: new Date(),
    });
};

const computeDailyRegionMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const [dauRows, signupRows, applicationRows, revenueRows] = await Promise.all([
        EventEnvelope.aggregate([
            { $match: { timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC }, actorId: { $nin: [null, ''] } } },
            {
                $group: {
                    _id: {
                        region: { $ifNull: ['$region', 'GLOBAL'] },
                        actorId: '$actorId',
                    },
                },
            },
            {
                $group: {
                    _id: '$_id.region',
                    dau: { $sum: 1 },
                },
            },
        ]),
        User.aggregate([
            { $match: { createdAt: { $gte: dayStartUTC, $lt: dayEndUTC }, isDeleted: { $ne: true } } },
            { $group: { _id: { $ifNull: ['$country', 'GLOBAL'] }, signups: { $sum: 1 } } },
        ]),
        Application.aggregate([
            { $match: { createdAt: { $gte: dayStartUTC, $lt: dayEndUTC } } },
            {
                $lookup: {
                    from: Job.collection.name,
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: { path: '$jobDoc', preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { $ifNull: ['$jobDoc.region', '$jobDoc.country'] },
                    applicationsCreated: { $sum: 1 },
                    hires: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        FinancialTransaction.aggregate([
            {
                $match: {
                    createdAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    status: 'completed',
                    type: 'credit',
                    source: { $in: REVENUE_CREDIT_SOURCES },
                },
            },
            {
                $lookup: {
                    from: User.collection.name,
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'userDoc',
                },
            },
            { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
            { $group: { _id: { $ifNull: ['$userDoc.country', 'GLOBAL'] }, revenue: { $sum: '$amount' } } },
        ]),
    ]);

    const byRegion = new Map();
    const touchRegion = (region) => {
        const key = String(region || 'GLOBAL').toUpperCase();
        if (!byRegion.has(key)) {
            byRegion.set(key, {
                region: key,
                country: key.includes('-') ? key.split('-')[0] : key,
                dau: 0,
                newSignups: 0,
                applicationsCreated: 0,
                hires: 0,
                revenue: 0,
            });
        }
        return byRegion.get(key);
    };

    dauRows.forEach((row) => {
        const entry = touchRegion(row._id);
        entry.dau += Number(row.dau || 0);
    });
    signupRows.forEach((row) => {
        const entry = touchRegion(row._id);
        entry.newSignups += Number(row.signups || 0);
    });
    applicationRows.forEach((row) => {
        const entry = touchRegion(row._id || 'GLOBAL');
        entry.applicationsCreated += Number(row.applicationsCreated || 0);
        entry.hires += Number(row.hires || 0);
    });
    revenueRows.forEach((row) => {
        const entry = touchRegion(row._id);
        entry.revenue += Number(row.revenue || 0);
    });

    const writes = [];
    for (const entry of byRegion.values()) {
        writes.push(createAppendOnly(DailyRegionMetrics, {
            dateKey,
            dayStartUTC,
            dayEndUTC,
            region: entry.region,
            country: entry.country,
            dau: entry.dau,
            newSignups: entry.newSignups,
            applicationsCreated: entry.applicationsCreated,
            hires: entry.hires,
            revenue: round(entry.revenue, 2),
            conversionRate: round(safeDivide(entry.hires, entry.applicationsCreated), 4),
            revenuePerActiveUser: round(safeDivide(entry.revenue, entry.dau), 2),
            computedAt: new Date(),
        }));
    }

    const results = await Promise.all(writes);
    return {
        created: results.filter((row) => row.created).length,
        duplicates: results.filter((row) => row.duplicate).length,
    };
};

const computeFunnelAnalyticsDaily = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const stageRows = await EventEnvelope.aggregate([
        {
            $match: {
                timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC },
            },
        },
        {
            $project: {
                region: { $ifNull: ['$region', 'GLOBAL'] },
                role: {
                    $ifNull: [
                        '$metadata.role',
                        { $ifNull: ['$metadata.roleCluster', 'general'] },
                    ],
                },
                eventType: '$eventType',
                stageHint: '$metadata.stage',
            },
        },
        {
            $project: {
                region: 1,
                role: 1,
                stage: {
                    $switch: {
                        branches: [
                            { case: { $eq: ['$eventType', 'FUNNEL_STAGE_REACHED'] }, then: '$stageHint' },
                            { case: { $eq: ['$eventType', 'USER_SIGNUP'] }, then: 'signup' },
                            { case: { $eq: ['$eventType', 'OTP_VERIFIED'] }, then: 'otp' },
                            { case: { $eq: ['$eventType', 'APPLICATION_CREATED'] }, then: 'apply' },
                            { case: { $eq: ['$eventType', 'INTERVIEW_CONFIRMED'] }, then: 'interview_completed' },
                            { case: { $eq: ['$eventType', 'INTERVIEW_COMPLETE'] }, then: 'interview_completed' },
                            { case: { $eq: ['$eventType', 'APPLICATION_SHORTLISTED'] }, then: 'offer' },
                            { case: { $eq: ['$eventType', 'OFFER_PROPOSED'] }, then: 'offer' },
                            { case: { $eq: ['$eventType', 'OFFER_ACCEPTED'] }, then: 'offer' },
                            { case: { $eq: ['$eventType', 'APPLICATION_HIRED'] }, then: 'hire' },
                        ],
                        default: null,
                    },
                },
            },
        },
        {
            $match: {
                stage: { $ne: null },
            },
        },
        {
            $group: {
                _id: {
                    region: '$region',
                    role: '$role',
                    stage: '$stage',
                },
                count: { $sum: 1 },
            },
        },
    ]);

    const byBucket = new Map();
    for (const row of stageRows) {
        const region = String(row?._id?.region || 'GLOBAL').toUpperCase();
        const role = String(row?._id?.role || 'general').toLowerCase();
        const stage = canonicalFunnelStage(row?._id?.stage);
        if (!stage) continue;
        const key = `${region}::${role}`;
        const current = byBucket.get(key) || {
            region,
            role,
            stageCounts: Object.fromEntries(FUNNEL_STAGES.map((value) => [value, 0])),
        };
        current.stageCounts[stage] = Number(current.stageCounts[stage] || 0) + Number(row.count || 0);
        byBucket.set(key, current);
    }

    const writes = [];
    for (const bucket of byBucket.values()) {
        const drop = {};
        const conversions = {};
        FUNNEL_STAGES.forEach((stage, index) => {
            const currentCount = Number(bucket.stageCounts[stage] || 0);
            const nextStage = FUNNEL_STAGES[index + 1];
            if (!nextStage) return;
            const nextCount = Number(bucket.stageCounts[nextStage] || 0);
            drop[stage] = Math.max(0, currentCount - nextCount);
            conversions[`${stage}_to_${nextStage}`] = round(safeDivide(nextCount, currentCount), 4);
        });

        writes.push(createAppendOnly(FunnelAnalyticsDaily, {
            dateKey,
            dayStartUTC,
            dayEndUTC,
            region: bucket.region,
            role: bucket.role,
            stageCounts: bucket.stageCounts,
            stageDropOff: drop,
            stageConversions: conversions,
            fullFunnelConversionRate: round(
                safeDivide(bucket.stageCounts.hire, bucket.stageCounts.signup),
                4
            ),
            computedAt: new Date(),
        }));
    }

    const results = await Promise.all(writes);
    return {
        created: results.filter((row) => row.created).length,
        duplicates: results.filter((row) => row.duplicate).length,
    };
};

const computeWeeklyCohortAnalytics = async ({ snapshotDateKey, snapshotDate }) => {
    const lookbackWeeks = Math.max(4, Number.parseInt(process.env.COHORT_LOOKBACK_WEEKS || '12', 10));
    const currentWeekStart = startOfUtcWeek(snapshotDate);
    const writes = [];

    for (let i = 0; i < lookbackWeeks; i += 1) {
        const cohortWeekStartUTC = addDays(currentWeekStart, -7 * i);
        const cohortWeekEndUTC = addDays(cohortWeekStartUTC, 7);
        const cohortWeekKey = toWeekKey(cohortWeekStartUTC);

        const users = await User.find({
            createdAt: { $gte: cohortWeekStartUTC, $lt: cohortWeekEndUTC },
            isDeleted: { $ne: true },
        }).select('_id createdAt').lean();

        if (!users.length) continue;
        const actorIds = users.map((row) => String(row._id));
        const maxWindowEnd = addDays(cohortWeekEndUTC, 31);
        const events = await EventEnvelope.find({
            actorId: { $in: actorIds },
            timestampUTC: { $gte: cohortWeekStartUTC, $lt: maxWindowEnd },
        }).select('actorId eventType timestampUTC').lean();

        const eventsByUser = new Map();
        events.forEach((row) => {
            const key = String(row.actorId || '');
            const list = eventsByUser.get(key) || [];
            list.push({
                ts: new Date(row.timestampUTC).getTime(),
                eventType: String(row.eventType || ''),
            });
            eventsByUser.set(key, list);
        });

        let retainedDay1 = 0;
        let retainedDay7 = 0;
        let retainedDay30 = 0;
        let interviewCompletedUsers = 0;

        users.forEach((user) => {
            const signupAt = new Date(user.createdAt).getTime();
            const userEvents = eventsByUser.get(String(user._id)) || [];
            const hasActivityInWindow = (offsetDays) => {
                const start = signupAt + (offsetDays * MS_PER_DAY);
                const end = start + MS_PER_DAY;
                return userEvents.some((row) => row.ts >= start && row.ts < end);
            };

            if (hasActivityInWindow(1)) retainedDay1 += 1;
            if (hasActivityInWindow(7)) retainedDay7 += 1;
            if (hasActivityInWindow(30)) retainedDay30 += 1;
            if (userEvents.some((row) => ['INTERVIEW_CONFIRMED', 'INTERVIEW_COMPLETE'].includes(row.eventType))) {
                interviewCompletedUsers += 1;
            }
        });

        const revenueAgg = await FinancialTransaction.aggregate([
            {
                $match: {
                    userId: { $in: users.map((row) => row._id) },
                    status: 'completed',
                    type: 'credit',
                    source: { $in: REVENUE_CREDIT_SOURCES },
                    createdAt: { $gte: cohortWeekStartUTC, $lte: snapshotDate },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                },
            },
        ]);

        writes.push(createAppendOnly(CohortAnalyticsWeekly, {
            snapshotDateKey,
            cohortWeekKey,
            cohortWeekStartUTC,
            cohortWeekEndUTC,
            totalUsers: users.length,
            retainedDay1,
            retainedDay7,
            retainedDay30,
            day1RetentionRate: round(safeDivide(retainedDay1, users.length), 4),
            day7RetentionRate: round(safeDivide(retainedDay7, users.length), 4),
            day30RetentionRate: round(safeDivide(retainedDay30, users.length), 4),
            interviewCompletionRate: round(safeDivide(interviewCompletedUsers, users.length), 4),
            revenueTotal: round(Number(revenueAgg?.[0]?.total || 0), 2),
            revenuePerUser: round(safeDivide(Number(revenueAgg?.[0]?.total || 0), users.length), 2),
            computedAt: new Date(),
        }));
    }

    const results = await Promise.all(writes);
    return {
        created: results.filter((row) => row.created).length,
        duplicates: results.filter((row) => row.duplicate).length,
    };
};

const computeWeeklySkillTrends = async ({ snapshotDate }) => {
    const thisWeekStart = startOfUtcWeek(snapshotDate);
    const weekStartUTC = addDays(thisWeekStart, -7);
    const weekEndUTC = thisWeekStart;
    const weekKey = toWeekKey(weekStartUTC);
    const previousWeekKey = toWeekKey(addDays(weekStartUTC, -7));
    const highPayThreshold = Number.parseFloat(process.env.HIGH_PAYING_SKILL_SALARY_THRESHOLD || '50000');

    const [searchEvents, hiredRows, previousRows] = await Promise.all([
        EventEnvelope.find({
            timestampUTC: { $gte: weekStartUTC, $lt: weekEndUTC },
            eventType: { $in: ['SKILL_SEARCH', 'SEARCH_SKILL', 'SKILL_QUERIED', 'JOB_SEARCH'] },
        }).select('metadata').lean(),
        Application.aggregate([
            {
                $match: {
                    status: 'hired',
                    updatedAt: { $gte: weekStartUTC, $lt: weekEndUTC },
                },
            },
            {
                $lookup: {
                    from: Job.collection.name,
                    localField: 'job',
                    foreignField: '_id',
                    as: 'jobDoc',
                },
            },
            { $unwind: { path: '$jobDoc', preserveNullAndEmptyArrays: false } },
            { $unwind: { path: '$jobDoc.requirements', preserveNullAndEmptyArrays: false } },
            {
                $project: {
                    skill: '$jobDoc.requirements',
                    salary: {
                        $cond: [
                            { $gt: [{ $ifNull: ['$jobDoc.maxSalary', 0] }, 0] },
                            {
                                $divide: [
                                    { $add: [{ $ifNull: ['$jobDoc.minSalary', 0] }, { $ifNull: ['$jobDoc.maxSalary', 0] }] },
                                    2,
                                ],
                            },
                            0,
                        ],
                    },
                },
            },
            {
                $group: {
                    _id: '$skill',
                    hiredCount: { $sum: 1 },
                    avgSalary: { $avg: '$salary' },
                },
            },
        ]),
        SkillTrendWeekly.find({ weekKey: previousWeekKey }).select('skill hiredCount').lean(),
    ]);

    const searchedBySkill = new Map();
    searchEvents.forEach((row) => {
        const metadata = row.metadata || {};
        const candidates = [];
        if (Array.isArray(metadata.skills)) {
            metadata.skills.forEach((skill) => candidates.push(skill));
        }
        if (metadata.skill) candidates.push(metadata.skill);
        if (metadata.query && typeof metadata.query === 'string') candidates.push(metadata.query);
        candidates.forEach((candidate) => {
            const normalized = normalizeSkill(candidate);
            if (!normalized) return;
            searchedBySkill.set(normalized, Number(searchedBySkill.get(normalized) || 0) + 1);
        });
    });

    const previousMap = previousRows.reduce((acc, row) => {
        acc[normalizeSkill(row.skill)] = Number(row.hiredCount || 0);
        return acc;
    }, {});

    const hiredMap = new Map();
    const salaryMap = new Map();
    hiredRows.forEach((row) => {
        const normalized = normalizeSkill(row._id);
        if (!normalized) return;
        hiredMap.set(normalized, Number(row.hiredCount || 0));
        salaryMap.set(normalized, Number(row.avgSalary || 0));
    });

    const allSkills = new Set([
        ...Array.from(searchedBySkill.keys()),
        ...Array.from(hiredMap.keys()),
    ]);

    const writes = [];
    allSkills.forEach((skill) => {
        const searchedCount = Number(searchedBySkill.get(skill) || 0);
        const hiredCount = Number(hiredMap.get(skill) || 0);
        const prevCount = Number(previousMap[skill] || 0);
        const growthRateWoW = prevCount > 0 ? safeDivide(hiredCount - prevCount, prevCount) : (hiredCount > 0 ? 1 : 0);
        const averageSalary = round(Number(salaryMap.get(skill) || 0), 2);

        writes.push(createAppendOnly(SkillTrendWeekly, {
            weekKey,
            weekStartUTC,
            weekEndUTC,
            skill,
            searchedCount,
            hiredCount,
            growthRateWoW: round(growthRateWoW, 4),
            averageSalary,
            highPaying: averageSalary >= highPayThreshold,
            computedAt: new Date(),
        }));
    });

    const results = await Promise.all(writes);
    return {
        weekKey,
        created: results.filter((row) => row.created).length,
        duplicates: results.filter((row) => row.duplicate).length,
    };
};

const computeEmployerSegments = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const last30DaysStart = addDays(dayEndUTC, -30);
    const [profiles, jobRows, appRows, churnRows] = await Promise.all([
        EmployerProfile.find({}).select('user industry').lean(),
        Job.aggregate([
            {
                $match: {
                    createdAt: { $gte: last30DaysStart, $lt: dayEndUTC },
                },
            },
            {
                $project: {
                    employerId: '$employerId',
                    budget: {
                        $cond: [
                            { $gt: [{ $ifNull: ['$maxSalary', 0] }, 0] },
                            {
                                $divide: [
                                    { $add: [{ $ifNull: ['$minSalary', 0] }, { $ifNull: ['$maxSalary', 0] }] },
                                    2,
                                ],
                            },
                            0,
                        ],
                    },
                },
            },
            {
                $group: {
                    _id: '$employerId',
                    jobsCount: { $sum: 1 },
                    avgBudget: { $avg: '$budget' },
                },
            },
        ]),
        Application.aggregate([
            {
                $match: {
                    createdAt: { $gte: last30DaysStart, $lt: dayEndUTC },
                },
            },
            {
                $project: {
                    employer: '$employer',
                    status: '$status',
                    responseHours: {
                        $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 1000 * 60 * 60],
                    },
                },
            },
            {
                $group: {
                    _id: '$employer',
                    applicationsCount: { $sum: 1 },
                    hiresCount: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'hired'] }, 1, 0],
                        },
                    },
                    avgResponseHours: { $avg: '$responseHours' },
                },
            },
        ]),
        UserChurnRiskModel.find({ churnRiskLevel: 'HIGH' }).select('userId').lean(),
    ]);

    const profileByEmployer = new Map(profiles.map((row) => [String(row.user), row]));
    const jobsByEmployer = new Map(jobRows.map((row) => [String(row._id), row]));
    const appsByEmployer = new Map(appRows.map((row) => [String(row._id), row]));
    const churnRiskSet = new Set(churnRows.map((row) => String(row.userId)));

    const employerIds = new Set([
        ...Array.from(profileByEmployer.keys()),
        ...Array.from(jobsByEmployer.keys()),
        ...Array.from(appsByEmployer.keys()),
    ]);

    const segmentAccumulator = new Map();
    for (const employerId of employerIds) {
        const profile = profileByEmployer.get(employerId) || {};
        const jobs = jobsByEmployer.get(employerId) || {};
        const apps = appsByEmployer.get(employerId) || {};

        const industry = String(profile.industry || 'unknown').trim().toLowerCase() || 'unknown';
        const jobsCount = Number(jobs.jobsCount || 0);
        const avgBudget = Number(jobs.avgBudget || 0);
        const applicationsCount = Number(apps.applicationsCount || 0);
        const hiresCount = Number(apps.hiresCount || 0);
        const avgResponseHours = Number(apps.avgResponseHours || 0);

        const hiringFrequencyBand = categorizeHiringBand(jobsCount);
        const budgetBand = categorizeBudgetBand(avgBudget);
        const responseSpeedBand = categorizeResponseBand(avgResponseHours);
        const conversionRate = safeDivide(hiresCount, applicationsCount);
        const churnRisk = churnRiskSet.has(employerId) || (jobsCount === 0 && applicationsCount === 0);

        const segmentKey = `${industry}|${hiringFrequencyBand}|${budgetBand}|${responseSpeedBand}`;
        const current = segmentAccumulator.get(segmentKey) || {
            segmentKey,
            industry,
            hiringFrequencyBand,
            budgetBand,
            responseSpeedBand,
            employerCount: 0,
            conversionRateSum: 0,
            churnRiskCount: 0,
        };

        current.employerCount += 1;
        current.conversionRateSum += conversionRate;
        if (churnRisk) current.churnRiskCount += 1;
        segmentAccumulator.set(segmentKey, current);
    }

    const segmentRows = Array.from(segmentAccumulator.values()).map((row) => ({
        segmentKey: row.segmentKey,
        industry: row.industry,
        hiringFrequencyBand: row.hiringFrequencyBand,
        budgetBand: row.budgetBand,
        responseSpeedBand: row.responseSpeedBand,
        employerCount: row.employerCount,
        conversionRate: round(safeDivide(row.conversionRateSum, row.employerCount), 4),
        churnRiskRate: round(safeDivide(row.churnRiskCount, row.employerCount), 4),
    }));

    const highValueSegments = segmentRows
        .filter((row) => row.conversionRate >= 0.2 && row.budgetBand !== 'low' && row.responseSpeedBand !== 'slow')
        .sort((a, b) => b.employerCount - a.employerCount)
        .slice(0, 10);
    const lowConversionSegments = segmentRows
        .filter((row) => row.conversionRate < 0.08)
        .sort((a, b) => b.employerCount - a.employerCount)
        .slice(0, 10);
    const churnRiskSegments = segmentRows
        .filter((row) => row.churnRiskRate > 0.3)
        .sort((a, b) => b.churnRiskRate - a.churnRiskRate)
        .slice(0, 10);

    return createAppendOnly(EmployerSegmentSnapshotDaily, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        segmentRows,
        highValueSegments,
        lowConversionSegments,
        churnRiskSegments,
        computedAt: new Date(),
    });
};

const computeDailyPerformanceMetrics = async ({ dayStartUTC, dayEndUTC, dateKey }) => {
    const [apiAgg, aiSuccessCount, aiFailureCount, queueDepth, dbLatencyAgg] = await Promise.all([
        EventEnvelope.aggregate([
            {
                $match: {
                    eventType: 'API_REQUEST_COMPLETED',
                    timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC },
                },
            },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    avgLatency: { $avg: '$metadata.durationMs' },
                    errors: {
                        $sum: {
                            $cond: [{ $gte: ['$metadata.statusCode', 500] }, 1, 0],
                        },
                    },
                },
            },
        ]),
        EventEnvelope.countDocuments({
            eventType: 'AI_CALL_SUCCESS',
            timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        EventEnvelope.countDocuments({
            eventType: 'AI_CALL_FAILURE',
            timestampUTC: { $gte: dayStartUTC, $lt: dayEndUTC },
        }),
        getQueueDepth().catch(() => ({})),
        SystemHealth.aggregate([
            {
                $match: {
                    lastCheckedAt: { $gte: dayStartUTC, $lt: dayEndUTC },
                    serviceName: { $in: ['db', 'database', 'mongo'] },
                },
            },
            {
                $group: {
                    _id: null,
                    avgLatency: { $avg: '$latency' },
                },
            },
        ]),
    ]);

    const queueBacklog = Object.values(queueDepth || {}).reduce((acc, value) => acc + Number(value || 0), 0);
    const apiTotal = Number(apiAgg?.[0]?.total || 0);
    const apiErrors = Number(apiAgg?.[0]?.errors || 0);
    const aiTotal = Number(aiSuccessCount || 0) + Number(aiFailureCount || 0);

    return createAppendOnly(DailyPerformanceMetrics, {
        dateKey,
        dayStartUTC,
        dayEndUTC,
        avgApiLatencyMs: round(Number(apiAgg?.[0]?.avgLatency || 0), 2),
        errorRate: round(safeDivide(apiErrors, apiTotal), 4),
        aiCallSuccessRate: round(safeDivide(aiSuccessCount, aiTotal), 4),
        queueBacklog: Math.max(0, Number(queueBacklog || 0)),
        dbQueryLatencyMs: round(Number(dbLatencyAgg?.[0]?.avgLatency || 0), 2),
        computedAt: new Date(),
    });
};

const runStrategicAnalyticsDaily = async ({ day = addDays(new Date(), -1), source = 'scheduler', force = false } = {}) => {
    const { dayStartUTC, dayEndUTC, dateKey } = toUtcDayWindow(day);
    const jobName = 'strategic_analytics_daily';
    const claim = await claimAggregationRun({
        jobName,
        windowKey: dateKey,
        source,
        force,
    });

    if (!claim.acquired) {
        return {
            skipped: true,
            dateKey,
            reason: claim.reason || 'not_acquired',
        };
    }

    const details = {
        dateKey,
        startedAt: new Date().toISOString(),
        writes: {},
    };

    try {
        const [
            userMetrics,
            jobMetrics,
            financialMetrics,
            engagementMetrics,
            trustMetrics,
            regionMetrics,
            funnelMetrics,
            cohortMetrics,
            skillMetrics,
            employerSegments,
            performanceMetrics,
        ] = await Promise.all([
            computeDailyUserMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyJobMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyFinancialMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyEngagementMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyTrustMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyRegionMetrics({ dayStartUTC, dayEndUTC, dateKey }),
            computeFunnelAnalyticsDaily({ dayStartUTC, dayEndUTC, dateKey }),
            computeWeeklyCohortAnalytics({ snapshotDateKey: dateKey, snapshotDate: dayEndUTC }),
            computeWeeklySkillTrends({ snapshotDate: dayEndUTC }),
            computeEmployerSegments({ dayStartUTC, dayEndUTC, dateKey }),
            computeDailyPerformanceMetrics({ dayStartUTC, dayEndUTC, dateKey }),
        ]);

        details.writes = {
            dailyUserMetrics: userMetrics,
            dailyJobMetrics: jobMetrics,
            dailyFinancialMetrics: financialMetrics,
            dailyEngagementMetrics: engagementMetrics,
            dailyTrustMetrics: trustMetrics,
            dailyRegionMetrics: regionMetrics,
            funnelAnalyticsDaily: funnelMetrics,
            cohortAnalyticsWeekly: cohortMetrics,
            skillTrendWeekly: skillMetrics,
            employerSegmentSnapshotDaily: employerSegments,
            dailyPerformanceMetrics: performanceMetrics,
        };

        const insights = await generateDeterministicInsights({ dateKey });
        details.writes.insights = insights;
        details.completedAt = new Date().toISOString();

        await completeAggregationRun({
            jobName,
            windowKey: dateKey,
            runToken: claim.runToken,
            details,
        });

        return {
            skipped: false,
            dateKey,
            details,
        };
    } catch (error) {
        await failAggregationRun({
            jobName,
            windowKey: dateKey,
            runToken: claim.runToken,
            error,
        });
        throw error;
    }
};

const getLatestStrategicDashboard = async () => {
    const [growth, engagement, revenue, trust, operations, insights] = await Promise.all([
        DailyUserMetrics.findOne({}).sort({ dateKey: -1 }).lean(),
        DailyEngagementMetrics.findOne({}).sort({ dateKey: -1 }).lean(),
        DailyFinancialMetrics.findOne({}).sort({ dateKey: -1 }).lean(),
        DailyTrustMetrics.findOne({}).sort({ dateKey: -1 }).lean(),
        DailyPerformanceMetrics.findOne({}).sort({ dateKey: -1 }).lean(),
        getLatestInsights({ limit: 20 }),
    ]);

    const regionDateKey = growth?.dateKey || engagement?.dateKey || revenue?.dateKey || trust?.dateKey || operations?.dateKey || null;
    const regionRows = regionDateKey
        ? await DailyRegionMetrics.find({ dateKey: regionDateKey })
            .sort({ revenuePerActiveUser: -1, conversionRate: -1 })
            .limit(20)
            .lean()
        : [];

    return {
        asOfDateKey: regionDateKey,
        sections: {
            growth: growth || {},
            engagement: engagement || {},
            revenue: revenue || {},
            trust: trust || {},
            operations: operations || {},
        },
        topRegions: regionRows,
        insights,
    };
};

module.exports = {
    runStrategicAnalyticsDaily,
    getLatestStrategicDashboard,
    toUtcDayWindow,
};
