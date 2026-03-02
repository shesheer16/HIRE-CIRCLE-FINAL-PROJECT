import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Alert, ActivityIndicator, Dimensions, Image, Animated, Easing
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

    const baseTitle = String(job?.title || 'Role');
    const baseLocation = String(job?.location || 'Location not listed');
    const baseSalary = String(job?.salaryRange || 'Salary not listed');
    const baseCompany = String(job?.companyName || 'Hiring company');

    return [
        { id: 'alt-1', title: `${baseTitle} - Day Shift`, company: baseCompany, location: baseLocation, salary: baseSalary },
        { id: 'alt-2', title: `${baseTitle} - Immediate Joiner`, company: baseCompany, location: baseLocation, salary: baseSalary },
    ];
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
    } = route.params || {};
    const [applying, setApplying] = useState(false);
    const [applied, setApplied] = useState(false);

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
    const [subscriptionPlan, setSubscriptionPlan] = useState('free');
    const applyScale = useRef(new Animated.Value(1)).current;
    const successBurstOpacity = useRef(new Animated.Value(0)).current;
    const { dispatch } = useAppState();
    const { featureFlags } = useAppStore();
    const isMatchUiEnabled = featureFlags?.FEATURE_MATCH_UI_V1 ?? FEATURE_MATCH_UI_V1;
    const isEmployer = viewerRole === 'employer';

    // Safely handle missing params
    const safeJob = job || {
        title: 'Open Position',
        companyName: 'Hiring Company',
        location: 'Location to be shared',
        salaryRange: 'Salary to be discussed',
        type: 'Full-time',
        requirements: ['Role requirements shared after apply'],
        description: 'The employer will share complete role details once your application is shortlisted.',
    };
    const safeMatchScore = Number.isFinite(Number(matchScore)) ? Number(matchScore) : 92;
    const safeFitReason = fitReason || `Your profile is a strong match for this ${safeJob.title} role based on your 8 years of experience.`;
    const fallbackProbability = Number.isFinite(Number(routeFinalScore))
        ? clamp01(routeFinalScore)
        : clamp01(safeMatchScore / 100);

    useEffect(() => {
        let isMounted = true;

        const hydrateContext = async () => {
            try {
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                const userInfo = JSON.parse(userInfoStr || '{}');
                const normalizedRole = String(userInfo?.primaryRole || userInfo?.role || '').toLowerCase();

                if (!isMounted) return;
                setViewerRole(normalizedRole === 'employer' ? 'employer' : 'employee');

                if (!isMatchUiEnabled || normalizedRole === 'employer') {
                    return;
                }

                let workerId = String(workerIdForMatch || userInfo?.workerProfileId || '');
                if (!workerId) {
                    try {
                        const { data } = await client.get('/api/users/profile');
                        workerId = String(data?.profile?._id || '');
                    } catch (profileError) {
                        logger.warn('Worker profile lookup failed in JobDetails', profileError?.message || profileError);
                    }
                }

                if (isMounted) {
                    setResolvedWorkerId(workerId);
                }
            } catch (error) {
                logger.error('Failed to hydrate JobDetails context', error);
            }
        };

        hydrateContext();
        return () => { isMounted = false; };
    }, [isMatchUiEnabled, workerIdForMatch]);

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

        const jobId = String(safeJob?._id || safeJob?.id || '');
        if (!jobId || !resolvedWorkerId) {
            return;
        }

        let isMounted = true;
        const fetchProbability = async () => {
            setLoadingMatchInsights(true);

            try {
                const { data } = await client.get('/api/matches/probability', {
                    params: {
                        workerId: resolvedWorkerId,
                        jobId,
                    },
                });

                if (!isMounted) return;

                const probability = Number(data?.matchProbability);
                const normalizedProbability = Number.isFinite(probability)
                    ? clamp01(probability)
                    : fallbackProbability;
                const resolvedTier = tierFromProbability(normalizedProbability);

                setMatchProbability(normalizedProbability);
                setMatchTier(resolvedTier);
                setProbabilityExplainability(data?.explainability || {});
                setMatchModelVersionUsed(data?.matchModelVersionUsed || null);

                trackEvent('MATCH_DETAIL_VIEWED', {
                    workerId: resolvedWorkerId,
                    jobId,
                    finalScore: Number(normalizedProbability.toFixed(4)),
                    tier: resolvedTier,
                });
            } catch (error) {
                logger.error('Failed to fetch match probability for JobDetails', error);
                if (!isMounted) return;

                const resolvedTier = tierFromProbability(fallbackProbability);
                setMatchProbability(fallbackProbability);
                setMatchTier(resolvedTier);
                setProbabilityExplainability(routeExplainability || {});

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
    }, [fallbackProbability, isEmployer, isMatchUiEnabled, resolvedWorkerId, routeExplainability, safeJob?._id, safeJob?.id]);

    const handleApply = async () => {
        setApplying(true);
        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const userInfo = JSON.parse(userInfoStr || '{}');
            const workerId = userInfo._id;

            const { data } = await client.post('/api/applications', {
                jobId: safeJob._id || safeJob.id,
                workerId: workerId,
                initiatedBy: 'worker' // As per backend requirement
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
            setApplying(false);
            const errorMsg = error.response?.data?.message || 'Failed to submit application.';
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
    const employerTrust = {
        verified: Boolean(safeJob?.verifiedCompany || safeJob?.trustedCompany || safeJob?.trustBadge),
        responseTime: String(safeJob?.responseTimeLabel || safeJob?.employer?.responseTimeLabel || 'Responds fast'),
        totalHires: Number(safeJob?.totalHires || safeJob?.hiredCount || safeJob?.companyHires || 0),
        rating: Number(safeJob?.employerRating || safeJob?.rating || safeJob?.employer?.rating || 0),
    };

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} bounces={false}>
                {/* Banner Header */}
                <View style={styles.bannerContainer}>
                    <Image source={{ uri: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&q=80&w=800' }} style={styles.bannerImage} />
                    <View style={styles.bannerOverlay} />
                    <View style={[styles.bannerHeader, { paddingTop: insets.top + 16 }]}>
                        <TouchableOpacity
                            style={styles.iconBtnBlur}
                            onPress={() => {
                                if (navigation.canGoBack()) {
                                    navigation.goBack();
                                    return;
                                }
                                navigation.navigate('MainTab', { screen: 'Jobs' });
                            }}
                        >
                            <Text style={styles.iconBtnText}>‹</Text>
                        </TouchableOpacity>
                        <View style={styles.headerRightActions}>
                            <TouchableOpacity style={styles.iconBtnBlur} onPress={() => Alert.alert('Share Job', 'Opening share sheet...')}>
                                <Text style={styles.iconBtnSmallIcon}>↗</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.iconBtnBlur, { marginLeft: 12 }]} onPress={() => setIsSaved(!isSaved)}>
                                <Text style={styles.iconBtnSmallIcon}>{isSaved ? '♥' : '♡'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                {/* Main Content Card */}
                <View style={[styles.contentCard, { borderLeftColor: tierAccentColor }]}>
                    {/* Header Info */}
                    <View style={styles.heroHeader}>
                        <View style={styles.heroFlex}>
                            <Text style={styles.jobTitle}>{safeJob.title}</Text>
                            <Text style={styles.companyName}>{safeJob.companyName}</Text>
                            <View style={styles.heroBadgeRow}>
                                {safeJob?.urgentHiring ? (
                                    <View style={[styles.heroBadge, styles.heroBadgeUrgent]}>
                                        <Text style={[styles.heroBadgeText, styles.heroBadgeTextUrgent]}>Urgent Hiring</Text>
                                    </View>
                                ) : null}
                                {safeJob?.activelyHiring !== false ? (
                                    <View style={[styles.heroBadge, styles.heroBadgeActive]}>
                                        <Text style={[styles.heroBadgeText, styles.heroBadgeTextActive]}>Actively Hiring</Text>
                                    </View>
                                ) : null}
                            </View>
                        </View>
                        {!isEmployer && (
                            <View style={styles.matchScoreBadge}>
                                <Text style={styles.matchScoreText}>{displayMatchPercent}%</Text>
                            </View>
                        )}
                    </View>

                    {/* Quick Stats: Salary & Type */}
                    <View style={styles.quickStatsRow}>
                        <View style={styles.quickStatCard}>
                            <Text style={styles.quickStatLabel}>SALARY</Text>
                            <Text style={styles.quickStatValue}>{safeJob.salaryRange}</Text>
                        </View>
                        <View style={[styles.quickStatCard, { marginLeft: 16 }]}>
                            <Text style={styles.quickStatLabel}>TYPE</Text>
                            <Text style={styles.quickStatValue}>{safeJob.type}</Text>
                        </View>
                    </View>

                    {!isEmployer ? (
                        <View style={styles.trustStrip}>
                            <View style={styles.trustPill}>
                                <Text style={styles.trustPillText}>{employerTrust.verified ? 'Verified Employer' : 'Employer Profile'}</Text>
                            </View>
                            <Text style={styles.trustInlineText}>{employerTrust.responseTime}</Text>
                            <Text style={styles.trustInlineDot}>•</Text>
                            <Text style={styles.trustInlineText}>
                                {employerTrust.totalHires > 0 ? `${employerTrust.totalHires}+ hires` : 'New hiring team'}
                            </Text>
                            {employerTrust.rating > 0 ? (
                                <>
                                    <Text style={styles.trustInlineDot}>•</Text>
                                    <Text style={styles.trustInlineText}>Rating {employerTrust.rating.toFixed(1)}</Text>
                                </>
                            ) : null}
                        </View>
                    ) : null}

                    {/* Location */}
                    <View style={styles.locationBox}>
                        <IconMapPin size={16} color="#64748b" />
                        <Text style={styles.locationText}>{safeJob.location}</Text>
                    </View>

                    {/* Description */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.descriptionText}>
                            {safeJob?.description || `This role is open at ${safeJob.companyName}. Apply to unlock full workflow details from the employer.`}
                        </Text>
                    </View>

                    {/* Requirements */}
                    {safeJob?.requirements?.length > 0 && (
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
                    ) : (
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

                                    {matchModelVersionUsed ? (
                                        <Text style={styles.modelVersionText}>Model: {matchModelVersionUsed}</Text>
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
                    )}

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
                                <Image source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(safeJob.companyName)}&background=7c3aed&color=fff` }} style={styles.companyLogo} />
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
                    {!isEmployer && (
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
                    )}

                    <View style={{ height: 100 }} />
                </View>
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
    container: { flex: 1, backgroundColor: '#f5f7fa' },
    scrollContent: { flexGrow: 1 },

    // Banner
    bannerContainer: { height: 160, position: 'relative' },
    bannerImage: { width: '100%', height: '100%', position: 'absolute' },
    bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
    bannerHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, position: 'absolute', top: 0, left: 0, right: 0 },
    iconBtnBlur: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' },
    iconBtnText: { color: '#fff', fontSize: 32, lineHeight: 36, fontWeight: '300', marginLeft: -2 },
    headerRightActions: { flexDirection: 'row', alignItems: 'center' },
    iconBtnSmallIcon: { color: '#fff', fontSize: 20, fontWeight: '600' },

    // Content
    contentCard: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        marginTop: -24,
        paddingHorizontal: 20,
        paddingTop: 24,
        flex: 1,
        borderLeftWidth: 4,
    },
    heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
    heroFlex: { flex: 1, paddingRight: 16 },
    jobTitle: { fontSize: 30, fontWeight: '700', color: '#0f172a', marginBottom: 4, lineHeight: 36 },
    companyName: { fontSize: 15, fontWeight: '500', color: '#2563eb' },
    heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    heroBadge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
    heroBadgeUrgent: { backgroundColor: '#fef3c7', borderColor: '#fcd34d' },
    heroBadgeActive: { backgroundColor: '#dbeafe', borderColor: '#bfdbfe' },
    heroBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.2 },
    heroBadgeTextUrgent: { color: '#92400e' },
    heroBadgeTextActive: { color: '#1e3a8a' },
    matchScoreBadge: { backgroundColor: '#e8f0ff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: '#bfd5ff' },
    matchScoreText: { fontSize: 16, fontWeight: '600', color: '#1d4ed8' },

    quickStatsRow: { flexDirection: 'row', marginBottom: 16 },
    quickStatCard: { flex: 1, backgroundColor: '#f8fbff', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#dbe3ec', alignItems: 'center' },
    quickStatLabel: { fontSize: 11, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.4 },
    quickStatValue: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
    trustStrip: {
        marginBottom: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#dbe7ff',
        backgroundColor: '#f8fbff',
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
        borderColor: '#bfd5ff',
        backgroundColor: '#e8f0ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    trustPillText: {
        color: '#1e3a8a',
        fontSize: 10,
        fontWeight: '800',
    },
    trustInlineText: {
        color: '#334155',
        fontSize: 11,
        fontWeight: '700',
    },
    trustInlineDot: {
        color: '#94a3b8',
        fontSize: 10,
        fontWeight: '700',
    },

    locationBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fbff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#dbe3ec', marginBottom: 24 },
    locationText: { fontSize: 14, fontWeight: '500', color: '#475569' },

    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
    descriptionText: { fontSize: 15, lineHeight: 22, color: '#475569', fontWeight: '400' },

    tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    skillTag: { backgroundColor: '#f8fbff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#dbe3ec' },
    skillTagText: { fontSize: 12, color: '#334155', fontWeight: '500' },

    // Employer
    funnelSection: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 24 },
    funnelChartWrapNative: { height: 220, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 10 },
    funnelCol: { flex: 1, alignItems: 'center' },
    funnelValue: { fontSize: 11, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
    funnelTrack: { height: 140, width: 32, borderRadius: 8, backgroundColor: '#e2e8f0', justifyContent: 'flex-end', overflow: 'hidden' },
    funnelBar: { width: '100%', borderRadius: 8 },
    funnelLabel: { fontSize: 10, fontWeight: '700', color: '#64748b', marginTop: 8, textAlign: 'center' },

    // Employee 
    smartMatchWrap: { position: 'relative', marginBottom: 24, borderRadius: 14, overflow: 'hidden' },
    smartMatchCard: { padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#d7e2f0' },
    smartMatchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    smartMatchTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    smartMatchTitle: { fontSize: 14, fontWeight: '600', color: '#1e3a8a' },
    explainBtn: { backgroundColor: '#1d4ed8', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
    explainBtnText: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
    probabilityCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#dbe3ec',
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
        color: '#1e3a8a',
    },
    probabilityTier: {
        fontSize: 11,
        fontWeight: '600',
        color: '#1d4ed8',
        backgroundColor: '#e8f0ff',
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
        color: '#0f172a',
        fontSize: 13,
        fontWeight: '600',
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
        color: '#475569',
        fontSize: 12,
        fontWeight: '500',
    },
    explainabilityMetricValue: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '600',
    },
    explainabilityTrack: {
        height: 5,
        borderRadius: 99,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
    },
    explainabilityFill: {
        height: '100%',
        borderRadius: 99,
        backgroundColor: '#1d4ed8',
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
    modelVersionText: {
        marginTop: 8,
        fontSize: 10,
        color: '#64748b',
        fontWeight: '500',
    },
    smartMatchTextContainer: {
        marginTop: 4,
    },
    smartMatchText: { fontSize: 13, lineHeight: 20, color: '#334155' },

    companySection: { marginBottom: 24 },
    sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 },
    viewProfileText: { fontSize: 12, fontWeight: '600', color: '#1d4ed8', marginBottom: 2 },
    companyCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', gap: 16 },
    companyLogo: { width: 48, height: 48, borderRadius: 12 },
    companyDesc: { fontSize: 12, color: '#64748b', lineHeight: 18, marginBottom: 8 },
    companyMetaRow: { flexDirection: 'row', gap: 12 },
    companyMetaLabel: { fontSize: 10, fontWeight: '500', color: '#94a3b8' },

    similarSection: { marginBottom: 24 },
    similarScroll: { paddingRight: 20 },
    similarCard: { backgroundColor: '#fff', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', width: 220, marginRight: 16, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    similarCardTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', marginBottom: 2 },
    similarCardCompany: { fontSize: 12, color: '#64748b', marginBottom: 12 },
    similarCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f8fafc', paddingTop: 8 },
    similarCardLoc: { fontSize: 11, color: '#94a3b8' },
    similarCardSal: { fontSize: 12, fontWeight: '600', color: '#1d4ed8' },

    // Footer
    footer: { backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0', shadowColor: '#0f172a', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 8 },
    applyBtn: { backgroundColor: '#1d4ed8', paddingVertical: 16, borderRadius: 12, alignItems: 'center', shadowColor: '#1d4ed8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
    applyBtnApplied: { backgroundColor: '#22c55e', shadowColor: '#22c55e' },
    applyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
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
    editJobBtn: { backgroundColor: '#0f172a', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
    editJobBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});
