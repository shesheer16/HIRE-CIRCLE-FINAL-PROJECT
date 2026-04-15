const RECRUITER_ROLE = 'recruiter';
const CANDIDATE_ROLE = 'candidate';
const LEGACY_EMPLOYER_ROLE = 'employer';
const EMPLOYER_PRIMARY_ROLE = 'employer';
const logger = require('./logger');

let loggedLegacyEmployerWarning = false;

const normalizeRoleValue = (value) => String(value || '').trim().toLowerCase();

const logLegacyEmployerWarningOnce = () => {
    if (loggedLegacyEmployerWarning) return;
    loggedLegacyEmployerWarning = true;
    // DB migration hook: convert legacy role='employer' to role='recruiter' in a controlled migration.
    logger.warn('[role-contract] Legacy role "employer" detected; treating as "recruiter".');
};

const hasEmployerPrimaryRole = (user) => {
    const activeRole = normalizeRoleValue(user?.activeRole);
    if (activeRole === EMPLOYER_PRIMARY_ROLE) return true;
    return normalizeRoleValue(user?.primaryRole) === EMPLOYER_PRIMARY_ROLE;
};

function isRecruiter(user) {
    const role = normalizeRoleValue(user?.role);
    if (role === LEGACY_EMPLOYER_ROLE) {
        logLegacyEmployerWarningOnce();
        return true;
    }

    if (role === RECRUITER_ROLE) return true;
    return hasEmployerPrimaryRole(user);
}

function isCandidate(user) {
    return normalizeRoleValue(user?.role) === CANDIDATE_ROLE;
}

function assertRecruiter(user) {
    if (!isRecruiter(user)) throw new Error('Recruiter access required');
}

function assertCandidate(user) {
    if (!isCandidate(user)) throw new Error('Candidate access required');
}

const recruiterRoleQuery = () => ({
    $in: [RECRUITER_ROLE, LEGACY_EMPLOYER_ROLE],
});

module.exports = {
    RECRUITER_ROLE,
    CANDIDATE_ROLE,
    LEGACY_EMPLOYER_ROLE,
    hasEmployerPrimaryRole,
    isRecruiter,
    isCandidate,
    assertRecruiter,
    assertCandidate,
    recruiterRoleQuery,
};
