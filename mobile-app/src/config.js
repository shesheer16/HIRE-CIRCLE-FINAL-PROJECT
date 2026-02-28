const resolvedApiUrl = process.env.EXPO_PUBLIC_API_URL || 'https://api.hirecircle.in';
const rawDemoMode = process.env.EXPO_PUBLIC_DEMO_MODE ?? process.env.DEMO_MODE ?? 'false';
const demoModeValue = String(rawDemoMode).trim().toLowerCase();
export const DEMO_MODE = demoModeValue === 'true' || demoModeValue === '1' || demoModeValue === 'yes' || demoModeValue === 'on';
const rawMatchUiV1 = process.env.EXPO_PUBLIC_FEATURE_MATCH_UI_V1 ?? 'true';
const matchUiFlagValue = String(rawMatchUiV1).trim().toLowerCase();
export const FEATURE_MATCH_UI_V1 = matchUiFlagValue === 'true' || matchUiFlagValue === '1' || matchUiFlagValue === 'yes' || matchUiFlagValue === 'on';
const rawSettingsAdvanced = process.env.EXPO_PUBLIC_FEATURE_SETTINGS_ADVANCED ?? 'false';
const settingsAdvancedFlagValue = String(rawSettingsAdvanced).trim().toLowerCase();
export const FEATURE_SETTINGS_ADVANCED = settingsAdvancedFlagValue === 'true' || settingsAdvancedFlagValue === '1' || settingsAdvancedFlagValue === 'yes' || settingsAdvancedFlagValue === 'on';

export const API_URL = resolvedApiUrl;
export const API_BASE_URL = API_URL;
export const BASE_URL = API_BASE_URL;
export const SOCKET_URL = API_BASE_URL;
export default API_URL;
