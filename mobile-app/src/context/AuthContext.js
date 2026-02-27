import React, { createContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wipeSensitiveCache } from '../utils/cacheManager';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import SocketService from '../services/socket';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [isLoading, setIsLoading] = useState(true);
    const [userToken, setUserToken] = useState(null);
    const [userInfo, setUserInfo] = useState(null);
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

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
            const normalizedUser = {
                ...data,
                primaryRole: getPrimaryRoleFromUser(data),
            };
            await SecureStore.setItemAsync('userInfo', JSON.stringify(normalizedUser));
            await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
            setHasCompletedOnboarding(true);
            setUserInfo(normalizedUser);
            setUserToken(normalizedUser.token);
        } catch (e) {
            console.error('Login error', e);
        }
        setIsLoading(false);
    };

    const updateUserInfo = async (updates = {}) => {
        try {
            const merged = {
                ...(userInfo || {}),
                ...updates,
            };
            merged.primaryRole = getPrimaryRoleFromUser(merged);

            await SecureStore.setItemAsync('userInfo', JSON.stringify(merged));
            setUserInfo(merged);
            if (merged.token) {
                setUserToken(merged.token);
            }
            return merged;
        } catch (e) {
            console.error('updateUserInfo error', e);
            throw e;
        }
    };

    const logout = async () => {
        setIsLoading(true);
        try {
            await SecureStore.deleteItemAsync('userInfo');
            await SecureStore.deleteItemAsync('hasCompletedOnboarding');
            await AsyncStorage.clear();
            await wipeSensitiveCache();
            SocketService.disconnect();
            setUserInfo(null);
            setUserToken(null);
            setHasCompletedOnboarding(false);
        } catch (e) {
            console.error('Logout error', e);
        }
        setIsLoading(false);
    };

    const isLoggedIn = async () => {
        try {
            setIsLoading(true);
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const onboardingStr = await SecureStore.getItemAsync('hasCompletedOnboarding');
            let resolvedOnboarding = onboardingStr === 'true';

            if (userInfoStr) {
                let user = JSON.parse(userInfoStr);
                if (isTokenValid(user?.token)) {
                    user = { ...user, primaryRole: getPrimaryRoleFromUser(user) };
                    await SecureStore.setItemAsync('userInfo', JSON.stringify(user));
                    setUserInfo(user);
                    setUserToken(user.token);

                    if (!resolvedOnboarding) {
                        await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
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
            console.error('isLoggedIn error', e);
        }
        setIsLoading(false);
    };

    useEffect(() => {
        isLoggedIn();
    }, []);

    const completeOnboarding = async () => {
        await SecureStore.setItemAsync('hasCompletedOnboarding', 'true');
        setHasCompletedOnboarding(true);
    };

    return (
        <AuthContext.Provider value={{ login, logout, updateUserInfo, isLoading, userToken, userInfo, hasCompletedOnboarding, completeOnboarding }}>
            {children}
        </AuthContext.Provider>
    );
};
