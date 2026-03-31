const AdaptiveMatchWeightProfile = require('../models/AdaptiveMatchWeightProfile');
const Job = require('../models/Job');
const MatchOutcomeModel = require('../models/MatchOutcomeModel');
const mongoose = require('mongoose');

const DEFAULT_ADAPTIVE_WEIGHTS = {
    skillWeight: 0.4,
    experienceWeight: 0.25,
    salaryToleranceWeight: 0.2,
    commuteToleranceWeight: 0.15,
};

const WEIGHT_BOUNDS = {
    skillWeight: { min: 0.22, max: 0.55 },
    experienceWeight: { min: 0.15, max: 0.38 },
    salaryToleranceWeight: { min: 0.08, max: 0.35 },
    commuteToleranceWeight: { min: 0.07, max: 0.3 },
};

const LEARNING_RATE = 0.03;
const MAX_DELTA_PER_UPDATE = 0.015;
const FULL_CONFIDENCE_SAMPLE_SIZE = 80;

const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const clamp01 = (value) => clamp(value, 0, 1);

const normalizeText = (value, fallback = 'global') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
};

const normalizeWeights = (weights = DEFAULT_ADAPTIVE_WEIGHTS) => {
    const total = Object.values(weights)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
        .reduce((sum, value) => sum + value, 0);

    if (total <= 0) {
        return {
            ...DEFAULT_ADAPTIVE_WEIGHTS,
        };
    }

    const normalized = {
        skillWeight: Number((Number(weights.skillWeight || 0) / total).toFixed(6)),
        experienceWeight: Number((Number(weights.experienceWeight || 0) / total).toFixed(6)),
        salaryToleranceWeight: Number((Number(weights.salaryToleranceWeight || 0) / total).toFixed(6)),
        commuteToleranceWeight: Number((Number(weights.commuteToleranceWeight || 0) / total).toFixed(6)),
    };

    const correctedTotal = Object.values(normalized).reduce((sum, value) => sum + value, 0);
    if (Math.abs(correctedTotal - 1) > 0.000001) {
        normalized.skillWeight = Number((normalized.skillWeight + (1 - correctedTotal)).toFixed(6));
    }

    return normalized;
};

const applyBounds = (weights = DEFAULT_ADAPTIVE_WEIGHTS) => {
    const bounded = {
        skillWeight: clamp(weights.skillWeight, WEIGHT_BOUNDS.skillWeight.min, WEIGHT_BOUNDS.skillWeight.max),
        experienceWeight: clamp(weights.experienceWeight, WEIGHT_BOUNDS.experienceWeight.min, WEIGHT_BOUNDS.experienceWeight.max),
        salaryToleranceWeight: clamp(weights.salaryToleranceWeight, WEIGHT_BOUNDS.salaryToleranceWeight.min, WEIGHT_BOUNDS.salaryToleranceWeight.max),
        commuteToleranceWeight: clamp(weights.commuteToleranceWeight, WEIGHT_BOUNDS.commuteToleranceWeight.min, WEIGHT_BOUNDS.commuteToleranceWeight.max),
    };

    const normalized = normalizeWeights(bounded);

    return {
        skillWeight: clamp(normalized.skillWeight, WEIGHT_BOUNDS.skillWeight.min, WEIGHT_BOUNDS.skillWeight.max),
        experienceWeight: clamp(normalized.experienceWeight, WEIGHT_BOUNDS.experienceWeight.min, WEIGHT_BOUNDS.experienceWeight.max),
        salaryToleranceWeight: clamp(normalized.salaryToleranceWeight, WEIGHT_BOUNDS.salaryToleranceWeight.min, WEIGHT_BOUNDS.salaryToleranceWeight.max),
        commuteToleranceWeight: clamp(normalized.commuteToleranceWeight, WEIGHT_BOUNDS.commuteToleranceWeight.min, WEIGHT_BOUNDS.commuteToleranceWeight.max),
    };
};

const isFiniteWeightSet = (weights = {}) => Object.values(weights).every((value) => Number.isFinite(Number(value)));

const resolveScopeKey = ({ city = null, roleCluster = null } = {}) => {
    const normalizedCity = normalizeText(city, 'global');
    const normalizedRole = normalizeText(roleCluster, 'general');

    if (normalizedCity === 'global' && normalizedRole === 'general') {
        return {
            scopeType: 'global',
            scopeKey: 'global',
        };
    }

    return {
        scopeType: 'city_role',
        scopeKey: `${normalizedCity}::${normalizedRole}`,
    };
};

const hasDatabaseConnection = () => {
    const state = Number(mongoose?.connection?.readyState || 0);
    return state === 1;
};

const getOrCreateWeightProfile = async ({ scopeType = 'global', scopeKey = 'global' } = {}) => {
    if (!hasDatabaseConnection()) {
        return {
            scopeType,
            scopeKey,
            ...DEFAULT_ADAPTIVE_WEIGHTS,
            sampleSize: 0,
            updateCount: 0,
            guardrails: {
                minWeight: 0.05,
                maxWeight: 0.6,
                maxDeltaPerUpdate: MAX_DELTA_PER_UPDATE,
                antiBiasDamping: 1,
            },
        };
    }

    let profile = await AdaptiveMatchWeightProfile.findOne({ scopeKey }).lean();
    if (profile) return profile;

    const created = await AdaptiveMatchWeightProfile.create({
        scopeType,
        scopeKey,
        ...DEFAULT_ADAPTIVE_WEIGHTS,
        sampleSize: 0,
        updateCount: 0,
        guardrails: {
            minWeight: 0.05,
            maxWeight: 0.6,
            maxDeltaPerUpdate: MAX_DELTA_PER_UPDATE,
            antiBiasDamping: 1,
        },
    });

    profile = created.toObject();
    return profile;
};

const resolveOutcomeSignal = ({ hired = false, rejected = false }) => {
    if (hired && !rejected) return 1;
    if (!hired && rejected) return -1;
    if (hired && rejected) return 0;
    return -0.35;
};

const resolveFeedbackSignal = ({ employerFeedbackScore, workerFeedbackScore }) => {
    const employer = clamp01(employerFeedbackScore ?? 0.5);
    const worker = clamp01(workerFeedbackScore ?? 0.5);
    const mean = (employer + worker) / 2;
    const gap = Math.abs(employer - worker);

    return {
        mean,
        gap,
        antiBiasDamping: clamp(1 - (gap * 0.35), 0.65, 1),
    };
};

const resolveResponseSignal = (timeToResponse = null) => {
    const minutes = Number(timeToResponse);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return {
            normalized: 0.5,
            latencyPenalty: 0,
        };
    }

    const hours = minutes / 60;
    const normalized = clamp01(1 - (hours / 96));
    const latencyPenalty = hours > 48 ? clamp((hours - 48) / 96, 0, 1) : 0;

    return {
        normalized,
        latencyPenalty,
    };
};

const resolveDeltaVector = ({ outcome, currentWeights }) => {
    const outcomeSignal = resolveOutcomeSignal(outcome);
    const feedback = resolveFeedbackSignal(outcome);
    const response = resolveResponseSignal(outcome.timeToResponse);

    const qualitySignal = clamp(
        (outcomeSignal * 0.55)
        + ((feedback.mean - 0.5) * 0.35)
        + ((response.normalized - 0.5) * 0.1),
        -1,
        1
    );

    const salaryShift = clamp((feedback.mean - 0.5) * 0.3, -0.18, 0.18);
    const commuteShift = clamp((response.normalized - 0.5) * 0.4, -0.2, 0.2);

    const delta = {
        skillWeight: qualitySignal * 0.5,
        experienceWeight: qualitySignal * 0.35,
        salaryToleranceWeight: salaryShift - (response.latencyPenalty * 0.12),
        commuteToleranceWeight: commuteShift - (response.latencyPenalty * 0.18),
    };

    // Anti-self-reinforcing control: reduce directional push as a weight approaches bounds.
    Object.keys(delta).forEach((key) => {
        const bounds = WEIGHT_BOUNDS[key];
        const current = Number(currentWeights[key] || DEFAULT_ADAPTIVE_WEIGHTS[key]);
        const nearLower = Math.max(0, (bounds.min + 0.02) - current);
        const nearUpper = Math.max(0, current - (bounds.max - 0.02));
        const edgeDamping = clamp(1 - ((nearLower + nearUpper) * 5), 0.2, 1);
        delta[key] *= edgeDamping;
    });

    return {
        delta,
        diagnostics: {
            qualitySignal: Number(qualitySignal.toFixed(6)),
            outcomeSignal,
            feedbackMean: Number(feedback.mean.toFixed(6)),
            feedbackGap: Number(feedback.gap.toFixed(6)),
            responseNormalized: Number(response.normalized.toFixed(6)),
            antiBiasDamping: Number(feedback.antiBiasDamping.toFixed(6)),
        },
        antiBiasDamping: feedback.antiBiasDamping,
    };
};

const applyDelta = ({ profile, deltaVector, antiBiasDamping = 1 }) => {
    const sampleSize = Number(profile?.sampleSize || 0);
    const confidence = clamp((sampleSize + 1) / FULL_CONFIDENCE_SAMPLE_SIZE, 0.2, 1);
    const effectiveRate = LEARNING_RATE * confidence * clamp(antiBiasDamping, 0.65, 1);

    const next = {
        skillWeight: Number(profile.skillWeight || DEFAULT_ADAPTIVE_WEIGHTS.skillWeight),
        experienceWeight: Number(profile.experienceWeight || DEFAULT_ADAPTIVE_WEIGHTS.experienceWeight),
        salaryToleranceWeight: Number(profile.salaryToleranceWeight || DEFAULT_ADAPTIVE_WEIGHTS.salaryToleranceWeight),
        commuteToleranceWeight: Number(profile.commuteToleranceWeight || DEFAULT_ADAPTIVE_WEIGHTS.commuteToleranceWeight),
    };

    Object.keys(next).forEach((key) => {
        const rawStep = Number(deltaVector[key] || 0) * effectiveRate;
        const boundedStep = clamp(rawStep, -MAX_DELTA_PER_UPDATE, MAX_DELTA_PER_UPDATE);
        next[key] += boundedStep;
    });

    const bounded = applyBounds(next);

    if (!isFiniteWeightSet(bounded)) {
        return {
            ...DEFAULT_ADAPTIVE_WEIGHTS,
            diagnostics: {
                fallbackApplied: true,
            },
        };
    }

    return {
        ...bounded,
        diagnostics: {
            fallbackApplied: false,
            effectiveRate: Number(effectiveRate.toFixed(6)),
            confidence: Number(confidence.toFixed(6)),
        },
    };
};

const updateAdaptiveWeightsForScope = async ({
    scopeType,
    scopeKey,
    outcome,
    occurredAt = new Date(),
}) => {
    const profile = await getOrCreateWeightProfile({ scopeType, scopeKey });

    const currentWeights = {
        skillWeight: Number(profile.skillWeight || DEFAULT_ADAPTIVE_WEIGHTS.skillWeight),
        experienceWeight: Number(profile.experienceWeight || DEFAULT_ADAPTIVE_WEIGHTS.experienceWeight),
        salaryToleranceWeight: Number(profile.salaryToleranceWeight || DEFAULT_ADAPTIVE_WEIGHTS.salaryToleranceWeight),
        commuteToleranceWeight: Number(profile.commuteToleranceWeight || DEFAULT_ADAPTIVE_WEIGHTS.commuteToleranceWeight),
    };

    const { delta, diagnostics, antiBiasDamping } = resolveDeltaVector({
        outcome,
        currentWeights,
    });

    const next = applyDelta({
        profile,
        deltaVector: delta,
        antiBiasDamping,
    });

    const updated = await AdaptiveMatchWeightProfile.findOneAndUpdate(
        { scopeKey },
        {
            $set: {
                scopeType,
                scopeKey,
                skillWeight: Number(next.skillWeight.toFixed(6)),
                experienceWeight: Number(next.experienceWeight.toFixed(6)),
                salaryToleranceWeight: Number(next.salaryToleranceWeight.toFixed(6)),
                commuteToleranceWeight: Number(next.commuteToleranceWeight.toFixed(6)),
                lastOutcomeAt: occurredAt,
                guardrails: {
                    minWeight: 0.05,
                    maxWeight: 0.6,
                    maxDeltaPerUpdate: MAX_DELTA_PER_UPDATE,
                    antiBiasDamping: Number(antiBiasDamping.toFixed(6)),
                    diagnostics: {
                        ...diagnostics,
                        ...next.diagnostics,
                    },
                },
            },
            $inc: {
                sampleSize: 1,
                updateCount: 1,
            },
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    ).lean();

    return updated;
};

const resolveJobScope = async ({ jobId = null, metadata = {} } = {}) => {
    if (metadata && metadata.city && metadata.roleCluster) {
        return {
            city: metadata.city,
            roleCluster: metadata.roleCluster,
        };
    }

    if (!jobId) {
        return {
            city: 'global',
            roleCluster: 'general',
        };
    }

    if (!hasDatabaseConnection()) {
        return {
            city: metadata?.city || 'global',
            roleCluster: metadata?.roleCluster || 'general',
        };
    }

    const job = await Job.findById(jobId)
        .select('location title')
        .lean();

    return {
        city: job?.location || 'global',
        roleCluster: job?.title || 'general',
    };
};

const recordMatchOutcomeAndAdapt = async ({
    jobId,
    applicantId,
    hired = false,
    rejected = false,
    timeToResponse = null,
    employerFeedbackScore = null,
    workerFeedbackScore = null,
    metadata = {},
}) => {
    if (!hasDatabaseConnection()) {
        return {
            outcome: {
                _id: null,
                jobId,
                applicantId,
                hired: Boolean(hired),
                rejected: Boolean(rejected),
                timeToResponse: Number.isFinite(Number(timeToResponse)) ? Number(timeToResponse) : null,
                employerFeedbackScore: employerFeedbackScore === null || employerFeedbackScore === undefined
                    ? null
                    : clamp01(employerFeedbackScore),
                workerFeedbackScore: workerFeedbackScore === null || workerFeedbackScore === undefined
                    ? null
                    : clamp01(workerFeedbackScore),
                metadata,
            },
            adaptiveWeights: {
                global: null,
                scoped: null,
                scope: resolveScopeKey(metadata || {}),
            },
        };
    }

    const occurredAt = new Date();

    const outcome = await MatchOutcomeModel.create({
        jobId,
        applicantId,
        hired: Boolean(hired),
        rejected: Boolean(rejected),
        timeToResponse: Number.isFinite(Number(timeToResponse)) ? Number(timeToResponse) : null,
        employerFeedbackScore: employerFeedbackScore === null || employerFeedbackScore === undefined
            ? null
            : clamp01(employerFeedbackScore),
        workerFeedbackScore: workerFeedbackScore === null || workerFeedbackScore === undefined
            ? null
            : clamp01(workerFeedbackScore),
        metadata,
    });

    const scope = await resolveJobScope({ jobId, metadata });
    const globalScope = resolveScopeKey();
    const localScope = resolveScopeKey(scope);

    const [globalWeights, localWeights] = await Promise.all([
        updateAdaptiveWeightsForScope({
            scopeType: globalScope.scopeType,
            scopeKey: globalScope.scopeKey,
            outcome,
            occurredAt,
        }),
        updateAdaptiveWeightsForScope({
            scopeType: localScope.scopeType,
            scopeKey: localScope.scopeKey,
            outcome,
            occurredAt,
        }),
    ]);

    return {
        outcome,
        adaptiveWeights: {
            global: globalWeights,
            scoped: localWeights,
            scope: localScope,
        },
    };
};

const readAdaptiveWeights = async ({ city = 'global', roleCluster = 'general' } = {}) => {
    if (!hasDatabaseConnection()) {
        return {
            scopeType: 'global',
            scopeKey: 'global',
            sampleSize: 0,
            weights: { ...DEFAULT_ADAPTIVE_WEIGHTS },
            explainability: {
                bounded: true,
                bounds: WEIGHT_BOUNDS,
                source: 'default_no_db',
            },
        };
    }

    const scoped = resolveScopeKey({ city, roleCluster });

    const [scopedProfile, globalProfile] = await Promise.all([
        AdaptiveMatchWeightProfile.findOne({ scopeKey: scoped.scopeKey }).lean(),
        AdaptiveMatchWeightProfile.findOne({ scopeKey: 'global' }).lean(),
    ]);

    const profile = scopedProfile || globalProfile || {
        ...DEFAULT_ADAPTIVE_WEIGHTS,
        scopeType: 'global',
        scopeKey: 'global',
        sampleSize: 0,
    };

    const weights = applyBounds({
        skillWeight: profile.skillWeight,
        experienceWeight: profile.experienceWeight,
        salaryToleranceWeight: profile.salaryToleranceWeight,
        commuteToleranceWeight: profile.commuteToleranceWeight,
    });

    return {
        scopeType: scopedProfile ? scoped.scopeType : 'global',
        scopeKey: scopedProfile ? scoped.scopeKey : 'global',
        sampleSize: Number(profile.sampleSize || 0),
        weights,
        explainability: {
            bounded: true,
            bounds: WEIGHT_BOUNDS,
            source: scopedProfile ? 'city_role' : (globalProfile ? 'global' : 'default'),
        },
    };
};

const toMatchEngineWeightContext = (weights = DEFAULT_ADAPTIVE_WEIGHTS) => {
    const safe = applyBounds(weights);
    return {
        skillWeight: safe.skillWeight,
        experienceWeight: safe.experienceWeight,
        salaryToleranceWeight: safe.salaryToleranceWeight,
        commuteToleranceWeight: safe.commuteToleranceWeight,
    };
};

const validateAdaptiveWeights = (weights = DEFAULT_ADAPTIVE_WEIGHTS) => {
    const safe = applyBounds(weights);
    const total = Object.values(safe).reduce((sum, value) => sum + Number(value || 0), 0);
    const finite = isFiniteWeightSet(safe);

    return {
        isStable: finite && total > 0.95 && total < 1.05,
        finite,
        total: Number(total.toFixed(6)),
        nonNegative: Object.values(safe).every((value) => Number(value) >= 0),
        bounded: Object.entries(safe).every(([key, value]) => {
            const bounds = WEIGHT_BOUNDS[key];
            return Number(value) >= bounds.min && Number(value) <= bounds.max;
        }),
        weights: safe,
    };
};

module.exports = {
    DEFAULT_ADAPTIVE_WEIGHTS,
    WEIGHT_BOUNDS,
    LEARNING_RATE,
    MAX_DELTA_PER_UPDATE,
    FULL_CONFIDENCE_SAMPLE_SIZE,
    resolveScopeKey,
    readAdaptiveWeights,
    recordMatchOutcomeAndAdapt,
    toMatchEngineWeightContext,
    validateAdaptiveWeights,
    normalizeWeights,
    applyBounds,
};
