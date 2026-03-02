const isDev = process.env.NODE_ENV !== 'production';

export const logger = {
    log: (...args) => isDev && console.info(...args),
    warn: (...args) => isDev && console.warn(...args),
    error: (...args) => console.warn(...args),
};
