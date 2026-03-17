const { hasEmployerPrimaryRole } = require('../utils/roleGuards');

const clampPercent = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
};

const normalizeText = (value) => String(value || '').trim();

const toSafeNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const resolveThreshold = (envKey, fallback) => {
    const parsed = Number.parseInt(process.env[envKey] || '', 10);
    if (!Number.isFinite(parsed)) return fallback;
    return clampPercent(parsed);
};

const resolveThresholds = () => ({
    appAccess: resolveThreshold('PROFILE_APP_ACCESS_THRESHOLD', 60),
    apply: resolveThreshold('PROFILE_APPLY_THRESHOLD', 60),
    postJob: resolveThreshold('PROFILE_POST_JOB_THRESHOLD', 70),
    profileComplete: resolveThreshold('PROFILE_COMPLETE_THRESHOLD', 80),
});

const buildStep = ({
    id,
    label,
    weight,
    complete,
    required = true,
    hint = '',
}) => ({
    id,
    label,
    weight: Number(weight) || 0,
    complete: Boolean(complete),
    required: Boolean(required),
    hint: String(hint || ''),
});

const summarizeCompletion = (steps = []) => {
    const totalWeight = steps.reduce((sum, step) => sum + Math.max(0, Number(step.weight) || 0), 0);
    const completedWeight = steps.reduce((sum, step) => (
        step.complete ? sum + Math.max(0, Number(step.weight) || 0) : sum
    ), 0);
    const percent = totalWeight > 0
        ? Math.round((completedWeight / totalWeight) * 100)
        : 0;

    const missingRequiredSteps = steps
        .filter((step) => step.required && !step.complete)
        .map((step) => ({
            id: step.id,
            label: step.label,
            hint: step.hint,
        }));

    return {
        steps,
        percent: clampPercent(percent),
        completedWeight: Number(completedWeight.toFixed(2)),
        totalWeight: Number(totalWeight.toFixed(2)),
        missingRequiredSteps,
        missingRequiredFields: missingRequiredSteps.map((step) => step.id),
        nextRequiredField: missingRequiredSteps[0]?.id || null,
    };
};

const resolvePrimaryWorkerRoleProfile = (workerProfile = {}) => {
    const roleProfiles = Array.isArray(workerProfile.roleProfiles) ? workerProfile.roleProfiles : [];
    return roleProfiles[0] || {};
};

const evaluateWorkerProfileCompletion = ({ user = {}, workerProfile = {} } = {}) => {
    const safeUser = user || {};
    const safeProfile = workerProfile || {};
    const roleProfile = resolvePrimaryWorkerRoleProfile(safeProfile);
    const skillCount = Array.isArray(roleProfile.skills) ? roleProfile.skills.filter(Boolean).length : 0;
    const expectedSalary = toSafeNumber(roleProfile.expectedSalary);
    const experienceInRole = toSafeNumber(roleProfile.experienceInRole);
    const hasExplicitRoleExperience = roleProfile && roleProfile.experienceInRole !== undefined && roleProfile.experienceInRole !== null;
    const availabilityWindowDays = toSafeNumber(safeProfile.availabilityWindowDays);
    const hasAvailabilitySignal = typeof safeProfile.isAvailable === 'boolean'
        || [0, 15, 30].includes(availabilityWindowDays);

    const steps = [
        buildStep({
            id: 'profile_picture',
            label: 'Profile picture',
            weight: 15,
            complete: Boolean(normalizeText(safeProfile.avatar)),
            required: false,
            hint: 'Add a profile image to improve trust and response rate.',
        }),
        buildStep({
            id: 'full_name',
            label: 'Full name',
            weight: 10,
            complete: Boolean(normalizeText(safeProfile.firstName || safeUser.name)),
            hint: 'Enter your name so employers can identify you.',
        }),
        buildStep({
            id: 'city',
            label: 'City',
            weight: 10,
            complete: Boolean(normalizeText(safeProfile.city || safeUser.city)),
            hint: 'Set your working city for nearby matching.',
        }),
        buildStep({
            id: 'skills',
            label: 'Skills',
            weight: 20,
            complete: skillCount > 0,
            hint: 'Add at least one relevant skill.',
        }),
        buildStep({
            id: 'experience_level',
            label: 'Experience level',
            weight: 10,
            complete: Boolean(hasExplicitRoleExperience) || Number(safeProfile.totalExperience || 0) > 0,
            hint: 'Select your experience so ranking is accurate.',
        }),
        buildStep({
            id: 'expected_salary',
            label: 'Expected salary',
            weight: 10,
            complete: Number(expectedSalary || 0) > 0,
            hint: 'Add salary expectation for better-fit jobs.',
        }),
        buildStep({
            id: 'availability',
            label: 'Availability',
            weight: 10,
            complete: hasAvailabilitySignal,
            hint: 'Select availability window and shift readiness.',
        }),
        buildStep({
            id: 'phone_verified',
            label: 'Phone or email verified',
            weight: 5,
            complete: Boolean(safeUser.isVerified),
            hint: 'Verify account contact to unlock trusted actions.',
        }),
        buildStep({
            id: 'smart_interview',
            label: 'Smart Interview',
            weight: 10,
            complete: Boolean(safeProfile.interviewVerified),
            required: false,
            hint: 'Complete Smart Interview for better matching quality.',
        }),
    ];

    const summary = summarizeCompletion(steps);
    const thresholds = resolveThresholds();
    const requiredForAccess = new Set(['full_name', 'city', 'skills', 'phone_verified']);
    const requiredForApply = new Set([
        'full_name',
        'city',
        'skills',
        'experience_level',
        'expected_salary',
        'availability',
        'phone_verified',
    ]);
    const missingForAccess = steps
        .filter((step) => requiredForAccess.has(step.id) && !step.complete)
        .map((step) => step.id);
    const missingForApply = steps
        .filter((step) => requiredForApply.has(step.id) && !step.complete)
        .map((step) => step.id);
    const actions = {
        canAccessApp: summary.percent >= thresholds.appAccess && missingForAccess.length === 0,
        canApply: summary.percent >= thresholds.apply && missingForApply.length === 0,
        canPostJob: false,
    };

    return {
        role: 'worker',
        ...summary,
        thresholds,
        actions,
        missingForAccess,
        missingForApply,
        meetsProfileCompleteThreshold: actions.canApply,
    };
};

const evaluateEmployerProfileCompletion = ({ user = {}, employerProfile = {} } = {}) => {
    const safeUser = user || {};
    const safeProfile = employerProfile || {};
    const steps = [
        buildStep({
            id: 'company_name',
            label: 'Company name',
            weight: 20,
            complete: Boolean(normalizeText(safeProfile.companyName)),
            hint: 'Company name is mandatory for employer trust.',
        }),
        buildStep({
            id: 'company_logo',
            label: 'Company logo',
            weight: 15,
            complete: Boolean(normalizeText(safeProfile.logoUrl)),
            required: false,
            hint: 'Upload company logo to improve application confidence.',
        }),
        buildStep({
            id: 'company_description',
            label: 'Company description',
            weight: 20,
            complete: Boolean(normalizeText(safeProfile.description)),
            hint: 'Add a short company overview.',
        }),
        buildStep({
            id: 'location',
            label: 'Location',
            weight: 10,
            complete: Boolean(normalizeText(safeProfile.location || safeUser.city)),
            hint: 'Add hiring location for accurate candidate targeting.',
        }),
        buildStep({
            id: 'industry',
            label: 'Industry',
            weight: 10,
            complete: Boolean(normalizeText(safeProfile.industry)),
            hint: 'Set your industry for candidate relevance.',
        }),
        buildStep({
            id: 'contact_person',
            label: 'Contact person',
            weight: 15,
            complete: Boolean(normalizeText(safeProfile.contactPerson || safeUser.name)),
            hint: 'Add a hiring contact person.',
        }),
        buildStep({
            id: 'verified_contact',
            label: 'Verified email/phone',
            weight: 10,
            complete: Boolean(safeUser.isVerified),
            hint: 'Verify contact to unlock posting actions.',
        }),
    ];

    const summary = summarizeCompletion(steps);
    const thresholds = resolveThresholds();
    const requiredForAccess = new Set([
        'company_name',
        'location',
        'contact_person',
        'verified_contact',
    ]);
    const requiredForPostJob = new Set([
        'company_name',
        'company_description',
        'location',
        'industry',
        'contact_person',
        'verified_contact',
    ]);
    const missingForAccess = steps
        .filter((step) => requiredForAccess.has(step.id) && !step.complete)
        .map((step) => step.id);
    const missingForPostJob = steps
        .filter((step) => requiredForPostJob.has(step.id) && !step.complete)
        .map((step) => step.id);
    const actions = {
        canAccessApp: summary.percent >= thresholds.appAccess && missingForAccess.length === 0,
        canApply: false,
        canPostJob: summary.percent >= thresholds.postJob && missingForPostJob.length === 0,
    };

    return {
        role: 'employer',
        ...summary,
        thresholds,
        actions,
        missingForAccess,
        missingForPostJob,
        meetsProfileCompleteThreshold: actions.canPostJob,
    };
};

const resolveProfileRole = ({ user = {}, roleOverride = '' } = {}) => {
    const explicit = normalizeText(roleOverride).toLowerCase();
    if (explicit === 'worker' || explicit === 'candidate') return 'worker';
    if (explicit === 'employer' || explicit === 'recruiter') return 'employer';
    return hasEmployerPrimaryRole(user) ? 'employer' : 'worker';
};

const isUserProfileMarkedComplete = (user = null) => Boolean(
    user && (user.profileComplete || user.hasCompletedProfile)
);

const evaluateProfileCompletion = ({
    user = {},
    workerProfile = null,
    employerProfile = null,
    roleOverride = '',
} = {}) => {
    const role = resolveProfileRole({ user, roleOverride });
    const completion = role === 'employer'
        ? evaluateEmployerProfileCompletion({ user, employerProfile: employerProfile || {} })
        : evaluateWorkerProfileCompletion({ user, workerProfile: workerProfile || {} });
    return completion;
};

const isActionAllowedByProfileCompletion = ({ action = '', completion = null } = {}) => {
    const normalizedAction = normalizeText(action).toLowerCase();
    const safeCompletion = completion || {};
    const thresholds = safeCompletion.thresholds || resolveThresholds();
    const percent = clampPercent(safeCompletion.percent || 0);

    if (normalizedAction === 'apply') {
        const missingRequiredFields = Array.isArray(safeCompletion.missingForApply)
            ? safeCompletion.missingForApply
            : (Array.isArray(safeCompletion.missingRequiredFields) ? safeCompletion.missingRequiredFields : []);
        return {
            allowed: percent >= thresholds.apply && missingRequiredFields.length === 0,
            threshold: thresholds.apply,
            percent,
            code: 'PROFILE_COMPLETION_REQUIRED',
            missingRequiredFields,
        };
    }
    if (normalizedAction === 'post_job') {
        const missingRequiredFields = Array.isArray(safeCompletion.missingForPostJob)
            ? safeCompletion.missingForPostJob
            : (Array.isArray(safeCompletion.missingRequiredFields) ? safeCompletion.missingRequiredFields : []);
        return {
            allowed: percent >= thresholds.postJob && missingRequiredFields.length === 0,
            threshold: thresholds.postJob,
            percent,
            code: 'PROFILE_COMPLETION_REQUIRED',
            missingRequiredFields,
        };
    }
    if (normalizedAction === 'app_access') {
        const missingRequiredFields = Array.isArray(safeCompletion.missingForAccess)
            ? safeCompletion.missingForAccess
            : (Array.isArray(safeCompletion.missingRequiredFields) ? safeCompletion.missingRequiredFields : []);
        return {
            allowed: percent >= thresholds.appAccess && missingRequiredFields.length === 0,
            threshold: thresholds.appAccess,
            percent,
            code: 'PROFILE_COMPLETION_REQUIRED',
            missingRequiredFields,
        };
    }

    return {
        allowed: true,
        threshold: 0,
        percent,
        code: null,
        missingRequiredFields: [],
    };
};

const syncUserProfileCompletionFlag = async ({ userDoc = null, completion = null } = {}) => {
    const meetsThreshold = Boolean(completion?.meetsProfileCompleteThreshold);
    if (!userDoc || typeof userDoc !== 'object') {
        return {
            changed: false,
            hasCompletedProfile: meetsThreshold,
            profileComplete: meetsThreshold,
        };
    }

    const currentHasCompletedProfile = Boolean(userDoc.hasCompletedProfile);
    const currentProfileComplete = Boolean(userDoc.profileComplete);
    if (currentHasCompletedProfile === meetsThreshold && currentProfileComplete === meetsThreshold) {
        return {
            changed: false,
            hasCompletedProfile: currentHasCompletedProfile,
            profileComplete: currentProfileComplete,
        };
    }

    userDoc.hasCompletedProfile = meetsThreshold;
    userDoc.profileComplete = meetsThreshold;
    if (typeof userDoc.save === 'function') {
        await userDoc.save({ validateBeforeSave: false });
    }

    return {
        changed: true,
        hasCompletedProfile: meetsThreshold,
        profileComplete: meetsThreshold,
    };
};

module.exports = {
    evaluateWorkerProfileCompletion,
    evaluateEmployerProfileCompletion,
    evaluateProfileCompletion,
    isActionAllowedByProfileCompletion,
    isUserProfileMarkedComplete,
    syncUserProfileCompletionFlag,
    resolveThresholds,
};
