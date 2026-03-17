import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Alert, ActivityIndicator, Dimensions, Image, Animated, Easing, Share
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';
import { IconSparkles, IconMapPin, IconGlobe, IconMessageSquare } from '../components/Icons';
import FeatureLockOverlay from '../components/FeatureLockOverlay';
import { useAppState } from '../context/AppStateContext';
import { triggerHaptic } from '../utils/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { trackEvent } from '../services/analytics';
import { FEATURE_MATCH_UI_V1 } from '../config';
import { useAppStore } from '../store/AppStore';
import {
    buildFreshnessSignals,
    buildMatchGaps,
    buildMatchReasons,
    formatRelativeTimeLabel,
    getMatchScoreSourceMeta,
} from '../utils/matchUi';
import { resolveStructuredLocation } from '../utils/locationPresentation';
import { PALETTE } from '../theme/theme';

const { width } = Dimensions.get('window');

const buildSimilarJobs = (job) => {
    const related = Array.isArray(job?.relatedJobs) ? job.relatedJobs : [];
    if (related.length > 0) {
        return related.slice(0, 4).map((item, index) => ({
            id: String(item?._id || item?.id || `related-${index}`),
            title: String(item?.title || 'Related role'),
            company: String(item?.companyName || job?.companyName || 'Hiring company'),
            location: String(item?.location || 'Location not listed'),
            salary: String(item?.salaryRange || 'Salary not listed'),
        }));
    }
    return [];
};

const FUNNEL_DATA = [
    { name: 'Applied', value: 45, color: '#94a3b8' },
    { name: 'Shortlisted', value: 12, color: '#2563eb' },
    { name: 'Interview', value: 5, color: '#1d4ed8' },
    { name: 'Offer', value: 2, color: '#0f9d67' },
];
const MAX_FUNNEL_VALUE = Math.max(...FUNNEL_DATA.map(item => item.value), 1);

const clamp01 = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(1, numeric));
};

const toProbabilityRatio = (value) => {
    const normalized = typeof value === 'string'
        ? value.replace(/[%\s,]/g, '')
        : value;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return null;
    if (numeric <= 1) return clamp01(numeric);
    if (numeric <= 100) return clamp01(numeric / 100);
    return clamp01(numeric);
};

const normalizeImpactToScore = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric >= 0 && numeric <= 1) return numeric;
    return clamp01(1 / (1 + Math.exp(-(numeric * 4))));
};

const tierFromProbability = (probability) => {
    const score = clamp01(probability);
    if (score >= 0.85) return 'STRONG';
    if (score >= 0.7) return 'GOOD';
    if (score >= 0.62) return 'POSSIBLE';
    return 'REJECT';
};

const extractApiErrorMessage = (error) => (
    error?.response?.data?.message
    || error?.response?.data?.error?.message
    || error?.originalError?.response?.data?.message
    || error?.originalError?.response?.data?.error?.message
    || error?.message
    || 'Failed to submit application.'
);

const resolveJobId = (job = {}) => {
    const candidates = [
        job?._id,
        job?.id,
        job?.jobId,
        job?.job?._id,
        job?.job?.id,
    ];
    for (const candidate of candidates) {
        const normalized = String(candidate || '').trim();
        if (normalized) {
            return normalized;
        }
    }
    return '';
};

const resolveCompanyImage = (job = {}) => String(
    job?.companyLogoUrl
    || job?.logoUrl
    || job?.companyBrandPhoto
    || job?.employerProfile?.logoUrl
    || job?.bannerImage
    || job?.bannerUrl
    || ''
).trim();

const resolveOpenings = (job = {}) => {
    const directValue = Number(job?.openings);
    if (Number.isFinite(directValue) && directValue > 0) {
        return Math.max(1, Math.round(directValue));
    }

    const requirements = Array.isArray(job?.requirements) ? job.requirements : [];
    for (const requirement of requirements) {
        const match = String(requirement || '').match(/openings?\s*:\s*(\d+)/i);
        if (match) {
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed) && parsed > 0) {
                return Math.max(1, Math.round(parsed));
            }
        }
    }

    return null;
};

const resolveSecondaryStat = (job = {}) => {
    const explicitType = String(job?.type || job?.employmentType || job?.jobType || '').trim();
    if (explicitType) {
        return { label: 'TYPE', value: explicitType };
    }

    const shift = String(job?.shift || '').trim();
    if (shift) {
        return { label: 'SHIFT', value: `${shift} Shift` };
    }

    if (typeof job?.remoteAllowed === 'boolean') {
        return { label: 'MODE', value: job.remoteAllowed ? 'Remote' : 'On-site' };
    }

    return { label: 'STATUS', value: job?.activelyHiring === false ? 'Paused' : 'Hiring now' };
};

export default function JobDetailsScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const {
        job,
        matchScore,
        fitReason,
        workerIdForMatch,
        finalScore: routeFinalScore,
        tier: routeTier,
        explainability: routeExplainability,
        entrySource,
    } = route.params || {};
    const routeJobId = resolveJobId(job || {});
    const [applying, setApplying] = useState(false);
    const [applied, setApplied] = useState(false);
    const [liveJob, setLiveJob] = useState(job || null);

    const [isSaved, setIsSaved] = useState(false);
    const [loadingAI, setLoadingAI] = useState(false);
    const [explanation, setExplanation] = useState(null);
    const [viewerRole, setViewerRole] = useState('employee');
    const [resolvedWorkerId, setResolvedWorkerId] = useState(String(workerIdForMatch || ''));
    const [loadingMatchInsights, setLoadingMatchInsights] = useState(false);
    const [matchProbability, setMatchProbability] = useState(null);
    const [matchTier, setMatchTier] = useState(String(routeTier || '').toUpperCase() || null);
    const [probabilityExplainability, setProbabilityExplainability] = useState(routeExplainability || {});
    const [matchModelVersionUsed, setMatchModelVersionUsed] = useState(null);
    const [matchScoreSource, setMatchScoreSource] = useState(String(job?.matchScoreSource || '').trim());
    const [probabilisticFallbackUsed, setProbabilisticFallbackUsed] = useState(Boolean(job?.probabilisticFallbackUsed || job?.fallbackUsed));
    const [scoreTimeline, setScoreTimeline] = useState(job?.timelineTransparency || null);
    const [subscriptionPlan, setSubscriptionPlan] = useState('free');
    const applyScale = useRef(new Animated.Value(1)).current;
    const successBurstOpacity = useRef(new Animated.Value(0)).current;
    const { dispatch } = useAppState();
    const featureFlags = useAppStore(state => state.featureFlags);
    const appRole = useAppStore(state => state.role);
    const isMatchUiEnabled = featureFlags?.FEATURE_MATCH_UI_V1 ?? FEATURE_MATCH_UI_V1;
    const isEmployer = viewerRole === 'employer';
    const resolveWorkerApplicationIdentity = async (seedUserInfo = null) => {
        const safeUserInfo = (seedUserInfo && typeof seedUserInfo === 'object') ? seedUserInfo : {};
        let workerId = String(
            workerIdForMatch
            || safeUserInfo?.workerProfileId
            || resolvedWorkerId
            || ''
        ).trim();

        if (!workerId) {
            workerId = String(await AsyncStorage.getItem('@worker_profile_id') || '').trim();
        }

        if (!workerId) {
            try {
                const { data } = await client.get('/api/users/profile', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    timeout: 4500,
                    params: { role: 'worker' },
                });
                workerId = String(data?.profile?._id || '').trim();
                if (workerId) {
                    await AsyncStorage.setItem('@worker_profile_id', workerId);
                }
            } catch (profileError) {
                logger.warn('Worker profile lookup failed in JobDetails apply flow', profileError?.message || profileError);
            }
        }

        return workerId || String(safeUserInfo?._id || '').trim();
    };

    useEffect(() => {
        setLiveJob(job || null);
    }, [job]);

    useEffect(() => {
        let isMounted = true;

        const hydrateLatestJob = async () => {
            if (!routeJobId) return;
            try {
                const { data } = await client.get(`/api/jobs/${routeJobId}`, {
                    __skipApiErrorHandler: true,
                    __disableBaseFallback: true,
                    __maxRetries: 0,
                    timeout: 6000,
                });
                const latestJob = data?.data || null;
                if (!isMounted || !latestJob || typeof latestJob !== 'object') return;
                setLiveJob((prev) => ({ ...(prev || {}), ...latestJob }));
            } catch (_error) {
                // Keep route data when a refresh is unavailable.
            }
        };

        hydrateLatestJob();
        return () => {
            isMounted = false;
        };
    }, [routeJobId]);

    // Safely handle missing params
    const safeJob = liveJob || job || {
        title: 'Open Position',
        companyName: 'Hiring Company',
        location: 'Location to be shared',
        salaryRange: 'Salary to be discussed',
        type: '',
        requirements: ['Role requirements shared after apply'],
        description: 'The employer will share complete role details once your application is shortlisted.',
    };
    const structuredLocation = resolveStructuredLocation(safeJob);
    const resolvedLocationLabel = structuredLocation.locationLabel || safeJob.location || 'Location to be shared';
    const safeJobId = resolveJobId(safeJob);
    const routeMatchProbability = toProbabilityRatio(routeFinalScore)
        ?? toProbabilityRatio(matchScore)
        ?? toProbabilityRatio(job?.matchProbability)
        ?? toProbabilityRatio(job?.finalScore)
        ?? toProbabilityRatio(job?.matchScore)
        ?? null;
    const safeMatchScore = Number.isFinite(Number(matchScore)) ? Number(matchScore) : Math.round((routeMatchProbability || 0) * 100);
    const safeFitReason = fitReason || `This role overlaps with the core signals in your profile.`;
    const fallbackProbability = routeMatchProbability ?? 0;

    useEffect(() => {
        let isMounted = true;

        const hydrateContext = async () => {
            try {
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                const userInfo = JSON.parse(userInfoStr || '{}');
                const normalizedRole = String(
                    appRole
                    || userInfo?.activeRole
                    || userInfo?.primaryRole
                    || userInfo?.role
                    || ''
                ).toLowerCase();
                const forceWorkerView = String(entrySource || '').toLowerCase() === 'jobs_tab';

                if (!isMounted) return;
                setViewerRole(forceWorkerView ? 'employee' : (normalizedRole === 'employer' ? 'employer' : 'employee'));

                if (!isMatchUiEnabled || (!forceWorkerView && normalizedRole === 'employer')) {
                    return;
                }

                const workerId = await resolveWorkerApplicationIdentity(userInfo);

                if (isMounted) {
                    setResolvedWorkerId(workerId);
                }
            } catch (error) {
                logger.error('Failed to hydrate JobDetails context', error);
            }
        };

        hydrateContext();
        return () => { isMounted = false; };
    }, [appRole, entrySource, isMatchUiEnabled, resolvedWorkerId, workerIdForMatch]);

    useEffect(() => {
        let active = true;
        const hydratePlan = async () => {
            try {
                const storedPlan = await AsyncStorage.getItem('@hc_subscription_plan');
                if (active && storedPlan) {
                    setSubscriptionPlan(storedPlan);
                }
            } catch (error) {
                // Local preference only.
            }
        };

        hydratePlan();
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!isMatchUiEnabled || isEmployer) {
            return;
        }

        const jobId = safeJobId;
        if (!jobId || !resolvedWorkerId) {
            return;
        }

        let isMounted = true;
        const fetchProbability = async () => {
            setLoadingMatchInsights(true);

            try {
                const { data } = await client.get('/api/matches/probability', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    params: {
                        workerId: resolvedWorkerId,
                        jobId,
                    },
                });

                if (!isMounted) return;

                const fetchedProbability = toProbabilityRatio(data?.matchProbability);
                let normalizedProbability = fetchedProbability !== null
                    ? fetchedProbability
                    : fallbackProbability;
                if (normalizedProbability <= 0 && fallbackProbability > 0) {
                    normalizedProbability = fallbackProbability;
                }
                const resolvedTier = tierFromProbability(normalizedProbability);

                setMatchProbability(normalizedProbability);
                setMatchTier(resolvedTier);
                setProbabilityExplainability(data?.explainability || {});
                setMatchModelVersionUsed(data?.matchModelVersionUsed || null);
                setMatchScoreSource(String(data?.matchScoreSource || '').trim());
                setProbabilisticFallbackUsed(Boolean(data?.probabilisticFallbackUsed || data?.fallbackUsed));
                setScoreTimeline(data?.timelineTransparency || null);

                trackEvent('MATCH_DETAIL_VIEWED', {
                    workerId: resolvedWorkerId,
                    jobId,
                    finalScore: Number(normalizedProbability.toFixed(4)),
                    tier: resolvedTier,
                });
            } catch (error) {
                logger.warn('Failed to fetch match probability for JobDetails', error?.message || error);
                if (!isMounted) return;

                const resolvedTier = tierFromProbability(fallbackProbability);
                setMatchProbability(fallbackProbability);
                setMatchTier(resolvedTier);
                setProbabilityExplainability(routeExplainability || {});
                setMatchScoreSource(String(job?.matchScoreSource || '').trim());
                setProbabilisticFallbackUsed(Boolean(job?.probabilisticFallbackUsed || job?.fallbackUsed));
                setScoreTimeline(job?.timelineTransparency || null);

                trackEvent('MATCH_DETAIL_VIEWED', {
                    workerId: resolvedWorkerId,
                    jobId,
                    finalScore: Number(fallbackProbability.toFixed(4)),
                    tier: resolvedTier,
                });
            } finally {
                if (isMounted) {
                    setLoadingMatchInsights(false);
                }
            }
        };

        fetchProbability();
        return () => { isMounted = false; };
    }, [fallbackProbability, isEmployer, isMatchUiEnabled, resolvedWorkerId, routeExplainability, safeJobId]);

    useEffect(() => {
        let isMounted = true;
        const hydrateAppliedState = async () => {
            if (isEmployer || !safeJobId) return;
            try {
                const { data } = await client.get('/api/applications', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    params: { limit: 100 },
                });
                const list = Array.isArray(data)
                    ? data
                    : (Array.isArray(data?.data) ? data.data : []);
                const alreadyApplied = list.some((item) => {
                    const appliedJobId = String(item?.job?._id || item?.job || item?.jobId || '').trim();
                    return appliedJobId && appliedJobId === safeJobId;
                });
                if (isMounted && alreadyApplied) {
                    setApplied(true);
                }
            } catch (error) {
                logger.warn('Failed to hydrate apply state in JobDetails', error?.message || error);
            }
        };

        hydrateAppliedState();
        return () => { isMounted = false; };
    }, [isEmployer, safeJobId]);

    const handleApply = async () => {
        if (applied) {
            Alert.alert('Already applied', 'You already applied for this job.');
            return;
        }

        setApplying(true);
        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const userInfo = JSON.parse(userInfoStr || '{}');
            const workerId = await resolveWorkerApplicationIdentity(userInfo);
            const jobId = safeJobId;

            if (!jobId || !workerId) {
                setApplying(false);
                Alert.alert('Error', 'Missing job or profile identity. Please reopen this job and retry.');
                return;
            }

            const { data } = await client.post('/api/applications', {
                jobId,
                workerId,
                initiatedBy: 'worker' // As per backend requirement
            }, {
                __allowWhenCircuitOpen: true,
                __skipApiErrorHandler: true,
            });

            // Update global state immediately
            if (data?.application) {
                dispatch({
                    type: 'ADD_APPLICATION',
                    payload: data.application
                });
            } else if (data) {
                dispatch({
                    type: 'ADD_APPLICATION',
                    payload: data
                });
            }

            // Trigger refresh for employer view
            dispatch({
                type: 'MARK_REFRESH_NEEDED',
                payload: { screen: 'applications' }
            });

            triggerHaptic.success();
            const jobAppliedPayload = {
                jobId: String(safeJob._id || safeJob.id || ''),
                title: safeJob.title || '',
                companyName: safeJob.companyName || '',
                source: 'job_details',
            };
            trackEvent('JOB_APPLIED', jobAppliedPayload);
            setApplying(false);
            setApplied(true);
            Animated.sequence([
                Animated.timing(applyScale, {
                    toValue: 1.05,
                    duration: 140,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.spring(applyScale, {
                    toValue: 1,
                    stiffness: 190,
                    damping: 13,
                    mass: 0.8,
                    useNativeDriver: true,
                }),
            ]).start();
            Animated.sequence([
                Animated.timing(successBurstOpacity, { toValue: 1, duration: 160, useNativeDriver: true }),
                Animated.delay(520),
                Animated.timing(successBurstOpacity, { toValue: 0, duration: 240, useNativeDriver: true }),
            ]).start();
            Alert.alert(
                '🎉 Application Sent!',
                `You applied to ${safeJob.title} at ${safeJob.companyName}.`,
                [
                    { text: 'View Applications', onPress: () => navigation.navigate('MainTab', { screen: 'Applications' }) },
                    { text: 'Stay Here', style: 'cancel' },
                ]
            );
        } catch (error) {
            const errorMsg = extractApiErrorMessage(error);
            const normalizedMessage = String(errorMsg || '').toLowerCase();
            if (normalizedMessage.includes('application already exists') || normalizedMessage.includes('already applied')) {
                setApplying(false);
                setApplied(true);
                Alert.alert('Already applied', 'You already applied for this job.');
                return;
            }
            setApplying(false);
            Alert.alert('Error', errorMsg);
        }
    };

    const handleExplain = async () => {
        setLoadingAI(true);
        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const userInfo = JSON.parse(userInfoStr || '{}');
            const candidateId = userInfo._id;
            const jobId = safeJob._id || safeJob.id;
            const cacheKey = `@explain_${jobId}_${candidateId}`;

            // Try Cache
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) {
                setExplanation(JSON.parse(cached));
                setLoadingAI(false);
                return;
            }

            // Fetch Fresh
            const { data } = await client.post('/api/matches/explain', {
                jobId,
                candidateId,
                matchScore: safeMatchScore
            });

            if (data && data.explanation) {
                setExplanation(data.explanation);
                AsyncStorage.setItem(cacheKey, JSON.stringify(data.explanation)).catch(logger.error);
            }
        } catch (error) {
            logger.error('Explanation Error:', error);
            setExplanation(["You are a strong match for this position.", "Your skills align well with the core requirements.", "Good location fit."]); // Fallback
        } finally {
            setLoadingAI(false);
        }
    };

    const displayProbability = isMatchUiEnabled
        ? clamp01(matchProbability ?? fallbackProbability)
        : clamp01(safeMatchScore / 100);
    const displayMatchPercent = Math.round(displayProbability * 100);
    const effectiveTier = isMatchUiEnabled
        ? (matchTier || tierFromProbability(displayProbability))
        : (String(routeTier || '').toUpperCase() || tierFromProbability(displayProbability));
    const hasRealMatchScore = displayProbability > 0;

    const resolvedExplainability = isMatchUiEnabled
        ? (probabilityExplainability || {})
        : (routeExplainability || {});
    const skillFitPercent = Math.round(normalizeImpactToScore(resolvedExplainability?.skillImpact ?? resolvedExplainability?.skillScore) * 100);
    const experienceFitPercent = Math.round(normalizeImpactToScore(resolvedExplainability?.experienceImpact ?? resolvedExplainability?.experienceScore) * 100);
    const salaryFitPercent = Math.round(normalizeImpactToScore(resolvedExplainability?.salaryImpact ?? resolvedExplainability?.salaryScore) * 100);
    const distanceFitPercent = Math.round(normalizeImpactToScore(resolvedExplainability?.distanceImpact ?? resolvedExplainability?.distanceScore) * 100);

    const showLowMatchNudge = isMatchUiEnabled && displayProbability < 0.62;
    const showStrongMatchEncouragement = isMatchUiEnabled && effectiveTier === 'STRONG';
    const isPremiumPlan = subscriptionPlan !== 'free';
    const tierAccentColor = showStrongMatchEncouragement
        ? '#0f9d67'
        : (showLowMatchNudge ? '#c68a1c' : '#1d4ed8');
    const breakdownRows = [
        { label: 'Skill Match', value: skillFitPercent },
        { label: 'Experience Fit', value: experienceFitPercent },
        { label: 'Salary Alignment', value: salaryFitPercent },
        { label: 'Distance', value: distanceFitPercent },
    ];
    const similarJobs = buildSimilarJobs(safeJob);
    const secondaryStat = resolveSecondaryStat(safeJob);
    const openingsCount = resolveOpenings(safeJob);
    const companyImageUri = resolveCompanyImage(safeJob)
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(String(safeJob?.companyName || 'Company'))}&background=7c3aed&color=fff&size=512`;
    const employerTrust = {
        verified: Boolean(safeJob?.verifiedCompany || safeJob?.trustedCompany || safeJob?.trustBadge),
        responseTime: String(safeJob?.responseTimeLabel || safeJob?.employer?.responseTimeLabel || 'Responds fast'),
        totalHires: Number(safeJob?.totalHires || safeJob?.hiredCount || safeJob?.companyHires || 0),
        rating: Number(safeJob?.employerRating || safeJob?.rating || safeJob?.employer?.rating || 0),
    };
    const matchedSkills = Array.isArray(safeJob?.requirements) ? safeJob.requirements.slice(0, 8) : [];
    const distanceContextKm = Number.isFinite(Number(safeJob?.distanceKm))
        ? Number(safeJob.distanceKm)
        : Number(resolvedExplainability?.apRegional?.distanceKm || safeJob?.job?.distanceKm || 0);
    const fallbackMatchReasons = buildMatchReasons({
        explainability: resolvedExplainability,
        distanceKm: distanceContextKm,
        max: 3,
    }).map((item) => item.label);
    const matchGapBullets = buildMatchGaps({
        explainability: resolvedExplainability,
        distanceKm: distanceContextKm,
        max: 3,
    }).map((item) => item.label);
    const whyMatchBullets = Array.isArray(explanation) && explanation.length
        ? explanation.slice(0, 3)
        : (Array.isArray(resolvedExplainability?.topReasons) && resolvedExplainability.topReasons.length
            ? resolvedExplainability.topReasons.slice(0, 3)
            : (fallbackMatchReasons.length ? fallbackMatchReasons : [safeFitReason]));
    const scoreSourceMeta = getMatchScoreSourceMeta({
        matchScoreSource,
        matchModelVersionUsed,
        probabilisticFallbackUsed,
    });
    const confidencePercent = Math.round(clamp01(resolvedExplainability?.confidenceScore || 0) * 100);
    const freshnessSignals = buildFreshnessSignals({
        ...safeJob,
        openings: openingsCount ?? safeJob?.openings,
        responseTimeLabel: employerTrust.responseTime,
        activelyHiring: safeJob?.activelyHiring !== false,
        timelineTransparency: scoreTimeline || safeJob?.timelineTransparency || null,
    });
    const lastActiveLabel = formatRelativeTimeLabel(
        scoreTimeline?.workerLastActiveAt,
        { prefix: 'Active', fallback: '' }
    );

    const handleShareJob = async () => {
        try {
            await Share.share({
                title: safeJob?.title || 'Job Opportunity',
                message: `${safeJob?.title || 'Job'} at ${safeJob?.companyName || 'Company'}\n${resolvedLocationLabel}\nSalary: ${safeJob?.salaryRange || 'Not listed'}`,
            });
        } catch (_error) {
            Alert.alert('Share failed', 'Could not open share sheet right now.');
        }
    };

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} bounces={false}>
                    <View style={styles.topHeader}>
                        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTab', { screen: 'Jobs' })}>
                            <Text style={styles.backBtnIcon}>‹</Text>
                        </TouchableOpacity>
                        <View style={styles.headerRightActions}>
                            <TouchableOpacity style={styles.actionIconBtn} onPress={handleShareJob}>
                                <Text style={styles.actionIconText}>↑</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconBtn} onPress={() => setIsSaved(s => !s)}>
                                <Text style={styles.actionIconText}>{isSaved ? '★' : '☆'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Profile Header */}
                    <View style={styles.profileHeader}>
                        <View style={styles.logoContainer}>
                            <Image source={{ uri: companyImageUri }} style={styles.logoImage} />
                            {!isEmployer && hasRealMatchScore && (
                                <View style={styles.matchBadgeFloating}>
                                    <Text style={styles.matchBadgeText}>{displayMatchPercent}% FIT</Text>
                                </View>
                            )}
                        </View>
                        
                        <Text style={styles.companyTitle}>{safeJob.companyName}</Text>
                        <Text style={styles.jobTitleMain}>{safeJob.title}</Text>
                        
                        <View style={styles.metaRowCentered}>
                            <Text style={styles.metaText}>{resolvedLocationLabel}</Text>
                            <Text style={styles.metaDot}>•</Text>
                            <Text style={styles.metaTextAccent}>{safeJob.salaryRange}</Text>
                        </View>

                        <View style={styles.heroBadgeRow}>
                            {safeJob?.urgentHiring && (
                                <View style={[styles.heroBadge, styles.heroBadgeUrgent]}>
                                    <Text style={styles.heroBadgeTextUrgent}>Urgent</Text>
                                </View>
                            )}
                            {safeJob?.activelyHiring !== false && (
                                <View style={[styles.heroBadge, styles.heroBadgeActive]}>
                                    <Text style={styles.heroBadgeTextActive}>Actively Hiring</Text>
                                </View>
                            )}
                            {openingsCount ? (
                                <View style={styles.heroBadge}>
                                    <Text style={styles.heroBadgeText}>{openingsCount} Openings</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>

                    <View style={styles.divider} />
                    {/* Stats Grip */}
                    <View style={styles.statsGrid}>
                        <View style={styles.statBox}>
                            <Text style={styles.statBoxLabel}>Experience</Text>
                            <Text style={styles.statBoxValue}>{secondaryStat.value}</Text>
                        </View>
                        {!isEmployer ? (
                            <View style={styles.statBox}>
                                <Text style={styles.statBoxLabel}>Response</Text>
                                <Text style={styles.statBoxValue}>{employerTrust.responseTime}</Text>
                            </View>
                        ) : null}
                    </View>

                    {!isEmployer && matchedSkills.length > 0 ? (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Matched Skills</Text>
                            <View style={styles.tagsRow}>
                                {matchedSkills.map((req, i) => (
                                    <View key={i} style={styles.skillTag}>
                                        <Text style={styles.skillTagText}>{req}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : null}

                    {!isEmployer && hasRealMatchScore ? (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Why This Match</Text>
                            {whyMatchBullets.map((bullet, index) => (
                                <Text key={`why-${index}`} style={styles.whyMatchText}>• {String(bullet || '').trim()}</Text>
                            ))}
                        </View>
                    ) : null}

                    {!isEmployer && matchGapBullets.length > 0 ? (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>What To Improve</Text>
                            {matchGapBullets.map((gap, index) => (
                                <Text key={`gap-${index}`} style={styles.matchGapText}>• {String(gap || '').trim()}</Text>
                            ))}
                            {lastActiveLabel ? (
                                <Text style={styles.matchGapHint}>{lastActiveLabel}</Text>
                            ) : null}
                        </View>
                    ) : null}

                    {/* Description */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.descriptionText}>
                            {safeJob?.description || `This role is open at ${safeJob.companyName}. Apply to unlock full workflow details from the employer.`}
                        </Text>
                    </View>

                    {/* Requirements */}
                    {isEmployer && safeJob?.requirements?.length > 0 && (
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Requirements</Text>
                            <View style={styles.tagsRow}>
                                {safeJob.requirements.map((req, i) => (
                                    <View key={i} style={styles.skillTag}>
                                        <Text style={styles.skillTagText}>{req}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* Mode Specific Sections */}
                    {isEmployer ? (
                        <View style={styles.funnelSection}>
                            <Text style={styles.sectionTitle}>Hiring Funnel Analytics</Text>
                            <View style={styles.funnelChartWrapNative}>
                                {FUNNEL_DATA.map((item) => (
                                    <View key={item.name} style={styles.funnelCol}>
                                        <Text style={styles.funnelValue}>{item.value}</Text>
                                        <View style={styles.funnelTrack}>
                                            <View
                                                style={[
                                                    styles.funnelBar,
                                                    {
                                                        backgroundColor: item.color,
                                                        height: `${Math.max((item.value / MAX_FUNNEL_VALUE) * 100, 6)}%`,
                                                    },
                                                ]}
                                            />
                                        </View>
                                        <Text style={styles.funnelLabel}>{item.name}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : hasRealMatchScore ? (
                        <View style={styles.smartMatchWrap}>
                            <LinearGradient
                                colors={['#eef2ff', '#f5f3ff']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.smartMatchCard}
                            >
                            <View style={styles.smartMatchHeader}>
                                <View style={styles.smartMatchTitleRow}>
                                    <IconSparkles size={16} color="#1d4ed8" />
                                    <Text style={styles.smartMatchTitle}>Smart Match Analysis</Text>
                                </View>
                                {!explanation && (
                                    <TouchableOpacity
                                        style={[styles.explainBtn, (loadingAI || !isPremiumPlan) && { opacity: 0.5 }]}
                                        onPress={handleExplain}
                                        disabled={loadingAI || !isPremiumPlan}
                                    >
                                        <Text style={styles.explainBtnText}>{loadingAI ? 'Analyzing...' : 'Why do I match?'}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            {isMatchUiEnabled && (
                                <View style={styles.probabilityCard}>
                                    <View style={styles.probabilityHeaderRow}>
                                        <Text style={styles.probabilityValue}>{displayMatchPercent}% match</Text>
                                        <Text style={styles.probabilityTier}>{effectiveTier}</Text>
                                    </View>
                                    {loadingMatchInsights ? (
                                        <ActivityIndicator size="small" color="#1d4ed8" style={styles.probabilityLoader} />
                                    ) : null}

                                    <Text style={styles.explainabilityHeading}>Match breakdown</Text>
                                    <View style={styles.matchSourceRow}>
                                        <Text style={styles.matchSourceLabel}>Score source</Text>
                                        <Text style={styles.matchSourceValue}>
                                            {scoreSourceMeta.label}{scoreSourceMeta.detail ? ` • ${scoreSourceMeta.detail}` : ''}
                                        </Text>
                                    </View>
                                    <View style={styles.explainabilityGrid}>
                                        {breakdownRows.map((row) => (
                                            <View key={row.label} style={styles.explainabilityRow}>
                                                <View style={styles.explainabilityRowHeader}>
                                                    <Text style={styles.explainabilityMetricLabel}>{row.label}</Text>
                                                    <Text style={styles.explainabilityMetricValue}>{row.value}%</Text>
                                                </View>
                                                <View style={styles.explainabilityTrack}>
                                                    <View style={[styles.explainabilityFill, { width: `${Math.max(4, row.value)}%` }]} />
                                                </View>
                                            </View>
                                        ))}
                                    </View>

                                    {showLowMatchNudge ? (
                                        <Text style={styles.lowMatchNudge}>
                                            This job is below your realistic match threshold — apply only if confident.
                                        </Text>
                                    ) : null}

                                    {showStrongMatchEncouragement ? (
                                        <Text style={styles.strongMatchNudge}>
                                            High likelihood of success — this role aligns strongly with your profile.
                                        </Text>
                                    ) : null}
                                </View>
                            )}
                            <View style={styles.smartMatchTextContainer}>
                                {explanation && Array.isArray(explanation) ? (
                                    explanation.map((bullet, idx) => (
                                        <Text key={idx} style={styles.smartMatchText}>• {bullet}</Text>
                                    ))
                                ) : (
                                    <Text style={styles.smartMatchText}>{safeFitReason}</Text>
                                )}
                            </View>
                            </LinearGradient>
                            <FeatureLockOverlay
                                locked={!isPremiumPlan}
                                title="Premium match intelligence"
                                subtitle="Unlock deep fit explainability, skill weighting, and confidence insights."
                                unlockLabel="See Plans"
                                onUnlock={() => navigation.navigate('Subscription')}
                            />
                        </View>
                    ) : null}

                    {/* Company Info Section */}
                    {!isEmployer && safeJob?.companyName && (
                        <View style={styles.companySection}>
                            <View style={styles.sectionHeaderRow}>
                                <Text style={styles.sectionTitle}>About {safeJob.companyName}</Text>
                                <View>
                                    <Text style={styles.viewProfileText}>View Profile</Text>
                                </View>
                            </View>
                            <View style={styles.companyCard}>
                                <Image source={{ uri: companyImageUri }} style={styles.companyLogo} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.companyDesc} numberOfLines={3}>
                                        {safeJob?.companyDescription || 'Company overview will be shared by the employer as part of the hiring conversation.'}
                                    </Text>
                                    <View style={styles.companyMetaRow}>
                                        <Text style={styles.companyMetaLabel}>{employerTrust.responseTime}</Text>
                                        <Text style={styles.companyMetaLabel}>
                                            {employerTrust.totalHires > 0 ? `${employerTrust.totalHires}+ hires` : 'Hiring now'}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        </View>
                    )}

                    {/* Similar Jobs Carousel */}
                    {!isEmployer && similarJobs.length > 0 ? (
                        <View style={styles.similarSection}>
                            <Text style={styles.sectionTitle}>Similar Jobs</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarScroll}>
                                {similarJobs.map(sj => (
                                    <View key={sj.id} style={styles.similarCard}>
                                        <Text style={styles.similarCardTitle} numberOfLines={1}>{sj.title}</Text>
                                        <Text style={styles.similarCardCompany}>{sj.company}</Text>
                                        <View style={styles.similarCardFooter}>
                                            <Text style={styles.similarCardLoc}>{sj.location}</Text>
                                            <Text style={styles.similarCardSal}>{sj.salary}</Text>
                                        </View>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    ) : null}

                    <View style={{ height: 140 }} />

            </ScrollView>

            {/* Sticky Apply Button */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
                {!isEmployer ? (
                    <Animated.View style={{ transform: [{ scale: applyScale }] }}>
                        <TouchableOpacity
                            style={[styles.applyBtn, applied && styles.applyBtnApplied]}
                            onPress={handleApply}
                            disabled={applying || applied}
                            activeOpacity={0.85}
                        >
                            {applying ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.applyBtnText}>{applied ? '✓ APPLIED' : 'APPLY NOW'}</Text>
                            )}
                        </TouchableOpacity>
                    </Animated.View>
                ) : (
                    <View style={styles.editJobBtn}>
                        <Text style={styles.editJobBtnText}>EDIT JOB POSTING</Text>
                    </View>
                )}

                <Animated.View pointerEvents="none" style={[styles.successBurst, { opacity: successBurstOpacity }]}>
                    <Text style={styles.successBurstText}>Application sent successfully</Text>
                </Animated.View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: PALETTE.surface },
    scrollContent: { paddingHorizontal: 16, paddingTop: 60 },

    topHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    backBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: PALETTE.backgroundSoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backBtnIcon: { fontSize: 28, color: PALETTE.textPrimary, lineHeight: 32, marginLeft: -2 },
    headerRightActions: { flexDirection: 'row', gap: 12 },
    actionIconBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: PALETTE.backgroundSoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionIconText: { fontSize: 18, color: PALETTE.textPrimary },

    profileHeader: {
        alignItems: 'center',
        marginBottom: 28,
    },
    logoContainer: {
        position: 'relative',
        marginBottom: 16,
    },
    logoImage: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: PALETTE.backgroundSoft,
    },
    matchBadgeFloating: {
        position: 'absolute',
        bottom: -6,
        alignSelf: 'center',
        backgroundColor: PALETTE.accent,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 2,
        borderColor: PALETTE.surface,
    },
    matchBadgeText: { color: PALETTE.surface, fontSize: 10, fontWeight: '800' },
    
    companyTitle: { fontSize: 15, fontWeight: '600', color: PALETTE.accent, marginBottom: 8 },
    jobTitleMain: { fontSize: 26, fontWeight: '800', color: PALETTE.textPrimary, textAlign: 'center', letterSpacing: -0.5, marginBottom: 16 },
    
    metaRowCentered: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
    metaText: { fontSize: 14, color: PALETTE.textSecondary, fontWeight: '500' },
    metaTextAccent: { fontSize: 14, color: PALETTE.textPrimary, fontWeight: '700' },
    metaDot: { fontSize: 14, color: PALETTE.textTertiary },

    heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
    heroBadge: { borderRadius: 8, backgroundColor: PALETTE.backgroundSoft, paddingHorizontal: 10, paddingVertical: 6 },
    heroBadgeUrgent: { backgroundColor: PALETTE.errorSoft },
    heroBadgeActive: { backgroundColor: PALETTE.accentSoft },
    heroBadgeText: { fontSize: 12, fontWeight: '600', color: PALETTE.textSecondary },
    heroBadgeTextUrgent: { fontSize: 12, fontWeight: '700', color: PALETTE.error },
    heroBadgeTextActive: { fontSize: 12, fontWeight: '700', color: PALETTE.accent },

    divider: { height: 1, backgroundColor: PALETTE.separator, marginHorizontal: -16, marginBottom: 24 },

    statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    statBox: { flex: 1, backgroundColor: PALETTE.backgroundSoft, borderRadius: 12, padding: 14, alignItems: 'center' },
    statBoxLabel: { fontSize: 11, fontWeight: '600', color: PALETTE.textTertiary, textTransform: 'uppercase', marginBottom: 6 },
    statBoxValue: { fontSize: 15, fontWeight: '700', color: PALETTE.textPrimary },

    quickStatsRow: { flexDirection: 'row', marginBottom: 16, gap: 8 },
    quickStatCard: { flex: 1, backgroundColor: PALETTE.backgroundSoft, padding: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: PALETTE.separator, alignItems: 'center' },
    quickStatCardSpaced: { marginLeft: 0 },
    quickStatLabel: { fontSize: 10, fontWeight: '500', color: PALETTE.textTertiary, textTransform: 'uppercase', marginBottom: 3, letterSpacing: 0.3 },
    quickStatValue: { fontSize: 14, fontWeight: '600', color: PALETTE.textPrimary },
    trustStrip: {
        marginBottom: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: PALETTE.separator,
        backgroundColor: PALETTE.backgroundSoft,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    trustPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    trustPillText: {
        color: PALETTE.accentDeep,
        fontSize: 10,
        fontWeight: '800',
    },
    trustInlineText: {
        color: PALETTE.textPrimary,
        fontSize: 11,
        fontWeight: '700',
    },
    trustInlineDot: {
        color: PALETTE.textTertiary,
        fontSize: 10,
        fontWeight: '700',
    },
    matchMetaRail: {
        marginTop: -4,
        marginBottom: 16,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    matchMetaPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: PALETTE.separator,
        backgroundColor: PALETTE.surface,
        paddingHorizontal: 10,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    matchMetaPillAccent: {
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentSoft,
    },
    matchMetaPillText: {
        color: PALETTE.textSecondary,
        fontSize: 11,
        fontWeight: '700',
    },
    matchMetaPillTextAccent: {
        color: PALETTE.accentDeep,
    },
    detailsActionRow: {
        marginBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    detailsActionPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentTint,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    detailsActionPillText: {
        fontSize: 12,
        fontWeight: '700',
        color: PALETTE.accentDeep,
    },
    detailsActionPillSaved: {
        backgroundColor: PALETTE.accentSoft,
        borderColor: PALETTE.accentBorder,
    },
    detailsActionPillSavedText: {
        color: PALETTE.accentDeep,
    },
    detailsQuickApplyBtn: {
        marginLeft: 'auto',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: PALETTE.accentDeep,
    },
    detailsQuickApplyBtnDisabled: {
        opacity: 0.65,
    },
    detailsQuickApplyText: {
        color: PALETTE.textInverted,
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },

    locationBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PALETTE.backgroundSoft, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: PALETTE.separator, marginBottom: 24 },
    locationText: { fontSize: 14, fontWeight: '500', color: PALETTE.textSecondary },

    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 18, fontWeight: '600', color: PALETTE.textPrimary, marginBottom: 12 },
    descriptionText: { fontSize: 15, lineHeight: 22, color: PALETTE.textSecondary, fontWeight: '400' },
    whyMatchText: { fontSize: 14, color: PALETTE.textSecondary, lineHeight: 22, marginBottom: 6 },
    matchGapText: { fontSize: 14, color: PALETTE.error, lineHeight: 22, marginBottom: 6 },
    matchGapHint: { marginTop: 4, fontSize: 11.5, fontWeight: '700', color: PALETTE.textSecondary },

    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    skillTag: { backgroundColor: PALETTE.backgroundSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: PALETTE.separator },
    skillTagText: { fontSize: 12, color: PALETTE.textPrimary, fontWeight: '500' },

    // Employer
    funnelSection: { backgroundColor: PALETTE.backgroundSoft, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: PALETTE.borderLight, marginBottom: 24 },
    funnelChartWrapNative: { height: 220, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 10 },
    funnelCol: { flex: 1, alignItems: 'center' },
    funnelValue: { fontSize: 11, fontWeight: '600', color: PALETTE.textPrimary, marginBottom: 4 },
    funnelTrack: { height: 140, width: 32, borderRadius: 8, backgroundColor: PALETTE.surface2, justifyContent: 'flex-end', overflow: 'hidden' },
    funnelBar: { width: '100%', borderRadius: 8 },
    funnelLabel: { fontSize: 10, fontWeight: '700', color: PALETTE.textSecondary, marginTop: 8, textAlign: 'center' },

    // Employee 
    smartMatchWrap: { position: 'relative', marginBottom: 24, borderRadius: 14, overflow: 'hidden' },
    smartMatchCard: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: PALETTE.separator },
    smartMatchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    smartMatchTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    smartMatchTitle: { fontSize: 14, fontWeight: '600', color: PALETTE.accentDeep },
    explainBtn: { backgroundColor: PALETTE.accentDeep, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
    explainBtnText: { fontSize: 11, fontWeight: '600', color: PALETTE.textInverted },
    probabilityCard: {
        backgroundColor: PALETTE.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: PALETTE.separator,
        padding: 12,
        marginBottom: 10,
    },
    probabilityHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    probabilityValue: {
        fontSize: 22,
        fontWeight: '700',
        color: PALETTE.accentDeep,
    },
    probabilityTier: {
        fontSize: 11,
        fontWeight: '600',
        color: PALETTE.accentDeep,
        backgroundColor: PALETTE.accentSoft,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    probabilityLoader: {
        marginTop: 6,
        marginBottom: 2,
        alignSelf: 'flex-start',
    },
    explainabilityHeading: {
        marginTop: 8,
        marginBottom: 8,
        color: PALETTE.textPrimary,
        fontSize: 13,
        fontWeight: '600',
    },
    matchSourceRow: {
        marginBottom: 10,
        paddingHorizontal: 10,
        paddingVertical: 9,
        borderRadius: 10,
        backgroundColor: PALETTE.backgroundSoft,
        borderWidth: 1,
        borderColor: PALETTE.separator,
    },
    matchSourceLabel: {
        color: PALETTE.textTertiary,
        fontSize: 10.5,
        fontWeight: '800',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    matchSourceValue: {
        marginTop: 3,
        color: PALETTE.textPrimary,
        fontSize: 12,
        fontWeight: '700',
    },
    explainabilityGrid: {
        gap: 10,
    },
    explainabilityRow: {
        gap: 6,
    },
    explainabilityRowHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    explainabilityMetricLabel: {
        color: PALETTE.textSecondary,
        fontSize: 12,
        fontWeight: '500',
    },
    explainabilityMetricValue: {
        color: PALETTE.accentDeep,
        fontSize: 12,
        fontWeight: '600',
    },
    explainabilityTrack: {
        height: 5,
        borderRadius: 99,
        backgroundColor: PALETTE.surface3,
        overflow: 'hidden',
    },
    explainabilityFill: {
        height: '100%',
        borderRadius: 99,
        backgroundColor: PALETTE.accentDeep,
    },
    lowMatchNudge: {
        marginTop: 10,
        color: '#9a6a14',
        fontSize: 12,
        fontWeight: '500',
        backgroundColor: '#fff5df',
        borderWidth: 1,
        borderColor: '#f6deb0',
        borderRadius: 10,
        padding: 8,
    },
    strongMatchNudge: {
        marginTop: 10,
        color: '#166534',
        fontSize: 12,
        fontWeight: '500',
        backgroundColor: '#dcfce7',
        borderWidth: 1,
        borderColor: '#bbf7d0',
        borderRadius: 10,
        padding: 8,
    },
    smartMatchTextContainer: {
        marginTop: 4,
    },
    smartMatchText: { fontSize: 13, lineHeight: 20, color: PALETTE.textPrimary },

    companySection: { marginBottom: 24 },
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 },
    viewProfileText: { fontSize: 12, fontWeight: '600', color: PALETTE.accentDeep, marginBottom: 2 },
    companyCard: { backgroundColor: PALETTE.surface, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: PALETTE.separator, flexDirection: 'row', gap: 16 },
    companyLogo: { width: 48, height: 48, borderRadius: 12 },
    companyDesc: { fontSize: 12, color: PALETTE.textSecondary, lineHeight: 18, marginBottom: 8 },
    companyMetaRow: { flexDirection: 'row', gap: 12 },
    companyMetaLabel: { fontSize: 10, fontWeight: '500', color: PALETTE.textTertiary },

    similarSection: { marginBottom: 24 },
    similarScroll: { paddingRight: 20 },
    similarCard: { backgroundColor: PALETTE.surface, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: PALETTE.separator, width: 220, marginRight: 16, shadowColor: PALETTE.textPrimary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    similarCardTitle: { fontSize: 14, fontWeight: '600', color: PALETTE.textPrimary, marginBottom: 2 },
    similarCardCompany: { fontSize: 12, color: PALETTE.textSecondary, marginBottom: 12 },
    similarCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: PALETTE.surface2, paddingTop: 8 },
    similarCardLoc: { fontSize: 11, color: PALETTE.textTertiary },
    similarCardSal: { fontSize: 12, fontWeight: '600', color: PALETTE.accentDeep },

    // Footer
    footer: { backgroundColor: PALETTE.surface, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: PALETTE.separator },
    applyBtn: { backgroundColor: PALETTE.accent, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    applyBtnApplied: { backgroundColor: PALETTE.success },
    applyBtnText: { color: PALETTE.textInverted, fontSize: 15, fontWeight: '600' },
    successBurst: {
        marginTop: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#bbf7d0',
        backgroundColor: '#dcfce7',
        alignSelf: 'center',
        paddingHorizontal: 12,
        paddingVertical: 5,
    },
    successBurstText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#166534',
    },
    editJobBtn: { backgroundColor: PALETTE.accent, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    editJobBtnText: { color: PALETTE.textInverted, fontSize: 15, fontWeight: '600' },
});
