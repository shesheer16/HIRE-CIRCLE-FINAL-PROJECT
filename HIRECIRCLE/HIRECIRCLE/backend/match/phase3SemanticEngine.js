const crypto = require('crypto');

const VECTOR_DIMENSIONS = 192;

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'into', 'your', 'have', 'has',
    'are', 'you', 'our', 'this', 'that', 'will', 'not', 'but', 'all',
    'role', 'type', 'experience', 'years', 'year', 'language', 'openings',
]);

const SYNONYM_MAP = new Map([
    ['customer handling', 'customer service'],
    ['customer support', 'customer service'],
    ['inventory checks', 'inventory management'],
    ['inventory check', 'inventory management'],
    ['route knowledge', 'route planning'],
    ['delivery support', 'delivery operations'],
    ['last mile delivery', 'delivery operations'],
    ['last-mile delivery', 'delivery operations'],
    ['reactjs', 'react'],
    ['react.js', 'react'],
    ['nodejs', 'node'],
    ['node.js', 'node'],
    ['javascript', 'javascript'],
    ['js', 'javascript'],
    ['typescript', 'typescript'],
    ['ts', 'typescript'],
    ['fork lift', 'forklift'],
]);

const clamp01 = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
};

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const normalizeToken = (value = '') => {
    const token = normalizeText(value)
        .replace(/[^\w\s+#.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!token || STOP_WORDS.has(token)) return '';
    return SYNONYM_MAP.get(token) || token;
};

const flattenList = (value) => {
    const out = [];
    const queue = [value];
    const seen = new Set();

    while (queue.length) {
        const current = queue.shift();
        if (current === null || current === undefined) continue;
        if (typeof current === 'object') {
            if (seen.has(current)) continue;
            seen.add(current);
        }

        if (typeof current === 'string') {
            out.push(current);
            continue;
        }

        if (Array.isArray(current) || current instanceof Set) {
            current.forEach((entry) => queue.push(entry));
            continue;
        }

        if (typeof current === 'object') {
            Object.values(current).forEach((entry) => queue.push(entry));
            continue;
        }

        out.push(String(current));
    }

    return out;
};

const tokenize = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) return [];
    return normalized
        .split(/[\s,;/|]+/g)
        .map((entry) => normalizeToken(entry))
        .filter(Boolean)
        .filter((entry) => entry.length >= 2);
};

const collectEntityTokens = (entity = {}) => {
    const raw = flattenList([
        entity?.title,
        entity?.roleName,
        entity?.primary_role,
        entity?.description,
        entity?.summary,
        entity?.requirements,
        entity?.skills,
        entity?.required_skills,
        entity?.requiredSkills,
        entity?.mustHaveSkills,
        entity?.competencies,
    ]);

    const tokens = new Set();
    raw.forEach((fragment) => {
        tokenize(fragment).forEach((token) => {
            tokens.add(token);
        });
        const normalizedFragment = normalizeToken(fragment);
        if (normalizedFragment && normalizedFragment.includes(' ')) {
            tokens.add(normalizedFragment);
        }
    });
    return tokens;
};

const hashToken = (token, seed = 0) => {
    const input = `${seed}:${token}`;
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const buildSemanticVector = (tokenSet = new Set(), dimensions = VECTOR_DIMENSIONS) => {
    const vector = new Float64Array(dimensions);
    tokenSet.forEach((token) => {
        const normalized = normalizeToken(token);
        if (!normalized) return;
        const primaryIdx = hashToken(normalized, 17) % dimensions;
        const secondaryIdx = hashToken(normalized, 131) % dimensions;
        const sign = (hashToken(normalized, 911) & 1) ? 1 : -1;
        const weight = 1 + Math.min(normalized.length, 20) / 40;
        vector[primaryIdx] += weight;
        vector[secondaryIdx] += sign * weight * 0.5;
    });
    return vector;
};

const cosineSimilarity = (leftVector, rightVector) => {
    if (!leftVector || !rightVector) return 0;
    if (leftVector.length !== rightVector.length) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < leftVector.length; index += 1) {
        const left = Number(leftVector[index] || 0);
        const right = Number(rightVector[index] || 0);
        dot += left * right;
        leftNorm += left * left;
        rightNorm += right * right;
    }
    if (leftNorm <= 0 || rightNorm <= 0) return 0;
    const score = dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
    return clamp01(score);
};

const gaussianDecay = (actual, target, variance, { allowAboveTarget = true } = {}) => {
    const actualValue = Number(actual);
    const targetValue = Number(target);
    const varianceValue = Number(variance);

    if (!Number.isFinite(targetValue) || targetValue <= 0) return 1;
    if (!Number.isFinite(actualValue) || actualValue < 0) return 0;
    if (allowAboveTarget && actualValue >= targetValue) return 1;

    const safeVariance = Math.max(Number.isFinite(varianceValue) ? varianceValue : 1, 0.01);
    const diff = actualValue - targetValue;
    const exponent = -((diff * diff) / (2 * safeVariance * safeVariance));
    if (exponent < -60) return 0;
    return clamp01(Math.exp(exponent));
};

const resolveRoleTokens = (value = '') => new Set(tokenize(value));

const roleBonus = ({ candidateRole = '', targetRole = '' } = {}) => {
    const candidateTokens = resolveRoleTokens(candidateRole);
    const targetTokens = resolveRoleTokens(targetRole);
    if (!candidateTokens.size || !targetTokens.size) return { applied: false, bonus: 0 };

    const overlap = [...candidateTokens].some((token) => targetTokens.has(token));
    if (overlap) return { applied: true, bonus: 0.2 };

    // Fuzzy fallback for slight naming variance (e.g., "logistics coordinator" vs "logistic coordinator")
    let fuzzyHit = false;
    candidateTokens.forEach((candidateToken) => {
        targetTokens.forEach((targetToken) => {
            if (fuzzyHit) return;
            if (candidateToken.includes(targetToken) || targetToken.includes(candidateToken)) {
                fuzzyHit = true;
            }
        });
    });
    return fuzzyHit ? { applied: true, bonus: 0.12 } : { applied: false, bonus: 0 };
};

const toSafeNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const inferCompromiseRatio = (profile = {}) => {
    const candidates = [
        profile?.willingness_to_compromise,
        profile?.willingnessToCompromise,
        profile?.compromiseRatio,
        profile?.interviewIntelligence?.salaryCompromiseRatio,
    ];

    for (const candidate of candidates) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) {
            return Math.max(0.05, Math.min(0.4, numeric));
        }
    }
    return 0.18;
};

const buildWorkDnaVersionId = ({ worker = {}, roleData = {}, salt = '' } = {}) => {
    const payload = {
        workerId: String(worker?._id || worker?.id || ''),
        userId: String(worker?.user?._id || worker?.user || ''),
        workerUpdatedAt: worker?.updatedAt ? new Date(worker.updatedAt).toISOString() : '',
        city: normalizeText(worker?.city),
        roleName: normalizeText(roleData?.roleName || ''),
        experienceInRole: toSafeNumber(roleData?.experienceInRole, 0),
        expectedSalary: toSafeNumber(roleData?.expectedSalary, 0),
        skills: flattenList(roleData?.skills || [])
            .map((entry) => normalizeToken(entry))
            .filter(Boolean)
            .sort(),
        salt: String(salt || ''),
    };
    const digest = crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex')
        .slice(0, 24);
    return `wdna_${digest}`;
};

const calculatePhase3SemanticScore = ({
    profile = {},
    job = {},
    profileSkills = new Set(),
    jobSkills = new Set(),
    profileYears = 0,
    jobYears = 0,
    jobIsMax = false,
    jobSalary = 0,
    profileExpectedSalary = 0,
} = {}) => {
    const profileTokenSet = new Set([
        ...collectEntityTokens(profile),
        ...flattenList([...profileSkills]).map((entry) => normalizeToken(entry)).filter(Boolean),
    ]);
    const jobTokenSet = new Set([
        ...collectEntityTokens(job),
        ...flattenList([...jobSkills]).map((entry) => normalizeToken(entry)).filter(Boolean),
    ]);

    const profileVector = buildSemanticVector(profileTokenSet);
    const jobVector = buildSemanticVector(jobTokenSet);
    const baseOverlap = cosineSimilarity(profileVector, jobVector);

    const roleAlignment = roleBonus({
        candidateRole: profile?.primary_role || profile?.roleName || profile?.title || '',
        targetRole: job?.target_role || job?.title || '',
    });
    const semanticSkillScore = clamp01(baseOverlap + roleAlignment.bonus);

    let experienceGaussianScore = 1;
    if (jobIsMax) {
        if (toSafeNumber(profileYears, 0) <= toSafeNumber(jobYears, 0)) {
            experienceGaussianScore = 1;
        } else {
            const variance = Math.max(1, toSafeNumber(jobYears, 0) * 0.5);
            experienceGaussianScore = gaussianDecay(
                toSafeNumber(jobYears, 0),
                toSafeNumber(profileYears, 0),
                variance,
                { allowAboveTarget: true }
            );
        }
    } else {
        experienceGaussianScore = gaussianDecay(
            toSafeNumber(profileYears, 0),
            toSafeNumber(jobYears, 0),
            2,
            { allowAboveTarget: true }
        );
    }

    let economicViabilityScore = 0.6;
    if (toSafeNumber(jobSalary, 0) > 0 && toSafeNumber(profileExpectedSalary, 0) > 0) {
        if (toSafeNumber(jobSalary, 0) >= toSafeNumber(profileExpectedSalary, 0)) {
            economicViabilityScore = 1;
        } else {
            const compromiseRatio = inferCompromiseRatio(profile);
            const flexibility = Math.max(toSafeNumber(profileExpectedSalary, 0) * compromiseRatio, 1);
            economicViabilityScore = gaussianDecay(
                toSafeNumber(jobSalary, 0),
                toSafeNumber(profileExpectedSalary, 0),
                flexibility,
                { allowAboveTarget: false }
            );
        }
    }

    const phase3CompositeScore = clamp01(
        (semanticSkillScore * 0.55)
        + (experienceGaussianScore * 0.25)
        + (economicViabilityScore * 0.2)
    );

    return {
        semanticSkillScore: Number(semanticSkillScore.toFixed(4)),
        baseSemanticOverlap: Number(baseOverlap.toFixed(4)),
        roleBonusApplied: Boolean(roleAlignment.applied),
        roleBonusValue: Number(roleAlignment.bonus.toFixed(4)),
        experienceGaussianScore: Number(experienceGaussianScore.toFixed(4)),
        economicViabilityScore: Number(economicViabilityScore.toFixed(4)),
        phase3CompositeScore: Number(phase3CompositeScore.toFixed(4)),
    };
};

module.exports = {
    calculatePhase3SemanticScore,
    buildWorkDnaVersionId,
};
