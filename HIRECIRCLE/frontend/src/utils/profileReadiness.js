const NETWORK_ERROR_MESSAGES = Object.freeze({
    no_internet: 'No internet connection. Please check your network and try again.',
    network: 'Unable to reach the server. Please try again.',
    timeout: 'Request timed out. Please retry.',
});

export const normalizeAppRole = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['employer', 'recruiter', 'hirer', 'company'].includes(normalized)) return 'employer';
    if (['worker', 'candidate', 'jobseeker', 'job_seeker', 'employee'].includes(normalized)) return 'worker';
    return '';
};

export const getAccountRoleLabel = (role = '') => (
    normalizeAppRole(role) === 'employer' ? 'Employer' : 'Job Seeker'
);

export const getProfileTitleForRole = (role = '') => (
    `${getAccountRoleLabel(role)} Profile`
);

export const getNormalizedProfileReadiness = (user = {}) => {
    const isComplete = Boolean(user?.profileComplete ?? user?.hasCompletedProfile);
    return {
        isComplete,
        hasCompletedProfile: isComplete,
        profileComplete: isComplete,
        profileCompletion: user?.profileCompletion || null,
    };
};

const PROFILE_STUDIO_REQUIRED_STEP_IDS = Object.freeze({
    worker: ['full_name', 'city', 'skills', 'experience_level', 'expected_salary', 'availability'],
    employer: ['company_name', 'company_description', 'location', 'industry', 'contact_person'],
});

const PROFILE_STUDIO_VERIFICATION_STEP_IDS = Object.freeze({
    worker: ['phone_verified'],
    employer: ['verified_contact'],
});

const PROFILE_COMPLETION_LABELS = Object.freeze({
    full_name: 'full name',
    city: 'location',
    skills: 'skills',
    experience_level: 'experience',
    expected_salary: 'expected pay',
    availability: 'availability',
    phone_verified: 'contact verification',
    company_name: 'company name',
    company_description: 'company summary',
    location: 'hiring location',
    industry: 'industry',
    contact_person: 'contact person',
    verified_contact: 'contact verification',
});

export const isProfileMarkedComplete = (user = {}) => (
    getNormalizedProfileReadiness(user).isComplete
);

export const formatProfileCompletionStepLabel = (stepId = '') => (
    PROFILE_COMPLETION_LABELS[String(stepId || '').trim()] || String(stepId || '').replace(/_/g, ' ').trim()
);

export const getProfileStudioCompletion = ({ role = '', completion = null } = {}) => {
    const normalizedRole = normalizeAppRole(role) || 'worker';
    const requiredStepIds = PROFILE_STUDIO_REQUIRED_STEP_IDS[normalizedRole] || PROFILE_STUDIO_REQUIRED_STEP_IDS.worker;
    const verificationStepIds = PROFILE_STUDIO_VERIFICATION_STEP_IDS[normalizedRole] || [];
    const steps = Array.isArray(completion?.steps) ? completion.steps : [];
    const stepLookup = new Map(
        steps.map((step) => [String(step?.id || '').trim(), Boolean(step?.complete)])
    );

    const missingCoreSteps = requiredStepIds.filter((stepId) => !stepLookup.get(stepId));
    const missingVerificationSteps = verificationStepIds.filter((stepId) => !stepLookup.get(stepId));

    return {
        missingCoreSteps,
        missingVerificationSteps,
        isStudioReady: missingCoreSteps.length === 0,
        isVerificationPending: missingVerificationSteps.length > 0,
        isFullyReady: missingCoreSteps.length === 0 && missingVerificationSteps.length === 0,
    };
};

export const isProfileRoleGateError = (error) => {
    const status = Number(
        error?.response?.status
        || error?.originalError?.response?.status
        || error?.status
        || 0
    );
    const code = String(
        error?.response?.data?.code
        || error?.originalError?.response?.data?.code
        || ''
    ).trim().toUpperCase();
    const message = String(
        error?.response?.data?.message
        || error?.originalError?.response?.data?.message
        || error?.message
        || ''
    ).toLowerCase();

    return status === 403 && (
        code === 'PROFILE_INCOMPLETE'
        || code === 'PROFILE_INCOMPLETE_ROLE'
        || message.includes('profile_incomplete')
        || message.includes('complete your employer profile')
        || message.includes('complete your job seeker profile')
        || message.includes('employer profile incomplete')
        || message.includes('job seeker profile')
        || message.includes('worker profile requires at least one role profile')
        || message.includes('role profile')
        || message.includes('unlock matches and applications')
    );
};

export const getProfileGateMessage = ({ role = '', fallback = '' } = {}) => {
    if (normalizeAppRole(role) === 'employer') {
        return fallback || 'Complete your Employer profile to continue hiring actions.';
    }
    return fallback || 'Complete your Job Seeker profile to unlock matches and applications.';
};

export const getReadableNonAuthError = (error, fallbackMessage = 'Something went wrong. Please try again.', options = {}) => {
    const responseMessage = String(
        error?.response?.data?.message
        || error?.originalError?.response?.data?.message
        || ''
    ).trim();

    if (isProfileRoleGateError(error)) {
        return getProfileGateMessage({
            role: options?.role,
            fallback: responseMessage,
        });
    }

    if (responseMessage) return responseMessage;
    if (error?.message === 'No internet connection') return NETWORK_ERROR_MESSAGES.no_internet;
    if (error?.message === 'Network Error') return NETWORK_ERROR_MESSAGES.network;
    if (error?.code === 'ECONNABORTED') return NETWORK_ERROR_MESSAGES.timeout;

    const directMessage = String(error?.message || '').trim();
    if (directMessage) return directMessage;

    return fallbackMessage;
};
