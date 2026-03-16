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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import client from '../api/client';
import NudgeToast from '../components/NudgeToast';
import SocketService from '../services/socket';
import { useAppStore } from '../store/AppStore';
import { logger } from '../utils/logger';
import { SCREEN_CHROME, SHADOWS } from '../theme/theme';

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
    const insets = useSafeAreaInsets();
    const { user } = useAppStore();
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedJob, setSelectedJob] = useState(null);
    const [showResponseReminder, setShowResponseReminder] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
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
    const cacheKey = useMemo(() => `${MY_JOBS_CACHE_KEY}:${resolveUserCacheSuffix(user)}`, [user]);

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

        try {
            setSoftLoadIssue('');

            const [jobsResult, applicationsResult] = await Promise.allSettled([
                client.get('/api/jobs/my-jobs', {
                    __skipApiErrorHandler: true,
                    __maxRetries: 0,
                    __disableBaseFallback: true,
                    timeout: 10000,
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

            setJobs(stableCards);
            const shouldRemind = stableCards.some((job) => Number(job?.applicantCount || 0) > 0);
            setShowResponseReminder(shouldRemind);
            if (shouldRemind) {
                setToastVisible(true);
            }
            if (stableCards.length > 0) {
                AsyncStorage.setItem(cacheKey, JSON.stringify(stableCards)).catch(() => { });
            } else {
                AsyncStorage.removeItem(cacheKey).catch(() => { });
            }
        } catch (error) {
            if (requestId !== fetchRequestIdRef.current) return;

            try {
                const cached = await AsyncStorage.getItem(cacheKey);
                const parsed = JSON.parse(String(cached || '[]'));
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setJobs(parsed);
                    const shouldRemind = parsed.some((job) => Number(job?.applicantCount || 0) > 0);
                    setShowResponseReminder(shouldRemind);
                    setSoftLoadIssue('');
                    return;
                }
            } catch (_cacheError) {
                // Continue to zero-state fallback.
            }

            setJobs([]);
            setShowResponseReminder(false);
            setSoftLoadIssue('');
        } finally {
            if (requestId === fetchRequestIdRef.current) {
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
        fetchMyJobs({ showLoader: true });
    }, [fetchMyJobs]);

    React.useEffect(() => {
        setJobs([]);
        setSelectedJob(null);
        setShowResponseReminder(false);
        setSoftLoadIssue('');
        hasLoadedOnceRef.current = false;
    }, [cacheKey]);

    React.useEffect(() => {
        const unsubscribeFocus = navigation.addListener('focus', fetchMyJobs);
        return unsubscribeFocus;
    }, [fetchMyJobs, navigation]);

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
                    <View style={styles.detailHeroCard}>
                        <View style={styles.detailHeroHeader}>
                            <View style={styles.detailAvatarWrap}>
                                <Image
                                    source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(String(selectedJob.company || 'Company'))}&background=ede9fe&color=6d28d9&size=256` }}
                                    style={styles.detailAvatar}
                                />
                            </View>
                            <View style={styles.detailHeroCopy}>
                                <View style={[styles.statusChip, { backgroundColor: statusMeta.background, borderColor: statusMeta.border }]}>
                                    <Ionicons name={statusMeta.icon} size={13} color={statusMeta.tint} />
                                    <Text style={[styles.statusChipText, { color: statusMeta.tint }]}>{statusMeta.label}</Text>
                                </View>
                                <Text style={styles.detailTitle}>{selectedJob.title}</Text>
                                <Text style={styles.detailCompany}>{selectedJob.company}</Text>
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

                        <View style={styles.detailMetricsRow}>
                            <View style={styles.detailMetricCard}>
                                <Text style={styles.detailMetricValue}>{formatCompactNumber(selectedJob.applicantCount)}</Text>
                                <Text style={styles.detailMetricLabel}>Applicants</Text>
                            </View>
                            <View style={styles.detailMetricCard}>
                                <Text style={styles.detailMetricValue}>{formatCompactNumber(selectedJob.shortlistedCount)}</Text>
                                <Text style={styles.detailMetricLabel}>Shortlisted</Text>
                            </View>
                            <View style={styles.detailMetricCard}>
                                <Text style={styles.detailMetricValue}>{formatCompactNumber(selectedJob.hiredCount)}</Text>
                                <Text style={styles.detailMetricLabel}>Hired</Text>
                            </View>
                            <View style={styles.detailMetricCard}>
                                <Text style={styles.detailMetricValue}>{formatCompactNumber(selectedJob.acceptedCount)}</Text>
                                <Text style={styles.detailMetricLabel}>Offer yes</Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.detailSectionCard}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>About this job</Text>
                            <Text style={styles.sectionMeta}>Posted {formatPostedLabel(selectedJob.createdAt || selectedJob.postedAt)}</Text>
                        </View>
                        <Text style={styles.descriptionText}>{selectedJob.description}</Text>
                    </View>

                    <View style={styles.detailSectionCard}>
                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Must-have signals</Text>
                            <Text style={styles.sectionMeta}>{selectedJob.skills.length || 0} tags</Text>
                        </View>
                        <View style={styles.tagsContainer}>
                            {selectedJob.skills.length ? selectedJob.skills.map((skill, index) => (
                                <View key={`${selectedJob.id}-${skill}-${index}`} style={styles.requirementTag}>
                                    <Text style={styles.requirementTagText}>{skill}</Text>
                                </View>
                            )) : (
                                <View style={styles.requirementTagMuted}>
                                    <Text style={styles.requirementTagMutedText}>Add signals in edit to sharpen talent matching.</Text>
                                </View>
                            )}
                        </View>
                    </View>

                    <View style={styles.detailActionsCard}>
                        <TouchableOpacity style={styles.primaryCta} onPress={handleViewApplicants} activeOpacity={0.88}>
                            <Ionicons name="people-outline" size={18} color="#ffffff" />
                            <Text style={styles.primaryCtaText}>Review talent</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.secondaryCta, actionBusy && styles.actionButtonDisabled]}
                            onPress={openEditModal}
                            disabled={actionBusy}
                            activeOpacity={0.88}
                        >
                            <Ionicons name="create-outline" size={18} color="#0f172a" />
                            <Text style={styles.secondaryCtaText}>{actionBusy ? 'Working...' : 'Edit job'}</Text>
                        </TouchableOpacity>

                        <View style={styles.destructiveRow}>
                            <TouchableOpacity
                                style={[styles.ghostDangerCta, actionBusy && styles.actionButtonDisabled]}
                                onPress={() => handleDeleteJob(selectedJob)}
                                disabled={actionBusy}
                                activeOpacity={0.86}
                            >
                                <Text style={styles.ghostDangerCtaText}>{actionBusy ? 'Working...' : 'Delete job'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.ghostDangerCta, styles.ghostDangerCtaAlt, actionBusy && styles.actionButtonDisabled]}
                                onPress={handleDeleteAllJobs}
                                disabled={actionBusy}
                                activeOpacity={0.86}
                            >
                                <Text style={styles.ghostDangerCtaText}>{actionBusy ? 'Working...' : 'Delete all'}</Text>
                            </TouchableOpacity>
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
                        style={styles.modalOverlay}
                    >
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitleText}>Edit job</Text>
                                <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                                    <Ionicons name="close" size={24} color="#6B7280" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Job title</Text>
                                    <TextInput style={styles.input} value={editForm.title} onChangeText={(text) => setEditForm({ ...editForm, title: text })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Company / team</Text>
                                    <TextInput style={styles.input} value={editForm.company} onChangeText={(text) => setEditForm({ ...editForm, company: text })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Location</Text>
                                    <TextInput style={styles.input} value={editForm.location} onChangeText={(text) => setEditForm({ ...editForm, location: text })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Pay</Text>
                                    <TextInput style={styles.input} value={editForm.salary} onChangeText={(text) => setEditForm({ ...editForm, salary: text })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Summary</Text>
                                    <TextInput style={[styles.input, styles.textArea]} value={editForm.description} multiline onChangeText={(text) => setEditForm({ ...editForm, description: text })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Signals</Text>
                                    <TextInput style={[styles.input, styles.textArea]} value={editForm.requirements} multiline onChangeText={(text) => setEditForm({ ...editForm, requirements: text })} />
                                </View>
                                <TouchableOpacity style={[styles.saveButton, actionBusy && styles.actionButtonDisabled]} onPress={handleSaveEdit} disabled={actionBusy}>
                                    <Text style={styles.saveButtonText}>{actionBusy ? 'Saving...' : 'Save changes'}</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </LinearGradient>
        );
    }

    return (
        <LinearGradient colors={['#f9fbff', '#f3f5ff', '#fbfcff']} style={styles.container}>
            <View style={styles.screenGlowTop} />
            <View style={styles.screenGlowBottom} />
            <View style={[styles.headerShell, { paddingTop: insets.top + 10 }]}>
                <LinearGradient
                    colors={['#6d28d9', '#9333ea']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.topBarShell}
                >
                    <View style={styles.topBar}>
                        <View style={styles.topBarTitleRow}>
                            <View style={styles.topBarGlyph}>
                                <Ionicons name="briefcase-outline" size={18} color="#6d28d9" />
                            </View>
                            <View style={styles.topBarCopy}>
                                <Text style={styles.topBarEyebrow}>Roles</Text>
                                <Text style={styles.topBarTitle}>My Jobs</Text>
                            </View>
                        </View>
                        <View style={styles.topBarActions}>
                            <TouchableOpacity
                                style={styles.topActionButton}
                                onPress={() => fetchMyJobs({ showLoader: !hasLoadedOnceRef.current })}
                                activeOpacity={0.84}
                            >
                                <Ionicons name="refresh-outline" size={19} color="#6d28d9" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.topActionButton, styles.topActionButtonPrimary]}
                                onPress={() => setShowDashboardModal(true)}
                                activeOpacity={0.84}
                            >
                                <Ionicons name="options-outline" size={18} color="#6d28d9" />
                            </TouchableOpacity>
                        </View>
                    </View>
                </LinearGradient>
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
                    <View style={styles.listSectionHeader}>
                        <Text style={styles.listSectionTitle}>Live openings</Text>
                        <View style={styles.listSectionCount}>
                            <Text style={styles.listSectionCountText}>{formatCompactNumber(jobs.length)}</Text>
                        </View>
                    </View>
                    {jobs.map((job) => {
                        const statusMeta = getJobStatusMeta(job.status);

                        return (
                            <TouchableOpacity
                                key={job.id}
                                style={styles.jobCard}
                                onPress={() => setSelectedJob(job)}
                                activeOpacity={0.92}
                            >
                                <View style={styles.jobCardHeaderRow}>
                                    <View style={styles.jobIdentityWrap}>
                                        <View style={styles.jobIdentityIcon}>
                                            <Ionicons name="briefcase-outline" size={18} color="#6d28d9" />
                                        </View>
                                        <View style={styles.jobIdentityCopy}>
                                            <Text style={styles.jobCardTitle}>{job.title}</Text>
                                            <Text style={styles.jobCardCompany}>{job.company}</Text>
                                        </View>
                                    </View>
                                    <View style={[styles.statusChip, { backgroundColor: statusMeta.background, borderColor: statusMeta.border }]}>
                                        <Ionicons name={statusMeta.icon} size={13} color={statusMeta.tint} />
                                        <Text style={[styles.statusChipText, { color: statusMeta.tint }]}>{statusMeta.label}</Text>
                                    </View>
                                </View>

                                <View style={styles.cardSignalsRow}>
                                    <View style={styles.cardSignalChip}>
                                        <Ionicons name="location-outline" size={13} color="#64748b" />
                                        <Text style={styles.cardSignalChipText}>{job.location || 'Flexible'}</Text>
                                    </View>
                                    <View style={styles.cardSignalChip}>
                                        <Ionicons name="wallet-outline" size={13} color="#64748b" />
                                        <Text style={styles.cardSignalChipText}>{job.salary}</Text>
                                    </View>
                                    <View style={styles.cardSignalChip}>
                                        <Ionicons name="time-outline" size={13} color="#64748b" />
                                        <Text style={styles.cardSignalChipText}>{job.type}</Text>
                                    </View>
                                </View>

                                <View style={styles.cardTagsRow}>
                                    {job.skills.slice(0, 3).map((skill, index) => (
                                        <View key={`${job.id}-${skill}-${index}`} style={styles.cardTag}>
                                            <Text style={styles.cardTagText}>{skill}</Text>
                                        </View>
                                    ))}
                                </View>

                                {Number(job.applicantCount || 0) > 0 ? (
                                    <View style={styles.cardHighlightChip}>
                                        <Ionicons name="flash-outline" size={13} color="#6d28d9" />
                                        <Text style={styles.cardHighlightChipText}>Talent waiting</Text>
                                    </View>
                                ) : null}

                                <View style={styles.cardInsightsBand}>
                                    <View style={styles.cardInsightItem}>
                                        <Text style={styles.cardInsightValue}>{formatCompactNumber(job.applicantCount)}</Text>
                                        <Text style={styles.cardInsightLabel}>Applicants</Text>
                                    </View>
                                    <View style={styles.cardInsightDivider} />
                                    <View style={styles.cardInsightItem}>
                                        <Text style={styles.cardInsightValue}>{formatCompactNumber(job.shortlistedCount)}</Text>
                                        <Text style={styles.cardInsightLabel}>Shortlisted</Text>
                                    </View>
                                    <View style={styles.cardInsightDivider} />
                                    <View style={styles.cardInsightItem}>
                                        <Text style={styles.cardInsightValue}>{formatCompactNumber(job.hiredCount)}</Text>
                                        <Text style={styles.cardInsightLabel}>Hired</Text>
                                    </View>
                                </View>

                                <View style={styles.cardFooter}>
                                    <View style={styles.cardFooterMeta}>
                                        <Text style={styles.postedAtText}>Posted {formatPostedLabel(job.createdAt || job.postedAt)}</Text>
                                        {Number(job.acceptedCount || 0) > 0 ? (
                                            <View style={styles.cardFooterAcceptedChip}>
                                                <Ionicons name="checkmark-circle-outline" size={12} color="#0f9d67" />
                                                <Text style={styles.cardFooterAcceptedText}>{formatCompactNumber(job.acceptedCount)} offer yes</Text>
                                            </View>
                                        ) : null}
                                    </View>
                                    <View style={styles.cardFooterAction}>
                                        <Text style={styles.cardFooterActionText}>{Number(job.applicantCount || 0) > 0 ? 'Review talent' : 'Open'}</Text>
                                        <Ionicons name="chevron-forward" size={15} color="#6d28d9" />
                                    </View>
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
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
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
        paddingHorizontal: 0,
        paddingBottom: 14,
        backgroundColor: 'transparent',
    },
    topBarShell: {
        borderRadius: 0,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(15, 23, 42, 0.12)',
        paddingHorizontal: 18,
        paddingVertical: 13,
        ...SHADOWS.md,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    topBarTitleRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    topBarGlyph: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.38)',
    },
    topBarCopy: {
        gap: 2,
    },
    topBarEyebrow: {
        color: 'rgba(15, 23, 42, 0.62)',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    topBarTitle: {
        color: '#0f172a',
        fontSize: 25,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    topBarActions: {
        flexDirection: 'row',
        gap: 10,
    },
    topActionButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(15, 23, 42, 0.12)',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    topActionButtonPrimary: {
        borderColor: '#ffffff',
        backgroundColor: '#ffffff',
        ...SHADOWS.sm,
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
    jobCard: {
        padding: 16,
        ...SCREEN_CHROME.contentCard,
        borderRadius: 26,
    },
    jobCardHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
    },
    jobIdentityWrap: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    jobIdentityIcon: {
        width: 48,
        height: 48,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        ...SHADOWS.sm,
    },
    jobIdentityCopy: {
        flex: 1,
        gap: 4,
    },
    jobCardTitle: {
        color: '#0f172a',
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    jobCardCompany: {
        color: '#64748b',
        fontSize: 13,
        fontWeight: '600',
    },
    statusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
    },
    statusChipText: {
        fontSize: 11,
        fontWeight: '800',
    },
    cardSignalsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 14,
    },
    cardSignalChip: {
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
    cardSignalChipText: {
        color: '#475569',
        fontSize: 12,
        fontWeight: '600',
    },
    cardTagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 14,
    },
    cardHighlightChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginTop: 14,
    },
    cardHighlightChipText: {
        color: '#6d28d9',
        fontSize: 11,
        fontWeight: '800',
    },
    cardTag: {
        borderRadius: 12,
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#dbeafe',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    cardTagText: {
        color: '#4338ca',
        fontSize: 11,
        fontWeight: '700',
    },
    cardInsightsBand: {
        flexDirection: 'row',
        marginTop: 14,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#edf1f7',
        backgroundColor: '#fbfcff',
        paddingHorizontal: 6,
        paddingVertical: 10,
    },
    cardInsightItem: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
    },
    cardInsightValue: {
        color: '#0f172a',
        fontSize: 17,
        fontWeight: '800',
    },
    cardInsightLabel: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 3,
    },
    cardInsightDivider: {
        width: 1,
        backgroundColor: '#e2e8f0',
        marginVertical: 4,
    },
    cardFooter: {
        marginTop: 14,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#edf1f7',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardFooterMeta: {
        flex: 1,
        gap: 7,
        paddingRight: 10,
    },
    postedAtText: {
        color: '#94a3b8',
        fontSize: 12,
        fontWeight: '700',
    },
    cardFooterAcceptedChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#bbf7d0',
        backgroundColor: '#f0fdf4',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    cardFooterAcceptedText: {
        color: '#0f9d67',
        fontSize: 11,
        fontWeight: '800',
    },
    cardFooterAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        minHeight: 36,
        paddingLeft: 10,
    },
    cardFooterActionText: {
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '800',
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
    detailMetricsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 16,
    },
    detailMetricCard: {
        flexBasis: '47%',
        flexGrow: 1,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#edf1f7',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    detailMetricValue: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    detailMetricLabel: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
        marginTop: 4,
    },
    detailSectionCard: {
        padding: 18,
        ...SCREEN_CHROME.contentCard,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 12,
    },
    sectionTitle: {
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '800',
    },
    sectionMeta: {
        color: '#94a3b8',
        fontSize: 11,
        fontWeight: '700',
    },
    descriptionText: {
        color: '#475569',
        fontSize: 14,
        lineHeight: 21,
        fontWeight: '500',
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    requirementTag: {
        borderRadius: 12,
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    requirementTagText: {
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '700',
    },
    requirementTagMuted: {
        width: '100%',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    requirementTagMutedText: {
        color: '#64748b',
        fontSize: 13,
        fontWeight: '500',
        lineHeight: 19,
    },
    detailActionsCard: {
        padding: 18,
        ...SCREEN_CHROME.contentCard,
    },
    primaryCta: {
        minHeight: 52,
        borderRadius: 18,
        backgroundColor: '#6d28d9',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        ...SHADOWS.md,
    },
    primaryCtaText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
    secondaryCta: {
        marginTop: 10,
        minHeight: 50,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    secondaryCtaText: {
        color: '#0f172a',
        fontSize: 14,
        fontWeight: '800',
    },
    destructiveRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 10,
    },
    ghostDangerCta: {
        flex: 1,
        minHeight: 46,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fff5f5',
    },
    ghostDangerCtaAlt: {
        borderColor: '#fda4af',
        backgroundColor: '#fff1f2',
    },
    ghostDangerCtaText: {
        color: '#b91c1c',
        fontSize: 13,
        fontWeight: '800',
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15,23,42,0.42)',
    },
    modalContent: {
        maxHeight: '82%',
        paddingHorizontal: 22,
        paddingTop: 22,
        paddingBottom: 12,
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
    },
    modalTitleText: {
        color: '#0f172a',
        fontSize: 20,
        fontWeight: '800',
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        color: '#334155',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 8,
    },
    input: {
        minHeight: 50,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#dbe2ea',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 12,
        color: '#0f172a',
        fontSize: 15,
        fontWeight: '500',
    },
    textArea: {
        minHeight: 92,
        textAlignVertical: 'top',
    },
    saveButton: {
        minHeight: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6d28d9',
        marginTop: 6,
        marginBottom: 30,
        ...SHADOWS.md,
    },
    saveButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
    actionButtonDisabled: {
        opacity: 0.66,
    },
});
