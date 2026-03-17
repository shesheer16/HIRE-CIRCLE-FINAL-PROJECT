import Constants from 'expo-constants';

const DEFAULT_API_PORT = '3001';
const LEGACY_API_PORT = '5001';
const DEFAULT_API_BASE = `http://localhost:${DEFAULT_API_PORT}/api`;
const LOOPBACK_HOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i;
const SAFE_PRIVATE_IP_PATTERN = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)$/;

const extractHostFromHostUri = (hostUriValue) => {
    const raw = String(hostUriValue || '').trim();
    if (!raw) return '';
    const withoutScheme = raw.replace(/^[a-z]+:\/\//i, '');
    const hostWithPort = withoutScheme.split('/')[0];
    const host = hostWithPort.split(':')[0];
    return String(host || '').trim();
};

const resolveExpoLanHost = () => {
    const hostCandidates = [
        Constants?.expoConfig?.hostUri,
        Constants?.expoGoConfig?.debuggerHost,
        Constants?.manifest?.debuggerHost,
        Constants?.manifest2?.extra?.expoGo?.debuggerHost,
    ];

    for (const candidate of hostCandidates) {
        const host = extractHostFromHostUri(candidate);
        if (host && !LOOPBACK_HOST_PATTERN.test(host)) {
            return host;
        }
    }

    return '';
};

const rewriteLoopbackHost = (urlValue) => {
    const normalized = String(urlValue || '').trim();
    if (!/^https?:\/\//i.test(normalized)) {
        return normalized;
    }

    const lanHost = resolveExpoLanHost();
    if (!lanHost) {
        return normalized;
    }

    return normalized.replace(
        /^(https?:\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i,
        (_full, scheme, _host, port) => `${scheme}${lanHost}${port || `:${DEFAULT_API_PORT}`}`,
    );
};

const extractPortFromUrl = (urlValue) => {
    const raw = String(urlValue || '').trim();
    if (!raw) return DEFAULT_API_PORT;
    const explicitPort = raw.match(/:(\d+)(?:\/|$)/);
    if (explicitPort?.[1]) return explicitPort[1];
    if (/^https:\/\//i.test(raw)) return '443';
    return DEFAULT_API_PORT;
};

const resolveApiBaseUrl = (rawValue) => {
    const trimmed = String(rawValue || '').trim().replace(/\/+$/, '');
    const withDefault = trimmed || DEFAULT_API_BASE;
    const hostResolved = rewriteLoopbackHost(withDefault);
    if (/\/api$/i.test(hostResolved)) return hostResolved;
    return `${hostResolved}/api`;
};

const buildApiBaseCandidates = (rawValue) => {
    const primary = resolveApiBaseUrl(rawValue);
    const apiPort = extractPortFromUrl(rawValue || primary);
    const lanHost = resolveExpoLanHost();
    const fallbackPorts = Array.from(new Set([apiPort, DEFAULT_API_PORT, LEGACY_API_PORT].filter(Boolean)));
    const normalizedCandidates = [
        primary,
        ...fallbackPorts.flatMap((port) => ([
            lanHost ? `http://${lanHost}:${port}/api` : null,
            `http://localhost:${port}/api`,
            `http://127.0.0.1:${port}/api`,
            `http://10.0.2.2:${port}/api`,
        ])),
    ]
        .filter(Boolean)
        .map((item) => String(item).trim().replace(/\/+$/, ''))
        .map((item) => (/\/api$/i.test(item) ? item : `${item}/api`));

    const deduped = [];
    const seen = new Set();
    for (const candidate of normalizedCandidates) {
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        deduped.push(candidate);
    }

    // If EXPO_PUBLIC_API_BASE points at stale private IP, prefer current Expo LAN host first.
    const providedHost = extractHostFromHostUri(rawValue);
    const shouldPromoteLanHost = Boolean(
        lanHost
        && providedHost
        && SAFE_PRIVATE_IP_PATTERN.test(providedHost)
        && String(providedHost) !== String(lanHost)
    );
    if (shouldPromoteLanHost) {
        const lanCandidate = `http://${lanHost}:${apiPort}/api`;
        return [lanCandidate, ...deduped.filter((item) => item !== lanCandidate)];
    }

    return deduped;
};

const resolvedApiBaseCandidates = buildApiBaseCandidates(process.env.EXPO_PUBLIC_API_BASE);
const resolvedApiBaseUrl = resolvedApiBaseCandidates[0] || resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE);
const resolvedSocketUrl = resolvedApiBaseUrl.replace(/\/api$/i, '');

const rawMatchUiV1 = process.env.EXPO_PUBLIC_FEATURE_MATCH_UI_V1 ?? 'true';
const matchUiFlagValue = String(rawMatchUiV1).trim().toLowerCase();
export const FEATURE_MATCH_UI_V1 = matchUiFlagValue === 'true' || matchUiFlagValue === '1' || matchUiFlagValue === 'yes' || matchUiFlagValue === 'on';
const rawSettingsAdvanced = process.env.EXPO_PUBLIC_FEATURE_SETTINGS_ADVANCED ?? 'false';
const settingsAdvancedFlagValue = String(rawSettingsAdvanced).trim().toLowerCase();
export const FEATURE_SETTINGS_ADVANCED = settingsAdvancedFlagValue === 'true' || settingsAdvancedFlagValue === '1' || settingsAdvancedFlagValue === 'yes' || settingsAdvancedFlagValue === 'on';

export const API_BASE_URL = resolvedApiBaseUrl;
export const API_BASE_CANDIDATES = resolvedApiBaseCandidates;
export const API_URL = API_BASE_URL;
export const BASE_URL = resolvedSocketUrl;
export const SOCKET_URL = resolvedSocketUrl;

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
