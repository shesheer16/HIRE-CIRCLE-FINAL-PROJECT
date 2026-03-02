const Job = require('../models/Job');
const Post = require('../models/Post');
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
const { sanitizeText } = require('../utils/sanitizeText');
const {
    evaluateEmployerProfileCompletion,
    isActionAllowedByProfileCompletion,
} = require('../services/profileCompletionService');
const logger = require('../utils/logger');
const { buildCacheKey, getJSON, setJSON, delByPattern, CACHE_TTL_SECONDS } = require('../services/cacheService');
const { dispatchAsyncTask, TASK_TYPES } = require('../services/asyncTaskDispatcher');
const { isCrossBorderAllowed, filterJobsByGeo } = require('../services/geoMatchService');
const { resolveRoutingContext } = require('../services/regionRoutingService');

const logRecommendedRun = async ({
    userId,
    workerId,
    stats = {},
    rows = [],
    modelVersionUsed = null,
    metadata = {},
}) => {
    try {
        const run = await MatchRun.create({
            contextType: 'RECOMMENDED_JOBS',
            userId,
            workerId,
            modelVersionUsed,
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
                explainability: row.explainability || {},
                matchModelVersionUsed: row.matchModelVersionUsed || modelVersionUsed || null,
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

// @desc    Create a new job
// @route   POST /api/jobs/
// @access  Protected
const createJob = async (req, res) => {
    const {
        title,
        companyName,
        salaryRange,
        location,
        requirements,
        screeningQuestions,
        minSalary,
        maxSalary,
        shift,
        mandatoryLicenses,
        isPulse,
        remoteAllowed,
        expiresAt,
    } = req.body;

    try {
        const employerUser = await User.findById(req.user._id)
            .select('name city isVerified hasCompletedProfile activeRole primaryRole role isDeleted')
            .lean();
        if (!employerUser || employerUser.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'Employer account not found',
            });
        }

        const employerProfile = await EmployerProfile.findOne({ user: req.user._id }).lean();
        const completion = evaluateEmployerProfileCompletion({
            user: employerUser,
            employerProfile: employerProfile || {},
        });
        const gate = isActionAllowedByProfileCompletion({
            action: 'post_job',
            completion,
        });
        if (!gate.allowed) {
            return res.status(403).json({
                success: false,
                message: `Complete your employer profile to at least ${gate.threshold}% before posting a job.`,
                code: gate.code,
                completion,
                missingRequiredFields: gate.missingRequiredFields,
            });
        }

        const parsedMinSalary = parseSalaryValue(minSalary);
        const parsedMaxSalary = parseSalaryValue(maxSalary);

        if (
            Number.isNaN(parsedMinSalary)
            || Number.isNaN(parsedMaxSalary)
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
        const safeLocation = sanitizeText(location, { maxLength: 120 });
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
            userId: req.user._id,
            feature: FEATURES.PRIORITY_LISTING,
        });

        const job = await Job.create({
            employerId: req.user._id,
            title: safeTitle,
            companyName: safeCompanyName,
            salaryRange: safeSalaryRange,
            location: safeLocation,
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
            shift: shift || 'Flexible',
            mandatoryLicenses: safeMandatoryLicenses,
            isPulse: Boolean(isPulse),
            remoteAllowed: Boolean(remoteAllowed),
            priorityListing: Boolean(priorityListing),
            ...(resolvedExpiryAt ? { expiresAt: resolvedExpiryAt } : {}),
        });

        await Post.create({
            user: req.user._id,
            authorId: req.user._id,
            postType: 'job',
            type: 'job',
            visibility: 'public',
            content: sanitizeText(`${safeTitle} at ${safeCompanyName} in ${safeLocation}`, { maxLength: 5000 }),
            media: [],
            mediaUrl: '',
            trustWeight: Number(req.user?.isVerified ? 0.2 : 0) + Number(req.user?.hasCompletedProfile ? 0.1 : 0),
            meta: {
                jobId: String(job._id),
            },
        }).catch(() => {});

        safeLogPlatformEvent({
            type: 'job_post',
            userId: req.user._id,
            meta: {
                jobId: String(job._id),
                priorityListing: Boolean(priorityListing),
            },
        });
        setImmediate(() => {
            enqueueBackgroundJob({
                type: 'trust_recalculation',
                payload: {
                    userId: String(req.user._id),
                    reason: 'job_post',
                },
            }).catch(() => {});
        });

        fireAndForget('trackJobPostUsage', () => recordFeatureUsage({
            userId: req.user._id,
            featureKey: 'job_post_created',
            metadata: {
                jobId: String(job._id),
                countryCode: job.countryCode,
                regionCode: job.regionCode,
            },
        }), { userId: String(req.user._id), jobId: String(job._id) });
        await delByPattern('cache:jobs:*');
        await delByPattern('cache:analytics:employer-summary:*');
        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'job_created',
                jobId: String(job._id),
                employerId: String(req.user._id),
            },
            label: 'job_created_recalculation',
        });

        res.status(201).json({
            success: true,
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
        const { page, limit, skip } = resolvePagination({
            page: req.query.page,
            limit: req.query.limit,
            defaultLimit: 20,
            maxLimit: 100,
        });

        const jobs = await Job.find({ employerId: req.user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Job.countDocuments({ employerId: req.user._id });

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

// @desc    Get jobs with optional filters (companyId)
// @route   GET /api/jobs
// @access  Protected
const getJobs = async (req, res) => {
    try {
        const { companyId } = req.query;
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
            query.status = 'active';
        } else {
            query.isOpen = true;
            query.status = 'active';
            if (!crossBorderEnabled) {
                query.$or = [
                    { countryCode: countryFilter },
                    { country: countryFilter },
                    { remoteAllowed: true },
                ];
                if (regionCandidates.length) {
                    query.$and = [
                        { $or: [
                            { regionCode: { $in: regionCandidates } },
                            { region: { $in: regionCandidates } },
                            { remoteAllowed: true },
                        ] },
                    ];
                }
            } else if (regionCandidates.length) {
                query.$or = [
                    { regionCode: { $in: regionCandidates } },
                    { region: { $in: regionCandidates } },
                    { remoteAllowed: true },
                ];
            }
        }

        const cacheKey = buildCacheKey('jobs:list', {
            companyId: companyId || null,
            countryFilter: countryFilter || null,
            regionFilter: regionCandidates.length ? regionCandidates : null,
            crossBorderEnabled,
            page,
            limit,
            query,
        });
        const cached = await getJSON(cacheKey);
        if (cached) {
            return res.status(200).json(cached);
        }

        const [jobs, total] = await Promise.all([
            Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Job.countDocuments(query),
        ]);
        const responsePayload = {
            success: true,
            count: jobs.length,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit)),
            data: jobs,
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
    const { jobTitle } = req.body;

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

        await job.deleteOne();
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
            message: 'Job and all associated matches deleted successfully',
            cacheEntriesCleared: deletedCount
        });
    } catch (error) {
        console.warn('❌ [JOB DELETE ERROR]:', error.message);
        res.status(500).json({ success: false, message: error.message });
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

        const previousStatus = String(job.status || '').toLowerCase();

        // Allowed fields to update
        const {
            title,
            companyName,
            salaryRange,
            location,
            requirements,
            minSalary,
            maxSalary,
            remoteAllowed,
            status: requestedStatus,
            processingId,
        } = req.body;

        const parsedMinSalary = parseSalaryValue(minSalary);
        const parsedMaxSalary = parseSalaryValue(maxSalary);
        if (
            Number.isNaN(parsedMinSalary)
            || Number.isNaN(parsedMaxSalary)
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

        if (safeTitle !== null) job.title = safeTitle || job.title;
        if (safeCompanyName !== null) job.companyName = safeCompanyName || job.companyName;
        if (safeSalaryRange !== null) job.salaryRange = safeSalaryRange || job.salaryRange;
        if (safeLocation !== null) job.location = safeLocation || job.location;
        if (parsedMinSalary !== null) job.minSalary = parsedMinSalary;
        if (parsedMaxSalary !== null) job.maxSalary = parsedMaxSalary;
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
            const normalizedStatus = String(requestedStatus).toLowerCase();
            if (!['draft_from_ai', 'active', 'closed'].includes(normalizedStatus)) {
                return res.status(400).json({ success: false, message: 'Invalid job status value' });
            }

            // Guard draft activation from Smart Interview flow
            if (normalizedStatus === 'active' && processingId) {
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
            job.isOpen = normalizedStatus === 'active';
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
        const nextStatus = String(updatedJob.status || '').toLowerCase();
        if (previousStatus !== 'active' && nextStatus === 'active') {
            fireAndForget('markFirstJobActivatedOnce', () => markFirstJobActivatedOnce({
                employerId: req.user._id,
                jobId: updatedJob._id,
                city: updatedJob.location || null,
            }), { employerId: String(req.user._id), jobId: String(updatedJob._id) });
        }
        if (previousStatus === 'active' && nextStatus === 'closed') {
            fireAndForget('recordJobFillCompletedMetric', () => recordJobFillCompletedOnce({
                jobId: updatedJob._id,
                city: updatedJob.location || 'unknown',
                roleCluster: updatedJob.title || 'general',
                metadata: {
                    source: 'job_controller',
                    triggerStatus: 'closed',
                    employerId: String(req.user._id),
                },
            }), { employerId: String(req.user._id), jobId: String(updatedJob._id) });
        }

        let signalFinalized = false;
        if (processingId && String(updatedJob.status) === 'active') {
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

        res.status(200).json({ success: true, data: updatedJob, signalFinalized });
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
            status: 'active',
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

        if (cityFilter) {
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
            if (!cityFilter && maxCommuteDistanceKm > 0 && maxCommuteDistanceKm <= 15 && worker.city) {
                query.location = new RegExp(`^${String(worker.city).trim()}$`, 'i');
            }
        }

        let jobs = await Job.find(query)
            .sort({ createdAt: -1 })
            .limit(5000)
            .lean();

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
        jobs = intentFiltered.jobs;

        if (intentFiltered.blocked || jobs.length === 0) {
            return res.json({
                recommendedJobs: [],
                matchModelVersionUsed: null,
                appliedPreferences: includePreferences ? matchPreferences : null,
            });
        }

        const intelligence = await buildMatchIntelligenceContext({
            worker,
            jobs,
            cityHint: cityFilter || worker.city || null,
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
        const topRows = scored.filter((row) => (row.matchProbability ?? row.finalScore) >= minThreshold).slice(0, 20);
        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);

        const responseRows = topRows.map((row) => {
            const probability = Number(row.matchProbability ?? row.finalScore ?? 0);
            const resolvedTier = matchEngineV2.mapTier(probability, dynamicThresholds);
            return ({
            job: row.job,
            matchScore: row.matchScore,
            matchProbability: probability,
            tier: resolvedTier,
            tierLabel: matchEngineV2.toLegacyTierLabel(resolvedTier),
            matchModelVersionUsed: row.matchModelVersionUsed || matchModelVersionUsed,
            explainability: matchUiV1Enabled ? (row.explainability || {}) : {},
            });
        });

        setImmediate(() => {
            logRecommendedRun({
                userId: req.user._id,
                workerId: worker._id,
                stats: {
                    ...deterministic,
                    totalReturned: responseRows.length,
                    avgScore: responseRows.length
                        ? responseRows.reduce((sum, item) => sum + Number(item.matchProbability || 0), 0) / responseRows.length
                        : 0,
                },
                rows: responseRows,
                modelVersionUsed: matchModelVersionUsed,
                metadata: {
                    correlationId: `recommended-${req.user._id}-${worker._id}-${Date.now()}`,
                    cityFilter: cityFilter || null,
                    roleClusterFilter: roleClusterFilter || null,
                },
            });
            Promise.all(responseRows.map((row) => recordMatchPerformanceMetric({
                eventName: 'MATCH_RECOMMENDATION_VIEWED',
                jobId: row.job?._id,
                workerId: worker._id,
                city: row.job?.location || cityFilter || worker.city || 'unknown',
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
                totalReturned: responseRows.length,
                countryCode: countryFilter,
                regionCode: regionFilter || null,
            },
        }), { userId: String(workerOwnerId || req.user._id) });

        return res.json({
            recommendedJobs: responseRows,
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
    getEmployerJobs,
    getRecommendedJobs,
    suggestRequirements,
    deleteJob,
    updateJob,
    recordBoostUpsellExposure,
    clearJobMatches // Export for testing
};
