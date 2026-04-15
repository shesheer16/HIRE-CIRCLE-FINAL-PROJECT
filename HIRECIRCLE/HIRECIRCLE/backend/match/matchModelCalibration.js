const MatchPerformanceMetric = require('../models/MatchPerformanceMetric');
const MatchModel = require('../models/MatchModel');
const MatchModelCalibration = require('../models/MatchModelCalibration');

const DEFAULT_THRESHOLDS = {
    strongMin: 0.85,
    goodMin: 0.70,
    possibleMin: 0.62,
};

const ratio = (num, den) => (den > 0 ? num / den : 0);
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const buildRange = ({ from, to, defaultDays = 60 }) => {
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

const bucketForProbability = (value) => {
    const probability = clamp01(value);
    if (probability >= 0.85) return '>=0.85';
    if (probability >= 0.70) return '0.70-0.84';
    if (probability >= 0.62) return '0.62-0.69';
    return null;
};

const getActiveModelVersion = async () => {
    const override = String(process.env.MATCH_MODEL_VERSION_ACTIVE || '').trim();
    if (override) return override;

    const activeModel = await MatchModel.findOne({ isActive: true })
        .sort({ trainedAt: -1 })
        .select('modelVersion')
        .lean();

    return activeModel?.modelVersion || null;
};

const summarizeBuckets = (rows) => {
    const buckets = {
        '>=0.85': { apps: 0, shortlists: 0, hires: 0, probabilitySum: 0, probabilityCount: 0 },
        '0.70-0.84': { apps: 0, shortlists: 0, hires: 0, probabilitySum: 0, probabilityCount: 0 },
        '0.62-0.69': { apps: 0, shortlists: 0, hires: 0, probabilitySum: 0, probabilityCount: 0 },
    };

    rows.forEach((row) => {
        const bucketKey = bucketForProbability(row.matchProbability);
        if (!bucketKey || !buckets[bucketKey]) return;
        const bucket = buckets[bucketKey];

        if (row.eventName === 'APPLICATION_CREATED') bucket.apps += 1;
        if (row.eventName === 'APPLICATION_SHORTLISTED') bucket.shortlists += 1;
        if (row.eventName === 'APPLICATION_HIRED') bucket.hires += 1;

        if (Number.isFinite(Number(row.matchProbability))) {
            bucket.probabilitySum += Number(row.matchProbability);
            bucket.probabilityCount += 1;
        }
    });

    return buckets;
};

const computeCalibrationDiagnostics = (buckets) => {
    const toStats = (bucket) => {
        const avgPredicted = ratio(bucket.probabilitySum, bucket.probabilityCount);
        const observedHireRate = ratio(bucket.hires, bucket.apps);
        return {
            apps: bucket.apps,
            shortlists: bucket.shortlists,
            hires: bucket.hires,
            avgPredicted,
            observedHireRate,
            shortlistRate: ratio(bucket.shortlists, bucket.apps),
            hireRate: observedHireRate,
            absCalibrationError: Math.abs(avgPredicted - observedHireRate),
        };
    };

    const strong = toStats(buckets['>=0.85']);
    const good = toStats(buckets['0.70-0.84']);
    const possible = toStats(buckets['0.62-0.69']);

    const weightedCalibrationError = ratio(
        (strong.absCalibrationError * strong.apps)
        + (good.absCalibrationError * good.apps)
        + (possible.absCalibrationError * possible.apps),
        strong.apps + good.apps + possible.apps
    );

    const baselineHireRate = Math.max(possible.hireRate, 0.0001);
    const lift = {
        strongVsPossible: strong.hireRate / baselineHireRate,
        goodVsPossible: good.hireRate / baselineHireRate,
    };

    return {
        buckets: {
            '>=0.85': strong,
            '0.70-0.84': good,
            '0.62-0.69': possible,
        },
        weightedCalibrationError,
        lift,
    };
};

const suggestThresholds = (diagnostics) => {
    const suggestions = [];
    const thresholds = { ...DEFAULT_THRESHOLDS };

    const desiredStrongHireRate = Number.parseFloat(process.env.MATCH_CALIBRATION_STRONG_HIRE_RATE_MIN || '0.20');
    const possibleNoiseMaxHireRate = Number.parseFloat(process.env.MATCH_CALIBRATION_POSSIBLE_HIRE_RATE_MIN || '0.06');
    const driftThreshold = Number.parseFloat(process.env.MATCH_CALIBRATION_DRIFT_MAX || '0.12');

    const strong = diagnostics.buckets['>=0.85'];
    const possible = diagnostics.buckets['0.62-0.69'];

    const strongUnderPerforming = strong.apps >= 20 && strong.hireRate < desiredStrongHireRate;
    const possibleTooNoisy = possible.apps >= 30 && possible.hireRate < possibleNoiseMaxHireRate;
    const calibrationDrift = diagnostics.weightedCalibrationError > driftThreshold;

    if (strongUnderPerforming) {
        thresholds.strongMin = Math.min(0.92, Number((thresholds.strongMin + 0.02).toFixed(2)));
        suggestions.push(
            `STRONG tier hire-rate (${strong.hireRate.toFixed(3)}) is below target (${desiredStrongHireRate.toFixed(3)}). Tighten STRONG threshold.`
        );
    }

    if (possibleTooNoisy) {
        thresholds.possibleMin = Math.min(0.68, Number((thresholds.possibleMin + 0.03).toFixed(2)));
        suggestions.push(
            `POSSIBLE tier is noisy (hire-rate ${possible.hireRate.toFixed(3)} on ${possible.apps} apps). Raise POSSIBLE floor.`
        );
    }

    if (calibrationDrift) {
        thresholds.goodMin = Math.min(0.76, Number((thresholds.goodMin + 0.01).toFixed(2)));
        suggestions.push(
            `Calibration drift detected (weighted error ${diagnostics.weightedCalibrationError.toFixed(3)}). Narrow GOOD tier and schedule retrain.`
        );
    }

    if (thresholds.possibleMin >= thresholds.goodMin) {
        thresholds.possibleMin = Number((thresholds.goodMin - 0.02).toFixed(2));
    }
    if (thresholds.goodMin >= thresholds.strongMin) {
        thresholds.goodMin = Number((thresholds.strongMin - 0.02).toFixed(2));
    }

    return {
        suggestedThresholds: thresholds,
        suggestions,
        driftDetected: calibrationDrift,
        requiresRetrain: calibrationDrift || strongUnderPerforming,
    };
};

const computeCalibrationSuggestion = async ({
    city = null,
    roleCluster = null,
    from = null,
    to = null,
}) => {
    const range = buildRange({ from, to, defaultDays: 60 });
    const query = buildQuery({
        city: city || null,
        roleCluster: roleCluster || null,
        from: range.from,
        to: range.to,
    });

    const rows = await MatchPerformanceMetric.find(query)
        .select('eventName matchProbability timestamp')
        .lean();

    const buckets = summarizeBuckets(rows);
    const diagnostics = computeCalibrationDiagnostics(buckets);
    const thresholdSuggestion = suggestThresholds(diagnostics);
    const modelVersion = await getActiveModelVersion();

    return {
        modelVersion,
        city: city || '*',
        roleCluster: roleCluster || '*',
        evaluatedFrom: range.from,
        evaluatedTo: range.to,
        currentThresholds: { ...DEFAULT_THRESHOLDS },
        suggestedThresholds: thresholdSuggestion.suggestedThresholds,
        diagnostics: {
            ...diagnostics,
            sampleSize: rows.length,
        },
        suggestions: thresholdSuggestion.suggestions,
        driftDetected: thresholdSuggestion.driftDetected,
        requiresRetrain: thresholdSuggestion.requiresRetrain,
    };
};

const persistCalibrationSuggestion = async (payload) => {
    return MatchModelCalibration.create({
        ...payload,
        status: 'suggested',
        createdBy: 'system',
    });
};

const getAndPersistCalibrationSuggestion = async (params = {}) => {
    const suggestion = await computeCalibrationSuggestion(params);
    const persisted = await persistCalibrationSuggestion(suggestion);
    return { suggestion, persisted };
};

module.exports = {
    DEFAULT_THRESHOLDS,
    computeCalibrationSuggestion,
    persistCalibrationSuggestion,
    getAndPersistCalibrationSuggestion,
};
