import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { API_BASE_URL } from '../config';
import { navigate } from '../navigation/navigationRef';
import { logger } from '../utils/logger';

const MAX_RETRIES = Number.parseInt(process.env.EXPO_PUBLIC_API_MAX_RETRIES || '3', 10);
const CIRCUIT_FAILURE_THRESHOLD = Number.parseInt(process.env.EXPO_PUBLIC_API_CIRCUIT_FAILURE_THRESHOLD || '6', 10);
const CIRCUIT_COOLDOWN_MS = Number.parseInt(process.env.EXPO_PUBLIC_API_CIRCUIT_COOLDOWN_MS || '30000', 10);

const circuitState = {
    consecutiveFailures: 0,
    openUntil: 0,
    lastAlertAt: 0,
};

let refreshInFlight = null;

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isCircuitOpen = () => circuitState.openUntil > now();

const tripCircuit = () => {
    circuitState.openUntil = now() + CIRCUIT_COOLDOWN_MS;
};

const registerFailure = () => {
    circuitState.consecutiveFailures += 1;
    if (circuitState.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        tripCircuit();
    }
};

const registerSuccess = () => {
    circuitState.consecutiveFailures = 0;
    circuitState.openUntil = 0;
};

const showConnectivityAlert = () => {
    const sinceLast = now() - circuitState.lastAlertAt;
    if (sinceLast < 15000) return;
    circuitState.lastAlertAt = now();

    Alert.alert(
        'Connectivity degraded',
        'We are retrying in the background. Some actions may take longer to complete.',
        [{ text: 'OK' }]
    );
};

const buildCorrelationId = () => `m-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
const getOrCreateDeviceId = async () => {
    const existing = await AsyncStorage.getItem('@device_id');
    if (existing) return existing;
    const generated = `m-${Math.random().toString(36).slice(2, 12)}-${Date.now()}`;
    await AsyncStorage.setItem('@device_id', generated);
    return generated;
};

const getStoredUserInfo = async () => {
    const userInfoString = await SecureStore.getItemAsync('userInfo');
    if (!userInfoString) return null;
    return JSON.parse(userInfoString);
};

const setStoredUserInfo = async (value) => {
    await SecureStore.setItemAsync('userInfo', JSON.stringify(value));
};

const clearStoredUserInfo = async () => {
    await SecureStore.deleteItemAsync('userInfo');
};

const getStoredAdminToken = async () => SecureStore.getItemAsync('adminAuthToken');

const clearStoredAdminToken = async () => {
    await SecureStore.deleteItemAsync('adminAuthToken');
};

const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 15000,
});

const refreshAuthToken = async () => {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        const userInfo = await getStoredUserInfo();
        const refreshToken = userInfo?.refreshToken;
        if (!refreshToken) {
            throw new Error('Missing refresh token');
        }

        const response = await axios.post(`${API_BASE_URL}/api/users/refresh-token`, { refreshToken }, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' },
        });

        const updated = {
            ...(userInfo || {}),
            ...response.data,
            token: response.data?.token,
            refreshToken: response.data?.refreshToken,
        };

        await setStoredUserInfo(updated);
        return updated;
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
};

client.interceptors.request.use(
    async (config) => {
        if (!config?.headers) {
            config.headers = {};
        }

        if (!config.headers['x-correlation-id']) {
            config.headers['x-correlation-id'] = buildCorrelationId();
        }
        if (!config.headers['x-device-id']) {
            config.headers['x-device-id'] = await getOrCreateDeviceId();
        }
        if (!config.headers['x-device-platform']) {
            config.headers['x-device-platform'] = 'mobile';
        }

        if (!config.__allowWhenCircuitOpen && isCircuitOpen()) {
            const error = new Error('API circuit is open');
            error.code = 'API_CIRCUIT_OPEN';
            throw error;
        }

        try {
            const url = String(config?.url || '');
            const isAdminRoute = url.startsWith('/api/admin');
            const isAdminAuthRoute = url.startsWith('/api/admin/auth');

            if (isAdminRoute && !isAdminAuthRoute) {
                const adminToken = await getStoredAdminToken();
                if (adminToken) {
                    config.headers.Authorization = `Bearer ${adminToken}`;
                    return config;
                }
            }

            const userInfo = await getStoredUserInfo();
            if (userInfo?.token) {
                config.headers.Authorization = `Bearer ${userInfo.token}`;
            }
        } catch (error) {
            logger.error('Error retrieving token from SecureStore:', error);
        }

        return config;
    },
    (error) => Promise.reject(error)
);

client.interceptors.response.use(
    (response) => {
        registerSuccess();
        return response;
    },
    async (error) => {
        const config = error.config || {};
        config.retryCount = Number(config.retryCount || 0);

        const status = Number(error?.response?.status || 0);
        const isServerError = status >= 500;
        const isRateLimited = status === 429;
        const isAuthError = status === 401;
        const isNetworkError = Boolean(error.request) && !status;
        const url = String(config?.url || '');
        const isAdminRoute = url.startsWith('/api/admin');
        const isAdminAuthRoute = url.startsWith('/api/admin/auth');

        if (isAuthError && isAdminRoute && !isAdminAuthRoute) {
            await clearStoredAdminToken();
            return Promise.reject(error);
        }

        if (isAuthError && !config.__isRefreshRequest && !config.__authRetried) {
            config.__authRetried = true;
            try {
                const refreshed = await refreshAuthToken();
                config.headers = {
                    ...(config.headers || {}),
                    Authorization: `Bearer ${refreshed.token}`,
                };
                return client(config);
            } catch (refreshError) {
                await clearStoredUserInfo();
                navigate('Login');
                return Promise.reject(refreshError);
            }
        }

        if (isServerError || isRateLimited || isNetworkError) {
            registerFailure();
            showConnectivityAlert();

            if (config.retryCount < MAX_RETRIES) {
                config.retryCount += 1;
                const backoffMs = Math.min(8000, (2 ** config.retryCount) * 250 + Math.floor(Math.random() * 200));
                await sleep(backoffMs);
                return client(config);
            }

            if (isCircuitOpen()) {
                const circuitError = new Error('Service temporarily unavailable (circuit breaker open)');
                circuitError.code = 'API_CIRCUIT_OPEN';
                return Promise.reject(circuitError);
            }
        }

        if (isAuthError) {
            await clearStoredUserInfo();
            navigate('Login');
        }

        return Promise.reject(error);
    }
);

export default client;
