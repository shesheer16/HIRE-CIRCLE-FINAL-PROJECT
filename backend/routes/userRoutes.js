const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const { loginAttemptLimiter } = require('../middleware/rateLimiters');
const WorkerProfile = require('../models/WorkerProfile');
const User = require('../models/userModel');
const InterviewProcessingJob = require('../models/InterviewProcessingJob');
const {
    markProfileConfirmed,
    finalizeInterviewSignalIfEligible,
} = require('../services/interviewProcessingService');
const { publishMetric } = require('../services/metricsService');
const {
    fireAndForget,
    recordLifecycleEvent,
    normalizeSalaryBand,
} = require('../services/revenueInstrumentationService');
const { captureSmartInterviewDatasetSnapshot } = require('../services/smartInterviewDatasetService');
const { captureSmartInterviewAnalyticsSnapshot } = require('../services/smartInterviewAnalyticsSnapshotService');
const { evaluateReferralEligibility, getReferralDashboard } = require('../services/referralService');
const { trackFunnelStage } = require('../services/growthFunnelService');
const { recordFeatureUsage } = require('../services/monetizationIntelligenceService');
const { delByPattern } = require('../services/cacheService');
const { dispatchAsyncTask, TASK_TYPES } = require('../services/asyncTaskDispatcher');
const { getProfileAuthoritySnapshot, recalculateReputationProfile } = require('../services/reputationEngineService');
const { isRecruiter } = require('../utils/roleGuards');
const {
    evaluateProfileCompletion,
    syncUserProfileCompletionFlag,
} = require('../services/profileCompletionService');
const {
    toProfileStrengthLabel,
    toCommunicationLabel,
    toSalaryAlignmentStatus,
} = require('../utils/interviewLabels');
const { sanitizeText } = require('../utils/sanitizeText');
const logger = require('../utils/logger');

const clamp01 = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(1, Math.max(0, parsed));
};

const buildInterviewIntelligencePatch = (processingJob = {}) => {
    const rawMetrics = processingJob?.rawMetrics || {};
    const profileQualityScore = clamp01(rawMetrics.profileQualityScore);
    const communicationClarityScore = clamp01(rawMetrics.communicationClarityScore);
    const salaryOutlierFlag = Boolean(rawMetrics.salaryOutlierFlag);
    return {
        profileQualityScore,
        communicationClarityScore,
        confidenceLanguageScore: clamp01(rawMetrics.confidenceLanguageScore),
        ambiguityRate: clamp01(rawMetrics.ambiguityRate),
        slotCompletenessRatio: clamp01(rawMetrics.slotCompletenessRatio),
        salaryOutlierFlag,
        salaryMedianForRoleCity: Number.isFinite(Number(rawMetrics.salaryMedianForRoleCity))
            ? Number(rawMetrics.salaryMedianForRoleCity)
            : null,
        salaryRealismRatio: Number.isFinite(Number(rawMetrics.salaryRealismRatio))
            ? Number(rawMetrics.salaryRealismRatio)
            : null,
        salaryAlignmentStatus: toSalaryAlignmentStatus(salaryOutlierFlag),
        profileStrengthLabel: toProfileStrengthLabel(profileQualityScore),
        communicationLabel: toCommunicationLabel(communicationClarityScore),
        lastInterviewAt: new Date(),
    };
};

const PROTECTED_PROFILE_FIELDS = new Set([
    'user',
    'role',
    'roles',
    'activeRole',
    'primaryRole',
    'capabilities',
    'isAdmin',
    'isDeleted',
    'isBanned',
    'trustScore',
    'responseScore',
    'trustStatus',
    'isFlagged',
    'reliabilityScore',
    'interviewIntelligence',
    'settings',
    'createdAt',
    'updatedAt',
    '__v',
]);

const ALLOWED_WORKER_PROFILE_FIELDS = new Set([
    'firstName',
    'lastName',
    'avatar',
    'city',
    'country',
    'language',
    'totalExperience',
    'preferredShift',
    'availabilityWindowDays',
    'openToRelocation',
    'openToNightShift',
    'licenses',
    'roleProfiles',
    'isAvailable',
    'videoIntroduction',
    'processingId',
]);

const ALLOWED_EMPLOYER_PROFILE_FIELDS = new Set([
    'companyName',
    'industry',
    'description',
    'location',
    'contactPerson',
    'country',
    'website',
    'processingId',
]);

const normalizeTextField = (value, maxLength = 160) => {
    if (value === undefined || value === null) return undefined;
    const text = sanitizeText(value, { maxLength });
    return text || '';
};

const toSafeNumber = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    return Math.max(min, Math.min(max, numeric));
};

const sanitizeStringArray = (value, maxItems = 20, itemMaxLength = 120) => {
    if (!Array.isArray(value)) return undefined;
    return value
        .slice(0, maxItems)
        .map((item) => normalizeTextField(item, itemMaxLength))
        .filter(Boolean);
};

const sanitizeWorkerRoleProfiles = (value) => {
    if (!Array.isArray(value)) return undefined;
    return value
        .slice(0, 5)
        .map((item = {}) => {
            if (!item || typeof item !== 'object') return null;
            const roleName = normalizeTextField(item.roleName, 80);
            if (!roleName) return null;
            const experienceInRole = toSafeNumber(item.experienceInRole, { min: 0, max: 80 });
            const expectedSalary = toSafeNumber(item.expectedSalary, { min: 0, max: 1000000000 });
            const skills = sanitizeStringArray(item.skills, 25, 80) || [];
            return {
                roleName,
                ...(experienceInRole !== undefined ? { experienceInRole } : {}),
                ...(expectedSalary !== undefined ? { expectedSalary } : {}),
                skills,
                lastUpdated: new Date(),
            };
        })
        .filter(Boolean);
};

const hasProtectedField = (payload = {}) => Object.keys(payload || {}).some((key) => PROTECTED_PROFILE_FIELDS.has(key));

const hasDisallowedKeys = (payload = {}, allowList = new Set()) => Object.keys(payload || {}).some((key) => !allowList.has(key));

const resolveUserDocument = async (reqUser = {}, { lean = false } = {}) => {
    const userId = reqUser?._id;
    if (userId && typeof User.findById === 'function') {
        const query = User.findById(userId);
        if (query && typeof query.lean === 'function' && lean) {
            const row = await query.lean();
            return row || null;
        }
        if (query && typeof query.select === 'function') {
            const selected = query.select('-password');
            if (lean && selected && typeof selected.lean === 'function') {
                const row = await selected.lean();
                return row || null;
            }
            const row = await selected;
            return row || null;
        }
        if (query && typeof query.then === 'function') {
            const row = await query;
            return row || null;
        }
    }
    return reqUser || null;
};

const sanitizeWorkerPayload = (payload = {}) => {
    const sanitized = {};

    if (payload.firstName !== undefined) sanitized.firstName = normalizeTextField(payload.firstName, 80);
    if (payload.lastName !== undefined) sanitized.lastName = normalizeTextField(payload.lastName, 80);
    if (payload.avatar !== undefined) sanitized.avatar = normalizeTextField(payload.avatar, 500);
    if (payload.city !== undefined) sanitized.city = normalizeTextField(payload.city, 120);
    if (payload.country !== undefined) {
        const country = normalizeTextField(payload.country, 3);
        sanitized.country = country ? country.toUpperCase() : '';
    }
    if (payload.language !== undefined) sanitized.language = normalizeTextField(payload.language, 16);

    const totalExperience = toSafeNumber(payload.totalExperience, { min: 0, max: 80 });
    if (totalExperience !== undefined) sanitized.totalExperience = totalExperience;

    if (payload.preferredShift !== undefined) {
        const preferredShift = normalizeTextField(payload.preferredShift, 20);
        if (['Day', 'Night', 'Flexible'].includes(preferredShift)) {
            sanitized.preferredShift = preferredShift;
        }
    }

    if (payload.licenses !== undefined) {
        sanitized.licenses = sanitizeStringArray(payload.licenses, 20, 80) || [];
    }

    if (payload.roleProfiles !== undefined) {
        sanitized.roleProfiles = sanitizeWorkerRoleProfiles(payload.roleProfiles) || [];
    }

    if (payload.isAvailable !== undefined) {
        sanitized.isAvailable = Boolean(payload.isAvailable);
    }
    if (payload.availabilityWindowDays !== undefined) {
        const days = toSafeNumber(payload.availabilityWindowDays, { min: 0, max: 30 });
        if (days !== undefined && [0, 15, 30].includes(days)) {
            sanitized.availabilityWindowDays = days;
        }
    }
    if (payload.openToRelocation !== undefined) {
        sanitized.openToRelocation = Boolean(payload.openToRelocation);
    }
    if (payload.openToNightShift !== undefined) {
        sanitized.openToNightShift = Boolean(payload.openToNightShift);
    }

    if (payload.videoIntroduction && typeof payload.videoIntroduction === 'object') {
        const videoUrl = normalizeTextField(payload.videoIntroduction.videoUrl, 500);
        const transcript = normalizeTextField(payload.videoIntroduction.transcript, 5000);
        sanitized.videoIntroduction = {
            ...(videoUrl ? { videoUrl } : {}),
            ...(transcript ? { transcript } : {}),
        };
    }

    return sanitized;
};

const sanitizeEmployerPayload = (payload = {}) => {
    const sanitized = {};
    if (payload.companyName !== undefined) sanitized.companyName = normalizeTextField(payload.companyName, 120);
    if (payload.industry !== undefined) sanitized.industry = normalizeTextField(payload.industry, 120);
    if (payload.description !== undefined) sanitized.description = normalizeTextField(payload.description, 1000);
    if (payload.location !== undefined) sanitized.location = normalizeTextField(payload.location, 120);
    if (payload.contactPerson !== undefined) sanitized.contactPerson = normalizeTextField(payload.contactPerson, 120);
    if (payload.country !== undefined) {
        const country = normalizeTextField(payload.country, 3);
        sanitized.country = country ? country.toUpperCase() : '';
    }
    if (payload.website !== undefined) sanitized.website = normalizeTextField(payload.website, 240);
    return sanitized;
};
// Import all controllers properly
const {
    registerUser,
    authUser,
    refreshAuthToken,
    logoutUser,
    forgotPassword,
    resetPassword,
    verifyEmail,
    resendVerificationEmail,
    exportUserData,
    getWorkerLockInSummaryController,
} = require('../controllers/userController');
const { deleteAccount: secureDeleteAccount } = require('../controllers/settingsController');
const {
    signupSchema,
    loginSchema,
    refreshTokenSchema,
    logoutSchema,
} = require('../schemas/requestSchemas');

/**
 * @swagger
 * /api/users/login:
 *   post:
 *     summary: Authenticate user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: JWT token returned
 *       401:
 *         description: Invalid credentials
 */
router.post('/register', validate({ body: signupSchema }), registerUser);
router.post('/login', loginAttemptLimiter, validate({ body: loginSchema }), authUser);
router.post('/refresh-token', validate({ body: refreshTokenSchema }), refreshAuthToken);
router.post('/logout', protect, validate({ body: logoutSchema }), logoutUser);
router.post('/forgotpassword', forgotPassword);
router.put('/resetpassword/:resettoken', resetPassword);
router.put('/verifyemail/:verificationtoken', verifyEmail);
router.post('/resendverification', resendVerificationEmail);

router.get('/export', protect, exportUserData);
router.delete('/delete', protect, secureDeleteAccount);
router.get('/worker-lock-in-summary', protect, getWorkerLockInSummaryController);

// GET /api/users/profile - Fetch logged-in user's profile
router.get('/profile', protect, async (req, res) => {
    try {
        let profile;
        let referralDashboard = null;
        const userDoc = await resolveUserDocument(req.user, { lean: true });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }
        const isEmployer = isRecruiter(userDoc);
        if (isEmployer) {
            const EmployerProfile = require('../models/EmployerProfile');
            profile = await EmployerProfile.findOne({ user: req.user._id });
        } else {
            profile = await WorkerProfile.findOne({ user: req.user._id });
        }

        referralDashboard = await getReferralDashboard({ userId: req.user._id }).catch(() => null);
        const trustAuthority = await getProfileAuthoritySnapshot({
            userId: req.user._id,
            recompute: true,
        }).catch(() => null);

        if (!profile) {
            // Return empty structure to avoid frontend crashes
            const completion = evaluateProfileCompletion({
                user: userDoc,
                workerProfile: isEmployer ? null : {},
                employerProfile: isEmployer ? {} : null,
                roleOverride: isEmployer ? 'employer' : 'worker',
            });
            return res.status(200).json({
                profile: {
                    roleProfiles: [],
                    trustAuthority,
                },
                referralDashboard,
                profileCompletion: completion,
            });
        }
        const profilePayload = typeof profile.toObject === 'function' ? profile.toObject() : profile;
        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: isEmployer ? null : profilePayload,
            employerProfile: isEmployer ? profilePayload : null,
            roleOverride: isEmployer ? 'employer' : 'worker',
        });
        res.json({
            profile: {
                ...profilePayload,
                trustAuthority,
            },
            referralDashboard,
            profileCompletion: completion,
        });
    } catch (error) {
        logger.warn({ event: 'get_profile_error', message: error?.message || error });
        res.status(500).json({ message: "Server Error" });
    }
});

router.get('/profile-completion', protect, async (req, res) => {
    try {
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isEmployer = isRecruiter(userDoc);
        const profile = isEmployer
            ? await require('../models/EmployerProfile').findOne({ user: req.user._id }).lean()
            : await WorkerProfile.findOne({ user: req.user._id }).lean();

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: isEmployer ? null : profile,
            employerProfile: isEmployer ? profile : null,
            roleOverride: isEmployer ? 'employer' : 'worker',
        });

        return res.status(200).json({
            success: true,
            completion,
        });
    } catch (error) {
        logger.warn({ event: 'get_profile_completion_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to compute profile completion' });
    }
});

// PUT /api/users/profile - Update logged-in user's profile
router.put('/profile', protect, async (req, res) => {
    try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
            return res.status(400).json({ message: 'Invalid profile payload' });
        }

        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }
        const wasCompletedProfile = Boolean(userDoc.hasCompletedProfile);
        const isEmployer = isRecruiter(userDoc);
        const payload = req.body || {};
        const allowList = isEmployer ? ALLOWED_EMPLOYER_PROFILE_FIELDS : ALLOWED_WORKER_PROFILE_FIELDS;

        if (hasProtectedField(payload)) {
            return res.status(400).json({ message: 'Protected profile fields cannot be updated directly' });
        }
        if (hasDisallowedKeys(payload, allowList)) {
            return res.status(400).json({ message: 'Profile payload contains unsupported fields' });
        }

        const rawProcessingId = String(payload.processingId || '').trim();
        const processingId = rawProcessingId
            ? (mongoose.Types.ObjectId.isValid(rawProcessingId) ? rawProcessingId : null)
            : null;
        if (rawProcessingId && !processingId) {
            return res.status(400).json({ message: 'Invalid processingId' });
        }

        const profilePayload = isEmployer
            ? sanitizeEmployerPayload(payload)
            : sanitizeWorkerPayload(payload);

        if (!isEmployer) {
            if (payload.firstName !== undefined && !profilePayload.firstName) {
                return res.status(400).json({ message: 'firstName cannot be empty' });
            }
            if (payload.city !== undefined && !profilePayload.city) {
                return res.status(400).json({ message: 'city cannot be empty' });
            }
        } else {
            if (payload.companyName !== undefined && !profilePayload.companyName) {
                return res.status(400).json({ message: 'companyName cannot be empty' });
            }
            if (payload.location !== undefined && !profilePayload.location) {
                return res.status(400).json({ message: 'location cannot be empty' });
            }
        }

        let profile;
        const completedWorkerInterview = !isEmployer && processingId
            ? await InterviewProcessingJob.findOne({
                _id: processingId,
                userId: req.user._id,
                status: 'completed',
                role: 'worker',
            }).select('_id rawMetrics slotState slotConfidence')
            : null;

        if (isEmployer) {
            const EmployerProfile = require('../models/EmployerProfile');
            const existingEmployerProfile = await EmployerProfile.findOne({ user: req.user._id }).select('_id companyName location').lean();
            if (!existingEmployerProfile && (!profilePayload.companyName || !profilePayload.location)) {
                return res.status(400).json({ message: 'companyName and location are required for employer profile setup' });
            }
            profile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: profilePayload },
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
        } else {
            const existingWorkerProfile = await WorkerProfile.findOne({ user: req.user._id }).select('_id firstName city').lean();
            if (!existingWorkerProfile && (!profilePayload.firstName || !profilePayload.city)) {
                return res.status(400).json({ message: 'firstName and city are required for worker profile setup' });
            }
            const interviewIntelligencePatch = completedWorkerInterview
                ? buildInterviewIntelligencePatch(completedWorkerInterview)
                : null;
            const computedReliabilityScore = interviewIntelligencePatch
                ? clamp01(
                    (Number(interviewIntelligencePatch.profileQualityScore || 0) * 0.55)
                    + (Number(interviewIntelligencePatch.communicationClarityScore || 0) * 0.45)
                )
                : undefined;
            const workerUpdatePayload = {
                ...profilePayload,
                ...(completedWorkerInterview ? { interviewVerified: true } : {}),
                ...(interviewIntelligencePatch ? { interviewIntelligence: interviewIntelligencePatch } : {}),
                ...(Number.isFinite(computedReliabilityScore) ? { reliabilityScore: computedReliabilityScore } : {}),
            };
            profile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: workerUpdatePayload },
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
        }

        const profileObject = typeof profile?.toObject === 'function' ? profile.toObject() : profile;
        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: isEmployer ? null : profileObject,
            employerProfile: isEmployer ? profileObject : null,
            roleOverride: isEmployer ? 'employer' : 'worker',
        });
        const completionSync = await syncUserProfileCompletionFlag({
            userDoc,
            completion,
        });

        if (completionSync.hasCompletedProfile && !wasCompletedProfile) {
            fireAndForget('trackProfileCompleteFunnelStage', () => trackFunnelStage({
                userId: req.user._id,
                stage: 'profile_complete',
                source: 'profile_update',
                metadata: {
                    processingId: processingId ? String(processingId) : null,
                },
            }), { userId: String(req.user._id) });
        }

        if (processingId) {
            fireAndForget('trackInterviewFunnelStage', () => trackFunnelStage({
                userId: req.user._id,
                stage: 'interview',
                source: 'profile_update',
                metadata: {
                    processingId: processingId ? String(processingId) : null,
                },
            }), { userId: String(req.user._id) });
            fireAndForget('trackInterviewFeatureUsage', () => recordFeatureUsage({
                userId: req.user._id,
                featureKey: 'smart_interview_completed',
            }), { userId: String(req.user._id) });
            fireAndForget('evaluateReferralAfterInterview', () => evaluateReferralEligibility({
                referredUserId: req.user._id,
            }), { userId: String(req.user._id) });
        }

        fireAndForget('recomputeReputationProfileOnProfileUpdate', () => recalculateReputationProfile({
            userId: req.user._id,
            reason: 'profile_updated',
        }), { userId: String(req.user._id) });

        let signalFinalized = false;
        if (processingId) {
            await markProfileConfirmed({ processingId, userId: req.user._id });

            if (!isEmployer) {
                const primaryRole = Array.isArray(profile?.roleProfiles) && profile.roleProfiles.length > 0
                    ? profile.roleProfiles[0]
                    : null;
                fireAndForget('trackInterviewCompletedFunnelStage', () => trackFunnelStage({
                    userId: req.user._id,
                    stage: 'interview_completed',
                    source: 'interview_processing_confirm',
                    metadata: {
                        processingId: String(processingId),
                        role: primaryRole?.roleName || 'worker',
                    },
                }), { userId: String(req.user._id), processingId: String(processingId) });
                fireAndForget('captureSmartInterviewDatasetSnapshot', () => captureSmartInterviewDatasetSnapshot({
                    workerProfile: profile,
                    processingJob: completedWorkerInterview,
                    role: primaryRole?.roleName || 'worker',
                }), { userId: String(req.user._id), processingId: String(processingId) });
                fireAndForget('captureSmartInterviewAnalyticsSnapshot', () => captureSmartInterviewAnalyticsSnapshot({
                    workerProfile: profile,
                    processingJob: completedWorkerInterview,
                    role: primaryRole?.roleName || 'worker',
                }), { userId: String(req.user._id), processingId: String(processingId) });
                fireAndForget('recordInterviewConfirmedLifecycle', () => recordLifecycleEvent({
                    eventType: 'INTERVIEW_CONFIRMED',
                    userId: req.user._id,
                    workerId: profile?._id || null,
                    city: profile?.city || req.user?.acquisitionCity || 'Hyderabad',
                    roleCluster: primaryRole?.roleName || profilePayload?.roleTitle || 'general',
                    salaryBand: normalizeSalaryBand(primaryRole?.expectedSalary ? String(primaryRole.expectedSalary) : profilePayload?.expectedSalary || ''),
                    shift: primaryRole?.preferredShift || profilePayload?.preferredShift || 'unknown',
                    metadata: {
                        processingId: String(processingId),
                    },
                }), { userId: String(req.user._id), processingId: String(processingId) });
            }

            const finalizeResult = await finalizeInterviewSignalIfEligible({
                processingId,
                userId: req.user._id,
            });
            signalFinalized = Boolean(finalizeResult?.finalized);
            await publishMetric({
                metricName: 'ConfirmCompletionRate',
                value: signalFinalized ? 1 : 0,
                role: isEmployer ? 'employer' : 'worker',
                correlationId: String(processingId),
            });
        }

        await delByPattern('cache:profile:public:*');
        if (isEmployer) {
            await delByPattern('cache:analytics:employer-summary:*');
        } else if (profile?._id) {
            void dispatchAsyncTask({
                type: TASK_TYPES.TRUST_SCORE_RECALCULATION,
                payload: {
                    workerId: String(profile._id),
                    userId: String(req.user._id),
                    reason: 'profile_update',
                },
                label: 'profile_update_trust_recalc',
            });
        }

        res.json({
            profile,
            profileCompletion: completion,
            signalFinalized,
        });
    } catch (error) {
        if (error?.name === 'ValidationError' || error?.name === 'CastError') {
            return res.status(400).json({ message: error?.message || 'Invalid profile payload' });
        }
        logger.warn({ event: 'update_profile_error', message: error?.message || error });
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;
