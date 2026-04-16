const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchLog = require('../models/MatchLog');
const Job = require('../models/Job');
const Application = require('../models/Application');
const { getMatchQualityTargets } = require('../config/matchQualityTargets');

const TRACKED_EVENTS = new Set([
    'MATCH_RECOMMENDATION_VIEWED',
    'MATCH_DETAIL_VIEWED',
    'APPLICATION_CREATED',
    'APPLICATION_SHORTLISTED',
    'APPLICATION_INTERVIEWED',
    'APPLICATION_HIRED',
    'OFFER_EXTENDED',
    'OFFER_ACCEPTED',
    'WORKER_JOINED',
    'JOB_FILL_COMPLETED',
]);

const clamp01 = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
};

const normalizeText = (value, fallback) => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const normalizeTier = (tier, probability) => {
    const fromPayload = String(tier || '').trim().toUpperCase();
    if (['STRONG', 'GOOD', 'POSSIBLE', 'REJECT'].includes(fromPayload)) {
        return fromPayload;
    }

    if (!Number.isFinite(probability)) return 'UNKNOWN';
    if (probability >= 0.85) return 'STRONG';
    if (probability >= 0.70) return 'GOOD';
    if (probability >= 0.62) return 'POSSIBLE';
    return 'REJECT';
};

const buildRange = ({ from, to, defaultDays = 30 }) => {
    const toDate = to ? new Date(to) : new Date();
    const safeTo = Number.isNaN(toDate.getTime()) ? new Date() : toDate;

    const fromDate = from
        ? new Date(from)
        : new Date(safeTo.getTime() - defaultDays * 24 * 60 * 60 * 1000);
    const safeFrom = Number.isNaN(fromDate.getTime())
        ? new Date(safeTo.getTime() - defaultDays * 24 * 60 * 60 * 1000)
        : fromDate;

    return { from: safeFrom, to: safeTo };
};

const buildQuery = ({ city, roleCluster, from, to }) => {
    const query = {
        timestamp: { $gte: from, $lte: to },
    };

    if (city) {
        query.city = new RegExp(`^${String(city).trim()}$`, 'i');
    }

    if (roleCluster) {
        query.roleCluster = new RegExp(`^${String(roleCluster).trim()}$`, 'i');
    }

    return query;
};

const resolveFromMatchLog = async ({ jobId, workerId }) => {
    if (!jobId || !workerId) {
        return {
            matchProbability: null,
            matchTier: 'UNKNOWN',
            modelVersionUsed: null,
        };
    }

    const latestLog = await MatchLog.findOne({ jobId, workerId })
        .sort({ createdAt: -1 })
        .select('finalScore tier matchModelVersionUsed')
        .lean();

    const probability = clamp01(latestLog?.finalScore);
    return {
        matchProbability: probability,
        matchTier: normalizeTier(latestLog?.tier, probability),
        modelVersionUsed: latestLog?.matchModelVersionUsed || null,
    };
};

const resolveContextFromJob = async ({ jobId, city, roleCluster }) => {
    const resolved = {
        city: normalizeText(city, 'unknown'),
        roleCluster: normalizeText(roleCluster, 'general'),
    };

    if (jobId && (!city || !roleCluster)) {
        const job = await Job.findById(jobId).select('location title').lean();
        if (job) {
            if (!city) resolved.city = normalizeText(job.location, 'unknown');
            if (!roleCluster) resolved.roleCluster = normalizeText(job.title, 'general');
        }
    }

    return resolved;
};

const resolveMatchSignals = async ({
    jobId = null,
    workerId = null,
    applicationId = null,
    matchProbability = null,
    matchTier = null,
    modelVersionUsed = null,
}) => {
    let resolvedJobId = jobId;
    let resolvedWorkerId = workerId;

    if ((!resolvedJobId || !resolvedWorkerId) && applicationId) {
        const app = await Application.findById(applicationId).select('job worker').lean();
        if (app) {
            resolvedJobId = resolvedJobId || app.job;
            resolvedWorkerId = resolvedWorkerId || app.worker;
        }
    }

    const probability = clamp01(matchProbability);
    if (Number.isFinite(probability)) {
        return {
            jobId: resolvedJobId,
            workerId: resolvedWorkerId,
            matchProbability: probability,
            matchTier: normalizeTier(matchTier, probability),
            modelVersionUsed: modelVersionUsed || null,
        };
    }

    const fromLog = await resolveFromMatchLog({
        jobId: resolvedJobId,
        workerId: resolvedWorkerId,
    });

    return {
        jobId: resolvedJobId,
        workerId: resolvedWorkerId,
        matchProbability: fromLog.matchProbability,
        matchTier: normalizeTier(matchTier || fromLog.matchTier, fromLog.matchProbability),
        modelVersionUsed: modelVersionUsed || fromLog.modelVersionUsed || null,
    };
};

const recordMatchPerformanceMetric = async ({
    eventName,
    jobId = null,
    workerId = null,
    applicationId = null,
    city = null,
    roleCluster = null,
    matchProbability = null,
    matchTier = null,
    modelVersionUsed = null,
    timestamp = new Date(),
    metadata = {},
}) => {
    if (!TRACKED_EVENTS.has(String(eventName || '').trim())) {
        return null;
    }

    const safeTimestamp = timestamp ? new Date(timestamp) : new Date();
    const resolvedTimestamp = Number.isNaN(safeTimestamp.getTime()) ? new Date() : safeTimestamp;

    const resolvedSignals = await resolveMatchSignals({
        jobId,
        workerId,
        applicationId,
        matchProbability,
        matchTier,
        modelVersionUsed,
    });

    const context = await resolveContextFromJob({
        jobId: resolvedSignals.jobId,
        city,
        roleCluster,
    });

    return MatchPerformanceMetric.create({
        eventName,
        jobId: resolvedSignals.jobId || null,
        workerId: resolvedSignals.workerId || null,
        applicationId: applicationId || null,
        city: context.city,
        roleCluster: context.roleCluster,
        matchProbability: resolvedSignals.matchProbability,
        matchTier: resolvedSignals.matchTier,
        modelVersionUsed: resolvedSignals.modelVersionUsed,
        timestamp: resolvedTimestamp,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
    });
};

const recordJobFillCompletedOnce = async ({
    jobId,
    workerId = null,
    city = null,
    roleCluster = null,
    metadata = {},
}) => {
    if (!jobId) return { created: false, reason: 'MISSING_JOB_ID' };

    const existing = await MatchPerformanceMetric.findOne({
        eventName: 'JOB_FILL_COMPLETED',
        jobId,
    })
        .select('_id')
        .lean();

    if (existing) {
        return { created: false, reason: 'ALREADY_RECORDED' };
    }

    await recordMatchPerformanceMetric({
        eventName: 'JOB_FILL_COMPLETED',
        jobId,
        workerId,
        city,
        roleCluster,
        metadata,
    });

    return { created: true };
};

const recordFromAnalyticsEvent = async ({ eventName, userId = null, metadata = {} }) => {
    if (!TRACKED_EVENTS.has(String(eventName || '').trim())) {
        return null;
    }

    return recordMatchPerformanceMetric({
        eventName,
        jobId: metadata.jobId || metadata.job?._id || null,
        workerId: metadata.workerId || null,
        applicationId: metadata.applicationId || null,
        city: metadata.city || null,
        roleCluster: metadata.roleCluster || null,
        matchProbability: metadata.matchProbability ?? metadata.finalScore ?? null,
        matchTier: metadata.matchTier || metadata.tier || null,
        modelVersionUsed: metadata.matchModelVersionUsed || null,
        timestamp: metadata.timestamp || Date.now(),
        metadata: {
            source: 'analytics_track',
            userId: userId ? String(userId) : null,
            ...metadata,
        },
    });
};

const ratio = (num, den) => (den > 0 ? num / den : 0);

const getFunnelCounters = (rows = []) => {
    const counters = {
        matchesServed: 0,
        applications: 0,
        shortlists: 0,
        explicitInterviews: 0,
        hires: 0,
        offersExtended: 0,
        offersAccepted: 0,
    };

    rows.forEach((row) => {
        if (row.eventName === 'MATCH_RECOMMENDATION_VIEWED') counters.matchesServed += 1;
        if (row.eventName === 'APPLICATION_CREATED') counters.applications += 1;
        if (row.eventName === 'APPLICATION_SHORTLISTED') counters.shortlists += 1;
        if (row.eventName === 'APPLICATION_INTERVIEWED') counters.explicitInterviews += 1;
        if (row.eventName === 'APPLICATION_HIRED') counters.hires += 1;
        if (row.eventName === 'OFFER_EXTENDED') counters.offersExtended += 1;
        if (row.eventName === 'OFFER_ACCEPTED') counters.offersAccepted += 1;
    });

    return counters;
};

const summarizeFunnelWithTargets = (rows = [], targets = {}) => {
    const counters = getFunnelCounters(rows);

    const interviewCount = counters.explicitInterviews > 0
        ? counters.explicitInterviews
        : counters.shortlists;

    const offerDenominator = counters.offersExtended > 0
        ? counters.offersExtended
        : counters.hires > 0
            ? counters.hires
            : counters.shortlists;

    const offerNumerator = counters.offersAccepted > 0
        ? counters.offersAccepted
        : counters.hires > 0
            ? counters.hires
            : 0;

    return {
        counters: {
            ...counters,
            interviewCount,
            offerDenominator,
            offerNumerator,
        },
        sources: {
            interviewRateSource: counters.explicitInterviews > 0 ? 'APPLICATION_INTERVIEWED' : 'APPLICATION_SHORTLISTED_PROXY',
            offerAcceptanceSource: counters.offersExtended > 0
                ? 'OFFER_ACCEPTED_OVER_OFFER_EXTENDED'
                : counters.hires > 0
                    ? 'APPLICATION_HIRED_PROXY'
                    : 'NO_SIGNAL',
        },
        rates: {
            interviewRate: ratio(interviewCount, counters.matchesServed),
            postInterviewHireRate: ratio(counters.hires, interviewCount),
            offerAcceptanceRate: ratio(offerNumerator, offerDenominator),
        },
        targets: {
            interviewRateTarget: targets.interviewRateTarget,
            postInterviewHireRateTarget: targets.postInterviewHireRateTarget,
            offerAcceptanceTarget: targets.offerAcceptanceTarget,
        },
    };
};

const buildDailyTrend = (rows = [], { from, to }) => {
    const days = {};
    const current = new Date(from);
    while (current <= to) {
        const key = current.toISOString().slice(0, 10);
        days[key] = [];
        current.setUTCDate(current.getUTCDate() + 1);
    }

    rows.forEach((row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        if (!days[day]) days[day] = [];
        days[day].push(row);
    });

    return Object.entries(days)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, dayRows]) => {
            const summary = summarizeFunnelWithTargets(dayRows, {
                interviewRateTarget: 0,
                postInterviewHireRateTarget: 0,
                offerAcceptanceTarget: 0,
            });

            return {
                date,
                interviewRate: summary.rates.interviewRate,
                postInterviewHireRate: summary.rates.postInterviewHireRate,
                offerAcceptanceRate: summary.rates.offerAcceptanceRate,
                matchesServed: summary.counters.matchesServed,
                interviewCount: summary.counters.interviewCount,
                hires: summary.counters.hires,
                offersExtended: summary.counters.offerDenominator,
                offersAccepted: summary.counters.offerNumerator,
            };
        });
};

const buildPerformanceAlerts = ({
    summary,
    targets,
    minimumSampleSize,
}) => {
    const alerts = [];
    const metrics = [
        {
            key: 'interviewRate',
            label: 'Interview Rate',
            current: summary.rates.interviewRate,
            target: targets.interviewRateTarget,
            denominator: summary.counters.matchesServed,
        },
        {
            key: 'postInterviewHireRate',
            label: 'Post-Interview Hire Rate',
            current: summary.rates.postInterviewHireRate,
            target: targets.postInterviewHireRateTarget,
            denominator: summary.counters.interviewCount,
        },
        {
            key: 'offerAcceptanceRate',
            label: 'Offer Acceptance Rate',
            current: summary.rates.offerAcceptanceRate,
            target: targets.offerAcceptanceTarget,
            denominator: summary.counters.offerDenominator,
        },
    ];

    metrics.forEach((metric) => {
        const denominator = Number(metric.denominator || 0);
        if (denominator < minimumSampleSize) return;
        if (metric.current >= metric.target) return;

        const gap = metric.target - metric.current;
        alerts.push({
            metric: metric.key,
            label: metric.label,
            current: metric.current,
            target: metric.target,
            denominator,
            gap,
            severity: gap >= 0.10 ? 'high' : gap >= 0.05 ? 'medium' : 'low',
            breached: true,
        });
    });

    return alerts;
};

const BUCKETS = [
    { key: '>=0.85', min: 0.85, max: 1.000001 },
    { key: '0.70-0.84', min: 0.70, max: 0.85 },
    { key: '0.62-0.69', min: 0.62, max: 0.70 },
];

const toBucketKey = (probability) => {
    const value = clamp01(probability);
    if (!Number.isFinite(value)) return null;
    const bucket = BUCKETS.find((item) => value >= item.min && value < item.max);
    return bucket?.key || null;
};

const summarizeOverview = (rows = []) => {
    const totalMatchesServed = rows.filter((row) => row.eventName === 'MATCH_RECOMMENDATION_VIEWED').length;
    const probabilities = rows
        .filter((row) => row.eventName === 'MATCH_RECOMMENDATION_VIEWED')
        .map((row) => clamp01(row.matchProbability))
        .filter((value) => Number.isFinite(value));

    const applications = rows.filter((row) => row.eventName === 'APPLICATION_CREATED').length;
    const shortlists = rows.filter((row) => row.eventName === 'APPLICATION_SHORTLISTED').length;
    const hires = rows.filter((row) => row.eventName === 'APPLICATION_HIRED').length;
    const retained = rows.filter((row) => row.eventName === 'WORKER_JOINED').length;

    return {
        totalMatchesServed,
        avgMatchProbability: probabilities.length
            ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length
            : 0,
        applicationRate: ratio(applications, totalMatchesServed),
        shortlistRate: ratio(shortlists, applications),
        hireRate: ratio(hires, applications),
        retention30dRate: ratio(retained, hires),
    };
};

const summarizeDetail = (rows = []) => {
    const buckets = BUCKETS.reduce((acc, bucket) => ({
        ...acc,
        [bucket.key]: { apps: 0, shortlists: 0, hires: 0 },
    }), {});

    rows.forEach((row) => {
        const bucketKey = toBucketKey(row.matchProbability);
        if (!bucketKey || !buckets[bucketKey]) return;

        if (row.eventName === 'APPLICATION_CREATED') buckets[bucketKey].apps += 1;
        if (row.eventName === 'APPLICATION_SHORTLISTED') buckets[bucketKey].shortlists += 1;
        if (row.eventName === 'APPLICATION_HIRED') buckets[bucketKey].hires += 1;
    });

    const conversionRates = Object.entries(buckets).reduce((acc, [bucketKey, values]) => ({
        ...acc,
        [bucketKey]: {
            shortlistPerApplication: ratio(values.shortlists, values.apps),
            hirePerApplication: ratio(values.hires, values.apps),
            hirePerShortlist: ratio(values.hires, values.shortlists),
        },
    }), {});

    const cohortMap = rows.reduce((acc, row) => {
        const day = new Date(row.timestamp).toISOString().slice(0, 10);
        if (!acc[day]) {
            acc[day] = {
                matchesServed: 0,
                applications: 0,
                shortlists: 0,
                hires: 0,
            };
        }

        if (row.eventName === 'MATCH_RECOMMENDATION_VIEWED') acc[day].matchesServed += 1;
        if (row.eventName === 'APPLICATION_CREATED') acc[day].applications += 1;
        if (row.eventName === 'APPLICATION_SHORTLISTED') acc[day].shortlists += 1;
        if (row.eventName === 'APPLICATION_HIRED') acc[day].hires += 1;

        return acc;
    }, {});

    const cohortMetrics = Object.entries(cohortMap)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, values]) => ({
            date,
            ...values,
            applicationRate: ratio(values.applications, values.matchesServed),
            shortlistRate: ratio(values.shortlists, values.applications),
            hireRate: ratio(values.hires, values.applications),
        }));

    return {
        matchProbabilityBuckets: buckets,
        conversionRates,
        cohortMetrics,
    };
};

const getMatchQualityAnalytics = async ({
    city = null,
    roleCluster = null,
    from = null,
    to = null,
    defaultDays = 30,
}) => {
    const range = buildRange({ from, to, defaultDays });
    const query = buildQuery({
        city: city || null,
        roleCluster: roleCluster || null,
        from: range.from,
        to: range.to,
    });

    const rows = await MatchPerformanceMetric.find(query)
        .select('eventName matchProbability matchTier city roleCluster timestamp')
        .lean();

    return {
        from: range.from,
        to: range.to,
        overview: summarizeOverview(rows),
        detail: summarizeDetail(rows),
    };
};

const getMatchPerformanceAlerts = async ({
    city = null,
    roleCluster = null,
    from = null,
    to = null,
    defaultDays = null,
} = {}) => {
    const targets = getMatchQualityTargets();
    const windowDays = Number.isFinite(defaultDays) ? defaultDays : targets.rollingWindowDays;
    const range = buildRange({ from, to, defaultDays: windowDays });
    const query = buildQuery({
        city: city || null,
        roleCluster: roleCluster || null,
        from: range.from,
        to: range.to,
    });

    const rows = await MatchPerformanceMetric.find(query)
        .select('eventName timestamp')
        .lean();

    const summary = summarizeFunnelWithTargets(rows, targets);
    const alerts = buildPerformanceAlerts({
        summary,
        targets: summary.targets,
        minimumSampleSize: Math.max(1, Number(targets.minimumSampleSize || 1)),
    });

    return {
        from: range.from,
        to: range.to,
        targets: summary.targets,
        metrics: {
            ...summary.rates,
            counts: summary.counters,
            sources: summary.sources,
        },
        alerts,
        breached: alerts.length > 0,
        trends: buildDailyTrend(rows, range),
    };
};

module.exports = {
    TRACKED_EVENTS,
    toBucketKey,
    recordMatchPerformanceMetric,
    recordJobFillCompletedOnce,
    recordFromAnalyticsEvent,
    getMatchQualityAnalytics,
    getMatchPerformanceAlerts,
};
