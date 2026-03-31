const Job = require('../models/Job');
const WorkerProfile = require('../models/WorkerProfile');
const Application = require('../models/Application');
const matchEngineV2 = require('../match/matchEngineV2');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
const { getLatestCityLiquidity } = require('../services/cityLiquidityService');
const { buildMatchIntelligenceContext } = require('../services/matchQualityIntelligenceService');
const { predictTimeToFill } = require('../services/predictiveFillService');
const { predictRetention } = require('../services/retentionPredictionService');
const {
    assertTenantAccessToEmployer,
    getTenantEmployerIds,
} = require('../services/tenantIsolationService');

const buildWorkerFromPayload = (worker = {}) => ({
    _id: worker._id || `external-worker-${Date.now()}`,
    city: worker.city || 'unknown',
    preferredShift: worker.preferredShift || 'Flexible',
    interviewVerified: Boolean(worker.interviewVerified),
    firstName: worker.firstName || 'External',
    roleProfiles: Array.isArray(worker.roleProfiles) ? worker.roleProfiles : [],
    user: {
        _id: worker.userId || null,
        isVerified: Boolean(worker.isVerified),
        hasCompletedProfile: worker.hasCompletedProfile !== false,
        featureToggles: worker.featureToggles || {},
    },
});

const buildJobFromPayload = (job = {}) => ({
    _id: job._id || `external-job-${Date.now()}`,
    title: job.title || 'General Role',
    location: job.location || 'unknown',
    requirements: Array.isArray(job.requirements) ? job.requirements : [],
    maxSalary: Number(job.maxSalary || 0),
    salaryRange: job.salaryRange || '',
    shift: job.shift || 'Flexible',
    employerId: job.employerId || null,
    mandatoryLicenses: Array.isArray(job.mandatoryLicenses) ? job.mandatoryLicenses : [],
});

const resolveWorker = async ({ workerId, worker, tenantContext = {} }) => {
    if (workerId) {
        const profile = await WorkerProfile.findById(workerId)
            .populate('user', 'isVerified hasCompletedProfile featureToggles')
            .lean();
        if (profile) {
            if (tenantContext?.tenantId || tenantContext?.ownerId) {
                let allowedEmployers = [];
                if (tenantContext?.tenantId) {
                    allowedEmployers = await getTenantEmployerIds({
                        tenantId: tenantContext.tenantId,
                        ownerId: tenantContext.ownerId || null,
                    });
                } else if (tenantContext?.ownerId) {
                    allowedEmployers = [tenantContext.ownerId];
                }

                if (allowedEmployers.length) {
                    const relatedApplication = await Application.findOne({
                        worker: profile._id,
                        employer: { $in: allowedEmployers },
                    })
                        .select('_id')
                        .lean();

                    if (!relatedApplication) {
                        return null;
                    }
                }
            }
            return profile;
        }
    }
    if (worker && typeof worker === 'object') return buildWorkerFromPayload(worker);
    return null;
};

const resolveJob = async ({ jobId, job, tenantContext = {} }) => {
    if (jobId) {
        const found = await Job.findById(jobId).lean();
        if (found) {
            const hasAccess = await assertTenantAccessToEmployer({
                tenantContext,
                employerId: found.employerId,
            });
            if (!hasAccess) return null;
            return found;
        }
    }
    if (job && typeof job === 'object') {
        const payloadJob = buildJobFromPayload(job);
        if (tenantContext?.ownerId && payloadJob.employerId && String(payloadJob.employerId) !== String(tenantContext.ownerId)) {
            return null;
        }
        if (tenantContext?.ownerId && !payloadJob.employerId) {
            payloadJob.employerId = tenantContext.ownerId;
        }
        if (tenantContext?.tenantId && payloadJob.employerId) {
            const hasAccess = await assertTenantAccessToEmployer({
                tenantContext,
                employerId: payloadJob.employerId,
            });
            if (!hasAccess) return null;
        }
        return payloadJob;
    }
    return null;
};

// @desc Platform external match scoring API
// @route POST /api/platform/match
const platformMatch = async (req, res) => {
    try {
        const { workerId = null, jobId = null, worker = null, job = null } = req.body || {};
        const [resolvedWorker, resolvedJob] = await Promise.all([
            resolveWorker({ workerId, worker, tenantContext: req.tenantContext || {} }),
            resolveJob({ jobId, job, tenantContext: req.tenantContext || {} }),
        ]);

        if (!resolvedWorker || !resolvedJob) {
            return res.status(400).json({ message: 'worker/workerId and job/jobId are required' });
        }
        if (!Array.isArray(resolvedWorker.roleProfiles) || !resolvedWorker.roleProfiles.length) {
            return res.status(400).json({ message: 'worker roleProfiles are required for scoring' });
        }

        const workerUser = resolvedWorker.user || {
            _id: null,
            isVerified: false,
            hasCompletedProfile: true,
            featureToggles: {},
        };

        const intelligence = await buildMatchIntelligenceContext({
            worker: resolvedWorker,
            jobs: [resolvedJob],
            cityHint: resolvedJob.location || resolvedWorker.city || null,
        });
        const scoringContext = intelligence.getScoringContextForJob(resolvedJob);
        const deterministic = matchEngineV2.evaluateBestRoleForJob({
            worker: resolvedWorker,
            workerUser,
            job: resolvedJob,
            scoringContext,
        });

        if (!deterministic.accepted) {
            return res.json({
                accepted: false,
                tier: 'REJECT',
                matchProbability: 0,
                reason: deterministic.rejectReason || 'REJECTED_BY_RULES',
                explainability: deterministic.explainability || {},
            });
        }

        const overlaid = await applyOverlay({
            deterministicScore: deterministic,
            worker: resolvedWorker,
            job: resolvedJob,
            model: {
                user: workerUser,
                workerUser,
                roleData: deterministic.roleData,
                deterministicScores: {
                    skillScore: deterministic.skillScore,
                    experienceScore: deterministic.experienceScore,
                    salaryFitScore: deterministic.salaryFitScore,
                    distanceScore: deterministic.distanceScore,
                    profileCompletenessMultiplier: deterministic.profileCompletenessMultiplier,
                    reliabilityScore: deterministic.reliabilityScore,
                    baseScore: deterministic.baseScore,
                },
                allowRejectOutput: true,
            },
        });

        const matchProbability = Number(overlaid?.matchProbability ?? deterministic.finalScore ?? 0);
        const resolvedTier = overlaid?.tier || matchEngineV2.mapTier(matchProbability, intelligence.dynamicThresholds);

        return res.json({
            accepted: resolvedTier !== 'REJECT',
            tier: resolvedTier,
            matchProbability: Number(matchProbability.toFixed(4)),
            deterministicScore: Number((deterministic.baseScore || deterministic.finalScore || 0).toFixed(4)),
            probabilisticScore: Number((overlaid?.matchProbability ?? deterministic.finalScore ?? 0).toFixed(4)),
            explainability: overlaid?.explainability || deterministic.explainability || {},
            metadata: {
                matchModelVersionUsed: overlaid?.matchModelVersionUsed || null,
                fallbackUsed: Boolean(overlaid?.probabilisticFallbackUsed),
                platformClient: req.platformClient || null,
            },
        });
    } catch (error) {
        console.warn('platform match failed:', error);
        return res.status(500).json({ message: 'Platform match failed' });
    }
};

// @desc Platform fill-time prediction API
// @route POST /api/platform/predict-fill
// @route GET /api/platform/predict-fill
const platformPredictFill = async (req, res) => {
    try {
        const source = req.method === 'GET' ? req.query : req.body || {};
        let resolvedJobData = source.job || null;
        if (source.jobId || source.job) {
            const scopedJob = await resolveJob({
                jobId: source.jobId || null,
                job: source.job || null,
                tenantContext: req.tenantContext || {},
            });
            if (!scopedJob) {
                return res.status(403).json({ message: 'Tenant scope does not allow this job' });
            }
            resolvedJobData = scopedJob;
        }
        const prediction = await predictTimeToFill({
            jobId: source.jobId || null,
            jobData: resolvedJobData,
        });
        return res.json({
            success: true,
            data: prediction,
        });
    } catch (error) {
        console.warn('platform predict-fill failed:', error);
        return res.status(400).json({ message: error.message || 'Predict fill failed' });
    }
};

// @desc Platform retention prediction API
// @route POST /api/platform/predict-retention
const platformPredictRetention = async (req, res) => {
    try {
        const { workerId, jobId } = req.body || {};
        if (!workerId || !jobId) {
            return res.status(400).json({ message: 'workerId and jobId are required' });
        }

        const [worker, job] = await Promise.all([
            resolveWorker({ workerId, worker: null, tenantContext: req.tenantContext || {} }),
            resolveJob({ jobId, job: null, tenantContext: req.tenantContext || {} }),
        ]);
        if (!worker || !job) {
            return res.status(403).json({ message: 'Tenant scope does not allow this worker/job' });
        }

        const prediction = await predictRetention({ workerId, jobId });
        return res.json({
            success: true,
            data: prediction,
        });
    } catch (error) {
        console.warn('platform predict-retention failed:', error);
        return res.status(400).json({ message: error.message || 'Predict retention failed' });
    }
};

// @desc Platform city liquidity API
// @route GET /api/platform/city-liquidity
const platformCityLiquidity = async (req, res) => {
    try {
        const city = req.query.city ? String(req.query.city).trim() : null;
        const limit = Number.parseInt(req.query.limit || '50', 10);
        const rows = await getLatestCityLiquidity({ city, limit });
        return res.json({
            success: true,
            data: rows,
        });
    } catch (error) {
        console.warn('platform city-liquidity failed:', error);
        return res.status(500).json({ message: 'Failed to load city liquidity' });
    }
};

module.exports = {
    platformMatch,
    platformPredictFill,
    platformPredictRetention,
    platformCityLiquidity,
};
