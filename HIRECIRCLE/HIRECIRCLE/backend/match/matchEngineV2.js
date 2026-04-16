const algo = require('../utils/matchingAlgorithm');
const { evaluateCompositeMatch } = require('./apexSynthesisMatcher');
const { getApDistanceScore, getApRegionalAdjustment } = require('./apMatchEngineV19');
const { isUserProfileMarkedComplete } = require('../services/profileCompletionService');
const { getNormalizedLocationParts } = require('../utils/locationFields');

const MAX_RESULTS = 20;

const TIERS = {
    STRONG: 0.82,
    GOOD: 0.70,
    POSSIBLE: 0.62,
};

const HARD_GATE_REASONS = {
    NULL_CRITICAL_FIELDS: 'NULL_CRITICAL_FIELDS',
    ROLE_MISMATCH: 'ROLE_MISMATCH',
    SKILL_OVERLAP_BELOW_MINIMUM: 'SKILL_OVERLAP_BELOW_MINIMUM',
    CERTIFICATION_MISSING: 'CERTIFICATION_MISSING',
    SHIFT_MISMATCH: 'SHIFT_MISMATCH',
    COMMUTE_OUTSIDE_RADIUS: 'COMMUTE_OUTSIDE_RADIUS',
    SALARY_OUTSIDE_RANGE: 'SALARY_OUTSIDE_RANGE',
};

const DEFAULT_ADAPTIVE_WEIGHTS = {
    skillWeight: 0.4,
    experienceWeight: 0.25,
    salaryToleranceWeight: 0.2,
    commuteToleranceWeight: 0.15,
};

const COMPONENT_WEIGHTS = {
    salary: algo.CONFIG.W_SALARY,
    skills: algo.CONFIG.W_SKILLS,
    experience: algo.CONFIG.W_EXPERIENCE,
    locationGate: 1,
    shiftGate: 1,
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();
const clamp01 = (value) => Math.min(1, Math.max(0, Number(value) || 0));
const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};

const toClarityImpactLabel = (score) => {
    const normalized = clamp01(score);
    if (normalized >= 0.8) return 'Clear';
    if (normalized >= 0.6) return 'Good';
    return 'Needs Review';
};

const toEpoch = (value) => {
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
};

const resolveRecencyEpoch = (row = {}) => {
    const jobRecency = toEpoch(row?.job?.createdAt || row?.job?.updatedAt);
    if (jobRecency > 0) return jobRecency;

    const applicationRecency = toEpoch(row?.applicationMeta?.updatedAt || row?.applicationMeta?.createdAt);
    if (applicationRecency > 0) return applicationRecency;

    const workerRecency = toEpoch(row?.worker?.updatedAt || row?.worker?.createdAt);
    if (workerRecency > 0) return workerRecency;

    return 0;
};

const extractRequiredExperience = (requirements = []) => {
    const text = Array.isArray(requirements) ? requirements.join(' ') : String(requirements || '');
    const rangeMatch = text.match(/(\d+)\s*-\s*(\d+)\s*years?/i);
    if (rangeMatch) {
        const first = Number(rangeMatch[1] || 0);
        const second = Number(rangeMatch[2] || 0);
        if (Number.isFinite(first) && Number.isFinite(second)) {
            return Math.max(0, Math.min(first, second));
        }
    }

    const plusMatch = text.match(/(\d+)\s*\+\s*years?/i);
    if (plusMatch) {
        return Number(plusMatch[1] || 0);
    }

    const match = text.match(/(\d+)\s+years?/i);
    return Number(match?.[1] || 0);
};

const REQUIREMENT_META_PREFIXES = [
    'experience:',
    'language:',
    'openings:',
    'role type:',
];

const toNormalizedRequirement = (value = '') => String(value || '').trim();

const extractSkillRequirements = (requirements = []) => (
    (Array.isArray(requirements) ? requirements : [])
        .map((item) => toNormalizedRequirement(item))
        .filter(Boolean)
        .filter((item) => {
            const lower = item.toLowerCase();
            if (REQUIREMENT_META_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
                return false;
            }
            if (/\d+\s*-\s*\d+\s*years?/i.test(lower)) return false;
            if (/\d+\s+years?/i.test(lower)) return false;
            return true;
        })
);

const getShiftPreference = ({ worker = {}, roleData = {} }) => {
    const roleShift = normalizeText(roleData?.preferredShift);
    if (roleShift) return roleShift;
    return normalizeText(worker?.preferredShift || 'flexible');
};

const getShiftCompatibilityScore = (jobShift = 'flexible', workerShift = 'flexible') => {
    const normalizedJobShift = normalizeText(jobShift || 'flexible');
    const normalizedWorkerShift = normalizeText(workerShift || 'flexible');
    if (normalizedJobShift === 'flexible' || normalizedWorkerShift === 'flexible') return 1;
    return normalizedJobShift === normalizedWorkerShift ? 1 : 0;
};

const hasMandatoryLicenses = ({ job = {}, worker = {} }) => {
    const required = Array.isArray(job.mandatoryLicenses) ? job.mandatoryLicenses : [];
    if (!required.length) return true;

    // Guard against noisy/misclassified job payloads:
    // enforce license gate only when the role context indicates driving/vehicle operations.
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
    const shouldEnforce = mobilityKeywords.some((keyword) => jobText.includes(keyword));
    if (!shouldEnforce) return true;

    const workerLicenses = Array.isArray(worker.licenses) ? worker.licenses : [];
    const normalizedWorker = workerLicenses.map((value) => normalizeText(value));

    return required.every((requiredLicense) => {
        const requiredValue = normalizeText(requiredLicense);
        return normalizedWorker.some((ownedLicense) => ownedLicense.includes(requiredValue));
    });
};

const getDistanceScore = ({ job = {}, worker = {}, scoringContext = {} }) => {
    const jobLocation = getNormalizedLocationParts(job);
    const workerLocation = getNormalizedLocationParts(worker);
    const jobDistrict = jobLocation.district;
    const workerDistrict = workerLocation.district;
    const jobMandal = jobLocation.mandal;
    const workerMandal = workerLocation.mandal;

    if (!jobDistrict || !workerDistrict) {
        return {
            distanceScore: 0.8,
            outsideRadius: false,
            toleranceApplied: false,
        };
    }

    const remoteText = `${String(job.location || '')} ${String(job.locationLabel || '')} ${String(job.jobLocationType || '')} ${String(job.description || '')}`.toLowerCase();
    const remoteAllowed = Boolean(job?.remoteAllowed || job?.remote) || ['remote', 'wfh', 'telecommute', 'work from home', 'anywhere'].some((token) => remoteText.includes(token));
    if (remoteAllowed) {
        return {
            distanceScore: 1,
            outsideRadius: false,
            toleranceApplied: false,
        };
    }

    if (jobDistrict === workerDistrict && jobMandal && workerMandal && jobMandal === workerMandal) {
        return {
            distanceScore: 1,
            outsideRadius: false,
            toleranceApplied: false,
        };
    }

    if (jobDistrict === workerDistrict) {
        return {
            distanceScore: 0.93,
            outsideRadius: false,
            toleranceApplied: false,
        };
    }

    const apDistanceScore = getApDistanceScore({ job, worker, scoringContext });
    if (apDistanceScore) {
        return apDistanceScore;
    }

    const jobLocationLabel = jobLocation.locationLabel;
    const workerLocationLabel = workerLocation.locationLabel;
    if (
        (jobMandal && workerMandal && (jobMandal.includes(workerMandal) || workerMandal.includes(jobMandal)))
        || (jobLocationLabel && workerLocationLabel && (jobLocationLabel.includes(workerLocationLabel) || workerLocationLabel.includes(jobLocationLabel)))
    ) {
        return {
            distanceScore: 0.9,
            outsideRadius: false,
            toleranceApplied: true,
        };
    }

    const toleranceEnabled = scoringContext?.distanceToleranceEnabled !== false;
    if (toleranceEnabled) {
        return {
            distanceScore: clamp01(scoringContext.distanceFallbackScore || 0.58),
            outsideRadius: false,
            toleranceApplied: true,
        };
    }

    return {
        distanceScore: 0.4,
        outsideRadius: true,
        toleranceApplied: false,
    };
};

const isCriticalFieldsMissing = ({ job = {}, worker = {}, roleData = {} }) => {
    if (!job?._id || !job.title || !(job.location || job.district)) return true;
    if (!worker?._id || !(worker.city || worker.district)) return true;
    if (!roleData?.roleName) return true;
    return false;
};

const computeProfileCompleteness = ({ worker = {}, workerUser = {}, roleData = {} }) => {
    const checks = [
        Boolean(worker.firstName),
        Boolean(worker.district || worker.city),
        Boolean(Array.isArray(roleData.skills) && roleData.skills.length > 0),
        Number(roleData.experienceInRole || 0) > 0,
        Number(roleData.expectedSalary || 0) > 0,
        Boolean(worker.interviewVerified),
        isUserProfileMarkedComplete(workerUser),
    ];

    const completed = checks.filter(Boolean).length;
    return clamp01(completed / checks.length);
};

const getVerificationStatus = ({ worker = {}, workerUser = {} }) => Boolean(
    workerUser?.isVerified || worker?.interviewVerified
);

const getLastActive = ({ worker = {} }) => worker?.lastActiveAt || worker?.updatedAt || worker?.createdAt || new Date(0);

const computeTrustTieBreaker = (row = {}) => {
    const source = row.trustMetrics || row;
    const trustScore = clamp(source.trustScore || 0, 0, 100) / 100;
    const hireSuccessScore = clamp(source.hireSuccessScore || 0, 0, 100) / 100;
    const responseScore = clamp(source.responseScore || 0, 0, 100) / 100;
    return Number(((trustScore * 0.45) + (hireSuccessScore * 0.35) + (responseScore * 0.2)).toFixed(6));
};

const resolveTierThresholds = (thresholds = TIERS) => {
    const strong = clamp(thresholds?.STRONG ?? TIERS.STRONG, 0.75, 0.95);
    const good = clamp(thresholds?.GOOD ?? TIERS.GOOD, 0.60, strong - 0.02);
    const possible = clamp(thresholds?.POSSIBLE ?? TIERS.POSSIBLE, 0.50, good - 0.02);

    return {
        STRONG: Number(strong.toFixed(2)),
        GOOD: Number(good.toFixed(2)),
        POSSIBLE: Number(possible.toFixed(2)),
    };
};

const resolveAdaptiveWeights = (scoringContext = {}) => {
    const input = scoringContext?.adaptiveWeights || {};
    const skillWeight = clamp(input.skillWeight ?? DEFAULT_ADAPTIVE_WEIGHTS.skillWeight, 0.22, 0.55);
    const experienceWeight = clamp(input.experienceWeight ?? DEFAULT_ADAPTIVE_WEIGHTS.experienceWeight, 0.15, 0.38);
    const salaryToleranceWeight = clamp(input.salaryToleranceWeight ?? DEFAULT_ADAPTIVE_WEIGHTS.salaryToleranceWeight, 0.08, 0.35);
    const commuteToleranceWeight = clamp(input.commuteToleranceWeight ?? DEFAULT_ADAPTIVE_WEIGHTS.commuteToleranceWeight, 0.07, 0.3);

    const total = skillWeight + experienceWeight + salaryToleranceWeight + commuteToleranceWeight;
    if (!Number.isFinite(total) || total <= 0) return DEFAULT_ADAPTIVE_WEIGHTS;

    return {
        skillWeight: Number((skillWeight / total).toFixed(6)),
        experienceWeight: Number((experienceWeight / total).toFixed(6)),
        salaryToleranceWeight: Number((salaryToleranceWeight / total).toFixed(6)),
        commuteToleranceWeight: Number((commuteToleranceWeight / total).toFixed(6)),
    };
};

const hasSparseMarketSignals = (scoringContext = {}) => {
    const activeWorkerCount = Number(scoringContext?.cityProfile?.activeWorkerCount || 0);
    const tierStats = scoringContext?.conversionSignals?.tierStats || {};
    const servedTotal = ['STRONG', 'GOOD', 'POSSIBLE'].reduce((sum, tier) => {
        const served = Number(tierStats?.[tier]?.served || 0);
        return sum + (Number.isFinite(served) ? served : 0);
    }, 0);

    return servedTotal <= 0 || (Number.isFinite(activeWorkerCount) && activeWorkerCount > 0 && activeWorkerCount <= 10);
};

const mapHardGateReason = (reason = '') => {
    const normalized = String(reason || '').trim().toUpperCase();
    if (normalized === 'ROLE_TOKEN_MISMATCH') return HARD_GATE_REASONS.ROLE_MISMATCH;
    if (normalized === 'SHIFT_MISMATCH') return HARD_GATE_REASONS.SHIFT_MISMATCH;
    if (normalized === 'CERTIFICATION_MISSING') return HARD_GATE_REASONS.CERTIFICATION_MISSING;
    if (normalized === 'LOCATION_MISMATCH') return HARD_GATE_REASONS.COMMUTE_OUTSIDE_RADIUS;
    if (normalized === 'SALARY_OUTSIDE_RANGE') return HARD_GATE_REASONS.SALARY_OUTSIDE_RANGE;
    return HARD_GATE_REASONS.NULL_CRITICAL_FIELDS;
};

const mapTier = (score, thresholds = TIERS) => {
    const resolved = resolveTierThresholds(thresholds);
    if (score >= resolved.STRONG) return 'STRONG';
    if (score >= resolved.GOOD) return 'GOOD';
    if (score >= resolved.POSSIBLE) return 'POSSIBLE';
    return 'REJECT';
};

const toLegacyTierLabel = (tier) => {
    if (tier === 'STRONG') return 'Strong Match';
    if (tier === 'GOOD') return 'Good Match';
    if (tier === 'POSSIBLE') return 'Possible Match';
    return 'Rejected';
};

const evaluateRoleAgainstJob = ({ job, worker, workerUser, roleData, scoringContext = {} }) => {
    if (isCriticalFieldsMissing({ job, worker, roleData })) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.NULL_CRITICAL_FIELDS };
    }

    // Hard gates: role, shift, salary ceiling, licenses.
    // Location mismatch is treated as a scoring signal by default.
    const hardGateResult = algo.hardGates(job, worker, roleData);
    const canUseDistanceTolerance = scoringContext?.distanceToleranceEnabled !== false;
    if (!hardGateResult?.passed && !(canUseDistanceTolerance && hardGateResult?.reason === 'LOCATION_MISMATCH')) {
        return { accepted: false, rejectReason: mapHardGateReason(hardGateResult?.reason) };
    }

    if (!hasMandatoryLicenses({ job, worker })) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.CERTIFICATION_MISSING };
    }

    const shift = normalizeText(job.shift || 'flexible');
    const preference = getShiftPreference({ worker, roleData });
    const shiftCompatibilityScore = getShiftCompatibilityScore(shift, preference);

    const distanceResolution = getDistanceScore({ job, worker, scoringContext });
    if (distanceResolution.outsideRadius && scoringContext?.strictLocationGate === true) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.COMMUTE_OUTSIDE_RADIUS };
    }
    const distanceScore = distanceResolution.distanceScore;

    const tierThresholds = resolveTierThresholds(scoringContext?.dynamicThresholds || TIERS);
    const requiredExp = extractRequiredExperience(job.requirements || []);
    const requiredSkills = extractSkillRequirements(job.requirements || []);
    const adaptiveWeights = resolveAdaptiveWeights(scoringContext);
    const apexResult = evaluateCompositeMatch({
        profile: {
            id: worker?._id,
            userId: workerUser?._id || worker?.user?._id || worker?.user,
            name: [worker?.firstName, worker?.lastName].filter(Boolean).join(' ') || workerUser?.name || '',
            city: worker?.city,
            location: worker?.city,
            roleName: roleData?.roleName,
            expectedSalary: roleData?.expectedSalary,
            salary_expectations: roleData?.expectedSalary,
            experienceInRole: roleData?.experienceInRole,
            experience_years: roleData?.experienceInRole,
            skills: roleData?.skills || [],
            preferredShift: preference,
            education: roleData?.education || worker?.education || workerUser?.education || '',
        },
        job: {
            id: job?._id,
            title: job?.title,
            location: job?.location,
            jobLocation: job?.location,
            remoteAllowed: Boolean(job?.remoteAllowed || job?.remote),
            jobLocationType: job?.jobLocationType,
            description: Array.isArray(job?.requirements) ? job.requirements.join(', ') : String(job?.requirements || ''),
            requirements: Array.isArray(job?.requirements) ? job.requirements : [],
            required_skills: requiredSkills,
            skills: requiredSkills,
            maxSalary: job?.maxSalary || job?.salaryMax || 0,
            salaryRange: job?.salaryRange || '',
            experience_required: requiredExp > 0 ? `${requiredExp} years` : (Array.isArray(job?.requirements) ? job.requirements.join(', ') : ''),
            education_required: job?.educationRequired || job?.education || '',
        },
    });

    const rawSkillScore = clamp01(apexResult?.components?.rawSkillOverlap ?? algo.getRawSkillsOverlap(roleData.skills || [], requiredSkills));
    const semanticSkillScore = clamp01(apexResult?.components?.semanticSkillScore ?? apexResult?.components?.skillScore ?? 0);
    const effectiveSkillGateScore = Math.max(rawSkillScore, semanticSkillScore * 0.95);
    const passesSkillGate = rawSkillScore >= 0.3 || semanticSkillScore >= 0.45;
    if (!passesSkillGate) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.SKILL_OVERLAP_BELOW_MINIMUM };
    }
    const skillScore = clamp01(apexResult?.components?.skillScore ?? algo.skillsScore(roleData.skills || [], requiredSkills));
    const experienceScore = clamp01(apexResult?.components?.experienceScore ?? algo.experienceScore(roleData.experienceInRole || 0, requiredExp));
    const salaryFitScore = clamp01(algo.salaryScore(roleData.expectedSalary || 0, job.maxSalary || 0));
    const salaryViabilityScore = clamp01(apexResult?.components?.salaryViability ?? salaryFitScore);
    const economicViabilityScore = clamp01(apexResult?.components?.economicViabilityScore ?? salaryViabilityScore);
    const salaryRankScore = clamp01(apexResult?.components?.salaryRank ?? 0);
    const educationScore = clamp01(apexResult?.components?.educationScore ?? 0.8);
    const apexCompositeScore = clamp01(apexResult?.finalScore ?? 0);
    const phase3CompositeScore = clamp01(apexResult?.components?.phase3CompositeScore ?? apexCompositeScore);
    const baseSemanticOverlap = clamp01(apexResult?.components?.baseSemanticOverlap ?? semanticSkillScore);
    const roleBonusApplied = Boolean(apexResult?.components?.roleBonusApplied);
    const roleBonusValue = clamp01(apexResult?.components?.roleBonusValue ?? 0);
    const experienceGaussianScore = clamp01(apexResult?.components?.experienceGaussianScore ?? experienceScore);
    const weightedCapabilityScore = clamp01(
        (skillScore * adaptiveWeights.skillWeight)
        + (experienceScore * adaptiveWeights.experienceWeight)
        + (salaryViabilityScore * adaptiveWeights.salaryToleranceWeight)
        + (distanceScore * adaptiveWeights.commuteToleranceWeight)
    );
    const profileCompletenessMultiplier = computeProfileCompleteness({ worker, workerUser, roleData });
    const qualityFactor = clamp(algo.calculateQualityFactor(job, worker), 0.8, 1);
    const profileCompletenessPenalty = clamp(0.85 + (profileCompletenessMultiplier * 0.15), 0.85, 1);

    const verificationStatus = getVerificationStatus({ worker, workerUser });
    const profileStrengthScore = clamp01(
        scoringContext?.profileQualityScore
        ?? worker?.interviewIntelligence?.profileQualityScore
        ?? 0
    );
    const communicationClarityScore = clamp01(
        scoringContext?.communicationClarityScore
        ?? worker?.interviewIntelligence?.communicationClarityScore
        ?? 0
    );
    const salaryOutlierFlag = Boolean(
        scoringContext?.salaryOutlierFlag
        ?? worker?.interviewIntelligence?.salaryOutlierFlag
        ?? false
    );
    const salaryScoreWithOutlierPenalty = clamp01(
        salaryFitScore * (salaryOutlierFlag ? 0.9 : 1)
    );
    const geometricCoreScore = clamp01(
        algo.criticalComposite(
            salaryScoreWithOutlierPenalty,
            experienceScore,
            skillScore
        )
    );
    const softBonus = clamp01(algo.calculateSoftBonus(job, {
        isVerified: verificationStatus,
        preferredShift: preference,
    }));
    const hybridCoreScore = clamp01(
        (geometricCoreScore * 0.35)
        + (apexCompositeScore * 0.65)
    );
    const educationBlendMultiplier = clamp(0.95 + (educationScore * 0.08), 0.95, 1.03);
    const baseScorePreRegional = clamp01(
        (
            (hybridCoreScore * 0.7)
            + (weightedCapabilityScore * 0.3)
            + (salaryRankScore * 0.04)
            + softBonus
        ) * educationBlendMultiplier
    );
    const apRegional = getApRegionalAdjustment({
        job,
        worker,
        workerUser,
        roleData,
        scoringContext,
        distanceKm: distanceResolution?.distanceKm ?? null,
        requiredExp,
    });
    const apRegionalMultiplier = Number(apRegional?.multiplier) || 1;
    const baseScore = clamp01(baseScorePreRegional * apRegionalMultiplier);
    const sparseMarketSignals = hasSparseMarketSignals(scoringContext);
    const reliabilityFloor = sparseMarketSignals ? 0.97 : 0.9;
    const employerFloor = sparseMarketSignals ? 0.97 : 0.9;
    const moatFloor = sparseMarketSignals ? 0.96 : 0.9;

    const workerReliabilityScore = clamp(scoringContext?.workerReliabilityScore || 1, reliabilityFloor, 1.05);
    const employerStabilityScore = clamp(scoringContext?.employerStabilityScore || 1, reliabilityFloor, 1.05);
    const shiftConsistencyScore = clamp(scoringContext?.shiftConsistencyScore || 1, reliabilityFloor, 1.05);
    const reliabilityMultiplier = clamp(
        workerReliabilityScore * employerStabilityScore * shiftConsistencyScore,
        0.85,
        1.1
    );

    const employerQualityScore = clamp(scoringContext?.employerQualityScore || 1, employerFloor, 1.05);
    const reliabilityHookScore = clamp(
        scoringContext?.reliabilityScore
        ?? worker?.reliabilityScore
        ?? 1,
        sparseMarketSignals ? 0.97 : 0.9,
        1.05
    );
    const profileQualityMultiplier = clamp(0.9 + (profileStrengthScore * 0.1), 0.9, 1);
    const communicationReliabilityPenalty = communicationClarityScore < 0.5 ? 0.95 : 1;
    const reliabilityWithClarity = clamp(
        reliabilityMultiplier * communicationReliabilityPenalty * reliabilityHookScore,
        0.82,
        1.08
    );
    const featureVerifiedPriorityEnabled = Boolean(scoringContext?.featureVerifiedPriorityEnabled);
    const qualifiesVerifiedPriority = (
        featureVerifiedPriorityEnabled
        && verificationStatus
        && profileStrengthScore > 0.75
    );
    const verifiedPriorityMultiplier = qualifiesVerifiedPriority
        ? clamp(1.05 + ((profileStrengthScore - 0.75) * 0.12), 1.05, 1.08)
        : 1;
    const intelligenceMultiplier = clamp(
        profileQualityMultiplier * verifiedPriorityMultiplier,
        0.9,
        1.08
    );
    const trustGraphRankingMultiplier = clamp(scoringContext?.trustGraphRankingMultiplier || 1, 0.9, 1.2);
    const badgeRankingMultiplier = clamp(scoringContext?.badgeRankingMultiplier || 1, 0.95, 1.2);
    const employerBadgeRankingMultiplier = clamp(scoringContext?.employerBadgeRankingMultiplier || 1, 0.95, 1.2);
    const skillReputationMultiplier = clamp(scoringContext?.skillReputationMultiplier || 1, sparseMarketSignals ? 1 : 0.95, 1.12);
    const moatMultiplier = clamp(
        trustGraphRankingMultiplier
        * badgeRankingMultiplier
        * employerBadgeRankingMultiplier
        * skillReputationMultiplier,
        moatFloor,
        1.12
    );
    const multiplierProduct = reliabilityWithClarity * employerQualityScore * intelligenceMultiplier * moatMultiplier;
    const guardedMultiplierFloor = sparseMarketSignals ? 0.85 : 0.72;
    const guardedMultiplier = Math.max(multiplierProduct, guardedMultiplierFloor);
    const finalScore = clamp01(
        baseScore
        * qualityFactor
        * profileCompletenessPenalty
        * guardedMultiplier
    );

    const baseTier = mapTier(baseScore, tierThresholds);
    const tier = baseTier === 'REJECT' ? 'REJECT' : mapTier(finalScore, tierThresholds);
    const accepted = tier !== 'REJECT' && baseTier !== 'REJECT';
    const confidenceDataCompleteness = clamp01(
        (profileCompletenessMultiplier * 0.75) + (distanceResolution.toleranceApplied ? 0.15 : 0.25)
    );
    const confidenceScore = clamp01(
        (confidenceDataCompleteness * 0.7) + ((workerReliabilityScore / 1.1) * 0.3)
    );
    const explainabilityReasons = [];
    if (verificationStatus) explainabilityReasons.push('Verified profile');
    if (communicationClarityScore >= 0.7) explainabilityReasons.push('Strong communication');
    if (!salaryOutlierFlag) explainabilityReasons.push('Salary aligned with market');
    if (skillScore >= 0.8) explainabilityReasons.push('Strong skill alignment');
    if (semanticSkillScore >= 0.82) explainabilityReasons.push('Semantic role-skill alignment is strong');
    if (experienceScore >= 0.7) explainabilityReasons.push('Experience fits role needs');
    if (distanceScore >= 0.85) explainabilityReasons.push('Location fit is strong');
    if (educationScore >= 0.8) explainabilityReasons.push('Education requirements met');
    if (Number(scoringContext?.trustGraphScore || 0) >= 70) explainabilityReasons.push('High trust graph score');
    if (Number(scoringContext?.skillReputationScore || 0) >= 0.65) explainabilityReasons.push('Strong skill reputation');
    if (badgeRankingMultiplier > 1.01) explainabilityReasons.push('Verified badge advantage');

    const resolvedDistanceKm = Number.isFinite(Number(distanceResolution?.distanceKm))
        ? Number(distanceResolution.distanceKm)
        : (distanceScore === 1 ? 0 : 999);

    return {
        accepted,
        rejectReason: accepted ? null : 'SCORE_BELOW_THRESHOLD',
        tier,
        finalScore,
        baseScore,
        skillScore,
        rawSkillScore,
        semanticSkillScore,
        effectiveSkillGateScore,
        experienceScore,
        salaryFitScore,
        distanceScore,
        profileCompletenessMultiplier,
        reliabilityScore: reliabilityWithClarity,
        reliabilityMultiplier,
        employerQualityScore,
        explainability: {
            jobId: String(job._id),
            salaryScore: salaryFitScore,
            salaryViabilityScore,
            economicViabilityScore,
            salaryRankScore,
            skillScore,
            rawSkillScore,
            semanticSkillScore,
            effectiveSkillGateScore,
            baseSemanticOverlap,
            roleBonusApplied,
            roleBonusValue,
            distanceScore,
            experienceScore,
            experienceGaussianScore,
            educationScore,
            profileMultiplier: profileCompletenessMultiplier,
            profileCompletenessPenalty,
            baseScore,
            baseScorePreRegional,
            geometricCoreScore,
            apexCompositeScore,
            phase3CompositeScore,
            hybridCoreScore,
            weightedCapabilityScore,
            qualityFactor,
            softBonus,
            reliabilityMultiplier: reliabilityWithClarity,
            workerReliabilityScore,
            employerStabilityScore,
            shiftConsistencyScore,
            employerQualityScore,
            profileStrengthScore,
            clarityImpact: toClarityImpactLabel(communicationClarityScore),
            salaryAlignmentStatus: salaryOutlierFlag ? 'OUTLIER' : 'ALIGNED',
            confidenceScore,
            confidenceComponents: {
                dataCompleteness: confidenceDataCompleteness,
                modelAgreement: null,
                historicalPatternSimilarity: null,
            },
            frictionSignals: scoringContext?.frictionSignals || {},
            communicationClarityScore,
            profileQualityMultiplier,
            salaryScoreWithOutlierPenalty,
            shiftCompatibilityScore,
            locationScore: distanceScore,
            componentWeights: COMPONENT_WEIGHTS,
            adaptiveWeights,
            communicationReliabilityPenalty,
            featureVerifiedPriorityEnabled,
            verifiedPriorityMultiplier,
            reliabilityHookScore,
            intelligenceMultiplier,
            trustGraphScore: Number(scoringContext?.trustGraphScore || 0),
            trustGraphRankingMultiplier,
            badgeTier: scoringContext?.badgeTier || 'Basic',
            badgeRankingMultiplier,
            employerBadgeTier: scoringContext?.employerBadgeTier || 'Basic',
            employerBadgeRankingMultiplier,
            skillReputationScore: Number(scoringContext?.skillReputationScore || 0),
            skillReputationMultiplier,
            moatMultiplier,
            sparseMarketSignals,
            guardedMultiplierFloor,
            guardedMultiplier,
            topReasons: explainabilityReasons.slice(0, 3),
            finalScore,
            tier,
            apRegional: apRegional ? {
                engineVersion: apRegional.apEngineVersion,
                multiplier: apRegionalMultiplier,
                uncappedMultiplier: apRegional.uncappedMultiplier,
                reasons: apRegional.reasons,
                job: apRegional.job,
                worker: apRegional.worker,
                distanceKm: apRegional.distanceKm,
            } : null,
        },
        verificationStatus,
        profileCompleteness: profileCompletenessMultiplier,
        lastActive: getLastActive({ worker }),
        distanceKm: resolvedDistanceKm,
    };
};

const sortScoredMatches = (left, right) => {
    if (right.finalScore !== left.finalScore) return right.finalScore - left.finalScore;

    const rightTrustTieBreaker = computeTrustTieBreaker(right);
    const leftTrustTieBreaker = computeTrustTieBreaker(left);
    if (rightTrustTieBreaker !== leftTrustTieBreaker) {
        return rightTrustTieBreaker - leftTrustTieBreaker;
    }

    const rightVerified = right.verificationStatus ? 1 : 0;
    const leftVerified = left.verificationStatus ? 1 : 0;
    if (rightVerified !== leftVerified) return rightVerified - leftVerified;

    if (right.profileCompleteness !== left.profileCompleteness) {
        return right.profileCompleteness - left.profileCompleteness;
    }

    const rightRecency = resolveRecencyEpoch(right);
    const leftRecency = resolveRecencyEpoch(left);
    if (rightRecency !== leftRecency) return rightRecency - leftRecency;

    const rightLastActive = toEpoch(right.lastActive);
    const leftLastActive = toEpoch(left.lastActive);
    if (rightLastActive !== leftLastActive) return rightLastActive - leftLastActive;

    const distanceDelta = (left.distanceKm || 999) - (right.distanceKm || 999);
    if (distanceDelta !== 0) return distanceDelta;

    const leftStableId = String(left.jobId || left.job?._id || left.worker?._id || left.workerUser?._id || '');
    const rightStableId = String(right.jobId || right.job?._id || right.worker?._id || right.workerUser?._id || '');
    return leftStableId.localeCompare(rightStableId);
};

const addRejectReason = (accumulator, reason) => {
    const key = reason || 'UNKNOWN';
    accumulator[key] = (accumulator[key] || 0) + 1;
};

const selectRolesForEvaluation = ({ worker = {}, roleCluster = null }) => {
    const roles = Array.isArray(worker.roleProfiles) ? worker.roleProfiles : [];
    const activeRoles = roles.filter((role) => role?.activeProfile === true);
    const candidateRoles = activeRoles.length ? activeRoles : roles;
    if (!roleCluster) return candidateRoles;

    const expected = normalizeText(roleCluster);
    return candidateRoles.filter((roleData) => {
        const roleName = normalizeText(roleData.roleName);
        return roleName.includes(expected) || expected.includes(roleName);
    });
};

const evaluateBestRoleForJob = ({ worker, workerUser, job, roleCluster = null, scoringContext = {} }) => {
    const roles = selectRolesForEvaluation({ worker, roleCluster });
    if (!roles.length) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.NULL_CRITICAL_FIELDS };
    }

    let bestAccepted = null;
    let firstRejection = null;

    for (const roleData of roles) {
        const evaluation = evaluateRoleAgainstJob({ job, worker, workerUser, roleData, scoringContext });
        if (evaluation.accepted) {
            const candidate = {
                ...evaluation,
                roleUsed: roleData.roleName,
                roleData,
            };
            if (!bestAccepted || candidate.finalScore > bestAccepted.finalScore) {
                bestAccepted = candidate;
            }
        } else if (!firstRejection) {
            firstRejection = evaluation;
        }
    }

    return bestAccepted || firstRejection || { accepted: false, rejectReason: 'UNKNOWN' };
};

const rankJobsForWorker = ({
    worker,
    workerUser,
    jobs = [],
    city = null,
    roleCluster = null,
    maxResults = MAX_RESULTS,
    scoringContextResolver = null,
}) => {
    const rejectReasonCounts = {};
    const accepted = [];

    const normalizedCityFilter = normalizeText(city || '');

    for (const job of jobs) {
        if (normalizedCityFilter && normalizeText(job.location) !== normalizedCityFilter) {
            addRejectReason(rejectReasonCounts, 'CITY_FILTER_MISMATCH');
            continue;
        }

        const scoringContext = typeof scoringContextResolver === 'function'
            ? scoringContextResolver(job)
            : {};
        const evaluation = evaluateBestRoleForJob({ worker, workerUser, job, roleCluster, scoringContext });
        if (!evaluation.accepted) {
            addRejectReason(rejectReasonCounts, evaluation.rejectReason);
            continue;
        }

        accepted.push({
            job,
            jobId: job._id,
            roleUsed: evaluation.roleUsed,
            roleData: evaluation.roleData,
            finalScore: evaluation.finalScore,
            matchScore: Math.round(evaluation.finalScore * 100),
            tier: evaluation.tier,
            tierLabel: toLegacyTierLabel(evaluation.tier),
            verificationStatus: evaluation.verificationStatus,
            profileCompleteness: evaluation.profileCompleteness,
            lastActive: evaluation.lastActive,
            distanceKm: evaluation.distanceKm,
            deterministicScores: {
                skillScore: evaluation.skillScore,
                rawSkillScore: evaluation.rawSkillScore,
                experienceScore: evaluation.experienceScore,
                salaryFitScore: evaluation.salaryFitScore,
                distanceScore: evaluation.distanceScore,
                profileCompletenessMultiplier: evaluation.profileCompletenessMultiplier,
                reliabilityScore: evaluation.reliabilityScore,
                baseScore: evaluation.baseScore,
                reliabilityMultiplier: evaluation.reliabilityMultiplier,
                employerQualityScore: evaluation.employerQualityScore,
                profileStrengthScore: evaluation.explainability?.profileStrengthScore || 0,
                communicationClarityScore: evaluation.explainability?.communicationClarityScore || 0,
                intelligenceMultiplier: evaluation.explainability?.intelligenceMultiplier || 1,
                trustGraphRankingMultiplier: evaluation.explainability?.trustGraphRankingMultiplier || 1,
                badgeRankingMultiplier: evaluation.explainability?.badgeRankingMultiplier || 1,
                skillReputationMultiplier: evaluation.explainability?.skillReputationMultiplier || 1,
                moatMultiplier: evaluation.explainability?.moatMultiplier || 1,
            },
            explainability: evaluation.explainability,
            trustMetrics: job?.trustMetrics || null,
            trustTieBreaker: computeTrustTieBreaker(job?.trustMetrics || {}),
        });
    }

    accepted.sort(sortScoredMatches);
    const safeMaxResults = Math.max(0, Math.min(MAX_RESULTS, Number(maxResults) || MAX_RESULTS));
    const topMatches = accepted.slice(0, safeMaxResults);

    const avgScore = topMatches.length
        ? topMatches.reduce((sum, row) => sum + row.finalScore, 0) / topMatches.length
        : 0;

    return {
        matches: topMatches,
        totalConsidered: jobs.length,
        totalReturned: topMatches.length,
        avgScore,
        rejectReasonCounts,
    };
};

const rankWorkersForJob = ({
    job,
    candidates = [],
    roleCluster = null,
    maxResults = MAX_RESULTS,
    scoringContextResolver = null,
}) => {
    const rejectReasonCounts = {};
    const accepted = [];

    for (const candidate of candidates) {
        const worker = candidate.worker;
        const workerUser = candidate.user || worker?.user;

        const scoringContext = typeof scoringContextResolver === 'function'
            ? scoringContextResolver({ job, candidate })
            : {};
        const evaluation = evaluateBestRoleForJob({ worker, workerUser, job, roleCluster, scoringContext });
        if (!evaluation.accepted) {
            addRejectReason(rejectReasonCounts, evaluation.rejectReason);
            continue;
        }

        accepted.push({
            worker,
            workerUser,
            applicationMeta: candidate.applicationMeta || null,
            roleUsed: evaluation.roleUsed,
            roleData: evaluation.roleData,
            finalScore: evaluation.finalScore,
            matchScore: Math.round(evaluation.finalScore * 100),
            tier: evaluation.tier,
            tierLabel: toLegacyTierLabel(evaluation.tier),
            verificationStatus: evaluation.verificationStatus,
            profileCompleteness: evaluation.profileCompleteness,
            lastActive: evaluation.lastActive,
            distanceKm: evaluation.distanceKm,
            deterministicScores: {
                skillScore: evaluation.skillScore,
                rawSkillScore: evaluation.rawSkillScore,
                experienceScore: evaluation.experienceScore,
                salaryFitScore: evaluation.salaryFitScore,
                distanceScore: evaluation.distanceScore,
                profileCompletenessMultiplier: evaluation.profileCompletenessMultiplier,
                reliabilityScore: evaluation.reliabilityScore,
                baseScore: evaluation.baseScore,
                reliabilityMultiplier: evaluation.reliabilityMultiplier,
                employerQualityScore: evaluation.employerQualityScore,
                profileStrengthScore: evaluation.explainability?.profileStrengthScore || 0,
                communicationClarityScore: evaluation.explainability?.communicationClarityScore || 0,
                intelligenceMultiplier: evaluation.explainability?.intelligenceMultiplier || 1,
                trustGraphRankingMultiplier: evaluation.explainability?.trustGraphRankingMultiplier || 1,
                badgeRankingMultiplier: evaluation.explainability?.badgeRankingMultiplier || 1,
                skillReputationMultiplier: evaluation.explainability?.skillReputationMultiplier || 1,
                moatMultiplier: evaluation.explainability?.moatMultiplier || 1,
            },
            explainability: evaluation.explainability,
            trustMetrics: candidate?.trustMetrics || null,
            trustTieBreaker: computeTrustTieBreaker(candidate?.trustMetrics || {}),
        });
    }

    accepted.sort(sortScoredMatches);
    const safeMaxResults = Math.max(0, Math.min(MAX_RESULTS, Number(maxResults) || MAX_RESULTS));
    const topMatches = accepted.slice(0, safeMaxResults);

    const avgScore = topMatches.length
        ? topMatches.reduce((sum, row) => sum + row.finalScore, 0) / topMatches.length
        : 0;

    return {
        matches: topMatches,
        totalConsidered: candidates.length,
        totalReturned: topMatches.length,
        avgScore,
        rejectReasonCounts,
    };
};

module.exports = {
    MAX_RESULTS,
    TIERS,
    HARD_GATE_REASONS,
    mapTier,
    resolveTierThresholds,
    resolveAdaptiveWeights,
    toLegacyTierLabel,
    extractRequiredExperience,
    computeProfileCompleteness,
    evaluateRoleAgainstJob,
    evaluateBestRoleForJob,
    rankJobsForWorker,
    rankWorkersForJob,
    sortScoredMatches,
};
