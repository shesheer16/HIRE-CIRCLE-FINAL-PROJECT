import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    RefreshControl,
    StyleSheet,
    TouchableOpacity,
    Image,
    Alert,
    Platform,
    Modal,
    Pressable,
    TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import EmptyState from '../components/EmptyState';
import SkeletonLoader from '../components/SkeletonLoader';
import CelebrationConfetti from '../components/CelebrationConfetti';
import client from '../api/client';
import { validateApplicationsResponse } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { SCREEN_CHROME, SHADOWS } from '../theme/theme';
import {
    APPLICATION_FILTER_OPTIONS,
    CHAT_READY_APPLICATION_STATUSES,
    doesApplicationStatusMatchFilter,
    getApplicationStatusLabel,
    normalizeApplicationStatus,
} from '../utils/applicationPresentation';
import { getProfileGateMessage, isProfileRoleGateError } from '../utils/profileReadiness';

const normalizeSearchText = (value) => (
    String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const normalizeObjectIdLike = (value) => {
    if (!value) return '';

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^[a-f0-9]{24}$/i.test(trimmed)) return trimmed;
        return '';
    }

    if (typeof value === 'object') {
        const direct = String(value?._id || value?.id || value?.$oid || '').trim();
        if (/^[a-f0-9]{24}$/i.test(direct)) return direct;

        const hexFromToString = typeof value?.toString === 'function' ? String(value.toString()).trim() : '';
        if (/^[a-f0-9]{24}$/i.test(hexFromToString)) return hexFromToString;

        const rawBuffer = value?.buffer;
        if (rawBuffer && typeof rawBuffer === 'object') {
            const bytes = [];
            for (let i = 0; i < 12; i += 1) {
                const next = rawBuffer[i] ?? rawBuffer[String(i)];
                const parsed = Number(next);
                if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
                    return '';
                }
                bytes.push(parsed);
            }
            return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
        }
    }

    return '';
};

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

const APPLICATION_CACHE_KEYS = {
    employer: '@applications_cache_employer',
    worker: '@applications_cache_worker',
};

const PremiumStateCard = ({
    icon = 'alert-circle-outline',
    accent = '#6d28d9',
    title,
    subtitle,
    actionLabel,
    onAction,
}) => (
    <View style={styles.stateCardWrap}>
        <View style={styles.stateCard}>
            <View style={[styles.stateIconBubble, { backgroundColor: `${accent}14` }]}>
                <Ionicons name={icon} size={22} color={accent} />
            </View>
            <Text style={styles.stateTitle}>{title}</Text>
            {subtitle ? <Text style={styles.stateSubtitle}>{subtitle}</Text> : null}
            {actionLabel && typeof onAction === 'function' ? (
                <TouchableOpacity style={styles.statePrimaryAction} onPress={onAction} activeOpacity={0.86}>
                    <Text style={styles.statePrimaryActionText}>{actionLabel}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    </View>
);

export default function ApplicationsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { role } = useAppStore();
    const normalizedRole = String(role || '').toLowerCase();
    const isEmployer = normalizedRole === 'employer' || normalizedRole === 'recruiter';

    const [applications, setApplications] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [inlineErrorMessage, setInlineErrorMessage] = useState('');
    const [softLoadIssue, setSoftLoadIssue] = useState('');
    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [profileGateMessage, setProfileGateMessage] = useState('');
    const [showFilterModal, setShowFilterModal] = useState(false);
    const [showHireConfetti, setShowHireConfetti] = useState(false);
    const mountedRef = useRef(true);
    const hireCelebrationShownRef = useRef(false);
    const searchInputRef = useRef(null);
    const initialLoadCompletedRef = useRef(false);
    const applicationsRef = useRef([]);
    const fetchRequestIdRef = useRef(0);
    const applicationCacheKey = isEmployer ? APPLICATION_CACHE_KEYS.employer : APPLICATION_CACHE_KEYS.worker;

    const mapApplicationItem = useCallback((item) => {
        const job = item?.job || {};
        const employer = item?.employer || {};
        const worker = item?.worker || {};

        const workerName = [worker?.firstName, worker?.lastName]
            .map((part) => String(part || '').trim())
            .filter(Boolean)
            .join(' ')
            || String(worker?.name || worker?.user?.name || worker?.displayName || 'Job Seeker').trim();
        const employerName = employer?.companyName || employer?.name || job?.companyName || 'Employer';

        const statusRaw = String(item?.status || '').toLowerCase();
        const statusCanonical = normalizeApplicationStatus(statusRaw);
        const statusLabel = getApplicationStatusLabel(statusCanonical);
        const counterpartyName = isEmployer ? workerName : employerName;
        const counterpartyRole = isEmployer
            ? String(worker?.roleProfiles?.[0]?.roleName || worker?.currentRole || worker?.title || '').trim()
            : String(job?.title || item?.jobTitle || '').trim();
        const fallbackPreview = CHAT_READY_APPLICATION_STATUSES.has(statusCanonical)
            ? 'Tap to open chat'
            : `Status: ${statusLabel}`;
        const searchText = [
            counterpartyName,
            counterpartyRole,
            job?.title,
            item?.jobTitle,
            employer?.companyName,
            employer?.name,
            worker?.name,
            worker?.firstName,
            worker?.lastName,
            workerName,
            item?.lastMessage,
            statusLabel,
            statusCanonical,
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join(' ');
        const normalizedSearchText = normalizeSearchText(searchText);
        const statusTokens = new Set([
            statusCanonical,
            normalizeApplicationStatus(statusRaw),
            normalizeSearchText(statusLabel).replace(/\s+/g, '_'),
            normalizeSearchText(statusLabel),
        ].filter(Boolean));

        return {
            applicationId: normalizeObjectIdLike(item?._id) || normalizeObjectIdLike(item?.id) || '',
            counterpartyName,
            counterpartyRole,
            jobTitle: job?.title || item?.jobTitle || 'Untitled role',
            preview: String(item?.lastMessage || fallbackPreview),
            statusRaw,
            statusCanonical,
            statusLabel,
            timeLabel: formatTimeLabel(item?.updatedAt),
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(counterpartyName)}&background=7c3aed&color=fff`,
            isChatReady: CHAT_READY_APPLICATION_STATUSES.has(statusCanonical),
            searchText: normalizedSearchText,
            statusTokens,
        };
    }, [isEmployer]);

    const readCachedApplications = useCallback(async () => {
        const raw = await AsyncStorage.getItem(applicationCacheKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }, [applicationCacheKey]);

    const writeCachedApplications = useCallback(async (list = []) => {
        if (!Array.isArray(list)) return;
        await AsyncStorage.setItem(applicationCacheKey, JSON.stringify(list.slice(0, 200)));
    }, [applicationCacheKey]);

    const fetchApplications = useCallback(async ({ refresh = false } = {}) => {
        const requestId = fetchRequestIdRef.current + 1;
        fetchRequestIdRef.current = requestId;
        try {
            if (!mountedRef.current) return;
            setError('');
            setInlineErrorMessage('');
            setSoftLoadIssue('');
            setProfileGateMessage('');
            if (refresh) {
                setIsRefreshing(true);
            } else if (!initialLoadCompletedRef.current && applicationsRef.current.length === 0) {
                setIsLoading(true);
            }

            let list = null;
            let lastError = null;
            const requestPlans = [
                {
                    timeout: 12000,
                    params: {
                        limit: 160,
                        includeArchived: true,
                        skipTotal: true,
                    },
                },
                {
                    timeout: 8000,
                    params: {
                        limit: 80,
                        includeArchived: false,
                        skipTotal: true,
                    },
                },
            ];

            for (const plan of requestPlans) {
                try {
                    const { data } = await client.get('/api/applications', {
                        __skipApiErrorHandler: true,
                        __maxRetries: 0,
                        timeout: plan.timeout,
                        params: plan.params,
                    });
                    list = validateApplicationsResponse(data);
                    lastError = null;
                    break;
                } catch (requestError) {
                    lastError = requestError;
                }
            }

            if (lastError) {
                throw lastError;
            }

            const mapped = list.map(mapApplicationItem).filter((item) => item.applicationId);
            if (mountedRef.current && requestId === fetchRequestIdRef.current) {
                setApplications(mapped);
                writeCachedApplications(mapped).catch(() => null);
                if (!hireCelebrationShownRef.current && mapped.some((item) => item.statusCanonical === 'hired')) {
                    hireCelebrationShownRef.current = true;
                    setShowHireConfetti(true);
                }
            }
        } catch (e) {
            if (requestId !== fetchRequestIdRef.current) {
                return;
            }
            if (isProfileRoleGateError(e)) {
                if (mountedRef.current) {
                    setApplications([]);
                    setError('');
                    setInlineErrorMessage('');
                    setProfileGateMessage(getProfileGateMessage({ role: isEmployer ? 'employer' : 'worker' }));
                }
                return;
            }
            if (mountedRef.current) {
                let persistedCache = [];
                try {
                    persistedCache = await readCachedApplications();
                } catch (_cacheError) {
                    persistedCache = [];
                }
                const hasCachedApplications = applicationsRef.current.length > 0 || persistedCache.length > 0;
                if (applicationsRef.current.length === 0 && persistedCache.length > 0) {
                    setApplications(persistedCache);
                } else if (!hasCachedApplications) {
                    setApplications([]);
                }
                if (hasCachedApplications) {
                    setError('');
                    setInlineErrorMessage('Couldn’t refresh applications. Showing your latest updates.');
                    setSoftLoadIssue('');
                } else if (isEmployer) {
                    setError('');
                    setInlineErrorMessage('');
                    setSoftLoadIssue('Live applicant refresh is taking longer than usual. Pull down to try again.');
                } else {
                    setError('Couldn’t load applications right now.');
                    setInlineErrorMessage('');
                    setSoftLoadIssue('');
                }
                setProfileGateMessage('');
            }
        } finally {
            if (mountedRef.current && requestId === fetchRequestIdRef.current) {
                setIsLoading(false);
                setIsRefreshing(false);
                initialLoadCompletedRef.current = true;
            }
        }
    }, [isEmployer, mapApplicationItem, readCachedApplications, writeCachedApplications]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        applicationsRef.current = applications;
    }, [applications]);

    useEffect(() => {
        if (!isSearchOpen) return;
        const handle = setTimeout(() => {
            searchInputRef.current?.focus?.();
        }, 60);
        return () => clearTimeout(handle);
    }, [isSearchOpen]);

    useFocusEffect(
        useCallback(() => {
            fetchApplications();
        }, [fetchApplications])
    );

    const visibleApplications = useMemo(() => {
        const query = normalizeSearchText(searchQuery);
        return applications.filter((item) => {
            const statusPass = doesApplicationStatusMatchFilter(item?.statusCanonical, selectedFilter);
            if (!statusPass) return false;

            if (!query) return true;
            return String(item.searchText || '').includes(query);
        });
    }, [applications, searchQuery, selectedFilter]);
    const totalApplications = applications.length;
    const chatReadyCount = useMemo(
        () => applications.filter((item) => item.isChatReady).length,
        [applications]
    );
    const currentStageCount = visibleApplications.length;
    const hasBlockingError = Boolean(error) && applications.length === 0 && !profileGateMessage;

    const openChat = useCallback((item) => {
        if (!item?.applicationId) {
            Alert.alert('Chat unavailable', 'Missing conversation reference. Please refresh and try again.');
            return;
        }
        navigation.navigate('Chat', { applicationId: item.applicationId });
    }, [navigation]);

    const handleSearchChange = useCallback((value) => {
        const nextValue = String(value || '');
        setSearchDraft(nextValue);
        setSearchQuery(nextValue.trim());
    }, []);

    const clearSearchAndFilters = useCallback(() => {
        setSearchDraft('');
        setSearchQuery('');
        setSelectedFilter('All');
    }, []);

    const clearSearchOnly = useCallback(() => {
        setSearchDraft('');
        setSearchQuery('');
    }, []);
    const openSearch = useCallback(() => {
        setIsSearchOpen(true);
    }, []);
    const closeSearch = useCallback(() => {
        searchInputRef.current?.blur?.();
        setIsSearchOpen(false);
        setSearchDraft('');
        setSearchQuery('');
    }, []);

    const handleOpenApplication = useCallback((item) => {
        searchInputRef.current?.blur?.();
        openChat(item);
    }, [openChat]);

    const renderItem = ({ item }) => (
        <TouchableOpacity style={styles.rowCard} activeOpacity={0.82} onPress={() => handleOpenApplication(item)}>
            <View style={styles.rowCardGlow} />
            <View style={styles.row}>
                <View style={styles.avatarWrap}>
                    <Image source={{ uri: item.avatar }} style={styles.avatar} />
                    <View style={styles.avatarStatusDot} />
                </View>

                <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                        <View style={styles.nameBlock}>
                            <Text style={styles.nameText} numberOfLines={1}>{item.counterpartyName}</Text>
                        </View>
                        <View style={styles.rowMeta}>
                            <Text style={styles.timeText}>{item.timeLabel}</Text>
                        </View>
                    </View>

                    <Text style={styles.jobTitleText} numberOfLines={1}>{item.jobTitle}</Text>
                    <View style={styles.rowSignalRail}>
                        <View style={[styles.statusPill, item.isChatReady && styles.statusPillReady]}>
                            <Text style={[styles.statusPillText, item.isChatReady && styles.statusPillTextReady]}>
                                {item.isChatReady ? 'Chat ready' : item.statusLabel}
                            </Text>
                        </View>
                        {item.counterpartyRole ? (
                            <View style={styles.secondarySignalPill}>
                                <Text style={styles.secondarySignalText} numberOfLines={1}>{item.counterpartyRole}</Text>
                            </View>
                        ) : null}
                    </View>

                    <View style={styles.rowBottom}>
                        <Text style={styles.previewText} numberOfLines={1}>{item.preview}</Text>
                        <View style={styles.rowChevronBubble}>
                            <Ionicons name="chevron-forward" size={15} color="#94a3b8" />
                        </View>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );

    return (
        <LinearGradient colors={isEmployer ? ['#f9fbff', '#f3f5ff', '#fbfcff'] : ['#f5f7fb', '#f5f7fb', '#f5f7fb']} style={styles.container}>
            {isEmployer ? <View style={styles.employerGlowTop} /> : null}
            {isEmployer ? <View style={styles.employerGlowBottom} /> : null}
            <CelebrationConfetti visible={showHireConfetti} onEnd={() => setShowHireConfetti(false)} />
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <LinearGradient
                    colors={isEmployer ? ['#6d28d9', '#9333ea'] : ['#7c3aed', '#a855f7']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.headerBarShell}
                >
                    <View style={styles.headerTopRow}>
                        <View style={styles.headerTitleWrap}>
                            <Text style={styles.headerEyebrow}>{isEmployer ? 'Hiring pipeline' : 'Application tracker'}</Text>
                            <Text style={styles.headerTitle}>{isEmployer ? 'Apps' : 'Applications'}</Text>
                        </View>
                        <View style={styles.headerControls}>
                            <TouchableOpacity
                                style={[styles.searchToggleBtn, isSearchOpen && styles.searchToggleBtnActive]}
                                onPress={isSearchOpen ? closeSearch : openSearch}
                                activeOpacity={0.85}
                                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                            >
                                <Ionicons name={isSearchOpen ? 'close' : 'search'} size={18} color="#6d28d9" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterBtn, selectedFilter !== 'All' && styles.filterBtnActive]}
                                onPress={() => {
                                    searchInputRef.current?.blur?.();
                                    setShowFilterModal(true);
                                }}
                                activeOpacity={0.8}
                                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                            >
                                <Ionicons
                                    name="options-outline"
                                    size={18}
                                    color="#6d28d9"
                                />
                            </TouchableOpacity>
                        </View>
                    </View>
                </LinearGradient>
                {isSearchOpen ? (
                    <View style={styles.searchDock}>
                        <View style={styles.searchWrap}>
                            <Ionicons name="search" size={18} style={styles.searchIcon} />
                            <TextInput
                                ref={searchInputRef}
                                style={styles.searchInput}
                                value={searchDraft}
                                onChangeText={handleSearchChange}
                                placeholder="Search applications"
                                placeholderTextColor="#94a3b8"
                                autoCorrect={false}
                                autoCapitalize="none"
                                returnKeyType="search"
                                onSubmitEditing={() => setSearchQuery(String(searchDraft || '').trim())}
                            />
                            <TouchableOpacity
                                style={styles.searchClearBtn}
                                onPress={searchDraft ? clearSearchOnly : closeSearch}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="close" size={14} color="#64748b" />
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : null}
                {isEmployer ? (
                    <View style={styles.employerTopRail}>
                        <View style={styles.employerSignalChip}>
                            <Text style={styles.employerSignalText}>{selectedFilter === 'All' ? 'All stages' : selectedFilter}</Text>
                        </View>
                        <View style={styles.employerSignalChip}>
                            <Text style={styles.employerSignalText}>{`${currentStageCount} visible`}</Text>
                        </View>
                        <View style={styles.employerSignalChip}>
                            <Text style={styles.employerSignalText}>{`${chatReadyCount} chat ready`}</Text>
                        </View>
                    </View>
                ) : null}
                {inlineErrorMessage ? (
                    <View style={styles.inlineErrorBanner}>
                        <Ionicons name="alert-circle-outline" size={15} color="#b45309" />
                        <Text style={styles.inlineErrorText}>{inlineErrorMessage}</Text>
                    </View>
                ) : null}
            </View>

            {isLoading ? (
                <View style={styles.loaderWrap}>
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                    <SkeletonLoader height={72} style={styles.skeleton} />
                </View>
            ) : hasBlockingError ? (
                <PremiumStateCard
                    icon="cloud-offline-outline"
                    accent="#7c3aed"
                    title={isEmployer ? 'Applicant inbox is taking longer than usual' : 'Applications are taking longer than usual'}
                    subtitle={isEmployer
                        ? 'Retry now and we’ll reconnect to your latest applicant list.'
                        : 'Retry now and we’ll reconnect to your latest application list.'}
                    actionLabel="Retry now"
                    onAction={() => fetchApplications({ refresh: true })}
                />
            ) : (
                <FlatList
                    data={visibleApplications}
                    keyExtractor={(item) => item.applicationId}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    refreshControl={(
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={() => fetchApplications({ refresh: true })}
                            tintColor="#7c3aed"
                            colors={['#7c3aed']}
                        />
                    )}
                    removeClippedSubviews={Platform.OS === 'android'}
                    maxToRenderPerBatch={12}
                    windowSize={10}
                    initialNumToRender={12}
                    ListHeaderComponent={isEmployer ? (
                        <View style={styles.listHeaderWrap}>
                            <Text style={styles.listHeaderTitle}>Live applicants</Text>
                            <View style={styles.listHeaderCount}>
                                <Text style={styles.listHeaderCountText}>{visibleApplications.length}</Text>
                            </View>
                        </View>
                    ) : null}
                    ListEmptyComponent={
                        <EmptyState
                            icon={profileGateMessage ? '🧩' : (applications.length > 0 ? '🔎' : (isEmployer ? '📥' : '📋'))}
                            title={profileGateMessage
                                ? 'Finish your profile'
                                : softLoadIssue
                                    ? 'Refreshing applicant list'
                                    : (applications.length > 0 ? 'No results' : (isEmployer ? 'No job seekers yet' : 'No applications yet'))}
                            subtitle={profileGateMessage
                                ? profileGateMessage
                                : softLoadIssue
                                    ? softLoadIssue
                                : (applications.length > 0
                                ? 'Try clearing search or filters.'
                                : (isEmployer
                                    ? 'Applications from job seekers will appear here as they move into your pipeline.'
                                    : 'Apply to jobs to start conversations'))}
                            actionLabel={profileGateMessage
                                ? 'Complete Profile'
                                : softLoadIssue
                                    ? 'Retry now'
                                    : (applications.length > 0 ? 'Clear Filters' : (isEmployer ? 'Post a Job' : 'Browse Jobs'))}
                            onAction={() => {
                                if (profileGateMessage) {
                                    navigation.navigate(isEmployer ? 'EmployerProfileCreate' : 'ProfileSetupWizard');
                                    return;
                                }
                                if (softLoadIssue) {
                                    fetchApplications({ refresh: true });
                                    return;
                                }
                                if (applications.length > 0) {
                                    clearSearchAndFilters();
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
                <Pressable
                    style={styles.filterOverlay}
                    onPress={() => setShowFilterModal(false)}
                >
                    <Pressable style={styles.filterSheet} onPress={(event) => event.stopPropagation()}>
                        <View style={styles.filterSheetHandle} />
                        <Text style={styles.filterSheetTitle}>{isEmployer ? 'Pipeline filters' : 'Application stages'}</Text>
                        {isEmployer ? (
                            <View style={styles.filterHeroCard}>
                                <View style={styles.filterHeroTopRow}>
                                    <View style={styles.heroBadge}>
                                        <Text style={styles.heroBadgeText}>{selectedFilter === 'All' ? 'All stages' : selectedFilter}</Text>
                                    </View>
                                    <View style={styles.heroPill}>
                                        <Text style={styles.heroPillText}>Hiring side</Text>
                                    </View>
                                </View>
                                <Text style={styles.filterHeroTitle}>Track every applicant clearly</Text>
                                <Text style={styles.filterHeroSubtitle}>Choose a stage, then review the list without extra dashboard noise.</Text>
                                <View style={styles.heroStatsRow}>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Total</Text>
                                        <Text style={styles.heroStatValue}>{totalApplications}</Text>
                                    </View>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Visible</Text>
                                        <Text style={styles.heroStatValue}>{currentStageCount}</Text>
                                    </View>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Chat ready</Text>
                                        <Text style={styles.heroStatValue}>{chatReadyCount}</Text>
                                    </View>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.filterHeroCard}>
                                <View style={styles.filterHeroTopRow}>
                                    <View style={styles.heroBadge}>
                                        <Text style={styles.heroBadgeText}>{selectedFilter === 'All' ? 'All stages' : selectedFilter}</Text>
                                    </View>
                                    <View style={styles.heroPill}>
                                        <Text style={styles.heroPillText}>Job seeker side</Text>
                                    </View>
                                </View>
                                <Text style={styles.filterHeroTitle}>Track every application clearly</Text>
                                <Text style={styles.filterHeroSubtitle}>
                                    {selectedFilter === 'All'
                                        ? 'See the full pipeline from applied to hired.'
                                        : `Showing ${selectedFilter.toLowerCase()} stage now.`}
                                </Text>
                                <View style={styles.heroStatsRow}>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Total</Text>
                                        <Text style={styles.heroStatValue}>{totalApplications}</Text>
                                    </View>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Visible</Text>
                                        <Text style={styles.heroStatValue}>{currentStageCount}</Text>
                                    </View>
                                    <View style={styles.heroStatCard}>
                                        <Text style={styles.heroStatLabel}>Chat ready</Text>
                                        <Text style={styles.heroStatValue}>{chatReadyCount}</Text>
                                    </View>
                                </View>
                            </View>
                        )}
                        <TouchableOpacity
                            style={styles.clearFiltersAction}
                            onPress={() => {
                                clearSearchAndFilters();
                                setShowFilterModal(false);
                            }}
                            activeOpacity={0.75}
                        >
                            <Text style={styles.clearFiltersActionText}>Reset search + filters</Text>
                        </TouchableOpacity>
                        {APPLICATION_FILTER_OPTIONS.map((option) => (
                            <TouchableOpacity
                                key={option}
                                style={[styles.filterOption, selectedFilter === option && styles.filterOptionActive]}
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
                    </Pressable>
                </Pressable>
            </Modal>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    employerGlowTop: {
        position: 'absolute',
        top: -96,
        right: -72,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(139, 108, 255, 0.16)',
    },
    employerGlowBottom: {
        position: 'absolute',
        left: -54,
        bottom: -72,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: 'rgba(96, 165, 250, 0.14)',
    },
    header: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingBottom: 10,
    },
    headerBarShell: {
        borderRadius: 0,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.18)',
        paddingHorizontal: 18,
        paddingVertical: 12,
        ...SHADOWS.md,
    },
    employerTopRail: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
        paddingHorizontal: 16,
    },
    employerSignalChip: {
        ...SCREEN_CHROME.signalChip,
    },
    employerSignalText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#475569',
    },
    headerTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    headerTitleWrap: {
        flex: 1,
    },
    headerEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: 'rgba(255,255,255,0.82)',
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 4,
    },
    headerTitle: {
        fontSize: 25,
        fontWeight: '800',
        color: '#ffffff',
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    searchToggleBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.38)',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchToggleBtnActive: {
        borderColor: '#ffffff',
        backgroundColor: '#ffffff',
    },
    searchDock: {
        marginTop: 12,
        paddingHorizontal: 16,
    },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        borderRadius: 20,
        paddingHorizontal: 12,
        minHeight: 44,
    },
    searchIcon: {
        color: '#64748b',
        opacity: 0.95,
    },
    searchInput: {
        flex: 1,
        marginLeft: 6,
        fontSize: 13,
        color: '#0f172a',
        paddingVertical: 0,
    },
    searchClearBtn: {
        marginLeft: 6,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterBtn: {
        width: 40,
        height: 40,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.38)',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterBtnActive: {
        borderColor: '#ffffff',
        backgroundColor: '#ffffff',
    },
    heroCard: {
        ...SCREEN_CHROME.heroSurface,
        marginTop: 14,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    heroBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    heroBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    heroPill: {
        ...SCREEN_CHROME.signalChip,
    },
    heroPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#475569',
    },
    heroTitle: {
        marginTop: 14,
        fontSize: 22,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.4,
    },
    heroSubtitle: {
        marginTop: 5,
        fontSize: 12.5,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    heroStatsRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 14,
    },
    heroStatCard: {
        ...SCREEN_CHROME.metricTile,
    },
    heroStatLabel: {
        fontSize: 10.5,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        color: '#94a3b8',
    },
    heroStatValue: {
        marginTop: 6,
        fontSize: 16,
        fontWeight: '800',
        color: '#111827',
    },
    inlineErrorBanner: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#fed7aa',
        backgroundColor: '#fff7ed',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    inlineErrorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#9a3412',
    },
    stateCardWrap: {
        flex: 1,
        paddingHorizontal: 16,
        paddingTop: 18,
        justifyContent: 'center',
    },
    stateCard: {
        ...SCREEN_CHROME.heroSurface,
        alignItems: 'center',
        paddingHorizontal: 18,
        paddingVertical: 24,
    },
    stateIconBubble: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
    },
    stateTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111827',
        textAlign: 'center',
    },
    stateSubtitle: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '600',
        color: '#64748b',
        textAlign: 'center',
    },
    statePrimaryAction: {
        marginTop: 16,
        borderRadius: 16,
        backgroundColor: '#7c3aed',
        paddingHorizontal: 18,
        paddingVertical: 13,
    },
    statePrimaryActionText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#ffffff',
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
        paddingTop: 8,
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    listHeaderWrap: {
        marginBottom: 10,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    listHeaderTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.2,
    },
    listHeaderCount: {
        minWidth: 36,
        height: 36,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    listHeaderCountText: {
        color: '#6d28d9',
        fontSize: 13,
        fontWeight: '800',
    },
    rowCard: {
        ...SCREEN_CHROME.contentCard,
        position: 'relative',
        marginBottom: 12,
        overflow: 'hidden',
        borderRadius: 24,
    },
    rowCardGlow: {
        position: 'absolute',
        top: -20,
        right: -12,
        width: 92,
        height: 92,
        borderRadius: 46,
        backgroundColor: 'rgba(124,58,237,0.06)',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 15,
        paddingVertical: 15,
    },
    avatarWrap: {
        marginRight: 12,
        position: 'relative',
    },
    avatar: {
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: '#e2e8f0',
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
        minHeight: 52,
    },
    nameBlock: {
        flex: 1,
        marginRight: 10,
    },
    rowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    nameText: {
        fontSize: 14.5,
        fontWeight: '800',
        color: '#111827',
    },
    counterpartyRoleText: {
        marginTop: 3,
        fontSize: 11.5,
        color: '#64748b',
        fontWeight: '700',
    },
    rowMeta: {
        alignItems: 'flex-end',
    },
    timeText: {
        marginTop: 5,
        fontSize: 11.5,
        color: '#94a3b8',
        fontWeight: '600',
    },
    jobTitleText: {
        marginTop: 8,
        fontSize: 13,
        color: '#111827',
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    rowSignalRail: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        marginTop: 10,
    },
    rowBottom: {
        marginTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    previewText: {
        flex: 1,
        fontSize: 12.5,
        color: '#64748b',
        marginRight: 8,
        fontWeight: '600',
    },
    rowChevronBubble: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#edf1f7',
    },
    statusPill: {
        ...SCREEN_CHROME.signalChip,
    },
    statusPillReady: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    statusPillText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#64748b',
    },
    statusPillTextReady: {
        color: '#6d28d9',
    },
    secondarySignalPill: {
        ...SCREEN_CHROME.signalChip,
        maxWidth: '70%',
    },
    secondarySignalText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: '#64748b',
    },
    filterOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.28)',
        justifyContent: 'flex-end',
    },
    filterSheet: {
        ...SCREEN_CHROME.heroSurface,
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
    },
    filterSheetHandle: {
        width: 54,
        height: 5,
        borderRadius: 999,
        backgroundColor: '#d7dfeb',
        alignSelf: 'center',
        marginBottom: 14,
    },
    filterSheetTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 10,
    },
    filterHeroCard: {
        ...SCREEN_CHROME.heroSurface,
        marginBottom: 12,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    filterHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    filterHeroTitle: {
        marginTop: 14,
        fontSize: 18,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.3,
    },
    filterHeroSubtitle: {
        marginTop: 5,
        fontSize: 12,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    clearFiltersAction: {
        alignSelf: 'flex-start',
        marginBottom: 8,
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    clearFiltersActionText: {
        fontSize: 12,
        color: '#7c3aed',
        fontWeight: '700',
    },
    filterOption: {
        flex: 0,
        minHeight: 48,
        borderRadius: 16,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...SCREEN_CHROME.metricTile,
        marginBottom: 8,
    },
    filterOptionActive: {
        ...SCREEN_CHROME.signalChipAccent,
    },
    filterOptionText: {
        fontSize: 14,
        color: '#334155',
        fontWeight: '700',
    },
    filterOptionTextActive: {
        color: '#7c3aed',
        fontWeight: '800',
    },
});
