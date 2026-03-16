const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

const normalizeRoleValue = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'employer' || normalized === 'recruiter' || normalized === 'admin') {
        return 'employer';
    }
    return 'worker';
};

export const normalizeSelectedRole = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'worker' || normalized === 'employer' || normalized === 'hybrid') {
        return normalized;
    }
    return 'worker';
};

export const isEmployerFacingSelectedRole = (value = '') => {
    const normalized = normalizeSelectedRole(value);
    return normalized === 'employer' || normalized === 'hybrid';
};

export const resolveSelectedRoleSession = (value = '') => {
    const selectedRole = normalizeSelectedRole(value);
    const isHybrid = selectedRole === 'hybrid';
    const requestedActiveRole = selectedRole === 'worker' ? 'worker' : 'employer';

    return {
        selectedRole,
        isHybrid,
        requestedActiveRole,
        accountMode: isHybrid ? 'hybrid' : requestedActiveRole,
        defaultRoles: isHybrid ? ['worker', 'employer'] : [requestedActiveRole],
        legacyRole: requestedActiveRole === 'employer' ? 'recruiter' : 'candidate',
    };
};

export const getAuthAccountLabel = (value = '') => (
    isEmployerFacingSelectedRole(value) ? 'Employer' : 'Job Seeker'
);

export const getGenericSetupLabel = (value = '') => (
    isEmployerFacingSelectedRole(value) ? 'Employer' : 'Job Seeker'
);

export const getProfileSetupLabel = (value = '') => (
    isEmployerFacingSelectedRole(value) ? 'Recruiter' : 'Job Seeker'
);

const normalizeRoleList = (roles = []) => Array.from(new Set(
    (Array.isArray(roles) ? roles : [])
        .map((role) => normalizeRoleValue(role))
        .filter(Boolean)
));

export const isQaRoleBootstrapEnabled = () => {
    const rawValue = String(
        process.env.EXPO_PUBLIC_AUTH_BYPASS_FOR_QA ?? (__DEV__ ? 'true' : 'false')
    ).trim().toLowerCase();

    return TRUE_VALUES.has(rawValue);
};

export const buildRoleAwareSessionPayload = (payload = {}, selectedRole = 'worker', options = {}) => {
    const { enforceRequestedRole = false, ...extras } = options;
    const session = resolveSelectedRoleSession(selectedRole);
    const payloadRoles = normalizeRoleList(payload?.roles);
    const payloadActiveRole = normalizeRoleValue(payload?.activeRole || payload?.primaryRole || payload?.role);
    const canUseRequestedRole = enforceRequestedRole || payloadRoles.includes(session.requestedActiveRole);
    const activeRole = canUseRequestedRole
        ? session.requestedActiveRole
        : (payloadActiveRole || session.requestedActiveRole);
    const mergedRoles = session.isHybrid
        ? normalizeRoleList([...payloadRoles, ...session.defaultRoles])
        : normalizeRoleList(payloadRoles.length > 0 ? payloadRoles : [activeRole]);

    return {
        ...payload,
        ...extras,
        role: activeRole === 'employer' ? 'recruiter' : 'candidate',
        activeRole,
        primaryRole: activeRole,
        roles: mergedRoles,
        accountMode: session.isHybrid ? 'hybrid' : activeRole,
        hasSelectedRole: true,
    };
};
