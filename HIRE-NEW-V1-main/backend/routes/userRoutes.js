const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
    loginAttemptLimiter,
    passwordRecoveryLimiter,
    verificationResendLimiter,
} = require('../middleware/rateLimiters');
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
const { buildLocationLabel, resolveStructuredLocationFields } = require('../utils/locationFields');
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
    'panchayat',
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
    'matchPreferences',
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

const SHARED_PROFILE_FIELDS = new Set([
    'country',
    'processingId',
    'bio',
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

const normalizeProfileId = (value, fallbackSeed = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) {
        const seeded = String(fallbackSeed || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        if (seeded) return `legacy-${seeded}`.slice(0, 120);
        return new mongoose.Types.ObjectId().toString();
    }
    return normalized.slice(0, 120);
};

const normalizeDateValue = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
};

const ensureOneActiveRoleProfile = (profiles = []) => {
    const next = Array.isArray(profiles) ? profiles.map((profile) => ({ ...profile })) : [];
    if (!next.length) return next;

    let activeIndex = next.findIndex((profile) => Boolean(profile.activeProfile));
    if (activeIndex < 0) {
        activeIndex = 0;
    }

    return next.map((profile, index) => ({
        ...profile,
        activeProfile: index === activeIndex,
    }));
};

const sanitizeWorkerRoleProfiles = (value, { enforceActive = true } = {}) => {
    if (!Array.isArray(value)) return undefined;
    const sanitized = value
        .slice(0, 5)
        .map((item = {}, index) => {
            if (!item || typeof item !== 'object') return null;
            const roleName = normalizeTextField(item.roleName, 80);
            if (!roleName) return null;
            const experienceInRole = toSafeNumber(item.experienceInRole, { min: 0, max: 80 });
            const expectedSalary = toSafeNumber(item.expectedSalary, { min: 0, max: 1000000000 });
            const skills = sanitizeStringArray(item.skills, 25, 80) || [];
            return {
                profileId: normalizeProfileId(item.profileId, `${index}-${roleName}`),
                roleName,
                ...(experienceInRole !== undefined ? { experienceInRole } : {}),
                ...(expectedSalary !== undefined ? { expectedSalary } : {}),
                skills,
                activeProfile: Boolean(item.activeProfile),
                createdAt: normalizeDateValue(item.createdAt) || new Date(),
                lastUpdated: new Date(),
            };
        })
        .filter(Boolean);

    const orderedByRecency = sanitized.sort((left, right) => (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ));
    if (!enforceActive) {
        return orderedByRecency;
    }
    return ensureOneActiveRoleProfile(orderedByRecency);
};

const hasProtectedField = (payload = {}) => Object.keys(payload || {}).some((key) => PROTECTED_PROFILE_FIELDS.has(key));

const hasDisallowedKeys = (payload = {}, allowList = new Set()) => Object.keys(payload || {}).some((key) => !allowList.has(key));

const detectProfilePayloadTarget = (payload = {}, fallbackIsEmployer = false) => {
    const keys = Object.keys(payload || {});
    const workerSpecificKeys = keys.filter((key) => (
        ALLOWED_WORKER_PROFILE_FIELDS.has(key) && !SHARED_PROFILE_FIELDS.has(key)
    ));
    const employerSpecificKeys = keys.filter((key) => (
        ALLOWED_EMPLOYER_PROFILE_FIELDS.has(key) && !SHARED_PROFILE_FIELDS.has(key)
    ));

    if (workerSpecificKeys.length > 0 && employerSpecificKeys.length > 0) {
        return { ambiguous: true, isEmployer: fallbackIsEmployer };
    }
    if (workerSpecificKeys.length > 0) {
        return { ambiguous: false, isEmployer: false };
    }
    if (employerSpecificKeys.length > 0) {
        return { ambiguous: false, isEmployer: true };
    }

    return { ambiguous: false, isEmployer: fallbackIsEmployer };
};

const normalizeProfileRolePreference = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    if (['employer', 'recruiter', 'hirer', 'company'].includes(normalized)) return 'employer';
    if (['worker', 'candidate', 'employee', 'jobseeker', 'job_seeker'].includes(normalized)) return 'worker';
    return null;
};

const resolveProfileRolePreference = (req, userDoc = {}) => {
    const queryRole = normalizeProfileRolePreference(req?.query?.role);
    if (queryRole) return queryRole;

    const headerRole = normalizeProfileRolePreference(
        req?.headers?.['x-profile-role']
        || req?.headers?.['x-role-intent']
    );
    if (headerRole) return headerRole;

    return isRecruiter(userDoc) ? 'employer' : 'worker';
};

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

const sanitizeWorkerMatchPreferences = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return undefined;

    const sanitized = {};
    const maxCommuteDistanceKm = toSafeNumber(payload.maxCommuteDistanceKm, { min: 1, max: 300 });
    if (maxCommuteDistanceKm !== undefined) {
        sanitized.maxCommuteDistanceKm = maxCommuteDistanceKm;
    }

    const minimumMatchTier = String(payload.minimumMatchTier || '').trim().toUpperCase();
    if (['STRONG', 'GOOD', 'POSSIBLE'].includes(minimumMatchTier)) {
        sanitized.minimumMatchTier = minimumMatchTier;
    }

    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const sanitizeWorkerPayload = (payload = {}) => {
    const sanitized = {};

    if (payload.firstName !== undefined) sanitized.firstName = normalizeTextField(payload.firstName, 80);
    if (payload.lastName !== undefined) sanitized.lastName = normalizeTextField(payload.lastName, 80);
    if (payload.avatar !== undefined) sanitized.avatar = normalizeTextField(payload.avatar, 500);
    if (payload.city !== undefined) sanitized.city = normalizeTextField(payload.city, 120);
    if (payload.district !== undefined) sanitized.district = normalizeTextField(payload.district, 120);
    if (payload.mandal !== undefined) sanitized.mandal = normalizeTextField(payload.mandal, 120);
    if (payload.panchayat !== undefined) sanitized.panchayat = normalizeTextField(payload.panchayat, 120);
    if (payload.locationLabel !== undefined) sanitized.locationLabel = normalizeTextField(payload.locationLabel, 160);
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
    if (payload.matchPreferences !== undefined) {
        sanitized.matchPreferences = sanitizeWorkerMatchPreferences(payload.matchPreferences);
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
    if (payload.district !== undefined) sanitized.district = normalizeTextField(payload.district, 120);
    if (payload.mandal !== undefined) sanitized.mandal = normalizeTextField(payload.mandal, 120);
    if (payload.locationLabel !== undefined) sanitized.locationLabel = normalizeTextField(payload.locationLabel, 160);
    if (payload.contactPerson !== undefined) sanitized.contactPerson = normalizeTextField(payload.contactPerson, 120);
    if (payload.country !== undefined) {
        const country = normalizeTextField(payload.country, 3);
        sanitized.country = country ? country.toUpperCase() : '';
    }
    if (payload.website !== undefined) sanitized.website = normalizeTextField(payload.website, 240);
    return sanitized;
};

const hasMeaningfulValue = (value) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    const normalized = String(value).trim();
    if (!normalized) return false;
    return !['n/a', 'na', 'unknown', 'none', 'null', 'undefined'].includes(normalized.toLowerCase());
};

const toLooseNumber = (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
    const normalized = String(value).toLowerCase().replace(/,/g, '').trim();
    if (!normalized) return undefined;
    const token = normalized.match(/(-?\d+(?:\.\d+)?)\s*(k|thousand|lakh|lac|crore|cr)?/i);
    if (!token) return undefined;
    const base = Number.parseFloat(token[1]);
    if (!Number.isFinite(base)) return undefined;
    const multiplierBySuffix = {
        k: 1000,
        thousand: 1000,
        lakh: 100000,
        lac: 100000,
        crore: 10000000,
        cr: 10000000,
    };
    const suffix = String(token[2] || '').toLowerCase();
    const multiplier = multiplierBySuffix[suffix] || 1;
    return Math.max(0, base * multiplier);
};

const normalizeInterviewShift = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized.includes('day')) return 'Day';
    if (normalized.includes('night')) return 'Night';
    return 'Flexible';
};

const splitName = (value) => {
    const normalized = normalizeTextField(value, 120);
    if (!normalized) return { firstName: undefined, lastName: undefined };
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (!tokens.length) return { firstName: undefined, lastName: undefined };
    const [firstName, ...rest] = tokens;
    return {
        firstName: firstName || undefined,
        lastName: rest.join(' ') || undefined,
    };
};

const buildWorkerFallbackFromInterview = (processingJob = {}) => {
    const extracted = processingJob?.extractedData && typeof processingJob.extractedData === 'object'
        ? processingJob.extractedData
        : {};
    const slotState = processingJob?.slotState && typeof processingJob.slotState === 'object'
        ? processingJob.slotState
        : {};
    const roleName = normalizeTextField(
        extracted?.roleTitle
        || extracted?.roleName
        || extracted?.jobTitle
        || slotState?.primaryRole,
        80
    );
    const skills = sanitizeStringArray(
        Array.isArray(extracted?.skills) && extracted.skills.length
            ? extracted.skills
            : slotState?.primarySkills,
        25,
        80
    ) || [];
    const totalExperience = toLooseNumber(
        extracted?.experienceYears
        ?? extracted?.totalExperience
        ?? slotState?.totalExperienceYears
    );
    const expectedSalary = toLooseNumber(
        extracted?.expectedSalary
        ?? slotState?.expectedSalary
    );
    const parsedName = splitName(extracted?.name || slotState?.fullName || extracted?.firstName);
    const city = normalizeTextField(extracted?.location || extracted?.city || slotState?.city, 120);
    const preferredShift = normalizeInterviewShift(extracted?.preferredShift || slotState?.shiftPreference);

    return sanitizeWorkerPayload({
        firstName: parsedName.firstName,
        lastName: parsedName.lastName,
        city,
        totalExperience: Number.isFinite(totalExperience) ? totalExperience : undefined,
        preferredShift,
        roleProfiles: roleName
            ? [{
                roleName,
                experienceInRole: Number.isFinite(totalExperience) ? totalExperience : undefined,
                expectedSalary: Number.isFinite(expectedSalary) ? expectedSalary : undefined,
                skills,
            }]
            : undefined,
    });
};

const mergeWorkerPayloadWithInterviewFallback = (profilePayload = {}, fallbackPayload = {}) => {
    const merged = { ...profilePayload };

    if (!hasMeaningfulValue(merged.firstName) && hasMeaningfulValue(fallbackPayload.firstName)) {
        merged.firstName = fallbackPayload.firstName;
    }
    if (!hasMeaningfulValue(merged.lastName) && hasMeaningfulValue(fallbackPayload.lastName)) {
        merged.lastName = fallbackPayload.lastName;
    }
    if (!hasMeaningfulValue(merged.city) && hasMeaningfulValue(fallbackPayload.city)) {
        merged.city = fallbackPayload.city;
    }
    if ((merged.totalExperience === undefined || merged.totalExperience === null) && fallbackPayload.totalExperience !== undefined) {
        merged.totalExperience = fallbackPayload.totalExperience;
    }
    if (!hasMeaningfulValue(merged.preferredShift) && hasMeaningfulValue(fallbackPayload.preferredShift)) {
        merged.preferredShift = fallbackPayload.preferredShift;
    }

    const currentRoleProfiles = Array.isArray(merged.roleProfiles) ? merged.roleProfiles : [];
    const fallbackRoleProfiles = Array.isArray(fallbackPayload.roleProfiles) ? fallbackPayload.roleProfiles : [];
    if (!currentRoleProfiles.length && fallbackRoleProfiles.length) {
        merged.roleProfiles = fallbackRoleProfiles;
    } else if (currentRoleProfiles.length && fallbackRoleProfiles.length) {
        const currentPrimaryRole = currentRoleProfiles[0] || {};
        const fallbackPrimaryRole = fallbackRoleProfiles[0] || {};
        merged.roleProfiles = [{
            ...currentPrimaryRole,
            roleName: currentPrimaryRole.roleName || fallbackPrimaryRole.roleName,
            experienceInRole: currentPrimaryRole.experienceInRole ?? fallbackPrimaryRole.experienceInRole,
            expectedSalary: currentPrimaryRole.expectedSalary ?? fallbackPrimaryRole.expectedSalary,
            skills: Array.isArray(currentPrimaryRole.skills) && currentPrimaryRole.skills.length
                ? currentPrimaryRole.skills
                : (Array.isArray(fallbackPrimaryRole.skills) ? fallbackPrimaryRole.skills : []),
            lastUpdated: new Date(),
        }, ...currentRoleProfiles.slice(1)];
    }

    return merged;
};

const buildEmployerFallbackFromInterview = (processingJob = {}, userDoc = null) => {
    const extracted = processingJob?.extractedData && typeof processingJob.extractedData === 'object'
        ? processingJob.extractedData
        : {};
    const slotState = processingJob?.slotState && typeof processingJob.slotState === 'object'
        ? processingJob.slotState
        : {};
    return sanitizeEmployerPayload({
        companyName: extracted?.companyName || userDoc?.name,
        location: extracted?.location || slotState?.city,
        industry: extracted?.jobTitle || slotState?.primaryRole,
        description: extracted?.description,
    });
};

const mergeEmployerPayloadWithInterviewFallback = (profilePayload = {}, fallbackPayload = {}) => {
    const merged = { ...profilePayload };
    if (!hasMeaningfulValue(merged.companyName) && hasMeaningfulValue(fallbackPayload.companyName)) {
        merged.companyName = fallbackPayload.companyName;
    }
    if (!hasMeaningfulValue(merged.location) && hasMeaningfulValue(fallbackPayload.location)) {
        merged.location = fallbackPayload.location;
    }
    if (!hasMeaningfulValue(merged.industry) && hasMeaningfulValue(fallbackPayload.industry)) {
        merged.industry = fallbackPayload.industry;
    }
    if (!hasMeaningfulValue(merged.description) && hasMeaningfulValue(fallbackPayload.description)) {
        merged.description = fallbackPayload.description;
    }
    return merged;
};

const normalizeStoredRoleProfiles = (roleProfiles = []) => {
    const normalized = (Array.isArray(roleProfiles) ? roleProfiles : [])
        .map((profile = {}, index) => {
            if (!profile || typeof profile !== 'object') return null;
            const roleName = normalizeTextField(profile.roleName, 80);
            if (!roleName) return null;
            const skills = sanitizeStringArray(profile.skills, 25, 80) || [];
            const createdAt = normalizeDateValue(profile.createdAt) || new Date();
            const lastUpdated = normalizeDateValue(profile.lastUpdated) || createdAt;
            return {
                profileId: normalizeProfileId(profile.profileId, `${index}-${roleName}`),
                roleName,
                experienceInRole: toSafeNumber(profile.experienceInRole, { min: 0, max: 80 }) ?? 0,
                expectedSalary: toSafeNumber(profile.expectedSalary, { min: 0, max: 1000000000 }),
                skills,
                activeProfile: Boolean(profile.activeProfile),
                createdAt,
                lastUpdated,
            };
        })
        .filter(Boolean)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

    return ensureOneActiveRoleProfile(normalized);
};

const toRoleProfileResponse = (roleProfile = {}) => ({
    profileId: String(roleProfile.profileId || ''),
    roleName: String(roleProfile.roleName || ''),
    experienceInRole: Number(roleProfile.experienceInRole || 0),
    expectedSalary: Number(roleProfile.expectedSalary || 0),
    skills: Array.isArray(roleProfile.skills) ? roleProfile.skills : [],
    activeProfile: Boolean(roleProfile.activeProfile),
    createdAt: roleProfile.createdAt || null,
    lastUpdated: roleProfile.lastUpdated || null,
});

const buildWorkerProfileList = (workerProfile = null) => {
    if (!workerProfile) return [];
    const normalized = normalizeStoredRoleProfiles(workerProfile.roleProfiles || []);
    return normalized.map((roleProfile) => toRoleProfileResponse(roleProfile));
};

const deriveUserFirstName = (userDoc = {}) => {
    const name = String(userDoc?.name || '').trim();
    if (!name) return '';
    const [firstName] = name.split(/\s+/).filter(Boolean);
    return firstName || '';
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
    forgotPasswordSchema,
    resendVerificationSchema,
    resetPasswordSchema,
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
router.post('/forgotpassword', passwordRecoveryLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.put('/resetpassword/:resettoken', validate({ body: resetPasswordSchema }), resetPassword);
router.put('/verifyemail/:verificationtoken', verifyEmail);
router.post('/resendverification', verificationResendLimiter, validate({ body: resendVerificationSchema }), resendVerificationEmail);

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
        const rolePreference = resolveProfileRolePreference(req, userDoc);
        const isEmployer = rolePreference === 'employer';
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
        if (!isEmployer && Array.isArray(profilePayload?.roleProfiles)) {
            profilePayload.roleProfiles = normalizeStoredRoleProfiles(profilePayload.roleProfiles);
        }
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

router.get('/profiles', protect, async (req, res) => {
    try {
        const workerProfile = await WorkerProfile.findOne({ user: req.user._id }).lean();
        const profiles = buildWorkerProfileList(workerProfile);
        return res.status(200).json({
            success: true,
            profiles,
            activeProfileId: profiles.find((profile) => profile.activeProfile)?.profileId || null,
        });
    } catch (error) {
        logger.warn({ event: 'get_profiles_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to load profiles' });
    }
});

router.post('/profiles', protect, async (req, res) => {
    try {
        const payload = req.body || {};
        const roleProfile = sanitizeWorkerRoleProfiles([{
            ...payload,
            activeProfile: payload.activeProfile !== undefined ? payload.activeProfile : true,
        }], { enforceActive: false })?.[0];
        if (!roleProfile) {
            return res.status(400).json({ message: 'roleName is required' });
        }

        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const workerPayload = sanitizeWorkerPayload(payload) || {};
        const structuredLocation = resolveStructuredLocationFields({
            district: workerPayload.district,
            mandal: workerPayload.mandal,
            city: workerPayload.city,
            panchayat: workerPayload.panchayat,
            locationLabel: workerPayload.locationLabel,
        });
        const profileFields = {
            firstName: workerPayload.firstName || deriveUserFirstName(userDoc),
            lastName: workerPayload.lastName,
            city: structuredLocation.legacyCity || String(userDoc?.acquisitionCity || userDoc?.city || '').trim(),
            district: structuredLocation.district,
            mandal: structuredLocation.mandal,
            panchayat: structuredLocation.legacyPanchayat,
            locationLabel: structuredLocation.locationLabel,
            avatar: workerPayload.avatar,
            country: workerPayload.country || String(userDoc?.country || 'IN').toUpperCase(),
            language: workerPayload.language,
            totalExperience: workerPayload.totalExperience,
            preferredShift: workerPayload.preferredShift || 'Flexible',
            availabilityWindowDays: workerPayload.availabilityWindowDays ?? 0,
            openToRelocation: workerPayload.openToRelocation ?? false,
            openToNightShift: workerPayload.openToNightShift ?? false,
            licenses: workerPayload.licenses || [],
            isAvailable: workerPayload.isAvailable ?? true,
        };

        const existingWorkerProfile = await WorkerProfile.findOne({ user: req.user._id }).lean();
        const normalizedExisting = normalizeStoredRoleProfiles(existingWorkerProfile?.roleProfiles || []);
        const incomingWithActivation = {
            ...roleProfile,
            activeProfile: payload.activeProfile !== undefined
                ? Boolean(payload.activeProfile)
                : normalizedExisting.length === 0,
        };
        const nextProfiles = ensureOneActiveRoleProfile([
            incomingWithActivation,
            ...normalizedExisting,
        ]);

        if (!existingWorkerProfile && (!profileFields.firstName || !(profileFields.district || profileFields.city))) {
            return res.status(400).json({ message: 'firstName and district are required for the first profile.' });
        }

        const now = new Date();
        const updatePatch = {
            roleProfiles: nextProfiles,
            updated_at: now,
            updatedAt: now,
        };

        Object.entries(profileFields).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                updatePatch[key] = value;
            }
        });
        if (workerPayload.matchPreferences) {
            updatePatch['settings.matchPreferences'] = {
                ...(existingWorkerProfile?.settings?.matchPreferences || {}),
                ...workerPayload.matchPreferences,
            };
        }

        const workerProfile = await WorkerProfile.findOneAndUpdate(
            { user: req.user._id },
            {
                $set: updatePatch,
                $setOnInsert: {
                    user: req.user._id,
                    createdAt: now,
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true,
            }
        );

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: workerProfile.toObject(),
            employerProfile: null,
            roleOverride: 'worker',
        });
        await syncUserProfileCompletionFlag({ userDoc, completion });
        await delByPattern('cache:profile:public:*');

        return res.status(201).json({
            success: true,
            profile: toRoleProfileResponse(
                normalizeStoredRoleProfiles(workerProfile.roleProfiles || []).find((profile) => profile.profileId === roleProfile.profileId)
                || normalizeStoredRoleProfiles(workerProfile.roleProfiles || [])[0]
            ),
            profiles: buildWorkerProfileList(workerProfile),
            profileCompletion: completion,
        });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({ message: 'Profile already exists for this user' });
        }
        if (error?.name === 'ValidationError' || error?.name === 'CastError') {
            return res.status(400).json({ message: error?.message || 'Invalid profile payload' });
        }
        logger.warn({ event: 'create_profile_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to create profile' });
    }
});

router.put('/profiles/:profileId', protect, async (req, res) => {
    try {
        const profileId = normalizeProfileId(req.params.profileId);
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const workerProfile = await WorkerProfile.findOne({ user: req.user._id });
        if (!workerProfile) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        const currentProfiles = normalizeStoredRoleProfiles(workerProfile.roleProfiles || []);
        const currentIndex = currentProfiles.findIndex((profile) => profile.profileId === profileId);
        if (currentIndex < 0) {
            return res.status(404).json({ message: 'Role profile not found' });
        }

        const sanitizedPatch = sanitizeWorkerRoleProfiles([{
            ...currentProfiles[currentIndex],
            ...req.body,
            profileId,
            activeProfile: req.body?.activeProfile !== undefined
                ? Boolean(req.body.activeProfile)
                : currentProfiles[currentIndex].activeProfile,
        }], { enforceActive: false })?.[0];
        if (!sanitizedPatch) {
            return res.status(400).json({ message: 'Invalid role profile payload' });
        }

        const nextProfiles = currentProfiles.map((profile) => (
            profile.profileId === profileId
                ? sanitizedPatch
                : profile
        ));
        workerProfile.roleProfiles = ensureOneActiveRoleProfile(nextProfiles);

        const workerPayload = sanitizeWorkerPayload(req.body || {}) || {};
        const workerFields = [
            'firstName',
            'lastName',
            'avatar',
            'city',
            'district',
            'mandal',
            'panchayat',
            'locationLabel',
            'country',
            'language',
            'totalExperience',
            'preferredShift',
            'availabilityWindowDays',
            'openToRelocation',
            'openToNightShift',
            'licenses',
            'isAvailable',
        ];
        const structuredLocation = resolveStructuredLocationFields({
            district: workerPayload.district,
            mandal: workerPayload.mandal,
            city: workerPayload.city,
            panchayat: workerPayload.panchayat,
            locationLabel: workerPayload.locationLabel,
        });
        workerFields.forEach((field) => {
            if (workerPayload[field] !== undefined) {
                workerProfile[field] = workerPayload[field];
            }
        });
        if (
            workerPayload.city !== undefined
            || workerPayload.district !== undefined
            || workerPayload.mandal !== undefined
            || workerPayload.panchayat !== undefined
            || workerPayload.locationLabel !== undefined
        ) {
            workerProfile.city = structuredLocation.legacyCity || workerProfile.city;
            workerProfile.district = structuredLocation.district || workerProfile.district || workerProfile.city;
            workerProfile.mandal = structuredLocation.mandal || workerProfile.mandal || workerProfile.panchayat;
            workerProfile.panchayat = structuredLocation.legacyPanchayat || workerProfile.panchayat;
            workerProfile.locationLabel = structuredLocation.locationLabel || workerProfile.locationLabel
                || buildLocationLabel({
                    district: workerProfile.district || workerProfile.city,
                    mandal: workerProfile.mandal || workerProfile.panchayat,
                    fallback: workerProfile.city,
                });
        }
        if (workerPayload.matchPreferences) {
            workerProfile.settings = {
                ...(workerProfile.settings || {}),
                matchPreferences: {
                    ...((workerProfile.settings && workerProfile.settings.matchPreferences) || {}),
                    ...workerPayload.matchPreferences,
                },
            };
        }

        await workerProfile.save();

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: workerProfile.toObject(),
            employerProfile: null,
            roleOverride: 'worker',
        });
        await syncUserProfileCompletionFlag({ userDoc, completion });
        await delByPattern('cache:profile:public:*');

        return res.status(200).json({
            success: true,
            profile: toRoleProfileResponse(
                normalizeStoredRoleProfiles(workerProfile.roleProfiles || []).find((profile) => profile.profileId === profileId)
            ),
            profiles: buildWorkerProfileList(workerProfile),
            profileCompletion: completion,
        });
    } catch (error) {
        if (error?.name === 'ValidationError' || error?.name === 'CastError') {
            return res.status(400).json({ message: error?.message || 'Invalid profile payload' });
        }
        logger.warn({ event: 'update_profile_entry_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to update profile' });
    }
});

router.delete('/profiles/:profileId', protect, async (req, res) => {
    try {
        const profileId = normalizeProfileId(req.params.profileId);
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const workerProfile = await WorkerProfile.findOne({ user: req.user._id });
        if (!workerProfile) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        const currentProfiles = normalizeStoredRoleProfiles(workerProfile.roleProfiles || []);
        const nextProfiles = currentProfiles.filter((profile) => profile.profileId !== profileId);
        if (nextProfiles.length === currentProfiles.length) {
            return res.status(404).json({ message: 'Role profile not found' });
        }

        workerProfile.roleProfiles = ensureOneActiveRoleProfile(nextProfiles);
        await workerProfile.save();

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: workerProfile.toObject(),
            employerProfile: null,
            roleOverride: 'worker',
        });
        await syncUserProfileCompletionFlag({ userDoc, completion });
        await delByPattern('cache:profile:public:*');

        return res.status(200).json({
            success: true,
            profiles: buildWorkerProfileList(workerProfile),
            profileCompletion: completion,
        });
    } catch (error) {
        logger.warn({ event: 'delete_profile_entry_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to delete profile' });
    }
});

router.post('/profiles/:profileId/activate', protect, async (req, res) => {
    try {
        const profileId = normalizeProfileId(req.params.profileId);
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const workerProfile = await WorkerProfile.findOne({ user: req.user._id });
        if (!workerProfile) {
            return res.status(404).json({ message: 'Worker profile not found' });
        }

        const currentProfiles = normalizeStoredRoleProfiles(workerProfile.roleProfiles || []);
        if (!currentProfiles.some((profile) => profile.profileId === profileId)) {
            return res.status(404).json({ message: 'Role profile not found' });
        }

        workerProfile.roleProfiles = currentProfiles.map((profile) => ({
            ...profile,
            activeProfile: profile.profileId === profileId,
            lastUpdated: profile.profileId === profileId ? new Date() : profile.lastUpdated,
        }));
        await workerProfile.save();
        await delByPattern('cache:profile:public:*');
        void dispatchAsyncTask({
            type: TASK_TYPES.MATCH_RECALCULATION,
            payload: {
                scope: 'worker_profile_activated',
                workerId: String(workerProfile._id),
                userId: String(req.user._id),
                profileId,
            },
            label: 'worker_profile_activate_match_recalc',
        });

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: workerProfile.toObject(),
            employerProfile: null,
            roleOverride: 'worker',
        });
        await syncUserProfileCompletionFlag({ userDoc, completion });

        return res.status(200).json({
            success: true,
            activeProfileId: profileId,
            profiles: buildWorkerProfileList(workerProfile),
            profileCompletion: completion,
        });
    } catch (error) {
        logger.warn({ event: 'activate_profile_entry_error', message: error?.message || error });
        return res.status(500).json({ message: 'Failed to activate profile' });
    }
});

router.get('/profile-completion', protect, async (req, res) => {
    try {
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const rolePreference = resolveProfileRolePreference(req, userDoc);
        const isEmployer = rolePreference === 'employer';
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
        const activeRoleIsEmployer = isRecruiter(userDoc);
        const rawPayload = req.body || {};
        const targetProfile = detectProfilePayloadTarget(rawPayload, activeRoleIsEmployer);
        if (targetProfile.ambiguous) {
            return res.status(400).json({
                message: 'Profile payload mixes worker and employer fields. Submit one profile type at a time.',
            });
        }
        const isEmployer = Boolean(targetProfile.isEmployer);
        const allowList = isEmployer ? ALLOWED_EMPLOYER_PROFILE_FIELDS : ALLOWED_WORKER_PROFILE_FIELDS;

        if (hasProtectedField(rawPayload)) {
            logger.warn({
                event: 'profile_update_protected_fields_ignored',
                userId: String(req.user?._id || ''),
                keys: Object.keys(rawPayload || {}).filter((key) => PROTECTED_PROFILE_FIELDS.has(key)),
            });
        }

        const payload = Object.keys(rawPayload || {}).reduce((acc, key) => {
            if (!allowList.has(key)) return acc;
            acc[key] = rawPayload[key];
            return acc;
        }, {});

        if (hasDisallowedKeys(rawPayload, allowList)) {
            logger.warn({
                event: 'profile_update_disallowed_fields_ignored',
                userId: String(req.user?._id || ''),
                keys: Object.keys(rawPayload || {}).filter((key) => !allowList.has(key)),
                profileType: isEmployer ? 'employer' : 'worker',
            });
        }

        const rawProcessingId = String(payload.processingId || '').trim();
        const processingId = rawProcessingId
            ? (mongoose.Types.ObjectId.isValid(rawProcessingId) ? rawProcessingId : null)
            : null;
        if (rawProcessingId && !processingId) {
            return res.status(400).json({ message: 'Invalid processingId' });
        }

        const completedInterviewJob = processingId
            ? await InterviewProcessingJob.findOne({
                _id: processingId,
                userId: req.user._id,
                status: 'completed',
                role: isEmployer ? 'employer' : 'worker',
            }).select('_id rawMetrics slotState slotConfidence extractedData role')
            : null;

        let profilePayload = isEmployer
            ? sanitizeEmployerPayload(payload)
            : sanitizeWorkerPayload(payload);

        if (completedInterviewJob) {
            if (isEmployer) {
                const interviewFallback = buildEmployerFallbackFromInterview(completedInterviewJob, userDoc);
                profilePayload = mergeEmployerPayloadWithInterviewFallback(profilePayload, interviewFallback);
            } else {
                const interviewFallback = buildWorkerFallbackFromInterview(completedInterviewJob);
                profilePayload = mergeWorkerPayloadWithInterviewFallback(profilePayload, interviewFallback);
            }
        }

        if (!isEmployer) {
            if (payload.firstName !== undefined && !profilePayload.firstName) {
                return res.status(400).json({ message: 'firstName cannot be empty' });
            }
            if ((payload.city !== undefined || payload.district !== undefined) && !(profilePayload.city || profilePayload.district)) {
                return res.status(400).json({ message: 'district cannot be empty' });
            }
        } else {
            if (payload.companyName !== undefined && !profilePayload.companyName) {
                return res.status(400).json({ message: 'companyName cannot be empty' });
            }
            if ((payload.location !== undefined || payload.district !== undefined) && !(profilePayload.location || profilePayload.district)) {
                return res.status(400).json({ message: 'location cannot be empty' });
            }
        }

        let profile;
        const completedWorkerInterview = !isEmployer ? completedInterviewJob : null;

        if (isEmployer) {
            const EmployerProfile = require('../models/EmployerProfile');
            const existingEmployerProfile = await EmployerProfile.findOne({ user: req.user._id }).select('_id companyName location').lean();
            const structuredLocation = resolveStructuredLocationFields({
                district: profilePayload.district,
                mandal: profilePayload.mandal,
                location: profilePayload.location,
                locationLabel: profilePayload.locationLabel,
            });
            profilePayload.location = structuredLocation.legacyLocation || profilePayload.location;
            profilePayload.district = structuredLocation.district || profilePayload.district;
            profilePayload.mandal = structuredLocation.mandal || profilePayload.mandal;
            profilePayload.locationLabel = structuredLocation.locationLabel || profilePayload.locationLabel;
            if (!existingEmployerProfile && (!profilePayload.companyName || !profilePayload.location)) {
                return res.status(400).json({ message: 'companyName and district are required for employer profile setup' });
            }
            profile = await EmployerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: profilePayload },
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
        } else {
            const existingWorkerProfile = await WorkerProfile.findOne({ user: req.user._id }).select('_id firstName city settings').lean();
            const structuredLocation = resolveStructuredLocationFields({
                district: profilePayload.district,
                mandal: profilePayload.mandal,
                city: profilePayload.city,
                panchayat: profilePayload.panchayat,
                locationLabel: profilePayload.locationLabel,
            });
            profilePayload.city = structuredLocation.legacyCity || profilePayload.city;
            profilePayload.district = structuredLocation.district || profilePayload.district;
            profilePayload.mandal = structuredLocation.mandal || profilePayload.mandal;
            profilePayload.panchayat = structuredLocation.legacyPanchayat || profilePayload.panchayat;
            profilePayload.locationLabel = structuredLocation.locationLabel || profilePayload.locationLabel;
            if (!existingWorkerProfile && (!profilePayload.firstName || !profilePayload.city)) {
                return res.status(400).json({ message: 'firstName and district are required for worker profile setup' });
            }
            const nextMatchPreferences = profilePayload.matchPreferences;
            if (profilePayload.matchPreferences !== undefined) {
                delete profilePayload.matchPreferences;
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
                ...(nextMatchPreferences ? {
                    settings: {
                        matchPreferences: nextMatchPreferences,
                    },
                } : {}),
                ...(completedWorkerInterview ? { interviewVerified: true } : {}),
                ...(interviewIntelligencePatch ? { interviewIntelligence: interviewIntelligencePatch } : {}),
                ...(Number.isFinite(computedReliabilityScore) ? { reliabilityScore: computedReliabilityScore } : {}),
            };
            if (nextMatchPreferences) {
                workerUpdatePayload.settings = {
                    ...(existingWorkerProfile?.settings || {}),
                    matchPreferences: {
                        ...((existingWorkerProfile?.settings && existingWorkerProfile.settings.matchPreferences) || {}),
                        ...nextMatchPreferences,
                    },
                };
            }
            profile = await WorkerProfile.findOneAndUpdate(
                { user: req.user._id },
                { $set: workerUpdatePayload },
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );
        }

        if (payload.bio !== undefined) {
            userDoc.bio = normalizeTextField(payload.bio, 500);
            await userDoc.save();
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
            void dispatchAsyncTask({
                type: TASK_TYPES.MATCH_RECALCULATION,
                payload: {
                    scope: 'worker_profile_updated',
                    workerId: String(profile._id),
                    userId: String(req.user._id),
                    source: processingId ? 'smart_interview_confirm' : 'profile_update',
                },
                label: 'worker_profile_match_recalc',
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

// POST /api/users/profile/complete - Explicit explicit profile completion marker
router.post('/profile/complete', protect, async (req, res) => {
    try {
        const userDoc = await resolveUserDocument(req.user, { lean: false });
        if (!userDoc || userDoc.isDeleted) {
            return res.status(404).json({ message: 'User not found' });
        }

        const isEmployer = isRecruiter(userDoc);
        let workerProfileForCompletion = null;
        let employerProfileForCompletion = null;

        if (isEmployer) {
            const EmployerProfile = require('../models/EmployerProfile');
            const empProfile = await EmployerProfile.findOne({ user: userDoc._id }).lean();
            if (!empProfile || !empProfile.companyName || !empProfile.location) {
                return res.status(400).json({ message: 'Employer profile requires companyName and location before completion.' });
            }
            employerProfileForCompletion = empProfile;
        } else {
            const workerProfile = await WorkerProfile.findOne({ user: userDoc._id }).lean();
            if (!workerProfile || !workerProfile.firstName || !workerProfile.city) {
                return res.status(400).json({ message: 'Worker profile requires firstName and city before completion.' });
            }
            if (!Array.isArray(workerProfile.roleProfiles) || workerProfile.roleProfiles.length === 0) {
                return res.status(400).json({ message: 'Worker profile requires at least one role profile before completion.' });
            }
            workerProfileForCompletion = workerProfile;
        }

        userDoc.profileComplete = true;
        userDoc.hasCompletedProfile = true;
        // Assume they also resolved their role
        userDoc.hasSelectedRole = true;
        await userDoc.save();

        const completion = evaluateProfileCompletion({
            user: userDoc,
            workerProfile: workerProfileForCompletion,
            employerProfile: employerProfileForCompletion,
            roleOverride: isEmployer ? 'employer' : 'worker',
        });

        res.json({
            message: 'Profile marked complete',
            profileComplete: true,
            userRef: userDoc._id,
            profileCompletion: completion
        });

    } catch (error) {
        logger.warn({ event: 'profile_complete_error', message: error?.message || error });
        res.status(500).json({ message: "Server Error" });
    }
});

module.exports = router;
