'use strict';
/**
 * featureRoutes.js
 * Master router for BLOCK E feature add-ons:
 *  - Saved Job Collections (#7)
 *  - Saved Searches + Alerts (#17)
 *  - Follow Company (#37)
 *  - Match Explainability (#48/#100)
 *  - Employer Analytics Dashboard (#70)
 *  - Report Abuse / Block User (#95)
 *  - Rejection Transparency (#97)
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

// ── #7: Saved Job Collections ─────────────────────────────────────────────────
const {
    listCollections,
    createCollection,
    getOrCreateDefaultCollection,
    saveJobToCollection,
    removeJobFromCollection,
    deleteCollection,
} = require('../services/savedJobsService');

router.get('/saved-jobs/collections', protect, async (req, res) => {
    try {
        const collections = await listCollections(req.user._id);
        return res.json({ collections });
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.post('/saved-jobs/collections', protect, async (req, res) => {
    try {
        const collection = await createCollection(req.user._id, req.body);
        return res.status(201).json({ collection });
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.post('/saved-jobs/collections/:collectionId/jobs', protect, async (req, res) => {
    try {
        const result = await saveJobToCollection(
            req.user._id,
            req.params.collectionId,
            req.body?.jobId,
            req.body?.note
        );
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/saved-jobs/collections/:collectionId/jobs/:jobId', protect, async (req, res) => {
    try {
        const result = await removeJobFromCollection(req.user._id, req.params.collectionId, req.params.jobId);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/saved-jobs/collections/:collectionId', protect, async (req, res) => {
    try {
        const result = await deleteCollection(req.user._id, req.params.collectionId);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #17: Saved Searches + Alert Triggers ──────────────────────────────────────
const {
    listSavedSearches,
    createSavedSearch,
    updateSavedSearch,
    deleteSavedSearch,
} = require('../services/savedSearchService');

router.get('/saved-searches', protect, async (req, res) => {
    try { return res.json({ searches: await listSavedSearches(req.user._id) }); }
    catch (e) { return res.status(500).json({ message: e.message }); }
});

router.post('/saved-searches', protect, async (req, res) => {
    try {
        const search = await createSavedSearch(req.user._id, req.body);
        return res.status(201).json({ search });
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.patch('/saved-searches/:searchId', protect, async (req, res) => {
    try {
        const search = await updateSavedSearch(req.user._id, req.params.searchId, req.body);
        return res.json({ search });
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/saved-searches/:searchId', protect, async (req, res) => {
    try {
        const result = await deleteSavedSearch(req.user._id, req.params.searchId);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #37: Follow Company ───────────────────────────────────────────────────────
const {
    followCompany,
    unfollowCompany,
    getFollowStatus,
    getFollowerCount,
    getFollowedCompanies,
    toggleNotifications,
} = require('../services/companyFollowService');

router.get('/companies/following', protect, async (req, res) => {
    try { return res.json({ companies: await getFollowedCompanies(req.user._id) }); }
    catch (e) { return res.status(500).json({ message: e.message }); }
});

router.post('/companies/:employerUserId/follow', protect, async (req, res) => {
    try {
        const result = await followCompany(req.user._id, req.params.employerUserId, req.body?.companyName);
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/companies/:employerUserId/follow', protect, async (req, res) => {
    try {
        const result = await unfollowCompany(req.user._id, req.params.employerUserId);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.get('/companies/:employerUserId/follow-status', protect, async (req, res) => {
    try {
        const status = await getFollowStatus(req.user._id, req.params.employerUserId);
        const counts = await getFollowerCount(req.params.employerUserId);
        return res.json({ ...status, ...counts });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.patch('/companies/:employerUserId/follow/notifications', protect, async (req, res) => {
    try {
        const result = await toggleNotifications(req.user._id, req.params.employerUserId, !!req.body?.enabled);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #48/#100: Match Explainability ────────────────────────────────────────────
const { explainMatch } = require('../services/matchExplainabilityService');
const WorkerProfile = require('../models/WorkerProfile');
const Job = require('../models/Job');
const MatchModel = require('../models/MatchModel');

router.get('/match-explain/:applicationId', protect, async (req, res) => {
    try {
        const Application = require('../models/Application');
        const app = await Application.findById(req.params.applicationId)
            .select('worker job matchScore employer')
            .lean();
        if (!app) return res.status(404).json({ message: 'Application not found' });

        // Auth: only employer or worker participant
        const empId = String(app.employer || '');
        const uid = String(req.user._id);
        const worker = await WorkerProfile.findOne({ user: app.worker || app.userId })
            .select('skills experienceYears location availability badgeCount')
            .lean();
        const job = await Job.findById(app.job)
            .select('skills location minExperienceYears maxExperienceYears jobType')
            .lean();

        const explanation = explainMatch(worker, job, app.matchScore || 0);
        return res.json({ applicationId: req.params.applicationId, explanation });
    } catch (e) {
        return res.status(500).json({ message: e.message || 'Failed to generate explanation' });
    }
});

// ── #70: Employer Analytics Dashboard ────────────────────────────────────────
const AnalyticsEvent = require('../models/AnalyticsEvent');
const Application = require('../models/Application');

router.get('/employer/analytics', protect, async (req, res) => {
    try {
        if (!['employer', 'both'].includes(req.user?.activeRole || req.user?.role)) {
            return res.status(403).json({ message: 'Employer role required' });
        }
        const employerId = req.user._id;
        const since = new Date();
        since.setDate(since.getDate() - 30);

        const [
            totalJobs,
            totalApplications,
            hiredCount,
            interviewCount,
            profileViews,
        ] = await Promise.all([
            Job.countDocuments({ employer: employerId }),
            Application.countDocuments({ employer: employerId, createdAt: { $gte: since } }),
            Application.countDocuments({ employer: employerId, status: 'hired' }),
            Application.countDocuments({ employer: employerId, status: { $in: ['interview_requested', 'interview_completed'] } }),
            AnalyticsEvent.countDocuments({ targetId: String(employerId), eventType: 'profile_view', createdAt: { $gte: since } }),
        ]);

        const conversionRate = totalApplications > 0
            ? Math.round((hiredCount / totalApplications) * 100) : 0;

        return res.json({
            period: '30d',
            metrics: {
                totalActiveJobs: totalJobs,
                applicationsReceived: totalApplications,
                interviewsScheduled: interviewCount,
                hires: hiredCount,
                conversionRate: `${conversionRate}%`,
                profileViewsThisMonth: profileViews,
            },
        });
    } catch (e) {
        return res.status(500).json({ message: 'Failed to load analytics' });
    }
});

// ── #95: Report Abuse / Block User ───────────────────────────────────────────
const { reportAbuse, blockUser, unblockUser, getBlockList, isBlocked } = require('../services/abuseFlagService');

router.post('/abuse/report', protect, async (req, res) => {
    try {
        const result = await reportAbuse({ reporterId: req.user._id, ...req.body });
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.post('/abuse/block/:targetUserId', protect, async (req, res) => {
    try {
        const result = await blockUser(req.user._id, req.params.targetUserId);
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/abuse/block/:targetUserId', protect, async (req, res) => {
    try {
        const result = await unblockUser(req.user._id, req.params.targetUserId);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.get('/abuse/blocked', protect, async (req, res) => {
    try {
        const list = await getBlockList(req.user._id);
        return res.json({ blocked: list });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #97: Rejection Transparency ──────────────────────────────────────────────
router.get('/applications/:applicationId/rejection-reason', protect, async (req, res) => {
    try {
        const app = await Application.findById(req.params.applicationId)
            .select('status rejectionReason rejectionCategory worker employer')
            .lean();
        if (!app) return res.status(404).json({ message: 'Application not found' });

        // Worker can only see their own application
        const workerUserId = String(app.worker?.user || app.worker || '');
        const uid = String(req.user._id);
        if (uid !== workerUserId && uid !== String(app.employer || '')) {
            return res.status(403).json({ message: 'Access denied' });
        }
        if (!['rejected', 'withdrawn', 'expired'].includes(app.status)) {
            return res.status(400).json({ message: 'Application is not in a rejected state' });
        }

        return res.json({
            status: app.status,
            rejectionReason: app.rejectionReason || null,
            rejectionCategory: app.rejectionCategory || null,
            transparencyMessage: buildTransparencyMessage(app.rejectionCategory),
        });
    } catch (e) {
        return res.status(500).json({ message: 'Failed to load rejection details' });
    }
});

function buildTransparencyMessage(category) {
    const messages = {
        skills_mismatch: 'The employer felt your skills were not an exact match for this role at this time.',
        overqualified: 'The employer felt you may be overqualified for this position.',
        location: 'Location or commute constraints were a factor in this decision.',
        experience: 'The employer required a different level of experience.',
        competition: 'This role received many strong applications and was highly competitive.',
        timeline: 'The position was filled before your application could be reviewed.',
        other: 'The employer did not provide a specific reason for this decision.',
    };
    return messages[category] || messages['other'];
}

module.exports = router;


// ── #10: Dark Mode / Theme Preference ────────────────────────────────────────
const { setThemePreference, getThemePreference } = require('../services/darkModeService');

router.get('/theme', protect, async (req, res) => {
    try {
        const result = await getThemePreference(req.user._id);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.patch('/theme', protect, async (req, res) => {
    try {
        const result = await setThemePreference(req.user._id, req.body?.theme);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #6/#83: Job Recommendations ───────────────────────────────────────────────
const { getHistoryBasedRecommendations, getResumeBasedRecommendations } = require('../services/jobRecommendationService');

router.get('/recommendations/jobs', protect, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit || 10), 20);
        const jobs = await getHistoryBasedRecommendations(req.user._id, { limit });
        return res.json({ recommendations: jobs, source: 'history_profile' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.post('/recommendations/jobs/resume', protect, async (req, res) => {
    try {
        const resumeSkills = Array.isArray(req.body?.skills) ? req.body.skills : [];
        const limit = Math.min(Number(req.body?.limit || 10), 20);
        const jobs = await getResumeBasedRecommendations(req.user._id, resumeSkills, { limit });
        return res.json({ recommendations: jobs, source: 'resume_ai' });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #61: Boost Job Listing ────────────────────────────────────────────────────
const { boostJob, clearBoost, getBoostStatus } = require('../services/boostJobService');

router.post('/jobs/:jobId/boost', protect, async (req, res) => {
    try {
        const result = await boostJob(req.params.jobId, req.user._id, req.body?.tier || 'standard');
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

router.delete('/jobs/:jobId/boost', protect, async (req, res) => {
    try {
        const result = await clearBoost(req.params.jobId);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

router.get('/jobs/:jobId/boost', protect, async (req, res) => {
    try {
        const result = await getBoostStatus(req.params.jobId);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #54: Swipe Undo ───────────────────────────────────────────────────────────
const { pushUndoAction, peekLastAction, consumeUndoAction } = require('../services/undoActionService');

router.get('/undo/peek', protect, (req, res) => {
    const action = peekLastAction(req.user._id);
    return res.json({ action, canUndo: !!action });
});

router.post('/undo/push', protect, (req, res) => {
    const { actionType, payload } = req.body || {};
    if (!actionType) return res.status(400).json({ message: 'actionType required' });
    const result = pushUndoAction(req.user._id, { actionType, payload });
    return res.status(201).json(result);
});

router.post('/undo/execute/:actionId', protect, (req, res) => {
    const action = consumeUndoAction(req.user._id, req.params.actionId);
    if (!action) {
        return res.status(410).json({ message: 'Undo window expired or action not found' });
    }
    return res.json({ undone: true, action });
});

// ── #3: Travel Time Estimate ──────────────────────────────────────────────────
const { estimateTravelTime, estimateAllModes } = require('../services/travelTimeService');
router.get('/jobs/:jobId/travel-time', protect, async (req, res) => {
    try {
        const { fromLat, fromLng, mode } = req.query;
        const Job = require('../models/Job');
        const job = await Job.findById(req.params.jobId).select('geo location').lean();
        if (!job) return res.status(404).json({ message: 'Job not found' });
        const to = { lat: job.geo?.coordinates?.[1], lng: job.geo?.coordinates?.[0] };
        const from = { lat: Number(fromLat), lng: Number(fromLng) };
        const eta = mode ? estimateTravelTime(from, to, mode) : estimateAllModes(from, to);
        return res.json({ eta, jobLocation: job.location });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #4/#27/#55: Swipe Decisions ───────────────────────────────────────────────
const { recordSwipe, getSwipedJobIds, getNotInterestedJobIds } = require('../services/jobSwipeService');
router.post('/swipe', protect, async (req, res) => {
    try {
        const { jobId, action } = req.body || {};
        if (!jobId) return res.status(400).json({ message: 'jobId required' });
        const result = await recordSwipe(req.user._id, jobId, action);
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.get('/swipe/excluded', protect, async (req, res) => {
    try {
        const ids = await getSwipedJobIds(req.user._id);
        return res.json({ excludedJobIds: ids });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #5: Shake to Find Random Job ──────────────────────────────────────────────
const { getRandomJob } = require('../services/shakeJobService');
router.get('/jobs/shake', protect, async (req, res) => {
    try {
        const lat = req.query.lat ? Number(req.query.lat) : undefined;
        const lng = req.query.lng ? Number(req.query.lng) : undefined;
        const job = await getRandomJob({ lat, lng });
        return res.json(job);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #8/#68: Assessments + Certificates ───────────────────────────────────────
const { attachAssessmentLink, issueCertificate, getUserCertificates } = require('../services/assessmentLinkService');
router.post('/jobs/:jobId/assessment', protect, async (req, res) => {
    try {
        const result = await attachAssessmentLink(req.params.jobId, req.user._id, req.body);
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.post('/certificates/issue', protect, async (req, res) => {
    try {
        const result = await issueCertificate({ userId: req.user._id, ...req.body });
        return res.status(201).json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.get('/certificates', protect, async (req, res) => {
    try {
        const certs = await getUserCertificates(req.user._id);
        return res.json({ certificates: certs });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #14/#84: AI Skill Extractor / Suggestions ─────────────────────────────────
const { extractSkillsFromBio, suggestSkills } = require('../services/aiSkillExtractorService');
router.post('/skills/extract', protect, async (req, res) => {
    try {
        const skills = await extractSkillsFromBio(req.body?.bio || '');
        return res.json({ skills, count: skills.length });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.get('/skills/suggest', protect, (req, res) => {
    const suggestions = suggestSkills(req.query.q || '', (req.query.existing || '').split(',').filter(Boolean));
    return res.json({ suggestions });
});

// ── #20: Daily Job Digest ──────────────────────────────────────────────────────
const { getDailyDigest } = require('../services/jobDigestService');
router.get('/digest/jobs', protect, async (req, res) => {
    try {
        const user = await require('../models/userModel').findById(req.user._id).select('city skills').lean();
        const limit = Math.min(Number(req.query.limit || 10), 20);
        const result = await getDailyDigest(user || {}, { limit });
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #32/#29: Daily Streak ──────────────────────────────────────────────────────
const { recordDailyLogin, getStreakStatus } = require('../services/dailyStreakService');
router.post('/streak/login', protect, async (req, res) => {
    try {
        const result = await recordDailyLogin(req.user._id);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.get('/streak', protect, async (req, res) => {
    try {
        const result = await getStreakStatus(req.user._id);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #34/#39/#44: Job Expiry & Countdown ───────────────────────────────────────
const { getJobsExpiringWithin, getCountdownData } = require('../services/jobExpiryService');
router.get('/jobs/:jobId/countdown', protect, async (req, res) => {
    try {
        const Job = require('../models/Job');
        const job = await Job.findById(req.params.jobId).select('expiresAt').lean();
        if (!job) return res.status(404).json({ message: 'Job not found' });
        return res.json(getCountdownData(job.expiresAt));
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #45: Deep Links ───────────────────────────────────────────────────────────
const { generateJobDeepLink, generateProfileDeepLink } = require('../services/deepLinkService');
router.get('/jobs/:jobId/share', protect, async (req, res) => {
    try {
        const Job = require('../models/Job');
        const job = await Job.findById(req.params.jobId).select('title companyName').lean();
        const link = generateJobDeepLink(req.params.jobId, job || {});
        return res.json(link);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.get('/profile/share', protect, async (req, res) => {
    try {
        const link = generateProfileDeepLink(req.user._id, req.user.name || '');
        return res.json(link);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #59: Job Comparison ───────────────────────────────────────────────────────
const { compareJobs } = require('../services/jobComparisonService');
router.post('/jobs/compare', protect, async (req, res) => {
    try {
        const { jobIds, lat, lng } = req.body || {};
        const result = await compareJobs(jobIds, { lat, lng });
        return res.json({ comparison: result });
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #62/#65: Featured Jobs ─────────────────────────────────────────────────────
const { getFeaturedJobs, getPromotedJobs } = require('../services/featuredJobService');
router.get('/jobs/featured', protect, async (req, res) => {
    try {
        const jobs = await getFeaturedJobs({ lat: req.query.lat, lng: req.query.lng, limit: req.query.limit });
        return res.json({ featured: jobs });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.get('/jobs/promoted', protect, async (req, res) => {
    try {
        const jobs = await getPromotedJobs(Number(req.query.limit || 5));
        return res.json({ promoted: jobs });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #72/#74: Credit Wallet ────────────────────────────────────────────────────
const { getBalance, addCredits, spendCredits } = require('../services/creditSystemService');
router.get('/credits', protect, async (req, res) => {
    try { return res.json(await getBalance(req.user._id)); }
    catch (e) { return res.status(500).json({ message: e.message }); }
});
router.post('/credits/add', protect, async (req, res) => {
    try {
        const result = await addCredits(req.user._id, Number(req.body?.amount), req.body?.reason);
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.post('/credits/spend', protect, async (req, res) => {
    try {
        const result = await spendCredits(req.user._id, req.body?.boostType);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #31/#75: Referral Tracker ──────────────────────────────────────────────────
const { getReferralDashboard } = require('../services/referralTrackerService');
router.get('/referrals/dashboard', protect, async (req, res) => {
    try { return res.json(await getReferralDashboard(req.user._id)); }
    catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

// ── #85/#86/#89/#90: AI Recruit Assistant ────────────────────────────────────
const {
    suggestInterviewQuestions,
    predictCandidateFit,
    suggestReplies,
    suggestWorkerProfile,
} = require('../services/aiRecruitAssistantService');
router.post('/ai/interview-questions', protect, async (req, res) => {
    try {
        const result = await suggestInterviewQuestions(req.body?.jobTitle, req.body?.skills);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.post('/ai/candidate-fit', protect, (req, res) => {
    try {
        const result = predictCandidateFit(req.body?.worker, req.body?.job);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.post('/ai/suggest-replies', protect, async (req, res) => {
    try {
        const result = await suggestReplies(req.body?.message, req.body?.context);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.post('/ai/profile-suggestions', protect, async (req, res) => {
    try {
        const result = await suggestWorkerProfile(
            req.body?.roleName,
            req.body?.roleCategory,
            req.body?.context
        );
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #81/#87: AI Voice Rating / Summarizer ────────────────────────────────────
const { rateInterviewTranscript, summarizeInterview } = require('../services/aiVoiceRatingService');
router.post('/ai/interview-rate', protect, async (req, res) => {
    try {
        const result = await rateInterviewTranscript(req.body?.transcript);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});
router.post('/ai/interview-summarize', protect, async (req, res) => {
    try {
        const result = await summarizeInterview(req.body?.transcript);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #88: Sentiment Analysis ────────────────────────────────────────────────────
const { analyzeSentiment } = require('../services/aiSentimentService');
router.post('/ai/sentiment', protect, async (req, res) => {
    try {
        const result = await analyzeSentiment(req.body?.text);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #94: Escrow Reminders ──────────────────────────────────────────────────────
const { buildEscrowNotification } = require('../services/escrowReminderService');
router.get('/escrow-reminder/:eventType', protect, (req, res) => {
    const payload = buildEscrowNotification(req.params.eventType, {
        userId: req.user._id,
        applicationId: req.query.applicationId,
        amount: req.query.amount,
    });
    if (!payload) return res.status(400).json({ message: 'Unknown event type' });
    return res.json(payload);
});

// ── #96: Review System ─────────────────────────────────────────────────────────
const { submitReview, getReviewStats, getReviewsForUser } = require('../services/reviewSystemService');
router.post('/reviews', protect, async (req, res) => {
    try {
        const result = await submitReview({ reviewerId: req.user._id, ...req.body });
        return res.status(201).json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.get('/reviews/user/:userId', protect, async (req, res) => {
    try {
        const [stats, reviews] = await Promise.all([
            getReviewStats(req.params.userId),
            getReviewsForUser(req.params.userId, { limit: req.query.limit }),
        ]);
        return res.json({ ...stats, reviews });
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #92/#93/#99: Compliance ────────────────────────────────────────────────────
const { getUserComplianceSummary, setTwoFactor } = require('../services/complianceService');
router.get('/compliance', protect, async (req, res) => {
    try { return res.json(await getUserComplianceSummary(req.user._id)); }
    catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});
router.patch('/compliance/2fa', protect, async (req, res) => {
    try {
        const result = await setTwoFactor(req.user._id, req.body?.enabled);
        return res.json(result);
    } catch (e) { return res.status(500).json({ message: e.message }); }
});

// ── #98: Location Privacy ─────────────────────────────────────────────────────
const { setLocationPrivacy, getLocationPrivacy } = require('../services/locationPrivacyService');
router.get('/location-privacy', protect, async (req, res) => {
    try { return res.json(await getLocationPrivacy(req.user._id)); }
    catch (e) { return res.status(500).json({ message: e.message }); }
});
router.patch('/location-privacy', protect, async (req, res) => {
    try {
        const result = await setLocationPrivacy(req.user._id, req.body?.mode);
        return res.json(result);
    } catch (e) { return res.status(Number(e.code || 500)).json({ message: e.message }); }
});

module.exports = router;
