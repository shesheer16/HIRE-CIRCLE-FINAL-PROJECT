import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_CANDIDATES, API_BASE_URL } from '../config';
import { logger } from '../utils/logger';
import { initializeSslPinning } from 'react-native-ssl-public-key-pinning';

// Initialize SSL Pinning to prevent MITM attacks using malicious root certificates
try {
    const rawApiHost = (API_BASE_URL.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || 'hirecircle.in';
    // Fallback split for potential full IP or port presence, grabbing just the domain name if possible
    const domainHost = rawApiHost.split(':')[0];

    // Only apply SSL pinning in production configurations when HTTPS is targeted
    if (!__DEV__ && /^https/i.test(API_BASE_URL)) {
        const primaryHash = process.env.EXPO_PUBLIC_SSL_PIN_PRIMARY || 'sha256/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
        const backupHash = process.env.EXPO_PUBLIC_SSL_PIN_BACKUP || 'sha256/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
        
        initializeSslPinning({
            [domainHost]: {
                includeSubdomains: true,
                publicKeyHashes: [primaryHash, backupHash],
            },
        });
    }
} catch (pinError) {
    logger.error('Failed to initialize SSL Pinning', pinError);
}

const MAX_RETRIES = Number.parseInt(process.env.EXPO_PUBLIC_API_MAX_RETRIES || '3', 10);
const CIRCUIT_FAILURE_THRESHOLD = Number.parseInt(process.env.EXPO_PUBLIC_API_CIRCUIT_FAILURE_THRESHOLD || '6', 10);
const CIRCUIT_COOLDOWN_MS = Number.parseInt(process.env.EXPO_PUBLIC_API_CIRCUIT_COOLDOWN_MS || '30000', 10);
const CIRCUIT_ENABLED = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.EXPO_PUBLIC_API_CIRCUIT_ENABLED ?? (__DEV__ ? 'false' : 'true')).trim().toLowerCase()
);

const circuitState = {
    consecutiveFailures: 0,
    openUntil: 0,
};

let refreshInFlight = null;
let unauthorizedInProgress = false;
let unauthorizedHandler = null;
let apiErrorHandler = null;

export const setUnauthorizedHandler = (handler) => {
    unauthorizedHandler = typeof handler === 'function' ? handler : null;
};

export const setApiErrorHandler = (handler) => {
    apiErrorHandler = typeof handler === 'function' ? handler : null;
};

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const resolvedApiBaseCandidates = Array.from(
    new Set(
        [API_BASE_URL, ...(Array.isArray(API_BASE_CANDIDATES) ? API_BASE_CANDIDATES : [])]
            .map((item) => normalizeBaseUrl(item))
            .filter(Boolean)
    )
);
let activeApiBaseUrl = resolvedApiBaseCandidates[0] || normalizeBaseUrl(API_BASE_URL);

const setActiveApiBaseUrl = (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return;
    activeApiBaseUrl = normalized;
};

const getNextFallbackBaseUrl = (config = {}) => {
    const tried = new Set(
        (Array.isArray(config.__triedApiBases) ? config.__triedApiBases : [])
            .map((item) => normalizeBaseUrl(item))
            .filter(Boolean)
    );
    const current = normalizeBaseUrl(config.baseURL || activeApiBaseUrl || API_BASE_URL);
    if (current) tried.add(current);
    return resolvedApiBaseCandidates.find((candidate) => !tried.has(candidate)) || null;
};

const isCircuitOpen = () => CIRCUIT_ENABLED && circuitState.openUntil > now();

const tripCircuit = () => {
    if (!CIRCUIT_ENABLED) return;
    circuitState.openUntil = now() + CIRCUIT_COOLDOWN_MS;
};

const registerFailure = () => {
    if (!CIRCUIT_ENABLED) return;
    circuitState.consecutiveFailures += 1;
    if (circuitState.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        tripCircuit();
    }
};

const registerSuccess = () => {
    circuitState.consecutiveFailures = 0;
    circuitState.openUntil = 0;
};

const buildCorrelationId = () => `m-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
const resolveMaxRetries = (config = {}) => {
    const override = Number(config?.__maxRetries);
    if (Number.isFinite(override) && override >= 0) {
        return Math.floor(override);
    }
    return MAX_RETRIES;
};

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

const notifyApiError = (error) => {
    try {
        if (apiErrorHandler) {
            apiErrorHandler(error);
        }
    } catch (handlerError) {
        logger.error('Global API error handler failed:', handlerError);
    }
};

const shouldNotifyApiError = (config = {}) => !Boolean(config?.__skipApiErrorHandler);

const buildApiError = (error, type, message, retry = null) => {
    const status = Number(error?.response?.status || 0);
    const normalized = new Error(message);
    normalized.name = 'ApiClientError';
    normalized.type = type;
    normalized.status = status;
    normalized.code = error?.code || null;
    normalized.retry = typeof retry === 'function' ? retry : null;
    normalized.originalError = error;
    return normalized;
};

const handleUnauthorized = async () => {
    if (unauthorizedInProgress) {
        return;
    }

    unauthorizedInProgress = true;
    try {
        await clearStoredUserInfo();
        await clearStoredAdminToken();
        if (unauthorizedHandler) {
            await unauthorizedHandler();
        }
    } catch (error) {
        logger.error('Unauthorized handler failed:', error);
    } finally {
        unauthorizedInProgress = false;
    }
};

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const hasApiPrefixInBaseUrl = /\/api$/i.test(API_BASE_URL);
const normalizeRouteForChecks = (urlValue = '') => {
    const raw = String(urlValue || '').trim();
    if (!raw) return '';

    const withoutOrigin = ABSOLUTE_HTTP_URL_PATTERN.test(raw)
        ? raw.replace(/^https?:\/\/[^/]+/i, '')
        : raw;

    if (withoutOrigin.startsWith('/api')) return withoutOrigin;
    if (withoutOrigin.startsWith('/')) return `/api${withoutOrigin}`;
    return `/api/${withoutOrigin}`;
};
const normalizeRequestUrl = (urlValue = '') => {
    const raw = String(urlValue || '').trim();
    if (!raw || ABSOLUTE_HTTP_URL_PATTERN.test(raw) || !hasApiPrefixInBaseUrl) {
        return raw;
    }

    if (/^\/api(\/|$)/i.test(raw)) {
        const stripped = raw.replace(/^\/api(?=\/|$)/i, '');
        return stripped || '/';
    }

    if (/^api(\/|$)/i.test(raw)) {
        const stripped = raw.replace(/^api(?=\/|$)/i, '');
        return stripped.startsWith('/') ? stripped : `/${stripped}`;
    }

    return raw;
};

const client = axios.create({
    baseURL: activeApiBaseUrl,
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

        const response = await axios.post(`${activeApiBaseUrl}/users/refresh-token`, { refreshToken }, {
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
        config.baseURL = normalizeBaseUrl(config.baseURL || activeApiBaseUrl);

        if (!config.headers['x-correlation-id']) {
            config.headers['x-correlation-id'] = buildCorrelationId();
        }
        if (!config.headers['x-device-id']) {
            config.headers['x-device-id'] = await getOrCreateDeviceId();
        }
        if (!config.headers['x-device-platform']) {
            config.headers['x-device-platform'] = 'mobile';
        }

        const routeForChecks = normalizeRouteForChecks(config?.url || '');
        const normalizedMethod = String(config?.method || 'get').toLowerCase();
        const isWriteMethod = ['post', 'put', 'patch', 'delete'].includes(normalizedMethod);
        const isDevBootstrapRoute = routeForChecks === '/api/auth/dev-bootstrap';
        const isProfileWriteRoute = routeForChecks === '/api/users/profile' && normalizedMethod !== 'get';
        const isProfileCompleteRoute = routeForChecks === '/api/users/profile/complete';
        const shouldBypassCircuit = Boolean(
            config.__allowWhenCircuitOpen
            || isWriteMethod
            || isDevBootstrapRoute
            || isProfileWriteRoute
            || isProfileCompleteRoute
        );

        if (isCircuitOpen() && !shouldBypassCircuit) {
            const circuitError = new Error('Service temporarily unavailable. Please retry.');
            circuitError.code = 'API_CIRCUIT_OPEN';
            throw circuitError;
        }

        try {
            const isAdminRoute = routeForChecks.startsWith('/api/admin');
            const isAdminAuthRoute = routeForChecks.startsWith('/api/admin/auth');
            config.url = normalizeRequestUrl(config.url);

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
        if (response?.config?.baseURL) {
            setActiveApiBaseUrl(response.config.baseURL);
            client.defaults.baseURL = activeApiBaseUrl;
        }
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
        const isPermissionError = status === 403;
        const isValidationError = status === 422;
        const isNetworkError = Boolean(error.request) && !status;
        const routeForChecks = normalizeRouteForChecks(config?.url || '');
        const isAdminRoute = routeForChecks.startsWith('/api/admin');
        const isAdminAuthRoute = routeForChecks.startsWith('/api/admin/auth');
        const retryRequest = config
            ? async () => client({ ...config, retryCount: 0, __userRetried: true })
            : null;

        if (isNetworkError && !config.__disableBaseFallback) {
            const fallbackBase = getNextFallbackBaseUrl(config);
            if (fallbackBase) {
                const currentBase = normalizeBaseUrl(config.baseURL || activeApiBaseUrl || API_BASE_URL);
                config.__triedApiBases = Array.from(
                    new Set([
                        ...(Array.isArray(config.__triedApiBases) ? config.__triedApiBases : []),
                        currentBase,
                    ].filter(Boolean))
                );
                config.baseURL = fallbackBase;
                logger.warn(`API network error on ${routeForChecks || config?.url || 'request'}. Retrying via ${fallbackBase}`);
                return client(config);
            }
        }

        if (isAuthError && isAdminRoute && !isAdminAuthRoute) {
            await clearStoredAdminToken();
            const authError = buildApiError(error, 'auth', 'Session expired. Please sign in again.');
            if (shouldNotifyApiError(config)) {
                notifyApiError(authError);
            }
            return Promise.reject(authError);
        }

        // Auth submission routes (login/register) have no session to refresh.
        // A 401 from these routes means bad credentials — not an expired token.
        // We must pass the raw original Axios error through so that the calling
        // screen's catch block receives error.response.data.message intact.
        const isAuthSubmitRoute = routeForChecks.includes('/api/users/login')
            || routeForChecks.includes('/api/users/register');

        if (isAuthError && !config.__isRefreshRequest && !config.__authRetried && !isAuthSubmitRoute) {
            config.__authRetried = true;
            try {
                const refreshed = await refreshAuthToken();
                config.headers = {
                    ...(config.headers || {}),
                    Authorization: `Bearer ${refreshed.token}`,
                };
                return client(config);
            } catch (refreshError) {
                if (!config.__skipUnauthorizedHandler) {
                    await handleUnauthorized();
                }
                const authError = buildApiError(refreshError, 'auth', 'Session expired. Please sign in again.');
                if (shouldNotifyApiError(config)) {
                    notifyApiError(authError);
                }
                return Promise.reject(authError);
            }
        }

        if (isServerError || isRateLimited || isNetworkError) {
            registerFailure();
            const maxRetriesForRequest = resolveMaxRetries(config);

            if (config.retryCount < maxRetriesForRequest) {
                config.retryCount += 1;
                const backoffMs = Math.min(8000, (2 ** config.retryCount) * 250 + Math.floor(Math.random() * 200));
                await sleep(backoffMs);
                return client(config);
            }
        }

        if (isAuthError && isAuthSubmitRoute) {
            // Pass the original Axios error straight through — .response.status and
            // .response.data.message are intact so LoginScreen.js can display the
            // correct "not registered" or "invalid credentials" message.
            return Promise.reject(error);
        }

        if (isAuthError) {
            if (!config.__skipUnauthorizedHandler) {
                await handleUnauthorized();
            }
            const authError = buildApiError(error, 'auth', 'Session expired. Please sign in again.');
            if (shouldNotifyApiError(config)) {
                notifyApiError(authError);
            }
            return Promise.reject(authError);
        }

        if (isPermissionError) {
            const permissionError = buildApiError(
                error,
                'permission',
                error?.response?.data?.message || 'You do not have permission to perform this action.'
            );
            if (shouldNotifyApiError(config)) {
                notifyApiError(permissionError);
            }
            return Promise.reject(permissionError);
        }

        if (isValidationError) {
            const validationError = buildApiError(
                error,
                'validation',
                error?.response?.data?.message || 'Some inputs are invalid. Please review and retry.'
            );
            if (shouldNotifyApiError(config)) {
                notifyApiError(validationError);
            }
            return Promise.reject(validationError);
        }

        if (isServerError) {
            const serverError = buildApiError(
                error,
                'server',
                error?.response?.data?.message || 'Server error. Please try again in a moment.',
                retryRequest,
            );
            if (shouldNotifyApiError(config)) {
                notifyApiError(serverError);
            }
            return Promise.reject(serverError);
        }

        if (isNetworkError || error?.code === 'API_CIRCUIT_OPEN') {
            const networkError = buildApiError(
                error,
                'network',
                'Network unavailable. Check your connection and retry.',
                retryRequest,
            );
            if (shouldNotifyApiError(config)) {
                notifyApiError(networkError);
            }
            return Promise.reject(networkError);
        }

        return Promise.reject(error);
    }
);

export default client;
