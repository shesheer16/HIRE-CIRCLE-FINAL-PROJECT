const isDevRuntime = typeof __DEV__ !== 'undefined' && __DEV__ === true;
const devLanApiUrl = 'http://192.168.1.104:5001';
const configuredApiUrl = String(process.env.EXPO_PUBLIC_API_URL || '').trim();
const configuredApiIsLoopback = /localhost|127\.0\.0\.1/i.test(configuredApiUrl);
const resolvedApiUrl = (
    configuredApiUrl && !(isDevRuntime && configuredApiIsLoopback)
        ? configuredApiUrl
        : (isDevRuntime ? devLanApiUrl : 'https://api.hirecircle.in')
);
export const DEMO_MODE = false;
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

export const clarificationFieldMap = {
    totalExperienceYears: {
        type: 'numericSelector',
        title: 'We need a bit more detail',
        question: 'How many years of experience do you have?',
        options: [
            { label: '1 year', value: 1 },
            { label: '2 years', value: 2 },
            { label: '3 years', value: 3 },
            { label: '4+ years', value: 4 },
        ],
    },
    expectedSalary: {
        type: 'currencyInput',
        title: 'We need a bit more detail',
        question: 'What is your expected monthly salary?',
        currencyPrefix: 'INR',
        placeholder: 'Enter amount',
    },
    shiftPreference: {
        type: 'singleSelect',
        title: 'We need a bit more detail',
        question: 'Which shift works best for you?',
        options: [
            { label: 'Day', value: 'day' },
            { label: 'Night', value: 'night' },
            { label: 'Flexible', value: 'flexible' },
        ],
    },
    availabilityType: {
        type: 'singleSelect',
        title: 'We need a bit more detail',
        question: 'What type of availability are you looking for?',
        options: [
            { label: 'Full-time', value: 'full-time' },
            { label: 'Part-time', value: 'part-time' },
            { label: 'Contract', value: 'contract' },
        ],
    },
    primarySkills: {
        type: 'multiSelectSearch',
        title: 'We need a bit more detail',
        question: 'Select your primary skills',
        options: [
            { label: 'Driving', value: 'Driving' },
            { label: 'Delivery', value: 'Delivery' },
            { label: 'Warehouse', value: 'Warehouse' },
            { label: 'Inventory', value: 'Inventory' },
            { label: 'Dispatch', value: 'Dispatch' },
            { label: 'Customer Support', value: 'Customer Support' },
            { label: 'Loading', value: 'Loading' },
        ],
        placeholder: 'Search skills',
    },
    city: {
        type: 'searchableDropdown',
        title: 'We need a bit more detail',
        question: 'Please confirm your city',
        options: [
            { label: 'Hyderabad', value: 'Hyderabad' },
            { label: 'Secunderabad', value: 'Secunderabad' },
            { label: 'Bengaluru', value: 'Bengaluru' },
            { label: 'Chennai', value: 'Chennai' },
            { label: 'Mumbai', value: 'Mumbai' },
            { label: 'Pune', value: 'Pune' },
            { label: 'Delhi', value: 'Delhi' },
            { label: 'Noida', value: 'Noida' },
            { label: 'Gurugram', value: 'Gurugram' },
        ],
        placeholder: 'Search city',
    },
};

export default API_URL;
