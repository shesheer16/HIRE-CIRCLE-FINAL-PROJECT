const { getTrustBreakdownForUser, recomputeTrustGraphForUser, syncReleasedEscrowsToTrustGraph } = require('../services/trustGraphService');
const { computeBadgeForUser, getBadgeForUser } = require('../services/verificationBadgeService');
const {
    ensureFeedbackSlotForHire,
    submitEmployerFeedback,
    submitWorkerFeedback,
    getHireFeedbackStatus,
} = require('../services/matchFeedbackLoopService');
const {
    ensureEnterpriseWorkspace,
    bulkImportJobs,
    upsertTeamMember,
    getRecruiterCollaborationSnapshot,
    getWorkspaceHiringAnalytics,
    getSlaPriorityRouting,
} = require('../services/enterpriseLockInService');
const { getSkillReputationProfileForUser, recomputeSkillReputationForUser } = require('../services/skillReputationService');
const { computeRegionDominance, getLatestRegionDominance } = require('../services/marketIntelligenceShieldService');
const { evaluateUserAbuseSignals } = require('../services/abuseDefenseService');
const { runNetworkEffectLoopsForUser } = require('../services/networkEffectEngineService');
const { runScaleResilienceSimulation } = require('../services/moatScaleSimulationService');

const resolveTargetUserId = (req) => {
    if (req.user?.isAdmin && req.query.userId) {
        return req.query.userId;
    }
    return req.user?._id;
};

const getTrustGraphBreakdown = async (req, res) => {
    try {
        const userId = resolveTargetUserId(req);
        const [trust, badge, skills] = await Promise.all([
            getTrustBreakdownForUser({ userId, recomputeIfMissing: true }),
            getBadgeForUser({ userId, computeIfMissing: true }),
            getSkillReputationProfileForUser({ userId, recomputeIfMissing: true }),
        ]);

        return res.json({
            success: true,
            data: {
                trust,
                badge,
                skillReputation: {
                    averageScore: skills.averageScore,
                    topSkills: skills.topSkills,
                },
            },
        });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load trust breakdown' });
    }
};

const recomputeMoatState = async (req, res) => {
    try {
        const userId = resolveTargetUserId(req);

        const [trust, badge, skills, escrowSync] = await Promise.all([
            recomputeTrustGraphForUser({ userId, reason: 'manual_recompute' }),
            computeBadgeForUser({ userId, reason: 'manual_recompute' }),
            recomputeSkillReputationForUser({ userId, reason: 'manual_recompute' }),
            syncReleasedEscrowsToTrustGraph({ limit: 200 }),
        ]);

        return res.json({
            success: true,
            data: {
                trust,
                badge,
                skillsUpdated: skills.length,
                escrowSync,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to recompute moat state' });
    }
};

const bootstrapHireFeedback = async (req, res) => {
    try {
        const { applicationId } = req.body || {};
        if (!applicationId) {
            return res.status(400).json({ message: 'applicationId is required' });
        }

        const feedback = await ensureFeedbackSlotForHire({ applicationId });
        if (!feedback) {
            return res.status(404).json({ message: 'Hired application not found for feedback bootstrap' });
        }

        return res.status(201).json({ success: true, data: feedback });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to bootstrap hire feedback' });
    }
};

const submitHireFeedback = async (req, res) => {
    try {
        const { applicationId, actorType, ratings } = req.body || {};
        if (!applicationId || !actorType || typeof ratings !== 'object') {
            return res.status(400).json({ message: 'applicationId, actorType and ratings are required' });
        }

        const normalizedActor = String(actorType).toLowerCase();
        let feedback;

        if (normalizedActor === 'employer') {
            feedback = await submitEmployerFeedback({
                applicationId,
                employerId: req.user._id,
                payload: ratings,
            });
        } else if (normalizedActor === 'worker') {
            feedback = await submitWorkerFeedback({
                applicationId,
                workerUserId: req.user._id,
                payload: ratings,
            });
        } else {
            return res.status(400).json({ message: 'actorType must be employer or worker' });
        }

        return res.status(201).json({ success: true, data: feedback });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to submit feedback' });
    }
};

const getHireFeedbackStatusController = async (req, res) => {
    try {
        const applicationId = req.params.applicationId;
        const status = await getHireFeedbackStatus({ applicationId });
        if (!status) {
            return res.status(404).json({ message: 'Feedback status not found' });
        }

        return res.json({ success: true, data: status });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load feedback status' });
    }
};

const getOrCreateEnterpriseWorkspaceController = async (req, res) => {
    try {
        const workspace = await ensureEnterpriseWorkspace({
            ownerEmployerId: req.user._id,
            workspaceName: req.body?.workspaceName || 'Enterprise Workspace',
        });

        return res.json({ success: true, data: workspace });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to resolve workspace' });
    }
};

const bulkImportEnterpriseJobsController = async (req, res) => {
    try {
        const { workspaceId, jobs } = req.body || {};
        if (!workspaceId || !Array.isArray(jobs)) {
            return res.status(400).json({ message: 'workspaceId and jobs[] are required' });
        }

        const result = await bulkImportJobs({
            workspaceId,
            actorUserId: req.user._id,
            jobs,
        });

        return res.status(201).json({ success: true, data: result });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Bulk import failed' });
    }
};

const upsertEnterpriseTeamMemberController = async (req, res) => {
    try {
        const { workspaceId, memberUserId, role } = req.body || {};
        if (!workspaceId || !memberUserId) {
            return res.status(400).json({ message: 'workspaceId and memberUserId are required' });
        }

        const workspace = await upsertTeamMember({
            workspaceId,
            actorUserId: req.user._id,
            memberUserId,
            role,
        });

        return res.json({ success: true, data: workspace });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to update team member' });
    }
};

const getEnterpriseCollaborationController = async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId || req.params.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ message: 'workspaceId is required' });
        }

        const data = await getRecruiterCollaborationSnapshot({
            workspaceId,
            userId: req.user._id,
        });

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load collaboration snapshot' });
    }
};

const getEnterpriseAnalyticsController = async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId || req.params.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ message: 'workspaceId is required' });
        }

        const data = await getWorkspaceHiringAnalytics({
            workspaceId,
            userId: req.user._id,
            days: req.query.days || 90,
        });

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load enterprise analytics' });
    }
};

const getEnterpriseSlaController = async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId || req.params.workspaceId;
        if (!workspaceId) {
            return res.status(400).json({ message: 'workspaceId is required' });
        }

        const data = await getSlaPriorityRouting({
            workspaceId,
            userId: req.user._id,
        });

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ message: error.message || 'Failed to load SLA routing' });
    }
};

const computeRegionDominanceController = async (req, res) => {
    try {
        const rows = await computeRegionDominance({
            limit: Number(req.query.limit || req.body?.limit || 200),
        });

        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to compute region dominance' });
    }
};

const getRegionDominanceController = async (req, res) => {
    try {
        const rows = await getLatestRegionDominance({
            limit: Number(req.query.limit || 100),
            marketBand: req.query.marketBand || null,
        });

        return res.json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load region dominance snapshots' });
    }
};

const runAbuseDetectionController = async (req, res) => {
    try {
        const userId = resolveTargetUserId(req);
        const result = await evaluateUserAbuseSignals({ userId, autoBlock: true });
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to run abuse detection' });
    }
};

const runNetworkEffectLoopsController = async (req, res) => {
    try {
        const userId = resolveTargetUserId(req);
        const result = await runNetworkEffectLoopsForUser({ userId });
        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to run network effect loops' });
    }
};

const runScaleSimulationController = async (req, res) => {
    try {
        if (!req.user?.isAdmin) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const result = await runScaleResilienceSimulation({
            targetUsers: Number(req.query.users || req.body?.users || 100000),
            targetJobs: Number(req.query.jobs || req.body?.jobs || 20000),
            targetMonthlyHires: Number(req.query.hires || req.body?.hires || 5000),
            sampledScorePairs: Number(req.query.pairs || req.body?.pairs || 30000),
        });

        return res.json({ success: true, data: result });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Scale simulation failed' });
    }
};

const getStrategicCompetitorCheck = async (_req, res) => {
    const checks = [
        {
            competitorClass: 'Generic job boards',
            structuralAdvantage: 'Trust graph + badge-tier ranking + skill reputation graph',
            status: 'stronger',
        },
        {
            competitorClass: 'Freelancer marketplaces',
            structuralAdvantage: 'Escrow-linked trust edges + post-hire bilateral feedback loop',
            status: 'stronger',
        },
        {
            competitorClass: 'WhatsApp-based hiring',
            structuralAdvantage: 'Automated abuse defense + explainable matching + export-limited data lock',
            status: 'stronger',
        },
        {
            competitorClass: 'LinkedIn easy apply',
            structuralAdvantage: 'Enterprise workspace isolation + SLA routing + trust-transparent scoring',
            status: 'stronger',
        },
    ];

    return res.json({
        success: true,
        data: {
            checks,
            passed: checks.every((row) => row.status === 'stronger'),
        },
    });
};

module.exports = {
    getTrustGraphBreakdown,
    recomputeMoatState,
    bootstrapHireFeedback,
    submitHireFeedback,
    getHireFeedbackStatusController,
    getOrCreateEnterpriseWorkspaceController,
    bulkImportEnterpriseJobsController,
    upsertEnterpriseTeamMemberController,
    getEnterpriseCollaborationController,
    getEnterpriseAnalyticsController,
    getEnterpriseSlaController,
    computeRegionDominanceController,
    getRegionDominanceController,
    runAbuseDetectionController,
    runNetworkEffectLoopsController,
    runScaleSimulationController,
    getStrategicCompetitorCheck,
};
