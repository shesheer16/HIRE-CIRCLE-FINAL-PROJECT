import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_ENTRY_ROLE_KEY = '@auth_entry_role';
const PENDING_POST_AUTH_SETUP_KEY = '@pending_post_auth_setup';

export const normalizeAuthEntryRole = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'worker' || normalized === 'employer' || normalized === 'hybrid') {
        return normalized;
    }
    return null;
};

export const deriveAuthEntryRoleFromUser = (userInfo = {}) => {
    const accountMode = String(userInfo?.accountMode || '').trim().toLowerCase();
    const roleValue = String(
        userInfo?.activeRole || userInfo?.primaryRole || userInfo?.role || ''
    ).trim().toLowerCase();

    if (accountMode === 'hybrid') {
        return roleValue === 'worker' || roleValue === 'candidate'
            ? 'worker'
            : 'hybrid';
    }

    if (roleValue === 'employer' || roleValue === 'recruiter' || roleValue === 'admin') {
        return 'employer';
    }
    if (roleValue === 'worker' || roleValue === 'candidate') {
        return 'worker';
    }
    return null;
};

export const getRememberedAuthEntryRole = async () => {
    try {
        const value = await AsyncStorage.getItem(AUTH_ENTRY_ROLE_KEY);
        return normalizeAuthEntryRole(value);
    } catch {
        return null;
    }
};

export const setRememberedAuthEntryRole = async (value) => {
    const normalized = normalizeAuthEntryRole(value);
    try {
        if (!normalized) {
            await AsyncStorage.removeItem(AUTH_ENTRY_ROLE_KEY);
            return null;
        }
        await AsyncStorage.setItem(AUTH_ENTRY_ROLE_KEY, normalized);
        return normalized;
    } catch {
        return normalized;
    }
};

export const clearRememberedAuthEntryRole = async () => {
    try {
        await AsyncStorage.removeItem(AUTH_ENTRY_ROLE_KEY);
    } catch {
        // noop
    }
};

export const normalizePendingPostAuthSetup = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'worker_profile' || normalized === 'employer_profile') {
        return normalized;
    }
    return null;
};

export const getPendingPostAuthSetupIntent = async () => {
    try {
        const value = await AsyncStorage.getItem(PENDING_POST_AUTH_SETUP_KEY);
        return normalizePendingPostAuthSetup(value);
    } catch {
        return null;
    }
};

export const setPendingPostAuthSetupIntent = async (value) => {
    const normalized = normalizePendingPostAuthSetup(value);
    try {
        if (!normalized) {
            await AsyncStorage.removeItem(PENDING_POST_AUTH_SETUP_KEY);
            return null;
        }
        await AsyncStorage.setItem(PENDING_POST_AUTH_SETUP_KEY, normalized);
        return normalized;
    } catch {
        return normalized;
    }
};

export const clearPendingPostAuthSetupIntent = async () => {
    try {
        await AsyncStorage.removeItem(PENDING_POST_AUTH_SETUP_KEY);
    } catch {
        // noop
    }
};
