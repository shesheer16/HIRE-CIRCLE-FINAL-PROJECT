export const getPrimaryRoleFromUser = (userInfo = {}) => {
    const explicitActive = String(userInfo?.activeRole || '').toLowerCase();
    if (explicitActive === 'employer' || explicitActive === 'worker') {
        return explicitActive;
    }

    const explicitPrimary = String(userInfo?.primaryRole || '').toLowerCase();
    if (explicitPrimary === 'employer' || explicitPrimary === 'worker') {
        return explicitPrimary;
    }

    const legacyRole = String(userInfo?.role || '').toLowerCase();
    if (legacyRole === 'employer' || legacyRole === 'recruiter' || legacyRole === 'admin') {
        return 'employer';
    }
    if (legacyRole === 'candidate' || legacyRole === 'worker') {
        return 'worker';
    }
    return null;
};

export const hasUserSelectedRole = (userInfo = {}) => {
    if (typeof userInfo?.hasSelectedRole === 'boolean') {
        return userInfo.hasSelectedRole;
    }
    if (Array.isArray(userInfo?.roles) && userInfo.roles.length > 0 && getPrimaryRoleFromUser(userInfo)) {
        return true;
    }
    const resolvedRole = getPrimaryRoleFromUser(userInfo);
    return resolvedRole === 'employer' || resolvedRole === 'worker';
};

export const isDemandMode = (userInfo = {}) => getPrimaryRoleFromUser(userInfo) === 'employer';

export const getModeCopy = (primaryRole) => {
    if (primaryRole === 'employer') {
        return {
            modeLabel: 'Recruiter',
            switchLabel: 'Switch to: Candidate',
            switchedMessage: 'You are now in candidate mode.',
        };
    }

    return {
        modeLabel: 'Candidate',
        switchLabel: 'Switch to: Recruiter',
        switchedMessage: 'You are now in recruiter mode.',
    };
};

export const getLegacyRoleForPrimaryRole = (primaryRole) => (
    primaryRole === 'employer' ? 'recruiter' : 'candidate'
);

export const getRoleContractFromUser = (userInfo = {}) => {
    const activeRole = getPrimaryRoleFromUser(userInfo) || 'worker';
    const capabilities = {
        canPostJob: Boolean(userInfo?.capabilities?.canPostJob ?? (activeRole === 'employer')),
        canCreateCommunity: Boolean(userInfo?.capabilities?.canCreateCommunity ?? true),
        canCreateBounty: Boolean(userInfo?.capabilities?.canCreateBounty ?? (activeRole === 'employer')),
    };
    const roles = Array.isArray(userInfo?.roles) && userInfo.roles.length > 0
        ? Array.from(new Set(userInfo.roles.map((role) => String(role || '').toLowerCase()).filter(Boolean)))
        : ['worker', 'employer'];
    return {
        roles,
        activeRole,
        capabilities,
    };
};
