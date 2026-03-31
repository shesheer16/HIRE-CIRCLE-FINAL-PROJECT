const Job = require('../models/Job');

const SALARY_OUTLIER_RATIO_THRESHOLD = 2.5;
const SALARY_MEDIAN_CACHE_TTL_MS = 15 * 60 * 1000;
const salaryMedianCache = new Map();

const ADVANCED_SKILL_TOKENS = [
    'team management',
    'fleet management',
    'inventory control',
    'supervisor',
    'supervision',
    'quality assurance',
    'electrical',
    'hvac',
    'maintenance lead',
    'dispatch planning',
    'route optimization',
];

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const hasValue = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
};

const parseNumeric = (value) => {
    const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
};

const parseSalaryMidpoint = (job = {}) => {
    const minSalary = Number(job.minSalary);
    const maxSalary = Number(job.maxSalary);
    if (Number.isFinite(minSalary) && Number.isFinite(maxSalary) && minSalary > 0 && maxSalary > 0) {
        return (minSalary + maxSalary) / 2;
    }

    const range = String(job.salaryRange || '');
    const matches = range.match(/\d[\d,]*/g) || [];
    if (!matches.length) return null;
    const values = matches
        .map((item) => parseNumeric(item))
        .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) return null;
    if (values.length === 1) return values[0];
    return (Math.min(...values) + Math.max(...values)) / 2;
};

const computeMedian = (values = []) => {
    const sanitized = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
    if (!sanitized.length) return null;

    const middle = Math.floor(sanitized.length / 2);
    if (sanitized.length % 2 === 0) {
        return (sanitized[middle - 1] + sanitized[middle]) / 2;
    }
    return sanitized[middle];
};

const cacheRead = (key) => {
    const hit = salaryMedianCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.cachedAt > SALARY_MEDIAN_CACHE_TTL_MS) {
        salaryMedianCache.delete(key);
        return null;
    }
    return hit.value;
};

const cacheWrite = (key, value) => {
    salaryMedianCache.set(key, {
        cachedAt: Date.now(),
        value,
    });
    return value;
};

const fetchMedianSalaryByRoleAndCity = async ({ role, city }) => {
    const normalizedRole = normalizeText(role);
    const normalizedCity = normalizeText(city);
    if (!normalizedRole || !normalizedCity) return null;

    const cacheKey = `${normalizedRole}::${normalizedCity}`;
    const cached = cacheRead(cacheKey);
    if (cached !== null) return cached;

    const cityRegex = new RegExp(`^${escapeRegex(normalizedCity)}$`, 'i');
    const roleRegex = new RegExp(escapeRegex(normalizedRole), 'i');

    let jobs = await Job.find({
        location: cityRegex,
        title: roleRegex,
        isOpen: true,
    })
        .select('minSalary maxSalary salaryRange')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();

    if (jobs.length < 8) {
        jobs = await Job.find({
            location: cityRegex,
            isOpen: true,
        })
            .select('minSalary maxSalary salaryRange')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
    }

    const salaryValues = jobs
        .map((job) => parseSalaryMidpoint(job))
        .filter((value) => Number.isFinite(value) && value > 0);

    const median = computeMedian(salaryValues);
    return cacheWrite(cacheKey, median);
};

const detectSalaryRealismSignal = async ({ slotState = {} }) => {
    const expectedSalary = parseNumeric(slotState.expectedSalary);
    const primaryRole = String(slotState.primaryRole || '').trim();
    const city = String(slotState.city || '').trim();

    if (!Number.isFinite(expectedSalary) || expectedSalary <= 0 || !primaryRole || !city) {
        return {
            salaryOutlierFlag: false,
            salaryMedianForRoleCity: null,
            salaryRealismRatio: null,
            clarificationHint: null,
        };
    }

    const median = await fetchMedianSalaryByRoleAndCity({ role: primaryRole, city });
    if (!Number.isFinite(median) || median <= 0) {
        return {
            salaryOutlierFlag: false,
            salaryMedianForRoleCity: null,
            salaryRealismRatio: null,
            clarificationHint: null,
        };
    }

    const ratio = expectedSalary / median;
    const outlier = ratio > SALARY_OUTLIER_RATIO_THRESHOLD;

    return {
        salaryOutlierFlag: outlier,
        salaryMedianForRoleCity: Number(median.toFixed(2)),
        salaryRealismRatio: Number(ratio.toFixed(4)),
        clarificationHint: outlier
            ? 'That seems above typical range for this role. Is that correct?'
            : null,
    };
};

const detectExperienceSkillConsistencySignal = ({ slotState = {} }) => {
    const years = Number(slotState.totalExperienceYears);
    const primarySkills = Array.isArray(slotState.primarySkills) ? slotState.primarySkills : [];
    if (!Number.isFinite(years) || years >= 1 || !primarySkills.length) {
        return {
            experienceSkillConsistencyFlag: false,
            clarificationHint: null,
        };
    }

    const normalizedSkills = primarySkills.map((item) => normalizeText(item));
    const hasAdvancedSkill = normalizedSkills.some((skill) =>
        ADVANCED_SKILL_TOKENS.some((token) => skill.includes(token))
    );

    return {
        experienceSkillConsistencyFlag: hasAdvancedSkill,
        clarificationHint: hasAdvancedSkill
            ? 'Have you worked professionally in this skill?'
            : null,
    };
};

const computeSlotCompletenessRatio = ({
    slotState = {},
    slotConfidence = {},
    requiredFields = [],
    confidenceThreshold = 0.75,
}) => {
    if (!requiredFields.length) return 0;

    const completed = requiredFields.reduce((count, field) => {
        const confidence = Number(slotConfidence[field] || 0);
        return count + (hasValue(slotState[field]) && confidence >= confidenceThreshold ? 1 : 0);
    }, 0);
    return clamp01(completed / requiredFields.length);
};

const computeProfileQualityScore = ({
    slotState = {},
    slotConfidence = {},
    requiredFields = [],
    clarificationTriggeredCount = 0,
    clarificationResolvedCount = 0,
    interviewStep = 0,
    maxSteps = 8,
    ambiguousFieldsCount = 0,
}) => {
    const requiredConfidenceAverage = requiredFields.length
        ? clamp01(requiredFields.reduce((sum, field) => sum + Number(slotConfidence[field] || 0), 0) / requiredFields.length)
        : 0;

    const clarificationResolutionRate = clarificationTriggeredCount > 0
        ? clamp01(Number(clarificationResolvedCount || 0) / Number(clarificationTriggeredCount || 1))
        : 1;

    const usedSteps = Math.max(1, Number(interviewStep || 0));
    const boundedMaxSteps = Math.max(1, Number(maxSteps || 8));
    const speedScore = clamp01(1 - ((usedSteps - 1) / boundedMaxSteps) * 0.6);

    const ambiguityRate = requiredFields.length
        ? clamp01(Number(ambiguousFieldsCount || 0) / requiredFields.length)
        : 0;
    const ambiguityScore = clamp01(1 - ambiguityRate);
    const slotCompletenessRatio = computeSlotCompletenessRatio({
        slotState,
        slotConfidence,
        requiredFields,
    });

    const profileQualityScore = clamp01(
        (requiredConfidenceAverage * 0.45)
        + (slotCompletenessRatio * 0.2)
        + (clarificationResolutionRate * 0.15)
        + (speedScore * 0.10)
        + (ambiguityScore * 0.10)
    );

    return {
        profileQualityScore: Number(profileQualityScore.toFixed(4)),
        requiredConfidenceAverage: Number(requiredConfidenceAverage.toFixed(4)),
        slotCompletenessRatio: Number(slotCompletenessRatio.toFixed(4)),
        ambiguityRate: Number(ambiguityRate.toFixed(4)),
        clarificationResolutionRate: Number(clarificationResolutionRate.toFixed(4)),
        speedScore: Number(speedScore.toFixed(4)),
    };
};

module.exports = {
    SALARY_OUTLIER_RATIO_THRESHOLD,
    detectSalaryRealismSignal,
    detectExperienceSkillConsistencySignal,
    computeProfileQualityScore,
    computeSlotCompletenessRatio,
};
