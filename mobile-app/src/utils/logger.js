import * as Sentry from '@sentry/react-native';

export const logger = {
    log: (...args) => {
        if (__DEV__) console.log(...args);
    },
    warn: (...args) => {
        if (__DEV__) console.warn(...args);
        Sentry.captureMessage(args.join(' '), 'warning');
    },
    error: (message, error) => {
        if (__DEV__) console.error(message, error);
        if (error) {
            Sentry.captureException(error, { extra: { context: message } });
        } else {
            Sentry.captureMessage(message, 'error');
        }
    },
};

