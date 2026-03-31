import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wipeSensitiveCache } from '../utils/cacheManager';
import { getPrimaryRoleFromUser, hasUserSelectedRole, getRoleContractFromUser } from '../utils/roleMode';
import SocketService from '../services/socket';
import client, { setUnauthorizedHandler } from '../api/client';
import { logger } from '../utils/logger';
import { getNormalizedProfileReadiness } from '../utils/profileReadiness';
import {
    clearPendingPostAuthSetupIntent,
    deriveAuthEntryRoleFromUser,
    getPendingPostAuthSetupIntent,
    getRememberedAuthEntryRole,
    normalizeAuthEntryRole,
    normalizePendingPostAuthSetup,
    setPendingPostAuthSetupIntent,
    setRememberedAuthEntryRole,
} from '../utils/authEntryState';
import { isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import { isQaRoleBootstrapEnabled } from '../utils/authRoleSelection';
import { useAppStore } from '../store/AppStore';

export const AuthContext = createContext();
const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();
const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

const normalizeUserInfo = (value = {}) => {
    const roleContract = getRoleContractFromUser(value);
    const readiness = getNormalizedProfileReadiness(value);
    return {
        ...value,
        roles: roleContract.roles,
        activeRole: roleContract.activeRole,
        primaryRole: roleContract.activeRole || getPrimaryRoleFromUser(value),
        capabilities: roleContract.capabilities,
        hasSelectedRole: hasUserSelectedRole({ ...value, ...roleContract }),
        hasCompletedProfile: readiness.hasCompletedProfile,
        profileComplete: readiness.profileComplete,
    };
};

const PERSISTED_USER_FIELDS = [
    '_id',
    'name',
    'email',
    'phoneNumber',
    'accountMode',
    'role',
    'roles',
    'activeRole',
    'primaryRole',
    'capabilities',
    'hasSelectedRole',
    'hasCompletedProfile',
    'profileComplete',
    'interviewVerified',
    'isVerified',
    'isAdmin',
    'signupSetupDraft',
    'token',
    'refreshToken',
];

const toPersistedUserInfo = (value = {}) => {
    const normalized = normalizeUserInfo(value);
    const compact = {};
    PERSISTED_USER_FIELDS.forEach((key) => {
        if (normalized[key] !== undefined) {
            compact[key] = normalized[key];
        }
    });
    return compact;
};

let secureStoreAvailable = null;
const isSecureStoreAvailable = async () => {
    if (secureStoreAvailable !== null) return secureStoreAvailable;
    try {
        secureStoreAvailable = typeof SecureStore.isAvailableAsync === 'function'
            ? await SecureStore.isAvailableAsync()
            : false;
    } catch {
        secureStoreAvailable = false;
    }
    return secureStoreAvailable;
};

const memoryStore = new Map();

const setSecureItem = async (key, value) => {
    if (await isSecureStoreAvailable()) {
        await SecureStore.setItemAsync(key, value);
        return;
    }
    // Security Fix: Do NOT fallback to storing JWTs in unencrypted AsyncStorage
    memoryStore.set(key, value);
};

const getSecureItem = async (key) => {
    if (await isSecureStoreAvailable()) {
        return await SecureStore.getItemAsync(key);
    }
    return memoryStore.get(key) || null;
};

const deleteSecureItem = async (key) => {
    if (await isSecureStoreAvailable()) {
        await SecureStore.deleteItemAsync(key);
        return;
    }
    memoryStore.delete(key);
};

export const AuthProvider = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [userToken, setUserToken] = useState(null);
    const [userInfo, setUserInfo] = useState(null);
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
    const [authEntryRole, setAuthEntryRole] = useState(null);
    const [pendingPostAuthSetup, setPendingPostAuthSetup] = useState(null);

    const getOrCreateDeviceId = async () => {
        const existing = await AsyncStorage.getItem('@device_id');
        if (existing) return existing;
        const generated = `m-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
        await AsyncStorage.setItem('@device_id', generated);
        return generated;
    };

    const isTokenValid = (token) => {
        try {
            if (!token || typeof token !== 'string') return false;
            const payloadChunk = token.split('.')[1];
            if (!payloadChunk) return false;

            const decodeBase64 = typeof globalThis?.atob === 'function'
                ? globalThis.atob
                : (value) => {
                    if (!globalThis?.Buffer) return null;
                    return globalThis.Buffer.from(value, 'base64').toString('utf8');
                };

            const base64 = payloadChunk.replace(/-/g, '+').replace(/_/g, '/');
            const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
            const decodedString = decodeBase64(padded);
            if (!decodedString) return false;
            const decoded = JSON.parse(decodedString);

            return Boolean(decoded?.exp) && decoded.exp * 1000 > Date.now();
        } catch {
            return false;
        }
    };

    const rememberAuthEntryRole = async (value) => {
        const normalized = normalizeAuthEntryRole(value);
        const persisted = await setRememberedAuthEntryRole(normalized);
        setAuthEntryRole(persisted);
        return persisted;
    };

    const queuePostAuthSetup = async (intent) => {
        const normalized = normalizePendingPostAuthSetup(intent);
        const persisted = await setPendingPostAuthSetupIntent(normalized);
        setPendingPostAuthSetup(persisted);
        return persisted;
    };

    const consumePendingPostAuthSetup = async () => {
        await clearPendingPostAuthSetupIntent();
        setPendingPostAuthSetup(null);
    };

    const login = async (data, options = {}) => {
        setIsLoading(true);
        try {
            const normalizedUser = normalizeUserInfo(data);
            const compactUser = toPersistedUserInfo(normalizedUser);
            const hasExplicitPendingPostAuthSetup = Object.prototype.hasOwnProperty.call(
                options || {},
                'pendingPostAuthSetup'
            );
            const nextAuthEntryRole = normalizeAuthEntryRole(
                options?.authEntryRole || deriveAuthEntryRoleFromUser(normalizedUser)
            );
            const nextPendingPostAuthSetup = hasExplicitPendingPostAuthSetup
                ? normalizePendingPostAuthSetup(options.pendingPostAuthSetup)
                : null;

            await setSecureItem('userInfo', JSON.stringify(compactUser));
            await setSecureItem('hasCompletedOnboarding', 'true');
            await AsyncStorage.setItem('@onboarding_completed', 'true');
            if (nextAuthEntryRole) {
                await setRememberedAuthEntryRole(nextAuthEntryRole);
            }
            if (hasExplicitPendingPostAuthSetup) {
                if (nextPendingPostAuthSetup) {
                    await setPendingPostAuthSetupIntent(nextPendingPostAuthSetup);
                } else {
                    await clearPendingPostAuthSetupIntent();
                }
            } else {
                await clearPendingPostAuthSetupIntent();
            }
            setHasCompletedOnboarding(true);
            if (nextAuthEntryRole) {
                setAuthEntryRole(nextAuthEntryRole);
            }
            if (hasExplicitPendingPostAuthSetup) {
                setPendingPostAuthSetup(nextPendingPostAuthSetup);
            } else {
                setPendingPostAuthSetup(null);
            }
            setUserInfo(normalizedUser);
            setUserToken(normalizedUser.token);
            useAppStore.getState().setUser(normalizedUser);
        } catch (e) {
            logger.error('Auth login failed', e);
        }
        setIsLoading(false);
    };

    const updateUserInfo = async (updates = {}) => {
        try {
            const merged = normalizeUserInfo({
                ...(userInfo || {}),
                ...updates,
            });

            const compactUser = toPersistedUserInfo(merged);
            await setSecureItem('userInfo', JSON.stringify(compactUser));
            setUserInfo(merged);
            if (merged.token) {
                setUserToken(merged.token);
            }
            useAppStore.getState().setUser(merged);
            return merged;
        } catch (e) {
            logger.error('Auth updateUserInfo failed', e);
            throw e;
        }
    };

    const logout = async (options = {}) => {
        const { skipServerCall = false } = options;
        try {
            setUnauthorizedHandler(null);
            const currentUser = userInfo || JSON.parse(await getSecureItem('userInfo') || 'null');
            const refreshToken = currentUser?.refreshToken || null;
            const deviceId = await getOrCreateDeviceId();
            const token = currentUser?.token || null;
            const onboardingStr = await getSecureItem('hasCompletedOnboarding');
            const localOnboardingStr = await AsyncStorage.getItem('@onboarding_completed');
            const resolvedOnboarding = onboardingStr === 'true' || localOnboardingStr === 'true';

            await deleteSecureItem('userInfo');
            await clearPendingPostAuthSetupIntent();

            setUserInfo(null);
            setUserToken(null);
            useAppStore.getState().setUser(null);
            setPendingPostAuthSetup(null);
            setHasCompletedOnboarding(resolvedOnboarding);

            SocketService.disconnect();

            const cleanupTasks = [
                wipeSensitiveCache(),
            ];

            if (token && !skipServerCall) {
                const logoutUrl = `${String(client.defaults.baseURL || '').replace(/\/+$/, '')}/users/logout`;
                cleanupTasks.push(
                    axios.post(logoutUrl, { refreshToken, deviceId }, {
                        timeout: 5000,
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            'x-device-id': deviceId,
                            'x-device-platform': 'mobile',
                        },
                    }).catch(() => {})
                );
            }

            await Promise.allSettled(cleanupTasks);
        } catch (e) {
            logger.error('Auth logout failed', e);
        }
        setIsLoading(false);
    };

    const isLoggedIn = async () => {
        try {
            setIsLoading(true);
            const userInfoStr = await getSecureItem('userInfo');
            const onboardingStr = await getSecureItem('hasCompletedOnboarding');
            const localOnboardingStr = await AsyncStorage.getItem('@onboarding_completed');
            const storedAuthEntryRole = await getRememberedAuthEntryRole();
            const storedPendingPostAuthSetup = await getPendingPostAuthSetupIntent();
            let resolvedOnboarding = onboardingStr === 'true' || localOnboardingStr === 'true';

            if (userInfoStr) {
                let user = JSON.parse(userInfoStr);
                const shouldDiscardStoredPreviewSession = Boolean(
                    user?.previewMode
                    && QA_ROLE_BOOTSTRAP_ENABLED
                    && !INSTANT_PREVIEW_AUTH_ENABLED
                );

                if (shouldDiscardStoredPreviewSession) {
                    await deleteSecureItem('userInfo');
                    user = null;
                }

                if (user && isTokenValid(user?.token)) {
                    user = normalizeUserInfo(user);
                    await setSecureItem('userInfo', JSON.stringify(toPersistedUserInfo(user)));
                    setUserInfo(user);
                    setUserToken(user.token);
                    useAppStore.getState().setUser(user);
                    setAuthEntryRole(storedAuthEntryRole || deriveAuthEntryRoleFromUser(user));

                    if (!resolvedOnboarding) {
                        await setSecureItem('hasCompletedOnboarding', 'true');
                        await AsyncStorage.setItem('@onboarding_completed', 'true');
                        resolvedOnboarding = true;
                    }
                } else {
                    await deleteSecureItem('userInfo');
                    setUserInfo(null);
                    setUserToken(null);
                    useAppStore.getState().setUser(null);
                    setAuthEntryRole(storedAuthEntryRole || deriveAuthEntryRoleFromUser(user || {}));
                }
            } else {
                setAuthEntryRole(storedAuthEntryRole);
                useAppStore.getState().setUser(null);
            }

            setPendingPostAuthSetup(storedPendingPostAuthSetup);
            setHasCompletedOnboarding(resolvedOnboarding);
        } catch (e) {
            logger.error('Auth session restore failed', e);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        isLoggedIn();
    }, []);

    const completeOnboarding = async () => {
        await setSecureItem('hasCompletedOnboarding', 'true');
        await AsyncStorage.setItem('@onboarding_completed', 'true');
        setHasCompletedOnboarding(true);
    };

    return (
        <AuthContext.Provider value={{
            login,
            logout,
            updateUserInfo,
            isLoading,
            userToken,
            userInfo,
            hasCompletedOnboarding,
            completeOnboarding,
            authEntryRole,
            rememberAuthEntryRole,
            pendingPostAuthSetup,
            queuePostAuthSetup,
            consumePendingPostAuthSetup,
        }}>
            {children}
        </AuthContext.Provider>
    );
};
