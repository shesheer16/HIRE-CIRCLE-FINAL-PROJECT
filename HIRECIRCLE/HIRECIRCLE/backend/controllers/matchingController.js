const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const MatchFeedback = require('../models/MatchFeedback');
const MatchRun = require('../models/MatchRun');
const MatchLog = require('../models/MatchLog');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');
const ReputationProfile = require('../models/ReputationProfile');
const mongoose = require('mongoose');

const { createNotification } = require('./notificationController');
const { explainMatch } = require('../services/geminiService');
const redisClient = require('../config/redis');
const { recordMatchPerformanceMetric } = require('../services/matchMetricsService');

const matchEngineV2 = require('../match/matchEngineV2');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
const { buildWorkDnaVersionId } = require('../match/phase3SemanticEngine');
const { isMatchUiV1Enabled, isVerifiedPriorityEnabled } = require('../config/featureFlags');
const { buildMatchIntelligenceContext } = require('../services/matchQualityIntelligenceService');
const { filterJobsByApplyIntent } = require('../services/matchIntentFilterService');
const { computeWorkerEngagementScore } = require('../services/workerEngagementService');
const { createAndSendBehaviorNotification } = require('../services/growthNotificationService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { toProfileStrengthLabel, toCommunicationLabel } = require('../utils/interviewLabels');
const { recordMatchOutcomeAndAdapt } = require('../services/adaptiveMatchWeightEngine');
const { buildBehaviorProfile, getBehaviorProfile, getBehaviorSignalsForMatch } = require('../services/behavioralScoringEngine');
const {
    predictHiringProbability,
    getSimilarJobOutcomeSignals,
} = require('../services/hiringProbabilityEngine');
const { explainMatchDecision, explainRankingDecision } = require('../services/decisionExplainabilityService');
const { isCrossBorderAllowed, filterJobsByGeo, filterWorkersByGeo } = require('../services/geoMatchService');
const { buildNearQuery } = require('../services/geoDiscoveryService');
const { compute_match } = require('../services/computeMatchService');
const {
    evaluateProfileCompletion,
    isUserProfileMarkedComplete,
} = require('../services/profileCompletionService');
const { enrichJobsWithEmployerBranding } = require('../services/employerBrandingService');

const matchCache = new Map();
const CACHE_TTL_SEC = 604800;
const MAX_JOB_SCORING_POOL = 100;
const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};
const clamp01 = (value) => clamp(value, 0, 1);
const normalizeObjectIdHex = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
    return normalized;
};

// Haversine formula for fast in-memory distance calculation (returns km)
const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    if (lat1 === 0 && lon1 === 0) return null;
    if (lat2 === 0 && lon2 === 0) return null;

    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
};

const getCacheKey = (jobId, workerId) => `match:${jobId}:${workerId}`;

const getFromCache = async (key) => {
    try {
        if (redisClient.isOpen) {
            const data = await redisClient.get(key);
            if (data) return JSON.parse(data);
        }
    } catch (error) {
        console.warn('❌ [REDIS GET ERROR]:', error.message);
    }

    const cached = matchCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_SEC * 1000)) {
        return cached.data;
    }
    return null;
};

const setToCache = async (key, value) => {
    try {
        if (redisClient.isOpen) {
            redisClient.setEx(key, CACHE_TTL_SEC, JSON.stringify(value)).catch((error) => {
                console.warn('❌ [REDIS SET ERROR]:', error.message);
            });
            return;
        }
    } catch (error) {
        console.warn('❌ [REDIS SET ERROR]:', error.message);
    }

    matchCache.set(key, { data: value, timestamp: Date.now() });
};

const toModelTierLabel = (tier = 'REJECT') => {
    if (tier === 'STRONG') return 'Strong Match';
    if (tier === 'GOOD') return 'Good Match';
    if (tier === 'POSSIBLE') return 'Possible Match';
    return 'Rejected';
};

const isWorkerVisibleToEmployer = (worker) => {
    const prefs = worker?.user?.privacyPreferences || {};
    return prefs.profileVisibleToEmployers !== false;
};

const computeTrustTieBreakScore = (metrics = {}) => {
    const trustScore = clamp(Number(metrics?.trustScore || 0), 0, 100) / 100;
    const hireSuccessScore = clamp(Number(metrics?.hireSuccessScore || 0), 0, 100) / 100;
    const responseScore = clamp(Number(metrics?.responseScore || 0), 0, 100) / 100;
    return Number(((trustScore * 0.45) + (hireSuccessScore * 0.35) + (responseScore * 0.2)).toFixed(6));
};

const resolveActiveRoleProfile = (worker = {}) => {
    const profiles = Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : [];
    if (!profiles.length) return null;
    return profiles.find((profile) => Boolean(profile?.activeProfile)) || profiles[0] || null;
};

const loadReputationMap = async (userIds = []) => {
    const safeIds = Array.from(new Set(
        (Array.isArray(userIds) ? userIds : [])
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    ));
    if (!safeIds.length) return new Map();

    const rows = await ReputationProfile.find({
        userId: { $in: safeIds },
    })
        .select('userId overallTrustScore hireSuccessScore responseScore visibilityMultiplier')
        .lean();

    return new Map(rows.map((row) => [
        String(row.userId),
        {
            trustScore: Number(row.overallTrustScore || 50),
            hireSuccessScore: Number(row.hireSuccessScore || 0),
            responseScore: Number(row.responseScore || 50),
            visibilityMultiplier: Number(row.visibilityMultiplier || 1),
        },
    ]));
};

const sanitizeWorkerForEmployer = (worker) => {
    if (!worker || typeof worker !== 'object') return worker;
    const prefs = worker?.user?.privacyPreferences || {};
    const sanitized = {
        ...worker,
        roleProfiles: Array.isArray(worker.roleProfiles)
            ? worker.roleProfiles.map((roleProfile) => ({
                ...roleProfile,
                ...(prefs.showSalaryExpectation === false ? { expectedSalary: null } : {}),
            }))
            : [],
    };

    if (prefs.showInterviewBadge === false) {
        sanitized.interviewVerified = false;
    }

    if (prefs.showLastActive === false) {
        sanitized.lastActiveAt = null;
    }

    if (prefs.allowLocationSharing === false) {
        sanitized.city = null;
    }

    return sanitized;
};

const prioritizeByWorkerEngagement = async (rows = []) => {
    const workerIds = Array.from(new Set(
        rows.map((row) => String(row?.worker?._id || '')).filter(Boolean)
    ));

    if (!workerIds.length) return rows;

    const engagementRows = await WorkerEngagementScore.find({
        workerId: { $in: workerIds },
    })
        .select('workerId score')
        .lean();

    const engagementMap = new Map(
        engagementRows.map((row) => [String(row.workerId), Number(row.score || 0)])
    );

    for (const workerId of workerIds) {
        if (!engagementMap.has(workerId)) {
            const computed = await computeWorkerEngagementScore({
                workerId,
                upsert: true,
                withNudge: false,
            });
            engagementMap.set(workerId, Number(computed?.score || 0));
        }
    }

    return [...rows].sort((left, right) => {
        const leftBase = Number(left.matchProbability ?? left.finalScore ?? 0);
        const rightBase = Number(right.matchProbability ?? right.finalScore ?? 0);
        const leftBoost = Math.min(Number(engagementMap.get(String(left?.worker?._id || '')) || 0) * 0.03, 0.03);
        const rightBoost = Math.min(Number(engagementMap.get(String(right?.worker?._id || '')) || 0) * 0.03, 0.03);
        const leftVisibility = clamp(Number(left?.trustMetrics?.visibilityMultiplier || 1), 0.4, 1);
        const rightVisibility = clamp(Number(right?.trustMetrics?.visibilityMultiplier || 1), 0.4, 1);
        return ((rightBase + rightBoost) * rightVisibility) - ((leftBase + leftBoost) * leftVisibility);
    });
};

const logMatchRun = async ({
    contextType,
    workerId = null,
    jobId = null,
    userId = null,
    modelVersionUsed = null,
    stats = {},
    rows = [],
    metadata = {},
}) => {
    try {
        const resolvedStatus = String(metadata?.status || 'COMPLETED').toUpperCase();
        const allowedStatus = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
        const status = allowedStatus.includes(resolvedStatus) ? resolvedStatus : 'COMPLETED';
        const run = await MatchRun.create({
            contextType,
            workerId,
            jobId,
            userId,
            modelVersionUsed,
            workDnaVersionId: metadata?.workDnaVersionId || null,
            status,
            triggeredBy: metadata?.triggeredBy || metadata?.source || 'match_request',
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
                workerId: row.workerId || null,
                jobId: row.jobId || null,
                finalScore: Number(row.finalScore || 0),
                tier: row.tier || 'REJECT',
                accepted: Boolean(row.accepted),
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
                matchModelVersionUsed: row.matchModelVersionUsed || null,
                metadata: row.metadata || {},
            })), { ordered: false });
        }
    } catch (error) {
        console.warn('Match run logging failed:', error.message);
    }
};

const runProbabilisticOverlay = async ({ matches = [], user = null }) => {
    const scored = [];
    let matchModelVersionUsed = null;

    for (const row of matches) {
        const overlaid = await applyOverlay({
            deterministicScore: row,
            worker: row.worker,
            job: row.job,
            model: {
                user,
                workerUser: row.workerUser,
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

    return {
        matches: scored,
        matchModelVersionUsed,
    };
};

const getMatchesForEmployer = async (req, res) => {
    try {
        const jobId = normalizeObjectIdHex(req.params.jobId);
        if (!jobId) {
            return res.status(400).json({ message: 'Invalid job id' });
        }
        const employerUserId = normalizeObjectIdHex(req.user?._id);
        if (!employerUserId) {
            return res.status(401).json({ message: 'Invalid employer session' });
        }

        const employer = await User.findById(employerUserId).select('hasCompletedProfile profileComplete').lean();
        if (!isUserProfileMarkedComplete(employer)) {
            return res.status(403).json({ message: 'Complete your Employer profile to continue hiring actions.' });
        }

        const job = await Job.findById(jobId).lean();
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }
        if (String(job.employerId || '') !== employerUserId) {
            return res.status(403).json({ message: 'Not authorized for this job' });
        }

        const applications = await Application.find({ job: jobId })
            .select('_id worker status updatedAt')
            .sort({ updatedAt: -1 })
            .lean();

        if (!applications.length) {
            return res.json({ matches: [], matchModelVersionUsed: null });
        }

        const workerIds = applications.map((application) => application.worker);
        const applicationByWorkerId = new Map(applications.map((application) => [String(application.worker), application]));

        const workers = await WorkerProfile.find({ _id: { $in: workerIds } })
            .populate('user', 'name hasCompletedProfile profileComplete isVerified privacyPreferences country globalPreferences avatar profilePicture profileImage')
            .lean();
        const workerById = new Map(
            workers.map((worker) => [String(worker?._id || ''), worker])
        );
        const workerReputationMap = await loadReputationMap(
            workers.map((worker) => worker?.user?._id || worker?.user)
        );

        const crossBorderEnabled = isCrossBorderAllowed({
            user: req.user,
            queryValue: req.query.crossBorder,
        });
        const geoWorkers = filterWorkersByGeo({
            workers,
            job,
            allowCrossBorder: crossBorderEnabled,
        }).workers;
        const allowedWorkerIds = new Set(
            geoWorkers.map((worker) => String(worker?._id || '')).filter(Boolean)
        );

        const scoredRows = [];
        for (const application of applications) {
            const worker = workerById.get(String(application.worker || ''));
            if (!worker || !allowedWorkerIds.has(String(worker?._id || '')) || !isWorkerVisibleToEmployer(worker)) continue;

            const trustMetrics = workerReputationMap.get(String(worker?.user?._id || worker?.user)) || null;
            const hasRoleProfiles = Array.isArray(worker.roleProfiles) && worker.roleProfiles.length > 0;
            const isWorkerProfileReady = Boolean(worker?.user)
                && isUserProfileMarkedComplete(worker?.user)
                && hasRoleProfiles;

            const matchResult = isWorkerProfileReady
                ? await compute_match({
                    profile: worker,
                    profileUser: worker.user || {},
                    job,
                })
                : {
                    accepted: false,
                    score: 0,
                    matchScore: 0,
                    matchPercentage: 0,
                    tier: 'REJECT',
                    explanation: {},
                    reason: 'WORKER_PROFILE_INCOMPLETE',
                };

            const matchProbability = clamp01(Number(matchResult?.score || 0));
            const matchScore = Number(matchResult?.matchScore || Math.round(matchProbability * 100));
            const matchPercentage = Number(matchResult?.matchPercentage || matchScore);
            const resolvedTier = String(matchResult?.tier || 'REJECT').toUpperCase();
            const applicationMeta = applicationByWorkerId.get(String(worker._id)) || null;

            scoredRows.push({
                worker,
                trustMetrics,
                applicationMeta,
                matchScore,
                matchPercentage,
                matchProbability,
                tier: resolvedTier,
                explainability: matchResult?.explanation || {},
                deterministic: matchResult?.deterministic || null,
                reason: matchResult?.reason || null,
            });
        }

        scoredRows.sort((left, right) => {
            const scoreDiff = Number(right.matchProbability || 0) - Number(left.matchProbability || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const trustDiff = computeTrustTieBreakScore(right?.trustMetrics) - computeTrustTieBreakScore(left?.trustMetrics);
            if (trustDiff !== 0) return trustDiff;
            const rightUpdated = new Date(right?.applicationMeta?.updatedAt || 0).getTime();
            const leftUpdated = new Date(left?.applicationMeta?.updatedAt || 0).getTime();
            if (rightUpdated !== leftUpdated) return rightUpdated - leftUpdated;
            return String(left?.worker?._id || '').localeCompare(String(right?.worker?._id || ''));
        });

        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);
        const responseRows = scoredRows.slice(0, 20).map((row) => ({
            worker: sanitizeWorkerForEmployer(row.worker),
            matchScore: Number(row.matchScore || 0),
            matchPercentage: Number(row.matchPercentage || 0),
            matchProbability: Number(row.matchProbability || 0),
            matchScoreSource: 'match_engine',
            matchModelVersionUsed: null,
            probabilisticFallbackUsed: false,
            tier: toModelTierLabel(row.tier),
            tierCode: row.tier,
            trustScore: Number(row?.trustMetrics?.trustScore || 0),
            hireSuccessScore: Number(row?.trustMetrics?.hireSuccessScore || 0),
            responseScore: Number(row?.trustMetrics?.responseScore || 0),
            trustBreakdown: {
                trustScore: Number(row?.trustMetrics?.trustScore || 0),
                hireSuccessScore: Number(row?.trustMetrics?.hireSuccessScore || 0),
                responseScore: Number(row?.trustMetrics?.responseScore || 0),
                visibilityMultiplier: Number(row?.trustMetrics?.visibilityMultiplier || 1),
            },
            explainability: matchUiV1Enabled ? (row.explainability || {}) : {},
            matchExplainabilityCard: matchUiV1Enabled
                ? {
                    topReasons: row.explainability?.topReasons || [],
                    confidenceScore: Number(row.explainability?.confidenceScore || 0),
                    finalScore: Number(row.matchProbability || 0),
                    tier: toModelTierLabel(row.tier),
                }
                : {},
            whyThisMatchesYou: row.explainability?.summary || null,
            timelineTransparency: {
                jobPostedAt: job.createdAt || null,
                lastApplicationUpdateAt: row.applicationMeta?.updatedAt || null,
                workerLastActiveAt: row.worker?.lastActiveAt || row.worker?.updatedAt || null,
                scoredAt: new Date().toISOString(),
            },
            applicationId: row.applicationMeta?._id || null,
            applicationStatus: row.applicationMeta?.status || 'pending',
            communicationClarityTag: row.explainability?.clarityImpact
                || toCommunicationLabel(row.explainability?.communicationClarityScore),
            profileStrengthLabel: toProfileStrengthLabel(row.explainability?.profileStrengthScore),
            salaryAlignmentStatus: row.explainability?.salaryAlignmentStatus || 'ALIGNED',
            verifiedPriorityActive: Boolean(
                row.explainability?.featureVerifiedPriorityEnabled
                && Number(row.explainability?.verifiedPriorityMultiplier || 1) > 1
            ),
            workDnaVersionId: buildWorkDnaVersionId({
                worker: row.worker,
                roleData: row?.deterministic?.roleData || resolveActiveRoleProfile(row.worker) || {},
                salt: String(job?._id || ''),
            }),
        }));

        setImmediate(() => {
            logMatchRun({
                contextType: 'EMPLOYER_MATCH',
                userId: req.user._id,
                jobId: job._id,
                modelVersionUsed: null,
                stats: {
                    totalConsidered: applications.length,
                    totalReturned: responseRows.length,
                    avgScore: responseRows.length
                        ? responseRows.reduce((sum, row) => sum + Number(row.matchProbability || 0), 0) / responseRows.length
                        : 0,
                    rejectReasonCounts: {},
                },
                rows: responseRows.map((row) => ({
                    workerId: row.worker?._id,
                    jobId: job._id,
                    finalScore: Number(row.matchProbability ?? 0),
                    tier: row.tier,
                    accepted: row.tier !== 'Rejected',
                    explainability: row.explainability,
                    matchModelVersionUsed: null,
                    metadata: {
                        workDnaVersionId: row.workDnaVersionId || null,
                    },
                })),
                metadata: {
                    correlationId: `emp-${req.user._id}-${job._id}-${Date.now()}`,
                    triggeredBy: 'employer_match_view',
                },
            });
        });

        return res.json({
            matches: responseRows,
            matchModelVersionUsed: null,
        });
    } catch (error) {
        console.warn('Employer match failed:', error);
        return res.status(500).json({ message: 'Matching failed' });
    }
};

const getMatchesForCandidate = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('hasCompletedProfile profileComplete pushTokens isVerified notificationPreferences country globalPreferences').lean();
        const worker = await WorkerProfile.findOne({ user: req.user._id }).lean();
        if (!worker || !worker.isAvailable || !Array.isArray(worker.roleProfiles) || !worker.roleProfiles.length) {
            return res.status(200).json([]);
        }

        if (!isUserProfileMarkedComplete(user)) {
            const completion = evaluateProfileCompletion({
                user,
                workerProfile: worker,
                roleOverride: 'worker',
            });
            if (completion?.meetsProfileCompleteThreshold) {
                await User.updateOne(
                    { _id: req.user._id },
                    { $set: { profileComplete: true, hasCompletedProfile: true } }
                ).catch(() => { });
                if (user) {
                    user.profileComplete = true;
                    user.hasCompletedProfile = true;
                }
            }
        }
        const baseQuery = {
            isOpen: true,
            status: 'OPEN',
            employerId: { $ne: req.user._id },
        };

        const radiusKm = parseInt(req.query.radiusKm, 10);
        if (radiusKm > 0 && Array.isArray(worker.geo?.coordinates) && worker.geo.coordinates.length === 2 && worker.geo.coordinates[1] !== 0) {
            Object.assign(baseQuery, buildNearQuery(worker.geo.coordinates[1], worker.geo.coordinates[0], radiusKm));
        }

        const fetchJobsForQuery = (jobQuery) => Job.find(jobQuery)
            .sort(radiusKm > 0 ? undefined : { createdAt: -1 }) // disable standard sort if geo sort ($near) is applied natively
            .limit(MAX_JOB_SCORING_POOL)
            .lean();
        let jobs = await fetchJobsForQuery(baseQuery);
        if (!jobs.length) {
            // Single-account role-switch flows should still surface posted jobs.
            const selfFallbackQuery = { ...baseQuery };
            delete selfFallbackQuery.employerId;
            jobs = await fetchJobsForQuery(selfFallbackQuery);
        }
        const employerReputationMap = await loadReputationMap(
            jobs.map((job) => job.employerId)
        );
        jobs = jobs.map((job) => ({
            ...job,
            trustMetrics: employerReputationMap.get(String(job.employerId)) || null,
        }));

        const crossBorderEnabled = isCrossBorderAllowed({
            user,
            queryValue: req.query.crossBorder,
        });
        jobs = filterJobsByGeo({
            jobs,
            user,
            allowCrossBorder: crossBorderEnabled,
        }).jobs;

        const intentFiltered = await filterJobsByApplyIntent({
            worker,
            jobs,
        });
        if (intentFiltered.blocked) {
            // Avoid empty candidate feed caused by intent-block streaks.
            jobs = Array.isArray(jobs) ? jobs : [];
        } else {
            jobs = intentFiltered.jobs;
        }
        if (!jobs.length) {
            return res.status(200).json([]);
        }
        jobs = jobs.slice(0, MAX_JOB_SCORING_POOL);

        const intelligence = await buildMatchIntelligenceContext({
            worker,
            jobs,
            cityHint: worker.city || null,
        });

        let workerLat = null;
        let workerLon = null;
        if (Array.isArray(worker.geo?.coordinates) && worker.geo.coordinates.length === 2 && worker.geo.coordinates[1] !== 0) {
            workerLat = worker.geo.coordinates[1];
            workerLon = worker.geo.coordinates[0];
        }

        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);
        const scoredRows = [];
        for (const job of jobs) {
            const scoringContext = typeof intelligence?.getScoringContextForJob === 'function'
                ? intelligence.getScoringContextForJob(job)
                : {};
            scoringContext.featureVerifiedPriorityEnabled = isVerifiedPriorityEnabled(req.user);

            const matchResult = await compute_match({
                profile: worker,
                profileUser: user || {},
                job,
                intelligenceContext: intelligence,
                scoringContext,
            });

            const probability = clamp01(Number(matchResult?.score || 0));
            const resolvedTier = String(matchResult?.tier || 'REJECT').toUpperCase();
            const matchScore = Number(matchResult?.matchScore || Math.round(probability * 100));
            const matchPercentage = Number(matchResult?.matchPercentage || matchScore);

            let distanceKm = null;
            if (
                workerLat
                && workerLon
                && Array.isArray(job?.geo?.coordinates)
                && job.geo.coordinates.length === 2
                && job.geo.coordinates[1] !== 0
            ) {
                distanceKm = calculateDistanceKm(workerLat, workerLon, job.geo.coordinates[1], job.geo.coordinates[0]);
            }

            scoredRows.push({
                job,
                matchScore,
                matchPercentage,
                matchProbability: probability,
                tier: resolvedTier,
                roleUsed: matchResult?.deterministic?.roleData?.roleName || null,
                distanceKm,
                trustScore: Number(job?.trustMetrics?.trustScore || 0),
                hireSuccessScore: Number(job?.trustMetrics?.hireSuccessScore || 0),
                responseScore: Number(job?.trustMetrics?.responseScore || 0),
                matchModelVersionUsed: null,
                whyYouFit: matchResult?.explanation?.summary || null,
                labels: matchUiV1Enabled
                    ? [
                        resolvedTier === 'STRONG' ? 'Top Pay' : '',
                        job?.shift ? `${job.shift} Shift` : '',
                        distanceKm ? `${distanceKm}km away` : '',
                    ].filter(Boolean)
                    : [],
                explainability: matchUiV1Enabled ? (matchResult?.explanation || {}) : {},
                deterministic: matchResult?.deterministic || null,
            });
        }

        scoredRows.sort((left, right) => {
            const scoreDiff = Number(right.matchProbability || 0) - Number(left.matchProbability || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const trustDiff = computeTrustTieBreakScore(right?.job?.trustMetrics || right)
                - computeTrustTieBreakScore(left?.job?.trustMetrics || left);
            if (trustDiff !== 0) return trustDiff;
            const rightCreated = new Date(right?.job?.createdAt || 0).getTime();
            const leftCreated = new Date(left?.job?.createdAt || 0).getTime();
            if (rightCreated !== leftCreated) return rightCreated - leftCreated;
            return String(left?.job?._id || '').localeCompare(String(right?.job?._id || ''));
        });

        const finalRows = scoredRows.slice(0, 20);
        const workDnaVersionId = buildWorkDnaVersionId({
            worker,
            roleData: resolveActiveRoleProfile(worker) || {},
        });
        const transparentRows = finalRows.map((row) => ({
            ...row,
            trustBreakdown: {
                trustScore: Number(row?.job?.trustMetrics?.trustScore || row?.trustScore || 0),
                hireSuccessScore: Number(row?.job?.trustMetrics?.hireSuccessScore || row?.hireSuccessScore || 0),
                responseScore: Number(row?.job?.trustMetrics?.responseScore || row?.responseScore || 0),
                visibilityMultiplier: Number(row?.job?.trustMetrics?.visibilityMultiplier || 1),
            },
            matchExplainabilityCard: matchUiV1Enabled
                ? {
                    topReasons: row?.explainability?.topReasons || [],
                    confidenceScore: Number(row?.explainability?.confidenceScore || 0),
                    finalScore: Number(row?.explainability?.finalScore || row?.matchProbability || 0),
                    tier: row?.tier || 'POSSIBLE',
                }
                : {},
            timelineTransparency: {
                jobPostedAt: row?.job?.createdAt || null,
                scoredAt: new Date().toISOString(),
                workerLastActiveAt: worker?.lastActiveAt || worker?.updatedAt || null,
            },
            rankingExplainability: row?.explainability?.rankingExplainability || null,
            whyThisMatchesYou: row.whyYouFit,
            workDnaVersionId,
        }));
        const brandedJobs = await enrichJobsWithEmployerBranding(transparentRows.map((row) => row.job));
        const brandedJobMap = new Map(
            brandedJobs.map((job) => [String(job?._id || ''), job])
        );
        const transparentRowsWithBranding = transparentRows.map((row) => ({
            ...row,
            job: brandedJobMap.get(String(row?.job?._id || '')) || row.job,
        }));

        setImmediate(() => {
            logMatchRun({
                contextType: 'CANDIDATE_MATCH',
                userId: req.user._id,
                workerId: worker._id,
                modelVersionUsed: null,
                stats: {
                    totalConsidered: jobs.length,
                    totalReturned: transparentRowsWithBranding.length,
                    avgScore: transparentRowsWithBranding.length
                        ? transparentRowsWithBranding.reduce((sum, row) => sum + Number(row.matchProbability || 0), 0) / transparentRowsWithBranding.length
                        : 0,
                    rejectReasonCounts: {},
                },
                rows: transparentRowsWithBranding.map((row) => ({
                    workerId: worker._id,
                    jobId: row.job?._id,
                    finalScore: Number(row.matchProbability || 0),
                    tier: row.tier,
                    accepted: true,
                    explainability: row.explainability,
                    matchModelVersionUsed: null,
                })),
                metadata: {
                    correlationId: `can-${req.user._id}-${Date.now()}`,
                    triggeredBy: 'candidate_feed_refresh',
                    workDnaVersionId,
                },
            });
        });

        try {
            if (transparentRowsWithBranding.length > 0) {
                const topJob = transparentRowsWithBranding[0]?.job;
                const matchMessage = topJob?.title ? `${topJob.title} could be a fit for you.` : 'A new role matches your profile.';
                await createAndSendBehaviorNotification({
                    userId: req.user._id,
                    title: 'New match',
                message: matchMessage,
                notificationType: 'match_found',
                pushEventType: 'new_job_recommendations',
                relatedData: {
                    jobId: topJob?._id ? String(topJob._id) : null,
                    },
                    dedupeKey: `new_match:${String(req.user._id)}:${String(topJob?._id || 'none')}`,
                    dedupeWindowHours: 4,
                });
            }
        } catch (pushError) {
            console.warn('Match push error:', pushError.message);
        }

        setImmediate(() => {
            recordFeatureUsage({
                userId: req.user._id,
                featureKey: 'match_feed_viewed',
                metadata: {
                    results: transparentRowsWithBranding.length,
                },
            }).catch(() => { });
        });

        return res.json(transparentRowsWithBranding);
    } catch (error) {
        console.warn('Candidate match failed:', error);
        return res.status(500).json({ message: 'Candidate match failed' });
    }
};

const getMatchProbability = async (req, res) => {
    try {
        const jobId = normalizeObjectIdHex(req.query.jobId);
        if (!jobId) {
            return res.status(400).json({ message: 'Invalid jobId' });
        }

        const workerId = String(req.query.workerId || '').trim();
        const resolvedWorkerId = workerId || String(req.user?._id || '').trim() || null;
        if (!resolvedWorkerId) {
            return res.status(400).json({ message: 'workerId is required' });
        }

        const workerProfileId = normalizeObjectIdHex(resolvedWorkerId);
        let worker = null;
        if (workerProfileId) {
            worker = await WorkerProfile.findById(workerProfileId)
                .populate('user', 'isVerified hasCompletedProfile profileComplete')
                .lean();
        }
        if (!worker) {
            // Accept worker userId as fallback so mobile callers do not fail when
            // worker profile id is not yet hydrated in local storage.
            const workerUserId = normalizeObjectIdHex(resolvedWorkerId);
            if (!workerUserId) {
                return res.status(400).json({ message: 'Invalid workerId' });
            }
            worker = await WorkerProfile.findOne({ user: workerUserId })
                .populate('user', 'isVerified hasCompletedProfile profileComplete')
                .lean();
        }
        const job = await Job.findById(jobId).lean();

        if (!worker || !job) {
            return res.status(404).json({ message: 'Worker or job not found' });
        }

        const isAdmin = Boolean(req.user?.isAdmin);
        const isWorkerOwner = String(worker.user?._id || worker.user) === String(req.user._id);
        const isEmployerOwner = String(job.employerId) === String(req.user._id);
        if (!isAdmin && !isWorkerOwner && !isEmployerOwner) {
            return res.status(403).json({ message: 'Not authorized for this match probability' });
        }

        const workerUserId = String(worker.user?._id || worker.user || '');
        if (isEmployerOwner && workerUserId && workerUserId !== String(req.user._id)) {
            setImmediate(() => {
                createAndSendBehaviorNotification({
                    userId: workerUserId,
                    title: 'Employer viewed your profile',
                    message: 'An employer reviewed your profile for a live job opportunity.',
                    notificationType: 'employer_viewed_profile',
                    pushEventType: 'new_job_recommendations',
                    relatedData: {
                        jobId: String(job._id),
                        employerId: String(req.user._id),
                    },
                    dedupeKey: `employer_viewed_profile:${workerUserId}:${String(job._id)}:${String(req.user._id)}`,
                    dedupeWindowHours: 12,
                }).catch(() => { });
            });
        }

        const workerUser = worker.user || {};
        const intelligence = await buildMatchIntelligenceContext({
            worker,
            jobs: [job],
            cityHint: job.location || worker.city || null,
        });
        const scoringContext = intelligence.getScoringContextForJob(job);
        scoringContext.featureVerifiedPriorityEnabled = isVerifiedPriorityEnabled(req.user);
        const matchResult = await compute_match({
            profile: worker,
            profileUser: workerUser,
            job,
            intelligenceContext: intelligence,
            scoringContext,
        });

        if (!matchResult.accepted) {
            return res.json({
                matchProbability: 0,
                matchScore: 0,
                matchPercentage: 0,
                tier: 'REJECT',
                matchModelVersionUsed: null,
                fallbackUsed: false,
                explainability: matchResult.explanation || {},
                aiInsight: matchResult.aiInsight || null,
                ai_insight: matchResult.aiInsight || null,
                reason: matchResult.reason,
            });
        }

        const matchProbability = Number(matchResult.score || 0);
        const matchModelVersionUsed = null;
        const fallbackUsed = false;
        const resolvedTier = matchResult.tier || matchEngineV2.mapTier(matchProbability, intelligence.dynamicThresholds);
        const resolvedExplainability = matchResult.explanation || {};
        const workDnaVersionId = buildWorkDnaVersionId({
            worker,
            roleData: matchResult?.deterministic?.roleData || resolveActiveRoleProfile(worker) || {},
            salt: String(job?._id || ''),
        });

        setImmediate(() => {
            logMatchRun({
                contextType: 'PROBABILITY_ENDPOINT',
                userId: req.user._id,
                workerId: worker._id,
                jobId: job._id,
                modelVersionUsed: matchModelVersionUsed,
                stats: {
                    totalConsidered: 1,
                    totalReturned: 1,
                    avgScore: matchProbability,
                    rejectReasonCounts: {},
                },
                rows: [{
                    workerId: worker._id,
                    jobId: job._id,
                    finalScore: matchProbability,
                    tier: resolvedTier,
                    accepted: true,
                    explainability: resolvedExplainability,
                    matchModelVersionUsed,
                }],
                metadata: {
                    correlationId: `prob-${req.user._id}-${job._id}-${worker._id}`,
                    fallbackUsed,
                    modelKeyUsed: null,
                    triggeredBy: 'probability_lookup',
                    workDnaVersionId,
                },
            });
            recordMatchPerformanceMetric({
                eventName: 'MATCH_DETAIL_VIEWED',
                jobId: job._id,
                workerId: worker._id,
                city: job.location || 'unknown',
                roleCluster: matchResult?.deterministic?.roleData?.roleName || job.title || 'general',
                matchProbability,
                matchTier: resolvedTier,
                modelVersionUsed: matchModelVersionUsed,
                timestamp: new Date(),
                metadata: {
                    source: 'match_probability_endpoint',
                    userId: String(req.user._id),
                    fallbackUsed,
                },
            }).catch((metricError) => {
                console.warn('Probability match metric collection failed:', metricError.message);
            });
        });

        return res.json({
            matchProbability,
            matchScore: Number(matchResult.matchScore || Math.round(matchProbability * 100)),
            matchPercentage: Number(matchResult.matchPercentage || Math.round(matchProbability * 100)),
            tier: resolvedTier,
            matchModelVersionUsed,
            fallbackUsed,
            probabilisticFallbackUsed: fallbackUsed,
            matchScoreSource: matchModelVersionUsed
                ? 'probabilistic_model'
                : (fallbackUsed ? 'deterministic_fallback' : 'match_engine'),
            timelineTransparency: {
                jobPostedAt: job.createdAt || null,
                jobUpdatedAt: job.updatedAt || null,
                workerLastActiveAt: worker?.lastActiveAt || worker?.updatedAt || null,
                scoredAt: new Date().toISOString(),
            },
            explainability: resolvedExplainability,
            aiInsight: matchResult.aiInsight || null,
            ai_insight: matchResult.aiInsight || null,
        });
    } catch (error) {
        console.warn('Probability endpoint failed:', error);
        return res.status(500).json({ message: 'Probability scoring failed' });
    }
};

const explainMatchController = async (req, res) => {
    try {
        const { matchScore } = req.body;
        const jobId = normalizeObjectIdHex(req.body?.jobId);
        const candidateId = normalizeObjectIdHex(req.body?.candidateId);
        if (!jobId || !candidateId) {
            return res.status(400).json({ message: 'Invalid jobId or candidateId' });
        }

        const job = await Job.findById(jobId);
        let worker = await WorkerProfile.findById(candidateId).populate('user', 'name');
        if (!worker) {
            worker = await WorkerProfile.findOne({ user: candidateId }).populate('user', 'name');
        }

        if (!job || !worker) {
            return res.status(404).json({ message: 'Job or Candidate not found' });
        }

        let bestRole = Array.isArray(worker.roleProfiles) && worker.roleProfiles.length > 0
            ? worker.roleProfiles[0]
            : null;

        if (Array.isArray(worker.roleProfiles)) {
            const jobTokens = String(job.title || '').toLowerCase().split(/\s+/).filter((token) => token.length > 2);
            for (const role of worker.roleProfiles) {
                const roleTokens = String(role.roleName || '').toLowerCase().split(/\s+/).filter((token) => token.length > 2);
                if (jobTokens.some((token) => roleTokens.includes(token))) {
                    bestRole = role;
                    break;
                }
            }
        }

        const explanationLines = await explainMatch(
            {
                title: job.title,
                requirements: job.requirements || [],
            },
            {
                skills: bestRole ? bestRole.skills : [],
                experience: bestRole ? bestRole.experienceInRole : 0,
                location: worker.city || 'Remote',
            },
            matchScore
        );

        return res.json({ explanation: explanationLines });
    } catch (error) {
        console.warn('Match explanation error:', error);
        return res.status(500).json({
            explanation: [
                'A strong overall candidate for this position.',
                'Relevant skillsets align with requirements.',
                'Solid experience profile.',
            ],
        });
    }
};

const submitMatchFeedback = async (req, res) => {
    try {
        const {
            jobId,
            candidateId,
            matchScoreAtTime,
            userAction,
            employerFeedbackScore = null,
            workerFeedbackScore = null,
        } = req.body;
        const employerId = req.user._id;

        if (!jobId || !candidateId || !userAction) {
            return res.status(400).json({ message: 'Missing required feedback fields' });
        }

        const feedback = await MatchFeedback.create({
            jobId,
            candidateId,
            employerId,
            matchScoreAtTime: matchScoreAtTime || 0,
            userAction,
        });

        setImmediate(async () => {
            try {
                const [application, workerProfile] = await Promise.all([
                    Application.findOne({
                        job: jobId,
                        worker: candidateId,
                    })
                        .select('createdAt updatedAt')
                        .lean(),
                    WorkerProfile.findById(candidateId)
                        .select('_id user')
                        .lean(),
                ]);

                const timeToResponseMinutes = application
                    ? Math.max(
                        0,
                        Math.round((new Date(application.updatedAt || 0).getTime() - new Date(application.createdAt || 0).getTime()) / (1000 * 60))
                    )
                    : null;

                await recordMatchOutcomeAndAdapt({
                    jobId,
                    applicantId: candidateId,
                    hired: userAction === 'hired',
                    rejected: userAction === 'rejected',
                    timeToResponse: timeToResponseMinutes,
                    employerFeedbackScore,
                    workerFeedbackScore,
                    metadata: {
                        source: 'match_feedback_controller',
                        employerId: String(employerId),
                        userAction,
                    },
                });

                if (workerProfile?.user) {
                    await buildBehaviorProfile({
                        userId: workerProfile.user,
                        upsert: true,
                    });
                }
            } catch (adaptationError) {
                console.warn('Adaptive match feedback loop failed:', adaptationError.message);
            }
        });

        if (userAction === 'shortlisted') {
            const [job, worker] = await Promise.all([
                Job.findById(jobId),
                WorkerProfile.findById(candidateId),
            ]);

            if (worker && job) {
                await createNotification({
                    user: worker.user,
                    type: 'status_update',
                    title: 'You were Shortlisted!',
                    message: `${job.companyName || 'An employer'} shortlisted you for: ${job.title}`,
                    relatedData: { jobId: job._id },
                });
            }
        }

        return res.status(201).json(feedback);
    } catch (error) {
        console.warn('Match feedback error:', error);
        return res.status(500).json({ message: 'Failed to record feedback' });
    }
};

module.exports = {
    getMatchesForEmployer,
    getMatchesForCandidate,
    getMatchProbability,
    explainMatchController,
    submitMatchFeedback,
    matchCache,
    getCacheKey,
    getFromCache,
    setToCache,
};
