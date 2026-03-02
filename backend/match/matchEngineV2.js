const algo = require('../utils/matchingAlgorithm');

const MAX_RESULTS = 20;

const TIERS = {
    STRONG: 0.82,
    GOOD: 0.70,
    POSSIBLE: 0.62,
};

const HARD_GATE_REASONS = {
    NULL_CRITICAL_FIELDS: 'NULL_CRITICAL_FIELDS',
    ROLE_MISMATCH: 'ROLE_MISMATCH',
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

const tokenize = (text = '') => new Set(
    String(text || '')
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
);

const hasRoleOverlap = (jobTitle, roleName) => {
    const jobTokens = tokenize(jobTitle);
    const roleTokens = tokenize(roleName);
    if (!jobTokens.size || !roleTokens.size) return false;

    for (const token of jobTokens) {
        if (roleTokens.has(token)) return true;
    }

    for (const jobToken of jobTokens) {
        for (const roleToken of roleTokens) {
            if (jobToken.includes(roleToken) || roleToken.includes(jobToken)) return true;
        }
    }

    return false;
};

const extractRequiredExperience = (requirements = []) => {
    const text = Array.isArray(requirements) ? requirements.join(' ') : String(requirements || '');
    const match = text.match(/(\d+)\s+years?/i);
    return Number(match?.[1] || 0);
};

const getShiftPreference = ({ worker = {}, roleData = {} }) => {
    const roleShift = normalizeText(roleData?.preferredShift);
    if (roleShift) return roleShift;
    return normalizeText(worker?.preferredShift || 'flexible');
};

const hasMandatoryLicenses = ({ job = {}, worker = {} }) => {
    const required = Array.isArray(job.mandatoryLicenses) ? job.mandatoryLicenses : [];
    if (!required.length) return true;

    const workerLicenses = Array.isArray(worker.licenses) ? worker.licenses : [];
    const normalizedWorker = workerLicenses.map((value) => normalizeText(value));

    return required.every((requiredLicense) => {
        const requiredValue = normalizeText(requiredLicense);
        return normalizedWorker.some((ownedLicense) => ownedLicense.includes(requiredValue));
    });
};

const getDistanceScore = ({ job = {}, worker = {}, scoringContext = {} }) => {
    const jobCity = normalizeText(job.location);
    const workerCity = normalizeText(worker.city);
    if (!jobCity || !workerCity) {
        return {
            distanceScore: 0,
            outsideRadius: true,
            toleranceApplied: false,
        };
    }

    if (jobCity === workerCity) {
        return {
            distanceScore: 1,
            outsideRadius: false,
            toleranceApplied: false,
        };
    }

    if (scoringContext?.distanceToleranceEnabled) {
        return {
            distanceScore: clamp01(scoringContext.distanceFallbackScore || 0.72),
            outsideRadius: false,
            toleranceApplied: true,
        };
    }

    return {
        distanceScore: 0,
        outsideRadius: true,
        toleranceApplied: false,
    };
};

const isCriticalFieldsMissing = ({ job = {}, worker = {}, roleData = {} }) => {
    if (!job?._id || !job.title || !job.location) return true;
    if (!worker?._id || !worker.city) return true;
    if (!roleData?.roleName) return true;
    return false;
};

const computeProfileCompleteness = ({ worker = {}, workerUser = {}, roleData = {} }) => {
    const checks = [
        Boolean(worker.firstName),
        Boolean(worker.city),
        Boolean(Array.isArray(roleData.skills) && roleData.skills.length > 0),
        Number(roleData.experienceInRole || 0) > 0,
        Number(roleData.expectedSalary || 0) > 0,
        Boolean(worker.interviewVerified),
        Boolean(workerUser.hasCompletedProfile),
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

    if (!hasRoleOverlap(job.title, roleData.roleName)) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.ROLE_MISMATCH };
    }

    if (!hasMandatoryLicenses({ job, worker })) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.CERTIFICATION_MISSING };
    }

    const shift = normalizeText(job.shift || 'flexible');
    const preference = getShiftPreference({ worker, roleData });
    if (shift !== 'flexible' && preference !== 'flexible' && shift !== preference) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.SHIFT_MISMATCH };
    }

    const distanceResolution = getDistanceScore({ job, worker, scoringContext });
    if (distanceResolution.outsideRadius) {
        return { accepted: false, rejectReason: HARD_GATE_REASONS.COMMUTE_OUTSIDE_RADIUS };
    }
    const distanceScore = distanceResolution.distanceScore;

    if (Number(job.maxSalary || 0) > 0 && Number(roleData.expectedSalary || 0) > 0) {
        if (Number(roleData.expectedSalary) > Number(job.maxSalary) * 1.15) {
            return { accepted: false, rejectReason: HARD_GATE_REASONS.SALARY_OUTSIDE_RANGE };
        }
    }

    const tierThresholds = resolveTierThresholds(scoringContext?.dynamicThresholds || TIERS);
    const requiredExp = extractRequiredExperience(job.requirements || []);
    const rawSkillScore = clamp01(algo.skillsScore(roleData.skills || [], job.requirements || []));
    const experienceScore = clamp01(algo.experienceScore(roleData.experienceInRole || 0, requiredExp));
    const salaryFitScore = clamp01(algo.salaryScore(roleData.expectedSalary || 0, job.maxSalary || 0));
    const profileCompletenessMultiplier = computeProfileCompleteness({ worker, workerUser, roleData });
    const skillWeightDelta = clamp(scoringContext?.skillWeightDelta || 0, -0.05, 0.05);
    const weightedSkillScore = clamp01(rawSkillScore * (1 + skillWeightDelta));
    const distanceWeightExponent = clamp(scoringContext?.distanceWeightExponent || 1, 0.8, 1.2);
    const weightedDistanceScore = clamp01(Math.pow(distanceScore, distanceWeightExponent));

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
    const adaptiveWeights = resolveAdaptiveWeights(scoringContext);
    const adaptiveComposite = clamp01(
        (weightedSkillScore * adaptiveWeights.skillWeight)
        + (experienceScore * adaptiveWeights.experienceWeight)
        + (salaryScoreWithOutlierPenalty * adaptiveWeights.salaryToleranceWeight)
        + (weightedDistanceScore * adaptiveWeights.commuteToleranceWeight)
    );
    const adaptiveWeightMultiplier = clamp(0.9 + (adaptiveComposite * 0.2), 0.9, 1.1);
    const baseScore = clamp01(
        weightedSkillScore
        * experienceScore
        * salaryScoreWithOutlierPenalty
        * weightedDistanceScore
        * profileCompletenessMultiplier
        * adaptiveWeightMultiplier
    );

    const workerReliabilityScore = clamp(scoringContext?.workerReliabilityScore || 1, 0.9, 1.1);
    const employerStabilityScore = clamp(scoringContext?.employerStabilityScore || 1, 0.9, 1.1);
    const shiftConsistencyScore = clamp(scoringContext?.shiftConsistencyScore || 1, 0.9, 1.1);
    const reliabilityMultiplier = clamp(
        workerReliabilityScore * employerStabilityScore * shiftConsistencyScore,
        0.85,
        1.15
    );

    const employerQualityScore = clamp(scoringContext?.employerQualityScore || 1, 0.9, 1.1);
    const reliabilityHookScore = clamp(
        scoringContext?.reliabilityScore
        ?? worker?.reliabilityScore
        ?? 1,
        0.95,
        1.05
    );
    const profileQualityMultiplier = clamp(0.9 + (profileStrengthScore * 0.1), 0.9, 1);
    const communicationReliabilityPenalty = communicationClarityScore < 0.5 ? 0.96 : 1;
    const reliabilityWithClarity = clamp(
        reliabilityMultiplier * communicationReliabilityPenalty,
        0.85,
        1.15
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
        profileQualityMultiplier * verifiedPriorityMultiplier * reliabilityHookScore,
        0.9,
        1.12
    );
    const trustGraphRankingMultiplier = clamp(scoringContext?.trustGraphRankingMultiplier || 1, 0.9, 1.2);
    const badgeRankingMultiplier = clamp(scoringContext?.badgeRankingMultiplier || 1, 0.95, 1.2);
    const employerBadgeRankingMultiplier = clamp(scoringContext?.employerBadgeRankingMultiplier || 1, 0.95, 1.2);
    const skillReputationMultiplier = clamp(scoringContext?.skillReputationMultiplier || 1, 0.95, 1.12);
    const moatMultiplier = clamp(
        trustGraphRankingMultiplier
        * badgeRankingMultiplier
        * employerBadgeRankingMultiplier
        * skillReputationMultiplier,
        0.9,
        1.25
    );
    const finalScore = clamp01(
        baseScore
        * reliabilityWithClarity
        * employerQualityScore
        * intelligenceMultiplier
        * moatMultiplier
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
    if (weightedSkillScore >= 0.8) explainabilityReasons.push('Strong skill alignment');
    if (experienceScore >= 0.7) explainabilityReasons.push('Experience fits role needs');
    if (Number(scoringContext?.trustGraphScore || 0) >= 70) explainabilityReasons.push('High trust graph score');
    if (Number(scoringContext?.skillReputationScore || 0) >= 0.65) explainabilityReasons.push('Strong skill reputation');
    if (badgeRankingMultiplier > 1.01) explainabilityReasons.push('Verified badge advantage');

    return {
        accepted,
        rejectReason: accepted ? null : 'SCORE_BELOW_THRESHOLD',
        tier,
        finalScore,
        baseScore,
        skillScore: weightedSkillScore,
        rawSkillScore,
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
            skillScore: weightedSkillScore,
            rawSkillScore,
            distanceScore,
            experienceScore,
            profileMultiplier: profileCompletenessMultiplier,
            baseScore,
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
            communicationReliabilityPenalty,
            adaptiveComposite,
            adaptiveWeightMultiplier,
            adaptiveWeights,
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
            topReasons: explainabilityReasons.slice(0, 3),
            finalScore,
            tier,
        },
        verificationStatus,
        profileCompleteness: profileCompletenessMultiplier,
        lastActive: getLastActive({ worker }),
        distanceKm: distanceScore === 1 ? 0 : 999,
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
    if (!roleCluster) return roles;

    const expected = normalizeText(roleCluster);
    return roles.filter((roleData) => {
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
