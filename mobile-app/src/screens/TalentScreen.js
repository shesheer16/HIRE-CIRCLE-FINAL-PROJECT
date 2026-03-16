import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, FlatList, Platform, Alert, BackHandler, Modal, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import client from '../api/client';
import SkeletonLoader from '../components/SkeletonLoader';
import { logger } from '../utils/logger';
import EmptyState from '../components/EmptyState';
import SocketService from '../services/socket';
import {
    APPLICATION_STATUS_COLOR_MAP,
    CHAT_READY_APPLICATION_STATUSES,
    getApplicationStatusLabel,
    normalizeApplicationStatus,
} from '../utils/applicationPresentation';
import {
    getReadableNonAuthError,
    getProfileGateMessage,
    isProfileRoleGateError,
} from '../utils/profileReadiness';
import {
    buildMatchGaps,
    formatRelativeTimeLabel,
    getMatchScoreSourceMeta,
} from '../utils/matchUi';
import { SCREEN_CHROME, SHADOWS, SPACING } from '../theme/theme';
const extractArrayPayload = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    return null;
};
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const normalizeObjectId = (value) => {
    const normalized = String(value || '').trim();
    if (!OBJECT_ID_PATTERN.test(normalized)) return '';
    return normalized;
};

const buildEmployerStatusSequence = (currentStatus, targetStatus) => {
    const current = normalizeApplicationStatus(currentStatus);
    const target = normalizeApplicationStatus(targetStatus);
    if (!target || current === target) return [];

    if (target === 'interview_requested') {
        if (current === 'applied') return ['shortlisted', 'interview_requested'];
        if (current === 'shortlisted' || current === 'interview_completed') return ['interview_requested'];
        return ['interview_requested'];
    }

    if (target === 'shortlisted') {
        if (current === 'applied') return ['shortlisted'];
        return [];
    }

    return [target];
};

const getTalentStatusColor = (statusLabel = '') => (
    APPLICATION_STATUS_COLOR_MAP[String(statusLabel || '').trim()] || '#94a3b8'
);

const formatCompactTalentNumber = (value) => {
    const safeValue = Number(value || 0);
    if (!Number.isFinite(safeValue) || safeValue <= 0) return '0';
    if (safeValue >= 1000) {
        const thousands = safeValue / 1000;
        return `${thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1)}`.replace(/\.0$/, '') + 'K';
    }
    return String(Math.round(safeValue));
};

const buildCandidateSummary = ({
    summary = '',
    roleTitle = '',
    experienceYears = 0,
    skills = [],
    location = '',
    interviewVerified = false,
}) => {
    const directSummary = String(summary || '').trim();
    if (directSummary) return directSummary;

    const parts = [];
    const safeRoleTitle = String(roleTitle || '').trim();
    const safeLocation = String(location || '').trim();
    const safeExperience = Number(experienceYears || 0);
    const safeSkills = Array.isArray(skills)
        ? skills.filter((skill) => typeof skill === 'string' && skill.trim()).slice(0, 3)
        : [];

    if (safeRoleTitle) parts.push(safeRoleTitle);
    if (safeExperience > 0) {
        parts.push(`${safeExperience} year${safeExperience === 1 ? '' : 's'} experience`);
    }
    if (safeSkills.length) {
        parts.push(`Skills: ${safeSkills.join(', ')}`);
    }
    if (safeLocation) {
        parts.push(`Based in ${safeLocation}`);
    }
    if (interviewVerified) {
        parts.push('Interview verified');
    }

    return parts.join(' • ') || 'Profile details are syncing for this job seeker.';
};

export default function TalentScreen({ navigation, route }) {
    const isScreenFocused = useIsFocused();
    const [selectedPool, setSelectedPool] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);
    const [pools, setPools] = useState([]);
    const [hasAutoOpenedPool, setHasAutoOpenedPool] = useState(false);
    const [loadingPools, setLoadingPools] = useState(true);
    const [candidates, setCandidates] = useState([]);
    const [loadingCandidates, setLoadingCandidates] = useState(false);
    const [explanation, setExplanation] = useState(null);
    const [loadingExplanation, setLoadingExplanation] = useState(false);
    const [poolError, setPoolError] = useState('');
    const [candidateError, setCandidateError] = useState('');
    const [profileGateMessage, setProfileGateMessage] = useState('');
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [showResumeModal, setShowResumeModal] = useState(false);
    const poolsFetchInFlightRef = useRef(false);
    const poolsLoadedOnceRef = useRef(false);
    const candidateRequestIdRef = useRef(0);
    const candidatesLoadedOnceRef = useRef(false);
    const insets = useSafeAreaInsets();
    const handleOpenQuickPost = useCallback(() => {
        navigation.navigate('PostJob');
    }, [navigation]);

    const fetchJobsAsPools = useCallback(async () => {
        if (poolsFetchInFlightRef.current) {
            return;
        }
        poolsFetchInFlightRef.current = true;
        if (!poolsLoadedOnceRef.current) {
            setLoadingPools(true);
        }
        setPoolError('');
        try {
            const [jobsResult, applicationsResult] = await Promise.allSettled([
                client.get('/api/jobs/my-jobs', {
                    __skipApiErrorHandler: true,
                    __maxRetries: 0,
                    __disableBaseFallback: true,
                    timeout: 6000,
                }),
                client.get('/api/applications', {
                    __skipApiErrorHandler: true,
                    __maxRetries: 0,
                    __disableBaseFallback: true,
                    timeout: 6000,
                }),
            ]);

            if (jobsResult.status !== 'fulfilled') {
                throw jobsResult.reason;
            }

            const jobsArray = extractArrayPayload(jobsResult.value?.data);
            if (!jobsArray) {
                throw new Error('Invalid jobs response format.');
            }

            let applications = [];
            if (applicationsResult.status === 'fulfilled') {
                const parsedApplications = extractArrayPayload(applicationsResult.value?.data);
                if (parsedApplications) {
                    applications = parsedApplications;
                } else {
                    logger.warn('Talent pools: applications payload was not an array. Falling back to zero counts.');
                }
            } else {
                logger.warn('Talent pools: applications fetch failed. Falling back to zero counts.');
            }

            const applicantCountByJobId = applications.reduce((acc, application) => {
                const jobId = String(application?.job?._id || application?.job || '');
                if (!jobId) return acc;
                acc[jobId] = (acc[jobId] || 0) + 1;
                return acc;
            }, {});
            const newPools = jobsArray
                .map((j) => {
                    const normalizedId = normalizeObjectId(j?._id);
                    if (!normalizedId) return null;
                    return {
                        id: normalizedId,
                        name: j?.title,
                        count: applicantCountByJobId[normalizedId] || 0,
                        tags: j?.requirements ? [j.requirements[0]] : [],
                    };
                })
                .filter(Boolean);

            setPools(newPools);
        } catch (error) {
            // Keep Talent tab stable with empty-state UX when backend data is unavailable.
            setPools([]);
            setPoolError('');
        } finally {
            poolsFetchInFlightRef.current = false;
            poolsLoadedOnceRef.current = true;
            setLoadingPools(false);
        }
    }, []);

    const fetchCandidatesForPool = useCallback(async (poolId) => {
        const requestId = candidateRequestIdRef.current + 1;
        candidateRequestIdRef.current = requestId;

        const normalizedPoolId = normalizeObjectId(poolId);
        if (!normalizedPoolId) {
            setCandidates([]);
            setCandidateError('Select a job to view job seekers.');
            setSelectedPool(null);
            setLoadingCandidates(false);
            candidatesLoadedOnceRef.current = false;
            return;
        }

        setCandidateError('');
        setProfileGateMessage('');
        if (!candidatesLoadedOnceRef.current) {
            setLoadingCandidates(true);
        }
        try {
            const { data } = await client.get(`/api/matches/employer/${normalizedPoolId}`, {
                __skipApiErrorHandler: true,
                __maxRetries: 0,
                __disableBaseFallback: true,
                timeout: 6000,
            });
            const matches = Array.isArray(data)
                ? data
                : (Array.isArray(data?.matches) ? data.matches : null);
            if (!matches) {
                throw new Error('Invalid match response format.');
            }
            const mapped = matches.map((item, idx) => {
                const w = item.worker || {};
                const u = w.user || {};
                const role = w.roleProfiles && w.roleProfiles[0] ? w.roleProfiles[0] : {};
                const statusRaw = normalizeApplicationStatus(item.applicationStatus || item.status || 'pending');
                const statusLabel = getApplicationStatusLabel(statusRaw);
                const applicationKey = String(item?.applicationId || item?._id || '').trim();
                const workerKey = String(w?._id || u?._id || '').trim();
                const candidateId = applicationKey
                    ? `app-${applicationKey}`
                    : workerKey
                        ? `pool-${normalizedPoolId}-worker-${workerKey}-${idx}`
                        : `pool-${normalizedPoolId}-row-${idx}`;
                const resolvedMatchScore = Number.isFinite(Number(item?.matchScore))
                    ? Math.max(0, Math.min(100, Number(item.matchScore) <= 1 ? Number(item.matchScore) * 100 : Number(item.matchScore)))
                    : null;
                const skills = Array.isArray(role?.skills) && role.skills.length
                    ? role.skills
                    : (Array.isArray(w?.skills) ? w.skills : []);
                const transcript = String(w?.videoIntroduction?.transcript || '').trim();
                const summary = String(
                    item?.whyThisMatchesYou
                    || item?.matchWhy?.summary
                    || transcript
                ).trim();
                const profilePercentile = Number.isFinite(Number(item?.profilePercentile))
                    ? Math.max(0, Math.min(99, Math.round(Number(item.profilePercentile))))
                    : null;
                return {
                    id: candidateId,
                    userId: u._id,
                    workerProfileId: workerKey,
                    avatar: String(
                        w?.avatar
                        || u?.avatar
                        || u?.profilePicture
                        || u?.profileImage
                        || item?.avatar
                        || ''
                    ).trim(),
                    name: u.name || w.firstName || 'Job Seeker',
                    roleTitle: role.roleName || 'Job Seeker',
                    summary: buildCandidateSummary({
                        summary,
                        roleTitle: role.roleName || 'Job Seeker',
                        experienceYears: role.experienceInRole || 0,
                        skills,
                        location: w.city || 'Remote',
                        interviewVerified: Boolean(w.interviewVerified),
                    }),
                    experienceYears: role.experienceInRole || 0,
                    skills,
                    qualifications: w.education || [],
                    location: w.city || 'Remote',
                    matchScore: resolvedMatchScore,
                    profilePercentile,
                    applicationId: item.applicationId || null,
                    statusRaw,
                    statusLabel,
                    interviewVerified: Boolean(w.interviewVerified),
                    communicationClarityTag: item.communicationClarityTag || 'Not enough data yet',
                    profileStrengthLabel: item.profileStrengthLabel || 'Not enough data yet',
                    salaryAlignmentStatus: item.salaryAlignmentStatus || 'ALIGNED',
                    verifiedPriorityActive: Boolean(item.verifiedPriorityActive),
                    resumeUrl: w?.resumeUrl || w?.resume?.url || role?.resumeUrl || u?.resumeUrl || item?.resumeUrl || null,
                    transcript,
                    whyMatch: String(item?.whyThisMatchesYou || item?.matchWhy?.summary || '').trim(),
                    explainability: item?.explainability || {},
                    topReasons: Array.isArray(item?.matchExplainabilityCard?.topReasons) ? item.matchExplainabilityCard.topReasons : [],
                    confidenceScore: Number(item?.matchExplainabilityCard?.confidenceScore || 0),
                    timelineTransparency: item?.timelineTransparency || null,
                    matchScoreSource: String(item?.matchScoreSource || '').trim(),
                    matchModelVersionUsed: item?.matchModelVersionUsed || null,
                    probabilisticFallbackUsed: Boolean(item?.probabilisticFallbackUsed || item?.fallbackUsed),
                };
            });
            if (requestId !== candidateRequestIdRef.current) {
                return;
            }
            setCandidates(mapped);
        } catch (error) {
            if (requestId !== candidateRequestIdRef.current) {
                return;
            }
            if (isProfileRoleGateError(error)) {
                setProfileGateMessage(getProfileGateMessage({ role: 'employer' }));
            } else {
                setProfileGateMessage('');
            }
            setCandidates([]);
            setCandidateError('');
        } finally {
            if (requestId === candidateRequestIdRef.current) {
                candidatesLoadedOnceRef.current = true;
                setLoadingCandidates(false);
            }
        }
    }, []);

    const handleSelectPool = useCallback(async (pool) => {
        // Mark that pool view was intentionally opened so auto-open doesn't trap back navigation.
        candidatesLoadedOnceRef.current = false;
        setHasAutoOpenedPool(true);
        setSelectedPool(pool);
        setSelectedCandidate(null);
        setExplanation(null);
        await fetchCandidatesForPool(pool?.id);
    }, [fetchCandidatesForPool]);

    const handleBackFromPool = useCallback(() => {
        const launchedFromJobShortcut = Boolean(String(route?.params?.jobId || '').trim());

        setSelectedCandidate(null);
        setSelectedPool(null);
        setExplanation(null);
        setCandidateError('');
        candidatesLoadedOnceRef.current = false;
        setHasAutoOpenedPool(true);

        if (launchedFromJobShortcut) {
            // Clear one-time route param first; otherwise the auto-select effect re-opens the same pool.
            navigation.setParams({ jobId: undefined });
            navigation.navigate('My Jobs');
        }
    }, [navigation, route?.params?.jobId]);

    useFocusEffect(
        useCallback(() => {
            if (!selectedPool && !selectedCandidate) {
                return undefined;
            }

            const onBackPress = () => {
                if (selectedCandidate) {
                    setSelectedCandidate(null);
                    return true;
                }
                if (selectedPool) {
                    handleBackFromPool();
                    return true;
                }
                return false;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => subscription.remove();
        }, [handleBackFromPool, selectedCandidate, selectedPool])
    );

    useEffect(() => {
        fetchJobsAsPools();
    }, [fetchJobsAsPools]);

    useFocusEffect(
        useCallback(() => {
            fetchJobsAsPools();
            if (selectedPool?.id) {
                fetchCandidatesForPool(selectedPool.id);
            }
            return undefined;
        }, [fetchCandidatesForPool, fetchJobsAsPools, selectedPool?.id])
    );

    useEffect(() => {
        const initialJobId = route?.params?.jobId;
        if (!initialJobId || !Array.isArray(pools) || pools.length === 0 || selectedPool?.id) {
            return;
        }
        const matchedPool = pools.find((pool) => String(pool.id) === String(initialJobId));
        if (matchedPool) {
            handleSelectPool(matchedPool);
        }
    }, [route?.params?.jobId, pools, selectedPool?.id, handleSelectPool]);

    useEffect(() => {
        const handleNewApplication = (payload = {}) => {
            const payloadJobId = String(payload?.jobId || '').trim();
            if (!payloadJobId) {
                fetchJobsAsPools();
                if (selectedPool?.id) {
                    fetchCandidatesForPool(selectedPool.id);
                }
                return;
            }

            setPools((prev) => prev.map((pool) => (
                String(pool.id) === payloadJobId
                    ? { ...pool, count: Number(pool.count || 0) + 1 }
                    : pool
            )));

            fetchJobsAsPools();
            if (selectedPool?.id && payloadJobId === String(selectedPool.id)) {
                fetchCandidatesForPool(selectedPool.id);
            }
        };

        SocketService.on('new_application', handleNewApplication);
        return () => {
            SocketService.off('new_application', handleNewApplication);
        };
    }, [fetchCandidatesForPool, fetchJobsAsPools, selectedPool?.id]);

    useEffect(() => {
        if (!isScreenFocused) {
            return undefined;
        }
        const interval = setInterval(() => {
            fetchJobsAsPools();
            if (selectedPool?.id) {
                fetchCandidatesForPool(selectedPool.id);
            }
        }, 15000);

        return () => clearInterval(interval);
    }, [fetchCandidatesForPool, fetchJobsAsPools, isScreenFocused, selectedPool?.id]);

    const handleExplain = async () => {
        if (!selectedPool || !selectedCandidate) return;
        setLoadingExplanation(true);

        try {
            const jobId = selectedPool.id;
            const candidateId = selectedCandidate.id;
            const cacheKey = `@explain_${jobId}_${candidateId}`;

            // Try Cache
            const cached = await AsyncStorage.getItem(cacheKey);
            if (cached) {
                setExplanation(JSON.parse(cached));
                setLoadingExplanation(false);
                return;
            }

            // Fetch Fresh
            const { data } = await client.post('/api/matches/explain', {
                jobId,
                candidateId,
                matchScore: selectedCandidate.matchScore
            }, {
                __skipApiErrorHandler: true,
            });

            if (data && data.explanation) {
                setExplanation(data.explanation);
                AsyncStorage.setItem(cacheKey, JSON.stringify(data.explanation)).catch(() => null);
            }
        } catch (error) {
            logger.warn('Explanation Error:', error?.message || error);
            setExplanation(['Job seeker meets role expectations.', 'Relevant skill set matched.', 'Suitable experience verified.']);
        } finally {
            setLoadingExplanation(false);
        }
    };

    const handleViewResume = useCallback(async () => {
        if (!selectedCandidate) return;

        const resumeUrl = String(selectedCandidate?.resumeUrl || '').trim();
        if (resumeUrl) {
            try {
                const supported = await Linking.canOpenURL(resumeUrl);
                if (supported) {
                    await Linking.openURL(resumeUrl);
                    return;
                }
            } catch (error) {
                logger.warn('Resume open failed, showing fallback preview:', error?.message || error);
            }
        }

        setShowResumeModal(true);
    }, [selectedCandidate]);

    const handleUpdateApplicationStatus = useCallback(async (candidate, nextStatus) => {
        if (!selectedPool?.id || !candidate) return;
        if (!candidate.applicationId) {
            Alert.alert('Action Unavailable', 'Application link is missing for this job seeker.');
            return;
        }

        setStatusUpdating(true);
        try {
            const statusSequence = buildEmployerStatusSequence(candidate.statusRaw, nextStatus);
            if (!statusSequence.length) {
                Alert.alert('No Update Needed', 'This job seeker is already in this stage.');
                return;
            }

            for (const stepStatus of statusSequence) {
                await client.put(`/api/applications/${candidate.applicationId}/status`, { status: stepStatus }, {
                    __skipApiErrorHandler: true,
                });
            }

            await client.post('/api/matches/feedback', {
                jobId: selectedPool.id,
                candidateId: candidate.workerProfileId || candidate.userId || candidate.id,
                matchScoreAtTime: candidate.matchScore,
                userAction: nextStatus,
            }, {
                __skipApiErrorHandler: true,
            }).catch(() => null);

            await fetchJobsAsPools();
            await fetchCandidatesForPool(selectedPool.id);
            const normalizedNextStatus = normalizeApplicationStatus(statusSequence[statusSequence.length - 1] || nextStatus);
            const nextLabel = getApplicationStatusLabel(normalizedNextStatus);
            setSelectedCandidate((prev) => prev ? { ...prev, statusRaw: normalizedNextStatus, statusLabel: nextLabel } : prev);

            if (CHAT_READY_APPLICATION_STATUSES.has(normalizedNextStatus)) {
                Alert.alert('Chat Unlocked', 'Moved to Interview. You can message this job seeker from Applications.');
            }
        } catch (error) {
            logger.warn('Failed to update candidate status', error?.message || error);
            Alert.alert('Update Failed', getReadableNonAuthError(error, 'Could not update application stage.'));
        } finally {
            setStatusUpdating(false);
        }
    }, [fetchCandidatesForPool, fetchJobsAsPools, selectedPool?.id]);

    const totalJobSeekersAcrossPools = pools.reduce((sum, pool) => sum + Number(pool?.count || 0), 0);
    const activePoolsCount = pools.length;
    const selectedPoolStatusColor = getTalentStatusColor(selectedCandidate?.statusLabel);
    const selectedCandidateScoreSource = getMatchScoreSourceMeta({
        matchScoreSource: selectedCandidate?.matchScoreSource,
        matchModelVersionUsed: selectedCandidate?.matchModelVersionUsed,
        probabilisticFallbackUsed: selectedCandidate?.probabilisticFallbackUsed,
    });
    const selectedCandidateGapSignals = buildMatchGaps({
        explainability: selectedCandidate?.explainability || {},
        max: 3,
    }).map((item) => item.label);
    const candidateFreshnessSignals = [
        formatRelativeTimeLabel(selectedCandidate?.timelineTransparency?.workerLastActiveAt, {
            prefix: 'Active',
            fallback: '',
        }),
        formatRelativeTimeLabel(selectedCandidate?.timelineTransparency?.lastApplicationUpdateAt, {
            prefix: 'Stage updated',
            fallback: '',
        }),
    ].filter(Boolean);

    if (selectedCandidate) {
        return (
            <LinearGradient colors={['#f9fbff', '#f3f5ff', '#fbfcff']} style={styles.container}>
                <View style={styles.employeeGlowTop} />
                <View style={styles.employeeGlowBottom} />
                <View style={[styles.employeeTopBar, { paddingTop: insets.top + 8 }]}>
                    <TouchableOpacity onPress={() => setSelectedCandidate(null)} style={styles.talentTopBarBackBtn} activeOpacity={0.86}>
                        <Ionicons name="chevron-back" size={20} color="#0f172a" />
                    </TouchableOpacity>
                    <View style={styles.employeeTopBarCopy}>
                        <Text style={styles.employeeTopBarEyebrow}>Talent Review</Text>
                        <Text style={styles.employeeTopBarTitle} numberOfLines={1}>{selectedCandidate.name}</Text>
                    </View>
                </View>

                <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <View style={styles.employeeOverviewCard}>
                        <View style={styles.employeeOverviewTopRow}>
                            <Image
                                source={{ uri: String(selectedCandidate?.avatar || '').trim() || `https://ui-avatars.com/api/?name=${encodeURIComponent(selectedCandidate.name)}&background=7c3aed&color=fff&size=256` }}
                                style={styles.employeeOverviewAvatar}
                            />
                            <View style={styles.employeeOverviewCopy}>
                                <View style={styles.employeeOverviewPill}>
                                    <Ionicons name="sparkles-outline" size={11} color="#6d28d9" />
                                    <Text style={styles.employeeOverviewPillText}>{selectedCandidate.statusLabel || 'Applied'}</Text>
                                </View>
                                <Text style={styles.employeeOverviewTitle}>{selectedCandidate.name}</Text>
                                <Text style={styles.employeeOverviewSubtitle}>
                                    {[selectedCandidate.roleTitle, selectedCandidate.location].filter(Boolean).join(' • ')}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.employeeOverviewMetrics}>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>
                                    {Number.isFinite(Number(selectedCandidate.matchScore)) ? `${Math.round(Number(selectedCandidate.matchScore))}%` : 'N/A'}
                                </Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Match</Text>
                            </View>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>
                                    {Number.isFinite(Number(selectedCandidate.profilePercentile)) ? `${Math.round(Number(selectedCandidate.profilePercentile))}th` : 'N/A'}
                                </Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Percentile</Text>
                            </View>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>{`${Number(selectedCandidate.experienceYears || 0)} yrs`}</Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Experience</Text>
                            </View>
                        </View>

                        <View style={styles.talentInsightRail}>
                            <View style={[styles.talentInsightChip, styles.talentInsightChipAccent]}>
                                <Ionicons name="sparkles-outline" size={12} color="#6d28d9" />
                                <Text style={[styles.talentInsightChipText, styles.talentInsightChipTextAccent]}>
                                    {selectedCandidateScoreSource.label}
                                </Text>
                            </View>
                            {selectedCandidate.confidenceScore > 0 ? (
                                <View style={styles.talentInsightChip}>
                                    <Text style={styles.talentInsightChipText}>
                                        {Math.round(Math.max(0, Math.min(1, Number(selectedCandidate.confidenceScore || 0))) * 100)}% confidence
                                    </Text>
                                </View>
                            ) : null}
                            {candidateFreshnessSignals.map((signal) => (
                                <View key={signal} style={styles.talentInsightChip}>
                                    <Text style={styles.talentInsightChipText}>{signal}</Text>
                                </View>
                            ))}
                        </View>

                        <View style={styles.employeeOverviewActions}>
                            <TouchableOpacity style={styles.employeeOverviewPrimaryAction} onPress={handleViewResume} activeOpacity={0.88}>
                                <LinearGradient colors={['#7c3aed', '#a855f7']} style={styles.employeeOverviewPrimaryActionGradient}>
                                    <Ionicons name="document-text-outline" size={14} color="#ffffff" />
                                    <Text style={styles.employeeOverviewPrimaryActionText}>Resume</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.employeeOverviewSecondaryAction} onPress={handleExplain} activeOpacity={0.82}>
                                <Ionicons name="sparkles-outline" size={14} color="#6d28d9" />
                                <Text style={styles.employeeOverviewSecondaryActionText}>
                                    {loadingExplanation ? 'Analyzing…' : 'Why match'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.empProfileCard}>
                        <View style={styles.talentPanelHeader}>
                            <Text style={styles.talentPanelTitle}>Summary</Text>
                            {selectedCandidate.interviewVerified ? (
                                <View style={styles.talentPanelBadge}>
                                    <Text style={styles.talentPanelBadgeText}>Verified</Text>
                                </View>
                            ) : null}
                        </View>
                        <Text style={styles.summaryText}>{selectedCandidate.summary}</Text>
                        {selectedCandidate.whyMatch ? (
                            <Text style={styles.matchWhyText}>Why this matches: {selectedCandidate.whyMatch}</Text>
                        ) : null}
                        {selectedCandidate.topReasons?.length ? (
                            <View style={styles.talentReasonRail}>
                                {selectedCandidate.topReasons.slice(0, 3).map((reason) => (
                                    <View key={reason} style={styles.signalChip}>
                                        <Text style={styles.signalChipText}>{reason}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </View>

                    <View style={styles.empProfileCard}>
                        <View style={styles.talentPanelHeader}>
                            <Text style={styles.talentPanelTitle}>Signals</Text>
                            <View style={styles.profileStrengthChip}>
                                <Text style={styles.profileStrengthChipText}>
                                    {selectedCandidate.profileStrengthLabel || 'Profile strength pending'}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.signalChipRail}>
                            {(selectedCandidate.skills || []).slice(0, 6).map((skill) => (
                                <View key={skill} style={styles.signalChip}>
                                    <Text style={styles.signalChipText}>{skill}</Text>
                                </View>
                            ))}
                            {(!selectedCandidate.skills || selectedCandidate.skills.length === 0) ? (
                                <View style={styles.signalChipMuted}>
                                    <Text style={styles.signalChipMutedText}>Skills will appear here</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>

                    {selectedCandidateGapSignals.length ? (
                        <View style={styles.empProfileCard}>
                            <View style={styles.talentPanelHeader}>
                                <Text style={styles.talentPanelTitle}>What to improve</Text>
                            </View>
                            {selectedCandidateGapSignals.map((gap, index) => (
                                <Text key={`candidate-gap-${index}`} style={styles.talentGapText}>• {gap}</Text>
                            ))}
                        </View>
                    ) : null}

                    <View style={styles.empProfileCard}>
                        <View style={styles.talentPanelHeader}>
                            <Text style={styles.talentPanelTitle}>AI analysis</Text>
                            <View style={[styles.statusChip, { backgroundColor: `${selectedPoolStatusColor}18`, borderColor: `${selectedPoolStatusColor}33` }]}>
                                <Text style={[styles.statusChipText, { color: selectedPoolStatusColor }]}>
                                    {selectedCandidate.statusLabel || 'Applied'}
                                </Text>
                            </View>
                        </View>
                        {explanation ? (
                            <View style={styles.aiExplanationWrap}>
                                {explanation.map((bullet, idx) => (
                                    <Text key={idx} style={[styles.summaryText, styles.aiExplanationText]}>• {bullet}</Text>
                                ))}
                            </View>
                        ) : (
                            <Text style={styles.aiHintText}>Explainability helps recruiters understand why this job seeker surfaced for the role.</Text>
                        )}
                    </View>

                    <View style={[styles.empProfileCard, styles.talentDecisionCard]}>
                        <View style={styles.talentPanelHeader}>
                            <Text style={styles.talentPanelTitle}>Move this job seeker</Text>
                            <View style={styles.decisionPanelBadge}>
                                <Text style={styles.decisionPanelBadgeText}>{selectedCandidate.statusLabel || 'Applied'}</Text>
                            </View>
                        </View>
                        <View style={styles.actionRowContainer}>
                            <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnReject, statusUpdating && styles.actionBtnDisabled]}
                                onPress={() => handleUpdateApplicationStatus(selectedCandidate, 'rejected')}
                                disabled={statusUpdating}
                            >
                                <Ionicons name="close" size={18} color="#fff" />
                                <Text style={styles.actionBtnTextWhite}>Skip</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnShortlist, statusUpdating && styles.actionBtnDisabled]}
                                onPress={() => handleUpdateApplicationStatus(selectedCandidate, 'shortlisted')}
                                disabled={statusUpdating}
                            >
                                <Ionicons name="bookmark" size={16} color="#fff" />
                                <Text style={styles.actionBtnTextWhite}>Shortlist</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.actionBtn, styles.actionBtnInterview, statusUpdating && styles.actionBtnDisabled]}
                                onPress={() => handleUpdateApplicationStatus(selectedCandidate, 'interview_requested')}
                                disabled={statusUpdating}
                            >
                                <Ionicons name="sparkles-outline" size={18} color="#fff" />
                                <Text style={styles.actionBtnTextWhite}>Interview</Text>
                            </TouchableOpacity>
                        </View>
                        {CHAT_READY_APPLICATION_STATUSES.has(String(selectedCandidate.statusRaw || '').toLowerCase()) && selectedCandidate.applicationId ? (
                            <TouchableOpacity
                                style={styles.chatCtaBtn}
                                onPress={() => navigation.navigate('Chat', {
                                    applicationId: selectedCandidate.applicationId,
                                })}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.chatCtaText}>Open Chat</Text>
                            </TouchableOpacity>
                        ) : null}
                    </View>
                </ScrollView>

                <Modal
                    visible={showResumeModal}
                    transparent
                    animationType="slide"
                    onRequestClose={() => setShowResumeModal(false)}
                >
                    <View style={styles.resumeModalBackdrop}>
                        <View style={styles.resumeModalCard}>
                            <View style={styles.resumeModalHeader}>
                                <Text style={styles.resumeModalTitle}>Resume Preview</Text>
                                <TouchableOpacity onPress={() => setShowResumeModal(false)} style={styles.resumeModalCloseBtn}>
                                    <Ionicons name="close" size={20} color="#64748b" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView showsVerticalScrollIndicator={false}>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Name:</Text> {selectedCandidate.name}</Text>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Role:</Text> {selectedCandidate.roleTitle}</Text>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Experience:</Text> {selectedCandidate.experienceYears} Years</Text>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Location:</Text> {selectedCandidate.location}</Text>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Skills:</Text> {(selectedCandidate.skills || []).join(', ') || 'Not provided'}</Text>
                                <Text style={styles.resumePreviewLine}><Text style={styles.resumePreviewLabel}>Profile Strength:</Text> {selectedCandidate.profileStrengthLabel}</Text>
                                <Text style={styles.resumePreviewLine}>
                                    <Text style={styles.resumePreviewLabel}>Match Score:</Text>{' '}
                                    {Number.isFinite(Number(selectedCandidate.matchScore)) ? `${Math.round(Number(selectedCandidate.matchScore))}%` : 'N/A'}
                                </Text>

                                {selectedCandidate.transcript ? (
                                    <>
                                        <Text style={styles.resumeTranscriptTitle}>Interview Transcript</Text>
                                        <Text style={styles.resumeTranscriptText}>{selectedCandidate.transcript}</Text>
                                    </>
                                ) : null}
                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            </LinearGradient>
        );
    }

    if (selectedPool) {
        if (!selectedPool.id) {
            return (
                <View style={[styles.container, { backgroundColor: '#f7f9ff' }]}>
                    <EmptyState
                        title="No Job Selected"
                        message="Select a job to view job seekers."
                        icon={<Ionicons name="briefcase-outline" size={56} color="#94a3b8" />}
                        actionLabel="Back to Talent Pools"
                        onAction={() => setSelectedPool(null)}
                    />
                </View>
            );
        }

        const primaryCandidateLocation = String(
            candidates.find((candidate) => String(candidate?.location || '').trim().length > 0)?.location || ''
        ).trim();
        const headerTitle = primaryCandidateLocation
            ? `${selectedPool.name} - ${primaryCandidateLocation}`
            : String(selectedPool.name || 'Talent');
        const livePoolCount = Number(
            pools.find((pool) => String(pool.id) === String(selectedPool.id))?.count
            ?? selectedPool.count
            ?? 0
        );
        const visibleCandidateCount = loadingCandidates
            ? livePoolCount
            : Number(candidates.length || 0);

        return (
            <LinearGradient colors={['#f9fbff', '#f3f5ff', '#fbfcff']} style={styles.container}>
                <View style={styles.employeeGlowTop} />
                <View style={styles.employeeGlowBottom} />
                <View style={[styles.employeeTopBar, { paddingTop: insets.top + 8 }]}>
                    <TouchableOpacity onPress={handleBackFromPool} style={styles.talentTopBarBackBtn} activeOpacity={0.86}>
                        <Ionicons name="chevron-back" size={20} color="#0f172a" />
                    </TouchableOpacity>
                    <View style={styles.employeeTopBarCopy}>
                        <Text style={styles.employeeTopBarEyebrow}>Talent Pool</Text>
                        <Text style={styles.employeeTopBarTitle} numberOfLines={1}>{selectedPool.name}</Text>
                    </View>
                </View>

                <View style={styles.content}>
                    <View style={styles.listContainer}>
                        <View style={styles.employeeOverviewCard}>
                            <View style={styles.employeeOverviewTopRow}>
                                <View style={styles.talentHeroGlyphWrap}>
                                    <Ionicons name="people-outline" size={28} color="#6d28d9" />
                                </View>
                                <View style={styles.employeeOverviewCopy}>
                                    <View style={styles.employeeOverviewPill}>
                                        <Ionicons name="briefcase-outline" size={11} color="#6d28d9" />
                                        <Text style={styles.employeeOverviewPillText}>Open pool</Text>
                                    </View>
                                    <Text style={styles.employeeOverviewTitle}>{selectedPool.name}</Text>
                                    <Text style={styles.employeeOverviewSubtitle}>{headerTitle}</Text>
                                </View>
                            </View>

                            <View style={styles.employeeOverviewMetrics}>
                                <View style={styles.employeeOverviewMetricPill}>
                                    <Text style={styles.employeeOverviewMetricValue}>{formatCompactTalentNumber(visibleCandidateCount)}</Text>
                                    <Text style={styles.employeeOverviewMetricLabel}>Visible</Text>
                                </View>
                                <View style={styles.employeeOverviewMetricPill}>
                                    <Text style={styles.employeeOverviewMetricValue}>
                                        {formatCompactTalentNumber(candidates.filter((candidate) => CHAT_READY_APPLICATION_STATUSES.has(String(candidate?.statusRaw || '').toLowerCase())).length)}
                                    </Text>
                                    <Text style={styles.employeeOverviewMetricLabel}>Chat Ready</Text>
                                </View>
                                <View style={styles.employeeOverviewMetricPill}>
                                    <Text style={styles.employeeOverviewMetricValue}>
                                        {formatCompactTalentNumber(candidates.filter((candidate) => candidate?.interviewVerified).length)}
                                    </Text>
                                    <Text style={styles.employeeOverviewMetricLabel}>Verified</Text>
                                </View>
                            </View>
                        </View>

                        {loadingCandidates ? (
                            <View>
                                <SkeletonLoader height={152} style={{ borderRadius: 24, marginBottom: 14 }} />
                                <SkeletonLoader height={152} style={{ borderRadius: 24, marginBottom: 14 }} />
                                <SkeletonLoader height={152} style={{ borderRadius: 24, marginBottom: 14 }} />
                            </View>
                        ) : profileGateMessage ? (
                            <EmptyState
                                icon="🧩"
                                title="Finish your Employer profile"
                                subtitle={profileGateMessage}
                                actionLabel="Complete Profile"
                                onAction={() => navigation.navigate('EmployerProfileCreate')}
                            />
                        ) : candidates.length === 0 ? (
                            <EmptyState
                                icon="👥"
                                title="No job seekers found"
                                subtitle="Matches will appear as job seekers update their profiles."
                            />
                        ) : (
                            <FlatList
                                data={candidates}
                                keyExtractor={(item, index) => String(item?.id || `candidate-${index}`)}
                                renderItem={({ item: profile }) => (
                                    <View style={styles.empProfileCard}>
                                        <View style={styles.empProfTopRow}>
                                            <View style={styles.empProfIdentityWrap}>
                                                {String(profile?.avatar || '').trim() ? (
                                                    <Image source={{ uri: profile.avatar }} style={styles.talentCandidateAvatarImage} />
                                                ) : (
                                                    <View style={styles.talentCandidateAvatarWrap}>
                                                        <Text style={styles.talentCandidateAvatarText}>
                                                            {String(profile?.name || 'Job Seeker').trim().charAt(0).toUpperCase() || 'J'}
                                                        </Text>
                                                    </View>
                                                )}
                                                <View style={styles.empProfTitleWrap}>
                                                    <Text style={styles.empProfTitle} numberOfLines={1}>{String(profile.name || 'Job Seeker')}</Text>
                                                    <Text style={styles.empProfSubtitle} numberOfLines={2}>
                                                        {String(profile.roleTitle || 'Job Seeker')} • {String(profile.location || 'Remote')}
                                                    </Text>
                                                </View>
                                            </View>
                                            <View style={styles.empProfBadgeRow}>
                                                <View style={[styles.statusChip, { backgroundColor: `${getTalentStatusColor(profile.statusLabel)}18`, borderColor: `${getTalentStatusColor(profile.statusLabel)}33` }]}>
                                                    <Text style={[styles.statusChipText, { color: getTalentStatusColor(profile.statusLabel) }]}>{profile.statusLabel}</Text>
                                                </View>
                                            </View>
                                        </View>

                                        <Text style={styles.talentCandidateSummary} numberOfLines={2}>
                                            {String(profile.summary || 'Profile summary will appear here as the job seeker fills details.')}
                                        </Text>

                                        <View style={styles.empProfMetaRow}>
                                            <View style={[styles.empProfMetaChip, styles.empProfMetaChipPrimary]}>
                                                <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextPrimary]}>
                                                    {Number.isFinite(Number(profile.matchScore)) ? `${Math.round(Number(profile.matchScore))}% match` : 'Match pending'}
                                                </Text>
                                            </View>
                                            <View style={styles.empProfMetaChip}>
                                                <Text style={styles.empProfMetaChipText}>{`${Number(profile.experienceYears || 0)} yrs`}</Text>
                                            </View>
                                            {profile.interviewVerified ? (
                                                <View style={[styles.empProfMetaChip, styles.empProfMetaChipAccent]}>
                                                    <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextAccent]}>Verified</Text>
                                                </View>
                                            ) : null}
                                        </View>

                                        <View style={styles.empProfFooter}>
                                            <View style={styles.empProfLocRow}>
                                                <Ionicons name="location-outline" size={12} color="#94a3b8" />
                                                <Text style={styles.empProfLocText} numberOfLines={1}>{String(profile.location || 'Remote')}</Text>
                                            </View>
                                            <TouchableOpacity style={styles.empProfEditBtn} onPress={() => setSelectedCandidate(profile)} activeOpacity={0.84}>
                                                <Text style={styles.empProfEditText}>Review</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                )}
                                getItemLayout={(data, index) => ({
                                    length: 164,
                                    offset: 164 * index,
                                    index,
                                })}
                                maxToRenderPerBatch={10}
                                windowSize={10}
                                removeClippedSubviews={Platform.OS === 'android'}
                                initialNumToRender={10}
                                showsVerticalScrollIndicator={false}
                                ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
                            />
                        )}
                    </View>
                </View>
            </LinearGradient>
        );
    }

    return (
        <LinearGradient colors={['#f9fbff', '#f3f5ff', '#fbfcff']} style={styles.container}>
            <View style={styles.employeeGlowTop} />
            <View style={styles.employeeGlowBottom} />
            <View style={[styles.employeeTopBar, { paddingTop: insets.top + 8 }]}>
                <View style={styles.employeeTopBarCopy}>
                    <Text style={styles.employeeTopBarEyebrow}>Employer Talent</Text>
                    <Text style={styles.employeeTopBarTitle}>Talent</Text>
                </View>
            </View>

            <View style={styles.content}>
                <View style={styles.listContainer}>
                    <View style={styles.employeeOverviewCard}>
                        <View style={styles.employeeOverviewTopRow}>
                            <View style={styles.talentHeroGlyphWrap}>
                                <Ionicons name="people-outline" size={28} color="#6d28d9" />
                            </View>
                            <View style={styles.employeeOverviewCopy}>
                                <View style={styles.employeeOverviewPill}>
                                    <Ionicons name="sparkles-outline" size={11} color="#6d28d9" />
                                    <Text style={styles.employeeOverviewPillText}>Employer mode</Text>
                                </View>
                                <Text style={styles.employeeOverviewTitle}>Talent pools</Text>
                                <Text style={styles.employeeOverviewSubtitle}>
                                    {pools.length > 0
                                        ? 'Review ranked job seekers role by role.'
                                        : 'Post one clear job and your talent pools will appear here.'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.employeeOverviewMetrics}>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>{formatCompactTalentNumber(activePoolsCount)}</Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Roles</Text>
                            </View>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>{formatCompactTalentNumber(totalJobSeekersAcrossPools)}</Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Job Seekers</Text>
                            </View>
                            <View style={styles.employeeOverviewMetricPill}>
                                <Text style={styles.employeeOverviewMetricValue}>
                                    {activePoolsCount > 0 ? formatCompactTalentNumber(totalJobSeekersAcrossPools / activePoolsCount) : '0'}
                                </Text>
                                <Text style={styles.employeeOverviewMetricLabel}>Avg / Role</Text>
                            </View>
                        </View>

                        <View style={styles.employeeOverviewActions}>
                            <TouchableOpacity style={styles.employeeOverviewPrimaryAction} onPress={handleOpenQuickPost} activeOpacity={0.88}>
                                <LinearGradient colors={['#7c3aed', '#a855f7']} style={styles.employeeOverviewPrimaryActionGradient}>
                                    <Ionicons name="add" size={14} color="#ffffff" />
                                    <Text style={styles.employeeOverviewPrimaryActionText}>Post job</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.employeeOverviewSecondaryAction} onPress={fetchJobsAsPools} activeOpacity={0.82}>
                                <Ionicons name="refresh-outline" size={14} color="#6d28d9" />
                                <Text style={styles.employeeOverviewSecondaryActionText}>Refresh</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {loadingPools ? (
                        <View>
                            <SkeletonLoader height={168} style={{ borderRadius: 24, marginBottom: 16 }} />
                            <SkeletonLoader height={168} style={{ borderRadius: 24, marginBottom: 16 }} />
                            <SkeletonLoader height={168} style={{ borderRadius: 24, marginBottom: 16 }} />
                        </View>
                    ) : pools.length === 0 ? (
                        <EmptyState
                            icon="📭"
                            title="No job seekers yet"
                            subtitle="Your job posts will surface ranked job seeker matches here."
                        />
                    ) : (
                        <FlatList
                            data={pools}
                            keyExtractor={(item, index) => String(item?.id || `pool-${index}`)}
                            renderItem={({ item: pool }) => (
                                <View style={styles.empProfileCard}>
                                    <View style={styles.empProfTopRow}>
                                        <View style={styles.empProfIdentityWrap}>
                                            <View style={styles.talentPoolAvatarWrap}>
                                                <Ionicons name="briefcase-outline" size={20} color="#6d28d9" />
                                            </View>
                                            <View style={styles.empProfTitleWrap}>
                                                <Text style={styles.empProfTitle}>{pool.name}</Text>
                                                <Text style={styles.empProfSubtitle}>Shortlist, interview, and chat from one pool.</Text>
                                            </View>
                                        </View>
                                        <View style={styles.empProfBadgeRow}>
                                            <View style={styles.empProfDefaultBadge}>
                                                <Text style={styles.empProfDefaultText}>{formatCompactTalentNumber(pool.count)}</Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.empProfMetaRow}>
                                        <View style={[styles.empProfMetaChip, styles.empProfMetaChipPrimary]}>
                                            <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextPrimary]}>
                                                {pool.count ? `${pool.count} job seekers` : 'Pool starting'}
                                            </Text>
                                        </View>
                                        {pool.tags?.[0] ? (
                                            <View style={styles.empProfMetaChip}>
                                                <Text style={styles.empProfMetaChipText}>{pool.tags[0]}</Text>
                                            </View>
                                        ) : null}
                                        <View style={[styles.empProfMetaChip, styles.empProfMetaChipAccent]}>
                                            <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextAccent]}>Talent</Text>
                                        </View>
                                    </View>

                                    <View style={styles.empProfFooter}>
                                        <View style={styles.empProfLocRow}>
                                            <Ionicons name="sparkles-outline" size={12} color="#94a3b8" />
                                            <Text style={styles.empProfLocText}>Ranked for this role</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.empProfEditBtn}
                                            onPress={() => handleSelectPool(pool)}
                                            activeOpacity={0.84}
                                        >
                                            <Text style={styles.empProfEditText}>Review talent</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                            getItemLayout={(data, index) => ({
                                length: 168,
                                offset: 168 * index,
                                index,
                            })}
                            maxToRenderPerBatch={10}
                            windowSize={10}
                            removeClippedSubviews={Platform.OS === 'android'}
                            initialNumToRender={10}
                            showsVerticalScrollIndicator={false}
                        />
                    )}
                </View>
            </View>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    employeeGlowTop: {
        position: 'absolute',
        top: -96,
        right: -72,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(139, 108, 255, 0.16)',
    },
    employeeGlowBottom: {
        position: 'absolute',
        left: -54,
        bottom: -72,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: 'rgba(96, 165, 250, 0.14)',
    },
    employeeTopBar: {
        paddingHorizontal: 18,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    talentTopBarBackBtn: {
        ...SCREEN_CHROME.actionButton,
        width: 42,
        height: 42,
        borderRadius: 18,
    },
    employeeTopBarCopy: {
        flex: 1,
        minWidth: 0,
    },
    employeeTopBarEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c8798',
        letterSpacing: 0.9,
        textTransform: 'uppercase',
    },
    employeeTopBarTitle: {
        marginTop: 2,
        fontSize: 24,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.5,
    },
    employeeTopBarAction: {
        ...SHADOWS.sm,
        borderRadius: 20,
        overflow: 'hidden',
    },
    employeeTopBarActionGradient: {
        width: 46,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 26,
    },
    employeeOverviewCard: {
        ...SCREEN_CHROME.heroSurface,
        borderRadius: 26,
        padding: 18,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.52)',
    },
    employeeOverviewTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    employeeOverviewAvatar: {
        width: 62,
        height: 62,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.94)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.72)',
    },
    talentHeroGlyphWrap: {
        width: 62,
        height: 62,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#e9ddff',
    },
    employeeOverviewCopy: {
        flex: 1,
        minWidth: 0,
    },
    employeeOverviewPill: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        alignSelf: 'flex-start',
        gap: 6,
        marginBottom: 8,
    },
    employeeOverviewPillText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#6d28d9',
        letterSpacing: 0.3,
    },
    employeeOverviewTitle: {
        fontSize: 26,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.55,
    },
    employeeOverviewSubtitle: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: '600',
        color: '#64748b',
    },
    employeeOverviewMetrics: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 14,
    },
    talentInsightRail: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    talentInsightChip: {
        ...SCREEN_CHROME.signalChip,
    },
    talentInsightChipAccent: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    talentInsightChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    talentInsightChipTextAccent: {
        color: '#6d28d9',
    },
    employeeOverviewMetricPill: {
        ...SCREEN_CHROME.metricTile,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    employeeOverviewMetricValue: {
        fontSize: 13,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.3,
    },
    employeeOverviewMetricLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    employeeOverviewActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 16,
    },
    employeeOverviewPrimaryAction: {
        flex: 1,
        borderRadius: 16,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    employeeOverviewPrimaryActionGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    employeeOverviewPrimaryActionText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
    employeeOverviewSecondaryAction: {
        minWidth: 114,
        ...SCREEN_CHROME.signalChip,
        paddingHorizontal: 14,
        paddingVertical: 12,
        justifyContent: 'center',
        gap: 7,
    },
    employeeOverviewSecondaryActionText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6d28d9',
    },
    empProfileCard: {
        ...SCREEN_CHROME.contentCard,
        padding: 15,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.52)',
        marginBottom: 14,
    },
    empProfTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
        gap: 10,
    },
    empProfIdentityWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
        gap: 12,
    },
    talentPoolAvatarWrap: {
        width: 50,
        height: 50,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#e9ddff',
    },
    talentCandidateAvatarWrap: {
        width: 50,
        height: 50,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ede9fe',
        borderWidth: 1,
        borderColor: '#ddd6fe',
    },
    talentCandidateAvatarText: {
        fontSize: 22,
        fontWeight: '800',
        color: '#6d28d9',
    },
    talentCandidateAvatarImage: {
        width: 50,
        height: 50,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
    },
    empProfTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    empProfTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.3,
    },
    empProfSubtitle: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
        color: '#64748b',
    },
    empProfBadgeRow: {
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
    },
    empProfDefaultBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    empProfDefaultText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6d28d9',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    empProfMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    empProfMetaChip: {
        ...SCREEN_CHROME.signalChip,
    },
    empProfMetaChipPrimary: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    empProfMetaChipAccent: {
        borderColor: '#d1fae5',
        backgroundColor: '#ecfdf5',
    },
    empProfMetaChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    empProfMetaChipTextPrimary: {
        color: '#6d28d9',
    },
    empProfMetaChipTextAccent: {
        color: '#047857',
    },
    talentCandidateSummary: {
        marginBottom: 10,
        fontSize: 12,
        lineHeight: 18,
        fontWeight: '600',
        color: '#64748b',
    },
    empProfFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    empProfLocRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
    },
    empProfLocText: {
        fontSize: 11.5,
        fontWeight: '600',
        color: '#64748b',
    },
    empProfEditBtn: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    empProfEditText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#6d28d9',
    },
    talentPanelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 10,
    },
    talentPanelTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#111827',
    },
    talentPanelBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    talentPanelBadgeText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6d28d9',
    },
    aiExplanationWrap: {
        gap: 8,
    },
    talentDecisionCard: {
        paddingBottom: 16,
    },
    screenSurface: {
        backgroundColor: '#f6f8fc',
    },
    headerChrome: {
        ...SCREEN_CHROME.headerSurface,
        paddingHorizontal: 18,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...SHADOWS.sm,
        zIndex: 10,
    },
    talentHeaderTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    talentHeaderEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c8798',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    talentHeaderTitle: {
        marginTop: 3,
        color: '#111827',
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    headerPurple: {
        backgroundColor: '#9333ea',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
        zIndex: 10,
    },
    poolScreenContainer: {
        backgroundColor: '#eceff3',
    },
    poolHeader: {
        paddingBottom: 14,
    },
    poolBackButton: {
        ...SCREEN_CHROME.actionButton,
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    poolHeaderTextWrap: {
        flex: 1,
        justifyContent: 'center',
    },
    backButton: {
        ...SCREEN_CHROME.actionButton,
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    headerTitleWhite: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: 'bold',
    },
    headerSubtitleWhite: {
        color: '#e9d5ff',
        fontSize: 10,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginTop: 2,
    },
    filterRow: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
        backgroundColor: '#faf5ff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3e8ff',
    },
    filterPill: {
        backgroundColor: '#ede9fe',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 9999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
    },
    filterPillActive: {
        backgroundColor: '#7c3aed',
        borderColor: '#6d28d9',
    },
    filterPillText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#6b21a8',
    },
    filterPillTextActive: {
        color: '#fff',
    },
    headerPurpleLarge: {
        paddingHorizontal: 24,
        paddingBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
        elevation: 4,
        zIndex: 10,
    },
    largeHeaderTitle: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: '800',
    },
    talentHeaderTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    quickPostButton: {
        ...SCREEN_CHROME.actionButton,
        alignItems: 'center',
        justifyContent: 'center',
        width: 42,
        height: 42,
        borderRadius: 16,
    },
    quickPostButtonText: {
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '800',
    },
    content: {
        flex: 1,
    },
    detailContent: {
        paddingBottom: 24,
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 14,
    },
    poolListContainer: {
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 10,
    },
    poolHeroCard: {
        ...SCREEN_CHROME.heroSurface,
        paddingHorizontal: 16,
        paddingVertical: 16,
        marginBottom: 16,
    },
    poolHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    poolHeroBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    poolHeroBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    poolHeroCta: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    poolHeroCtaText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    poolHeroPill: {
        ...SCREEN_CHROME.signalChip,
    },
    poolHeroPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#475569',
    },
    poolHeroTitle: {
        marginTop: 14,
        fontSize: 22,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.4,
    },
    poolHeroSubtitle: {
        marginTop: 5,
        fontSize: 12.5,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    poolHeroStatsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 14,
    },
    poolHeroStatCard: {
        ...SCREEN_CHROME.metricTile,
    },
    poolHeroStatLabel: {
        fontSize: 10.5,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        color: '#94a3b8',
    },
    poolHeroStatValue: {
        marginTop: 6,
        fontSize: 16,
        fontWeight: '800',
        color: '#111827',
    },
    poolCard: {
        ...SCREEN_CHROME.contentCard,
        padding: 18,
        marginBottom: 16,
    },
    poolCardTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 14,
    },
    poolCardGlyphWrap: {
        width: 44,
        height: 44,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#e9ddff',
    },
    poolCardCopy: {
        flex: 1,
        minWidth: 0,
    },
    poolCardSubtitle: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '600',
        color: '#64748b',
    },
    poolCardCountTile: {
        minWidth: 70,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e9ddff',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 10,
        paddingVertical: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    poolCardCountValue: {
        fontSize: 18,
        fontWeight: '800',
        color: '#6d28d9',
    },
    poolCardCountLabel: {
        marginTop: 2,
        fontSize: 10.5,
        fontWeight: '800',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: '#a78bfa',
    },
    poolCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    poolCardTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1e293b',
        flex: 1,
    },
    poolCardSignalRail: {
        marginTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    poolCardBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    poolCardBadgeText: {
        color: '#6b21a8',
        fontSize: 12,
        fontWeight: '600',
    },
    poolCardTagChip: {
        ...SCREEN_CHROME.signalChip,
    },
    poolCardTagText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    viewCandidatesBtn: {
        width: '100%',
        paddingVertical: 13,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        flexDirection: 'row',
        gap: 8,
    },
    viewCandidatesBtnText: {
        color: '#9333ea',
        fontSize: 15,
        fontWeight: '700',
    },
    candidateCard: {
        backgroundColor: '#FFF',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        flexDirection: 'row',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        marginBottom: 16,
    },
    smallAvatar: {
        width: 48,
        height: 48,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    candidateCardContent: {
        flex: 1,
        marginLeft: 16,
        justifyContent: 'center',
    },
    candidateTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    candidateCardTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#0f172a',
        marginBottom: 4,
    },
    statusChip: {
        borderRadius: 9999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    statusChipText: {
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    candidateCardSubtitle: {
        fontSize: 12,
        color: '#64748b',
    },
    poolCandidateCard: {
        ...SCREEN_CHROME.contentCard,
        borderRadius: 18,
        paddingVertical: 14,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
    },
    poolCandidateCodeWrap: {
        width: 52,
        height: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#e9ddff',
        marginRight: 14,
    },
    poolCandidateCode: {
        color: '#6d28d9',
        fontSize: 20,
        fontWeight: '800',
        letterSpacing: 0.2,
        includeFontPadding: false,
    },
    poolCandidateBody: {
        flex: 1,
        justifyContent: 'center',
    },
    poolCandidateTitle: {
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '800',
    },
    poolCandidateTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    poolCandidateRole: {
        marginTop: 4,
        color: '#64748b',
        fontSize: 12.5,
        fontWeight: '700',
    },
    poolCandidateSummary: {
        marginTop: 6,
        color: '#64748b',
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '600',
    },
    poolCandidateMeta: {
        marginTop: 4,
        color: '#64748b',
        fontSize: 13,
        fontWeight: '500',
    },
    poolCandidateSignalRail: {
        marginTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    poolCandidateSignalChip: {
        ...SCREEN_CHROME.signalChip,
    },
    poolCandidateSignalText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#64748b',
    },
    poolCandidateChevron: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#edf1f7',
        marginLeft: 10,
    },
    candidateVerifiedInline: {
        marginTop: 4,
        fontSize: 11,
        color: '#059669',
        fontWeight: '700',
    },
    candidateVerifiedInlineGlow: {
        textShadowColor: 'rgba(16,185,129,0.26)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
    },
    candidateStrengthInline: {
        marginTop: 3,
        fontSize: 11,
        color: '#7c3aed',
        fontWeight: '700',
    },
    candidateClarityInline: {
        marginTop: 3,
        fontSize: 11,
        color: '#475569',
        fontWeight: '600',
    },
    candidateHeroCard: {
        ...SCREEN_CHROME.heroSurface,
        marginHorizontal: 16,
        marginTop: 16,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    candidateIdentityRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    candidateHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    candidateHeroCopy: {
        flex: 1,
        minWidth: 0,
    },
    bigAvatar: {
        width: 78,
        height: 78,
        borderRadius: 26,
        borderWidth: 2,
        borderColor: '#ede9fe',
    },
    bigCandidateName: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    candidateRoleText: {
        marginTop: 4,
        fontSize: 14,
        color: '#64748b',
        fontWeight: '700',
    },
    locationRow: {
        marginTop: 7,
        flexDirection: 'row',
        alignItems: 'center',
    },
    locationText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748b',
        marginLeft: 4,
    },
    candidateSignalRail: {
        marginTop: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    verifiedInterviewBadge: {
        backgroundColor: 'rgba(16,185,129,0.14)',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(16,185,129,0.32)',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    verifiedInterviewBadgeGlow: {
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.22,
        shadowRadius: 8,
        elevation: 3,
    },
    verifiedInterviewBadgeText: {
        color: '#065f46',
        fontSize: 11,
        fontWeight: '700',
    },
    profileStrengthChip: {
        marginTop: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    profileStrengthChipText: {
        color: '#1d4ed8',
        fontSize: 11,
        fontWeight: '700',
    },
    clarityTagChip: {
        marginTop: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    clarityTagChipText: {
        color: '#6d28d9',
        fontSize: 11,
        fontWeight: '700',
    },
    metricChipRow: {
        marginTop: 14,
        flexDirection: 'row',
        gap: 8,
    },
    metricChip: {
        ...SCREEN_CHROME.metricTile,
        paddingHorizontal: 10,
        paddingVertical: 6,
        minWidth: 96,
        flex: 1,
        alignItems: 'center',
    },
    metricChipLabel: {
        color: '#7c3aed',
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    metricChipValue: {
        marginTop: 2,
        color: '#4c1d95',
        fontSize: 14,
        fontWeight: '800',
    },
    sectionContainer: {
        padding: 16,
    },
    card: {
        ...SCREEN_CHROME.contentCard,
        padding: 16,
    },
    cardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    cardTitle: {
        fontWeight: 'bold',
        color: '#0f172a',
        fontSize: 16,
    },
    resumeButton: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    resumeButtonText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#9333ea',
    },
    summaryText: {
        fontSize: 14,
        color: '#475569',
        lineHeight: 22,
    },
    skillsPanel: {
        ...SCREEN_CHROME.contentCard,
        marginTop: 16,
        padding: 16,
    },
    signalChipRail: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    signalChip: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    signalChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6d28d9',
    },
    signalChipMuted: {
        ...SCREEN_CHROME.signalChip,
    },
    signalChipMutedText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    aiCard: {
        marginTop: 16,
        backgroundColor: '#eef2ff',
        borderColor: '#e0e7ff',
    },
    aiCardTitle: {
        color: '#3730a3',
    },
    aiExplainButton: {
        backgroundColor: '#9333ea',
        borderColor: '#7e22ce',
    },
    aiExplainButtonText: {
        color: '#fff',
    },
    aiExplanationText: {
        color: '#3730a3',
        marginBottom: 4,
    },
    aiHintText: {
        fontSize: 12.5,
        lineHeight: 19,
        color: '#4c5ea8',
        fontWeight: '600',
    },
    matchWhyText: {
        marginTop: 8,
        fontSize: 12,
        lineHeight: 18,
        color: '#6b21a8',
        fontWeight: '600',
    },
    talentReasonRail: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    talentGapText: {
        fontSize: 13,
        lineHeight: 20,
        color: '#7c2d12',
        fontWeight: '600',
        marginBottom: 4,
    },
    actionRowContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 14,
    },
    decisionPanel: {
        ...SCREEN_CHROME.contentCard,
        marginTop: 18,
        padding: 16,
    },
    decisionPanelHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    decisionPanelTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#111827',
    },
    decisionPanelBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    decisionPanelBadgeText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6d28d9',
    },
    actionBtnDisabled: {
        opacity: 0.6,
    },
    actionBtn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    actionBtnReject: {
        backgroundColor: '#ef4444',
    },
    actionBtnShortlist: {
        backgroundColor: '#22c55e',
        flex: 1.35,
    },
    actionBtnInterview: {
        backgroundColor: '#7c3aed',
        flex: 1.35,
    },
    actionBtnTextWhite: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 12,
        letterSpacing: 0.5,
    },
    chatCtaBtn: {
        marginTop: 14,
        ...SCREEN_CHROME.signalChipAccent,
        borderRadius: 16,
        paddingVertical: 12,
        alignItems: 'center',
    },
    chatCtaText: {
        color: '#7c3aed',
        fontWeight: '900',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    resumeModalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.48)',
        justifyContent: 'flex-end',
    },
    resumeModalCard: {
        maxHeight: '78%',
        ...SCREEN_CHROME.heroSurface,
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 20,
    },
    resumeModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    resumeModalTitle: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    resumeModalCloseBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f5f9',
    },
    resumePreviewLine: {
        color: '#334155',
        fontSize: 14,
        lineHeight: 21,
        marginBottom: 7,
    },
    resumePreviewLabel: {
        color: '#0f172a',
        fontWeight: '700',
    },
    resumeTranscriptTitle: {
        marginTop: 6,
        marginBottom: 6,
        color: '#7c3aed',
        fontSize: 13,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    resumeTranscriptText: {
        color: '#475569',
        fontSize: 13,
        lineHeight: 20,
    },
});
