const crypto = require('crypto');

const Job = require('../models/Job');
const User = require('../models/userModel');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const Application = require('../models/Application');
const UserTrustScore = require('../models/UserTrustScore');
const UserNetworkScore = require('../models/UserNetworkScore');
const {
    toExternalJobs,
    toPublicId,
    parseRequestedFields,
    resolveExternalPagination,
    buildPaginationMeta,
} = require('../services/externalProjectionService');
const {
    getTenantEmployerIds,
    assertTenantAccessToEmployer,
} = require('../services/tenantIsolationService');
const {
    queueWebhookEvent,
    registerWebhookSubscription,
    listWebhookSubscriptions,
} = require('../services/platformWebhookService');
const { enqueueReplicationEvent } = require('../services/regionReplicationService');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getTenantEmployerFilter = async (tenantContext = {}) => {
    const employerIds = await getTenantEmployerIds({
        tenantId: tenantContext?.tenantId || null,
        ownerId: tenantContext?.ownerId || null,
    });

    if (!employerIds.length) {
        return {
            employerId: null,
        };
    }

    return {
        employerId: { $in: employerIds },
    };
};

const getPublicJobsV3 = async (req, res) => {
    try {
        const requestedFields = parseRequestedFields(req.query.fields);
        const { page, limit, skip } = resolveExternalPagination(req.query || {});
        const tenantFilter = await getTenantEmployerFilter(req.tenantContext || {});

        if (!tenantFilter.employerId) {
            return res.json({
                success: true,
                data: [],
                pagination: buildPaginationMeta({ total: 0, page, limit }),
            });
        }

        const query = {
            isOpen: true,
            status: 'active',
            isDisabled: { $ne: true },
            ...tenantFilter,
        };

        const [jobs, total] = await Promise.all([
            Job.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Job.countDocuments(query),
        ]);

        return res.json({
            success: true,
            data: toExternalJobs(jobs, requestedFields),
            pagination: buildPaginationMeta({ total, page, limit }),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load public job listings' });
    }
};

const resolveOrCreateExternalCandidate = async ({ firstName, email, city, skills = [], experience = 0 } = {}) => {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    let user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        user = await User.create({
            name: String(firstName || 'External Candidate').trim(),
            email: normalizedEmail,
            password: crypto.randomBytes(20).toString('hex'),
            role: 'candidate',
            activeRole: 'worker',
            primaryRole: 'worker',
            hasCompletedProfile: false,
            hasSelectedRole: true,
            city: String(city || 'Unknown').trim(),
            isVerified: false,
            linkedAccounts: {
                google: false,
                apple: false,
                emailPassword: true,
            },
        });
    }

    let profile = await WorkerProfile.findOne({ user: user._id });
    if (!profile) {
        profile = await WorkerProfile.create({
            user: user._id,
            firstName: String(firstName || user.name || 'External').trim(),
            city: String(city || user.city || 'Unknown').trim(),
            totalExperience: Math.max(0, Number(experience || 0)),
            roleProfiles: [
                {
                    roleName: 'General Worker',
                    experienceInRole: Math.max(0, Number(experience || 0)),
                    skills: Array.isArray(skills) ? skills.slice(0, 20) : [],
                },
            ],
            isAvailable: true,
            interviewVerified: false,
        });
    }

    return {
        user,
        profile,
    };
};

const postExternalApplication = async (req, res) => {
    try {
        const payload = req.body || {};
        const directJobId = String(payload.jobId || '').trim();
        const externalJobId = String(payload.externalJobId || '').trim();
        const candidate = payload.candidate || {};

        if (!directJobId && !externalJobId) {
            return res.status(400).json({ message: 'jobId or externalJobId is required' });
        }

        const email = String(candidate.email || '').trim().toLowerCase();
        if (!EMAIL_REGEX.test(email)) {
            return res.status(400).json({ message: 'candidate.email must be valid' });
        }

        let job = null;
        if (directJobId) {
            job = await Job.findById(directJobId).lean();
        } else if (externalJobId) {
            const tenantFilter = await getTenantEmployerFilter(req.tenantContext || {});
            if (!tenantFilter.employerId) {
                return res.status(403).json({ message: 'Tenant scope does not allow this job' });
            }

            const candidateJobs = await Job.find({
                ...tenantFilter,
                status: 'active',
                isOpen: true,
            })
                .select('_id employerId status isOpen')
                .lean();

            job = candidateJobs.find((row) => toPublicId('job', row._id) === externalJobId) || null;
        }

        if (!job || !job.isOpen || job.status !== 'active') {
            return res.status(404).json({ message: 'Job not found or not open' });
        }

        const hasTenantAccess = await assertTenantAccessToEmployer({
            tenantContext: req.tenantContext,
            employerId: job.employerId,
        });
        if (!hasTenantAccess) {
            return res.status(403).json({ message: 'Tenant scope does not allow this job' });
        }

        const { user, profile } = await resolveOrCreateExternalCandidate({
            firstName: candidate.firstName || 'External Candidate',
            email,
            city: candidate.city || 'Unknown',
            skills: candidate.skills,
            experience: candidate.experience,
        });

        let application = await Application.findOne({
            job: job._id,
            worker: profile._id,
        });

        if (!application) {
            application = await Application.create({
                job: job._id,
                worker: profile._id,
                employer: job.employerId,
                initiatedBy: 'worker',
                status: 'pending',
                lastMessage: 'Applied via external partner API',
            });
        }

        await queueWebhookEvent({
            ownerId: job.employerId,
            tenantId: req.tenantContext?.tenantId || null,
            eventType: 'application.received',
            payload: {
                applicationId: String(application._id),
                jobId: String(job._id),
                workerId: String(profile._id),
                source: 'api_v3_public',
            },
        });

        setImmediate(() => {
            enqueueReplicationEvent({
                eventType: 'application.received',
                entityType: 'application',
                entityId: application._id,
                sourceRegion: req.edgeContext?.primaryRegion || req.headers?.['x-region'] || process.env.APP_REGION || 'unknown',
                failoverRegions: req.edgeContext?.failoverRegions || [],
                metadata: {
                    source: 'api_v3_public',
                    tenantId: req.tenantContext?.tenantId || null,
                    ownerId: String(job.employerId || ''),
                },
                payload: {
                    applicationId: String(application._id),
                    jobId: String(job._id),
                    employerId: String(job.employerId || ''),
                    workerId: String(profile._id),
                    status: application.status,
                },
            }).catch(() => {});
        });

        return res.status(201).json({
            success: true,
            data: {
                applicationId: toPublicId('application', application._id),
                status: application.status,
                jobId: toPublicId('job', job._id),
                candidateId: toPublicId('candidate', profile._id),
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to submit external application' });
    }
};

const getEmployerPublicProfile = async (req, res) => {
    try {
        const employerId = String(req.params.employerId || '').trim();
        const allowed = await assertTenantAccessToEmployer({
            tenantContext: req.tenantContext,
            employerId,
        });

        if (!allowed) {
            return res.status(403).json({ message: 'Tenant scope does not allow this employer' });
        }

        const [user, employerProfile, activeJobs] = await Promise.all([
            User.findById(employerId).select('name trustScore trustStatus organizationId').lean(),
            EmployerProfile.findOne({ user: employerId }).lean(),
            Job.countDocuments({ employerId, isOpen: true, status: 'active' }),
        ]);

        if (!user) {
            return res.status(404).json({ message: 'Employer not found' });
        }

        return res.json({
            success: true,
            data: {
                employerId: toPublicId('employer', employerId),
                companyName: employerProfile?.companyName || user.name,
                industry: employerProfile?.industry || null,
                location: employerProfile?.location || null,
                website: employerProfile?.website || null,
                activeJobs,
                trustScore: Number(user.trustScore || 0),
                trustStatus: user.trustStatus || 'healthy',
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load employer profile' });
    }
};

const getTrustBadgeInfo = async (req, res) => {
    try {
        const userId = String(req.params.userId || '').trim();

        let user = null;
        if (req.tenantContext?.tenantId) {
            user = await User.findOne({ _id: userId, organizationId: req.tenantContext.tenantId })
                .select('_id trustScore trustStatus isFlagged organizationId')
                .lean();
        } else {
            if (String(req.tenantContext?.ownerId || '') !== userId) {
                return res.status(403).json({ message: 'Tenant scope does not allow this user' });
            }
            user = await User.findById(userId)
                .select('_id trustScore trustStatus isFlagged organizationId')
                .lean();
        }

        if (!user) {
            return res.status(404).json({ message: 'Trust badge subject not found in tenant scope' });
        }

        const trustRecord = await UserTrustScore.findOne({ userId }).lean();
        const trustScore = Number(trustRecord?.score || user.trustScore || 0);

        const badgeLevel = trustScore >= 85
            ? 'trusted'
            : trustScore >= 60
                ? 'watch'
                : 'restricted';

        return res.json({
            success: true,
            data: {
                userId: toPublicId('user', user._id),
                badge: badgeLevel,
                trustScore,
                trustStatus: trustRecord?.status || user.trustStatus || 'healthy',
                reasons: Array.isArray(trustRecord?.reasons) ? trustRecord.reasons.slice(0, 5) : [],
                flagged: Boolean(trustRecord?.isFlagged || user.isFlagged),
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load trust badge info' });
    }
};

const getSkillReputationSummary = async (req, res) => {
    try {
        const workerId = String(req.params.workerId || '').trim();
        const worker = await WorkerProfile.findById(workerId).lean();
        if (!worker) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        if (req.tenantContext?.tenantId) {
            const scopedUser = await User.findOne({
                _id: worker.user,
                organizationId: req.tenantContext.tenantId,
            })
                .select('_id')
                .lean();
            if (!scopedUser) {
                return res.status(403).json({ message: 'Worker is outside tenant scope' });
            }
        } else if (req.tenantContext?.ownerId) {
            const relatedApplication = await Application.findOne({
                worker: worker._id,
                employer: req.tenantContext.ownerId,
            })
                .select('_id')
                .lean();

            if (!relatedApplication) {
                return res.status(403).json({ message: 'Worker is outside tenant scope' });
            }
        }

        const [totalApplications, hiredApplications, offerAccepted, networkScore] = await Promise.all([
            Application.countDocuments({ worker: worker._id }),
            Application.countDocuments({ worker: worker._id, status: 'hired' }),
            Application.countDocuments({ worker: worker._id, status: 'offer_accepted' }),
            UserNetworkScore.findOne({ user: worker.user }).lean(),
        ]);

        const roleProfiles = Array.isArray(worker.roleProfiles) ? worker.roleProfiles : [];
        const skillCount = roleProfiles.reduce((sum, role) => sum + (Array.isArray(role.skills) ? role.skills.length : 0), 0);
        const reputationScore = Number((
            (Math.min(1, hiredApplications / Math.max(1, totalApplications)) * 50)
            + (Math.min(1, skillCount / 30) * 30)
            + (Math.min(1, Number(networkScore?.score || 0) / 100) * 20)
        ).toFixed(2));

        return res.json({
            success: true,
            data: {
                workerId: toPublicId('candidate', worker._id),
                reputationScore,
                totalApplications,
                hires: hiredApplications,
                offerAccepted,
                roleProfiles: roleProfiles.map((role) => ({
                    roleName: role.roleName,
                    skills: Array.isArray(role.skills) ? role.skills.slice(0, 20) : [],
                    experienceInRole: Number(role.experienceInRole || 0),
                })),
                networkScore: Number(networkScore?.score || 0),
            },
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to load skill reputation summary' });
    }
};

const registerEmployerWebhook = async (req, res) => {
    try {
        const payload = req.body || {};
        const ownerId = req.externalApiKey?.ownerId || req.externalApiKey?.employerId;
        if (!ownerId) {
            return res.status(400).json({ message: 'API key owner is required for webhook registration' });
        }

        const result = await registerWebhookSubscription({
            ownerId,
            tenantId: req.tenantContext?.tenantId || null,
            eventType: payload.eventType,
            targetUrl: payload.targetUrl,
        });

        return res.status(result.created ? 201 : 200).json({
            success: true,
            data: {
                webhookId: result.webhook._id,
                eventType: result.webhook.eventType,
                targetUrl: result.webhook.targetUrl,
                active: result.webhook.active,
                secret: result.secret,
            },
        });
    } catch (error) {
        return res.status(400).json({ message: error.message || 'Failed to register webhook' });
    }
};

const listEmployerWebhooks = async (req, res) => {
    try {
        const ownerId = req.externalApiKey?.ownerId || req.externalApiKey?.employerId;
        if (!ownerId) {
            return res.status(400).json({ message: 'API key owner is required' });
        }

        const webhooks = await listWebhookSubscriptions({
            ownerId,
            tenantId: req.tenantContext?.tenantId || null,
        });

        return res.json({
            success: true,
            data: webhooks.map((hook) => ({
                webhookId: hook._id,
                eventType: hook.eventType,
                targetUrl: hook.targetUrl,
                active: hook.active,
                consecutiveFailures: hook.consecutiveFailures,
                lastDeliveryAt: hook.lastDeliveryAt,
                createdAt: hook.createdAt,
            })),
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Failed to list webhooks' });
    }
};

module.exports = {
    getPublicJobsV3,
    postExternalApplication,
    getEmployerPublicProfile,
    getTrustBadgeInfo,
    getSkillReputationSummary,
    registerEmployerWebhook,
    listEmployerWebhooks,
};
