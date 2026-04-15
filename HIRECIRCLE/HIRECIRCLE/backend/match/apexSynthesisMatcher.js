const { calculatePhase3SemanticScore } = require('./phase3SemanticEngine');

const REMOTE_KEYWORDS = [
    'remote',
    'anywhere',
    'work from home',
    'wfh',
    'telecommute',
    'tele-commute',
    'virtual',
    'distributed',
];

const SKILL_NORMALIZER = new Map([
    ['js', 'javascript'],
    ['javascript es6', 'javascript'],
    ['ecmascript', 'javascript'],
    ['ts', 'typescript'],
    ['python3', 'python'],
    ['python 3', 'python'],
    ['py', 'python'],
    ['java ee', 'java'],
    ['aws', 'amazon web services'],
    ['amazonaws', 'amazon web services'],
    ['gcp', 'google cloud platform'],
    ['azure', 'microsoft azure'],
    ['postgresql', 'postgres'],
    ['postgres db', 'postgres'],
    ['mongo db', 'mongo'],
    ['mongodb', 'mongo'],
    ['reactjs', 'react'],
    ['react.js', 'react'],
    ['react js', 'react'],
    ['nodejs', 'node'],
    ['node.js', 'node'],
    ['node js', 'node'],
    ['vuejs', 'vue'],
    ['vue.js', 'vue'],
    ['angularjs', 'angular'],
    ['angular.js', 'angular'],
    ['kubernetes', 'k8s'],
    ['k8', 'k8s'],
    ['ml', 'machine learning'],
    ['ai', 'artificial intelligence'],
    ['customer handling', 'customer service'],
    ['customer support', 'customer service'],
    ['inventory checks', 'inventory management'],
    ['inventory check', 'inventory management'],
    ['packing and sorting', 'packing'],
    ['route knowledge', 'route planning'],
    ['last-mile delivery', 'delivery operations'],
    ['delivery support', 'delivery operations'],
    ['fork lift', 'forklift'],
    ['data entry operator', 'data entry'],
]);

const QUAL_EXPERIENCE_LEVELS = new Map([
    ['fresher', 0],
    ['entry', 0],
    ['junior', 1],
    ['associate', 2],
    ['mid', 3],
    ['intermediate', 5],
    ['intermidiate', 5],
    ['intermedite', 5],
    ['senior', 7],
    ['senoir', 7],
    ['lead', 8],
    ['principal', 9],
    ['director', 9],
    ['expert', 10],
]);

const EDUCATION_LEVELS = new Map([
    ['high school', 1],
    ['hs', 1],
    ['diploma', 1],
    ['ged', 1],
    ['associate', 2],
    ['aa', 2],
    ['as', 2],
    ['bachelor', 3],
    ['bachlor', 3],
    ['bachellor', 3],
    ['bachalor', 3],
    ['undergraduate', 3],
    ['btech', 3],
    ['b.tech', 3],
    ['be', 3],
    ['b.e', 3],
    ['bs', 3],
    ['bsc', 3],
    ['ba', 3],
    ['master', 4],
    ['masters', 4],
    ['mastar', 4],
    ['graduate', 4],
    ['mtech', 4],
    ['m.tech', 4],
    ['ms', 4],
    ['msc', 4],
    ['ma', 4],
    ['phd', 5],
    ['ph.d', 5],
    ['doctorate', 5],
    ['dphil', 5],
    ['postgraduate', 5],
    ['postdoc', 5],
]);

const TECH_KEYWORDS = [
    'python',
    'java',
    'javascript',
    'typescript',
    'react',
    'angular',
    'vue',
    'node',
    'express',
    'aws',
    'azure',
    'gcp',
    'docker',
    'kubernetes',
    'sql',
    'postgres',
    'mysql',
    'mongo',
    'machine learning',
    'artificial intelligence',
    'data science',
    'devops',
    'jenkins',
    'git',
    'delivery',
    'warehouse',
    'inventory',
    'packing',
    'forklift',
    'customer service',
    'sales',
    'field sales',
    'cash handling',
    'data entry',
];

const REQUIREMENT_META_PREFIXES = [
    'experience:',
    'language:',
    'openings:',
    'role type:',
    'availability:',
    'shift:',
];

const CAPABILITY_WEIGHTS = Object.freeze({
    skills: 0.4,
    experience: 0.35,
    location: 0.15,
    education: 0.1,
});

const numericRegex = /(\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?\s*(k|m|b|lac|lakh|cr|crore)?/gi;

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const levenshtein = (left = '', right = '') => {
    const a = normalizeText(left);
    const b = normalizeText(right);
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (a === b) return 0;
    const previous = new Array(b.length + 1).fill(0).map((_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const upper = previous[j];
            const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + substitutionCost
            );
            diagonal = upper;
        }
    }
    return previous[b.length];
};

const sanitizeText = (value = '') => (
    String(value || '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
        .trim()
);

const parseSingleNumber = (raw = '', unit = '') => {
    try {
        const cleaned = String(raw || '').replace(/,/g, '').trim().replace(/\.$/, '');
        if (!cleaned) return 0;
        const parsed = Number(cleaned);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        const normalizedUnit = normalizeText(unit);
        const multiplierMap = {
            k: 1_000,
            m: 1_000_000,
            b: 1_000_000_000,
            lac: 100_000,
            lakh: 100_000,
            cr: 10_000_000,
            crore: 10_000_000,
        };
        const multiplier = multiplierMap[normalizedUnit] || 1;
        const output = parsed * multiplier;
        if (!Number.isFinite(output) || output < 0) return 0;
        return output;
    } catch (_error) {
        return 0;
    }
};

const extractNumbers = (value = '') => {
    const normalized = sanitizeText(value).toLowerCase();
    if (!normalized) return [];
    const matches = [];
    let match = numericRegex.exec(normalized);
    while (match) {
        const parsed = parseSingleNumber(match[1], match[2] || '');
        if (parsed > 0) matches.push(parsed);
        match = numericRegex.exec(normalized);
    }
    numericRegex.lastIndex = 0;
    return matches;
};

const extractSalaryFromObject = (value = null, mode = 'max') => {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    if (typeof value === 'string') {
        const nums = extractNumbers(value);
        if (!nums.length) return 0;
        return mode === 'min' ? Math.min(...nums) : Math.max(...nums);
    }
    if (typeof value !== 'object') return 0;

    const directKeys = [
        'maxValue',
        'max',
        'value',
        'estimatedValue',
        'minValue',
        'min',
        'amount',
    ];
    const candidates = [];
    for (const key of directKeys) {
        const raw = value[key];
        if (raw === undefined || raw === null) continue;
        const parsed = extractSalaryFromObject(raw, mode);
        if (parsed > 0) candidates.push(parsed);
    }
    if (candidates.length) {
        return mode === 'min' ? Math.min(...candidates) : Math.max(...candidates);
    }
    return 0;
};

const extractSalary = ({ entity = {}, mode = 'max' } = {}) => {
    const fields = [
        'baseSalary',
        'estimatedSalary',
        'salary_range',
        'salaryRange',
        'maxSalary',
        'minSalary',
        'salary',
        'compensation',
        'pay',
        'expectedSalary',
        'salary_expectations',
        'total_compensation',
        'totalCompensation',
    ];
    const values = [];
    for (const field of fields) {
        if (entity[field] === undefined || entity[field] === null) continue;
        const parsed = extractSalaryFromObject(entity[field], mode);
        if (parsed > 0) values.push(parsed);
    }
    if (!values.length) return 0;
    return mode === 'min' ? Math.min(...values) : Math.max(...values);
};

const normalizeSkillToken = (raw = '') => {
    const lowered = normalizeText(raw);
    if (!lowered) return '';
    const alias = SKILL_NORMALIZER.get(lowered) || lowered;
    return alias.replace(/[^\w\s+#.-]/g, ' ').replace(/\s+/g, ' ').trim();
};

const flattenSkills = (value = null) => {
    const queue = [value];
    const seenObjects = new Set();
    const output = new Set();
    while (queue.length) {
        const current = queue.shift();
        if (current === null || current === undefined) continue;
        if (typeof current === 'object') {
            const marker = current;
            if (seenObjects.has(marker)) continue;
            seenObjects.add(marker);
        }
        if (typeof current === 'string') {
            const tokens = current.split(/[,;/|\n]+/g).map((entry) => normalizeSkillToken(entry)).filter(Boolean);
            tokens.forEach((token) => output.add(token));
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
        const normalized = normalizeSkillToken(String(current));
        if (normalized) output.add(normalized);
    }
    return output;
};

const inferSkillsFromText = (entity = {}) => {
    const text = [
        entity?.title,
        entity?.description,
        entity?.summary,
        entity?.requirements,
        entity?.roleName,
    ].map((entry) => sanitizeText(entry)).join(' ').toLowerCase();
    const found = new Set();
    for (const keyword of TECH_KEYWORDS) {
        if (text.includes(keyword)) found.add(normalizeSkillToken(keyword));
    }
    return found;
};

const extractSkills = (entity = {}) => {
    const requirements = Array.isArray(entity?.requirements)
        ? entity.requirements
            .map((value) => sanitizeText(value))
            .filter(Boolean)
            .filter((value) => {
                const lowered = normalizeText(value);
                if (!lowered) return false;
                if (REQUIREMENT_META_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return false;
                if (/\d+\s*-\s*\d+\s*years?/i.test(lowered)) return false;
                if (/\d+\s*\+?\s*years?/i.test(lowered)) return false;
                return true;
            })
        : entity?.requirements;

    const direct = flattenSkills([
        entity?.skills,
        entity?.required_skills,
        entity?.requiredSkills,
        requirements,
        entity?.competencies,
        entity?.technologies,
        entity?.mustHaveSkills,
    ]);
    const inferred = inferSkillsFromText(entity);
    inferred.forEach((token) => direct.add(token));
    return direct;
};

const isSkillMatch = (candidateSkill = '', requiredSkill = '') => {
    const left = normalizeSkillToken(candidateSkill);
    const right = normalizeSkillToken(requiredSkill);
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.includes(right) || right.includes(left)) return true;
    return levenshtein(left, right) <= 2;
};

const parseExperience = (value = null) => {
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) return { years: 0, isMax: false };
        return { years: Math.min(40, Number(value)), isMax: false };
    }
    if (value && typeof value === 'object') {
        const months = Number(value?.monthsOfExperience || value?.months || 0);
        if (Number.isFinite(months) && months > 0) {
            return { years: Math.min(40, months / 12), isMax: false };
        }
    }
    const text = normalizeText(value);
    if (!text) return { years: 0, isMax: false };
    const isMax = text.includes('less than') || text.includes('up to') || text.includes('max');
    for (const [token, levelYears] of QUAL_EXPERIENCE_LEVELS.entries()) {
        if (text.includes(token)) return { years: levelYears, isMax };
    }
    const numbers = extractNumbers(text);
    if (!numbers.length) return { years: 0, isMax };
    const years = (isMax ? Math.max(...numbers) : Math.min(...numbers));
    if (text.includes('month')) return { years: Math.min(40, years / 12), isMax };
    return { years: Math.min(40, years), isMax };
};

const parseEducationLevel = (value = '', isJob = false) => {
    const text = normalizeText(value);
    if (!text) return 0;
    const hits = [];
    for (const [token, level] of EDUCATION_LEVELS.entries()) {
        if (text.includes(token)) hits.push(level);
    }
    if (!hits.length) return 0;
    return isJob ? Math.min(...hits) : Math.max(...hits);
};

const locationToString = (location = null) => {
    if (!location) return '';
    if (typeof location === 'string') return sanitizeText(location);
    if (typeof location !== 'object') return sanitizeText(String(location));
    const address = location?.address && typeof location.address === 'object' ? location.address : location;
    const parts = [
        address?.addressLocality,
        address?.addressRegion,
        address?.postalCode,
        address?.addressCountry,
    ].map((entry) => sanitizeText(entry)).filter(Boolean);
    return parts.join(', ');
};

const isRemoteJob = (job = {}) => {
    const text = `${locationToString(job.location)} ${sanitizeText(job.jobLocationType)} ${sanitizeText(job.description)}`.toLowerCase();
    if (Boolean(job.remote) || Boolean(job.remoteAllowed)) return true;
    return REMOTE_KEYWORDS.some((token) => text.includes(token));
};

const scoreLocation = ({ profile = {}, job = {} } = {}) => {
    if (isRemoteJob(job)) return 1;
    const profileLocation = normalizeText(locationToString(profile.location || profile.city));
    const jobLocation = normalizeText(locationToString(job.location || job.jobLocation));
    if (!profileLocation || !jobLocation) return 0.8;
    if (profileLocation === jobLocation) return 1;
    const profileTokens = profileLocation.split(/[,;/]+/g).map((entry) => normalizeText(entry)).filter(Boolean);
    const jobTokens = jobLocation.split(/[,;/]+/g).map((entry) => normalizeText(entry)).filter(Boolean);
    for (const profileToken of profileTokens) {
        for (const jobToken of jobTokens) {
            if (!profileToken || !jobToken) continue;
            if (profileToken === jobToken) return 1;
            if (profileToken.includes(jobToken) || jobToken.includes(profileToken)) return 0.92;
            if (levenshtein(profileToken, jobToken) <= 2) return 0.88;
        }
    }
    return 0.5;
};

const scoreSkills = ({ profileSkills = new Set(), jobSkills = new Set() } = {}) => {
    if (!jobSkills.size) return { score: 0.5, overlap: 0.5 };
    if (!profileSkills.size) return { score: 0.2, overlap: 0 };
    let matched = 0;
    for (const required of jobSkills) {
        let hit = false;
        for (const candidate of profileSkills) {
            if (isSkillMatch(candidate, required)) {
                hit = true;
                break;
            }
        }
        if (hit) matched += 1;
    }
    const overlap = clamp01(matched / Math.max(1, jobSkills.size));
    return { score: overlap, overlap };
};

const scoreExperience = ({ profileYears = 0, jobYears = 0, jobIsMax = false } = {}) => {
    if (jobYears <= 0) return 1;
    if (profileYears <= 0) return 0.3;
    if (jobIsMax) {
        if (profileYears <= jobYears) return 1;
        return clamp01(jobYears / profileYears);
    }
    return clamp01(profileYears / jobYears);
};

const scoreSalaryViability = ({ jobSalary = 0, profileExpected = 0 } = {}) => {
    if (jobSalary <= 0 || profileExpected <= 0) return { viability: 0.6, rank: 0 };
    const ratio = jobSalary / profileExpected;
    let viability = 0.2;
    if (ratio < 0.5) viability = 0.2;
    else if (ratio < 0.8) viability = 0.5 + ((ratio - 0.5) / 0.3) * 0.3;
    else if (ratio < 1.0) viability = 0.8 + ((ratio - 0.8) / 0.2) * 0.2;
    else viability = Math.min(1.2, 1 + ((ratio - 1) * 0.1));
    const rank = clamp01(jobSalary / (profileExpected * 1.5));
    return {
        viability: clamp01(viability),
        rank,
    };
};

const scoreEducation = ({ profileEducation = 0, jobEducation = 0 } = {}) => {
    if (jobEducation <= 0) return 0.8;
    if (profileEducation >= jobEducation) return 1;
    if (profileEducation > 0) return 0.6;
    return 0.3;
};

const evaluateCompositeMatch = ({ profile = {}, job = {} } = {}) => {
    try {
        const profileSkills = extractSkills(profile);
        const jobSkills = extractSkills(job);
        const skillAssessment = scoreSkills({ profileSkills, jobSkills });

        const profileExperience = parseExperience(
            profile.experience_years
            ?? profile.experienceInRole
            ?? profile.totalExperience
            ?? profile.experience
        );
        const jobExperience = parseExperience(
            job.experience_required
            ?? job.experienceYears
            ?? job.experienceRequirements
            ?? job.requirements
        );

        const jobSalary = extractSalary({ entity: job, mode: 'max' });
        const profileExpected = extractSalary({ entity: profile, mode: 'min' });
        const salary = scoreSalaryViability({ jobSalary, profileExpected });

        const profileEducation = parseEducationLevel(
            profile.education || profile.educationLevel || profile.highestEducation,
            false
        );
        const jobEducation = parseEducationLevel(
            job.education_required || job.educationRequirements || job.education,
            true
        );

        const locationScore = scoreLocation({ profile, job });
        const experienceScore = scoreExperience({
            profileYears: profileExperience.years,
            jobYears: jobExperience.years,
            jobIsMax: jobExperience.isMax,
        });
        const educationScore = scoreEducation({
            profileEducation,
            jobEducation,
        });

        const legacyCapabilityScore = clamp01(
            (skillAssessment.score * CAPABILITY_WEIGHTS.skills)
            + (experienceScore * CAPABILITY_WEIGHTS.experience)
            + (locationScore * CAPABILITY_WEIGHTS.location)
            + (educationScore * CAPABILITY_WEIGHTS.education)
        );

        const legacyFinalScore = clamp01(
            (legacyCapabilityScore * salary.viability * 0.85)
            + (salary.rank * 0.15)
        );

        const phase3 = calculatePhase3SemanticScore({
            profile,
            job,
            profileSkills,
            jobSkills,
            profileYears: profileExperience.years,
            jobYears: jobExperience.years,
            jobIsMax: jobExperience.isMax,
            jobSalary,
            profileExpectedSalary: profileExpected,
        });

        const blendedSkillScore = clamp01(
            (skillAssessment.score * 0.45) + (Number(phase3.semanticSkillScore || 0) * 0.55)
        );
        const blendedCapabilityScore = clamp01(
            (blendedSkillScore * CAPABILITY_WEIGHTS.skills)
            + (experienceScore * CAPABILITY_WEIGHTS.experience)
            + (locationScore * CAPABILITY_WEIGHTS.location)
            + (educationScore * CAPABILITY_WEIGHTS.education)
        );
        const phase3CompositeScore = clamp01(Number(phase3.phase3CompositeScore || 0));

        // Phase-3 semantic score is dominant; legacy deterministic score is retained as stabilizer.
        const finalScore = clamp01(
            (phase3CompositeScore * 0.7)
            + (legacyFinalScore * 0.3)
        );

        return {
            finalScore: Number(finalScore.toFixed(4)),
            capabilityScore: Number(blendedCapabilityScore.toFixed(4)),
            legacyCapabilityScore: Number(legacyCapabilityScore.toFixed(4)),
            legacyFinalScore: Number(legacyFinalScore.toFixed(4)),
            parsed: {
                jobSalary,
                profileExpectedSalary: profileExpected,
                profileExperienceYears: Number(profileExperience.years.toFixed(2)),
                jobExperienceYears: Number(jobExperience.years.toFixed(2)),
                profileEducation,
                jobEducation,
            },
            components: {
                rawSkillOverlap: Number(skillAssessment.overlap.toFixed(4)),
                skillScore: Number(blendedSkillScore.toFixed(4)),
                lexicalSkillScore: Number(skillAssessment.score.toFixed(4)),
                semanticSkillScore: Number(phase3.semanticSkillScore || 0),
                baseSemanticOverlap: Number(phase3.baseSemanticOverlap || 0),
                roleBonusApplied: Boolean(phase3.roleBonusApplied),
                roleBonusValue: Number(phase3.roleBonusValue || 0),
                experienceScore: Number(experienceScore.toFixed(4)),
                experienceGaussianScore: Number(phase3.experienceGaussianScore || 0),
                salaryViability: Number(salary.viability.toFixed(4)),
                economicViabilityScore: Number(phase3.economicViabilityScore || 0),
                salaryRank: Number(salary.rank.toFixed(4)),
                locationScore: Number(locationScore.toFixed(4)),
                educationScore: Number(educationScore.toFixed(4)),
                phase3CompositeScore: Number(phase3CompositeScore.toFixed(4)),
            },
        };
    } catch (_error) {
        return {
            finalScore: 0.5,
            capabilityScore: 0.5,
            legacyCapabilityScore: 0.5,
            legacyFinalScore: 0.5,
            parsed: {
                jobSalary: 0,
                profileExpectedSalary: 0,
                profileExperienceYears: 0,
                jobExperienceYears: 0,
                profileEducation: 0,
                jobEducation: 0,
            },
            components: {
                rawSkillOverlap: 0.5,
                skillScore: 0.5,
                lexicalSkillScore: 0.5,
                semanticSkillScore: 0.5,
                baseSemanticOverlap: 0.5,
                roleBonusApplied: false,
                roleBonusValue: 0,
                experienceScore: 0.5,
                experienceGaussianScore: 0.5,
                salaryViability: 0.6,
                economicViabilityScore: 0.6,
                salaryRank: 0,
                locationScore: 0.8,
                educationScore: 0.8,
                phase3CompositeScore: 0.5,
            },
        };
    }
};

module.exports = {
    evaluateCompositeMatch,
};
