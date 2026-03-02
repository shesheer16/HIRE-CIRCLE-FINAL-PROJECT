import { DEMO_MODE } from '../config';

const RUNTIME_DEMO_FLAG = '__HIRE_RUNTIME_DEMO_MODE__';

const isDevelopmentBuild = () => (
    typeof __DEV__ !== 'undefined' && __DEV__
);

export const setRuntimeDemoMode = (enabled) => {
    if (!isDevelopmentBuild()) return;
    globalThis[RUNTIME_DEMO_FLAG] = Boolean(enabled);
};

export const isRuntimeDemoModeEnabled = () => {
    if (!isDevelopmentBuild()) return false;
    return globalThis?.[RUNTIME_DEMO_FLAG] === true;
};

export const isDemoTransportEnabled = () => (
    DEMO_MODE || isRuntimeDemoModeEnabled()
);
