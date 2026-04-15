export const MATCH_TIERS = {
    STRONG: 'STRONG',
    GOOD: 'GOOD',
    POSSIBLE: 'POSSIBLE',
};

export const FEATURE_REASON_THRESHOLD = 0.6;
const SCORE_EPSILON = 0.00001;
const EXPLAINABILITY_SCORE_WEIGHTS = {
    skill: 0.4,
    experience: 0.28,
    salary: 0.18,
    distance: 0.14,
};

export const clamp01 = (value) => {
    const normalized = typeof value === 'string'
        ? value.replace(/[%\s,]/g, '')
        : value;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
};

const toRatio = (value) => {
    if (typeof value === 'string') {
        const normalizedText = value.trim().toLowerCase();
        if (!normalizedText) return null;

        const slashMatch = normalizedText.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        if (slashMatch) {
            const numerator = Number(slashMatch[1]);
            const denominator = Number(slashMatch[2]);
            if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
                return clamp01(numerator / denominator);
            }
        }

        const cleaned = normalizedText
            .replace(/percent|percentage/g, '')
            .replace(/[%\s,]/g, '');
        if (!cleaned) return null;
        let numeric = Number(cleaned);
        if (!Number.isFinite(numeric)) {
            const firstNumericToken = cleaned.match(/-?\d+(?:\.\d+)?/);
            numeric = firstNumericToken ? Number(firstNumericToken[0]) : Number.NaN;
        }
        if (!Number.isFinite(numeric)) return null;
        if (numeric <= 1) return clamp01(numeric);
        if (numeric <= 100) return clamp01(numeric / 100);
        return clamp01(numeric);
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric <= 1) return clamp01(numeric);
    if (numeric <= 100) return clamp01(numeric / 100);
    return clamp01(numeric);
};

export const getTierColor = (tier) => {
    switch (String(tier || '').toUpperCase()) {
        case MATCH_TIERS.STRONG:
            return '#10B981';
        case MATCH_TIERS.GOOD:
            return '#2563EB';
        case MATCH_TIERS.POSSIBLE:
            return '#D97706';
        default:
            return '#64748B';
    }
};

export const getTierPriority = (tier) => {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === MATCH_TIERS.STRONG) return 3;
    if (normalized === MATCH_TIERS.GOOD) return 2;
    if (normalized === MATCH_TIERS.POSSIBLE) return 1;
    return 0;
};

export const getTierDefaultRatio = (tier) => {
    const normalized = String(tier || '').toUpperCase();
    if (normalized === MATCH_TIERS.STRONG) return 0.9;
    if (normalized === MATCH_TIERS.GOOD) return 0.78;
    if (normalized === MATCH_TIERS.POSSIBLE) return 0.65;
    return 0;
};

export const getNormalizedScore = (job = {}) => {
    const scoreCandidates = [
        job?.matchProbability,
        job?.finalScore,
        job?.matchScore,
        job?.probability,
        job?.score,
        job?.matchPercent,
        job?.matchPercentage,
        job?.match_probability,
        job?.final_score,
        job?.relevanceScore,
        job?.metrics?.matchProbability,
        job?.metrics?.finalScore,
        job?.metrics?.matchScore,
        job?.match?.probability,
        job?.match?.score,
        job?.job?.matchProbability,
        job?.job?.finalScore,
        job?.job?.matchScore,
    ];

    for (const candidate of scoreCandidates) {
        const normalized = toRatio(candidate);
        if (normalized === null) continue;
        if (normalized > SCORE_EPSILON) {
            return normalized;
        }
    }
    return 0;
};

export const getDisplayScorePercent = (job = {}) => Math.round(getNormalizedScore(job) * 100);

const normalizeFromImpact = (impactValue) => {
    const impact = Number(impactValue);
    if (!Number.isFinite(impact)) return 0;

    // Convert logistic contribution-ish value to a [0,1] pseudo-strength.
    return clamp01(1 / (1 + Math.exp(-(impact * 4))));
};

const extractFeatureStrength = ({ explainability = {}, scoreKey, impactKey }) => {
    if (explainability && explainability[scoreKey] !== undefined) {
        return clamp01(explainability[scoreKey]);
    }
    if (explainability && explainability[impactKey] !== undefined) {
        return normalizeFromImpact(explainability[impactKey]);
    }
    return 0;
};

const hasFeatureSignal = ({ explainability = {}, scoreKey, impactKey }) => (
    Boolean(explainability)
    && (explainability[scoreKey] !== undefined || explainability[impactKey] !== undefined)
);

export const buildMatchReasons = ({ explainability = {}, distanceKm = null, max = 3 }) => {
    const candidates = [
        {
            id: 'skill',
            label: 'Skills matched',
            score: extractFeatureStrength({ explainability, scoreKey: 'skillScore', impactKey: 'skillImpact' }),
        },
        {
            id: 'experience',
            label: 'Experience aligned',
            score: extractFeatureStrength({ explainability, scoreKey: 'experienceScore', impactKey: 'experienceImpact' }),
        },
        {
            id: 'salary',
            label: 'Salary expectation aligned',
            score: extractFeatureStrength({ explainability, scoreKey: 'salaryScore', impactKey: 'salaryImpact' }),
        },
        {
            id: 'distance',
            label: Number.isFinite(Number(distanceKm))
                ? `Within ${Math.round(Number(distanceKm))} km`
                : 'Close distance fit',
            score: extractFeatureStrength({ explainability, scoreKey: 'distanceScore', impactKey: 'distanceImpact' }),
        },
    ];

    return candidates
        .filter((item) => item.score > FEATURE_REASON_THRESHOLD)
        .sort((left, right) => right.score - left.score)
        .slice(0, max);
};

export const buildMatchGaps = ({ explainability = {}, distanceKm = null, max = 3 }) => {
    const candidates = [
        {
            id: 'skill',
            label: 'Add closer matching skills',
            hasSignal: hasFeatureSignal({ explainability, scoreKey: 'skillScore', impactKey: 'skillImpact' }),
            score: extractFeatureStrength({ explainability, scoreKey: 'skillScore', impactKey: 'skillImpact' }),
        },
        {
            id: 'experience',
            label: 'Experience fit is still building',
            hasSignal: hasFeatureSignal({ explainability, scoreKey: 'experienceScore', impactKey: 'experienceImpact' }),
            score: extractFeatureStrength({ explainability, scoreKey: 'experienceScore', impactKey: 'experienceImpact' }),
        },
        {
            id: 'salary',
            label: 'Salary may need alignment',
            hasSignal: hasFeatureSignal({ explainability, scoreKey: 'salaryScore', impactKey: 'salaryImpact' }),
            score: extractFeatureStrength({ explainability, scoreKey: 'salaryScore', impactKey: 'salaryImpact' }),
        },
        {
            id: 'distance',
            label: Number.isFinite(Number(distanceKm)) && Number(distanceKm) > 0
                ? `Travel to ${Math.round(Number(distanceKm))} km is a weaker signal`
                : 'Location fit is weaker',
            hasSignal: hasFeatureSignal({ explainability, scoreKey: 'distanceScore', impactKey: 'distanceImpact' }),
            score: extractFeatureStrength({ explainability, scoreKey: 'distanceScore', impactKey: 'distanceImpact' }),
        },
    ];

    return candidates
        .filter((item) => item.hasSignal && item.score >= 0 && item.score < FEATURE_REASON_THRESHOLD)
        .sort((left, right) => left.score - right.score)
        .slice(0, max);
};

export const getMatchScoreSourceMeta = (job = {}) => {
    const explicitSource = String(job?.matchScoreSource || job?.match?.matchScoreSource || '').trim();
    const modelVersion = String(
        job?.matchModelVersionUsed
        || job?.matchModelVersion
        || job?.match?.matchModelVersionUsed
        || ''
    ).trim();
    const fallbackUsed = Boolean(
        job?.probabilisticFallbackUsed
        || job?.fallbackUsed
        || job?.match?.probabilisticFallbackUsed
        || job?.match?.fallbackUsed
    );

    if (explicitSource === 'probabilistic_model') {
        return {
            id: 'probabilistic_model',
            label: 'AI model score',
            detail: modelVersion || 'Probabilistic',
        };
    }

    if (explicitSource === 'deterministic_fallback') {
        return {
            id: 'deterministic_fallback',
            label: 'Deterministic fallback',
            detail: 'Rule-based',
        };
    }

    if (explicitSource === 'match_engine') {
        return {
            id: 'match_engine',
            label: 'Live match engine',
            detail: 'Rule-based',
        };
    }

    if (modelVersion) {
        return {
            id: 'probabilistic_model',
            label: 'AI model score',
            detail: modelVersion,
        };
    }

    if (fallbackUsed) {
        return {
            id: 'deterministic_fallback',
            label: 'Deterministic fallback',
            detail: 'Rule-based',
        };
    }

    return {
        id: 'match_engine',
        label: 'Live match engine',
        detail: 'Rule-based',
    };
};

export const formatRelativeTimeLabel = (value, { prefix = '', fallback = 'Just now' } = {}) => {
    const epoch = value ? new Date(value).getTime() : 0;
    if (!Number.isFinite(epoch) || epoch <= 0) return fallback;

    const diffMs = Math.max(0, Date.now() - epoch);
    const minutes = Math.floor(diffMs / (60 * 1000));
    const hours = Math.floor(diffMs / (60 * 60 * 1000));
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

    let label = fallback;
    if (minutes < 1) {
        label = 'Just now';
    } else if (minutes < 60) {
        label = `${minutes}m ago`;
    } else if (hours < 24) {
        label = `${hours}h ago`;
    } else if (days < 7) {
        label = `${days}d ago`;
    } else {
        const weeks = Math.floor(days / 7);
        label = `${weeks}w ago`;
    }

    return prefix ? `${prefix} ${label}` : label;
};

export const buildFreshnessSignals = (job = {}) => {
    const updatedAt = job?.updatedAt || job?.timelineTransparency?.jobUpdatedAt || null;
    const createdAt = job?.createdAt || job?.timelineTransparency?.jobPostedAt || null;
    const openings = Number(job?.openings);
    const responseTimeLabel = String(job?.responseTimeLabel || '').trim();
    const signals = [];

    if (updatedAt || createdAt) {
        signals.push({
            id: 'updated',
            label: formatRelativeTimeLabel(updatedAt || createdAt, { prefix: 'Updated', fallback: 'Updated recently' }),
        });
    }

    if (responseTimeLabel) {
        signals.push({
            id: 'response',
            label: responseTimeLabel,
        });
    }

    if (Number.isFinite(openings) && openings > 0) {
        signals.push({
            id: 'openings',
            label: `${Math.round(openings)} opening${Math.round(openings) === 1 ? '' : 's'}`,
        });
    }

    if (job?.activelyHiring !== false) {
        signals.push({
            id: 'activity',
            label: 'Actively hiring',
        });
    }

    return signals.slice(0, 4);
};

export const sortRecommendedJobsByTierAndScore = (jobs = []) => {
    const normalized = Array.isArray(jobs) ? jobs.slice() : [];
    const toJobEpoch = (job = {}) => {
        const candidateEpochs = [
            Number(job?.createdAtEpoch),
            Date.parse(job?.createdAt || ''),
            Date.parse(job?.job?.createdAt || ''),
        ].filter((value) => Number.isFinite(value) && value > 0);
        return candidateEpochs.length ? candidateEpochs[0] : 0;
    };

    normalized.sort((left, right) => {
        const leftTier = getTierPriority(left.tier);
        const rightTier = getTierPriority(right.tier);
        if (rightTier !== leftTier) return rightTier - leftTier;

        const leftScore = getNormalizedScore(left);
        const rightScore = getNormalizedScore(right);
        if (rightScore !== leftScore) return rightScore - leftScore;

        const rightEpoch = toJobEpoch(right);
        const leftEpoch = toJobEpoch(left);
        if (rightEpoch !== leftEpoch) return rightEpoch - leftEpoch;

        return String(left?._id || '').localeCompare(String(right?._id || ''));
    });

    return normalized;
};

export const isMatchTier = (tier) => {
    const normalized = String(tier || '').toUpperCase();
    return normalized === MATCH_TIERS.STRONG || normalized === MATCH_TIERS.GOOD || normalized === MATCH_TIERS.POSSIBLE;
};
