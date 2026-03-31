const ACTIVE_ROLES = new Set(['worker', 'employer']);

const normalizeActiveRole = (value, fallback = 'worker') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (ACTIVE_ROLES.has(normalized)) return normalized;
    return fallback;
};

const normalizeRoles = (roles = []) => {
    const list = Array.isArray(roles) ? roles : [];
    const normalized = list
        .map((role) => normalizeActiveRole(role, ''))
        .filter(Boolean);
    return Array.from(new Set(normalized));
};

const deriveLegacyRole = (activeRole) => (
    normalizeActiveRole(activeRole) === 'employer' ? 'recruiter' : 'candidate'
);

const defaultCapabilitiesForRole = (activeRole) => {
    const normalized = normalizeActiveRole(activeRole);
    return {
        canPostJob: normalized === 'employer',
        canCreateCommunity: true,
        canCreateBounty: normalized === 'employer',
    };
};

const resolveUserRoleContract = (user = {}) => {
    const roles = normalizeRoles(user.roles);
    const resolvedRoles = roles.length ? roles : ['worker', 'employer'];
    const fallbackActiveRole = normalizeActiveRole(
        user.activeRole || user.primaryRole || user.role,
        resolvedRoles[0] || 'worker'
    );
    const activeRole = resolvedRoles.includes(fallbackActiveRole)
        ? fallbackActiveRole
        : (resolvedRoles[0] || 'worker');

    const defaults = defaultCapabilitiesForRole(activeRole);
    const capabilities = {
        ...defaults,
        ...(user.capabilities || {}),
        canPostJob: typeof user?.capabilities?.canPostJob === 'boolean'
            ? user.capabilities.canPostJob
            : defaults.canPostJob,
        canCreateCommunity: typeof user?.capabilities?.canCreateCommunity === 'boolean'
            ? user.capabilities.canCreateCommunity
            : defaults.canCreateCommunity,
        canCreateBounty: typeof user?.capabilities?.canCreateBounty === 'boolean'
            ? user.capabilities.canCreateBounty
            : defaults.canCreateBounty,
    };

    return {
        roles: resolvedRoles,
        activeRole,
        capabilities,
        role: deriveLegacyRole(activeRole),
        primaryRole: activeRole,
        hasSelectedRole: true,
    };
};

const applyRoleContractToUser = (userDoc, { roles, activeRole, capabilities } = {}) => {
    if (!userDoc) return null;

    const shouldResetCapabilitiesForRoleSwitch = typeof activeRole !== 'undefined' && typeof capabilities === 'undefined';
    const resolvedCapabilities = shouldResetCapabilitiesForRoleSwitch
        ? undefined
        : (capabilities ?? userDoc.capabilities);

    const draft = resolveUserRoleContract({
        ...userDoc,
        roles: roles ?? userDoc.roles,
        activeRole: activeRole ?? userDoc.activeRole,
        capabilities: resolvedCapabilities,
        primaryRole: activeRole ?? userDoc.primaryRole,
    });

    userDoc.roles = draft.roles;
    userDoc.activeRole = draft.activeRole;
    userDoc.capabilities = draft.capabilities;
    userDoc.primaryRole = draft.primaryRole;
    userDoc.role = draft.role;
    userDoc.hasSelectedRole = true;
    return userDoc;
};

module.exports = {
    ACTIVE_ROLES,
    normalizeActiveRole,
    normalizeRoles,
    defaultCapabilitiesForRole,
    deriveLegacyRole,
    resolveUserRoleContract,
    applyRoleContractToUser,
};
