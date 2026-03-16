import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorageLib from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import client from '../api/client';
import EmptyState from '../components/EmptyState';
import JobCard from '../components/JobCard';
import SkeletonLoader from '../components/SkeletonLoader';
import NudgeToast from '../components/NudgeToast';
import { FEATURE_MATCH_UI_V1 } from '../config';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { trackEvent } from '../services/analytics';
import { useAppStore } from '../store/AppStore';
import { logValidationError } from '../utils/apiValidator';
import { logger } from '../utils/logger';
import { AuthContext } from '../context/AuthContext';
import { RADIUS, SCREEN_CHROME, SHADOWS, SPACING, theme } from '../theme/theme';
import {
    isProfileMarkedComplete,
    isProfileRoleGateError,
} from '../utils/profileReadiness';
import {
    getDisplayScorePercent,
    getNormalizedScore,
    MATCH_TIERS,
    sortRecommendedJobsByTierAndScore,
} from '../utils/matchUi';
import {
    getApDistrictOptions,
    getApLocalityHints,
} from '../config/apProfileCatalog';
import { buildLocationSearchBlob, resolveStructuredLocation } from '../utils/locationPresentation';

const FILTERS = ['All', 'High Match', 'Nearby', 'New'];
const NO_PROFILE_FILTERS = ['All', 'Nearby', 'New', 'Higher Pay'];
const DISMISSED_KEY = '@hire_dismissed_jobs';
const CACHE_KEY = '@cached_jobs';
const FETCH_DEBOUNCE_MS = 250;
const MAX_MATCH_API_CALLS_PER_LOAD = 3;
const FORCE_EMPTY_FIND_WORK_FEED = false;
const INPUT_BLUR_DELAY_MS = 180;
const IS_EXPO_GO = (
    Constants.executionEnvironment === 'storeClient'
    || Constants.appOwnership === 'expo'
);

let hasShownMatchBannerThisSession = false;
const SEEDED_ROLE_PROFILE_TITLES = new Set([
    'general worker',
    'worker',
    'job seeker',
    'candidate',
    'profile',
]);
const FIND_WORK_DISTRICT_OPTIONS = getApDistrictOptions();
const FIND_WORK_SALARY_PRESETS = [15000, 20000, 25000, 30000];
const FIND_WORK_RADIUS_PRESETS = [0, 10, 25, 50];
const normalizeFilterToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildAutocompleteOptions = (query = '', options = [], limit = 6) => {
    const normalizedQuery = normalizeFilterToken(query);
    const safeOptions = [...new Set((Array.isArray(options) ? options : []).map((item) => String(item || '').trim()).filter(Boolean))];
    if (!safeOptions.length) return [];
    if (!normalizedQuery) return safeOptions.slice(0, limit);

    const startsWith = safeOptions.filter((item) => normalizeFilterToken(item).startsWith(normalizedQuery));
    const contains = safeOptions.filter((item) => {
        const normalized = normalizeFilterToken(item);
        return normalized.includes(normalizedQuery) && !startsWith.includes(item);
    });
    return [...startsWith, ...contains].slice(0, limit);
};

const extractSalaryNumber = (salaryStr) => {
    if (!salaryStr) return 0;
    const cleaned = String(salaryStr).replace(/[₹,\s]/g, '');
    const match = cleaned.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
};

const toPostedEpoch = (createdAt) => {
    const parsed = Date.parse(createdAt || '');
    return Number.isFinite(parsed) ? parsed : 0;
};

const toPostedLabel = (createdAt) => {
    if (!createdAt) return 'Just now';
    const parsed = Date.parse(createdAt);
    if (!Number.isFinite(parsed)) return 'Just now';

    const deltaMs = Date.now() - parsed;
    const hourMs = 60 * 60 * 1000;
    if (deltaMs < hourMs) return 'Just now';
    if (deltaMs < 24 * hourMs) return `${Math.max(1, Math.round(deltaMs / hourMs))}h ago`;
    return new Date(parsed).toLocaleDateString();
};

const isMeaningfulRoleProfile = (roleProfile = {}) => {
    const roleName = String(roleProfile?.roleName || '').trim().toLowerCase();
    if (!roleName) return false;
    if (SEEDED_ROLE_PROFILE_TITLES.has(roleName)) return false;

    const skills = Array.isArray(roleProfile?.skills) ? roleProfile.skills.filter(Boolean) : [];
    const hasExperience = Number(roleProfile?.experienceInRole) > 0;
    const hasExpectedSalary = Number(roleProfile?.expectedSalary) > 0;

    return Boolean(roleName && (skills.length > 0 || hasExperience || hasExpectedSalary || roleName.length > 2));
};

const formatDistanceLabel = (rawDistance, fallbackLocation) => {
    const numeric = Number(rawDistance);
    if (Number.isFinite(numeric) && numeric > 0) {
        if (numeric < 1) {
            return `${Math.round(numeric * 1000)}m away`;
        }
        return `${numeric.toFixed(1)}km away`;
    }
    const locationText = String(fallbackLocation || '').trim();
    if (!locationText || locationText.toLowerCase().includes('remote')) {
        return 'Remote friendly';
    }
    return `Near ${locationText}`;
};

const toJobTimestamp = (job) => {
    const candidateEpochs = [
        Number(job?.createdAtEpoch),
        Date.parse(job?.job?.createdAt || ''),
        Date.parse(job?.createdAt || ''),
    ].filter((value) => Number.isFinite(value) && value > 0);
    return candidateEpochs.length ? candidateEpochs[0] : 0;
};

const isRecentJob = (job, maxAgeMs) => {
    const epoch = toJobTimestamp(job);
    if (epoch > 0) {
        return (Date.now() - epoch) <= maxAgeMs;
    }

    const postedText = String(job?.postedTime || '').toLowerCase().trim();
    if (postedText === 'just now') return true;

    const hoursMatch = postedText.match(/(\d+)\s*h\s*ago/);
    if (hoursMatch) {
        return Number(hoursMatch[1]) <= Math.round(maxAgeMs / (60 * 60 * 1000));
    }
    return false;
};

const isNearbyJob = (job, radiusKm, referenceCity = '') => {
    const locationBlob = `${job?.distanceLabel || ''} ${buildLocationSearchBlob(job)}`.toLowerCase();
    if (locationBlob.includes('remote')) return false;

    const normalizedRadius = Number(radiusKm);
    const hasRadiusFilter = Number.isFinite(normalizedRadius) && normalizedRadius > 0;
    const rawDistance = Number(job?.job?.distanceKm ?? job?.distanceKm ?? job?.distance);
    if (Number.isFinite(rawDistance) && rawDistance > 0) {
        if (!hasRadiusFilter) return true;
        return rawDistance <= normalizedRadius;
    }

    if (!hasRadiusFilter) return true;

    const normalizedReferenceCity = String(referenceCity || '').trim().toLowerCase();
    if (!normalizedReferenceCity) return false;
    return buildLocationSearchBlob(job).includes(normalizedReferenceCity);
};

const isHighMatchJob = (job) => {
    const score = getDisplayScorePercent(job);
    if (score >= 80) return true;

    const tier = String(job?.tier || '').toUpperCase();
    return tier === MATCH_TIERS.STRONG || tier === MATCH_TIERS.GOOD;
};

const tierFromProbability = (value) => {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return '';
    if (normalized >= 0.82) return MATCH_TIERS.STRONG;
    if (normalized >= 0.7) return MATCH_TIERS.GOOD;
    if (normalized >= 0.62) return MATCH_TIERS.POSSIBLE;
    return '';
};

const buildJobsCacheKey = ({ userId = '', roleProfileId = '', district = '', mandal = '' } = {}) => {
    const safeUserId = String(userId || '').trim() || 'anonymous';
    const safeRoleProfileId = String(roleProfileId || '').trim() || 'none';
    const safeDistrict = normalizeFilterToken(district || '') || 'any-district';
    const safeMandal = normalizeFilterToken(mandal || '') || 'any-mandal';
    return `${CACHE_KEY}:${safeUserId}:${safeRoleProfileId}:${safeDistrict}:${safeMandal}`;
};

const normalizeJobToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildJobRowSignature = (job = {}) => {
    const requirements = Array.isArray(job?.requirements)
        ? job.requirements.map((item) => normalizeJobToken(item)).filter(Boolean).sort().join('|')
        : '';
    return [
        normalizeJobToken(job?._id),
        normalizeJobToken(job?.title),
        normalizeJobToken(job?.companyName),
        normalizeJobToken(job?.location),
        normalizeJobToken(job?.salaryRange),
        requirements,
    ].join('::');
};

const dedupeJobRows = (rows = []) => {
    const sourceRows = Array.isArray(rows) ? rows : [];
    const seenKeys = new Set();
    const deduped = [];

    sourceRows.forEach((row) => {
        const signature = buildJobRowSignature(row);
        if (!signature) return;
        if (seenKeys.has(signature)) return;
        seenKeys.add(signature);
        deduped.push(row);
    });

    return deduped;
};

export default function JobsScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const insets = useSafeAreaInsets();
    const { featureFlags, role: appRole } = useAppStore();
    const { userInfo } = React.useContext(AuthContext);

    const listRef = useRef(null);
    const fetchDebounceRef = useRef(null);
    const matchApiCallsRef = useRef(0);
    const retentionPingRef = useRef({ jobsNear: false, dailyMatch: false });
    const jobsRef = useRef([]);
    const hasLoadedOnceRef = useRef(false);
    const fetchInFlightRef = useRef(false);
    const pendingFetchRef = useRef(false);
    const fetchRequestIdRef = useRef(0);
    const districtBlurTimeoutRef = useRef(null);
    const mandalBlurTimeoutRef = useRef(null);
    const autoSeededLocationRef = useRef(false);
    const fetchJobsLatestRef = useRef(null);
    const shouldRefetchAfterFilterApplyRef = useRef(false);
    const manualBrowseOverrideRef = useRef(false);
    const contentOpacity = useRef(new Animated.Value(0.9)).current;

    const [activeFilter, setActiveFilter] = useState('All');
    const [userRole, setUserRole] = useState('candidate');
    const [jobs, setJobs] = useState([]);
    const [dismissedJobs, setDismissedJobs] = useState([]);
    const [reportedJobIds, setReportedJobIds] = useState(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const [usingRecommendedFeed, setUsingRecommendedFeed] = useState(false);
    const [showRecommendedFallback, setShowRecommendedFallback] = useState(false);
    const [showMatchBanner, setShowMatchBanner] = useState(false);
    const [recommendedCount, setRecommendedCount] = useState(0);

    const [currentWorkerUserId, setCurrentWorkerUserId] = useState('');
    const [currentWorkerProfileId, setCurrentWorkerProfileId] = useState('');
    const [userBaseCity, setUserBaseCity] = useState('');

    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [districtFilter, setDistrictFilter] = useState('');
    const [mandalFilter, setMandalFilter] = useState('');
    const [minSalaryFilter, setMinSalaryFilter] = useState('');
    const [minMatchFilter, setMinMatchFilter] = useState(0);
    const [isDistrictFocused, setIsDistrictFocused] = useState(false);
    const [isMandalFocused, setIsMandalFocused] = useState(false);

    const [appliedDistrict, setAppliedDistrict] = useState('');
    const [appliedMandal, setAppliedMandal] = useState('');
    const [appliedMinSalary, setAppliedMinSalary] = useState(0);
    const [appliedMinMatch, setAppliedMinMatch] = useState(0);
    const [nudgeToast, setNudgeToast] = useState(null);
    const [showInactiveBanner, setShowInactiveBanner] = useState(false);
    const [searchRadiusKm, setSearchRadiusKm] = useState(0);
    const [draftSearchRadiusKm, setDraftSearchRadiusKm] = useState(0);
    const [isMatchProfileMissing, setIsMatchProfileMissing] = useState(false);
    const hasCreatedFindWorkProfile = Boolean(String(currentWorkerProfileId || '').trim());
    const shouldShowManualBrowseUi = isMatchProfileMissing && !hasCreatedFindWorkProfile;

    const matchOptions = [
        { label: 'All', value: 0 },
        { label: '75%+', value: 75 },
        { label: '90%+', value: 90 },
    ];

    const visibleFilters = shouldShowManualBrowseUi ? NO_PROFILE_FILTERS : FILTERS;
    const activeFilterCount = [
        appliedDistrict || appliedMandal,
        searchRadiusKm > 0,
        appliedMinSalary > 0,
        !isMatchProfileMissing && appliedMinMatch > 0,
    ].filter(Boolean).length;
    const isMatchUiEnabled = featureFlags?.FEATURE_MATCH_UI_V1 ?? FEATURE_MATCH_UI_V1;

    const shouldRenderMatchInsights = isMatchUiEnabled
        && userRole !== 'employer'
        && usingRecommendedFeed
        && !showRecommendedFallback;
    const isFindWorkLockedEmpty = FORCE_EMPTY_FIND_WORK_FEED && userRole !== 'employer';
    const locationHintSource = districtFilter || appliedDistrict || userBaseCity;
    const localityQuickHints = useMemo(
        () => getApLocalityHints(locationHintSource).slice(0, 4),
        [locationHintSource]
    );
    const districtSuggestions = useMemo(
        () => buildAutocompleteOptions(districtFilter, FIND_WORK_DISTRICT_OPTIONS, 7),
        [districtFilter]
    );
    const mandalOptions = useMemo(
        () => getApLocalityHints(districtFilter || appliedDistrict),
        [appliedDistrict, districtFilter]
    );
    const mandalSuggestions = useMemo(
        () => buildAutocompleteOptions(mandalFilter, mandalOptions, 6),
        [mandalFilter, mandalOptions]
    );
    const canApplyFilters = Boolean(String(districtFilter || '').trim()) || !shouldShowManualBrowseUi;

    const formatJobRow = useCallback((item, source = 'generic') => {
        const job = item?.job || item || {};
        const normalizedScore = getNormalizedScore(item);
        const structuredLocation = resolveStructuredLocation({
            district: job?.district || item?.district,
            mandal: job?.mandal || item?.mandal,
            locationLabel: job?.locationLabel || item?.locationLabel,
            location: job?.location || item?.location,
        });
        const fallbackKey = [
            source,
            String(job?.title || 'untitled'),
            String(job?.companyName || 'company'),
            String(structuredLocation.locationLabel || job?.location || 'location'),
        ].join('-').replace(/\s+/g, '-').toLowerCase();

        return {
            _id: String(job._id || item?._id || fallbackKey),
            title: String(job.title || 'Untitled Job'),
            companyName: String(job.companyName || 'Looking for Someone'),
            district: structuredLocation.district,
            mandal: structuredLocation.mandal,
            locationLabel: structuredLocation.locationLabel,
            location: String(structuredLocation.locationLabel || job.location || 'Remote'),
            salaryRange: String(job.salaryRange || 'Unspecified'),
            matchScore: Math.round(normalizedScore * 100),
            matchProbability: normalizedScore,
            finalScore: normalizedScore,
            tier: String(item?.tier || job?.tier || '').toUpperCase(),
            postedTime: toPostedLabel(job.createdAt),
            createdAtEpoch: toPostedEpoch(job.createdAt),
            requirements: Array.isArray(job.requirements) && job.requirements.length
                ? job.requirements
                : ['Requirements not specified'],
            type: String(job?.type || job?.employmentType || ''),
            shift: String(job?.shift || ''),
            remoteAllowed: Boolean(job?.remoteAllowed),
            openings: Number.isFinite(Number(job?.openings ?? item?.openings))
                ? Math.max(0, Math.round(Number(job?.openings ?? item?.openings)))
                : null,
            logoUrl: String(job?.logoUrl || job?.companyLogoUrl || item?.logoUrl || '').trim(),
            companyLogoUrl: String(job?.companyLogoUrl || job?.logoUrl || item?.companyLogoUrl || '').trim(),
            companyBrandPhoto: String(job?.companyBrandPhoto || item?.companyBrandPhoto || '').trim(),
            companyDescription: String(job?.companyDescription || item?.companyDescription || '').trim(),
            companyIndustry: String(job?.companyIndustry || item?.companyIndustry || '').trim(),
            companyWebsite: String(job?.companyWebsite || item?.companyWebsite || '').trim(),
            fitReason: String(item?.whyYouFit || ''),
            explainability: item?.explainability || {},
            matchModelVersionUsed: item?.matchModelVersionUsed || null,
            matchScoreSource: String(item?.matchScoreSource || '').trim(),
            probabilisticFallbackUsed: Boolean(item?.probabilisticFallbackUsed || item?.fallbackUsed),
            timelineTransparency: item?.timelineTransparency || null,
            source,
            urgentHiring: Boolean(job?.urgentHiring || item?.urgentHiring),
            activelyHiring: job?.activelyHiring !== false,
            distanceLabel: formatDistanceLabel(
                job?.distanceKm ?? item?.distanceKm ?? item?.distance,
                structuredLocation.locationLabel || job?.location
            ),
            hiredCount: Number(
                job?.totalHires
                ?? job?.hiredCount
                ?? job?.stats?.hiredCount
                ?? item?.hiredCount
                ?? 0,
            ),
            responseTimeLabel: String(job?.responseTimeLabel || item?.responseTimeLabel || 'Responds fast'),
            createdAt: job?.createdAt || item?.createdAt || null,
            updatedAt: job?.updatedAt || item?.updatedAt || null,
            job: job,
        };
    }, []);

    const resolveWorkerContext = useCallback(async () => {
        let userInfo = {};

        try {
            const userInfoString = await SecureStore.getItemAsync('userInfo');
            userInfo = JSON.parse(userInfoString || '{}');
        } catch (error) {
            logger.warn('Failed to parse userInfo', error?.message || error);
        }

        const normalizedRole = String(
            appRole
            || userInfo?.activeRole
            || userInfo?.primaryRole
            || userInfo?.role
            || ''
        ).toLowerCase();
        const isEmployerRole = normalizedRole === 'employer' || normalizedRole === 'recruiter';
        setUserRole(isEmployerRole ? 'employer' : 'candidate');

        const userId = String(userInfo?._id || '');
        let workerProfileId = String(userInfo?.workerProfileId || '');
        let resolvedWorkerProfile = null;

        if (!workerProfileId) {
            workerProfileId = String(await AsyncStorageLib.getItem('@worker_profile_id') || '').trim();
        }

        if (!isEmployerRole) {
            try {
                const { data } = await client.get('/api/users/profile', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    timeout: 4500,
                    params: { role: 'worker' },
                });
                resolvedWorkerProfile = data?.profile || null;
                workerProfileId = String(resolvedWorkerProfile?._id || workerProfileId || '');
                if (workerProfileId) {
                    await AsyncStorageLib.setItem('@worker_profile_id', workerProfileId);
                }
            } catch (error) {
                logger.warn('Worker profile lookup failed, using userId fallback for recommendations.', error?.message || error);
            }
        }

        const roleProfiles = Array.isArray(resolvedWorkerProfile?.roleProfiles)
            ? resolvedWorkerProfile.roleProfiles
            : [];
        const meaningfulRoleProfiles = roleProfiles.filter(isMeaningfulRoleProfile);
        const activeRoleProfile = meaningfulRoleProfiles.find((profile) => Boolean(profile?.activeProfile))
            || meaningfulRoleProfiles[0]
            || null;
        const activeRoleProfileId = String(activeRoleProfile?.profileId || '').trim();
        const hasRoleProfiles = meaningfulRoleProfiles.length > 0;

        return {
            userId,
            workerProfileId,
            activeRoleProfileId,
            hasRoleProfiles,
            city: String(
                resolvedWorkerProfile?.district
                || resolvedWorkerProfile?.city
                || (hasRoleProfiles ? (userInfo?.acquisitionCity || userInfo?.city) : '')
                || appliedDistrict
                || ''
            ).trim(),
            district: String(
                resolvedWorkerProfile?.district
                || resolvedWorkerProfile?.city
                || ''
            ).trim(),
            mandal: String(
                resolvedWorkerProfile?.mandal
                || resolvedWorkerProfile?.panchayat
                || ''
            ).trim(),
            isEmployerRole,
        };
    }, [appliedDistrict, appRole]);

    const fetchGenericJobs = useCallback(async ({ searchRadiusKm, district = '', mandal = '' }) => {
        const params = {};
        if (Number(searchRadiusKm) > 0) {
            params.radiusKm = searchRadiusKm;
        }
        if (district) params.district = district;
        if (mandal) params.mandal = mandal;
        const { data } = await client.get('/api/jobs', {
            __skipApiErrorHandler: true,
            __allowWhenCircuitOpen: true,
            timeout: 6000,
            params,
        });
        const rows = Array.isArray(data)
            ? data
            : (Array.isArray(data?.data) ? data.data : []);

        return dedupeJobRows(rows
            .map((row) => formatJobRow(row, 'generic')))
            .sort((left, right) => {
                const scoreDiff = getNormalizedScore(right) - getNormalizedScore(left);
                if (scoreDiff !== 0) return scoreDiff;
                return Number(right?.createdAtEpoch || 0) - Number(left?.createdAtEpoch || 0);
            });
    }, [formatJobRow]);

    const fetchRecommendedJobs = useCallback(async ({ workerId, city, district = '', mandal = '', searchRadiusKm }) => {
        if (!workerId) return [];
        if (matchApiCallsRef.current >= MAX_MATCH_API_CALLS_PER_LOAD) {
            logger.warn('Skipping recommended fetch: match API call budget exhausted for this load.');
            return [];
        }

        matchApiCallsRef.current += 1;

        // Keep recommended feed broad-first for stability; strict preference filtering
        // is applied by client-side filters and detail scoring.
        const params = { workerId, preferences: false };
        if (city) params.city = city;
        if (district) params.district = district;
        if (mandal) params.mandal = mandal;
        if (searchRadiusKm) params.radiusKm = searchRadiusKm;

        const { data } = await client.get('/api/jobs/recommended', {
            __skipApiErrorHandler: true,
            __allowWhenCircuitOpen: true,
            timeout: 6000,
            params,
        });
        const rows = (
            Array.isArray(data?.recommendedJobs)
                ? data.recommendedJobs
                : (Array.isArray(data?.data?.recommendedJobs)
                    ? data.data.recommendedJobs
                    : (Array.isArray(data?.matches)
                        ? data.matches
                        : (Array.isArray(data?.data)
                            ? data.data
                            : (Array.isArray(data) ? data : []))))
        );
        const normalized = sortRecommendedJobsByTierAndScore(
            dedupeJobRows(rows.map((row) => formatJobRow(row, 'recommended')))
        );

        const strongAndGood = normalized.filter((row) => row.tier === MATCH_TIERS.STRONG || row.tier === MATCH_TIERS.GOOD);
        const possible = normalized.filter((row) => row.tier === MATCH_TIERS.POSSIBLE);
        return [...strongAndGood, ...possible].slice(0, 20);
    }, [formatJobRow]);

    const fetchCandidateMatchJobs = useCallback(async ({ searchRadiusKm, district = '', mandal = '' }) => {
        const params = {};
        if (Number(searchRadiusKm) > 0) {
            params.radiusKm = searchRadiusKm;
        }
        if (district) params.district = district;
        if (mandal) params.mandal = mandal;
        const { data } = await client.get('/api/matches/candidate', {
            __skipApiErrorHandler: true,
            __allowWhenCircuitOpen: true,
            timeout: 6000,
            params,
        });

        const rows = Array.isArray(data)
            ? data
            : (Array.isArray(data?.matches)
                ? data.matches
                : (Array.isArray(data?.data) ? data.data : []));
        return sortRecommendedJobsByTierAndScore(
            dedupeJobRows(rows.map((row) => formatJobRow(row, 'candidate_match')))
        ).slice(0, 20);
    }, [formatJobRow]);

    const enrichJobsWithMatchScores = useCallback(async ({ rows, workerRefId }) => {
        if (!Array.isArray(rows) || rows.length === 0 || !workerRefId) {
            return Array.isArray(rows) ? rows : [];
        }

        const limitedRows = rows.slice(0, 8);
        const enrichedRows = await Promise.all(
            limitedRows.map(async (row) => {
                const jobId = String(row?.job?._id || row?._id || '').trim();
                if (!jobId) return row;

                try {
                    const { data } = await client.get('/api/matches/probability', {
                        __skipApiErrorHandler: true,
                        __allowWhenCircuitOpen: true,
                        timeout: 3500,
                        params: {
                            workerId: workerRefId,
                            jobId,
                        },
                    });

                    const probabilityValue = Number(data?.matchProbability);
                    if (!Number.isFinite(probabilityValue)) return row;

                    const normalizedProbability = Math.max(0, Math.min(1, probabilityValue));
                    return {
                        ...row,
                        matchScore: Math.round(normalizedProbability * 100),
                        matchProbability: normalizedProbability,
                        finalScore: normalizedProbability,
                        tier: String(row?.tier || data?.tier || tierFromProbability(normalizedProbability)).toUpperCase(),
                        explainability: data?.explainability || row?.explainability || {},
                    };
                } catch (_error) {
                    return row;
                }
            })
        );

        return enrichedRows;
    }, []);

    const fetchJobs = useCallback(async ({ isRefresh = false } = {}) => {
        if (fetchInFlightRef.current) {
            pendingFetchRef.current = true;
            if (isRefresh) {
                setIsRefreshing(false);
            }
            return;
        }

        const requestId = fetchRequestIdRef.current + 1;
        fetchRequestIdRef.current = requestId;
        fetchInFlightRef.current = true;
        if (!isRefresh && !hasLoadedOnceRef.current && jobsRef.current.length === 0) {
            setIsLoading(true);
        }
        setErrorMsg('');
        matchApiCallsRef.current = 0;

        try {
            const {
                userId,
                workerProfileId,
                activeRoleProfileId,
                hasRoleProfiles,
                city,
                district,
                mandal,
                isEmployerRole,
            } = await resolveWorkerContext();
            if (requestId !== fetchRequestIdRef.current) return;

            setCurrentWorkerUserId(userId);
            setCurrentWorkerProfileId(workerProfileId);
            setUserBaseCity(String(city || '').trim());
            const seededDistrict = String(district || '').trim();
            const seededMandal = String(mandal || '').trim();
            if (
                !isEmployerRole
                && !autoSeededLocationRef.current
                && !String(appliedDistrict || '').trim()
                && !String(appliedMandal || '').trim()
                && (seededDistrict || seededMandal)
            ) {
                autoSeededLocationRef.current = true;
                setAppliedDistrict(seededDistrict);
                setAppliedMandal(seededMandal);
                setDistrictFilter(seededDistrict);
                setMandalFilter(seededMandal);
            }
            const jobsCacheKey = buildJobsCacheKey({
                userId,
                roleProfileId: activeRoleProfileId,
                district: appliedDistrict || seededDistrict,
                mandal: appliedMandal || seededMandal,
            });
            const shouldUseMatchFeed = !isEmployerRole && !manualBrowseOverrideRef.current;
            const hasCreatedWorkerProfile = Boolean(String(workerProfileId || '').trim());
            if (!shouldUseMatchFeed) {
                setIsMatchProfileMissing(false);
            }

            if (FORCE_EMPTY_FIND_WORK_FEED && !isEmployerRole) {
                setUsingRecommendedFeed(false);
                setShowRecommendedFallback(false);
                setRecommendedCount(0);
                setJobs([]);
                setErrorMsg('');
                try {
                    const allKeys = await AsyncStorageLib.getAllKeys();
                    const matchKeys = allKeys.filter((key) => key === CACHE_KEY || key.startsWith(`${CACHE_KEY}:`));
                    if (matchKeys.length > 0) {
                        await AsyncStorageLib.multiRemove(matchKeys);
                    }
                } catch (cacheClearError) {
                    logger.warn('Could not clear cached jobs while forcing empty feed', cacheClearError?.message || cacheClearError);
                }
                return;
            }

            if (shouldUseMatchFeed && !hasRoleProfiles) {
                setIsMatchProfileMissing(!hasCreatedWorkerProfile);
                setUsingRecommendedFeed(false);
                setShowRecommendedFallback(false);
                setRecommendedCount(0);
                setErrorMsg('');
            }
            if (shouldUseMatchFeed && hasRoleProfiles) {
                setIsMatchProfileMissing(false);
            }

            try {
                const cachedJobs = await AsyncStorageLib.getItem(jobsCacheKey);
                if (requestId !== fetchRequestIdRef.current) return;
                if (cachedJobs) {
                    const parsed = JSON.parse(cachedJobs);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const hasScores = parsed.some((row) => getDisplayScorePercent(row) > 0);
                        if (isEmployerRole || hasScores) {
                            setJobs(parsed);
                        }
                    }
                }
            } catch (cacheReadError) {
                logger.warn('Error loading cached jobs', cacheReadError?.message || cacheReadError);
            }
            let nextJobs = [];
            let isRecommended = false;

            const genericFallbackPromise = (shouldUseMatchFeed && hasRoleProfiles)
                ? fetchGenericJobs({
                    searchRadiusKm,
                    district: appliedDistrict || seededDistrict,
                    mandal: appliedMandal || seededMandal,
                }).catch(() => [])
                : null;

            if (shouldUseMatchFeed) {
                try {
                    const recommendedRows = await fetchRecommendedJobs({
                        workerId: workerProfileId || userId,
                        city,
                        district: appliedDistrict || seededDistrict,
                        mandal: appliedMandal || seededMandal,
                        searchRadiusKm,
                    });
                    if (requestId !== fetchRequestIdRef.current) return;
                    if (recommendedRows.length > 0) {
                        nextJobs = recommendedRows;
                        isRecommended = true;
                        setRecommendedCount(recommendedRows.length);

                        if (!retentionPingRef.current.dailyMatch) {
                            retentionPingRef.current.dailyMatch = true;
                            if (!IS_EXPO_GO) {
                                import('../services/NotificationService')
                                    .then(({ triggerLocalNotification }) => triggerLocalNotification('daily_match_alert', { count: recommendedRows.length }))
                                    .catch(() => { });
                            }
                        }

                        const topJob = recommendedRows[0];
                        trackEvent('MATCH_RECOMMENDATION_VIEWED', {
                            workerId: workerProfileId || userId,
                            jobId: String(topJob?._id || ''),
                            finalScore: Number(getNormalizedScore(topJob).toFixed(4)),
                            tier: String(topJob?.tier || ''),
                            source: String(route.params?.source || 'jobs_screen'),
                        });
                    }
                } catch (_recommendedError) {
                    // Continue to fallback sources.
                }
            }

            if (!nextJobs.length && shouldUseMatchFeed) {
                const [candidateMatchRows, genericRows] = await Promise.all([
                    fetchCandidateMatchJobs({
                        searchRadiusKm,
                        district: appliedDistrict || seededDistrict,
                        mandal: appliedMandal || seededMandal,
                    }).catch(() => []),
                    genericFallbackPromise || Promise.resolve([]),
                ]);
                if (requestId !== fetchRequestIdRef.current) return;

                if (candidateMatchRows.length > 0) {
                    nextJobs = candidateMatchRows;
                    isRecommended = true;
                    setRecommendedCount(candidateMatchRows.length);
                } else if (genericRows.length > 0) {
                    nextJobs = genericRows;
                    isRecommended = false;
                }
            }

            if (!nextJobs.length && (!shouldUseMatchFeed || !hasRoleProfiles)) {
                nextJobs = await fetchGenericJobs({
                    searchRadiusKm,
                    district: appliedDistrict || seededDistrict,
                    mandal: appliedMandal || seededMandal,
                });
                if (requestId !== fetchRequestIdRef.current) return;
            }

            if (shouldUseMatchFeed && nextJobs.length > 0) {
                const needsScoreEnrichment = nextJobs.some((row) => getDisplayScorePercent(row) <= 0);
                const workerRefId = String(workerProfileId || userId || '').trim();
                if (needsScoreEnrichment && workerRefId) {
                    nextJobs = await enrichJobsWithMatchScores({
                        rows: nextJobs,
                        workerRefId,
                    });
                    if (requestId !== fetchRequestIdRef.current) return;
                }
            }

            const finalRows = sortRecommendedJobsByTierAndScore(dedupeJobRows(nextJobs)).slice(0, 20);

            setUsingRecommendedFeed(isRecommended);
            setShowRecommendedFallback(Boolean(shouldUseMatchFeed && !isRecommended));
            if (!isRecommended) setRecommendedCount(0);

            setJobs(finalRows);

            try {
                await AsyncStorageLib.setItem(jobsCacheKey, JSON.stringify(finalRows));
            } catch (cacheWriteError) {
                logger.warn('Error saving cached jobs', cacheWriteError?.message || cacheWriteError);
            }
        } catch (error) {
            if (requestId !== fetchRequestIdRef.current) return;
            if (isProfileRoleGateError(error)) {
                setIsMatchProfileMissing(true);
                setErrorMsg('');
                try {
                    const genericRows = await fetchGenericJobs({
                        searchRadiusKm,
                        district: appliedDistrict,
                        mandal: appliedMandal,
                    });
                    if (requestId !== fetchRequestIdRef.current) return;
                    setUsingRecommendedFeed(false);
                    setShowRecommendedFallback(false);
                    setRecommendedCount(0);
                    setJobs(sortRecommendedJobsByTierAndScore(dedupeJobRows(genericRows)).slice(0, 20));
                } catch (fallbackError) {
                    logger.warn('Generic jobs fallback failed after profile gate error', fallbackError?.message || fallbackError);
                    setJobs([]);
                }
                return;
            }
            if (error?.name === 'ApiValidationError') {
                logValidationError(error, '/api/jobs');
            }
            setErrorMsg('');
        } finally {
            if (requestId === fetchRequestIdRef.current) {
                fetchInFlightRef.current = false;
                if (isRefresh) {
                    setIsRefreshing(false);
                }
                if (!isRefresh) {
                    setIsLoading(false);
                    hasLoadedOnceRef.current = true;
                }
                if (pendingFetchRef.current) {
                    pendingFetchRef.current = false;
                    setTimeout(() => {
                        const latest = fetchJobsLatestRef.current;
                        if (typeof latest === 'function') {
                            latest({ isRefresh: false });
                        }
                    }, 0);
                }
            }
        }
    }, [
        fetchGenericJobs,
        fetchCandidateMatchJobs,
        enrichJobsWithMatchScores,
        fetchRecommendedJobs,
        resolveWorkerContext,
        appliedDistrict,
        appliedMandal,
        searchRadiusKm,
        route.params?.source,
    ]);
    fetchJobsLatestRef.current = fetchJobs;

    useEffect(() => {
        if (filterModalVisible) return;
        if (!shouldRefetchAfterFilterApplyRef.current) return;
        shouldRefetchAfterFilterApplyRef.current = false;
        fetchJobs({ isRefresh: false });
    }, [appliedDistrict, appliedMandal, fetchJobs, filterModalVisible, searchRadiusKm]);

    const scheduleFetchJobs = useCallback(() => {
        if (fetchDebounceRef.current) {
            clearTimeout(fetchDebounceRef.current);
        }
        fetchDebounceRef.current = setTimeout(() => fetchJobs(), FETCH_DEBOUNCE_MS);
    }, [fetchJobs]);

    const handleRefresh = useCallback(() => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        fetchJobs({ isRefresh: true });
    }, [fetchJobs, isRefreshing]);

    const handleRetry = useCallback(() => {
        fetchJobs();
    }, [fetchJobs]);

    const loadDismissed = useCallback(async () => {
        try {
            const raw = await AsyncStorageLib.getItem(DISMISSED_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) setDismissedJobs(parsed);
            }
        } catch (error) {
            logger.warn('Dismissed jobs cache read failed', error?.message || error);
        }
    }, []);

    useEffect(() => {
        jobsRef.current = jobs;
    }, [jobs]);

    useRefreshOnFocus(scheduleFetchJobs, 'jobs');

    useEffect(() => {
        loadDismissed();
        scheduleFetchJobs();

        return () => {
            if (fetchDebounceRef.current) {
                clearTimeout(fetchDebounceRef.current);
            }
        };
    }, [loadDismissed, scheduleFetchJobs]);

    useEffect(() => {
        const shouldHighlightMatches = Boolean(route.params?.highlightMatches);
        if (!isMatchUiEnabled || !shouldHighlightMatches || !usingRecommendedFeed || hasShownMatchBannerThisSession) {
            return;
        }

        hasShownMatchBannerThisSession = true;
        setShowMatchBanner(true);

        const routeCount = Number(route.params?.recommendedCount || 0);
        if (routeCount > 0) {
            setRecommendedCount(routeCount);
        }

        const timer = setTimeout(() => {
            listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
        }, 250);
        const dismissTimer = setTimeout(() => {
            setShowMatchBanner(false);
        }, 8000);

        return () => {
            clearTimeout(timer);
            clearTimeout(dismissTimer);
        };
    }, [recommendedCount, route.params?.highlightMatches, route.params?.recommendedCount, usingRecommendedFeed]);

    useEffect(() => {
        Animated.timing(contentOpacity, {
            toValue: isLoading ? 0.9 : 1,
            duration: 160,
            useNativeDriver: true,
        }).start();
    }, [contentOpacity, isLoading]);

    useEffect(() => {
        let isMounted = true;

        const checkInactivity = async () => {
            try {
                const lastActive = await AsyncStorageLib.getItem('@hc_last_active_at');
                if (!lastActive || !isMounted) return;

                const lastActiveEpoch = Number(lastActive);
                if (!Number.isFinite(lastActiveEpoch)) return;

                const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
                if ((Date.now() - lastActiveEpoch) >= threeDaysMs) {
                    setShowInactiveBanner(true);
                    setNudgeToast({
                        text: 'Welcome back. You have new opportunities waiting.',
                        actionLabel: 'Refresh',
                        onAction: () => handleRefresh(),
                    });
                    if (!retentionPingRef.current.jobsNear) {
                        retentionPingRef.current.jobsNear = true;
                        if (!IS_EXPO_GO) {
                            import('../services/NotificationService')
                                .then(({ triggerLocalNotification }) => triggerLocalNotification('jobs_near_you', { city: appliedDistrict || appliedMandal || undefined }))
                                .catch(() => { });
                        }
                    }
                }
            } catch (error) {
                logger.warn('Inactivity nudge check failed', error?.message || error);
            }
        };

        checkInactivity();
        return () => { isMounted = false; };
    }, [appliedDistrict, appliedMandal, handleRefresh]);

    useEffect(() => {
        if (route.params?.source !== 'profile_saved') return;
        setNudgeToast({
            text: 'Profile saved. Explore your matching jobs below.',
            actionLabel: 'Refresh',
            onAction: () => handleRefresh(),
        });
    }, [handleRefresh, route.params?.source]);

    useEffect(() => {
        if (userRole === 'employer') return;
        if (isProfileMarkedComplete(userInfo)) return;

        const timeout = setTimeout(() => {
            setNudgeToast({
                text: 'Complete your Job Seeker profile to unlock job matches.',
                actionLabel: 'Complete',
                onAction: () => navigation.navigate('Profiles'),
            });
        }, 1000);

        return () => clearTimeout(timeout);
    }, [navigation, userInfo, userRole]);

    useEffect(() => {
        if (!visibleFilters.includes(activeFilter)) {
            setActiveFilter('All');
        }
    }, [activeFilter, visibleFilters]);

    const filteredJobs = useMemo(() => {
        const dayMs = 24 * 60 * 60 * 1000;
        const maxNewAgeMs = 7 * dayMs;
        const nearbyReference = appliedMandal || appliedDistrict || userBaseCity;

        return jobs
            .filter((job) => !dismissedJobs.some((dismissed) => dismissed._id === job._id))
            .filter((job) => {
                if (activeFilter === 'High Match') return isHighMatchJob(job);
                if (activeFilter === 'Nearby') return isNearbyJob(job, searchRadiusKm, nearbyReference);
                if (activeFilter === 'New') return isRecentJob(job, maxNewAgeMs);
                if (activeFilter === 'Higher Pay') return extractSalaryNumber(job?.salaryRange) >= 25000;
                return true;
            })
            .filter((job) => !appliedDistrict || buildLocationSearchBlob(job).includes(appliedDistrict.toLowerCase()))
            .filter((job) => !appliedMandal || buildLocationSearchBlob(job).includes(appliedMandal.toLowerCase()))
            .filter((job) => !appliedMinSalary || extractSalaryNumber(job?.salaryRange) >= appliedMinSalary)
            .filter((job) => isMatchProfileMissing || !appliedMinMatch || getDisplayScorePercent(job) >= appliedMinMatch);
    }, [
        activeFilter,
        appliedDistrict,
        appliedMandal,
        appliedMinMatch,
        appliedMinSalary,
        dismissedJobs,
        isMatchProfileMissing,
        jobs,
        searchRadiusKm,
        userBaseCity,
    ]);

    const clearInputBlurTimeout = useCallback((field) => {
        const targetRef = field === 'district' ? districtBlurTimeoutRef : mandalBlurTimeoutRef;
        if (targetRef.current) {
            clearTimeout(targetRef.current);
            targetRef.current = null;
        }
    }, []);

    const scheduleInputBlur = useCallback((field, setter) => {
        clearInputBlurTimeout(field);
        const targetRef = field === 'district' ? districtBlurTimeoutRef : mandalBlurTimeoutRef;
        targetRef.current = setTimeout(() => {
            setter(false);
            targetRef.current = null;
        }, INPUT_BLUR_DELAY_MS);
    }, [clearInputBlurTimeout]);

    useEffect(() => () => {
        clearInputBlurTimeout('district');
        clearInputBlurTimeout('mandal');
    }, [clearInputBlurTimeout]);

    const submitReport = useCallback(async (targetId, reason) => {
        try {
            await client.post('/api/reports', { targetId, targetType: 'job', reason });
        } catch (error) {
            // Report acknowledgement should still be optimistic.
        }

        setReportedJobIds((previous) => new Set([...previous, targetId]));
        Alert.alert('Reported', 'Thank you. We will review this job.');
    }, []);

    const handleReportJob = useCallback((job) => {
        Alert.alert('Report Job', 'Why are you reporting this job?', [
            { text: 'Spam or Misleading', onPress: () => submitReport(job?._id, 'spam') },
            { text: 'Inappropriate Content', onPress: () => submitReport(job?._id, 'inappropriate') },
            { text: 'Scam / Fraud', onPress: () => submitReport(job?._id, 'scam') },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [submitReport]);

    const handleApplyFilters = useCallback(() => {
        const nextDistrict = String(districtFilter || '').trim();
        const nextMandal = String(mandalFilter || '').trim();
        const nextMinSalary = minSalaryFilter ? parseInt(minSalaryFilter, 10) : 0;
        const nextRadiusKm = Number(draftSearchRadiusKm || 0);
        // Manual browse mode is for location/salary/distance constraints. Match % alone
        // should not disable smart matchmaking.
        manualBrowseOverrideRef.current = Boolean(
            nextDistrict
            || nextMandal
            || (Number.isFinite(nextMinSalary) && nextMinSalary > 0)
            || (Number.isFinite(nextRadiusKm) && nextRadiusKm > 0)
        );
        if (manualBrowseOverrideRef.current) {
            setActiveFilter('All');
        }
        shouldRefetchAfterFilterApplyRef.current = true;
        setAppliedDistrict(nextDistrict);
        setAppliedMandal(nextMandal);
        setAppliedMinSalary(Number.isFinite(nextMinSalary) ? nextMinSalary : 0);
        setAppliedMinMatch(minMatchFilter);
        setSearchRadiusKm(Number.isFinite(nextRadiusKm) ? nextRadiusKm : 0);
        setFilterModalVisible(false);
    }, [districtFilter, draftSearchRadiusKm, mandalFilter, minMatchFilter, minSalaryFilter]);

    const handleClearFilters = useCallback(() => {
        manualBrowseOverrideRef.current = false;
        shouldRefetchAfterFilterApplyRef.current = true;
        setDistrictFilter('');
        setMandalFilter('');
        setMinSalaryFilter('');
        setMinMatchFilter(0);
        setDraftSearchRadiusKm(0);
        setSearchRadiusKm(0);
        setAppliedDistrict('');
        setAppliedMandal('');
        setAppliedMinSalary(0);
        setAppliedMinMatch(0);
        setActiveFilter('All');
    }, []);

    const handleOpenFilters = useCallback(() => {
        setDistrictFilter(appliedDistrict);
        setMandalFilter(appliedMandal);
        setMinSalaryFilter(appliedMinSalary > 0 ? String(appliedMinSalary) : '');
        setMinMatchFilter(isMatchProfileMissing ? 0 : appliedMinMatch);
        setDraftSearchRadiusKm(searchRadiusKm > 0 ? searchRadiusKm : 0);
        clearInputBlurTimeout('district');
        clearInputBlurTimeout('mandal');
        setIsDistrictFocused(false);
        setIsMandalFocused(false);
        setFilterModalVisible(true);
    }, [appliedDistrict, appliedMandal, appliedMinMatch, appliedMinSalary, clearInputBlurTimeout, isMatchProfileMissing, searchRadiusKm]);

    const handleSelectDistrictSuggestion = useCallback((value) => {
        const safeValue = String(value || '').trim();
        clearInputBlurTimeout('district');
        clearInputBlurTimeout('mandal');
        Keyboard.dismiss();
        setDistrictFilter(safeValue);
        setMandalFilter('');
        setIsDistrictFocused(false);
        setIsMandalFocused(false);
    }, [clearInputBlurTimeout]);

    const handleSelectMandalSuggestion = useCallback((value) => {
        const safeValue = String(value || '').trim();
        clearInputBlurTimeout('mandal');
        Keyboard.dismiss();
        setMandalFilter(safeValue);
        setIsMandalFocused(false);
    }, [clearInputBlurTimeout]);

    const handleDistrictFocus = useCallback(() => {
        clearInputBlurTimeout('district');
        setIsDistrictFocused(true);
    }, [clearInputBlurTimeout]);

    const handleMandalFocus = useCallback(() => {
        if (!String(districtFilter || '').trim()) return;
        clearInputBlurTimeout('mandal');
        setIsMandalFocused(true);
    }, [clearInputBlurTimeout, districtFilter]);

    const handleJobPress = useCallback((job) => {
        const scorePercent = getDisplayScorePercent(job);

        trackEvent('JOB_VIEWED', {
            jobId: String(job?._id || ''),
            title: String(job?.title || ''),
            matchScore: Number(scorePercent || 0),
        });

        navigation.navigate('JobDetails', {
            job,
            matchScore: scorePercent,
            fitReason: job?.fitReason || `Your profile aligns with ${job?.title || 'this job'} requirements.`,
            workerIdForMatch: currentWorkerProfileId || currentWorkerUserId,
            finalScore: Number(getNormalizedScore(job).toFixed(4)),
            tier: String(job?.tier || ''),
            explainability: job?.explainability || {},
            entrySource: 'jobs_tab',
        });
    }, [currentWorkerProfileId, currentWorkerUserId, navigation]);

    const highlightedCount = Number(route.params?.recommendedCount || recommendedCount || 0);

    const renderJobCard = useCallback(({ item, index }) => {
        let contextNote = '';
        let contextTone = 'info';

        if (index === 0) {
            if (showRecommendedFallback) {
                contextTone = 'warning';
                contextNote = 'Strong signals are limited right now. Showing broader nearby opportunities.';
            } else if (showInactiveBanner) {
                contextNote = 'You were inactive for a few days. New roles were queued for you.';
            } else if (showMatchBanner && shouldRenderMatchInsights && highlightedCount > 0) {
                contextNote = `${highlightedCount} matched roles ready now.`;
            }
        }

        return (
            <JobCard
                item={item}
                onPress={handleJobPress}
                onReport={handleReportJob}
                isReported={reportedJobIds.has(item?._id)}
                showMatchInsights={shouldRenderMatchInsights}
                contextNote={contextNote}
                contextTone={contextTone}
            />
        );
    }, [
        highlightedCount,
        handleJobPress,
        handleReportJob,
        reportedJobIds,
        showInactiveBanner,
        showMatchBanner,
        showRecommendedFallback,
        shouldRenderMatchInsights,
    ]);

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <View style={styles.headerTopRow}>
                    <View style={styles.headerTitleWrap}>
                        <Text style={styles.headerEyebrow}>{userRole === 'employer' ? 'Hiring control' : 'Andhra Pradesh jobs'}</Text>
                        <Text style={styles.headerTitle}>{userRole === 'employer' ? 'Your Job Postings' : 'Find Work'}</Text>
                    </View>

                    {!isFindWorkLockedEmpty ? (
                        <TouchableOpacity
                            style={styles.filtersBtn}
                            onPress={handleOpenFilters}
                        >
                            <Text style={styles.filtersBtnText}>Filters</Text>
                            {activeFilterCount > 0 ? (
                                <View style={styles.filtersBadge}>
                                    <Text style={styles.filtersBadgeText}>{activeFilterCount}</Text>
                                </View>
                            ) : null}
                        </TouchableOpacity>
                    ) : null}
                </View>

                {!isFindWorkLockedEmpty ? (
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.filtersRow}
                        contentContainerStyle={styles.filtersRowContent}
                    >
                        {visibleFilters.map((filter) => (
                            <TouchableOpacity
                                key={filter}
                                style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
                                onPress={() => setActiveFilter(filter)}
                                activeOpacity={0.85}
                            >
                                <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>{filter}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                ) : null}

            </View>

            {isLoading && jobs.length === 0 && !isFindWorkLockedEmpty ? (
                <View style={styles.loadingWrap}>
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                </View>
            ) : null}

            <View style={{ flex: 1 }}>
                <Animated.View style={{ flex: 1, opacity: contentOpacity }}>
                    <FlatList
                        ref={listRef}
                        data={filteredJobs}
                        keyExtractor={(item) => String(item?._id || 'job')}
                        renderItem={renderJobCard}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        maxToRenderPerBatch={10}
                        windowSize={10}
                        removeClippedSubviews={Platform.OS === 'android'}
                        initialNumToRender={10}
                        refreshControl={(
                            <RefreshControl
                                refreshing={isRefreshing}
                                onRefresh={handleRefresh}
                                tintColor={theme.textSecondary}
                            />
                        )}
                        ListEmptyComponent={(
                            <EmptyState
                                icon={isFindWorkLockedEmpty ? '📭' : (showRecommendedFallback ? '🔍' : (shouldShowManualBrowseUi ? '🧭' : '💼'))}
                                title={
                                    isFindWorkLockedEmpty
                                        ? 'No jobs yet'
                                        : shouldShowManualBrowseUi
                                            ? 'Set your job area'
                                            : (showRecommendedFallback ? 'No matches yet' : 'No jobs yet')
                                }
                                subtitle={
                                    isFindWorkLockedEmpty
                                        ? 'Opportunities will appear here when listings are ready.'
                                        : shouldShowManualBrowseUi
                                        ? 'Open Filters, type your district first, then mandal. Jobs will appear here right away.'
                                        : showRecommendedFallback
                                        ? 'No matching jobs right now. New opportunities will appear shortly.'
                                        : 'Try adjusting your search or filters.'
                                }
                                actionLabel={
                                    !isFindWorkLockedEmpty && shouldShowManualBrowseUi
                                        ? 'Open Filters'
                                        : (!isFindWorkLockedEmpty && activeFilter !== 'All' ? 'Clear Filters' : null)
                                }
                                onAction={
                                    !isFindWorkLockedEmpty && shouldShowManualBrowseUi
                                        ? handleOpenFilters
                                        : (!isFindWorkLockedEmpty && activeFilter !== 'All'
                                        ? () => {
                                            setActiveFilter('All');
                                            handleClearFilters();
                                        }
                                        : null)
                                }
                            />
                        )}
                    />
                </Animated.View>
            </View>

            <Modal
                visible={filterModalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setFilterModalVisible(false)}
            >
                <View style={styles.filterModalOverlay}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={styles.filterModalKeyboardWrap}
                    >
                    <View style={styles.filterModalSheet}>
                        <View style={styles.filterModalHandle} />
                        <View style={styles.filterModalHeader}>
                            <View style={styles.filterModalTitleWrap}>
                                <Text style={styles.filterModalTitle}>Filters</Text>
                                <Text style={styles.filterModalSubtitle}>
                                    {shouldShowManualBrowseUi
                                        ? 'Type your district and mandal.'
                                        : 'Tune location, salary, and match.'}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.filterModalClose}>
                                <Text style={styles.filterModalCloseText}>X</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="always"
                            keyboardDismissMode="none"
                            contentContainerStyle={styles.filterModalContent}
                        >
                            {shouldShowManualBrowseUi ? (
                                <View style={styles.manualDiscoveryCard}>
                                    <View style={styles.manualDiscoveryDot} />
                                    <View style={styles.manualDiscoveryContent}>
                                        <Text style={styles.manualDiscoveryTitle}>Quick browse</Text>
                                        <Text style={styles.manualDiscoveryText}>Type district first. Add a profile later for full matching.</Text>
                                    </View>
                                </View>
                            ) : null}

                            <View style={styles.filterSummaryCard}>
                                <View style={styles.filterSummaryTopRow}>
                                    <Text style={styles.filterSummaryTitle}>
                                        {shouldShowManualBrowseUi ? 'Quick browse' : (usingRecommendedFeed ? 'Profile matched' : 'Smart browse')}
                                    </Text>
                                    <Text style={styles.filterSummaryCount}>{`${filteredJobs.length} roles`}</Text>
                                </View>
                                <View style={styles.filterSummarySignals}>
                                    <View style={styles.filterSummarySignal}>
                                        <Text style={styles.filterSummarySignalLabel}>District</Text>
                                        <Text style={styles.filterSummarySignalValue}>{appliedDistrict || 'Any'}</Text>
                                    </View>
                                    <View style={styles.filterSummarySignal}>
                                        <Text style={styles.filterSummarySignalLabel}>Radius</Text>
                                        <Text style={styles.filterSummarySignalValue}>{searchRadiusKm > 0 ? `${searchRadiusKm} km` : 'Any'}</Text>
                                    </View>
                                    <View style={styles.filterSummarySignal}>
                                        <Text style={styles.filterSummarySignalLabel}>Salary</Text>
                                        <Text style={styles.filterSummarySignalValue}>{appliedMinSalary > 0 ? `₹${Math.round(appliedMinSalary / 1000)}k+` : 'Any'}</Text>
                                    </View>
                                </View>
                            </View>

                            <Text style={styles.filterLabel}>LOCATION</Text>
                            <Text style={styles.filterHelperText}>District first, then mandal.</Text>

                            <View style={styles.filterFieldCard}>
                                <View style={styles.filterFieldTopRow}>
                                    <Text style={styles.filterFieldLabel}>District</Text>
                                    <View style={styles.filterFieldBadge}>
                                        <Text style={styles.filterFieldBadgeText}>Required</Text>
                                    </View>
                                </View>
                                <TextInput
                                    style={styles.filterInput}
                                    value={districtFilter}
                                    onChangeText={(value) => {
                                        setDistrictFilter(value);
                                        setMandalFilter('');
                                        handleDistrictFocus();
                                    }}
                                    onFocus={handleDistrictFocus}
                                    onBlur={() => scheduleInputBlur('district', setIsDistrictFocused)}
                                    placeholder="Type your district"
                                    placeholderTextColor="#94a3b8"
                                    autoCapitalize="words"
                                    autoCorrect={false}
                                />
                                {isDistrictFocused && districtSuggestions.length ? (
                                    <View style={styles.filterSuggestionList}>
                                        {districtSuggestions.map((district) => (
                                            <TouchableOpacity
                                                key={`district-suggestion-${district}`}
                                                style={styles.filterSuggestionRow}
                                                onPressIn={() => handleSelectDistrictSuggestion(district)}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={styles.filterSuggestionText}>{district}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : null}
                            </View>

                            <View style={styles.filterFieldCard}>
                                <View style={styles.filterFieldTopRow}>
                                    <Text style={styles.filterFieldLabel}>Mandal / city</Text>
                                    <View style={[styles.filterFieldBadge, styles.filterFieldBadgeSoft]}>
                                        <Text style={[styles.filterFieldBadgeText, styles.filterFieldBadgeSoftText]}>Optional</Text>
                                    </View>
                                </View>
                                <TextInput
                                    style={[styles.filterInput, !String(districtFilter || '').trim() && styles.filterInputDisabled]}
                                    value={mandalFilter}
                                    onChangeText={(value) => {
                                        if (!String(districtFilter || '').trim()) return;
                                        setMandalFilter(value);
                                        handleMandalFocus();
                                    }}
                                    onFocus={handleMandalFocus}
                                    onBlur={() => scheduleInputBlur('mandal', setIsMandalFocused)}
                                    placeholder={String(districtFilter || '').trim() ? 'Type your mandal or city' : 'Enter district first'}
                                    placeholderTextColor="#94a3b8"
                                    editable={Boolean(String(districtFilter || '').trim())}
                                    autoCapitalize="words"
                                    autoCorrect={false}
                                />
                                {Boolean(String(districtFilter || '').trim()) && localityQuickHints.length ? (
                                    <View style={styles.localityHintsWrap}>
                                        {localityQuickHints.map((hint) => (
                                            <TouchableOpacity
                                                key={`mandal-hint-${hint}`}
                                                style={styles.localityHintChip}
                                                onPressIn={() => handleSelectMandalSuggestion(hint)}
                                                activeOpacity={0.84}
                                            >
                                                <Text style={styles.localityHintText}>{hint}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : null}
                                {isMandalFocused && mandalSuggestions.length ? (
                                    <View style={styles.filterSuggestionList}>
                                        {mandalSuggestions.map((mandal) => (
                                            <TouchableOpacity
                                                key={`mandal-suggestion-${mandal}`}
                                                style={styles.filterSuggestionRow}
                                                onPressIn={() => handleSelectMandalSuggestion(mandal)}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={styles.filterSuggestionText}>{mandal}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                ) : null}
                            </View>

                            <Text style={styles.filterLabel}>SEARCH RADIUS</Text>
                            <View style={styles.matchOptions}>
                                {FIND_WORK_RADIUS_PRESETS.map((radius) => (
                                    <TouchableOpacity
                                        key={`radius-${radius}`}
                                        style={[
                                            styles.matchOption,
                                            draftSearchRadiusKm === radius && styles.matchOptionActive,
                                        ]}
                                        onPress={() => setDraftSearchRadiusKm(radius)}
                                    >
                                        <Text
                                            style={[
                                                styles.matchOptionText,
                                                draftSearchRadiusKm === radius && styles.matchOptionTextActive,
                                            ]}
                                        >
                                            {radius === 0 ? 'Any' : `${radius}km`}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={styles.filterLabel}>MINIMUM SALARY (INR)</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterQuickRow}>
                                {[0, ...FIND_WORK_SALARY_PRESETS].map((preset) => {
                                    const active = Number(minSalaryFilter || 0) === preset;
                                    return (
                                        <TouchableOpacity
                                            key={preset}
                                            style={[styles.filterQuickChip, active && styles.filterQuickChipActive]}
                                            onPress={() => setMinSalaryFilter(preset > 0 ? String(preset) : '')}
                                            activeOpacity={0.84}
                                        >
                                            <Text style={[styles.filterQuickChipText, active && styles.filterQuickChipTextActive]}>
                                                {preset === 0 ? 'Any' : `₹${Math.round(preset / 1000)}k`}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                            <TextInput
                                style={styles.filterInput}
                                value={minSalaryFilter}
                                onChangeText={setMinSalaryFilter}
                                placeholder="e.g. 25000"
                                placeholderTextColor="#94a3b8"
                                keyboardType="numeric"
                            />

                            {!shouldShowManualBrowseUi ? (
                                <>
                                    <Text style={styles.filterLabel}>MATCH SCORE</Text>
                                    <View style={styles.matchOptions}>
                                        {matchOptions.map((option) => (
                                            <TouchableOpacity
                                                key={option.value}
                                                style={[
                                                    styles.matchOption,
                                                    minMatchFilter === option.value && styles.matchOptionActive,
                                                ]}
                                                onPress={() => setMinMatchFilter(option.value)}
                                            >
                                                <Text
                                                    style={[
                                                        styles.matchOptionText,
                                                        minMatchFilter === option.value && styles.matchOptionTextActive,
                                                    ]}
                                                >
                                                    {option.label}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </>
                            ) : (
                                <View style={styles.matchHintCard}>
                                    <Text style={styles.matchHintTitle}>Match score comes after profile creation</Text>
                                    <Text style={styles.matchHintText}>For now, district, salary, and distance filters keep job discovery useful.</Text>
                                </View>
                            )}
                        </ScrollView>

                        <View style={styles.filterActions}>
                            <TouchableOpacity
                                style={styles.clearBtn}
                                onPress={() => {
                                    handleClearFilters();
                                    setFilterModalVisible(false);
                                }}
                            >
                                <Text style={styles.clearBtnText}>CLEAR</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.applyBtn, !canApplyFilters && styles.applyBtnDisabled]}
                                onPress={handleApplyFilters}
                                disabled={!canApplyFilters}
                            >
                                <Text style={styles.applyBtnText}>APPLY</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            <NudgeToast
                visible={Boolean(nudgeToast)}
                text={nudgeToast?.text}
                actionLabel={nudgeToast?.actionLabel}
                onAction={nudgeToast?.onAction}
                onDismiss={() => setNudgeToast(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f7fb',
    },
    header: {
        ...SCREEN_CHROME.headerSurface,
        paddingHorizontal: 18,
        paddingTop: SPACING.smd + 4,
        paddingBottom: 12,
        zIndex: 10,
        ...SHADOWS.sm,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        gap: 12,
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerEyebrow: {
        fontSize: 11,
        fontWeight: '700',
        color: '#7c8798',
        textTransform: 'uppercase',
        letterSpacing: 1.1,
        marginBottom: 3,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.5,
    },
    filtersBtn: {
        ...SCREEN_CHROME.actionButton,
        alignItems: 'center',
        justifyContent: 'center',
        width: 'auto',
        height: 'auto',
        minWidth: 90,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 18,
        ...SHADOWS.xs,
    },
    filtersBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#334155',
    },
    filtersBadge: {
        position: 'absolute',
        top: -5,
        right: -5,
        backgroundColor: theme.primary,
        width: 18,
        height: 18,
        borderRadius: 9,
        justifyContent: 'center',
        alignItems: 'center',
    },
    filtersBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: '700',
    },
    filtersRow: {
        flexDirection: 'row',
    },
    filtersRowContent: {
        paddingRight: 16,
    },
    findWorkHeroCard: {
        ...SCREEN_CHROME.heroSurface,
        marginTop: 14,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 16,
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    findWorkHeroGlow: {
        position: 'absolute',
        top: -28,
        right: -18,
        width: 118,
        height: 118,
        borderRadius: 59,
        backgroundColor: 'rgba(124,58,237,0.08)',
    },
    findWorkHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    findWorkHeroBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    findWorkHeroBadgeDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
    },
    findWorkHeroBadgeDotManual: {
        backgroundColor: '#f59e0b',
    },
    findWorkHeroBadgeDotLive: {
        backgroundColor: '#7c3aed',
    },
    findWorkHeroBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    findWorkHeroTitle: {
        marginTop: 14,
        fontSize: 22,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.5,
    },
    findWorkHeroSubtitle: {
        marginTop: 5,
        fontSize: 12.5,
        lineHeight: 18,
        fontWeight: '600',
        color: '#64748b',
    },
    findWorkHeroPill: {
        ...SCREEN_CHROME.signalChip,
        paddingHorizontal: 11,
        paddingVertical: 8,
    },
    findWorkHeroPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#475569',
    },
    findWorkHeroStatsRow: {
        flexDirection: 'row',
        flexWrap: 'nowrap',
        gap: 8,
        marginTop: 14,
    },
    findWorkHeroStatCard: {
        ...SCREEN_CHROME.metricTile,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    findWorkHeroStatLabel: {
        fontSize: 10.5,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        color: '#94a3b8',
    },
    findWorkHeroStatValue: {
        marginTop: 6,
        fontSize: 13,
        fontWeight: '800',
        color: '#64748b',
    },
    filterChip: {
        ...SCREEN_CHROME.signalChip,
        backgroundColor: 'rgba(255,255,255,0.92)',
        paddingHorizontal: 14,
        paddingVertical: 9,
        marginRight: 10,
    },
    filterChipActive: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    filterChipText: {
        fontSize: 12.5,
        fontWeight: '700',
        color: '#475569',
    },
    filterChipTextActive: {
        color: '#6d28d9',
        fontWeight: '800',
    },
    loadingWrap: {
        paddingHorizontal: 16,
        paddingTop: 10,
    },
    loadingCard: {
        borderRadius: 22,
        marginBottom: 18,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 18,
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    errorBanner: {
        marginHorizontal: 20,
        marginTop: SPACING.smd,
        marginBottom: 4,
        backgroundColor: '#fff3f4',
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#f4cbd0',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    errorBannerText: {
        flex: 1,
        color: '#9d3e49',
        fontSize: 12,
        fontWeight: '500',
    },
    errorRetryBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: '#fbe4e7',
    },
    errorRetryText: {
        color: '#9d3e49',
        fontWeight: '600',
        fontSize: 11,
    },
    filterModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    filterModalKeyboardWrap: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    filterModalSheet: {
        ...SCREEN_CHROME.heroSurface,
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        paddingHorizontal: 20,
        paddingTop: 20,
        maxHeight: '92%',
    },
    filterModalHandle: {
        width: 54,
        height: 5,
        borderRadius: 999,
        backgroundColor: '#d7dfeb',
        alignSelf: 'center',
        marginBottom: 16,
    },
    filterModalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    filterModalTitleWrap: {
        flex: 1,
        paddingRight: 12,
    },
    filterModalTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0f172a',
    },
    filterModalSubtitle: {
        marginTop: 4,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: '600',
        color: '#64748b',
    },
    filterModalClose: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 12,
        backgroundColor: '#f8fbff',
        borderWidth: 1,
        borderColor: '#dbe3ec',
    },
    filterModalCloseText: {
        fontSize: 18,
        color: '#64748b',
        fontWeight: '700',
    },
    filterModalContent: {
        paddingBottom: 24,
    },
    manualDiscoveryCard: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 13,
        marginBottom: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    manualDiscoveryDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#7c3aed',
    },
    manualDiscoveryContent: {
        flex: 1,
    },
    manualDiscoveryTitle: {
        fontSize: 12.5,
        fontWeight: '800',
        color: '#5b21b6',
    },
    manualDiscoveryText: {
        marginTop: 4,
        fontSize: 11.5,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    filterSummaryCard: {
        ...SCREEN_CHROME.metricTile,
        borderRadius: 22,
        padding: 16,
        marginBottom: 18,
        backgroundColor: '#ffffff',
    },
    filterSummaryTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    filterSummaryTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#5b21b6',
    },
    filterSummaryCount: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
        backgroundColor: '#f5f3ff',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    filterSummarySignals: {
        flexDirection: 'row',
        gap: 10,
    },
    filterSummarySignal: {
        flex: 1,
        borderRadius: 16,
        backgroundColor: '#f8fbff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    filterSummarySignalLabel: {
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        color: '#94a3b8',
        marginBottom: 4,
    },
    filterSummarySignalValue: {
        fontSize: 12.5,
        fontWeight: '800',
        color: '#0f172a',
    },
    filterQuickRow: {
        paddingRight: 8,
        paddingBottom: 10,
    },
    filterQuickChip: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e5eaf2',
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
    },
    filterQuickChipActive: {
        backgroundColor: '#ede9fe',
        borderColor: '#d8ccff',
    },
    filterQuickChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
    },
    filterQuickChipTextActive: {
        color: '#6d28d9',
    },
    filterLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    filterSubLabel: {
        marginTop: -2,
        marginBottom: 8,
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    filterHelperText: {
        marginBottom: 10,
        fontSize: 11,
        lineHeight: 17,
        color: '#64748b',
        fontWeight: '600',
    },
    filterInput: {
        backgroundColor: '#f8fbff',
        borderWidth: 1,
        borderColor: '#dbe3ec',
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 15,
        color: '#0f172a',
        marginBottom: 0,
    },
    filterInputDisabled: {
        opacity: 0.65,
    },
    filterFieldCard: {
        ...SCREEN_CHROME.metricTile,
        flex: 0,
        backgroundColor: '#ffffff',
        borderRadius: 22,
        padding: 14,
        marginBottom: 14,
    },
    filterFieldTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    filterFieldLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
    },
    filterFieldBadge: {
        backgroundColor: '#ede9fe',
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
    },
    filterFieldBadgeText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6d28d9',
    },
    filterFieldBadgeSoft: {
        backgroundColor: '#f1f5f9',
    },
    filterFieldBadgeSoftText: {
        color: '#64748b',
    },
    filterSuggestionList: {
        ...SCREEN_CHROME.contentCard,
        backgroundColor: '#f8fafc',
        borderRadius: 14,
        overflow: 'hidden',
        marginTop: 10,
    },
    filterSuggestionRow: {
        paddingHorizontal: 12,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: '#eef2f7',
    },
    filterSuggestionText: {
        fontSize: 12.5,
        fontWeight: '700',
        color: '#334155',
    },
    localityHintsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },
    localityHintChip: {
        ...SCREEN_CHROME.signalChip,
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    localityHintText: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#475569',
    },
    matchOptions: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 22,
    },
    matchOption: {
        flex: 1,
        paddingVertical: 12,
        backgroundColor: '#f4f7fb',
        borderRadius: RADIUS.md,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#dbe3ec',
    },
    matchOptionActive: {
        backgroundColor: '#e8f0ff',
        borderColor: '#bfd5ff',
    },
    matchOptionText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748b',
    },
    matchOptionTextActive: {
        color: '#1d4ed8',
        fontWeight: '600',
    },
    matchHintCard: {
        backgroundColor: '#f8fafc',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 14,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        marginBottom: 24,
    },
    matchHintTitle: {
        fontSize: 12.5,
        fontWeight: '800',
        color: '#111827',
    },
    matchHintText: {
        marginTop: 4,
        fontSize: 11.5,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    filterActions: {
        flexDirection: 'row',
        gap: 12,
        paddingBottom: 24,
    },
    clearBtn: {
        ...SCREEN_CHROME.actionButton,
        flex: 1,
        width: 'auto',
        height: 'auto',
        paddingVertical: 14,
        borderRadius: 16,
    },
    clearBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748b',
    },
    applyBtn: {
        flex: 2,
        paddingVertical: 14,
        backgroundColor: theme.primary,
        borderRadius: 16,
        alignItems: 'center',
        ...SHADOWS.sm,
    },
    applyBtnDisabled: {
        opacity: 0.45,
    },
    applyBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
    },
});
