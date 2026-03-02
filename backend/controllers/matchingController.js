const Job = require('../models/Job');
const Application = require('../models/Application');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const MatchFeedback = require('../models/MatchFeedback');
const MatchRun = require('../models/MatchRun');
const MatchLog = require('../models/MatchLog');
const WorkerEngagementScore = require('../models/WorkerEngagementScore');
const ReputationProfile = require('../models/ReputationProfile');

const { createNotification } = require('./notificationController');
const { explainMatch } = require('../services/geminiService');
const redisClient = require('../config/redis');
const { recordMatchPerformanceMetric } = require('../services/matchMetricsService');

const matchEngineV2 = require('../match/matchEngineV2');
const { applyOverlay } = require('../match/applyProbabilisticOverlay');
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

const matchCache = new Map();
const CACHE_TTL_SEC = 604800;
const clamp = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
};
const clamp01 = (value) => clamp(value, 0, 1);

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
        const run = await MatchRun.create({
            contextType,
            workerId,
            jobId,
            userId,
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
                workerId: row.workerId || null,
                jobId: row.jobId || null,
                finalScore: Number(row.finalScore || 0),
                tier: row.tier || 'REJECT',
                accepted: Boolean(row.accepted),
                rejectReason: row.rejectReason || null,
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
        const jobId = req.params.jobId;

        const employer = await User.findById(req.user._id).select('hasCompletedProfile');
        if (!employer?.hasCompletedProfile) {
            return res.status(403).json({ message: 'Please complete your profile first' });
        }

        const job = await Job.findById(jobId);
        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }
        if (String(job.employerId || '') !== String(req.user?._id || '')) {
            return res.status(403).json({ message: 'Not authorized for this job' });
        }

        const applications = await Application.find({ job: jobId })
            .select('_id worker status updatedAt')
            .sort({ updatedAt: -1 })
            .lean();

        if (!applications.length) {
            return res.json({ matches: [] });
        }

        const workerIds = applications.map((application) => application.worker);
        const applicationByWorkerId = new Map(applications.map((application) => [String(application.worker), application]));

        const workers = await WorkerProfile.find({ _id: { $in: workerIds } })
            .populate('user', 'name hasCompletedProfile isVerified privacyPreferences country globalPreferences')
            .lean();
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

        const candidates = geoWorkers
            .filter((worker) => (
                worker?.user
                && worker?.user?.hasCompletedProfile
                && Array.isArray(worker.roleProfiles)
                && worker.roleProfiles.length > 0
                && isWorkerVisibleToEmployer(worker)
            ))
            .map((worker) => ({
                worker,
                user: worker.user,
                applicationMeta: applicationByWorkerId.get(String(worker._id)) || null,
                trustMetrics: workerReputationMap.get(String(worker?.user?._id || worker?.user)) || null,
            }));

        const verifiedPriorityEnabled = isVerifiedPriorityEnabled(req.user);
        const deterministic = matchEngineV2.rankWorkersForJob({
            job,
            candidates,
            maxResults: 20,
            scoringContextResolver: () => ({
                featureVerifiedPriorityEnabled: verifiedPriorityEnabled,
            }),
        });

        const probabilistic = await runProbabilisticOverlay({
            matches: deterministic.matches.map((row) => ({ ...row, job })),
            user: req.user,
        });
        let ranked = probabilistic.matches;
        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);

        if (!ranked.length) {
            const fallbackWorkers = geoWorkers.filter((worker) => Boolean(worker?.user) && isWorkerVisibleToEmployer(worker));
            ranked = fallbackWorkers.map((worker) => {
                const applicationMeta = applicationByWorkerId.get(String(worker._id));
                return {
                    worker,
                    matchScore: 0,
                    finalScore: 0,
                    tier: 'APPLIED',
                    tierLabel: 'Applied',
                    matchProbability: 0,
                    explainability: {
                        jobId: String(job._id),
                        finalScore: 0,
                        tier: 'APPLIED',
                    },
                    applicationMeta,
                    trustMetrics: workerReputationMap.get(String(worker?.user?._id || worker?.user)) || null,
                };
            });
        }

        ranked = await prioritizeByWorkerEngagement(ranked);
        const similarOutcomeSignal = await getSimilarJobOutcomeSignals({
            jobId: job._id,
        });
        const enrichedRanked = await Promise.all(ranked.slice(0, 40).map(async (row) => {
            const workerUserId = row?.worker?.user?._id || row?.worker?.user || null;
            const behaviorProfile = workerUserId
                ? await getBehaviorProfile({ userId: workerUserId, computeIfMissing: false })
                : null;
            const behaviorSignals = getBehaviorSignalsForMatch({ profile: behaviorProfile });

            const employerBehaviorScore = clamp01(
                (Number(row.explainability?.employerQualityScore || row.deterministicScores?.employerQualityScore || 1) - 0.9) / 0.2
            );
            const workerReliabilityScore = clamp01(behaviorSignals.trustScore || 0.5);
            const matchProbability = clamp01(row.matchProbability ?? row.finalScore ?? 0);
            const hiringProbability = await predictHiringProbability({
                matchScore: matchProbability,
                employerBehaviorScore,
                workerReliabilityScore,
                jobUrgency: 'normal',
                pastSimilarJobOutcomes: similarOutcomeSignal,
            });
            const rankingScore = (matchProbability * 0.82) + (Number(hiringProbability.predictedHireProbability || 0) * 0.18);
            return {
                ...row,
                predictedHireProbability: hiringProbability.predictedHireProbability,
                hiringProbabilityExplainability: hiringProbability.explainability,
                rankingScore: Number(rankingScore.toFixed(6)),
                rankingWhy: explainRankingDecision({
                    explainability: row.explainability || row.deterministicScores || {},
                    context: 'employer_worker_ranking',
                }),
                matchWhy: explainMatchDecision({
                    explainability: row.explainability || row.deterministicScores || {},
                    roleUsed: row.roleUsed || null,
                }),
            };
        }));

        enrichedRanked.sort((left, right) => {
            const rankingDiff = Number(right.rankingScore || 0) - Number(left.rankingScore || 0);
            if (rankingDiff !== 0) return rankingDiff;
            const trustDiff = computeTrustTieBreakScore(right?.trustMetrics) - computeTrustTieBreakScore(left?.trustMetrics);
            if (trustDiff !== 0) return trustDiff;
            return matchEngineV2.sortScoredMatches(left, right);
        });

        const responseRows = enrichedRanked.slice(0, 20).map((row) => ({
            worker: sanitizeWorkerForEmployer(row.worker),
            matchScore: row.matchScore,
            tier: row.tierLabel || toModelTierLabel(row.tier),
            matchProbability: row.matchProbability,
            trustScore: Number(row?.trustMetrics?.trustScore || 0),
            hireSuccessScore: Number(row?.trustMetrics?.hireSuccessScore || 0),
            responseScore: Number(row?.trustMetrics?.responseScore || 0),
            trustBreakdown: {
                trustScore: Number(row?.trustMetrics?.trustScore || 0),
                hireSuccessScore: Number(row?.trustMetrics?.hireSuccessScore || 0),
                responseScore: Number(row?.trustMetrics?.responseScore || 0),
                visibilityMultiplier: Number(row?.trustMetrics?.visibilityMultiplier || 1),
            },
            predictedHireProbability: Number(row.predictedHireProbability || 0),
            matchModelVersionUsed: row.matchModelVersionUsed || probabilistic.matchModelVersionUsed,
            explainability: matchUiV1Enabled ? (row.explainability || {}) : {},
            matchExplainabilityCard: matchUiV1Enabled
                ? {
                    topReasons: row.explainability?.topReasons || [],
                    confidenceScore: Number(row.explainability?.confidenceScore || 0),
                    finalScore: Number(row.explainability?.finalScore || row.matchProbability || 0),
                    tier: row.tierLabel || toModelTierLabel(row.tier),
                }
                : {},
            rankingExplainability: row.rankingWhy,
            whyThisMatchesYou: row.matchWhy?.summary || null,
            timelineTransparency: {
                jobPostedAt: job.createdAt || null,
                lastApplicationUpdateAt: row.applicationMeta?.updatedAt || null,
                workerLastActiveAt: row.worker?.lastActiveAt || row.worker?.updatedAt || null,
                scoredAt: new Date().toISOString(),
            },
            labels: matchUiV1Enabled
                ? [
                    row.roleUsed,
                    `${Math.round((row.deterministicScores?.skillScore || 0) * 100)}% Skill Match`,
                    row.tier === 'STRONG' ? 'Highly Recommended' : '',
                ].filter(Boolean)
                : [],
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
        }));

        setImmediate(() => {
            logMatchRun({
                contextType: 'EMPLOYER_MATCH',
                userId: req.user._id,
                jobId: job._id,
                modelVersionUsed: probabilistic.matchModelVersionUsed,
                stats: deterministic,
                rows: responseRows.map((row) => ({
                    workerId: row.worker?._id,
                    jobId: job._id,
                    finalScore: (row.matchProbability ?? row.matchScore / 100),
                    tier: row.tier,
                    accepted: row.tier !== 'Rejected',
                    explainability: row.explainability,
                    matchModelVersionUsed: row.matchModelVersionUsed,
                })),
                metadata: {
                    correlationId: `emp-${req.user._id}-${job._id}-${Date.now()}`,
                },
            });
        });

        return res.json({
            matches: responseRows,
            matchModelVersionUsed: probabilistic.matchModelVersionUsed,
        });
    } catch (error) {
        console.warn('Employer match failed:', error);
        return res.status(500).json({ message: 'Matching failed' });
    }
};

const getMatchesForCandidate = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('hasCompletedProfile pushTokens isVerified notificationPreferences country globalPreferences');
        if (!user?.hasCompletedProfile) {
            return res.status(403).json({ message: 'Please complete your profile first' });
        }

        const worker = await WorkerProfile.findOne({ user: req.user._id }).lean();
        if (!worker || !worker.isAvailable || !Array.isArray(worker.roleProfiles) || !worker.roleProfiles.length) {
            return res.status(200).json([]);
        }

        const baseQuery = {
            isOpen: true,
            status: 'active',
            employerId: { $ne: req.user._id },
        };

        const radiusKm = parseInt(req.query.radiusKm, 10);
        if (radiusKm > 0 && Array.isArray(worker.geo?.coordinates) && worker.geo.coordinates.length === 2 && worker.geo.coordinates[1] !== 0) {
            Object.assign(baseQuery, buildNearQuery(worker.geo.coordinates[1], worker.geo.coordinates[0], radiusKm));
        }

        let jobs = await Job.find(baseQuery)
            .sort(radiusKm > 0 ? undefined : { createdAt: -1 }) // disable standard sort if geo sort ($near) is applied natively
            .limit(5000)
            .lean();
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
        jobs = intentFiltered.jobs;
        if (intentFiltered.blocked || !jobs.length) {
            return res.status(200).json([]);
        }

        const intelligence = await buildMatchIntelligenceContext({
            worker,
            jobs,
            cityHint: worker.city || null,
        });
        const dynamicThresholds = intelligence.dynamicThresholds;

        const deterministic = matchEngineV2.rankJobsForWorker({
            worker,
            workerUser: user,
            jobs,
            maxResults: 20,
            scoringContextResolver: (job) => ({
                ...intelligence.getScoringContextForJob(job),
                featureVerifiedPriorityEnabled: isVerifiedPriorityEnabled(req.user),
            }),
        });

        const probabilistic = await runProbabilisticOverlay({
            matches: deterministic.matches.map((row) => ({
                ...row,
                worker,
                workerUser: user,
            })),
            user: req.user,
        });
        const matchUiV1Enabled = isMatchUiV1Enabled(req.user);
        const behaviorProfile = await getBehaviorProfile({
            userId: req.user._id,
            computeIfMissing: true,
        });
        const behaviorSignals = getBehaviorSignalsForMatch({ profile: behaviorProfile });

        const minimumThreshold = Number(dynamicThresholds?.POSSIBLE || 0.62);

        let workerLat = null;
        let workerLon = null;
        if (Array.isArray(worker.geo?.coordinates) && worker.geo.coordinates.length === 2 && worker.geo.coordinates[1] !== 0) {
            workerLat = worker.geo.coordinates[1];
            workerLon = worker.geo.coordinates[0];
        }

        const candidateRows = probabilistic.matches
            .filter((row) => Number(row.matchProbability ?? row.finalScore ?? 0) >= minimumThreshold)
            .map((row) => {
                const probability = Number(row.matchProbability ?? row.finalScore ?? 0);
                const resolvedTier = matchEngineV2.mapTier(probability, dynamicThresholds);

                let distanceKm = null;
                if (workerLat && workerLon && Array.isArray(row.job?.geo?.coordinates) && row.job.geo.coordinates.length === 2 && row.job.geo.coordinates[1] !== 0) {
                    distanceKm = calculateDistanceKm(workerLat, workerLon, row.job.geo.coordinates[1], row.job.geo.coordinates[0]);
                }

                return ({
                    job: row.job,
                    matchScore: row.matchScore,
                    tier: resolvedTier,
                    roleUsed: row.roleUsed,
                    matchProbability: probability,
                    distanceKm,
                    trustScore: Number(row?.job?.trustMetrics?.trustScore || 0),
                    hireSuccessScore: Number(row?.job?.trustMetrics?.hireSuccessScore || 0),
                    responseScore: Number(row?.job?.trustMetrics?.responseScore || 0),
                    matchModelVersionUsed: row.matchModelVersionUsed || probabilistic.matchModelVersionUsed,
                    whyYouFit: `Matches your ${row.roleUsed} profile`,
                    labels: matchUiV1Enabled
                        ? [
                            resolvedTier === 'STRONG' ? 'Top Pay' : '',
                            row.job?.shift ? `${row.job.shift} Shift` : '',
                            distanceKm ? `${distanceKm}km away` : '',
                        ].filter(Boolean)
                        : [],
                    explainability: matchUiV1Enabled ? (row.explainability || {}) : {},
                });
            });
        const similarOutcomeSignalCache = new Map();

        const topRows = await Promise.all(candidateRows.slice(0, 40).map(async (row) => {
            const employerBehaviorScore = clamp01(
                (Number(row.explainability?.employerQualityScore || row.employerQualityScore || 1) - 0.9) / 0.2
            );
            const jobId = String(row.job?._id || '');
            let similarOutcomeSignal = similarOutcomeSignalCache.get(jobId);
            if (!similarOutcomeSignal) {
                similarOutcomeSignal = await getSimilarJobOutcomeSignals({
                    jobId: row.job?._id || null,
                });
                similarOutcomeSignalCache.set(jobId, similarOutcomeSignal);
            }
            const hiringProbability = await predictHiringProbability({
                matchScore: row.matchProbability,
                employerBehaviorScore,
                workerReliabilityScore: clamp01(behaviorSignals.trustScore || 0.5),
                jobUrgency: 'normal',
                pastSimilarJobOutcomes: similarOutcomeSignal,
            });
            const rankingScore = (Number(row.matchProbability || 0) * 0.82)
                + (Number(hiringProbability.predictedHireProbability || 0) * 0.18);
            const rankingWhy = explainRankingDecision({
                explainability: row.explainability || {},
                context: 'candidate_job_ranking',
            });
            const matchWhy = explainMatchDecision({
                explainability: row.explainability || {},
                roleUsed: row.roleUsed || null,
            });
            return {
                ...row,
                predictedHireProbability: hiringProbability.predictedHireProbability,
                hiringProbabilityExplainability: hiringProbability.explainability,
                rankingScore: Number(rankingScore.toFixed(6)),
                rankingExplainability: rankingWhy,
                whyThisMatchesYou: matchWhy.summary,
            };
        }));

        topRows.sort((left, right) => {
            const rankingDiff = Number(right.rankingScore || 0) - Number(left.rankingScore || 0);
            if (rankingDiff !== 0) return rankingDiff;
            const rightMetrics = right?.job?.trustMetrics || right;
            const leftMetrics = left?.job?.trustMetrics || left;
            const trustDiff = computeTrustTieBreakScore(rightMetrics) - computeTrustTieBreakScore(leftMetrics);
            if (trustDiff !== 0) return trustDiff;
            return matchEngineV2.sortScoredMatches(left, right);
        });
        const finalRows = topRows.slice(0, 20);
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
        }));

        setImmediate(() => {
            logMatchRun({
                contextType: 'CANDIDATE_MATCH',
                userId: req.user._id,
                workerId: worker._id,
                modelVersionUsed: probabilistic.matchModelVersionUsed,
                stats: deterministic,
                rows: transparentRows.map((row) => ({
                    workerId: worker._id,
                    jobId: row.job?._id,
                    finalScore: row.matchProbability,
                    tier: row.tier,
                    accepted: true,
                    explainability: row.explainability,
                    matchModelVersionUsed: row.matchModelVersionUsed,
                })),
                metadata: {
                    correlationId: `can-${req.user._id}-${Date.now()}`,
                },
            });
        });

        try {
            if (transparentRows.length > 0) {
                const topJob = transparentRows[0]?.job;
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
                    results: transparentRows.length,
                },
            }).catch(() => { });
        });

        return res.json(transparentRows);
    } catch (error) {
        console.warn('Candidate match failed:', error);
        return res.status(500).json({ message: 'Candidate match failed' });
    }
};

const getMatchProbability = async (req, res) => {
    try {
        const { workerId, jobId } = req.query;
        if (!jobId) {
            return res.status(400).json({ message: 'jobId is required' });
        }

        const resolvedWorkerId = workerId || null;
        if (!resolvedWorkerId) {
            return res.status(400).json({ message: 'workerId is required' });
        }

        const [worker, job] = await Promise.all([
            WorkerProfile.findById(resolvedWorkerId).populate('user', 'isVerified hasCompletedProfile').lean(),
            Job.findById(jobId).lean(),
        ]);

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
        const deterministic = matchEngineV2.evaluateBestRoleForJob({
            worker,
            workerUser,
            job,
            scoringContext,
        });

        if (!deterministic.accepted) {
            return res.json({
                matchProbability: 0,
                matchModelVersionUsed: null,
                fallbackUsed: true,
                explainability: {
                    skillImpact: 0,
                    experienceImpact: 0,
                    salaryImpact: 0,
                    distanceImpact: 0,
                    reliabilityImpact: 0,
                },
                reason: deterministic.rejectReason,
            });
        }

        const overlaid = await applyOverlay({
            deterministicScore: deterministic,
            worker,
            job,
            model: {
                user: req.user,
                workerUser,
                roleData: deterministic.roleData,
                deterministicScores: {
                    skillScore: deterministic.skillScore,
                    experienceScore: deterministic.experienceScore,
                    salaryFitScore: deterministic.salaryFitScore,
                    distanceScore: deterministic.distanceScore,
                    profileCompletenessMultiplier: deterministic.profileCompletenessMultiplier,
                },
                allowRejectOutput: true,
            },
        });

        const matchProbability = Number(overlaid?.matchProbability ?? deterministic.finalScore ?? 0);
        const matchModelVersionUsed = overlaid?.matchModelVersionUsed || null;
        const fallbackUsed = Boolean(overlaid?.probabilisticFallbackUsed);
        const resolvedTier = matchEngineV2.mapTier(matchProbability, intelligence.dynamicThresholds);
        const resolvedExplainability = fallbackUsed
            ? {
                skillImpact: deterministic.skillScore,
                experienceImpact: deterministic.experienceScore,
                salaryImpact: deterministic.salaryFitScore,
                distanceImpact: deterministic.distanceScore,
                reliabilityImpact: deterministic.reliabilityScore || 1,
            }
            : (overlaid?.explainability || deterministic.explainability);

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
                    modelKeyUsed: overlaid?.modelKeyUsed || null,
                },
            });
            recordMatchPerformanceMetric({
                eventName: 'MATCH_DETAIL_VIEWED',
                jobId: job._id,
                workerId: worker._id,
                city: job.location || 'unknown',
                roleCluster: deterministic.roleData?.roleName || job.title || 'general',
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
            matchModelVersionUsed,
            fallbackUsed,
            explainability: resolvedExplainability,
        });
    } catch (error) {
        console.warn('Probability endpoint failed:', error);
        return res.status(500).json({ message: 'Probability scoring failed' });
    }
};

const explainMatchController = async (req, res) => {
    try {
        const { jobId, candidateId, matchScore } = req.body;

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
