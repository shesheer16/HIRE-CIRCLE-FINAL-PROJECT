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
import CharmTitle from '../components/CharmTitle';
import client from '../api/client';
import { validateApplicationsResponse } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { PALETTE, SCREEN_CHROME } from '../theme/theme';
import {
    APPLICATION_FILTER_OPTIONS,
    CHAT_READY_APPLICATION_STATUSES,
    doesApplicationStatusMatchFilter,
    getApplicationStatusLabel,
    normalizeApplicationStatus,
} from '../utils/applicationPresentation';
import { getProfileGateMessage, isProfileRoleGateError } from '../utils/profileReadiness';
import { SCREENSHOT_APPLICATIONS_RAW, SCREENSHOT_MOCKS_ENABLED } from '../config/screenshotMocks';

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
const SUPPRESSED_APPS_KEY = {
    employer: '@suppressed_apps_employer',
    worker: '@suppressed_apps_worker',
};
const LOADING_CAP_MS = 5000;
const REFRESH_CAP_MS = 1500;

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
    const role = useAppStore(state => state.role);
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
    const [suppressedIds, setSuppressedIds] = useState([]);
    const mountedRef = useRef(true);
    const hireCelebrationShownRef = useRef(false);
    const searchInputRef = useRef(null);
    const initialLoadCompletedRef = useRef(false);
    const applicationsRef = useRef([]);
    const fetchRequestIdRef = useRef(0);
    const abortControllerRef = useRef(null);
    const applicationCacheKey = isEmployer ? APPLICATION_CACHE_KEYS.employer : APPLICATION_CACHE_KEYS.worker;
    const suppressionKey = isEmployer ? SUPPRESSED_APPS_KEY.employer : SUPPRESSED_APPS_KEY.worker;

    const mapApplicationItem = useCallback((item) => {
        const job = item?.job || {};
        const employer = item?.employer || {};
        const worker = item?.worker || {};
        const jobDeleted = Boolean(
            item?.jobDeleted
            || job?.deleted
            || job?.isDeleted
            || job?.deletedAt
            || String(job?.status || '').toLowerCase() === 'deleted'
        );
        if (jobDeleted) return null;

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
            : '';
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
        try {
            const raw = await AsyncStorage.getItem(applicationCacheKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_error) {
            // Corrupted cache — treat as empty
            return [];
        }
    }, [applicationCacheKey]);

    const readSuppressedIds = useCallback(async () => {
        try {
            const raw = await AsyncStorage.getItem(suppressionKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            return [];
        }
    }, [suppressionKey]);

    const writeSuppressedIds = useCallback(async (list = []) => {
        if (!Array.isArray(list)) return;
        await AsyncStorage.setItem(suppressionKey, JSON.stringify(list.slice(0, 300)));
    }, [suppressionKey]);

    const writeCachedApplications = useCallback(async (list = []) => {
        if (!Array.isArray(list)) return;
        await AsyncStorage.setItem(applicationCacheKey, JSON.stringify(list.slice(0, 200)));
    }, [applicationCacheKey]);

    const fetchApplications = useCallback(async ({ refresh = false } = {}) => {
        const requestId = fetchRequestIdRef.current + 1;
        fetchRequestIdRef.current = requestId;
        let loadCap;
        try {
            if (SCREENSHOT_MOCKS_ENABLED) {
                const mapped = SCREENSHOT_APPLICATIONS_RAW
                    .map(mapApplicationItem)
                    .filter(Boolean)
                    .filter((item) => item.applicationId)
                    .filter((item) => !suppressedIds.includes(item.applicationId));
                setApplicationsAndRef(mapped);
                setIsLoading(false);
                setIsRefreshing(false);
                setError('');
                setInlineErrorMessage('');
                setSoftLoadIssue('');
                setProfileGateMessage('');
                initialLoadCompletedRef.current = true;
                if (!hireCelebrationShownRef.current && mapped.some((item) => item.statusCanonical === 'hired')) {
                    hireCelebrationShownRef.current = true;
                    setShowHireConfetti(true);
                }
                return;
            }
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

            // Abort any ongoing request before starting a new one
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();
            loadCap = setTimeout(() => {
                if (requestId === fetchRequestIdRef.current) {
                    setIsLoading(false);
                    setIsRefreshing(false);
                    if (applicationsRef.current.length === 0) {
                        setInlineErrorMessage((prev) => prev || 'Taking longer than usual. Showing last known info.');
                    }
                }
            }, refresh ? REFRESH_CAP_MS : LOADING_CAP_MS);

            let list = null;
            let lastError = null;
            const requestPlans = [
                {
                    timeout: 5000,
                    params: {
                        limit: 160,
                        includeArchived: true,
                        skipTotal: true,
                    },
                },
                {
                    timeout: 3000,
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
                        signal: abortControllerRef.current.signal,
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

            const mapped = list
                .map(mapApplicationItem)
                .filter(Boolean)
                .filter((item) => item.applicationId)
                .filter((item) => !suppressedIds.includes(item.applicationId));
            if (mountedRef.current && requestId === fetchRequestIdRef.current) {
                setIsLoading(false);
                setIsRefreshing(false);
                initialLoadCompletedRef.current = true;
                setApplicationsAndRef(mapped);
                writeCachedApplications(mapped).catch(() => null);
                if (!hireCelebrationShownRef.current && mapped.some((item) => item.statusCanonical === 'hired')) {
                    hireCelebrationShownRef.current = true;
                    setShowHireConfetti(true);
                }
                clearTimeout(loadCap);
            }
        } catch (e) {
            // If request was aborted by us, do nothing
            if (e.name === 'CanceledError' || e.message?.includes('aborted')) {
                clearTimeout(loadCap);
                return;
            }
            
            if (requestId !== fetchRequestIdRef.current) {
                clearTimeout(loadCap);
                return;
            }
            if (isProfileRoleGateError(e)) {
                if (mountedRef.current) {
                    setIsLoading(false);
                    setIsRefreshing(false);
                    initialLoadCompletedRef.current = true;
                    setApplications([]);
                    setError('');
                    setInlineErrorMessage('');
                    setProfileGateMessage(getProfileGateMessage({ role: isEmployer ? 'employer' : 'worker' }));
                }
                clearTimeout(loadCap);
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
                setIsLoading(false);
                setIsRefreshing(false);
                initialLoadCompletedRef.current = true;
                
                if (applicationsRef.current.length === 0 && persistedCache.length > 0) {
                    setApplicationsAndRef(persistedCache);
                } else if (!hasCachedApplications) {
                    setApplicationsAndRef([]);
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
            clearTimeout(loadCap);
        }
    }, [isEmployer, mapApplicationItem, readCachedApplications, suppressedIds, writeCachedApplications]);

    useEffect(() => {
        mountedRef.current = true;
        readSuppressedIds().then((ids) => {
            if (Array.isArray(ids)) setSuppressedIds(ids);
        }).catch(() => {});
        return () => {
            mountedRef.current = false;
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [readSuppressedIds]);

    useEffect(() => {
        applicationsRef.current = applications;
    }, [applications]);

    // Keep ref in sync also when setState is called — avoids 1-frame stale read
    const setApplicationsAndRef = useCallback((nextOrUpdater) => {
        setApplications((prev) => {
            const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
            applicationsRef.current = next;
            return next;
        });
    }, []);

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

    const handleDeleteApplication = useCallback((item) => {
        const targetId = String(item?.applicationId || '').trim();
        if (!targetId) return;

        Alert.alert('Delete application', 'This removes the application and resets conversation access. Continue?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    // Optimistic local removal
                    setApplicationsAndRef((prev) => {
                        const next = prev.filter((row) => String(row?.applicationId || '') !== targetId);
                        writeCachedApplications(next).catch(() => null);
                        return next;
                    });

                    // Persist suppression for employers so talent tab data stays untouched but Apps hides it
                    if (isEmployer) {
                        setSuppressedIds((prev) => {
                            const next = Array.from(new Set([...prev, targetId]));
                            writeSuppressedIds(next).catch(() => null);
                            return next;
                        });
                    }

                    try {
                        await client.put(`/api/applications/${targetId}/status`, { status: 'shortlisted' }, {
                            __skipApiErrorHandler: true,
                            __maxRetries: 0,
                        }).catch(() => null);
                        if (!isEmployer) {
                            await client.delete(`/api/applications/${targetId}`, {
                                __skipApiErrorHandler: true,
                                __maxRetries: 0,
                            }).catch(() => null);
                        }
                    } catch (_e) {
                        // If network fails, UI already removed; background refetch will reconcile later.
                    }
                },
            },
        ]);
    }, [isEmployer, setApplicationsAndRef, writeCachedApplications, writeSuppressedIds]);

const renderItem = ({ item }) => (
    <TouchableOpacity
        style={styles.rowCard}
        activeOpacity={0.82}
        onPress={() => handleOpenApplication(item)}
        onLongPress={() => handleDeleteApplication(item)}
    >
        <View style={styles.rowCardGlow} />
        <View style={styles.row}>
            <View style={styles.avatarWrap}>
                <Image source={{ uri: item.avatar }} style={styles.avatar} />
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
                        <View style={styles.rowActions}>
                            <TouchableOpacity style={styles.rowChevronBubble} activeOpacity={0.8} onPress={() => handleOpenApplication(item)}>
                                <Ionicons name="chevron-forward" size={15} color="#94a3b8" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.rowDeleteBubble} activeOpacity={0.8} onPress={() => handleDeleteApplication(item)}>
                                <Ionicons name="trash" size={14} color="#ef4444" />
                            </TouchableOpacity>
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
                <View style={styles.headerBarShell}>
                    <View style={styles.headerTopRow}>
                        <View style={styles.headerTitleWrap}>
                            <CharmTitle text={isEmployer ? 'Apps' : 'Applications'} />
                        </View>
                        <View style={styles.headerControls}>
                            <TouchableOpacity
                                style={[styles.searchToggleBtn, isSearchOpen && styles.filterBtnActive]}
                                onPress={isSearchOpen ? closeSearch : openSearch}
                                activeOpacity={0.7}
                                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                            >
                                <Ionicons
                                    name={isSearchOpen ? 'close' : 'search'}
                                    size={22}
                                    color={isSearchOpen ? '#7c3aed' : PALETTE.textPrimary}
                                />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.filterBtn, (showFilterModal || selectedFilter !== 'All') && styles.filterBtnActive]}
                                onPress={() => {
                                    searchInputRef.current?.blur?.();
                                    setShowFilterModal(true);
                                }}
                                activeOpacity={0.7}
                                hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                            >
                                <Ionicons
                                    name="options-outline"
                                    size={22}
                                    color={(showFilterModal || selectedFilter !== 'All') ? '#7c3aed' : PALETTE.textPrimary}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
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
        backgroundColor: PALETTE.surface,
    },
    header: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 0,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    headerBarShell: {
        paddingHorizontal: 18,
        paddingVertical: 12,
    },
    employerTopRail: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
        paddingHorizontal: 18,
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
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: PALETTE.accent,
        letterSpacing: -0.3,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    searchToggleBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    searchDock: {
        marginTop: 12,
        paddingHorizontal: 18,
    },
    searchWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        borderRadius: 22,
        paddingHorizontal: 14,
        minHeight: 46,
    },
    searchIcon: {
        color: PALETTE.textSecondary,
        opacity: 0.95,
    },
    searchInput: {
        flex: 1,
        marginLeft: 6,
        fontSize: 13,
        color: PALETTE.textPrimary,
        paddingVertical: 0,
    },
    searchClearBtn: {
        marginLeft: 6,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: PALETTE.surface2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filterBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    filterBtnActive: {
        backgroundColor: '#ede9fe',
        borderColor: '#d8b4fe',
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
        color: PALETTE.accentDeep,
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
        color: PALETTE.textPrimary,
        letterSpacing: -0.4,
    },
    heroSubtitle: {
        marginTop: 5,
        fontSize: 12.5,
        lineHeight: 18,
        color: PALETTE.textSecondary,
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
        color: PALETTE.textTertiary,
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
        color: PALETTE.textPrimary,
        textAlign: 'center',
    },
    stateSubtitle: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '600',
        color: PALETTE.textSecondary,
        textAlign: 'center',
    },
    statePrimaryAction: {
        marginTop: 16,
        borderRadius: 16,
        backgroundColor: PALETTE.accentDeep,
        paddingHorizontal: 18,
        paddingVertical: 13,
    },
    statePrimaryActionText: {
        fontSize: 13,
        fontWeight: '800',
        color: PALETTE.textInverted,
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
        paddingBottom: 88,
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
        color: PALETTE.textPrimary,
        letterSpacing: -0.2,
    },
    listHeaderCount: {
        minWidth: 36,
        height: 36,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    listHeaderCountText: {
        color: PALETTE.accentDeep,
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
        borderColor: PALETTE.separator,
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
        backgroundColor: PALETTE.accentMid,
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
        color: PALETTE.textPrimary,
    },
    counterpartyRoleText: {
        marginTop: 3,
        fontSize: 11.5,
        color: PALETTE.textSecondary,
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
        color: PALETTE.textPrimary,
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
        color: PALETTE.textSecondary,
        marginRight: 8,
        fontWeight: '600',
    },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rowChevronBubble: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.backgroundSoft,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
    },
    rowDeleteBubble: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.24)',
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
        color: PALETTE.accentDeep,
    },
    secondarySignalPill: {
        ...SCREEN_CHROME.signalChip,
        maxWidth: '70%',
    },
    secondarySignalText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: PALETTE.textSecondary,
    },
    filterOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'flex-end',
    },
    filterSheet: {
        backgroundColor: PALETTE.surface,
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 28,
    },
    filterSheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: PALETTE.separator,
        alignSelf: 'center',
        marginBottom: 14,
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
        fontSize: 17,
        fontWeight: '600',
        color: PALETTE.textPrimary,
        marginBottom: 14,
    },
    filterHeroCard: {
        backgroundColor: PALETTE.backgroundSoft,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.separator,
        marginBottom: 16,
        paddingHorizontal: 14,
        paddingVertical: 14,
    },
    filterHeroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    filterHeroTitle: {
        marginTop: 10,
        fontSize: 15,
        fontWeight: '600',
        color: PALETTE.textPrimary,
    },
    filterHeroSubtitle: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: PALETTE.textSecondary,
        fontWeight: '400',
    },
    clearFiltersAction: {
        alignSelf: 'flex-start',
        marginBottom: 12,
        paddingHorizontal: 0,
        paddingVertical: 4,
    },
    clearFiltersActionText: {
        fontSize: 13,
        color: PALETTE.accent,
        fontWeight: '600',
    },
    filterOption: {
        flex: 0,
        minHeight: 48,
        borderRadius: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: PALETTE.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.separator,
        marginBottom: 8,
    },
    filterOptionActive: {
        backgroundColor: PALETTE.accentSoft,
        borderColor: PALETTE.accent,
    },
    filterOptionText: {
        fontSize: 14,
        color: PALETTE.textPrimary,
        fontWeight: '500',
    },
    filterOptionTextActive: {
        color: PALETTE.accent,
        fontWeight: '600',
    },
});
