import React, { createContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wipeSensitiveCache } from '../utils/cacheManager';
import { getPrimaryRoleFromUser, hasUserSelectedRole, getRoleContractFromUser } from '../utils/roleMode';
import SocketService from '../services/socket';
import client from '../api/client';
import { logger } from '../utils/logger';

export const AuthContext = createContext();

const normalizeUserInfo = (value = {}) => {
    const roleContract = getRoleContractFromUser(value);
    return {
        ...value,
        roles: roleContract.roles,
        activeRole: roleContract.activeRole,
        primaryRole: roleContract.activeRole || getPrimaryRoleFromUser(value),
        capabilities: roleContract.capabilities,
        hasSelectedRole: hasUserSelectedRole({ ...value, ...roleContract }),
        hasCompletedProfile: Boolean(value?.hasCompletedProfile),
    };
};

export const AuthProvider = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [userToken, setUserToken] = useState(null);
    const [userInfo, setUserInfo] = useState(null);
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

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

    const login = async (data) => {
        setIsLoading(true);
        try {
            const normalizedUser = normalizeUserInfo(data);
            await SecureStore.setItemAsync('userInfo', JSON.stringify(normalizedUser));
            await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
            await AsyncStorage.setItem('@onboarding_completed', 'true');
            setHasCompletedOnboarding(true);
            setUserInfo(normalizedUser);
            setUserToken(normalizedUser.token);
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

            await SecureStore.setItemAsync('userInfo', JSON.stringify(merged));
            setUserInfo(merged);
            if (merged.token) {
                setUserToken(merged.token);
            }
            return merged;
        } catch (e) {
            logger.error('Auth updateUserInfo failed', e);
            throw e;
        }
    };

    const logout = async () => {
        setIsLoading(true);
        try {
            const currentUser = userInfo || JSON.parse(await SecureStore.getItemAsync('userInfo') || 'null');
            const refreshToken = currentUser?.refreshToken || null;
            const deviceId = await getOrCreateDeviceId();
            const token = currentUser?.token || null;

            if (token) {
                await client.post('/api/users/logout', { refreshToken, deviceId }, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'x-device-id': deviceId,
                        'x-device-platform': 'mobile',
                    },
                }).catch(() => {});
            }
            await SecureStore.deleteItemAsync('userInfo');
            await SecureStore.deleteItemAsync('hasCompletedOnboarding');
            await wipeSensitiveCache();
            SocketService.disconnect();
            setUserInfo(null);
            setUserToken(null);
            setHasCompletedOnboarding(false);
        } catch (e) {
            logger.error('Auth logout failed', e);
        }
        setIsLoading(false);
    };

    const isLoggedIn = async () => {
        try {
            setIsLoading(true);
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const onboardingStr = await SecureStore.getItemAsync('hasCompletedOnboarding');
            const localOnboardingStr = await AsyncStorage.getItem('@onboarding_completed');
            let resolvedOnboarding = onboardingStr === 'true' || localOnboardingStr === 'true';

            if (userInfoStr) {
                let user = JSON.parse(userInfoStr);
                if (isTokenValid(user?.token)) {
                    user = normalizeUserInfo(user);
                    await SecureStore.setItemAsync('userInfo', JSON.stringify(user));
                    setUserInfo(user);
                    setUserToken(user.token);

                    if (!resolvedOnboarding) {
                        await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
                        await AsyncStorage.setItem('@onboarding_completed', 'true');
                        resolvedOnboarding = true;
                    }
                } else {
                    await SecureStore.deleteItemAsync('userInfo');
                    setUserInfo(null);
                    setUserToken(null);
                }
            }

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
        await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
        await AsyncStorage.setItem('@onboarding_completed', 'true');
        setHasCompletedOnboarding(true);
    };

    return (
        <AuthContext.Provider value={{ login, logout, updateUserInfo, isLoading, userToken, userInfo, hasCompletedOnboarding, completeOnboarding }}>
            {children}
        </AuthContext.Provider>
    );
};
