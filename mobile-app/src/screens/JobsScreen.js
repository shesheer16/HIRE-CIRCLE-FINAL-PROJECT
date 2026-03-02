import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    FlatList,
    Image,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorageLib from '@react-native-async-storage/async-storage';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import client from '../api/client';
import EmptyState from '../components/EmptyState';
import JobCard from '../components/JobCard';
import SkeletonLoader from '../components/SkeletonLoader';
import NudgeToast from '../components/NudgeToast';
import { DEMO_MODE, FEATURE_MATCH_UI_V1 } from '../config';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import { trackEvent } from '../services/analytics';
import { useAppStore } from '../store/AppStore';
import { logValidationError, validateJobsResponse } from '../utils/apiValidator';
import { logger } from '../utils/logger';
import { AuthContext } from '../context/AuthContext';
import { RADIUS, SHADOWS, SPACING, theme } from '../theme/theme';
import {
    getDisplayScorePercent,
    getNormalizedScore,
    MATCH_TIERS,
    sortRecommendedJobsByTierAndScore,
} from '../utils/matchUi';

const FILTERS = ['All', 'High Match', 'Nearby', 'New'];
const DISMISSED_KEY = '@hire_dismissed_jobs';
const CACHE_KEY = '@cached_jobs';
const FETCH_DEBOUNCE_MS = 250;
const MAX_MATCH_API_CALLS_PER_LOAD = 3;
const DEFAULT_TIER_FILTERS = [MATCH_TIERS.STRONG, MATCH_TIERS.GOOD];
const ALL_TIERS = [MATCH_TIERS.STRONG, MATCH_TIERS.GOOD, MATCH_TIERS.POSSIBLE];

let hasShownMatchBannerThisSession = false;

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

const getReadableError = (error, fallbackMessage) => {
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.message === 'No internet connection') return 'No internet connection. Please check your network and try again.';
    if (error?.message === 'Network Error') return 'Unable to reach the server. Please try again.';
    if (error?.code === 'ECONNABORTED') return 'Request timed out. Please retry.';
    return fallbackMessage;
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

export default function JobsScreen() {
    const navigation = useNavigation();
    const route = useRoute();
    const insets = useSafeAreaInsets();
    const { featureFlags } = useAppStore();
    const { userInfo } = React.useContext(AuthContext);

    const listRef = useRef(null);
    const fetchDebounceRef = useRef(null);
    const matchApiCallsRef = useRef(0);
    const retentionPingRef = useRef({ jobsNear: false, dailyMatch: false });
    const contentOpacity = useRef(new Animated.Value(0.9)).current;

    const [activeFilter, setActiveFilter] = useState('All');
    const [userRole, setUserRole] = useState('candidate');
    const [jobs, setJobs] = useState([]);
    const [savedJobIds, setSavedJobIds] = useState(new Set());
    const [dismissedJobs, setDismissedJobs] = useState([]);
    const [reportedJobIds, setReportedJobIds] = useState(new Set());
    const [isLoading, setIsLoading] = useState(!DEMO_MODE);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const [usingRecommendedFeed, setUsingRecommendedFeed] = useState(false);
    const [showRecommendedFallback, setShowRecommendedFallback] = useState(false);
    const [showMatchBanner, setShowMatchBanner] = useState(false);
    const [recommendedCount, setRecommendedCount] = useState(0);
    const [selectedTierFilters, setSelectedTierFilters] = useState(DEFAULT_TIER_FILTERS);

    const [currentWorkerUserId, setCurrentWorkerUserId] = useState('');
    const [currentWorkerProfileId, setCurrentWorkerProfileId] = useState('');

    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [matchInfoModal, setMatchInfoModal] = useState({ visible: false, title: '', detail: '' });
    const [locationFilter, setLocationFilter] = useState('');
    const [minSalaryFilter, setMinSalaryFilter] = useState('');
    const [minMatchFilter, setMinMatchFilter] = useState(0);

    const [appliedLocation, setAppliedLocation] = useState('');
    const [appliedMinSalary, setAppliedMinSalary] = useState(0);
    const [appliedMinMatch, setAppliedMinMatch] = useState(0);
    const [nudgeToast, setNudgeToast] = useState(null);
    const [showInactiveBanner, setShowInactiveBanner] = useState(false);

    // Map View States
    const [isMapView, setIsMapView] = useState(false);
    const [searchRadiusKm, setSearchRadiusKm] = useState(25);

    const matchOptions = [
        { label: 'All', value: 0 },
        { label: '75%+', value: 75 },
        { label: '90%+', value: 90 },
    ];

    const activeFilterCount = [appliedLocation, appliedMinSalary > 0, appliedMinMatch > 0].filter(Boolean).length;
    const isMatchUiEnabled = featureFlags?.FEATURE_MATCH_UI_V1 ?? FEATURE_MATCH_UI_V1;

    const shouldRenderMatchInsights = isMatchUiEnabled
        && userRole !== 'employer'
        && usingRecommendedFeed
        && !showRecommendedFallback;

    const formatJobRow = useCallback((item, source = 'generic') => {
        const job = item?.job || item || {};
        const normalizedScore = getNormalizedScore(item);
        const fallbackKey = [
            source,
            String(job?.title || 'untitled'),
            String(job?.companyName || 'company'),
            String(job?.location || 'location'),
        ].join('-').replace(/\s+/g, '-').toLowerCase();

        return {
            _id: String(job._id || item?._id || fallbackKey),
            title: String(job.title || 'Untitled Job'),
            companyName: String(job.companyName || 'Looking for Someone'),
            location: String(job.location || 'Remote'),
            salaryRange: String(job.salaryRange || 'Unspecified'),
            matchScore: Math.round(normalizedScore * 100),
            matchProbability: normalizedScore,
            finalScore: normalizedScore,
            tier: String(item?.tier || '').toUpperCase(),
            postedTime: toPostedLabel(job.createdAt),
            createdAtEpoch: toPostedEpoch(job.createdAt),
            requirements: Array.isArray(job.requirements) && job.requirements.length
                ? job.requirements
                : ['Requirements not specified'],
            fitReason: String(item?.whyYouFit || ''),
            explainability: item?.explainability || {},
            matchModelVersionUsed: item?.matchModelVersionUsed || null,
            source,
            urgentHiring: Boolean(job?.urgentHiring || item?.urgentHiring),
            activelyHiring: job?.activelyHiring !== false,
            distanceLabel: formatDistanceLabel(job?.distanceKm ?? item?.distanceKm ?? item?.distance, job?.location),
            hiredCount: Number(
                job?.totalHires
                ?? job?.hiredCount
                ?? job?.stats?.hiredCount
                ?? item?.hiredCount
                ?? 0,
            ),
            responseTimeLabel: String(job?.responseTimeLabel || item?.responseTimeLabel || 'Responds fast'),
            job: job,
        };
    }, []);

    const resolveWorkerContext = useCallback(async () => {
        let userInfo = {};

        try {
            const userInfoString = await SecureStore.getItemAsync('userInfo');
            userInfo = JSON.parse(userInfoString || '{}');
        } catch (error) {
            logger.error('Failed to parse userInfo', error);
        }

        const normalizedRole = String(userInfo?.role || userInfo?.primaryRole || '').toLowerCase();
        const isEmployerRole = normalizedRole === 'employer' || normalizedRole === 'recruiter';
        setUserRole(isEmployerRole ? 'employer' : 'candidate');

        const userId = String(userInfo?._id || '');
        let workerProfileId = String(currentWorkerProfileId || userInfo?.workerProfileId || '');

        if (!workerProfileId && !isEmployerRole) {
            try {
                const { data } = await client.get('/api/users/profile');
                workerProfileId = String(data?.profile?._id || '');
            } catch (error) {
                logger.warn('Worker profile lookup failed, using userId fallback for recommendations.', error?.message || error);
            }
        }

        return {
            userId,
            workerProfileId,
            city: String(userInfo?.acquisitionCity || userInfo?.city || appliedLocation || '').trim(),
            isEmployerRole,
        };
    }, [appliedLocation, currentWorkerProfileId]);

    const fetchGenericJobs = useCallback(async ({ searchRadiusKm }) => {
        const { data } = await client.get('/api/matches/candidate', {
            params: { radiusKm: searchRadiusKm }
        });
        const matches = validateJobsResponse(data);

        return matches
            .map((row) => formatJobRow(row, 'generic'))
            .sort((left, right) => getNormalizedScore(right) - getNormalizedScore(left));
    }, [formatJobRow]);

    const fetchRecommendedJobs = useCallback(async ({ workerId, city, searchRadiusKm }) => {
        if (!workerId) return [];
        if (matchApiCallsRef.current >= MAX_MATCH_API_CALLS_PER_LOAD) {
            logger.warn('Skipping recommended fetch: match API call budget exhausted for this load.');
            return [];
        }

        matchApiCallsRef.current += 1;

        const params = { workerId, preferences: true };
        if (city) params.city = city;
        if (searchRadiusKm) params.radiusKm = searchRadiusKm;

        const { data } = await client.get('/api/jobs/recommended', { params });
        const rows = Array.isArray(data?.recommendedJobs) ? data.recommendedJobs : [];
        const normalized = sortRecommendedJobsByTierAndScore(rows.map((row) => formatJobRow(row, 'recommended')));

        const strongAndGood = normalized.filter((row) => row.tier === MATCH_TIERS.STRONG || row.tier === MATCH_TIERS.GOOD);
        const possible = normalized.filter((row) => row.tier === MATCH_TIERS.POSSIBLE);
        return [...strongAndGood, ...possible].slice(0, 20);
    }, [formatJobRow]);

    const fetchJobs = useCallback(async ({ isRefresh = false } = {}) => {
        if (!DEMO_MODE && !isRefresh) setIsLoading(true);
        setErrorMsg('');
        matchApiCallsRef.current = 0;

        try {
            try {
                const cachedJobs = await AsyncStorageLib.getItem(CACHE_KEY);
                if (cachedJobs) {
                    const parsed = JSON.parse(cachedJobs);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        setJobs(parsed);
                    }
                }
            } catch (cacheReadError) {
                logger.error('Error loading cached jobs', cacheReadError);
            }

            const { userId, workerProfileId, city, isEmployerRole } = await resolveWorkerContext();
            setCurrentWorkerUserId(userId);
            setCurrentWorkerProfileId(workerProfileId);

            const shouldUseMatchUi = isMatchUiEnabled && !isEmployerRole;
            let nextJobs = [];
            let isRecommended = false;

            if (shouldUseMatchUi) {
                try {
                    const recommendedRows = await fetchRecommendedJobs({
                        workerId: workerProfileId || userId,
                        city,
                        searchRadiusKm
                    });
                    if (recommendedRows.length > 0) {
                        nextJobs = recommendedRows;
                        isRecommended = true;
                        setRecommendedCount(recommendedRows.length);

                        if (!retentionPingRef.current.dailyMatch) {
                            retentionPingRef.current.dailyMatch = true;
                            import('../services/NotificationService')
                                .then(({ triggerLocalNotification }) => triggerLocalNotification('daily_match_alert', { count: recommendedRows.length }))
                                .catch(() => { });
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
                } catch (recommendedError) {
                    logger.error('Recommended jobs fetch failed. Falling back to generic listing.', recommendedError);
                }
            }

            if (!nextJobs.length) {
                nextJobs = await fetchGenericJobs({ searchRadiusKm });
            }

            setUsingRecommendedFeed(isRecommended);
            setShowRecommendedFallback(Boolean(shouldUseMatchUi && !isRecommended));
            if (!isRecommended) setRecommendedCount(0);

            setJobs(nextJobs.slice(0, 20));

            try {
                await AsyncStorageLib.setItem(CACHE_KEY, JSON.stringify(nextJobs.slice(0, 20)));
            } catch (cacheWriteError) {
                logger.error('Error saving cached jobs', cacheWriteError);
            }
        } catch (error) {
            if (error?.name === 'ApiValidationError') {
                logValidationError(error, '/api/matches/candidate');
            } else {
                logger.error('Failed to fetch jobs', error);
            }
            setErrorMsg(getReadableError(error, 'Could not load jobs right now. Please try again.'));
        } finally {
            if (isRefresh) {
                setIsRefreshing(false);
            }
            if (!DEMO_MODE && !isRefresh) {
                setIsLoading(false);
            }
        }
    }, [fetchGenericJobs, fetchRecommendedJobs, resolveWorkerContext, route.params?.source]);

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
                        import('../services/NotificationService')
                            .then(({ triggerLocalNotification }) => triggerLocalNotification('jobs_near_you', { city: appliedLocation || undefined }))
                            .catch(() => { });
                    }
                }
            } catch (error) {
                logger.warn('Inactivity nudge check failed', error?.message || error);
            }
        };

        checkInactivity();
        return () => { isMounted = false; };
    }, [appliedLocation, handleRefresh]);

    useEffect(() => {
        if (userRole === 'employer') return;
        if (Boolean(userInfo?.hasCompletedProfile)) return;

        const timeout = setTimeout(() => {
            setNudgeToast({
                text: 'Complete Smart Interview to unlock better matches.',
                actionLabel: 'Start',
                onAction: () => navigation.navigate('SmartInterview'),
            });
        }, 1000);

        return () => clearTimeout(timeout);
    }, [navigation, userInfo?.hasCompletedProfile, userRole]);

    const toggleTierFilter = useCallback((tier) => {
        if (tier === 'ALL') {
            setSelectedTierFilters(ALL_TIERS);
            return;
        }

        setSelectedTierFilters((previous) => {
            const next = new Set(previous);
            if (next.has(tier)) {
                next.delete(tier);
            } else {
                next.add(tier);
            }

            if (next.size === 0) {
                return DEFAULT_TIER_FILTERS;
            }

            return Array.from(next);
        });
    }, []);

    const filteredJobs = useMemo(() => {
        const dayMs = 24 * 60 * 60 * 1000;

        return jobs
            .filter((job) => !dismissedJobs.some((dismissed) => dismissed._id === job._id))
            .filter((job) => {
                if (activeFilter === 'High Match') return getDisplayScorePercent(job) > 80;
                if (activeFilter === 'Nearby') return !String(job?.location || '').toLowerCase().includes('remote');
                if (activeFilter === 'New') {
                    if (!job.createdAtEpoch) return true;
                    return Date.now() - job.createdAtEpoch <= (3 * dayMs);
                }
                return true;
            })
            .filter((job) => !appliedLocation || String(job?.location || '').toLowerCase().includes(appliedLocation.toLowerCase()))
            .filter((job) => !appliedMinSalary || extractSalaryNumber(job?.salaryRange) >= appliedMinSalary)
            .filter((job) => getDisplayScorePercent(job) >= appliedMinMatch)
            .filter((job) => {
                if (!shouldRenderMatchInsights) return true;
                return selectedTierFilters.includes(String(job?.tier || '').toUpperCase());
            });
    }, [
        activeFilter,
        appliedLocation,
        appliedMinMatch,
        appliedMinSalary,
        dismissedJobs,
        jobs,
        selectedTierFilters,
        shouldRenderMatchInsights,
    ]);

    const toggleSaveJob = useCallback((id) => {
        setSavedJobIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

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

    const handleShareJob = useCallback(async (job) => {
        try {
            await Share.share({
                message: `${job?.title || 'Job'} at ${job?.companyName || 'Company'} — ${job?.location || 'Remote'}\nSalary: ${job?.salaryRange || 'Unspecified'}\n\nApply on HireApp`,
                title: job?.title || 'Job Opportunity',
            });
        } catch (error) {
            logger.error('Error sharing job', error);
        }
    }, []);

    const handleApplyFilters = useCallback(() => {
        setAppliedLocation(locationFilter);
        setAppliedMinSalary(minSalaryFilter ? parseInt(minSalaryFilter, 10) : 0);
        setAppliedMinMatch(minMatchFilter);
        setFilterModalVisible(false);
    }, [locationFilter, minMatchFilter, minSalaryFilter]);

    const handleClearFilters = useCallback(() => {
        setLocationFilter('');
        setMinSalaryFilter('');
        setMinMatchFilter(0);
        setAppliedLocation('');
        setAppliedMinSalary(0);
        setAppliedMinMatch(0);
    }, []);

    const handleReasonPress = useCallback((job, reason) => {
        const score = getDisplayScorePercent(job);
        const fallbackDetail = `Match score combines your skills, recent activity, expected salary fit, and location readiness.`;
        trackEvent('MATCH_REASON_CLICKED', {
            workerId: currentWorkerProfileId || currentWorkerUserId,
            jobId: String(job?._id || ''),
            finalScore: Number(getNormalizedScore(job).toFixed(4)),
            tier: String(job?.tier || ''),
            reasonId: String(reason?.id || ''),
            reasonLabel: String(reason?.label || ''),
        });
        setMatchInfoModal({
            visible: true,
            title: `${score}% match confidence`,
            detail: String(reason?.label || fallbackDetail),
        });
    }, [currentWorkerProfileId, currentWorkerUserId]);

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
        });
    }, [currentWorkerProfileId, currentWorkerUserId, navigation]);

    const renderJobCard = useCallback(({ item }) => (
        <JobCard
            item={item}
            onPress={handleJobPress}
            onShare={handleShareJob}
            onToggleSave={toggleSaveJob}
            isSaved={savedJobIds.has(item?._id)}
            onReport={handleReportJob}
            isHistory={false}
            isReported={reportedJobIds.has(item?._id)}
            showMatchInsights={shouldRenderMatchInsights}
            onReasonPress={handleReasonPress}
        />
    ), [
        handleJobPress,
        handleReasonPress,
        handleReportJob,
        handleShareJob,
        reportedJobIds,
        savedJobIds,
        shouldRenderMatchInsights,
        toggleSaveJob,
    ]);

    const bannerCount = Number(route.params?.recommendedCount || recommendedCount || 0);

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <View style={styles.headerTopRow}>
                    <View style={styles.headerTitleWrap}>
                        <Text style={styles.headerTitle}>{userRole === 'employer' ? 'Your Job Postings' : 'Jobs for You'}</Text>
                        <Text style={styles.headerSubtitle}>
                            {userRole === 'employer'
                                ? 'Pipeline visibility and hiring momentum in one place.'
                                : 'Prioritized by match quality, pay, trust, and urgency.'}
                        </Text>
                    </View>

                    {userRole !== 'employer' && (
                        <View style={styles.mapToggleContainer}>
                            <Text style={styles.mapToggleLabel}>Map</Text>
                            <Switch
                                value={isMapView}
                                onValueChange={setIsMapView}
                                trackColor={{ false: '#e2e8f0', true: '#bfdbfe' }}
                                thumbColor={isMapView ? theme.primary : '#94a3b8'}
                                ios_backgroundColor="#e2e8f0"
                            />
                        </View>
                    )}

                    <TouchableOpacity
                        style={styles.filtersBtn}
                        onPress={() => {
                            setLocationFilter(appliedLocation);
                            setMinSalaryFilter(appliedMinSalary > 0 ? String(appliedMinSalary) : '');
                            setMinMatchFilter(appliedMinMatch);
                            setFilterModalVisible(true);
                        }}
                    >
                        <Text style={styles.filtersBtnText}>Filters</Text>
                        {activeFilterCount > 0 ? (
                            <View style={styles.filtersBadge}>
                                <Text style={styles.filtersBadgeText}>{activeFilterCount}</Text>
                            </View>
                        ) : null}
                    </TouchableOpacity>
                </View>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filtersRow}
                    contentContainerStyle={styles.filtersRowContent}
                >
                    {FILTERS.map((filter) => (
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

                {shouldRenderMatchInsights ? (
                    <View style={styles.tierChipsRow}>
                        {ALL_TIERS.map((tier) => (
                            <TouchableOpacity
                                key={tier}
                                style={[
                                    styles.tierChip,
                                    selectedTierFilters.includes(tier) && styles.tierChipActive,
                                ]}
                                onPress={() => toggleTierFilter(tier)}
                                activeOpacity={0.85}
                            >
                                <Text
                                    style={[
                                        styles.tierChipText,
                                        selectedTierFilters.includes(tier) && styles.tierChipTextActive,
                                    ]}
                                >
                                    {tier}
                                </Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            style={[
                                styles.tierChip,
                                selectedTierFilters.length === ALL_TIERS.length && styles.tierChipActive,
                            ]}
                            onPress={() => toggleTierFilter('ALL')}
                            activeOpacity={0.85}
                        >
                            <Text
                                style={[
                                    styles.tierChipText,
                                    selectedTierFilters.length === ALL_TIERS.length && styles.tierChipTextActive,
                                ]}
                            >
                                ALL
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : null}

                {showMatchBanner && shouldRenderMatchInsights ? (
                    <View style={styles.matchBanner}>
                        <Text style={styles.matchBannerTitle}>Refreshed for your profile</Text>
                        <Text style={styles.matchBannerSubtitle}>{bannerCount || recommendedCount || 0} matched roles ready now</Text>
                    </View>
                ) : null}

                {showRecommendedFallback ? (
                    <View style={styles.fallbackBanner}>
                        <Text style={styles.fallbackBannerText}>Strong signals are limited right now. Showing broader nearby opportunities.</Text>
                    </View>
                ) : null}

                {showInactiveBanner ? (
                    <View style={styles.inactiveBanner}>
                        <Text style={styles.inactiveBannerText}>You were inactive for a few days. New roles were queued for you.</Text>
                    </View>
                ) : null}
            </View>

            {isLoading && jobs.length === 0 ? (
                <View style={styles.loadingWrap}>
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                    <SkeletonLoader height={132} style={styles.loadingCard} tone="tint" />
                </View>
            ) : null}

            {errorMsg && filteredJobs.length > 0 ? (
                <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>Couldn’t load data. Pull down to refresh.</Text>
                    <TouchableOpacity onPress={handleRetry} style={styles.errorRetryBtn}>
                        <Text style={styles.errorRetryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : null}

            <View style={{ flex: 1 }}>
                {isMapView ? (
                    <View style={styles.mapContainer}>
                        <MapView
                            provider={PROVIDER_GOOGLE}
                            style={styles.map}
                            initialRegion={{
                                latitude: 20.5937,
                                longitude: 78.9629,
                                latitudeDelta: 15,
                                longitudeDelta: 15,
                            }}
                        >
                            {filteredJobs.map((job) => {
                                const lat = job?.job?.geo?.coordinates?.[1];
                                const lng = job?.job?.geo?.coordinates?.[0];

                                if (!lat || !lng || (lat === 0 && lng === 0)) return null;

                                return (
                                    <Marker
                                        key={`marker-${job._id}`}
                                        coordinate={{ latitude: lat, longitude: lng }}
                                        title={job.title}
                                        description={job.companyName}
                                        pinColor={job.matchScore > 80 ? theme.primary : '#94a3b8'}
                                    />
                                );
                            })}
                        </MapView>
                    </View>
                ) : (
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
                            ListEmptyComponent={
                                errorMsg ? (
                                    <EmptyState
                                        icon="⚠️"
                                        title="Couldn’t load data"
                                        subtitle="Pull down to refresh."
                                        actionLabel="Retry"
                                        onAction={handleRetry}
                                    />
                                ) : (
                                    <EmptyState
                                        icon={showRecommendedFallback ? '🔍' : '💼'}
                                        title={showRecommendedFallback ? 'No matches yet' : 'No jobs yet'}
                                        subtitle={
                                            showRecommendedFallback
                                                ? 'Update your profile to get better matches'
                                                : 'Try adjusting your search or filters.'
                                        }
                                        actionLabel={activeFilter !== 'All' ? 'Clear Filters' : null}
                                        onAction={
                                            activeFilter !== 'All'
                                                ? () => {
                                                    setActiveFilter('All');
                                                    handleClearFilters();
                                                }
                                                : null
                                        }
                                    />
                                )
                            }
                        />
                    </Animated.View>
                )}
            </View>

            <Modal
                visible={filterModalVisible}
                animationType="slide"
                transparent
                onRequestClose={() => setFilterModalVisible(false)}
            >
                <View style={styles.filterModalOverlay}>
                    <View style={styles.filterModalSheet}>
                        <View style={styles.filterModalHeader}>
                            <Text style={styles.filterModalTitle}>Filters</Text>
                            <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.filterModalClose}>
                                <Text style={styles.filterModalCloseText}>X</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.filterModalContent}>

                            <Text style={styles.filterLabel}>SEARCH RADIUS</Text>
                            <View style={styles.matchOptions}>
                                {[10, 25, 50].map((radius) => (
                                    <TouchableOpacity
                                        key={`radius-${radius}`}
                                        style={[
                                            styles.matchOption,
                                            searchRadiusKm === radius && styles.matchOptionActive,
                                        ]}
                                        onPress={() => setSearchRadiusKm(radius)}
                                    >
                                        <Text
                                            style={[
                                                styles.matchOptionText,
                                                searchRadiusKm === radius && styles.matchOptionTextActive,
                                            ]}
                                        >
                                            {radius}km
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <Text style={styles.filterLabel}>LOCATION</Text>
                            <TextInput
                                style={styles.filterInput}
                                value={locationFilter}
                                onChangeText={setLocationFilter}
                                placeholder="Any location"
                                placeholderTextColor="#94a3b8"
                            />

                            <Text style={styles.filterLabel}>MINIMUM SALARY (INR)</Text>
                            <TextInput
                                style={styles.filterInput}
                                value={minSalaryFilter}
                                onChangeText={setMinSalaryFilter}
                                placeholder="e.g. 25000"
                                placeholderTextColor="#94a3b8"
                                keyboardType="numeric"
                            />

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

                            <TouchableOpacity style={styles.applyBtn} onPress={handleApplyFilters}>
                                <Text style={styles.applyBtnText}>APPLY</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <NudgeToast
                visible={Boolean(nudgeToast)}
                text={nudgeToast?.text}
                actionLabel={nudgeToast?.actionLabel}
                onAction={nudgeToast?.onAction}
                onDismiss={() => setNudgeToast(null)}
            />

            <Modal
                visible={matchInfoModal.visible}
                transparent
                animationType="fade"
                onRequestClose={() => setMatchInfoModal({ visible: false, title: '', detail: '' })}
            >
                <View style={styles.matchInfoOverlay}>
                    <View style={styles.matchInfoCard}>
                        <Text style={styles.matchInfoTitle}>{matchInfoModal.title || 'Match details'}</Text>
                        <Text style={styles.matchInfoText}>{matchInfoModal.detail || 'Match scoring detail unavailable right now.'}</Text>
                        <TouchableOpacity
                            style={styles.matchInfoBtn}
                            onPress={() => setMatchInfoModal({ visible: false, title: '', detail: '' })}
                        >
                            <Text style={styles.matchInfoBtnText}>Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    header: {
        backgroundColor: 'rgba(255,255,255,0.98)',
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.smd + 2,
        paddingBottom: SPACING.smd,
        borderBottomWidth: 1,
        borderBottomColor: '#edf1f7',
        zIndex: 10,
        ...SHADOWS.sm,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 10,
        gap: 12,
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: theme.textPrimary,
        letterSpacing: -0.2,
    },
    headerSubtitle: {
        marginTop: 2,
        fontSize: 14,
        color: '#64748b',
        fontWeight: '400',
    },
    filtersBtn: {
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 76,
        backgroundColor: 'rgba(255,255,255,0.92)',
        paddingHorizontal: SPACING.smd,
        paddingVertical: SPACING.sm,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#e6ebf4',
    },
    filtersBtnText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#334155',
    },
    filtersBadge: {
        position: 'absolute',
        top: -6,
        right: -6,
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
    filterChip: {
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderRadius: RADIUS.full,
        paddingHorizontal: SPACING.smd + 2,
        paddingVertical: SPACING.xs + 3,
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#e8edf4',
    },
    filterChipActive: {
        backgroundColor: '#eef3ff',
        borderColor: '#d7e1f0',
    },
    filterChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#334155',
    },
    filterChipTextActive: {
        color: '#1f2937',
        fontWeight: '600',
    },
    tierChipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },
    tierChip: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#d1dbe7',
        paddingHorizontal: SPACING.smd,
        paddingVertical: SPACING.xs + 2,
        backgroundColor: '#f8fafd',
    },
    tierChipActive: {
        borderColor: '#1d4ed8',
        backgroundColor: '#e8f0ff',
    },
    tierChipText: {
        fontSize: 12,
        color: '#475569',
        fontWeight: '500',
    },
    tierChipTextActive: {
        color: '#1d4ed8',
        fontWeight: '600',
    },
    matchBanner: {
        marginTop: SPACING.smd,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#d9e7ff',
        backgroundColor: '#f4f8ff',
        padding: SPACING.smd + 1,
    },
    matchBannerTitle: {
        color: '#1e3a8a',
        fontSize: 14,
        fontWeight: '600',
    },
    matchBannerSubtitle: {
        marginTop: 4,
        color: '#1d4ed8',
        fontSize: 13,
        fontWeight: '500',
    },
    fallbackBanner: {
        marginTop: SPACING.smd,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#f6deb0',
        backgroundColor: '#fff9ee',
        padding: SPACING.smd,
    },
    fallbackBannerText: {
        color: '#9a6a14',
        fontSize: 12,
        fontWeight: '500',
    },
    inactiveBanner: {
        marginTop: 10,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        padding: SPACING.smd,
    },
    inactiveBannerText: {
        color: '#1e40af',
        fontSize: 12,
        fontWeight: '600',
    },
    loadingWrap: {
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.smd,
    },
    loadingCard: {
        borderRadius: RADIUS.lg,
        marginBottom: 20,
    },
    listContent: {
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.smd,
        paddingBottom: 40,
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
    filterModalSheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: RADIUS.xxl,
        borderTopRightRadius: RADIUS.xxl,
        paddingHorizontal: 20,
        paddingTop: 20,
        maxHeight: '75%',
    },
    filterModalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    filterModalTitle: {
        fontSize: 24,
        fontWeight: '600',
        color: '#0f172a',
    },
    filterModalClose: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.md,
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
    filterLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 8,
    },
    filterInput: {
        backgroundColor: '#f8fbff',
        borderWidth: 1,
        borderColor: '#dbe3ec',
        borderRadius: RADIUS.md,
        paddingHorizontal: 16,
        paddingVertical: 13,
        fontSize: 15,
        color: '#0f172a',
        marginBottom: 20,
    },
    matchOptions: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 24,
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
    filterActions: {
        flexDirection: 'row',
        gap: 12,
        paddingBottom: 24,
    },
    clearBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#f4f7fb',
        borderRadius: RADIUS.md,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#dbe3ec',
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
        borderRadius: RADIUS.md,
        alignItems: 'center',
    },
    applyBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
    },
    matchInfoOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.42)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    matchInfoCard: {
        width: '100%',
        maxWidth: 360,
        borderRadius: RADIUS.lg,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#dbe3ec',
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    matchInfoTitle: {
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '800',
        marginBottom: 8,
    },
    matchInfoText: {
        color: '#475569',
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '500',
    },
    matchInfoBtn: {
        alignSelf: 'flex-end',
        marginTop: 14,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#cfe0ff',
        backgroundColor: '#eef4ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    matchInfoBtnText: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '800',
    },
    mapToggleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
        paddingHorizontal: 8,
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#e6ebf4',
    },
    mapToggleLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#334155',
        marginRight: 6,
    },
    mapContainer: {
        flex: 1,
        borderRadius: RADIUS.md,
        overflow: 'hidden',
        margin: SPACING.md,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        ...SHADOWS.sm,
    },
    map: {
        width: '100%',
        height: '100%',
    },
});
