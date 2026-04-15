
// =================================================================
// BLUE-COLLAR MATCHING LOGIC v7.0 - ALGORITHM HELPERS
// =================================================================

// CONFIGURATION PARAMETERS
const CONFIG = {
    // Dimension weights
    W_SALARY: 0.40,
    W_SKILLS: 0.33,
    W_EXPERIENCE: 0.27,

    // Threshold tolerances
    SALARY_ACCEPTABLE_SHORTFALL: 0.15,
    EXPERIENCE_ACCEPTABLE_SHORTFALL: 0.35,
    SKILLS_ACCEPTABLE_MATCH: 0.50,

    // Sigmoid sharpness
    SALARY_SHARPNESS: 12,
    EXPERIENCE_SHARPNESS: 6,
    SKILLS_SHARPNESS: 6,

    // Composite parameters
    FLOOR_THRESHOLD: 0.40,
    FLOOR_PENALTY: 0.50,
    DISPLAY_THRESHOLD: 0.62,
    SOFT_BONUS_MAX: 0.20
};

const STOP_WORDS = new Set([
    'senior',
    'junior',
    'lead',
    'manager',
    'specialist',
    'expert',
    'consultant',
]);

const normalizeText = (value = '') => String(value || '').toLowerCase().trim();

const getTokens = (text = '') => {
    if (!text) return new Set();
    return new Set(
        String(text || '')
            .toLowerCase()
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
    );
};

const toShift = (value = '') => normalizeText(value || 'Flexible');

const sameShift = (jobShift, workerShift) => {
    const normalizedJob = toShift(jobShift);
    const normalizedWorker = toShift(workerShift);
    if (!normalizedJob || normalizedJob === 'flexible') return true;
    if (!normalizedWorker || normalizedWorker === 'flexible') return true;
    return normalizedJob === normalizedWorker;
};

const shouldEnforceLicenseGate = (job = {}) => {
    const required = Array.isArray(job?.mandatoryLicenses) ? job.mandatoryLicenses : [];
    if (!required.length) return false;

    const jobText = `${String(job?.title || '')} ${(Array.isArray(job?.requirements) ? job.requirements.join(' ') : String(job?.requirements || ''))}`.toLowerCase();
    const mobilityKeywords = [
        'driver',
        'driving',
        'delivery',
        'rider',
        'courier',
        'logistics',
        'transport',
        'vehicle',
        'forklift',
        'fleet',
        'warehouse',
    ];

    return mobilityKeywords.some((keyword) => jobText.includes(keyword));
};

const levenshteinDistance = (a = '', b = '') => {
    const left = String(a || '');
    const right = String(b || '');
    if (!left.length) return right.length;
    if (!right.length) return left.length;

    const dp = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }
    return dp[left.length][right.length];
};

const fuzzyRatio = (a = '', b = '') => {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (!left.length && !right.length) return 100;
    if (!left.length || !right.length) return 0;

    const longest = Math.max(left.length, right.length);
    if (longest === 0) return 100;
    const distance = levenshteinDistance(left, right);
    return Math.max(0, Math.round(((longest - distance) / longest) * 100));
};

const fuzzyPartialRatio = (a = '', b = '') => {
    const left = normalizeText(a);
    const right = normalizeText(b);
    if (!left.length || !right.length) return 0;

    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    if (shorter.length === longer.length) return fuzzyRatio(shorter, longer);

    let maxScore = 0;
    for (let index = 0; index <= longer.length - shorter.length; index += 1) {
        const segment = longer.slice(index, index + shorter.length);
        maxScore = Math.max(maxScore, fuzzyRatio(shorter, segment));
        if (maxScore === 100) return 100;
    }
    return maxScore;
};

const hasRoleTokenMatch = (jobTitle = '', roleName = '') => {
    const jobTokens = Array.from(getTokens(jobTitle));
    const roleTokens = Array.from(getTokens(roleName));
    if (!jobTokens.length || !roleTokens.length) return false;

    for (const jobToken of jobTokens) {
        for (const roleToken of roleTokens) {
            if (jobToken === roleToken) return true;
            if (jobToken.includes(roleToken) || roleToken.includes(jobToken)) return true;
            if (fuzzyRatio(jobToken, roleToken) > 80) return true;
        }
    }
    return false;
};

const normalizeSkills = (skills = []) => (
    (Array.isArray(skills) ? skills : [])
        .map((skill) => String(skill || '').toLowerCase().trim())
        .filter(Boolean)
);

const getRawSkillsOverlap = (seekerSkills = [], requiredSkills = []) => {
    const workerSkills = normalizeSkills(seekerSkills);
    const neededSkills = normalizeSkills(requiredSkills);
    if (!neededSkills.length) return 1;
    if (!workerSkills.length) return 0;

    let matched = 0;
    for (const requirement of neededSkills) {
        let best = 0;
        for (const skill of workerSkills) {
            best = Math.max(best, fuzzyPartialRatio(skill, requirement));
            if (best >= 80) break;
        }
        if (best >= 80) matched += 1;
    }
    return matched / neededSkills.length;
};

const calculateQualityFactor = (job, worker) => {
    const hasCoreFields = Boolean(
        normalizeText(job?.title)
        && normalizeText(job?.location)
        && normalizeText(worker?.city)
    );
    if (!hasCoreFields) return 0.8;
    return 1.0;
};

const hardGates = (job, worker, roleData) => {
    if (!hasRoleTokenMatch(job?.title, roleData?.roleName)) {
        return { passed: false, reason: 'ROLE_TOKEN_MISMATCH' };
    }

    if (!sameShift(job?.shift, worker?.preferredShift)) {
        return { passed: false, reason: 'SHIFT_MISMATCH' };
    }

    if (Number(job?.maxSalary || 0) > 0 && Number(roleData?.expectedSalary || 0) > 0) {
        if (Number(roleData.expectedSalary) > Number(job.maxSalary) * 1.15) {
            return { passed: false, reason: 'SALARY_OUTSIDE_RANGE' };
        }
    }

    if (Array.isArray(job?.mandatoryLicenses) && job.mandatoryLicenses.length > 0 && shouldEnforceLicenseGate(job)) {
        const workerLicenses = normalizeSkills(worker?.licenses || []);
        const hasLicenses = job.mandatoryLicenses.every((required) => {
            const normalized = normalizeText(required);
            if (!normalized) return true;
            return workerLicenses.some((owned) => owned.includes(normalized));
        });
        if (!hasLicenses) {
            return { passed: false, reason: 'CERTIFICATION_MISSING' };
        }
    }

    if (normalizeText(job?.location) && normalizeText(worker?.city)) {
        if (normalizeText(job.location) !== normalizeText(worker.city)) {
            return { passed: false, reason: 'LOCATION_MISMATCH' };
        }
    }

    return { passed: true, reason: null };
};

const salaryScore = (seekerExpectation, jobOfferMax) => {
    if (!seekerExpectation) return 1.0; // Assume fit if not specified
    if (!jobOfferMax) return 1.0;

    if (jobOfferMax >= seekerExpectation) {
        const excessRatio = (jobOfferMax / seekerExpectation) - 1.0;
        return 0.95 + 0.05 * (1 - Math.exp(-2 * excessRatio));
    } else {
        const shortfall = (seekerExpectation - jobOfferMax) / seekerExpectation;
        const x = CONFIG.SALARY_SHARPNESS * (CONFIG.SALARY_ACCEPTABLE_SHORTFALL - shortfall);
        return 1 / (1 + Math.exp(-x));
    }
};

const experienceScore = (seekerExp, requiredExp) => {
    // Handling unstructured text in DB (cleaning required in Controller)
    const sExp = Number(seekerExp) || 0;
    const rExp = Number(requiredExp) || 0;

    if (sExp >= rExp) {
        const excessRatio = (sExp / Math.max(rExp, 1)) - 1.0;
        if (excessRatio > 2.0) return 0.85; // Overqualified
        return Math.min(1.0, 0.95 + 0.05 * excessRatio);
    } else {
        const shortfall = (rExp - sExp) / rExp;
        const x = CONFIG.EXPERIENCE_SHARPNESS * (CONFIG.EXPERIENCE_ACCEPTABLE_SHORTFALL - shortfall);
        return 1 / (1 + Math.exp(-x));
    }
};

const skillsScore = (seekerSkills, requiredSkills) => {
    if (!requiredSkills || requiredSkills.length === 0) return 1.0;
    const matchRate = getRawSkillsOverlap(seekerSkills, requiredSkills);
    const x = CONFIG.SKILLS_SHARPNESS * (matchRate - CONFIG.SKILLS_ACCEPTABLE_MATCH);
    return 1 / (1 + Math.exp(-x));
};

// PHASE 6: CRITICAL COMPOSITE (Geometric Mean)
const criticalComposite = (sal, exp, skl) => {
    const EPSILON = 1e-6;
    const logGeo = (
        CONFIG.W_SALARY * Math.log(Math.max(sal, EPSILON)) +
        CONFIG.W_SKILLS * Math.log(Math.max(skl, EPSILON)) +
        CONFIG.W_EXPERIENCE * Math.log(Math.max(exp, EPSILON))
    );
    const geometricMean = Math.exp(logGeo);

    // Floor Rule
    const worst = Math.min(sal, skl, exp);
    if (worst < CONFIG.FLOOR_THRESHOLD) {
        return worst * CONFIG.FLOOR_PENALTY;
    }
    return geometricMean;
};

// PHASE 7: SOFT BONUSES
const calculateSoftBonus = (job, worker) => {
    let bonus = 0.0;

    // Verification Bonus
    if (Boolean(worker?.isVerified)) bonus += 0.02;

    // Shift Alignment Bonus
    if (job.shift && worker.preferredShift && sameShift(job.shift, worker.preferredShift)) {
        bonus += 0.04;
    }

    return Math.min(bonus, CONFIG.SOFT_BONUS_MAX);
};

const roleMatch = (jobTitle, roleName) => hasRoleTokenMatch(jobTitle, roleName);

module.exports = {
    hardGates,
    roleMatch,
    getTokens,
    fuzzyRatio,
    fuzzyPartialRatio,
    getRawSkillsOverlap,
    salaryScore,
    experienceScore,
    skillsScore,
    criticalComposite,
    calculateSoftBonus,
    calculateQualityFactor,
    CONFIG
};
