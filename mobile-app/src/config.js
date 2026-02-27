const ENV = process.env.APP_ENV || 'development';

const configs = {
    development: {
        API_URL: 'http://localhost:3000',
    },
    preview: {
        API_URL: 'https://your-staging-server.com',
    },
    production: {
        API_URL: 'https://api.hirecircle.in',
    },
};

const selectedConfig = configs[ENV] || configs.development;

export const API_URL = process.env.EXPO_PUBLIC_API_URL || selectedConfig.API_URL;
export const BASE_URL = API_URL;
export const SOCKET_URL = API_URL;
