import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { triggerHaptic } from '../utils/haptics';

import { API_BASE_URL } from '../config';
import { navigate } from '../navigation/navigationRef';
import { logger } from '../utils/logger';
import { getMockApiResponse } from '../demo/mockApi';
import { isDemoTransportEnabled, setRuntimeDemoMode } from '../utils/runtimeDemo';

const resolveLiveAdapter = () => {
    const defaultAdapter = axios.defaults.adapter;
    if (typeof defaultAdapter === 'function') {
        return defaultAdapter;
    }

    if (typeof axios.getAdapter === 'function') {
        try {
            return axios.getAdapter(Array.isArray(defaultAdapter) ? defaultAdapter : ['xhr', 'http', 'fetch']);
        } catch (error) {
            logger.error('Unable to resolve axios live adapter:', error?.message || error);
        }
    }
    return null;
};

const liveAdapter = resolveLiveAdapter();

const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 15000,
    adapter: async (config) => {
        if (isDemoTransportEnabled()) {
            return getMockApiResponse(config);
        }

        if (liveAdapter) {
            return liveAdapter(config);
        }

        throw new Error('No network adapter available');
    },
});

// Add a request interceptor to attach the Token
client.interceptors.request.use(
    async (config) => {
        if (isDemoTransportEnabled()) {
            return config;
        }
        try {
            const userInfoString = await SecureStore.getItemAsync('userInfo');
            if (userInfoString) {
                const userInfo = JSON.parse(userInfoString);
                if (userInfo && userInfo.token) {
                    const isDevDemoToken = (
                        typeof __DEV__ !== 'undefined'
                        && __DEV__
                        && typeof userInfo.token === 'string'
                        && userInfo.token.startsWith('demo.')
                    );
                    if (isDevDemoToken) {
                        setRuntimeDemoMode(true);
                        return config;
                    }
                    config.headers.Authorization = `Bearer ${userInfo.token}`;
                }
            }
        } catch (error) {
            logger.error('Error retrieving token from SecureStore:', error);
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Add a response interceptor to handle token expiration (401/403) and 500 Server Errors
client.interceptors.response.use(
    (response) => {
        return response;
    },
    async (error) => {
        if (isDemoTransportEnabled()) {
            return Promise.reject(error);
        }
        const config = error.config || {};

        // Initialize retry attempts array
        if (!config.retryCount) {
            config.retryCount = 0;
            config.maxRetries = 2;
        }

        if (error.response) {
            // Unauthenticated intercept logic
            if (error.response.status === 401) {
                try {
                    await SecureStore.deleteItemAsync('userInfo');
                    navigate('Login');
                } catch (e) {
                    logger.error('Error clearing SecureStore on 401:', e);
                }
                return Promise.reject(error);
            }

            // Server Error boundary popup
            if (error.response.status >= 500) {
                if (config.retryCount < config.maxRetries) {
                    config.retryCount += 1;
                    logger.log(`Server 500 Retry [Attempt ${config.retryCount}]`);
                    return new Promise((resolve) => setTimeout(() => resolve(client(config)), 1000 * config.retryCount));
                }

                Alert.alert(
                    'Server Connectivity Issue',
                    'We are currently experiencing technical difficulties connecting to our internal servers. Please try again in to a few minutes.',
                    [{ text: "OK" }]
                );
            }
        } else if (error.request) {
            // Network failure without a response (offline mode interceptor buffer)
            logger.warn('Network Error Intercepted:', error.message);

            // Retry Network Timeouts once or twice before failing
            if (config.retryCount < config.maxRetries) {
                config.retryCount += 1;
                logger.log(`Offline/Network Retry [Attempt ${config.retryCount}]`);
                return new Promise((resolve) => setTimeout(() => resolve(client(config)), 1000 * config.retryCount));
            }
            return Promise.reject(new Error('No internet connection'));
        }

        return Promise.reject(error);
    }
);

export default client;
