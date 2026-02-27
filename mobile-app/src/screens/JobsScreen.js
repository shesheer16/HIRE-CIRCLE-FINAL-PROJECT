import React, { useState, useEffect, memo, useCallback, useRef } from 'react';
import {
    View, Text, FlatList, StyleSheet, TouchableOpacity,
    ScrollView, Share, Modal, TextInput, Alert, ActivityIndicator, Platform
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorageLib from '@react-native-async-storage/async-storage';

import client from '../api/client';
import { AnimatedCard } from '../components/AnimatedCard';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import SkeletonLoader from '../components/SkeletonLoader';
import { IconBookmark, IconBookmarkFilled, IconShare } from '../components/Icons';
import EmptyState from '../components/EmptyState';

const FILTERS = ['All', 'Saved', 'High Match', 'Nearby', 'New', 'History'];
const DISMISSED_KEY = '@hire_dismissed_jobs';

// Extract the first number from salary strings like "₹25,000 - ₹30,000"
const extractSalaryNumber = (salaryStr) => {
    if (!salaryStr) return 0;
    const cleaned = salaryStr.replace(/[₹,\s]/g, '');
    const match = cleaned.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
};

const getReadableError = (error, fallbackMessage) => {
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.message === 'No internet connection') return 'No internet connection. Please check your network and try again.';
    if (error?.message === 'Network Error') return 'Unable to reach the server. Please try again.';
    if (error?.code === 'ECONNABORTED') return 'Request timed out. Please retry.';
    return fallbackMessage;
};

export default function JobsScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const [activeFilter, setActiveFilter] = useState('All');
    const [userRole, setUserRole] = useState('candidate');
    const [jobs, setJobs] = useState([]);
    const [savedJobIds, setSavedJobIds] = useState(new Set());
    const [dismissedJobs, setDismissedJobs] = useState([]);
    const [reportedJobIds, setReportedJobIds] = useState(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');

    // Filter modal state
    const [filterModalVisible, setFilterModalVisible] = useState(false);
    const [locationFilter, setLocationFilter] = useState('');
    const [minSalaryFilter, setMinSalaryFilter] = useState('');
    const [minMatchFilter, setMinMatchFilter] = useState(0);
    // Applied (active) filters
    const [appliedLocation, setAppliedLocation] = useState('');
    const [appliedMinSalary, setAppliedMinSalary] = useState(0);
    const [appliedMinMatch, setAppliedMinMatch] = useState(0);

    const matchOptions = [
        { label: 'All', value: 0 },
        { label: '75%+', value: 75 },
        { label: '90%+', value: 90 },
    ];

    const fetchJobs = useCallback(async () => {
        setIsLoading(true);
        setErrorMsg('');
        try {
            // 1. Try to load cached jobs first
            try {
                const cachedJobs = await AsyncStorageLib.getItem('@cached_jobs');
                if (cachedJobs !== null) {
                    setJobs(JSON.parse(cachedJobs));
                }
            } catch (e) {
                logger.error('Error loading cached jobs', e);
            }

            // 2. Fetch fresh jobs
            const { data } = await client.get('/api/matches/candidate');
            const matches = Array.isArray(data) ? data : (Array.isArray(data?.matches) ? data.matches : []);

            const formattedJobs = matches.map(item => {
                const job = item.job || item;
                return {
                    _id: job._id || Math.random().toString(),
                    title: job.title || 'Untitled Job',
                    companyName: job.companyName || 'Looking for Someone',
                    location: job.location || 'Remote',
                    salaryRange: job.salaryRange || 'Unspecified',
                    matchScore: item.matchScore || Math.floor(Math.random() * 20) + 60,
                    postedTime: job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'Just now',
                    requirements: job.requirements || ['Requirements not specified'],
                    fitReason: item.whyYouFit || ''
                };
            });

            setJobs(formattedJobs);

            // 3. Update Cache
            try {
                await AsyncStorageLib.setItem('@cached_jobs', JSON.stringify(formattedJobs));
            } catch (e) {
                logger.error('Error saving cached jobs', e);
            }

        } catch (error) {
            logger.error('Failed to fetch matched jobs:', error);
            setErrorMsg(getReadableError(error, 'Could not load jobs right now. Please try again.'));
        } finally {
            setIsLoading(false);
        }
    }, []);

    const loadDismissed = async () => {
        try {
            const raw = await AsyncStorageLib.getItem(DISMISSED_KEY);
            if (raw) setDismissedJobs(JSON.parse(raw));
        } catch (e) { /* ignore */ }
    };

    const saveDismissed = async (list) => {
        try {
            await AsyncStorageLib.setItem(DISMISSED_KEY, JSON.stringify(list));
        } catch (e) { /* ignore */ }
    };

    useRefreshOnFocus(fetchJobs, 'jobs');

    useFocusEffect(
        useCallback(() => {
            fetchJobs();
        }, [fetchJobs])
    );

    useEffect(() => {
        SecureStore.getItemAsync('userInfo').then(res => {
            if (res) {
                const user = JSON.parse(res);
                setUserRole(user.role ? user.role.toLowerCase() : 'candidate');
            }
        });
        loadDismissed();
    }, []);

    const activeFilterCount = [appliedLocation, appliedMinSalary > 0, appliedMinMatch > 0].filter(Boolean).length;

    // Filtering: base filter + advanced filters
    const filteredJobs = (() => {
        if (activeFilter === 'History') {
            return dismissedJobs;
        }
        const base = jobs.filter(job => {
            if (activeFilter === 'Saved') return savedJobIds.has(job._id);
            if (activeFilter === 'High Match') return job.matchScore > 80;
            if (activeFilter === 'Nearby') return !job.location.toLowerCase().includes('remote');
            if (activeFilter === 'New') return job.postedTime.includes('h');
            return true;
        });
        return base
            .filter(job => !dismissedJobs.find(d => d._id === job._id)) // hide dismissed from main feeds
            .filter(job => !appliedLocation || job.location.toLowerCase().includes(appliedLocation.toLowerCase()))
            .filter(job => !appliedMinSalary || extractSalaryNumber(job.salaryRange) >= appliedMinSalary)
            .filter(job => job.matchScore >= appliedMinMatch);
    })();

    const toggleSaveJob = useCallback((id) => {
        setSavedJobIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const dismissJob = useCallback((job) => {
        setDismissedJobs(prev => {
            const exists = prev.find(d => d._id === job._id);
            if (exists) return prev;
            const next = [...prev, { ...job, dismissedAt: Date.now() }];
            saveDismissed(next);
            return next;
        });
    }, []);

    const submitReport = async (targetId, reason) => {
        try {
            await client.post('/api/reports', { targetId, targetType: 'job', reason });
            setReportedJobIds(prev => new Set([...prev, targetId]));
            Alert.alert('Reported', 'Thank you. We will review this job.');
        } catch (e) {
            Alert.alert('Reported', 'Thank you. We will review this job.');
            setReportedJobIds(prev => new Set([...prev, targetId]));
        }
    };

    const handleReportJob = (job) => {
        Alert.alert('Report Job', 'Why are you reporting this job?', [
            { text: 'Spam or Misleading', onPress: () => submitReport(job._id, 'spam') },
            { text: 'Inappropriate Content', onPress: () => submitReport(job._id, 'inappropriate') },
            { text: 'Scam / Fraud', onPress: () => submitReport(job._id, 'scam') },
            { text: 'Cancel', style: 'cancel' }
        ]);
    };

    const handleShareJob = async (job) => {
        try {
            await Share.share({
                message: `${job.title} at ${job.companyName} — ${job.location}\nSalary: ${job.salaryRange}\n\nApply on HireApp`,
                title: job.title,
            });
        } catch (error) {
            logger.error('Error sharing job:', error);
        }
    };

    const handleApplyFilters = () => {
        setAppliedLocation(locationFilter);
        setAppliedMinSalary(minSalaryFilter ? parseInt(minSalaryFilter, 10) : 0);
        setAppliedMinMatch(minMatchFilter);
        setFilterModalVisible(false);
    };

    const handleClearFilters = () => {
        setLocationFilter('');
        setMinSalaryFilter('');
        setMinMatchFilter(0);
        setAppliedLocation('');
        setAppliedMinSalary(0);
        setAppliedMinMatch(0);
    };

    const JobCard = memo(({ item, onPress, isHistory }) => (
        <AnimatedCard
            style={[styles.card, isHistory && styles.cardHistory, reportedJobIds.has(item._id) && styles.cardReported]}
            onPress={() => onPress(item)}
            onLongPress={() => handleReportJob(item)}
        >
            {reportedJobIds.has(item._id) && (
                <View style={styles.reportedBadge}>
                    <Text style={styles.reportedBadgeText}>Reported</Text>
                </View>
            )}

            <View style={styles.actionButtonsContainerAbsolute}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleShareJob(item)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                    <IconShare size={20} color="#94a3b8" />
                </TouchableOpacity>
                {!isHistory && (
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => toggleSaveJob(item._id)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                    >
                        {savedJobIds.has(item._id) ? (
                            <IconBookmarkFilled size={20} color="#9333ea" />
                        ) : (
                            <IconBookmark size={20} color="#94a3b8" />
                        )}
                    </TouchableOpacity>
                )}
            </View>

            {userRole !== 'employer' && item.matchScore > 80 && (
                <View style={styles.matchBadgeAbsolute}>
                    <Text style={styles.matchBadgeTextAbsolute}>{item.matchScore}% MATCH</Text>
                </View>
            )}

            <View style={styles.cardHeader}>
                <Text style={styles.jobTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.companyName}>{item.companyName}</Text>
            </View>

            <View style={styles.tagsContainer}>
                {item.requirements.slice(0, 3).map((req, i) => (
                    <View key={i} style={styles.skillTag}>
                        <Text style={styles.skillTagText}>{req}</Text>
                    </View>
                ))}
            </View>

            <View style={styles.cardFooter}>
                <Text style={styles.locationText}>📍 {item.location}</Text>
                <Text style={styles.salaryText}>{item.salaryRange}</Text>
            </View>

            {isHistory && (
                <TouchableOpacity style={styles.reApplyBtn} onPress={() => alert('Navigating to job details...')}>
                    <Text style={styles.reApplyBtnText}>Re-Apply</Text>
                </TouchableOpacity>
            )}

            <Text style={styles.postedTimeText}>Posted {item.postedTime}</Text>
        </AnimatedCard>
    ));

    const handleJobPress = useCallback((item) => {
        navigation.navigate('JobDetails', {
            job: item,
            matchScore: item.matchScore,
            fitReason: `Your skills closely match the requirements for ${item.title}. You have strong expertise in ${item.requirements[0]} and ${item.requirements[1] || 'related areas'}.`
        });
    }, [navigation]);

    const renderJobCard = ({ item }) => (
        <JobCard item={item} onPress={handleJobPress} isHistory={activeFilter === 'History'} />
    );

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerTopRow}>
                    <Text style={styles.headerTitle}>
                        {userRole === 'employer' ? 'Your Job Postings' : 'Jobs for You'}
                    </Text>
                    <TouchableOpacity style={styles.filtersBtn} onPress={() => {
                        setLocationFilter(appliedLocation);
                        setMinSalaryFilter(appliedMinSalary > 0 ? String(appliedMinSalary) : '');
                        setMinMatchFilter(appliedMinMatch);
                        setFilterModalVisible(true);
                    }}>
                        <Text style={styles.filtersBtnIcon}>⚙️</Text>
                        <Text style={styles.filtersBtnText}>Filters</Text>
                        {activeFilterCount > 0 && (
                            <View style={styles.filtersBadge}>
                                <Text style={styles.filtersBadgeText}>{activeFilterCount}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersRow} contentContainerStyle={{ paddingRight: 16 }}>
                    {FILTERS.map(filter => (
                        <TouchableOpacity
                            key={filter}
                            style={[
                                styles.filterChip,
                                activeFilter === filter && styles.filterChipActive
                            ]}
                            onPress={() => setActiveFilter(filter)}
                            activeOpacity={0.8}
                        >
                            <Text style={[
                                styles.filterChipText,
                                activeFilter === filter && styles.filterChipTextActive
                            ]}>
                                {filter}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Jobs List */}
            {isLoading && jobs.length === 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                </View>
            )}
            {!isLoading && errorMsg && filteredJobs.length === 0 ? (
                <EmptyState
                    icon={<Text style={styles.emptyEmoji}>⚠️</Text>}
                    title="Could Not Load Jobs"
                    message={errorMsg}
                    actionLabel="Retry"
                    onAction={fetchJobs}
                />
            ) : (
                <>
                    {errorMsg && filteredJobs.length > 0 ? (
                        <View style={styles.errorBanner}>
                            <Text style={styles.errorBannerText}>{errorMsg}</Text>
                            <TouchableOpacity onPress={fetchJobs} style={styles.errorRetryBtn}>
                                <Text style={styles.errorRetryText}>Retry</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}
                    <FlatList
                        data={filteredJobs}
                        keyExtractor={(item) => item._id}
                        renderItem={renderJobCard}
                        contentContainerStyle={styles.listContent}
                        showsVerticalScrollIndicator={false}
                        getItemLayout={(data, index) => ({
                            length: 160,
                            offset: 160 * index,
                            index,
                        })}
                        maxToRenderPerBatch={10}
                        windowSize={10}
                        removeClippedSubviews={Platform.OS === 'android'}
                        initialNumToRender={10}
                        ListEmptyComponent={
                            <EmptyState
                                icon={<Text style={styles.emptyEmoji}>{activeFilter === 'History' ? '🗂' : '🔍'}</Text>}
                                title={activeFilter === 'Saved' ? 'No Saved Jobs' : activeFilter === 'History' ? 'No History Yet' : 'No Jobs Found'}
                                message={
                                    activeFilter === 'Saved'
                                        ? 'Tap the bookmark icon on any job to save it for later.'
                                        : activeFilter === 'History'
                                            ? 'Jobs you skip will appear here.'
                                            : 'Try adjusting your search or filter.'
                                }
                                actionLabel={activeFilter !== 'All' ? 'Clear Filters' : null}
                                onAction={activeFilter !== 'All' ? () => { setActiveFilter('All'); handleClearFilters(); } : null}
                            />
                        }
                    />
                </>
            )}

            {/* Advanced Filters Modal */}
            <Modal visible={filterModalVisible} animationType="slide" transparent onRequestClose={() => setFilterModalVisible(false)}>
                <View style={styles.filterModalOverlay}>
                    <View style={styles.filterModalSheet}>
                        <View style={styles.filterModalHeader}>
                            <Text style={styles.filterModalTitle}>Filters</Text>
                            <TouchableOpacity onPress={() => setFilterModalVisible(false)} style={styles.filterModalClose}>
                                <Text style={styles.filterModalCloseText}>✕</Text>
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                            <Text style={styles.filterLabel}>LOCATION</Text>
                            <TextInput
                                style={styles.filterInput}
                                value={locationFilter}
                                onChangeText={setLocationFilter}
                                placeholder="Any location"
                                placeholderTextColor="#94a3b8"
                            />

                            <Text style={styles.filterLabel}>MINIMUM SALARY (₹)</Text>
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
                                {matchOptions.map(opt => (
                                    <TouchableOpacity
                                        key={opt.value}
                                        style={[styles.matchOption, minMatchFilter === opt.value && styles.matchOptionActive]}
                                        onPress={() => setMinMatchFilter(opt.value)}
                                    >
                                        <Text style={[styles.matchOptionText, minMatchFilter === opt.value && styles.matchOptionTextActive]}>
                                            {opt.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </ScrollView>

                        <View style={styles.filterActions}>
                            <TouchableOpacity style={styles.clearBtn} onPress={() => { handleClearFilters(); setFilterModalVisible(false); }}>
                                <Text style={styles.clearBtnText}>CLEAR</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.applyBtn} onPress={handleApplyFilters}>
                                <Text style={styles.applyBtnText}>APPLY</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        zIndex: 10,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1e293b',
    },
    filtersBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#e9d5ff',
        gap: 4,
    },
    filtersBtnIcon: { fontSize: 14 },
    filtersBtnText: { fontSize: 13, fontWeight: '700', color: '#7e22ce' },
    filtersBadge: { backgroundColor: '#9333ea', width: 18, height: 18, borderRadius: 9, justifyContent: 'center', alignItems: 'center', marginLeft: 2 },
    filtersBadgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    filtersRow: {
        flexDirection: 'row',
    },
    filterChip: {
        backgroundColor: '#f1f5f9',
        borderRadius: 9999,
        paddingHorizontal: 16,
        paddingVertical: 6,
        marginRight: 8,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    filterChipActive: {
        backgroundColor: '#faf5ff',
        borderColor: '#e9d5ff',
    },
    filterChipText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#475569',
    },
    filterChipTextActive: {
        color: '#7e22ce',
    },
    listContent: {
        padding: 16,
        paddingBottom: 32,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        position: 'relative',
        overflow: 'hidden',
    },
    cardHistory: { opacity: 0.72 },
    cardReported: { opacity: 0.6 },
    reportedBadge: { position: 'absolute', top: 0, left: 0, backgroundColor: '#fee2e2', paddingHorizontal: 8, paddingVertical: 4, borderBottomRightRadius: 8 },
    reportedBadgeText: { fontSize: 9, fontWeight: '900', color: '#ef4444' },
    matchBadgeAbsolute: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: '#fae8ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomLeftRadius: 8,
    },
    matchBadgeTextAbsolute: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#6b21a8',
    },
    actionButtonsContainerAbsolute: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 4,
    },
    cardHeader: {
        marginBottom: 8,
        paddingRight: 64,
    },
    jobTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1e293b',
    },
    companyName: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748b',
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginVertical: 12,
    },
    skillTag: {
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    skillTagText: {
        fontSize: 12,
        color: '#475569',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f8fafc',
        paddingTop: 12,
        marginTop: 4,
    },
    locationText: {
        fontSize: 14,
        color: '#64748b',
    },
    salaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    reApplyBtn: {
        marginTop: 10,
        backgroundColor: '#faf5ff',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 10,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#e9d5ff',
    },
    reApplyBtnText: { fontSize: 12, fontWeight: '700', color: '#9333ea' },
    postedTimeText: {
        fontSize: 12,
        color: '#94a3b8',
        textAlign: 'right',
        marginTop: 8,
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    errorBanner: {
        marginHorizontal: 16,
        marginTop: 12,
        marginBottom: 4,
        backgroundColor: '#fef2f2',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#fecaca',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    errorBannerText: {
        flex: 1,
        color: '#b91c1c',
        fontSize: 12,
        fontWeight: '600',
    },
    errorRetryBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: '#fee2e2',
    },
    errorRetryText: {
        color: '#b91c1c',
        fontWeight: '800',
        fontSize: 11,
    },

    // Filter modal
    filterModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    filterModalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 0, maxHeight: '75%' },
    filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    filterModalTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a' },
    filterModalClose: { padding: 8 },
    filterModalCloseText: { fontSize: 20, color: '#64748b' },
    filterLabel: { fontSize: 10, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
    filterInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15, color: '#0f172a', marginBottom: 20 },
    matchOptions: { flexDirection: 'row', gap: 10, marginBottom: 24 },
    matchOption: { flex: 1, paddingVertical: 12, backgroundColor: '#f1f5f9', borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
    matchOptionActive: { backgroundColor: '#faf5ff', borderColor: '#e9d5ff' },
    matchOptionText: { fontSize: 14, fontWeight: '700', color: '#64748b' },
    matchOptionTextActive: { color: '#7e22ce' },
    filterActions: { flexDirection: 'row', gap: 12, paddingBottom: 24 },
    clearBtn: { flex: 1, paddingVertical: 14, backgroundColor: '#f1f5f9', borderRadius: 12, alignItems: 'center' },
    clearBtnText: { fontSize: 14, fontWeight: '900', color: '#64748b', letterSpacing: 0.5 },
    applyBtn: { flex: 2, paddingVertical: 14, backgroundColor: '#9333ea', borderRadius: 12, alignItems: 'center' },
    applyBtnText: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
});
