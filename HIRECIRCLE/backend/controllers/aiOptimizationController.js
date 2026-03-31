const { readAdaptiveWeights, recordMatchOutcomeAndAdapt, validateAdaptiveWeights } = require('../services/adaptiveMatchWeightEngine');
const { buildBehaviorProfile, getBehaviorProfile, getBehaviorSignalsForMatch } = require('../services/behavioralScoringEngine');
const { scoreInterviewQuality } = require('../services/interviewQualityEnhancementService');
const { predictHiringProbability } = require('../services/hiringProbabilityEngine');
const { evaluateUserChurnRisk } = require('../services/churnRiskEngine');
const { predictJobSuccess } = require('../services/jobSuccessPredictionEngine');
const { buildAuthorBehaviorMap, rankPostsWithIntelligence } = require('../services/contentIntelligenceEngine');
const { detectSecurityAnomalies } = require('../services/securityAnomalyIntelligenceService');
const { explainMatchDecision, explainRankingDecision } = require('../services/decisionExplainabilityService');
const { getIntelligenceDashboard } = require('../services/intelligenceDashboardService');
const { runOptimizationStressValidation } = require('../services/aiOptimizationStressValidationService');

const platformMatchOutcome = async (req, res) => {
    try {
        const {
            jobId,
            applicantId,
            hired = false,
            rejected = false,
            timeToResponse = null,
            employerFeedbackScore = null,
            workerFeedbackScore = null,
            metadata = {},
        } = req.body || {};

        if (!jobId || !applicantId) {
            return res.status(400).json({ message: 'jobId and applicantId are required' });
        }

        const recorded = await recordMatchOutcomeAndAdapt({
            jobId,
            applicantId,
            hired,
            rejected,
            timeToResponse,
            employerFeedbackScore,
            workerFeedbackScore,
            metadata,
        });

        const scopedWeights = recorded.adaptiveWeights?.scoped || null;

        return res.status(201).json({
            success: true,
            data: {
                outcomeId: recorded.outcome?._id || null,
                adaptiveWeights: scopedWeights
                    ? {
                        skillWeight: Number(scopedWeights.skillWeight || 0),
                        experienceWeight: Number(scopedWeights.experienceWeight || 0),
                        salaryToleranceWeight: Number(scopedWeights.salaryToleranceWeight || 0),
                        commuteToleranceWeight: Number(scopedWeights.commuteToleranceWeight || 0),
                        sampleSize: Number(scopedWeights.sampleSize || 0),
                        updateCount: Number(scopedWeights.updateCount || 0),
                    }
                    : null,
            },
        });
    } catch (error) {
        console.warn('platform match outcome failed:', error);
        return res.status(500).json({ message: 'Failed to persist match outcome' });
    }
};

const platformAdaptiveWeights = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city) : 'global';
        const roleCluster = req.query.roleCluster ? String(req.query.roleCluster) : 'general';

        const row = await readAdaptiveWeights({ city, roleCluster });
        const guardrails = validateAdaptiveWeights(row.weights);

        return res.json({
            success: true,
            data: {
                ...row,
                guardrails,
            },
        });
    } catch (error) {
        console.warn('platform adaptive weights failed:', error);
        return res.status(500).json({ message: 'Failed to load adaptive weights' });
    }
};

const platformBehaviorProfile = async (req, res) => {
    try {
        const { userId } = req.body || {};
        const resolvedUserId = userId || req.user?._id || null;
        if (!resolvedUserId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const profile = await buildBehaviorProfile({ userId: resolvedUserId, upsert: true });
        const signals = getBehaviorSignalsForMatch({ profile });

        return res.json({
            success: true,
            data: {
                profile,
                signals,
            },
        });
    } catch (error) {
        console.warn('platform behavior profile failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to compute behavior profile' });
    }
};

const platformInterviewQuality = async (req, res) => {
    try {
        const { processingId = null, payload = {} } = req.body || {};
        const score = await scoreInterviewQuality({ processingId, payload, upsert: true });

        return res.json({
            success: true,
            data: score,
        });
    } catch (error) {
        console.warn('platform interview quality failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to score interview quality' });
    }
};

const platformHiringProbability = async (req, res) => {
    try {
        const {
            matchScore,
            employerBehaviorScore,
            workerReliabilityScore,
            jobUrgency,
            pastSimilarJobOutcomes,
            jobId,
        } = req.body || {};

        const prediction = await predictHiringProbability({
            matchScore,
            employerBehaviorScore,
            workerReliabilityScore,
            jobUrgency,
            pastSimilarJobOutcomes,
            jobId,
        });

        return res.json({
            success: true,
            data: prediction,
        });
    } catch (error) {
        console.warn('platform hiring probability failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to predict hiring probability' });
    }
};

const platformChurnRisk = async (req, res) => {
    try {
        const { userId, triggerNudge = true } = req.body || {};
        const resolvedUserId = userId || req.user?._id || null;
        if (!resolvedUserId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        const risk = await evaluateUserChurnRisk({
            userId: resolvedUserId,
            triggerNudge: Boolean(triggerNudge),
        });

        return res.json({
            success: true,
            data: risk,
        });
    } catch (error) {
        console.warn('platform churn risk failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to evaluate churn risk' });
    }
};

const platformJobSuccess = async (req, res) => {
    try {
        const { jobId = null, job = null } = req.body || {};
        const prediction = await predictJobSuccess({
            jobId,
            jobData: job,
        });

        return res.json({
            success: true,
            data: prediction,
        });
    } catch (error) {
        console.warn('platform job success failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to predict job success' });
    }
};

const platformFeedIntelligence = async (req, res) => {
    try {
        const { posts = [], viewer = {} } = req.body || {};
        if (!Array.isArray(posts)) {
            return res.status(400).json({ message: 'posts must be an array' });
        }

        const behaviorMap = await buildAuthorBehaviorMap({ posts });
        const ranked = rankPostsWithIntelligence({
            posts,
            viewer,
            behaviorMap,
        });

        return res.json({
            success: true,
            data: ranked,
        });
    } catch (error) {
        console.warn('platform feed intelligence failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to rank feed' });
    }
};

const platformAnomalyScan = async (req, res) => {
    try {
        const rows = await detectSecurityAnomalies({ day: new Date() });
        return res.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.warn('platform anomaly scan failed:', error);
        return res.status(500).json({ message: 'Failed to run anomaly scan' });
    }
};

const platformExplainDecision = async (req, res) => {
    try {
        const { explainability = {}, roleUsed = null } = req.body || {};

        return res.json({
            success: true,
            data: {
                match: explainMatchDecision({ explainability, roleUsed }),
                ranking: explainRankingDecision({ explainability, context: 'platform' }),
            },
        });
    } catch (error) {
        console.warn('platform explain decision failed:', error);
        return res.status(400).json({ message: error.message || 'Failed to explain decision' });
    }
};

const adminIntelligenceDashboard = async (req, res) => {
    try {
        const days = Number.parseInt(req.query.days || '30', 10);
        const dashboard = await getIntelligenceDashboard({ days });

        return res.json({
            success: true,
            data: dashboard,
        });
    } catch (error) {
        console.warn('admin intelligence dashboard failed:', error);
        return res.status(500).json({ message: 'Failed to load intelligence dashboard' });
    }
};

const adminStressValidation = async (_req, res) => {
    try {
        const report = runOptimizationStressValidation();
        return res.json({
            success: true,
            data: report,
        });
    } catch (error) {
        console.warn('admin stress validation failed:', error);
        return res.status(500).json({ message: 'Failed to run stress validation' });
    }
};

module.exports = {
    platformMatchOutcome,
    platformAdaptiveWeights,
    platformBehaviorProfile,
    platformInterviewQuality,
    platformHiringProbability,
    platformChurnRisk,
    platformJobSuccess,
    platformFeedIntelligence,
    platformAnomalyScan,
    platformExplainDecision,
    adminIntelligenceDashboard,
    adminStressValidation,
};
