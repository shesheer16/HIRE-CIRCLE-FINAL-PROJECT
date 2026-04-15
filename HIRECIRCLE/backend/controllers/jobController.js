const Job = require('../models/Job');
const Post = require('../models/Post');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const EmployerProfile = require('../models/EmployerProfile');
const User = require('../models/userModel');
const MatchRun = require('../models/MatchRun');
const MatchLog = require('../models/MatchLog');
const mongoose = require('mongoose');
const { suggestJobRequirements } = require('../services/geminiService');
const redisClient = require('../config/redis');
const { matchCache } = require('./matchingController');
const UpsellExposure = require('../models/UpsellExposure');
const matchEngineV2 = require('../match/matchEngineV2');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
const { buildWorkDnaVersionId } = require('../match/phase3SemanticEngine');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const {
    markJobConfirmed,
    finalizeInterviewSignalIfEligible,
} = require('../services/interviewProcessingService');
const { publishMetric } = require('../services/metricsService');
const {
    fireAndForget,
    markFirstJobActivatedOnce,
    createAnalyticsEvent,
} = require('../services/revenueInstrumentationService');
const {
    recordJobFillCompletedOnce,
    recordMatchPerformanceMetric,
} = require('../services/matchMetricsService');
const { safeLogPlatformEvent } = require('../services/eventLoggingService');
const { enqueueBackgroundJob } = require('../services/backgroundQueueService');
const { FEATURES, hasFeatureAccess } = require('../services/subscriptionService');
const { EMPLOYER_PRIMARY_ROLE } = require('../utils/roleGuards');
const { isMatchUiV1Enabled } = require('../config/featureFlags');
const { buildMatchIntelligenceContext } = require('../services/matchQualityIntelligenceService');
const { filterJobsByApplyIntent } = require('../services/matchIntentFilterService');
const { resolveJobGeo, normalizeCountryCode } = require('../services/geoExpansionService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { resolvePagination } = require('../utils/pagination');
const { buildLocationLabel, resolveStructuredLocationFields } = require('../utils/locationFields');
const { sanitizeText } = require('../utils/sanitizeText');
const { normalizeApplicationStatus } = require('../workflow/applicationStateMachine');
const { canTransitionJobStatus } = require('../workflow/jobStateMachine');
const logger = require('../utils/logger');
const { buildCacheKey, getJSON, setJSON, delByPattern, CACHE_TTL_SECONDS } = require('../services/cacheService');
const { dispatchAsyncTask, TASK_TYPES } = require('../services/asyncTaskDispatcher');
const { isCrossBorderAllowed, filterJobsByGeo } = require('../services/geoMatchService');
const { resolveRoutingContext } = require('../services/regionRoutingService');
const { compute_match } = require('../services/computeMatchService');
const { rejectPendingApplicationsForFilledJob } = require('../services/jobLifecycleService');
const { enrichJobsWithEmployerBranding } = require('../services/employerBrandingService');

const logRecommendedRun = async ({
    userId,
    workerId,
    stats = {},
    rows = [],
    modelVersionUsed = null,
    metadata = {},
}) => {
    try {
        const resolvedStatus = String(metadata?.status || 'COMPLETED').toUpperCase();
        const allowedStatus = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
        const status = allowedStatus.includes(resolvedStatus) ? resolvedStatus : 'COMPLETED';
        const run = await MatchRun.create({
            contextType: 'RECOMMENDED_JOBS',
            userId,
            workerId,
            modelVersionUsed,
            workDnaVersionId: metadata?.workDnaVersionId || null,
            status,
            triggeredBy: metadata?.triggeredBy || metadata?.source || 'recommended_jobs_refresh',
            version: Number(metadata?.version || 1),
            startedAt: metadata?.startedAt || new Date(),
            completedAt: status === 'RUNNING' ? null : (metadata?.completedAt || new Date()),
            errorMessage: metadata?.errorMessage || null,
            totalJobsConsidered: Number(stats.totalConsidered || 0),
            totalMatchesReturned: Number(stats.totalReturned || 0),
            avgScore: Number(stats.avgScore || 0),
            rejectReasonCounts: stats.rejectReasonCounts || {},
            metadata,
        });

        if (rows.length) {
            await MatchLog.insertMany(rows.map((row) => ({
                matchRunId: run._id,
                workerId,
                jobId: row.job?._id || null,
                finalScore: Number(row.matchProbability ?? row.finalScore ?? 0),
                tier: row.tier || 'REJECT',
                accepted: true,
                rejectReason: row.rejectReason || null,
                rejectionReason: row.rejectionReason || row.rejectReason || null,
                semanticSkillScore: Number(row?.explainability?.semanticSkillScore || 0),
                experienceGaussianScore: Number(row?.explainability?.experienceGaussianScore || 0),
                economicViabilityScore: Number(
                    row?.explainability?.economicViabilityScore
                    || row?.explainability?.salaryViabilityScore
                    || 0
                ),
                roleBonusApplied: Boolean(row?.explainability?.roleBonusApplied),
                isTerminal: true,
                explainability: row.explainability || {},
                matchModelVersionUsed: row.matchModelVersionUsed || modelVersionUsed || null,
                metadata: {
                    workDnaVersionId: row.workDnaVersionId || metadata?.workDnaVersionId || null,
                },
            })), { ordered: false });
        }
    } catch (error) {
        console.warn('Recommended jobs logging failed:', error.message);
    }
};

const extractSalaryBounds = (job) => {
    const minSalary = Number(job?.minSalary);
    const maxSalary = Number(job?.maxSalary);
    if (Number.isFinite(minSalary) || Number.isFinite(maxSalary)) {
        return {
            min: Number.isFinite(minSalary) ? minSalary : null,
            max: Number.isFinite(maxSalary) ? maxSalary : null,
        };
    }

    const numbers = String(job?.salaryRange || '')
        .match(/\d[\d,]*/g);
    if (!numbers || !numbers.length) return { min: null, max: null };

    const parsed = numbers
        .map((item) => Number(String(item).replace(/,/g, '')))
        .filter((value) => Number.isFinite(value));
    if (!parsed.length) return { min: null, max: null };

    return {
        min: Math.min(...parsed),
        max: Math.max(...parsed),
    };
};

const tierThresholdMap = {
    STRONG: 0.82,
    GOOD: 0.70,
    POSSIBLE: 0.62,
};

const MAX_SALARY_VALUE = 10_000_000;

const parseSalaryValue = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return parsed;
};

const parseOpeningsValue = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
    return Math.round(parsed);
};

const buildLocationQuery = ({ district = '', mandal = '' } = {}) => {
    const safeDistrict = sanitizeText(district, { maxLength: 120 });
    const safeMandal = sanitizeText(mandal, { maxLength: 120 });
    const clauses = [];
    if (safeDistrict) {
        const districtRegex = new RegExp(`^${safeDistrict.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const districtContainsRegex = new RegExp(safeDistrict.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        clauses.push({
            $or: [
                { district: districtRegex },
                { location: districtContainsRegex },
                { locationLabel: districtContainsRegex },
            ],
        });
    }
    if (safeMandal) {
        const mandalRegex = new RegExp(`^${safeMandal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const mandalContainsRegex = new RegExp(safeMandal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        clauses.push({
            $or: [
                { mandal: mandalRegex },
                { location: mandalContainsRegex },
                { locationLabel: mandalContainsRegex },
            ],
        });
    }
    return clauses;
};

const normalizeObjectIdHex = (value) => {
    if (!value) return null;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (mongoose.Types.ObjectId.isValid(trimmed)) return trimmed;
        return null;
    }

    if (value instanceof mongoose.Types.ObjectId) {
        return value.toHexString();
    }

    if (Buffer.isBuffer(value) && value.length === 12) {
        return value.toString('hex');
    }

    if (typeof value === 'object') {
        if (typeof value.toHexString === 'function') {
            const hex = value.toHexString();
            if (mongoose.Types.ObjectId.isValid(hex)) return hex;
        }

        const oidValue = String(value.$oid || '').trim();
        if (oidValue && mongoose.Types.ObjectId.isValid(oidValue)) {
            return oidValue;
        }

        const rawBuffer = value.buffer;
        if (rawBuffer && typeof rawBuffer === 'object') {
            const bytes = [];
            for (let i = 0; i < 12; i += 1) {
                const next = rawBuffer[i] ?? rawBuffer[String(i)];
                const parsed = Number(next);
                if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
                    return null;
                }
                bytes.push(parsed);
            }
            return Buffer.from(bytes).toString('hex');
        }
    }

    return null;
};

const toMongoObjectId = (value) => {
    const hex = normalizeObjectIdHex(value);
    if (!hex) return null;
    try {
        return new mongoose.Types.ObjectId(hex);
    } catch {
        return null;
    }
};

const deleteConnectPostsForJobs = async (jobIds = []) => {
    const normalizedIds = Array.from(new Set(
        (Array.isArray(jobIds) ? jobIds : [])
            .map((value) => normalizeObjectIdHex(value))
            .filter(Boolean)
    ));
    if (!normalizedIds.length) {
        return { deletedCount: 0 };
    }

    const objectIds = normalizedIds
        .map((id) => toMongoObjectId(id))
        .filter(Boolean);
    const matchValues = [...normalizedIds, ...objectIds];

    try {
        return await Post.deleteMany({
            postType: 'job',
            $or: [
                { 'meta.jobId': { $in: matchValues } },
                // Legacy fallback for older post payloads that may have stored a top-level jobId.
                { jobId: { $in: matchValues } },
            ],
        });
    } catch (error) {
        console.warn('❌ [CONNECT POST CLEANUP ERROR]:', error.message);
        return { deletedCount: 0 };
    }
};

// @desc    Create a new job
// @route   POST /api/jobs/
// @access  Protected
const createJob = async (req, res) => {
    const {
        title,
        companyName,
        salaryRange,
        location,
        district,
        mandal,
        locationLabel,
        requirements,
        screeningQuestions,
        minSalary,
        maxSalary,
        openings,
        shift,
        mandatoryLicenses,
        isPulse,
        remoteAllowed,
        expiresAt,
    } = req.body;

    try {
        const employerObjectId = toMongoObjectId(req.user?._id);
        if (!employerObjectId) {
            return res.status(401).json({
                success: false,
                message: 'Invalid employer session',
            });
        }

        const employerUser = await User.findById(employerObjectId)
            .select('name city isVerified hasCompletedProfile activeRole primaryRole role isDeleted')
            .lean();
        if (!employerUser || employerUser.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'Employer account not found',
            });
        }

        const parsedMinSalary = parseSalaryValue(minSalary);
        const parsedMaxSalary = parseSalaryValue(maxSalary);
        const parsedOpenings = parseOpeningsValue(openings);

        if (
            Number.isNaN(parsedMinSalary)
            || Number.isNaN(parsedMaxSalary)
            || Number.isNaN(parsedOpenings)
            || (parsedMinSalary !== null && (parsedMinSalary < 0 || parsedMinSalary > MAX_SALARY_VALUE))
            || (parsedMaxSalary !== null && (parsedMaxSalary < 0 || parsedMaxSalary > MAX_SALARY_VALUE))
            || (parsedMinSalary !== null && parsedMaxSalary !== null && parsedMaxSalary < parsedMinSalary)
        ) {
            return res.status(400).json({
                success: false,
                message: 'Invalid salary bounds',
            });
        }

        const safeTitle = sanitizeText(title, { maxLength: 120 });
        const safeCompanyName = sanitizeText(companyName, { maxLength: 120 });
        const safeSalaryRange = sanitizeText(salaryRange, { maxLength: 120 });
        const structuredLocation = resolveStructuredLocationFields({
            district: sanitizeText(district, { maxLength: 120 }),
            mandal: sanitizeText(mandal, { maxLength: 120 }),
            location: sanitizeText(location, { maxLength: 120 }),
            locationLabel: sanitizeText(locationLabel, { maxLength: 160 }),
        });
        const safeLocation = structuredLocation.legacyLocation;
        const safeRequirements = Array.isArray(requirements)
            ? requirements.map((item) => sanitizeText(item, { maxLength: 120 })).filter(Boolean)
            : [];
        const safeScreeningQuestions = Array.isArray(screeningQuestions)
            ? screeningQuestions.map((item) => sanitizeText(item, { maxLength: 250 })).filter(Boolean)
            : [];
        const safeMandatoryLicenses = Array.isArray(mandatoryLicenses)
            ? mandatoryLicenses.map((item) => sanitizeText(item, { maxLength: 120 })).filter(Boolean)
            : [];

        if (!safeTitle || !safeCompanyName || !safeSalaryRange || !safeLocation) {
            return res.status(400).json({
                success: false,
                message: 'Invalid job payload',
            });
        }

        const employerProfilePatch = {
            companyName: safeCompanyName,
            location: safeLocation,
            district: structuredLocation.district,
            mandal: structuredLocation.mandal,
            locationLabel: structuredLocation.locationLabel,
        };
        const safeContactPerson = sanitizeText(req.body?.contactPerson || employerUser?.name || '', { maxLength: 120 });
        if (safeContactPerson) {
            employerProfilePatch.contactPerson = safeContactPerson;
        }
        await EmployerProfile.findOneAndUpdate(
            { user: employerObjectId },
            { $set: employerProfilePatch },
            { upsert: true, setDefaultsOnInsert: true }
        ).catch(() => {});

        let resolvedExpiryAt = null;
        if (expiresAt !== undefined && expiresAt !== null && String(expiresAt).trim()) {
            const parsedExpiryAt = new Date(expiresAt);
            if (Number.isNaN(parsedExpiryAt.getTime()) || parsedExpiryAt <= new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'expiresAt must be a valid future timestamp',
                });
            }
            resolvedExpiryAt = parsedExpiryAt;
        }

        const geo = resolveJobGeo({
            location: safeLocation,
            countryCode: req.body?.countryCode || req.user?.country || 'IN',
        });
        const priorityListing = await hasFeatureAccess({
            userId: employerObjectId,
            feature: FEATURES.PRIORITY_LISTING,
        });

        const job = await Job.create({
            employerId: employerObjectId,
            title: safeTitle,
            companyName: safeCompanyName,
            salaryRange: safeSalaryRange,
            location: safeLocation,
            district: structuredLocation.district,
            mandal: structuredLocation.mandal,
            locationLabel: structuredLocation.locationLabel || buildLocationLabel({
                district: structuredLocation.district,
                mandal: structuredLocation.mandal,
                fallback: safeLocation,
            }),
            country: geo.countryCode,
            region: String(req.body?.region || req.body?.regionCode || geo.regionCode || '').toUpperCase(),
            countryCode: geo.countryCode,
            regionCode: String(req.body?.regionCode || geo.regionCode || '').toUpperCase(),
            currencyCode: String(req.body?.currencyCode || geo.currencyCode || '').toUpperCase(),
            languageCode: req.body?.languageCode || geo.languageCode,
            requirements: safeRequirements,
            screeningQuestions: safeScreeningQuestions,
            minSalary: parsedMinSalary,
            maxSalary: parsedMaxSalary,
            openings: parsedOpenings,
            shift: shift || 'Flexible',
            mandatoryLicenses: safeMandatoryLicenses,
            isPulse: Boolean(isPulse),
            remoteAllowed: Boolean(remoteAllowed),
            priorityListing: Boolean(priorityListing),
            ...(resolvedExpiryAt ? { expiresAt: resolvedExpiryAt } : {}),
        });

        await Post.create({
            user: employerObjectId,
            authorId: employerObjectId,
            postType: 'job',
            type: 'job',
            visibility: 'public',
            content: sanitizeText(`${safeTitle} at ${safeCompanyName} in ${safeLocation}`, { maxLength: 5000 }),
            media: [],
            mediaUrl: '',
            trustWeight: Number(employerUser?.isVerified ? 0.2 : 0) + Number(employerUser?.hasCompletedProfile ? 0.1 : 0),
            meta: {
                jobId: String(job._id),
            },
        }).catch(() => {});

        safeLogPlatformEvent({
            type: 'job_post',
            userId: employerObjectId,
            meta: {
                jobId: String(job._id),
                priorityListing: Boolean(priorityListing),
            },
        });
        setImmediate(() => {
            enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(employerObjectId),
                    reason: 'job_post',
                },
            }).catch(() => {});
        });

        fireAndForget('trackJobPostUsage', () => recordFeatureUsage({
            userId: employerObjectId,
            featureKey: 'job_post_created',
            metadata: {
                jobId: String(job._id),
                countryCode: job.countryCode,
                regionCode: job.regionCode,
            },
        }), { userId: String(employerObjectId), jobId: String(job._id) });
        fireAndForget('invalidateJobCachesAfterCreate', async () => {
            await Promise.allSettled([
                delByPattern('cache:jobs:*'),
                delByPattern('cache:analytics:employer-summary:*'),
            ]);
        }, { userId: String(employerObjectId), jobId: String(job._id) });
        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'job_created',
                jobId: String(job._id),
                employerId: String(employerObjectId),
            },
            label: 'job_created_recalculation',
        });

        res.status(201).json({
            success: true,
            jobId: String(job._id),
            data: job,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all jobs posted by the logged-in employer
// @route   GET /api/jobs/my-jobs
// @access  Protected
const getEmployerJobs = async (req, res) => {
    try {
        const employerObjectId = toMongoObjectId(req.user?._id);
        if (!employerObjectId) {
            return res.status(200).json({
                success: true,
                count: 0,
                total: 0,
                page: 1,
                pages: 0,
                data: [],
            });
        }

        const { page, limit, skip } = resolvePagination({
            page: req.query.page,
            limit: req.query.limit,
            defaultLimit: 20,
            maxLimit: 100,
        });

        const jobs = await Job.find({ employerId: employerObjectId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Job.countDocuments({ employerId: employerObjectId });

        res.status(200).json({
            success: true,
            count: jobs.length,
            total,
            page,
            pages: Math.ceil(total / limit),
            data: jobs,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const normalizeSkillToken = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9+\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// @desc    Get backend-driven insights for an employer job
// @route   GET /api/jobs/:id/insights
// @access  Protected (Employer owner)
const getEmployerJobInsights = async (req, res) => {
    try {
        const jobId = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            return res.status(400).json({ success: false, message: 'Invalid job id' });
        }

        const job = await Job.findById(jobId).select('_id employerId requirements');
        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (String(job.employerId) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const [applications, matchAgg] = await Promise.all([
            Application.find({ job: job._id })
                .select('status createdAt updatedAt hiredAt worker')
                .populate({
                    path: 'worker',
                    select: 'roleProfiles',
                })
                .lean(),
            MatchLog.aggregate([
                { $match: { jobId: job._id } },
                {
                    $group: {
                        _id: null,
                        avgScore: { $avg: '$finalScore' },
                    },
                },
            ]),
        ]);

        const totalApplications = applications.length;
        const canonicalStatusCounts = applications.reduce((acc, application) => {
            const status = normalizeApplicationStatus(application?.status, 'applied');
            acc[status] = Number(acc[status] || 0) + 1;
            return acc;
        }, {});

        const shortlistedCount = Number(canonicalStatusCounts.shortlisted || 0);
        const shortlistedPercent = totalApplications > 0
            ? Math.round((shortlistedCount / totalApplications) * 100)
            : 0;

        const matchAverageRaw = Number(matchAgg?.[0]?.avgScore || 0);
        const avgMatchScorePercent = Math.round(
            (matchAverageRaw <= 1 ? matchAverageRaw * 100 : matchAverageRaw)
        );

        const requirements = Array.isArray(job.requirements)
            ? job.requirements.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        let topSkillGap = 'Insufficient data';
        if (requirements.length && totalApplications > 0) {
            const gapRows = requirements.map((requirement) => {
                const requirementToken = normalizeSkillToken(requirement);
                if (!requirementToken) {
                    return { requirement, missingCount: 0 };
                }
                const missingCount = applications.reduce((count, application) => {
                    const roleProfiles = Array.isArray(application?.worker?.roleProfiles)
                        ? application.worker.roleProfiles
                        : [];
                    const applicantSkills = new Set(roleProfiles.flatMap((profile) => (
                        Array.isArray(profile?.skills)
                            ? profile.skills.map((skill) => normalizeSkillToken(skill)).filter(Boolean)
                            : []
                    )));
                    return applicantSkills.has(requirementToken) ? count : count + 1;
                }, 0);
                return { requirement, missingCount };
            });

            const topGap = gapRows.sort((left, right) => {
                if (right.missingCount !== left.missingCount) {
                    return right.missingCount - left.missingCount;
                }
                return String(left.requirement).localeCompare(String(right.requirement));
            })[0];

            if (topGap && Number(topGap.missingCount) > 0) {
                topSkillGap = String(topGap.requirement || '').trim() || 'Insufficient data';
            }
        }

        const hiredDurationsDays = applications
            .filter((application) => normalizeApplicationStatus(application?.status, 'applied') === 'hired')
            .map((application) => {
                const start = new Date(application?.createdAt || Date.now()).getTime();
                const end = new Date(application?.hiredAt || application?.updatedAt || Date.now()).getTime();
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
                    return null;
                }
                return (end - start) / (1000 * 60 * 60 * 24);
            })
            .filter((value) => Number.isFinite(value) && value >= 0);

        const timeToHireDays = hiredDurationsDays.length > 0
            ? Number((hiredDurationsDays.reduce((sum, value) => sum + value, 0) / hiredDurationsDays.length).toFixed(1))
            : null;

        return res.json({
            success: true,
            insights: {
                totalApplications,
                shortlistedPercent,
                avgMatchScorePercent,
                topSkillGap,
                timeToHireDays,
                pipeline: {
                    applied: Number(canonicalStatusCounts.applied || 0),
                    shortlisted: Number(canonicalStatusCounts.shortlisted || 0),
                    interviewing: Number(canonicalStatusCounts.interview_requested || 0) + Number(canonicalStatusCounts.interview_completed || 0),
                    offer: Number(canonicalStatusCounts.offer_sent || 0) + Number(canonicalStatusCounts.offer_accepted || 0) + Number(canonicalStatusCounts.offer_declined || 0),
                    hired: Number(canonicalStatusCounts.hired || 0),
                },
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to load job insights' });
    }
};

// @desc    Get a single job by id
// @route   GET /api/jobs/:id
// @access  Protected
const getJobById = async (req, res) => {
    try {
        const jobId = String(req.params.id || '').trim();
        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid job id',
            });
        }

        const job = await Job.findById(jobId).lean();
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job not found',
            });
        }

        const requesterId = String(req.user?._id || '').trim();
        const ownerId = String(job?.employerId || '').trim();
        const status = String(job?.status || '').trim().toUpperCase();
        const isOpen = Boolean(job?.isOpen) && status === 'OPEN' && !Boolean(job?.isDisabled);
        const canRead = isOpen || (requesterId && ownerId && requesterId === ownerId);
        if (!canRead) {
            return res.status(404).json({
                success: false,
                message: 'Job not found',
            });
        }

        const [enrichedJob] = await enrichJobsWithEmployerBranding([job]);

        return res.status(200).json({
            success: true,
            data: enrichedJob || job,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// @desc    Get jobs with optional filters (companyId)
// @route   GET /api/jobs
// @access  Protected
const getJobs = async (req, res) => {
    try {
        const { companyId } = req.query;
        const districtFilter = String(req.query.district || '').trim();
        const mandalFilter = String(req.query.mandal || '').trim();
        const hasExplicitLocationFilter = Boolean(districtFilter || mandalFilter);
        const countryFilter = normalizeCountryCode(req.query.country || req.user?.country || 'IN');
        const routing = resolveRoutingContext({
            user: req.user || null,
            requestedRegion: req.query.region,
        });
        const regionFilter = String(req.query.region || req.user?.regionCode || '').trim().toUpperCase();
        const regionCandidates = Array.from(new Set([regionFilter, ...routing.failoverRegions]
            .map((value) => String(value || '').trim().toUpperCase())
            .filter(Boolean)));
        const crossBorderEnabled = ['true', '1', 'yes', 'on'].includes(String(req.query.crossBorder || '').toLowerCase());
        const { page, limit, skip } = resolvePagination({
            page: req.query.page,
            limit: req.query.limit,
            defaultLimit: 20,
            maxLimit: 100,
        });
        const query = {};
        query.isDisabled = { $ne: true };

        if (companyId) {
            const companyFilters = [];
            if (mongoose.Types.ObjectId.isValid(companyId)) {
                companyFilters.push({ employerId: companyId });
            }
            companyFilters.push({ companyName: companyId });
            query.$or = companyFilters;
            query.status = 'OPEN';
        } else {
            query.isOpen = true;
            query.status = 'OPEN';
            if (!crossBorderEnabled) {
                query.$or = [
                    { countryCode: countryFilter },
                    { country: countryFilter },
                    { remoteAllowed: true },
                ];
                // Manual location searches (district/mandal) should not be blocked by
                // region routing. The location clauses are already restrictive.
                if (regionCandidates.length && !hasExplicitLocationFilter) {
                    query.$and = [
                        { $or: [
                            { regionCode: { $in: regionCandidates } },
                            { region: { $in: regionCandidates } },
                            { remoteAllowed: true },
                        ] },
                    ];
                }
            } else if (regionCandidates.length && !hasExplicitLocationFilter) {
                query.$or = [
                    { regionCode: { $in: regionCandidates } },
                    { region: { $in: regionCandidates } },
                    { remoteAllowed: true },
                ];
            }
        }

        const structuredLocationClauses = buildLocationQuery({
            district: districtFilter,
            mandal: mandalFilter,
        });
        if (structuredLocationClauses.length > 0) {
            query.$and = [
                ...(Array.isArray(query.$and) ? query.$and : []),
                ...structuredLocationClauses,
            ];
        }

        const workerProfile = !companyId
            ? await WorkerProfile.findOne({ user: req.user._id })
                .populate('user', 'isVerified hasCompletedProfile profileComplete')
                .lean()
            : null;
        const canComputeMatches = Boolean(
            workerProfile
            && Array.isArray(workerProfile.roleProfiles)
            && workerProfile.roleProfiles.length > 0
        );

        const cacheKey = buildCacheKey('jobs:list', {
            companyId: companyId || null,
            countryFilter: countryFilter || null,
            regionFilter: regionCandidates.length ? regionCandidates : null,
            crossBorderEnabled,
            page,
            limit,
            query,
            matchUser: canComputeMatches ? String(req.user?._id || '') : null,
        });
        const cached = await getJSON(cacheKey);
        if (cached) {
            return res.status(200).json(cached);
        }

        const [jobs, total] = await Promise.all([
            Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Job.countDocuments(query),
        ]);

        let responseJobs = await enrichJobsWithEmployerBranding(jobs);
        if (canComputeMatches && jobs.length > 0) {
            const workerUser = workerProfile.user || {};
            const intelligence = await buildMatchIntelligenceContext({
                worker: workerProfile,
                jobs,
                cityHint: workerProfile.district || workerProfile.city || null,
            });

            const scoredJobs = [];
            for (const job of jobs) {
                const match = await compute_match({
                    profile: workerProfile,
                    profileUser: workerUser,
                    job,
                    intelligenceContext: intelligence,
                });

                scoredJobs.push({
                    ...job,
                    matchScore: Number(match.matchScore || 0),
                    matchPercentage: Number(match.matchPercentage || 0),
                    match_score: Number(match.matchScore || 0),
                    match_percentage: Number(match.matchPercentage || 0),
                    matchTier: match.tier || 'REJECT',
                    matchExplanation: match.explanation || {},
                    aiInsight: match.aiInsight || null,
                    ai_insight: match.aiInsight || null,
                });
            }

            scoredJobs.sort((left, right) => {
                if (Number(right.match_percentage || 0) !== Number(left.match_percentage || 0)) {
                    return Number(right.match_percentage || 0) - Number(left.match_percentage || 0);
                }
                const rightTime = new Date(right.createdAt || 0).getTime();
                const leftTime = new Date(left.createdAt || 0).getTime();
                if (rightTime !== leftTime) return rightTime - leftTime;
                return String(left._id || '').localeCompare(String(right._id || ''));
            });

            responseJobs = await enrichJobsWithEmployerBranding(scoredJobs);
        }

        const responsePayload = {
            success: true,
            count: responseJobs.length,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
            data: responseJobs,
        };
        await setJSON(cacheKey, responsePayload, CACHE_TTL_SECONDS.jobs);
        return res.status(200).json(responsePayload);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// @desc    Get AI-suggested requirements for a job title
// @route   POST /api/jobs/suggest
// @access  Protected
const suggestRequirements = async (req, res) => {
    const jobTitle = String(req.body?.jobTitle || req.body?.title || '').trim();

    if (!jobTitle) {
        return res.status(400).json({
            success: false,
            message: 'Please provide a job title'
        });
    }

    try {
        const suggestions = await suggestJobRequirements(jobTitle);

        res.status(200).json({
            success: true,
            data: suggestions,
            suggestions: Array.isArray(suggestions?.requirements) ? suggestions.requirements : [],
        });
    } catch (error) {
        console.warn('AI Suggestion Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to generate AI suggestions'
        });
    }
};

// Helper: Clear all match cache entries for a specific job (prevent ghost matches)
const clearJobMatches = async (jobId) => {
    let totalDeleted = 0;

    try {
        // Clear from Redis
        if (redisClient && redisClient.isOpen) {
            const pattern = `match:${jobId}:*`;
            logger.info({ event: 'job_cache_cleanup_scan', pattern });

            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
                await redisClient.del(keys);
                totalDeleted += keys.length;
                logger.info({ event: 'job_cache_cleanup_redis_deleted', deletedCount: keys.length, jobId: String(jobId) });
            } else {
                logger.info({ event: 'job_cache_cleanup_redis_none', jobId: String(jobId) });
            }
        }
    } catch (redisError) {
        console.warn('❌ [CLEANUP REDIS ERROR]:', redisError.message);
        // Don't throw - continue to Map cleanup
    }

    try {
        // Clear from Map fallback
        if (matchCache) {
            let mapDeletedCount = 0;
            for (const [key, value] of matchCache.entries()) {
                if (key.startsWith(`match:${jobId}:`)) {
                    matchCache.delete(key);
                    mapDeletedCount++;
                }
            }
            if (mapDeletedCount > 0) {
                totalDeleted += mapDeletedCount;
                logger.info({ event: 'job_cache_cleanup_map_deleted', deletedCount: mapDeletedCount, jobId: String(jobId) });
            }
        }
    } catch (mapError) {
        console.warn('❌ [CLEANUP MAP ERROR]:', mapError.message);
        // Don't throw - cache cleanup failure shouldn't block job deletion
    }

    logger.info({ event: 'job_cache_cleanup_complete', jobId: String(jobId), totalDeleted });
    return totalDeleted;
};

const emitJobStatusChanged = async ({
    io,
    job,
    previousStatus,
    nextStatus,
}) => {
    if (!io || !job || previousStatus === nextStatus) return;

    const payload = {
        jobId: String(job._id),
        previousStatus: String(previousStatus || ''),
        status: String(nextStatus || ''),
        updatedAt: new Date().toISOString(),
    };

    const roomSet = new Set();
    const employerUserId = String(job.employerId || '').trim();
    if (employerUserId) {
        roomSet.add(`user_${employerUserId}`);
        roomSet.add(`employer:${employerUserId}`);
    }

    const linkedApplications = await Application.find({ job: job._id }).select('worker').lean();
    const workerIds = Array.from(new Set(
        linkedApplications
            .map((row) => String(row?.worker || '').trim())
            .filter(Boolean)
    ));
    if (workerIds.length) {
        const workerProfiles = await WorkerProfile.find({ _id: { $in: workerIds } }).select('user').lean();
        for (const profile of workerProfiles) {
            const candidateUserId = String(profile?.user || '').trim();
            if (!candidateUserId) continue;
            roomSet.add(`user_${candidateUserId}`);
            roomSet.add(`candidate:${candidateUserId}`);
        }
    }

    for (const roomName of roomSet) {
        io.to(roomName).emit('JOB_STATUS_CHANGED', payload);
        io.to(roomName).emit('job_status_changed', payload);
    }
};

// @desc    Delete a job
// @route   DELETE /api/jobs/:id
// @access  Protected
const deleteJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // Verify ownership
        if (job.employerId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        // CRITICAL: Clear all cached matches for this job BEFORE deletion
        logger.info({ event: 'job_delete_cache_cleanup_start', jobId: String(job._id) });
        const deletedCount = await clearJobMatches(job._id);

        const [deletedApplications, deletedMatchLogs, deletedMatchRuns, deletedConnectPosts] = await Promise.all([
            Application.deleteMany({ job: job._id }),
            MatchLog.deleteMany({ jobId: job._id }),
            MatchRun.deleteMany({ jobId: job._id }),
            deleteConnectPostsForJobs([job._id]),
        ]);
        await UpsellExposure.deleteMany({
            employerId: toMongoObjectId(req.user?._id),
            jobId: job._id,
        });
        await job.deleteOne();
        await delByPattern('cache:feed:posts:*');
        await delByPattern('cache:jobs:*');
        await delByPattern('cache:analytics:employer-summary:*');
        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'job_deleted',
                jobId: String(job._id),
                employerId: String(req.user._id),
            },
            label: 'job_deleted_recalculation',
        });

        res.status(200).json({
            success: true,
            message: 'Job deleted successfully',
            cacheEntriesCleared: deletedCount,
            deletedApplications: Number(deletedApplications?.deletedCount || 0),
            deletedMatchLogs: Number(deletedMatchLogs?.deletedCount || 0),
            deletedMatchRuns: Number(deletedMatchRuns?.deletedCount || 0),
            deletedConnectPosts: Number(deletedConnectPosts?.deletedCount || 0),
        });
    } catch (error) {
        console.warn('❌ [JOB DELETE ERROR]:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete all jobs for the logged-in employer
// @route   DELETE /api/jobs/my-jobs/all
// @access  Protected
const deleteAllEmployerJobs = async (req, res) => {
    try {
        const employerObjectId = toMongoObjectId(req.user?._id);
        if (!employerObjectId) {
            return res.status(200).json({
                success: true,
                deletedJobs: 0,
                deletedApplications: 0,
                deletedMatchLogs: 0,
                deletedMatchRuns: 0,
                cacheEntriesCleared: 0,
                message: 'No jobs found for this account.',
            });
        }

        const employerJobs = await Job.find({ employerId: employerObjectId }).select('_id').lean();
        if (!employerJobs.length) {
            return res.status(200).json({
                success: true,
                deletedJobs: 0,
                deletedApplications: 0,
                deletedMatchLogs: 0,
                deletedMatchRuns: 0,
                cacheEntriesCleared: 0,
                message: 'No jobs found for this account.',
            });
        }

        const jobIds = employerJobs
            .map((row) => toMongoObjectId(row?._id))
            .filter(Boolean);

        let cacheEntriesCleared = 0;
        for (const jobId of jobIds) {
            cacheEntriesCleared += await clearJobMatches(jobId);
        }

        const [deleteJobsResult, deleteApplicationsResult, deleteMatchLogsResult, deleteMatchRunsResult, deleteConnectPostsResult] = await Promise.all([
            Job.deleteMany({ _id: { $in: jobIds }, employerId: employerObjectId }),
            Application.deleteMany({ job: { $in: jobIds } }),
            MatchLog.deleteMany({ jobId: { $in: jobIds } }),
            MatchRun.deleteMany({ jobId: { $in: jobIds } }),
            deleteConnectPostsForJobs(jobIds),
        ]);

        await UpsellExposure.deleteMany({
            employerId: employerObjectId,
            jobId: { $in: jobIds },
        });

        await delByPattern('cache:feed:posts:*');
        await delByPattern('cache:jobs:*');
        await delByPattern('cache:analytics:employer-summary:*');

        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'employer_jobs_deleted',
                employerId: String(employerObjectId),
                deletedJobIds: jobIds.map((id) => String(id)),
            },
            label: 'employer_jobs_deleted_recalculation',
        });

        return res.status(200).json({
            success: true,
            deletedJobs: Number(deleteJobsResult?.deletedCount || 0),
            deletedApplications: Number(deleteApplicationsResult?.deletedCount || 0),
            deletedMatchLogs: Number(deleteMatchLogsResult?.deletedCount || 0),
            deletedMatchRuns: Number(deleteMatchRunsResult?.deletedCount || 0),
            deletedConnectPosts: Number(deleteConnectPostsResult?.deletedCount || 0),
            cacheEntriesCleared,
            message: 'All your job postings were deleted successfully.',
        });
    } catch (error) {
        console.warn('❌ [DELETE ALL JOBS ERROR]:', error.message);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update a job
// @route   PUT /api/jobs/:id
// @access  Protected
const updateJob = async (req, res) => {
    try {
        let job = await Job.findById(req.params.id);

        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        // Verify ownership
        if (job.employerId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ success: false, message: 'Not authorized' });
        }

        const previousStatus = typeof Job.normalizeJobStatus === 'function'
            ? Job.normalizeJobStatus(job.status, job.isOpen ? 'OPEN' : 'PAUSED')
            : String(job.status || '').toUpperCase();

        // Allowed fields to update
        const {
            title,
            companyName,
            salaryRange,
            location,
            district,
            mandal,
            locationLabel,
            requirements,
            minSalary,
            maxSalary,
            openings,
            remoteAllowed,
            status: requestedStatus,
            processingId,
        } = req.body;

        const parsedMinSalary = parseSalaryValue(minSalary);
        const parsedMaxSalary = parseSalaryValue(maxSalary);
        const parsedOpenings = parseOpeningsValue(openings);
        if (
            Number.isNaN(parsedMinSalary)
            || Number.isNaN(parsedMaxSalary)
            || Number.isNaN(parsedOpenings)
            || (parsedMinSalary !== null && (parsedMinSalary < 0 || parsedMinSalary > MAX_SALARY_VALUE))
            || (parsedMaxSalary !== null && (parsedMaxSalary < 0 || parsedMaxSalary > MAX_SALARY_VALUE))
            || (parsedMinSalary !== null && parsedMaxSalary !== null && parsedMaxSalary < parsedMinSalary)
        ) {
            return res.status(400).json({ success: false, message: 'Invalid salary bounds' });
        }

        const safeTitle = title !== undefined ? sanitizeText(title, { maxLength: 120 }) : null;
        const safeCompanyName = companyName !== undefined ? sanitizeText(companyName, { maxLength: 120 }) : null;
        const safeSalaryRange = salaryRange !== undefined ? sanitizeText(salaryRange, { maxLength: 120 }) : null;
        const safeLocation = location !== undefined ? sanitizeText(location, { maxLength: 120 }) : null;
        const structuredLocation = resolveStructuredLocationFields({
            district: district !== undefined ? sanitizeText(district, { maxLength: 120 }) : job?.district,
            mandal: mandal !== undefined ? sanitizeText(mandal, { maxLength: 120 }) : job?.mandal,
            location: safeLocation !== null ? safeLocation : job?.location,
            locationLabel: locationLabel !== undefined ? sanitizeText(locationLabel, { maxLength: 160 }) : job?.locationLabel,
        });

        if (safeTitle !== null) job.title = safeTitle || job.title;
        if (safeCompanyName !== null) job.companyName = safeCompanyName || job.companyName;
        if (safeSalaryRange !== null) job.salaryRange = safeSalaryRange || job.salaryRange;
        if (
            safeLocation !== null
            || district !== undefined
            || mandal !== undefined
            || locationLabel !== undefined
        ) {
            job.location = structuredLocation.legacyLocation || job.location;
            job.district = structuredLocation.district || job.district;
            job.mandal = structuredLocation.mandal || job.mandal;
            job.locationLabel = structuredLocation.locationLabel || job.locationLabel;
        }
        if (parsedMinSalary !== null) job.minSalary = parsedMinSalary;
        if (parsedMaxSalary !== null) job.maxSalary = parsedMaxSalary;
        if (parsedOpenings !== null) job.openings = parsedOpenings;
        if (location || req.body?.countryCode) {
            const geo = resolveJobGeo({
                location: job.location,
                countryCode: req.body?.countryCode || job.countryCode || req.user?.country || 'IN',
            });
            job.country = geo.countryCode;
            job.region = String(req.body?.region || req.body?.regionCode || geo.regionCode || '').toUpperCase();
            job.countryCode = geo.countryCode;
            job.regionCode = String(req.body?.regionCode || geo.regionCode || '').toUpperCase();
            job.currencyCode = String(req.body?.currencyCode || geo.currencyCode || '').toUpperCase();
            job.languageCode = req.body?.languageCode || geo.languageCode;
        }

        if (remoteAllowed !== undefined) {
            job.remoteAllowed = Boolean(remoteAllowed);
        }

        // Handle requirements array from string or array
        if (requirements) {
            job.requirements = Array.isArray(requirements)
                ? requirements.map((entry) => sanitizeText(entry, { maxLength: 120 })).filter(Boolean)
                : requirements.split(',').map((s) => sanitizeText(s, { maxLength: 120 })).filter(Boolean);
        }

        if (requestedStatus) {
            const normalizedStatus = typeof Job.normalizeJobStatus === 'function'
                ? Job.normalizeJobStatus(requestedStatus, '__INVALID__')
                : String(requestedStatus || '').toUpperCase();
            if (normalizedStatus === '__INVALID__' || !Array.isArray(Job.JOB_STATUS_ENUM) || !Job.JOB_STATUS_ENUM.includes(normalizedStatus)) {
                return res.status(400).json({ success: false, message: 'Invalid job status value' });
            }

            const transition = canTransitionJobStatus({
                fromStatus: previousStatus,
                toStatus: normalizedStatus,
                allowNoop: true,
            });
            if (!transition.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid job status transition',
                    details: transition.reason,
                    fromStatus: transition.fromStatus,
                    toStatus: transition.toStatus,
                });
            }

            // Guard draft activation from Smart Interview flow
            if (normalizedStatus === 'OPEN' && processingId) {
                const processingJob = await InterviewProcessingJob.findOne({
                    _id: processingId,
                    userId: req.user._id,
                    status: 'completed',
                }).select('createdJobId');

                if (!processingJob) {
                    return res.status(400).json({ success: false, message: 'Invalid processing reference' });
                }

                if (String(processingJob.createdJobId || '') !== String(job._id)) {
                    return res.status(400).json({ success: false, message: 'Processing job does not match this draft job' });
                }
            }

            job.status = normalizedStatus;
            job.isOpen = normalizedStatus === 'OPEN';
        }

        const updatedJob = await job.save();
        await delByPattern('cache:jobs:*');
        await delByPattern('cache:analytics:employer-summary:*');
        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'job_updated',
                jobId: String(updatedJob._id),
                employerId: String(req.user._id),
                status: String(updatedJob.status || 'unknown'),
            },
            label: 'job_updated_recalculation',
        });
        const nextStatus = typeof Job.normalizeJobStatus === 'function'
            ? Job.normalizeJobStatus(updatedJob.status, updatedJob.isOpen ? 'OPEN' : 'PAUSED')
            : String(updatedJob.status || '').toUpperCase();
        const io = req.app.get('io');
        if (previousStatus !== nextStatus) {
            fireAndForget('emitJobStatusChanged', () => emitJobStatusChanged({
                io,
                job: updatedJob,
                previousStatus,
                nextStatus,
            }), { jobId: String(updatedJob._id), previousStatus, nextStatus });
        }

        let autoRejectedApplications = null;
        if (previousStatus !== 'FILLED' && nextStatus === 'FILLED') {
            autoRejectedApplications = await rejectPendingApplicationsForFilledJob({
                jobId: updatedJob._id,
                actorId: req.user?._id || null,
                actorType: 'employer',
            });
        }

        if (previousStatus !== 'OPEN' && nextStatus === 'OPEN') {
            fireAndForget('markFirstJobActivatedOnce', () => markFirstJobActivatedOnce({
                employerId: req.user._id,
                jobId: updatedJob._id,
                city: updatedJob.location || null,
            }), { employerId: String(req.user._id), jobId: String(updatedJob._id) });
        }
        if (previousStatus === 'OPEN' && ['CLOSED', 'FILLED'].includes(nextStatus)) {
            fireAndForget('recordJobFillCompletedMetric', () => recordJobFillCompletedOnce({
                jobId: updatedJob._id,
                city: updatedJob.location || 'unknown',
                roleCluster: updatedJob.title || 'general',
                metadata: {
                    source: 'job_controller',
                    triggerStatus: nextStatus,
                    employerId: String(req.user._id),
                },
            }), { employerId: String(req.user._id), jobId: String(updatedJob._id) });
        }

        let signalFinalized = false;
        if (processingId && nextStatus === 'OPEN') {
            await markJobConfirmed({ processingId, userId: req.user._id });
            const finalizeResult = await finalizeInterviewSignalIfEligible({
                processingId,
                userId: req.user._id,
            });
            signalFinalized = Boolean(finalizeResult?.finalized);

            const [draftCount, confirmedCount] = await Promise.all([
                InterviewProcessingJob.countDocuments({
                    userId: req.user._id,
                    role: EMPLOYER_PRIMARY_ROLE,
                    createdJobId: { $ne: null },
                }),
                InterviewProcessingJob.countDocuments({
                    userId: req.user._id,
                    role: EMPLOYER_PRIMARY_ROLE,
                    createdJobId: { $ne: null },
                    jobConfirmedAt: { $ne: null },
                }),
            ]);
            logger.info({
                metric: 'draft_job_confirmed',
                processingId: String(processingId),
                jobId: String(updatedJob._id),
                signalFinalized,
                correlationId: String(processingId),
            });
            logger.info({
                metric: 'draft_to_confirm_ratio',
                value: confirmedCount / Math.max(1, draftCount),
                confirmedCount,
                draftCount,
                correlationId: String(processingId),
            });
            await publishMetric({
                metricName: 'DraftToConfirmRatio',
                value: confirmedCount / Math.max(1, draftCount),
                role: EMPLOYER_PRIMARY_ROLE,
                correlationId: String(processingId),
            });
        }

        res.status(200).json({
            success: true,
            data: updatedJob,
            signalFinalized,
            ...(autoRejectedApplications ? { autoRejectedApplications } : {}),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get recommended jobs for a worker profile
// @route   GET /api/jobs/recommended
// @access  Protected
const getRecommendedJobs = async (req, res) => {
    try {
        const cityFilter = String(req.query.city || '').trim();
        const districtFilter = String(req.query.district || '').trim();
        const mandalFilter = String(req.query.mandal || '').trim();
        const countryFilter = normalizeCountryCode(req.query.country || req.user?.country || 'IN');
        const regionFilter = String(req.query.region || '').trim().toUpperCase();
        const roleClusterFilter = String(req.query.roleCluster || '').trim();
        const requestedWorkerId = String(req.query.workerId || '').trim();
        const includePreferences = ['true', '1', 'yes', 'on'].includes(String(req.query.preferences || '').toLowerCase());
        const isAdmin = Boolean(req.user?.isAdmin);

        let worker = null;
        if (requestedWorkerId) {
            worker = await WorkerProfile.findById(requestedWorkerId)
                .populate('user', 'isVerified hasCompletedProfile country globalPreferences')
                .lean();

            if (!worker) {
                worker = await WorkerProfile.findOne({ user: requestedWorkerId })
                    .populate('user', 'isVerified hasCompletedProfile country globalPreferences')
                    .lean();
            }
        } else {
            worker = await WorkerProfile.findOne({ user: req.user._id })
                .populate('user', 'isVerified hasCompletedProfile country globalPreferences')
                .lean();
        }

        if (!worker) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        const workerOwnerId = String(worker.user?._id || worker.user || '');
        if (requestedWorkerId && !isAdmin && workerOwnerId !== String(req.user._id)) {
            return res.status(403).json({ message: 'Not authorized for requested workerId' });
        }

        if (!worker.isAvailable || !Array.isArray(worker.roleProfiles) || worker.roleProfiles.length === 0) {
            return res.json({ recommendedJobs: [] });
        }

        const workerUser = worker.user?._id
            ? worker.user
            : await User.findById(workerOwnerId).select('isVerified hasCompletedProfile country globalPreferences').lean();
        const matchPreferences = includePreferences ? (worker.settings?.matchPreferences || {}) : {};
        const crossBorderEnabled = isCrossBorderAllowed({
            user: workerUser,
            queryValue: req.query.crossBorder,
        });

        const query = {
            isOpen: true,
            status: 'OPEN',
            employerId: { $ne: workerOwnerId || req.user._id },
        };

        if (!crossBorderEnabled) {
            query.$or = [
                { countryCode: countryFilter },
                { country: countryFilter },
                { remoteAllowed: true },
            ];
        } else if (regionFilter) {
            query.$or = [
                { regionCode: regionFilter },
                { region: regionFilter },
                { remoteAllowed: true },
            ];
        }

        const structuredLocationClauses = buildLocationQuery({
            district: districtFilter || cityFilter,
            mandal: mandalFilter,
        });

        if (structuredLocationClauses.length > 0) {
            query.$and = [
                ...(Array.isArray(query.$and) ? query.$and : []),
                ...structuredLocationClauses,
            ];
        } else if (cityFilter) {
            query.location = new RegExp(`^${cityFilter}$`, 'i');
        }

        if (roleClusterFilter) {
            query.title = new RegExp(roleClusterFilter, 'i');
        }

        if (includePreferences && !roleClusterFilter) {
            const preferredRoleClusters = Array.isArray(matchPreferences.roleClusters)
                ? matchPreferences.roleClusters.filter(Boolean)
                : [];
            if (preferredRoleClusters.length) {
                query.$or = preferredRoleClusters.map((roleCluster) => ({
                    title: new RegExp(String(roleCluster), 'i'),
                }));
            }
        }

        if (includePreferences) {
            const shiftPreferences = Array.isArray(matchPreferences.preferredShiftTimes)
                ? matchPreferences.preferredShiftTimes.filter(Boolean)
                : [];
            if (shiftPreferences.length) {
                query.shift = { $in: shiftPreferences };
            }

            const maxCommuteDistanceKm = Number(matchPreferences.maxCommuteDistanceKm || 0);
            if (
                !cityFilter
                && !districtFilter
                && maxCommuteDistanceKm > 0
                && maxCommuteDistanceKm <= 15
                && (worker.district || worker.city)
            ) {
                query.district = new RegExp(`^${String(worker.district || worker.city).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
            }
        }

        const queryMaxLimit = Number.parseInt(process.env.DB_QUERY_MAX_LIMIT || '1000', 10);
        const safeRecommendationPoolLimit = Number.isFinite(queryMaxLimit) && queryMaxLimit > 0
            ? Math.min(queryMaxLimit, 1000)
            : 1000;
        const fetchJobsForQuery = (jobQuery) => Job.find(jobQuery)
            .sort({ createdAt: -1 })
            .limit(safeRecommendationPoolLimit)
            .lean();

        let jobs = await fetchJobsForQuery(query);
        if (!jobs.length) {
            // QA-safe fallback: if there are no external jobs, allow same-account jobs
            // so a single-user role-switch flow still sees match results.
            const selfFallbackQuery = { ...query };
            delete selfFallbackQuery.employerId;
            jobs = await fetchJobsForQuery(selfFallbackQuery);
        }

        jobs = filterJobsByGeo({
            jobs,
            user: workerUser,
            allowCrossBorder: crossBorderEnabled,
        }).jobs;

        if (includePreferences) {
            const salaryMin = Number(matchPreferences.salaryExpectationMin);
            const salaryMax = Number(matchPreferences.salaryExpectationMax);
            const hasSalaryMin = Number.isFinite(salaryMin) && salaryMin > 0;
            const hasSalaryMax = Number.isFinite(salaryMax) && salaryMax > 0;
            if (hasSalaryMin || hasSalaryMax) {
                jobs = jobs.filter((job) => {
                    const bounds = extractSalaryBounds(job);
                    if (!Number.isFinite(bounds.min) && !Number.isFinite(bounds.max)) return true;

                    if (hasSalaryMin && Number.isFinite(bounds.max) && bounds.max < salaryMin) return false;
                    if (hasSalaryMax && Number.isFinite(bounds.min) && bounds.min > salaryMax) return false;
                    return true;
                });
            }
        }

        const intentFiltered = await filterJobsByApplyIntent({
            worker,
            jobs,
        });
        if (intentFiltered.blocked) {
            // Never hard-block the feed. If intent policy enters blocked mode,
            // continue with unfiltered pool so workers still receive jobs.
            jobs = Array.isArray(jobs) ? jobs : [];
        } else {
            jobs = intentFiltered.jobs;
        }

        if (jobs.length === 0) {
            return res.json({
                recommendedJobs: [],
                matchModelVersionUsed: null,
                appliedPreferences: includePreferences ? matchPreferences : null,
            });
        }

        const intelligence = await buildMatchIntelligenceContext({
            worker,
            jobs,
            cityHint: districtFilter || cityFilter || worker.district || worker.city || null,
        });
        const dynamicThresholds = intelligence.dynamicThresholds || tierThresholdMap;

        const deterministic = matchEngineV2.rankJobsForWorker({
            worker,
            workerUser: workerUser || {},
            jobs,
            roleCluster: roleClusterFilter || null,
            maxResults: 300,
            scoringContextResolver: (job) => intelligence.getScoringContextForJob(job),
        });

        const scored = [];
        let matchModelVersionUsed = null;
        const activeRoleProfile = Array.isArray(worker?.roleProfiles)
            ? (worker.roleProfiles.find((profile) => Boolean(profile?.activeProfile)) || worker.roleProfiles[0] || null)
            : null;
        const workDnaVersionId = buildWorkDnaVersionId({
            worker,
            roleData: activeRoleProfile || {},
        });

        for (const row of deterministic.matches) {
            const overlaid = await applyOverlay({
                deterministicScore: row,
                worker,
                job: row.job,
                model: {
                    user: req.user,
                    workerUser: workerUser || {},
                    roleData: row.roleData,
                    deterministicScores: row.deterministicScores,
                },
            });

            if (!overlaid) {
                continue;
            }
            if (overlaid.matchModelVersionUsed) {
                matchModelVersionUsed = overlaid.matchModelVersionUsed;
            }
            scored.push(overlaid);
        }

        scored.sort(matchEngineV2.sortScoredMatches);
        const minTier = String(matchPreferences.minimumMatchTier || 'POSSIBLE').toUpperCase();
        const thresholdMap = {
            STRONG: Number(dynamicThresholds.STRONG || tierThresholdMap.STRONG),
            GOOD: Number(dynamicThresholds.GOOD || tierThresholdMap.GOOD),
            POSSIBLE: Number(dynamicThresholds.POSSIBLE || tierThresholdMap.POSSIBLE),
        };
        const minThreshold = includePreferences
            ? (thresholdMap[minTier] || thresholdMap.POSSIBLE)
            : thresholdMap.POSSIBLE;
        const thresholdRows = scored.filter((row) => (row.matchProbability ?? row.finalScore) >= minThreshold);
        const topRows = (thresholdRows.length ? thresholdRows : scored).slice(0, 20);
        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);

        const responseRows = topRows.map((row) => {
            const probability = Number(row.matchProbability ?? row.finalScore ?? 0);
            const resolvedTier = matchEngineV2.mapTier(probability, dynamicThresholds);
            const matchScoreSource = row.matchModelVersionUsed
                ? 'probabilistic_model'
                : (row.probabilisticFallbackUsed ? 'deterministic_fallback' : 'match_engine');
            return ({
            job: row.job,
            matchScore: row.matchScore,
            matchProbability: probability,
            tier: resolvedTier,
            tierLabel: matchEngineV2.toLegacyTierLabel(resolvedTier),
            matchModelVersionUsed: row.matchModelVersionUsed || matchModelVersionUsed,
            probabilisticFallbackUsed: Boolean(row.probabilisticFallbackUsed),
            matchScoreSource,
            explainability: matchUiV1Enabled ? (row.explainability || {}) : {},
            timelineTransparency: {
                jobPostedAt: row?.job?.createdAt || null,
                jobUpdatedAt: row?.job?.updatedAt || null,
                scoredAt: new Date().toISOString(),
            },
            workDnaVersionId,
            });
        });
        const brandedJobs = await enrichJobsWithEmployerBranding(responseRows.map((row) => row.job));
        const brandedJobMap = new Map(
            brandedJobs.map((job) => [String(job?._id || ''), job])
        );
        const responseRowsWithBranding = responseRows.map((row) => ({
            ...row,
            job: brandedJobMap.get(String(row?.job?._id || '')) || row.job,
        }));

        setImmediate(() => {
            logRecommendedRun({
                userId: req.user._id,
                workerId: worker._id,
                stats: {
                    ...deterministic,
                    totalReturned: responseRowsWithBranding.length,
                    avgScore: responseRowsWithBranding.length
                        ? responseRowsWithBranding.reduce((sum, item) => sum + Number(item.matchProbability || 0), 0) / responseRowsWithBranding.length
                        : 0,
                },
                rows: responseRowsWithBranding,
                modelVersionUsed: matchModelVersionUsed,
                metadata: {
                    correlationId: `recommended-${req.user._id}-${worker._id}-${Date.now()}`,
                    cityFilter: districtFilter || cityFilter || null,
                    roleClusterFilter: roleClusterFilter || null,
                    triggeredBy: 'recommended_jobs_refresh',
                    workDnaVersionId,
                },
            });
            Promise.all(responseRowsWithBranding.map((row) => recordMatchPerformanceMetric({
                eventName: 'MATCH_RECOMMENDATION_VIEWED',
                jobId: row.job?._id,
                workerId: worker._id,
                city: row.job?.district || row.job?.location || districtFilter || cityFilter || worker.district || worker.city || 'unknown',
                roleCluster: row.job?.title || roleClusterFilter || 'general',
                matchProbability: row.matchProbability,
                matchTier: row.tier,
                modelVersionUsed: row.matchModelVersionUsed || matchModelVersionUsed || null,
                timestamp: new Date(),
                metadata: {
                    source: 'recommended_jobs_endpoint',
                    userId: String(req.user._id),
                },
            }))).catch((metricError) => {
                console.warn('Recommended match metric collection failed:', metricError.message);
            });
        });

        fireAndForget('trackRecommendedJobsUsage', () => recordFeatureUsage({
            userId: workerOwnerId || req.user._id,
            featureKey: 'recommended_jobs_viewed',
            metadata: {
                totalReturned: responseRowsWithBranding.length,
                countryCode: countryFilter,
                regionCode: regionFilter || null,
            },
        }), { userId: String(workerOwnerId || req.user._id) });

        return res.json({
            recommendedJobs: responseRowsWithBranding,
            matchModelVersionUsed,
            appliedPreferences: includePreferences ? matchPreferences : null,
        });
    } catch (error) {
        console.warn('Recommended jobs failed:', error);
        return res.status(500).json({ message: 'Failed to fetch recommended jobs' });
    }
};

// @desc    Record one-time boost upsell exposure for employer job
// @route   POST /api/jobs/:id/boost-upsell-exposure
// @access  Protected (Employer owner)
const recordBoostUpsellExposure = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id).select('_id employerId location');
        if (!job) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        if (String(job.employerId) !== String(req.user._id)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        const exposureType = 'smart_interview_post_confirm';
        const result = await UpsellExposure.updateOne(
            { employerId: req.user._id, jobId: job._id, type: exposureType },
            {
                $setOnInsert: {
                    employerId: req.user._id,
                    jobId: job._id,
                    type: exposureType,
                    shownAt: new Date(),
                },
            },
            { upsert: true }
        );

        const shouldShow = Boolean(result?.upsertedCount);
        if (shouldShow) {
            fireAndForget('trackBoostUpsellShown', () => createAnalyticsEvent({
                userId: req.user._id,
                eventName: 'EMPLOYER_BOOST_UPSELL_SHOWN',
                metadata: {
                    jobId: String(job._id),
                    city: job.location || null,
                },
            }), { employerId: String(req.user._id), jobId: String(job._id) });
        }

        return res.status(200).json({
            success: true,
            shouldShow,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createJob,
    getJobs,
    getJobById,
    getEmployerJobs,
    getEmployerJobInsights,
    getRecommendedJobs,
    suggestRequirements,
    deleteJob,
    deleteAllEmployerJobs,
    updateJob,
    recordBoostUpsellExposure,
    clearJobMatches // Export for testing
};
