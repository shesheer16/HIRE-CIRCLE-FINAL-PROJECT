const matchEngineV2 = require('../match/matchEngineV2');
const { buildMatchIntelligenceContext } = require('./matchQualityIntelligenceService');
const { buildAiCandidateInsight } = require('./aiCandidateInsightService');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
};

const toMatchPercentage = (score) => Math.round(clamp01(score) * 100);

const compute_match = async ({
    profile = null,
    profileUser = null,
    job = null,
    cityHint = null,
    intelligenceContext = null,
    scoringContext = null,
} = {}) => {
    if (!profile || !job) {
        return {
            accepted: false,
            matchScore: 0,
            matchPercentage: 0,
            score: 0,
            tier: 'REJECT',
            reason: 'NULL_CRITICAL_FIELDS',
            explanation: {},
            aiInsight: buildAiCandidateInsight({
                matchPercentage: 0,
                explanation: {},
                workerProfile: profile,
                job,
            }),
            deterministic: null,
        };
    }

    const workerUser = profileUser || profile?.user || {};

    let resolvedIntelligence = intelligenceContext;
    if (!resolvedIntelligence && !scoringContext) {
        resolvedIntelligence = await buildMatchIntelligenceContext({
            worker: profile,
            jobs: [job],
            cityHint: cityHint || job?.location || profile?.city || null,
        });
    }

    const resolvedScoringContext = scoringContext
        || (resolvedIntelligence && typeof resolvedIntelligence.getScoringContextForJob === 'function'
            ? resolvedIntelligence.getScoringContextForJob(job)
            : {});
    const resolvedThresholds = resolvedIntelligence?.dynamicThresholds
        || resolvedScoringContext?.dynamicThresholds
        || matchEngineV2.TIERS;

    const deterministic = matchEngineV2.evaluateBestRoleForJob({
        worker: profile,
        workerUser,
        job,
        scoringContext: resolvedScoringContext,
    });

    if (!deterministic?.accepted) {
        return {
            accepted: false,
            matchScore: 0,
            matchPercentage: 0,
            score: 0,
            tier: 'REJECT',
            reason: deterministic?.rejectReason || 'REJECT',
            explanation: deterministic?.explainability || {},
            aiInsight: buildAiCandidateInsight({
                matchPercentage: 0,
                explanation: deterministic?.explainability || {},
                workerProfile: profile,
                job,
            }),
            deterministic,
        };
    }

    const score = clamp01(deterministic?.finalScore || 0);
    const matchPercentage = toMatchPercentage(score);
    const tier = matchEngineV2.mapTier(score, resolvedThresholds);
    const aiInsight = buildAiCandidateInsight({
        matchPercentage,
        explanation: deterministic?.explainability || {},
        workerProfile: profile,
        job,
    });

    return {
        accepted: true,
        score,
        matchScore: matchPercentage,
        matchPercentage,
        tier,
        reason: null,
        explanation: deterministic?.explainability || {},
        aiInsight,
        deterministic,
    };
};

module.exports = {
    compute_match,
};
