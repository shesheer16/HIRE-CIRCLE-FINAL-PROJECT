import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    Platform,
    Modal,
    TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import EmptyState from '../components/EmptyState';
import SkeletonLoader from '../components/SkeletonLoader';
import CelebrationConfetti from '../components/CelebrationConfetti';
import client from '../api/client';
import { validateApplicationsResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { DEMO_MODE } from '../config';

const STATUS_MAP = {
    requested: 'Applied',
    pending: 'Applied',
    shortlisted: 'Shortlisted',
    accepted: 'Accepted',
    rejected: 'Rejected',
    hired: 'Hired',
    offer_proposed: 'Offer Received',
    offer_accepted: 'Offer Accepted',
    interview: 'Interview',
    applied: 'Applied',
};

const CHAT_READY_STATUSES = new Set(['accepted', 'hired', 'offer_accepted', 'interview']);
const FILTER_OPTIONS = ['All', 'Applied', 'Shortlisted', 'Accepted', 'Rejected', 'Hired', 'Archived'];

const mapStatus = (status) => STATUS_MAP[String(status || '').toLowerCase()] || 'Applied';

const formatTimeLabel = (value) => {
    if (!value) return 'Now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Now';

    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();
    if (isToday) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString();
};

export default function ApplicationsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { role } = useAppStore();
    const normalizedRole = String(role || '').toLowerCase();
    const isEmployer = normalizedRole === 'employer' || normalizedRole === 'recruiter';

    const [applications, setApplications] = useState([]);
    const [isLoading, setIsLoading] = useState(!DEMO_MODE);
    const [error, setError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [showHireConfetti, setShowHireConfetti] = useState(false);
    const mountedRef = useRef(true);
    const hireCelebrationShownRef = useRef(false);

    const mapApplicationItem = useCallback((item) => {
        const job = item?.job || {};
        const employer = item?.employer || {};
        const worker = item?.worker || {};

        const workerName = worker?.firstName
            ? `${worker.firstName} ${worker.lastName || ''}`.trim()
            : (worker?.name || 'Candidate');
        const employerName = employer?.companyName || employer?.name || job?.companyName || 'Employer';

        const statusRaw = String(item?.status || '').toLowerCase();
        const statusLabel = mapStatus(statusRaw);
        const counterpartyName = isEmployer ? workerName : employerName;
        const fallbackPreview = CHAT_READY_STATUSES.has(statusRaw)
            ? 'Tap to open chat'
            : `Status: ${statusLabel}`;

        return {
            applicationId: String(item?._id || ''),
            counterpartyName,
            jobTitle: job?.title || item?.jobTitle || 'Untitled role',
            preview: String(item?.lastMessage || fallbackPreview),
            statusRaw,
            statusLabel,
            timeLabel: formatTimeLabel(item?.updatedAt),
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(counterpartyName)}&background=7c3aed&color=fff`,
            isChatReady: CHAT_READY_STATUSES.has(statusRaw),
        };
    }, [isEmployer]);

    const fetchApplications = useCallback(async () => {
        try {
            if (!mountedRef.current) return;
            setError('');
            if (!DEMO_MODE) {
                setIsLoading(true);
            }

            const { data } = await client.get('/api/applications');
            const list = validateApplicationsResponse(data);
            const mapped = list.map(mapApplicationItem).filter((item) => item.applicationId);
            if (mountedRef.current) {
                setApplications(mapped);
                if (!hireCelebrationShownRef.current && mapped.some((item) => item.statusRaw === 'hired')) {
                    hireCelebrationShownRef.current = true;
                    setShowHireConfetti(true);
                }
            }
        } catch (e) {
            if (e?.name === 'ApiValidationError') {
                logValidationError(e, '/api/applications');
            }
            if (mountedRef.current) {
                setError('Could not load conversations');
            }
        } finally {
            if (!DEMO_MODE) {
                if (mountedRef.current) {
                    setIsLoading(false);
                }
            }
        }
    }, [mapApplicationItem]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useFocusEffect(
        useCallback(() => {
            fetchApplications();
        }, [fetchApplications])
    );

    const visibleApplications = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return applications.filter((item) => {
            const statusPass = selectedFilter === 'All' || item.statusLabel === selectedFilter;
            if (!statusPass) return false;

            if (!query) return true;
            const haystack = `${item.counterpartyName} ${item.jobTitle} ${item.preview} ${item.statusLabel}`.toLowerCase();
            return haystack.includes(query);
        });
    }, [applications, searchQuery, selectedFilter]);

    const openChat = useCallback((item) => {
        if (!item?.applicationId) {
            Alert.alert('Chat unavailable', 'Missing conversation reference. Please refresh and try again.');
            return;
        }
        navigation.navigate('Chat', { applicationId: item.applicationId });
    }, [navigation]);

    const renderItem = ({ item }) => (
        <TouchableOpacity style={styles.row} activeOpacity={0.72} onPress={() => openChat(item)}>
            <View style={styles.avatarWrap}>
                <Image source={{ uri: item.avatar }} style={styles.avatar} />
                <View style={styles.avatarStatusDot} />
            </View>

            <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                    <Text style={styles.nameText} numberOfLines={1}>{item.counterpartyName}</Text>
                    <Text style={styles.timeText}>{item.timeLabel}</Text>
                </View>

                <Text style={styles.jobTitleText} numberOfLines={1}>{item.jobTitle}</Text>

                <View style={styles.rowBottom}>
                    <Text style={styles.previewText} numberOfLines={1}>{item.preview}</Text>
                    {item.isChatReady ? (
                        <View style={styles.readyBadge} />
                    ) : (
                        <Text style={styles.statusText}>{item.statusLabel}</Text>
                    )}
                </View>
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={styles.container}>
            <CelebrationConfetti visible={showHireConfetti} onEnd={() => setShowHireConfetti(false)} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <View style={styles.headerTopRow}>
                    <Text style={styles.headerTitle}>Applications</Text>
                    <View style={styles.headerControls}>
                        <View style={styles.searchWrap}>
                            <Ionicons name="search" size={18} style={styles.searchIcon} />
                            <TextInput
                                style={styles.searchInput}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                placeholder="Search chats"
                                placeholderTextColor="rgba(255,255,255,0.78)"
                                autoCorrect={false}
                                autoCapitalize="none"
                                returnKeyType="search"
                            />
                        </View>
                        <TouchableOpacity
                            style={[styles.filterBtn, selectedFilter !== 'All' && styles.filterBtnActive]}
                            onPress={() => setShowFilterModal(true)}
                            activeOpacity={0.8}
                        >
                            <Ionicons
                                name="options-outline"
                                size={18}
                                color={selectedFilter !== 'All' ? '#ede9fe' : 'rgba(255,255,255,0.92)'}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
                <Text style={styles.headerSubtitle}>
                    {selectedFilter === 'All' ? 'Active conversations with employers' : `Filter: ${selectedFilter}`}
                </Text>
            </View>

            {isLoading ? (
                <View style={styles.loaderWrap}>
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                </View>
            ) : error ? (
                <EmptyState
                    icon="⚠️"
                    title="Couldn’t load data"
                    subtitle="Pull down to refresh."
                    actionLabel="Retry"
                    onAction={fetchApplications}
                />
            ) : (
                <FlatList
                    data={visibleApplications}
                    keyExtractor={(item) => item.applicationId}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={Platform.OS === 'android'}
                    maxToRenderPerBatch={12}
                    windowSize={10}
                    initialNumToRender={12}
                    ListEmptyComponent={
                        <EmptyState
                            icon={applications.length > 0 ? '🔎' : (isEmployer ? '📥' : '📋')}
                            title={applications.length > 0 ? 'No results' : (isEmployer ? 'No candidates yet' : 'No applications yet')}
                            subtitle={applications.length > 0
                                ? 'Try clearing search or filters.'
                                : (isEmployer
                                    ? 'Your job posts will surface matches here'
                                    : 'Apply to jobs to start conversations')}
                            actionLabel={applications.length > 0 ? 'Clear Filters' : (isEmployer ? 'Post a Need' : 'Browse Jobs')}
                            onAction={() => {
                                if (applications.length > 0) {
                                    setSearchQuery('');
                                    setSelectedFilter('All');
                                    return;
                                }
                                navigation.navigate(isEmployer ? 'My Jobs' : 'Jobs');
                            }}
                        />
                    }
                />
            )}

            <Modal
                visible={showFilterModal}
                transparent
                animationType="fade"
                onRequestClose={() => setShowFilterModal(false)}
            >
                <TouchableOpacity
                    activeOpacity={1}
                    style={styles.filterOverlay}
                    onPress={() => setShowFilterModal(false)}
                >
                    <View style={styles.filterSheet}>
                        <Text style={styles.filterSheetTitle}>Filter Applications</Text>
                        {FILTER_OPTIONS.map((option) => (
                            <TouchableOpacity
                                key={option}
                                style={styles.filterOption}
                                onPress={() => {
                                    setSelectedFilter(option);
                                    setShowFilterModal(false);
                                }}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.filterOptionText, selectedFilter === option && styles.filterOptionTextActive]}>
                                    {option}
                                </Text>
                                {selectedFilter === option ? (
                                    <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />
                                ) : null}
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f7f9ff',
    },
    header: {
        backgroundColor: '#7c3aed',
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    headerTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '700',
        color: '#ffffff',
    },
    headerControls: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    searchWrap: {
        maxWidth: 190,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 0,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        borderRadius: 10,
        paddingHorizontal: 4,
        height: 34,
    },
    searchIcon: {
        color: '#f8fafc',
        opacity: 0.9,
    },
    searchInput: {
        flex: 1,
        marginLeft: 5,
        fontSize: 13,
        color: '#ffffff',
        paddingVertical: 0,
    },
    filterBtn: {
        width: 36,
        height: 36,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterBtnActive: {
        borderColor: '#ede9fe',
        backgroundColor: '#8b5cf6',
    },
    headerSubtitle: {
        marginTop: 6,
        fontSize: 12,
        color: 'rgba(255,255,255,0.88)',
        fontWeight: '500',
    },
    loaderWrap: {
        paddingHorizontal: 16,
        paddingTop: 10,
    },
    skeleton: {
        borderRadius: 12,
        marginBottom: 10,
    },
    listContent: {
        paddingTop: 4,
        paddingBottom: 24,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#ecf1f7',
        backgroundColor: 'rgba(255,255,255,0.98)',
    },
    avatarWrap: {
        marginRight: 12,
        position: 'relative',
    },
    avatar: {
        width: 50,
        height: 50,
        borderRadius: 25,
        borderWidth: 1,
        borderColor: '#d9e2ec',
    },
    avatarStatusDot: {
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#ffffff',
        backgroundColor: '#9333ea',
    },
    rowBody: {
        flex: 1,
        minHeight: 50,
        justifyContent: 'center',
    },
    rowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    nameText: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
        marginRight: 8,
    },
    timeText: {
        fontSize: 12,
        color: '#94a3b8',
        fontWeight: '500',
    },
    jobTitleText: {
        marginTop: 2,
        fontSize: 13,
        color: '#7c3aed',
        fontWeight: '600',
    },
    rowBottom: {
        marginTop: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    previewText: {
        flex: 1,
        fontSize: 13,
        color: '#64748b',
        marginRight: 8,
    },
    statusText: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: '600',
    },
    readyBadge: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#9333ea',
    },
    filterOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.28)',
        justifyContent: 'flex-end',
    },
    filterSheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 18,
        borderTopRightRadius: 18,
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 24,
    },
    filterSheetTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 10,
    },
    filterOption: {
        minHeight: 44,
        borderRadius: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    filterOptionText: {
        fontSize: 14,
        color: '#334155',
        fontWeight: '500',
    },
    filterOptionTextActive: {
        color: '#7c3aed',
        fontWeight: '700',
    },
});
