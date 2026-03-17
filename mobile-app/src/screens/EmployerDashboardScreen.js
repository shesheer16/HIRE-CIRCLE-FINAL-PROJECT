import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import client from '../api/client';
import NudgeToast from '../components/NudgeToast';
import Toast from '../components/Toast';
import SocketService from '../services/socket';
import { useAppStore } from '../store/AppStore';
import { logger } from '../utils/logger';
import { SCREEN_CHROME, SHADOWS } from '../theme/theme';
import { SCREENSHOT_EMPLOYER_JOBS, SCREENSHOT_MOCKS_ENABLED } from '../config/screenshotMocks';

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

const normalizeCardToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildCardSignature = (job = {}) => {
    const skills = Array.isArray(job.skills)
        ? job.skills.map((item) => normalizeCardToken(item)).filter(Boolean).sort().join('|')
        : '';

    return [
        normalizeCardToken(job.title),
        normalizeCardToken(job.company),
        normalizeCardToken(job.location),
        normalizeCardToken(job.salary),
        normalizeCardToken(job.type),
        skills,
    ].join('::');
};

const collapseDuplicateJobCards = (jobs = []) => {
    const rows = Array.isArray(jobs) ? jobs : [];
    const seen = new Set();
    const collapsed = [];

    for (const job of rows) {
        const signature = buildCardSignature(job);
        if (!signature || !seen.has(signature)) {
            if (signature) seen.add(signature);
            collapsed.push(job);
        }
    }

    return collapsed;
};

const MY_JOBS_CACHE_KEY = '@cached_employer_jobs_dashboard';
const resolveUserCacheSuffix = (user) => {
    const raw = String(user?._id || user?.id || user?.userId || '').trim();
    if (raw) return raw;

    const fallback = String(user?.email || user?.phone || user?.username || '').trim().toLowerCase();
    return fallback || 'anonymous';
};

const formatCompactNumber = (value) => {
    const numericValue = Number(value || 0);
    if (!Number.isFinite(numericValue)) return '0';
    if (numericValue >= 1000) {
        return `${(numericValue / 1000).toFixed(numericValue >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
    }
    return String(Math.max(0, Math.round(numericValue)));
};

const formatPostedLabel = (value) => {
    if (!value) return 'Today';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Recently';

    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return '1d ago';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

const getJobStatusMeta = (status = '') => {
    const normalized = String(status || 'open').trim().toLowerCase();

    if (normalized === 'paused' || normalized === 'draft') {
        return {
            label: normalized === 'draft' ? 'Draft' : 'Paused',
            icon: 'pause-circle-outline',
            tint: '#c68a1c',
            background: '#fff7ed',
            border: '#fed7aa',
        };
    }

    if (normalized === 'closed' || normalized === 'filled' || normalized === 'inactive') {
        return {
            label: normalized === 'filled' ? 'Filled' : 'Closed',
            icon: 'checkmark-done-circle-outline',
            tint: '#0f9d67',
            background: '#f0fdf4',
            border: '#bbf7d0',
        };
    }

    return {
        label: 'Open',
        icon: 'sparkles-outline',
        tint: '#6d28d9',
        background: '#f5f3ff',
        border: '#ddd6fe',
    };
};

export default function EmployerDashboardScreen({ navigation }) {
    const route = useRoute();
    const insets = useSafeAreaInsets();
    const user = useAppStore(state => state.user);
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedJob, setSelectedJob] = useState(null);
    const [showResponseReminder, setShowResponseReminder] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
    const [studioToast, setStudioToast] = useState('');
    const [actionBusy, setActionBusy] = useState(false);
    const [softLoadIssue, setSoftLoadIssue] = useState('');
    const [showDashboardModal, setShowDashboardModal] = useState(false);
    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editForm, setEditForm] = useState({
        title: '',
        company: '',
        location: '',
        salary: '',
        description: '',
        requirements: '',
    });
    const fetchInFlightRef = useRef(false);
    const pendingFetchRef = useRef(false);
    const fetchRequestIdRef = useRef(0);
    const hasLoadedOnceRef = useRef(false);
    const abortControllerRef = useRef(null);
    const mountedRef = useRef(false);
    const cacheKey = useMemo(() => `${MY_JOBS_CACHE_KEY}:${resolveUserCacheSuffix(user)}`, [user]);

    React.useEffect(() => {
        if (route.params?.source !== 'job_posted') return;
        setStudioToast('Job posted');
        navigation.setParams({ source: undefined });
    }, [navigation, route.params?.source]);

    const fetchMyJobs = useCallback(async ({ showLoader = false } = {}) => {
        if (fetchInFlightRef.current) {
            pendingFetchRef.current = true;
            return;
        }

        const requestId = fetchRequestIdRef.current + 1;
        fetchRequestIdRef.current = requestId;
        fetchInFlightRef.current = true;

        if (showLoader || !hasLoadedOnceRef.current) {
            setIsLoading(true);
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            if (SCREENSHOT_MOCKS_ENABLED) {
                const safeJobs = Array.isArray(SCREENSHOT_EMPLOYER_JOBS) ? SCREENSHOT_EMPLOYER_JOBS : [];
                setJobs(safeJobs);
                const shouldRemind = safeJobs.some((job) => Number(job?.applicantCount || 0) > 0);
                setShowResponseReminder(shouldRemind);
                if (shouldRemind) {
                    setToastVisible(true);
                }
                fetchInFlightRef.current = false;
                hasLoadedOnceRef.current = true;
                setIsLoading(false);
                return;
            }
            if (!mountedRef.current) return;
            setSoftLoadIssue('');

            const [jobsResult, applicationsResult] = await Promise.allSettled([
                client.get('/api/jobs/my-jobs', {
                    __skipApiErrorHandler: true,
                    __maxRetries: 0,
                    __disableBaseFallback: true,
                    timeout: 10000,
                    signal: abortControllerRef.current.signal,
                }),
                client.get('/api/applications', {
                    __skipApiErrorHandler: true,
                    __maxRetries: 0,
                    __disableBaseFallback: true,
                    timeout: 9000,
                    params: {
                        includeArchived: true,
                        limit: 120,
                        skipTotal: true,
                    },
                    signal: abortControllerRef.current.signal,
                }),
            ]);

            if (requestId !== fetchRequestIdRef.current) return;

            if (jobsResult.status !== 'fulfilled') {
                throw jobsResult.reason;
            }

            const jobsArray = extractArrayPayload(jobsResult.value?.data);
            if (!jobsArray) {
                throw new Error('Invalid jobs response format.');
            }

            let applicationsArray = [];
            if (applicationsResult.status === 'fulfilled') {
                const parsedApplications = extractArrayPayload(applicationsResult.value?.data);
                if (parsedApplications) {
                    applicationsArray = parsedApplications;
                } else {
                    logger.warn('My Jobs: applications payload was not an array. Falling back to zero counts.');
                }
            } else {
                logger.warn('My Jobs: applications fetch failed. Falling back to zero counts.');
            }

            const perJobStats = applicationsArray.reduce((acc, application) => {
                const jobId = String(application?.job?._id || application?.job || '');
                if (!jobId) return acc;

                const status = String(application?.status || '').toLowerCase();
                if (!acc[jobId]) {
                    acc[jobId] = {
                        total: 0,
                        shortlisted: 0,
                        hired: 0,
                        accepted: 0,
                    };
                }

                acc[jobId].total += 1;
                if (status === 'shortlisted') acc[jobId].shortlisted += 1;
                if (status === 'hired') acc[jobId].hired += 1;
                if (status === 'accepted' || status === 'offer_accepted') acc[jobId].accepted += 1;
                return acc;
            }, {});

            const formattedJobs = jobsArray.map((job) => {
                const createdAtRaw = job?.createdAt ? new Date(job.createdAt) : null;
                const jobId = normalizeObjectId(job?._id);
                if (!jobId) return null;

                const liveStats = perJobStats[jobId] || {};
                const applicantCount = Number(liveStats.total ?? job?.applicantCount ?? 0);
                const shortlistedCount = Number(liveStats.shortlisted ?? job?.shortlistedCount ?? job?.stats?.shortlisted ?? 0);
                const hiredCount = Number(liveStats.hired ?? job?.hiredCount ?? job?.stats?.hired ?? 0);
                const acceptedCount = Number(liveStats.accepted ?? 0);

                return {
                    id: jobId,
                    title: job?.title || 'Untitled job',
                    company: job?.companyName || 'Your company',
                    location: job?.location || '',
                    salary: job?.salaryRange || 'Negotiable',
                    type: job?.shift || 'Full-time',
                    postedAt: createdAtRaw && !Number.isNaN(createdAtRaw.getTime())
                        ? createdAtRaw.toLocaleDateString()
                        : 'Recently',
                    createdAt: createdAtRaw ? createdAtRaw.toISOString() : null,
                    description: Array.isArray(job?.requirements) && job.requirements.length
                        ? job.requirements.join(', ')
                        : 'No description provided yet.',
                    skills: Array.isArray(job?.requirements) ? job.requirements : [],
                    applicantCount,
                    shortlistedCount,
                    hiredCount,
                    acceptedCount,
                    status: String(job?.status || 'open'),
                };
            }).filter(Boolean);

            const uniqueById = Array.from(new Map(formattedJobs.map((job) => [job.id, job])).values());
            const stableCards = collapseDuplicateJobCards(uniqueById);

            if (mountedRef.current && requestId === fetchRequestIdRef.current) {
                setJobs(stableCards);
                const shouldRemind = stableCards.some((job) => Number(job?.applicantCount || 0) > 0);
                setShowResponseReminder(shouldRemind);
                if (shouldRemind) {
                    setToastVisible(true);
                }
                
                fetchInFlightRef.current = false;
                hasLoadedOnceRef.current = true;
                setIsLoading(false);
                if (pendingFetchRef.current) {
                    pendingFetchRef.current = false;
                    setTimeout(() => {
                        fetchMyJobs({ showLoader: false });
                    }, 0);
                }
            }

            if (stableCards.length > 0) {
                AsyncStorage.setItem(cacheKey, JSON.stringify(stableCards)).catch(() => { });
            } else {
                AsyncStorage.removeItem(cacheKey).catch(() => { });
            }
        } catch (error) {
            if (error.name === 'CanceledError' || error.message?.includes('aborted')) return;
            if (requestId !== fetchRequestIdRef.current) return;

            try {
                const cached = await AsyncStorage.getItem(cacheKey);
                const parsed = JSON.parse(String(cached || '[]'));
                if (Array.isArray(parsed) && parsed.length > 0) {
                    if (mountedRef.current) {
                        setJobs(parsed);
                        const shouldRemind = parsed.some((job) => Number(job?.applicantCount || 0) > 0);
                        setShowResponseReminder(shouldRemind);
                        setSoftLoadIssue('');
                        
                        fetchInFlightRef.current = false;
                        hasLoadedOnceRef.current = true;
                        setIsLoading(false);
                        if (pendingFetchRef.current) {
                            pendingFetchRef.current = false;
                            setTimeout(() => {
                                fetchMyJobs({ showLoader: false });
                            }, 0);
                        }
                    }
                    return;
                }
            } catch (_cacheError) {
                // Continue to zero-state fallback.
            }

            if (mountedRef.current) {
                setJobs([]);
                setShowResponseReminder(false);
                setSoftLoadIssue('');
                
                fetchInFlightRef.current = false;
                hasLoadedOnceRef.current = true;
                setIsLoading(false);
                if (pendingFetchRef.current) {
                    pendingFetchRef.current = false;
                    setTimeout(() => {
                        fetchMyJobs({ showLoader: false });
                    }, 0);
                }
            }
        }
    }, [cacheKey]);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    useFocusEffect(
        useCallback(() => {
            fetchMyJobs({ showLoader: !hasLoadedOnceRef.current });
        }, [fetchMyJobs])
    );

    React.useEffect(() => {
        setJobs([]);
        setSelectedJob(null);
        setShowResponseReminder(false);
        setSoftLoadIssue('');
        hasLoadedOnceRef.current = false;
    }, [cacheKey]);

    React.useEffect(() => {
        const handleRealtimeApplication = () => {
            fetchMyJobs();
        };

        SocketService.on('new_application', handleRealtimeApplication);
        return () => {
            SocketService.off('new_application', handleRealtimeApplication);
        };
    }, [fetchMyJobs]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        try {
            await fetchMyJobs({ showLoader: false });
        } finally {
            setIsRefreshing(false);
        }
    }, [fetchMyJobs]);

    const totalApplicants = useMemo(
        () => jobs.reduce((sum, job) => sum + Number(job?.applicantCount || 0), 0),
        [jobs]
    );
    const totalShortlisted = useMemo(
        () => jobs.reduce((sum, job) => sum + Number(job?.shortlistedCount || 0), 0),
        [jobs]
    );
    const totalHired = useMemo(
        () => jobs.reduce((sum, job) => sum + Number(job?.hiredCount || 0), 0),
        [jobs]
    );
    const activeJobsCount = useMemo(
        () => jobs.filter((job) => !['closed', 'filled', 'inactive'].includes(String(job?.status || '').toLowerCase())).length,
        [jobs]
    );

    const showCenteredEmptyState = !isLoading && jobs.length === 0;

    const handleViewApplicants = useCallback(() => {
        if (!selectedJob?.id) {
            Alert.alert('Missing job', 'Could not open applicants for this job.');
            return;
        }

        setSelectedJob(null);
        navigation.navigate('Talent', { jobId: selectedJob.id, jobTitle: selectedJob.title });
    }, [navigation, selectedJob]);

    const openEditModal = useCallback(() => {
        if (!selectedJob) return;
        setEditForm({
            title: selectedJob.title,
            company: selectedJob.company,
            location: selectedJob.location,
            salary: selectedJob.salary,
            description: selectedJob.description,
            requirements: selectedJob.skills.join(', '),
        });
        setIsEditModalVisible(true);
    }, [selectedJob]);

    const handleSaveEdit = useCallback(async () => {
        if (!selectedJob?.id || actionBusy) return;
        setActionBusy(true);

        try {
            const requirements = editForm.requirements.split(',').map((item) => item.trim()).filter(Boolean);

            await client.put(`/api/jobs/${selectedJob.id}`, {
                title: editForm.title,
                companyName: editForm.company,
                location: editForm.location,
                salaryRange: editForm.salary,
                requirements,
                description: editForm.description,
            });

            const updatedJobs = jobs.map((job) => {
                if (job.id !== selectedJob.id) return job;
                return {
                    ...job,
                    title: editForm.title,
                    company: editForm.company,
                    location: editForm.location,
                    salary: editForm.salary,
                    description: editForm.description,
                    skills: requirements,
                };
            });
            const updatedSelected = updatedJobs.find((job) => job.id === selectedJob.id) || null;

            setJobs(updatedJobs);
            setSelectedJob(updatedSelected);
            setIsEditModalVisible(false);
            setToastVisible(true);
            AsyncStorage.setItem(cacheKey, JSON.stringify(updatedJobs)).catch(() => { });
        } catch (error) {
            logger.error('Failed to update job posting:', error);
            Alert.alert('Update failed', 'Could not update this job right now. Please try again.');
        } finally {
            setActionBusy(false);
        }
    }, [actionBusy, cacheKey, editForm, jobs, selectedJob]);

    const handleDeleteJob = useCallback((jobToDelete) => {
        if (!jobToDelete?.id || actionBusy) return;

        Alert.alert(
            'Delete this job?',
            `This will permanently remove "${jobToDelete.title}" and related applications.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        setActionBusy(true);
                        try {
                            await client.delete(`/api/jobs/${jobToDelete.id}`, { timeout: 9000 });
                            setSelectedJob(null);
                            const updatedJobs = jobs.filter((job) => job.id !== jobToDelete.id);
                            setJobs(updatedJobs);
                            setShowResponseReminder(updatedJobs.some((job) => Number(job?.applicantCount || 0) > 0));
                            if (updatedJobs.length > 0) {
                                AsyncStorage.setItem(cacheKey, JSON.stringify(updatedJobs)).catch(() => { });
                            } else {
                                AsyncStorage.removeItem(cacheKey).catch(() => { });
                            }
                            Alert.alert('Deleted', 'Job posting removed successfully.');
                            fetchMyJobs({ showLoader: false });
                        } catch (error) {
                            logger.error('Delete job failed:', error);
                            Alert.alert('Delete failed', 'Could not delete this job right now. Please try again.');
                        } finally {
                            setActionBusy(false);
                        }
                    },
                },
            ]
        );
    }, [actionBusy, cacheKey, fetchMyJobs, jobs]);

    const handleDeleteAllJobs = useCallback(() => {
        if (actionBusy) return;

        Alert.alert(
            'Delete all my jobs?',
            'This permanently removes all of your posted jobs.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete All',
                    style: 'destructive',
                    onPress: async () => {
                        setActionBusy(true);
                        try {
                            await client.delete('/api/jobs/my-jobs/all', { timeout: 10000 });
                            setSelectedJob(null);
                            setJobs([]);
                            setShowResponseReminder(false);
                            AsyncStorage.removeItem(cacheKey).catch(() => { });
                            Alert.alert('Done', 'All your job postings were deleted.');
                            fetchMyJobs({ showLoader: false });
                        } catch (error) {
                            logger.error('Delete all jobs failed:', error);
                            Alert.alert('Delete all failed', 'Could not delete all jobs right now. Please try again.');
                        } finally {
                            setActionBusy(false);
                        }
                    },
                },
            ]
        );
    }, [actionBusy, cacheKey, fetchMyJobs]);

    if (selectedJob) {
        const statusMeta = getJobStatusMeta(selectedJob.status);

        return (
            <LinearGradient colors={['#f9fbff', '#f3f5ff', '#fbfcff']} style={styles.container}>
                <View style={styles.screenGlowTop} />
                <View style={styles.screenGlowBottom} />
                <View style={[styles.headerShell, { paddingTop: insets.top + 10 }]}>
                    <View style={styles.topBarShell}>
                        <View style={styles.topBar}>
                            <TouchableOpacity
                                style={styles.topActionButton}
                                onPress={() => setSelectedJob(null)}
                                activeOpacity={0.84}
                            >
                                <Ionicons name="arrow-back" size={20} color="#0f172a" />
                            </TouchableOpacity>
                            <View style={styles.topBarCopy}>
                                <Text style={styles.topBarEyebrow}>Hiring board</Text>
                                <Text style={styles.topBarTitle}>Job review</Text>
                            </View>
                            <TouchableOpacity
                                style={[styles.topActionButton, styles.topActionButtonPrimary]}
                                onPress={handleViewApplicants}
                                activeOpacity={0.84}
                            >
                                <Ionicons name="people-outline" size={18} color="#6d28d9" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={[styles.detailScrollContent, { paddingBottom: (insets.bottom || 18) + 40 }]}
                >
                    <LinearGradient colors={['#ffffff', '#faf5ff']} style={styles.detailHeroCard}>
                        <View style={styles.detailHeroHeader}>
                            <View style={styles.detailAvatarWrap}>
                                <Image
                                    source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(String(selectedJob.company || 'Company'))}&background=f3e8ff&color=7c3aed&size=256` }}
                                    style={styles.detailAvatar}
                                />
                            </View>
                            <View style={styles.detailHeroCopy}>
                                <Text style={styles.detailTitle}>{selectedJob.title}</Text>
                                <Text style={styles.detailCompany}>{selectedJob.company}</Text>
                                <View style={[styles.statusChipInline, { backgroundColor: statusMeta.background, borderColor: statusMeta.border }]}>
                                    <Ionicons name={statusMeta.icon} size={11} color={statusMeta.tint} />
                                    <Text style={[styles.statusChipTextInline, { color: statusMeta.tint }]}>{statusMeta.label}</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.detailSignalRow}>
                            <View style={styles.detailSignalChip}>
                                <Ionicons name="location-outline" size={13} color="#64748b" />
                                <Text style={styles.detailSignalChipText}>{selectedJob.location || 'Location flexible'}</Text>
                            </View>
                            <View style={styles.detailSignalChip}>
                                <Ionicons name="wallet-outline" size={13} color="#64748b" />
                                <Text style={styles.detailSignalChipText}>{selectedJob.salary}</Text>
                            </View>
                            <View style={styles.detailSignalChip}>
                                <Ionicons name="time-outline" size={13} color="#64748b" />
                                <Text style={styles.detailSignalChipText}>{selectedJob.type}</Text>
                            </View>
                        </View>

                        <View style={styles.detailMetricsGrid}>
                            <View style={styles.detailMetricBox}>
                                <Text style={styles.detailMetricValueNew}>{formatCompactNumber(selectedJob.applicantCount)}</Text>
                                <Text style={styles.detailMetricLabelNew}>Applicants</Text>
                            </View>
                            <View style={styles.detailMetricBox}>
                                <Text style={styles.detailMetricValueNew}>{formatCompactNumber(selectedJob.shortlistedCount)}</Text>
                                <Text style={styles.detailMetricLabelNew}>Shortlisted</Text>
                            </View>
                            <View style={styles.detailMetricBox}>
                                <Text style={styles.detailMetricValueNew}>{formatCompactNumber(selectedJob.hiredCount)}</Text>
                                <Text style={styles.detailMetricLabelNew}>Hired</Text>
                            </View>
                            <View style={styles.detailMetricBox}>
                                <Text style={styles.detailMetricValueNew}>{formatCompactNumber(selectedJob.acceptedCount)}</Text>
                                <Text style={styles.detailMetricLabelNew}>Offers</Text>
                            </View>
                        </View>
                    </LinearGradient>

                    <View style={styles.detailSectionCardPremium}>
                        <View style={styles.sectionHeaderRowPremium}>
                            <View style={styles.sectionTitleRowPremium}>
                                <Ionicons name="document-text" size={18} color="#6d28d9" />
                                <Text style={styles.sectionTitlePremium}>About this role</Text>
                            </View>
                            <View style={styles.sectionMetaBubble}>
                                <Text style={styles.sectionMetaPremium}>Posted {formatPostedLabel(selectedJob.createdAt || selectedJob.postedAt)}</Text>
                            </View>
                        </View>
                        <Text style={styles.descriptionTextPremium}>{selectedJob.description}</Text>
                    </View>

                    <View style={styles.detailSectionCardPremium}>
                        <View style={styles.sectionHeaderRowPremium}>
                            <View style={styles.sectionTitleRowPremium}>
                                <Ionicons name="sparkles" size={18} color="#6d28d9" />
                                <Text style={styles.sectionTitlePremium}>Signals wanted</Text>
                            </View>
                            <Text style={styles.sectionMetaTextPremium}>{selectedJob?.skills?.length || 0} signals</Text>
                        </View>
                        <View style={styles.tagsContainerPremium}>
                            {(selectedJob?.skills?.length > 0) ? selectedJob.skills.map((skill, index) => (
                                <View key={`${selectedJob.id}-${skill}-${index}`} style={styles.requirementTagPremium}>
                                    <Text style={styles.requirementTagTextPremium}>{skill}</Text>
                                </View>
                            )) : (
                                <View style={styles.requirementTagMutedPremium}>
                                    <Text style={styles.requirementTagMutedTextPremium}>Add signals in edit to attract better talent matches.</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    <View style={styles.detailActionsCardPremium}>
                        <TouchableOpacity style={styles.primaryCtaPremium} onPress={handleViewApplicants} activeOpacity={0.88}>
                            <Text style={styles.primaryCtaTextPremium}>Review Talent</Text>
                            <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                        </TouchableOpacity>

                        <View style={styles.secondaryActionRowPremium}>
                            <TouchableOpacity
                                style={[styles.secondaryCtaPremium, actionBusy && styles.actionButtonDisabled]}
                                onPress={openEditModal}
                                disabled={actionBusy}
                                activeOpacity={0.85}
                            >
                                <Ionicons name="create-outline" size={18} color="#475569" />
                                <Text style={styles.secondaryCtaTextPremium}>{actionBusy ? '...' : 'Edit'}</Text>
                            </TouchableOpacity>

                            <View style={styles.destructiveActionRowPremium}>
                                <TouchableOpacity
                                    style={[styles.ghostDangerCtaPremium, actionBusy && styles.actionButtonDisabled]}
                                    onPress={() => handleDeleteJob(selectedJob)}
                                    disabled={actionBusy}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.ghostDangerCtaPremium, actionBusy && styles.actionButtonDisabled]}
                                    onPress={handleDeleteAllJobs}
                                    disabled={actionBusy}
                                    activeOpacity={0.85}
                                >
                                    <Ionicons name="flame-outline" size={18} color="#ef4444" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </ScrollView>

                <Modal
                    visible={isEditModalVisible}
                    animationType="slide"
                    transparent
                    onRequestClose={() => setIsEditModalVisible(false)}
                >
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                        style={styles.modalOverlayPremium}
                    >
                        <View style={styles.modalContentPremium}>
                            <View style={styles.modalDragIndicator} />
                            <View style={styles.modalHeaderPremium}>
                                <Text style={styles.modalTitleTextPremium}>Edit Job Details</Text>
                                <TouchableOpacity onPress={() => setIsEditModalVisible(false)} style={styles.modalCloseBtnPremium}>
                                    <Ionicons name="close" size={20} color="#64748b" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Job Title</Text>
                                    <TextInput
                                        style={styles.inputPremium}
                                        value={editForm.title}
                                        onChangeText={(text) => setEditForm({ ...editForm, title: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Company / Team</Text>
                                    <TextInput
                                        style={styles.inputPremium}
                                        value={editForm.company}
                                        onChangeText={(text) => setEditForm({ ...editForm, company: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Location</Text>
                                    <TextInput
                                        style={styles.inputPremium}
                                        value={editForm.location}
                                        onChangeText={(text) => setEditForm({ ...editForm, location: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Salary Range</Text>
                                    <TextInput
                                        style={styles.inputPremium}
                                        value={editForm.salary}
                                        onChangeText={(text) => setEditForm({ ...editForm, salary: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Job Summary</Text>
                                    <TextInput
                                        style={[styles.inputPremium, styles.textAreaPremium]}
                                        value={editForm.description}
                                        multiline
                                        onChangeText={(text) => setEditForm({ ...editForm, description: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <View style={styles.inputGroupPremium}>
                                    <Text style={styles.labelPremium}>Required Signals (comma separated)</Text>
                                    <TextInput
                                        style={[styles.inputPremium, styles.textAreaPremium]}
                                        value={editForm.requirements}
                                        multiline
                                        onChangeText={(text) => setEditForm({ ...editForm, requirements: text })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>
                                <TouchableOpacity
                                    style={[styles.saveButtonPremium, actionBusy && styles.actionButtonDisabled]}
                                    onPress={handleSaveEdit}
                                    disabled={actionBusy}
                                    activeOpacity={0.88}
                                >
                                    <Text style={styles.saveButtonTextPremium}>{actionBusy ? 'Saving...' : 'Save Changes'}</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </LinearGradient>
        );
    }

    return (
        <View style={styles.container}>
            <View style={[styles.headerShell, { paddingTop: insets.top + 10 }]}>
                <View style={styles.topBar}>
                    <View style={styles.topBarTitleRow}>
                        <View style={styles.topBarCopy}>
                            <Text style={styles.topBarTitle}>My Jobs</Text>
                        </View>
                    </View>
                    <View style={styles.topBarActions}>
                        <TouchableOpacity
                            style={styles.cleanActionButton}
                            onPress={() => fetchMyJobs({ showLoader: !hasLoadedOnceRef.current })}
                            activeOpacity={0.84}
                        >
                            <Ionicons name="refresh-outline" size={20} color="#0f172a" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.cleanActionButton}
                            onPress={() => setShowDashboardModal(true)}
                            activeOpacity={0.84}
                        >
                            <Ionicons name="stats-chart-outline" size={20} color="#0f172a" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {isLoading ? (
                <View style={styles.loadingCenterWrap}>
                    <View style={styles.loadingOrb}>
                        <ActivityIndicator size="large" color="#7c3aed" />
                    </View>
                    <Text style={styles.loadingCenterText}>Loading your job board…</Text>
                </View>
            ) : showCenteredEmptyState ? (
                <View style={styles.emptyJobsCenterWrap}>
                    <View style={styles.emptyJobsWrap}>
                        <View style={styles.emptyJobsIconBubble}>
                            <Ionicons name="briefcase-outline" size={24} color="#6d28d9" />
                        </View>
                        <Text style={styles.emptyJobsTitle}>No jobs yet</Text>
                        <Text style={styles.emptyJobsSubtitle}>Post your first opening to start building a talent pipeline.</Text>
                        <TouchableOpacity
                            style={styles.emptyJobsPrimaryButton}
                            onPress={() => navigation.navigate('PostJob')}
                            activeOpacity={0.88}
                        >
                            <Text style={styles.emptyJobsPrimaryButtonText}>Post a job</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={[styles.listContent, { paddingBottom: (insets.bottom || 20) + 28 }]}
                    showsVerticalScrollIndicator={false}
                    refreshControl={(
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={handleRefresh}
                            tintColor="#7c3aed"
                            colors={['#7c3aed']}
                        />
                    )}
                >
                    {/* Live openings header removed as per user design request */}
                    {jobs.map((job) => {
                        const statusMeta = getJobStatusMeta(job.status || 'open');
                        return (
                            <TouchableOpacity
                                key={job.id}
                                style={styles.jobListCardCompact}
                                onPress={() => setSelectedJob(job)}
                                activeOpacity={0.85}
                            >
                                <View style={styles.jobCardAccentStrip} />
                                <View style={styles.jobCardBody}>
                                    <View style={styles.jobCardTopRow}>
                                        <View style={[styles.jobCardIcon, { backgroundColor: statusMeta.background }]}>
                                            <Ionicons name={statusMeta.icon} size={20} color={statusMeta.tint} />
                                        </View>
                                        <View style={styles.jobCardTitleWrap}>
                                            <Text style={styles.jobListTitle} numberOfLines={1}>{job.title}</Text>
                                            <Text style={styles.jobListCompany} numberOfLines={1}>
                                                {job.company}  <Text style={styles.jobListDot}>•</Text>  {job.location || 'Flexible'}
                                            </Text>
                                        </View>
                                        <View style={[styles.statusChipCompact, { backgroundColor: statusMeta.background }]}>
                                            <Text style={[styles.statusChipTextCompact, { color: statusMeta.tint }]}>{statusMeta.label}</Text>
                                        </View>
                                    </View>
                                    
                                    <View style={styles.jobCardBottomRow}>
                                        <View style={styles.cardTagsRowCompact}>
                                            <View style={styles.cardTagCompactPrimary}>
                                                <Text style={styles.cardTagTextCompactPrimary} numberOfLines={1}>{String(job.salary || 'Negotiable').replace(/[\s\$-]/g, '') ? job.salary : 'Salary DOE'}</Text>
                                            </View>
                                            {job.skills && job.skills.length > 0 && job.skills.slice(0, 1).map((skill, index) => (
                                                <View key={`${job.id}-${skill}-${index}`} style={styles.cardTagCompact}>
                                                    <Text style={styles.cardTagTextCompact} numberOfLines={1} ellipsizeMode="tail">{skill}</Text>
                                                </View>
                                            ))}
                                        </View>
                                        <Text style={styles.postedAtTextCompact}>
                                            <Ionicons name="time-outline" size={11} color="#94a3b8" /> {formatPostedLabel(job.createdAt || job.postedAt)}
                                        </Text>
                                    </View>
                                </View>
                                <View style={styles.jobCardArrow}>
                                    <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            )}

            <Modal
                visible={showDashboardModal}
                animationType="slide"
                transparent
                onRequestClose={() => setShowDashboardModal(false)}
            >
                <Pressable style={styles.sheetOverlay} onPress={() => setShowDashboardModal(false)}>
                    <Pressable style={styles.sheetCard} onPress={() => { }}>
                        <View style={styles.sheetHandle} />
                        <View style={styles.sheetHeader}>
                            <View>
                                <Text style={styles.sheetEyebrow}>Job dashboard</Text>
                                <Text style={styles.sheetTitle}>My Jobs</Text>
                            </View>
                            <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setShowDashboardModal(false)} activeOpacity={0.84}>
                                <Ionicons name="close" size={18} color="#475569" />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.sheetSignalRow}>
                            <View style={[styles.heroSignalChip, styles.heroSignalChipAccent]}>
                                <Ionicons name="briefcase-outline" size={14} color="#6d28d9" />
                                <Text style={[styles.heroSignalChipText, styles.heroSignalChipTextAccent]}>{formatCompactNumber(activeJobsCount)} active</Text>
                            </View>
                            <View style={styles.heroSignalChip}>
                                <Ionicons name="people-outline" size={14} color="#475569" />
                                <Text style={styles.heroSignalChipText}>{formatCompactNumber(totalApplicants)} applicants</Text>
                            </View>
                            <View style={styles.heroSignalChip}>
                                <Ionicons name="sparkles-outline" size={14} color="#475569" />
                                <Text style={styles.heroSignalChipText}>{formatCompactNumber(totalHired)} hires</Text>
                            </View>
                        </View>

                        <View style={styles.sheetMetricsRow}>
                            <View style={styles.sheetMetricCard}>
                                <Text style={styles.sheetMetricValue}>{formatCompactNumber(jobs.length)}</Text>
                                <Text style={styles.sheetMetricLabel}>Total jobs</Text>
                            </View>
                            <View style={styles.sheetMetricCard}>
                                <Text style={styles.sheetMetricValue}>{formatCompactNumber(totalShortlisted)}</Text>
                                <Text style={styles.sheetMetricLabel}>Shortlisted</Text>
                            </View>
                            <View style={styles.sheetMetricCard}>
                                <Text style={styles.sheetMetricValue}>{showResponseReminder ? 'Live' : 'Calm'}</Text>
                                <Text style={styles.sheetMetricLabel}>Hiring pulse</Text>
                            </View>
                        </View>

                        {showResponseReminder ? (
                            <View style={styles.sheetReminder}>
                                <Ionicons name="flash-outline" size={15} color="#7c3aed" />
                                <Text style={styles.sheetReminderText}>Applicants are waiting. Review talent sooner.</Text>
                            </View>
                        ) : null}

                        {softLoadIssue ? (
                            <View style={styles.sheetStatusCard}>
                                <Ionicons name="cloud-offline-outline" size={15} color="#b45309" />
                                <Text style={styles.sheetStatusText}>{softLoadIssue}</Text>
                            </View>
                        ) : null}

                        <View style={styles.sheetActionRow}>
                            <TouchableOpacity
                                style={styles.heroPrimaryAction}
                                onPress={() => {
                                    setShowDashboardModal(false);
                                    navigation.navigate('PostJob');
                                }}
                                activeOpacity={0.88}
                            >
                                <Ionicons name="add-outline" size={17} color="#ffffff" />
                                <Text style={styles.heroPrimaryActionText}>Post job</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.heroSecondaryAction}
                                onPress={() => {
                                    setShowDashboardModal(false);
                                    navigation.navigate('Talent');
                                }}
                                activeOpacity={0.88}
                            >
                                <Ionicons name="people-outline" size={16} color="#0f172a" />
                                <Text style={styles.heroSecondaryActionText}>Open talent</Text>
                            </TouchableOpacity>
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

            <NudgeToast
                visible={toastVisible}
                text="Respond faster to improve hire rate."
                actionLabel="Review"
                onAction={() => {
                    setToastVisible(false);
                }}
                onDismiss={() => setToastVisible(false)}
            />
            <Toast
                visible={Boolean(studioToast)}
                message={studioToast}
                onHide={() => setStudioToast('')}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    screenGlowTop: {
        position: 'absolute',
        top: -96,
        right: -72,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(139, 108, 255, 0.16)',
    },
    screenGlowBottom: {
        position: 'absolute',
        left: -54,
        bottom: -72,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: 'rgba(96, 165, 250, 0.14)',
    },
    headerShell: {
        paddingHorizontal: 18,
        paddingBottom: 14,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topBarTitleRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    topBarCopy: {
        gap: 0,
        alignItems: 'center',
    },
    topBarEyebrow: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    topBarTitle: {
        color: '#7c3aed',
        fontSize: 28,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    topBarActions: {
        flexDirection: 'row',
        gap: 12,
    },
    cleanActionButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheetOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15,23,42,0.34)',
    },
    sheetCard: {
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        backgroundColor: '#ffffff',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 22,
        ...SHADOWS.lg,
    },
    sheetHandle: {
        alignSelf: 'center',
        width: 54,
        height: 5,
        borderRadius: 999,
        backgroundColor: '#dbe2ea',
        marginBottom: 14,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    sheetEyebrow: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.7,
        textTransform: 'uppercase',
    },
    sheetTitle: {
        color: '#0f172a',
        fontSize: 24,
        fontWeight: '800',
        letterSpacing: -0.3,
        marginTop: 2,
    },
    sheetCloseButton: {
        width: 38,
        height: 38,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#f8fafc',
        alignItems: 'center',
        justifyContent: 'center',
    },
    sheetSignalRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 16,
    },
    sheetMetricsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    sheetMetricCard: {
        flex: 1,
        ...SCREEN_CHROME.metricTile,
    },
    sheetMetricValue: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    sheetMetricLabel: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 4,
    },
    sheetReminder: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    sheetReminderText: {
        flex: 1,
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 17,
    },
    sheetStatusCard: {
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#fcd34d',
        backgroundColor: '#fffbeb',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    sheetStatusText: {
        flex: 1,
        color: '#92400e',
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
    },
    sheetActionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 16,
    },
    heroCard: {
        marginTop: 14,
        padding: 18,
        ...SCREEN_CHROME.heroSurface,
    },
    heroCopyWrap: {
        gap: 6,
    },
    heroTitle: {
        color: '#0f172a',
        fontSize: 20,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    heroSubtitle: {
        color: '#64748b',
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '500',
    },
    heroSignalRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 14,
    },
    heroSignalChip: {
        ...SCREEN_CHROME.signalChip,
    },
    heroSignalChipAccent: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    heroSignalChipText: {
        color: '#475569',
        fontSize: 12,
        fontWeight: '700',
        marginLeft: 6,
    },
    heroSignalChipTextAccent: {
        color: '#6d28d9',
    },
    heroMetricsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    heroMetricCard: {
        flex: 1,
        ...SCREEN_CHROME.metricTile,
    },
    heroMetricValue: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    heroMetricLabel: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 4,
    },
    reminderStrip: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    reminderStripText: {
        flex: 1,
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 17,
    },
    heroActionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    heroPrimaryAction: {
        flex: 1,
        minHeight: 48,
        borderRadius: 17,
        backgroundColor: '#6d28d9',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        ...SHADOWS.md,
    },
    heroPrimaryActionText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    heroSecondaryAction: {
        minWidth: 136,
        minHeight: 48,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    heroSecondaryActionText: {
        color: '#0f172a',
        fontSize: 14,
        fontWeight: '800',
    },
    inlineStatusCard: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#fcd34d',
        backgroundColor: '#fffbeb',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    inlineStatusText: {
        flex: 1,
        color: '#92400e',
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
    },
    loadingCenterWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    loadingOrb: {
        width: 72,
        height: 72,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e7ecf4',
        ...SHADOWS.md,
    },
    loadingCenterText: {
        marginTop: 14,
        color: '#64748b',
        fontSize: 14,
        fontWeight: '700',
    },
    emptyJobsCenterWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 22,
    },
    emptyJobsWrap: {
        width: '100%',
        maxWidth: 360,
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 24,
        ...SCREEN_CHROME.contentCard,
    },
    emptyJobsIconBubble: {
        width: 52,
        height: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        marginBottom: 14,
    },
    emptyJobsTitle: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    emptyJobsSubtitle: {
        color: '#64748b',
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '500',
        textAlign: 'center',
        marginTop: 6,
    },
    emptyJobsPrimaryButton: {
        marginTop: 16,
        minWidth: 150,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6d28d9',
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 13,
        ...SHADOWS.md,
    },
    emptyJobsPrimaryButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
    listContent: {
        paddingHorizontal: 18,
        paddingTop: 16,
        gap: 14,
    },
    listSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 4,
        paddingHorizontal: 2,
    },
    listSectionTitle: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    listSectionCount: {
        minWidth: 38,
        height: 38,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    listSectionCountText: {
        color: '#6d28d9',
        fontSize: 14,
        fontWeight: '800',
    },
    jobListCardCompact: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        marginBottom: 12,
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    jobCardAccentStrip: {
        width: 4,
        alignSelf: 'stretch',
        backgroundColor: '#6d28d9',
        borderTopLeftRadius: 16,
        borderBottomLeftRadius: 16,
    },
    jobCardBody: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 14,
    },
    jobCardTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 8,
    },
    jobCardIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    jobCardTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    jobListTitle: {
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    jobListCompany: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '500',
        marginTop: 2,
    },
    jobListDot: {
        color: '#cbd5e1',
        fontSize: 12,
    },
    statusChipCompact: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
    },
    statusChipTextCompact: {
        fontSize: 11,
        fontWeight: '800',
    },
    jobCardBottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    cardTagsRowCompact: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginRight: 12,
    },
    cardTagCompactPrimary: {
        backgroundColor: '#f8fafc',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    cardTagTextCompactPrimary: {
        color: '#0f172a',
        fontSize: 12,
        fontWeight: '700',
    },
    cardTagCompact: {
        backgroundColor: '#f1f5f9',
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    cardTagTextCompact: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '600',
    },
    postedAtTextCompact: {
        color: '#94a3b8',
        fontSize: 11,
        fontWeight: '500',
    },
    jobCardArrow: {
        paddingRight: 14,
        paddingLeft: 4,
    },
    detailScrollContent: {
        paddingHorizontal: 18,
        paddingTop: 16,
        gap: 14,
    },
    detailHeroCard: {
        padding: 18,
        ...SCREEN_CHROME.contentCard,
    },
    detailHeroHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    detailAvatarWrap: {
        width: 68,
        height: 68,
        borderRadius: 22,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#ede9fe',
    },
    detailAvatar: {
        width: '100%',
        height: '100%',
    },
    detailHeroCopy: {
        flex: 1,
        gap: 6,
    },
    detailTitle: {
        color: '#0f172a',
        fontSize: 23,
        fontWeight: '800',
        letterSpacing: -0.4,
    },
    detailCompany: {
        color: '#6d28d9',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 6,
    },
    statusChipInline: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
    },
    statusChipTextInline: {
        fontSize: 10,
        fontWeight: '800',
    },
    detailSignalRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 16,
    },
    detailSignalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    detailSignalChipText: {
        color: '#475569',
        fontSize: 12,
        fontWeight: '600',
    },
    detailMetricsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 18,
    },
    detailMetricBox: {
        flexBasis: '47%',
        flexGrow: 1,
        backgroundColor: 'rgba(255,255,255,0.7)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#f5f3ff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.sm,
    },
    detailMetricValueNew: {
        color: '#6d28d9',
        fontSize: 22,
        fontWeight: '800',
    },
    detailMetricLabelNew: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '700',
        marginTop: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailSectionCardPremium: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        ...SHADOWS.sm,
    },
    sectionHeaderRowPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    sectionTitleRowPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    sectionTitlePremium: {
        color: '#0f172a',
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    sectionMetaBubble: {
        backgroundColor: '#f8fafc',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    sectionMetaPremium: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
    },
    sectionMetaTextPremium: {
        color: '#94a3b8',
        fontSize: 13,
        fontWeight: '600',
    },
    descriptionTextPremium: {
        color: '#334155',
        fontSize: 15,
        lineHeight: 24,
        fontWeight: '400',
    },
    tagsContainerPremium: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    requirementTagPremium: {
        borderRadius: 10,
        backgroundColor: '#faf5ff',
        borderWidth: 1,
        borderColor: '#e9d5ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    requirementTagTextPremium: {
        color: '#6d28d9',
        fontSize: 13,
        fontWeight: '700',
    },
    requirementTagMutedPremium: {
        width: '100%',
        borderRadius: 12,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 16,
        borderStyle: 'dashed',
    },
    requirementTagMutedTextPremium: {
        color: '#64748b',
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
    detailActionsCardPremium: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        padding: 24,
        marginTop: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        ...SHADOWS.md,
    },
    primaryCtaPremium: {
        minHeight: 56,
        borderRadius: 16,
        backgroundColor: '#6d28d9',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
        ...SHADOWS.md,
    },
    primaryCtaTextPremium: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
    secondaryActionRowPremium: {
        flexDirection: 'row',
        gap: 12,
    },
    secondaryCtaPremium: {
        flex: 1,
        minHeight: 52,
        borderRadius: 16,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    secondaryCtaTextPremium: {
        color: '#1e293b',
        fontSize: 15,
        fontWeight: '700',
    },
    destructiveActionRowPremium: {
        flexDirection: 'row',
        gap: 8,
    },
    ghostDangerCtaPremium: {
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: '#fff1f2',
        borderWidth: 1,
        borderColor: '#ffe4e6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalOverlayPremium: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15,23,42,0.6)',
    },
    modalContentPremium: {
        maxHeight: '85%',
        paddingHorizontal: 24,
        paddingTop: 12,
        paddingBottom: 20,
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        ...SHADOWS.lg,
    },
    modalDragIndicator: {
        width: 40,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#cbd5e1',
        alignSelf: 'center',
        marginBottom: 16,
    },
    modalHeaderPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    modalTitleTextPremium: {
        color: '#0f172a',
        fontSize: 22,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    modalCloseBtnPremium: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputGroupPremium: {
        marginBottom: 20,
    },
    labelPremium: {
        color: '#475569',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 8,
        marginLeft: 4,
    },
    inputPremium: {
        minHeight: 56,
        borderRadius: 16,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '600',
    },
    textAreaPremium: {
        minHeight: 110,
        textAlignVertical: 'top',
        paddingTop: 16,
    },
    saveButtonPremium: {
        minHeight: 56,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6d28d9',
        marginTop: 12,
        ...SHADOWS.md,
    },
    saveButtonTextPremium: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
    actionButtonDisabled: {
        opacity: 0.66,
    },
});
