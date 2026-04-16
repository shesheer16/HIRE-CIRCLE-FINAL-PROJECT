import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import CharmTitle from '../components/CharmTitle';
import { validateNotificationsResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { logger } from '../utils/logger';
import { PALETTE } from '../theme/theme';
import { SCREENSHOT_MOCKS_ENABLED, SCREENSHOT_NOTIFICATIONS } from '../config/screenshotMocks';
const LOADING_CAP_MS = 3000;

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const normalizeObjectId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        const normalized = value.trim();
        return OBJECT_ID_PATTERN.test(normalized) ? normalized : '';
    }
    if (typeof value === 'object') {
        const nestedId = normalizeObjectId(value._id || value.id || value.$oid || '');
        if (nestedId) return nestedId;
    }
    return '';
};

export default function NotificationsScreen({ navigation }) {
    const setNotificationsCount = useAppStore(state => state.setNotificationsCount);
    const activeChatId = useAppStore(state => state.activeChatId);
    const role = useAppStore(state => state.role);
    const normalizedRole = String(role || '').toLowerCase();
    const isEmployer = normalizedRole === 'employer' || normalizedRole === 'recruiter';
    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const fetchNotifications = useCallback(async ({ showLoader = true } = {}) => {
        let loadCap;
        try {
            if (SCREENSHOT_MOCKS_ENABLED) {
                setNotifications(SCREENSHOT_NOTIFICATIONS);
                setNotificationsCount(SCREENSHOT_NOTIFICATIONS.filter((item) => !item.isRead).length);
                setLoading(false);
                setRefreshing(false);
                setError('');
                setStatus('');
                return;
            }
            const useLoader = showLoader || (notifications.length === 0 && loading);
            if (useLoader) {
                setLoading(true);
            } else {
                setRefreshing(true);
            }
            setError('');
            loadCap = setTimeout(() => {
                setLoading(false);
                setRefreshing(false);
                if (notifications.length === 0) {
                    setStatus('No new notifications right now.');
                }
                setError('');
            }, LOADING_CAP_MS);
            const { data } = await client.get('/api/notifications', {
                __skipApiErrorHandler: true,
                timeout: 6000,
            });
            const validatedNotifications = validateNotificationsResponse(data);
            setNotifications(validatedNotifications);
            const unreadCount = Number(data?.unreadCount);
            if (Number.isFinite(unreadCount)) {
                setNotificationsCount(unreadCount);
            } else {
                setNotificationsCount(validatedNotifications.filter((item) => !item.isRead).length);
            }
        } catch (fetchError) {
            if (fetchError?.name === 'ApiValidationError') {
                logValidationError(fetchError, '/api/notifications');
            }
            if (notifications.length === 0) {
                setStatus('No new notifications right now.');
            }
            setError('');
        } finally {
            setLoading(false);
            setRefreshing(false);
            clearTimeout(loadCap);
        }
    }, [loading, notifications.length, setNotificationsCount]);

    useFocusEffect(useCallback(() => {
        fetchNotifications({ showLoader: false });
    }, [fetchNotifications]));

    const markAsRead = async (id) => {
        try {
            const { data } = await client.put(`/api/notifications/${id}/read`, {}, { __skipApiErrorHandler: true });
            const unreadCount = Number(data?.unreadCount);
            setNotifications(prev => {
                const next = prev.map(n => n._id === id ? { ...n, isRead: true } : n);
                if (Number.isFinite(unreadCount)) {
                    setNotificationsCount(unreadCount);
                } else {
                    setNotificationsCount(next.filter((item) => !item.isRead).length);
                }
                return next;
            });
        } catch (error) {
            logger.warn('Failed to mark notification read:', error?.message || error);
        }
    };

    const markAllRead = async () => {
        try {
            const { data } = await client.put('/api/notifications', {}, { __skipApiErrorHandler: true });
            setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
            const unreadCount = Number(data?.unreadCount);
            setNotificationsCount(Number.isFinite(unreadCount) ? unreadCount : 0);
        } catch (error) {
            logger.warn('Failed to mark all notifications read:', error?.message || error);
        }
    };

    const clearAll = async () => {
        if (clearing) return;
        setClearing(true);
        // Optimistically clear the UI immediately.
        setNotifications([]);
        setNotificationsCount(0);
        try {
            await client.delete('/api/notifications', { __skipApiErrorHandler: true });
        } catch (error) {
            logger.warn('Failed to clear all notifications:', error?.message || error);
            // Even on failure, keep UI cleared — user intent was clear.
        } finally {
            setClearing(false);
        }
    };

    const handlePress = (item) => {
        if (!item.isRead) markAsRead(item._id);

        if (item.type === 'application_received' && item.relatedData?.jobId) {
            navigation.navigate('MainTab', { screen: isEmployer ? 'My Jobs' : 'Applications' });
        } else if (['status_update', 'application_accepted', 'offer_update', 'interview_schedule'].includes(item.type)) {
            navigation.navigate('MainTab', { screen: 'Applications' });
        } else if (item.type === 'message_received') {
            const applicationId = normalizeObjectId(
                item?.relatedData?.applicationId
                || item?.relatedData?.chatId
                || item?.applicationId
            );
            if (applicationId) {
                if (String(activeChatId) === String(applicationId)) {
                    return;
                }
                navigation.navigate('Chat', { applicationId });
            }
        }
    };

    const getIcon = (type) => {
        switch (type) {
            case 'match_found': return { name: 'sparkles', color: PALETTE.accent };
            case 'application_received': return { name: 'document-text', color: '#3b82f6' };
            case 'message_received': return { name: 'chatbubble', color: '#22c55e' };
            case 'status_update': return { name: 'information-circle', color: '#f59e0b' };
            default: return { name: 'notifications', color: PALETTE.textTertiary };
        }
    };

    const formatTimeAgo = (dateString) => {
        const now = new Date();
        const date = new Date(dateString);
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHr / 24);
        const diffWeek = Math.floor(diffDay / 7);
        if (diffMin < 1) return 'now';
        if (diffMin < 60) return `${diffMin}m`;
        if (diffHr < 24) return `${diffHr}h`;
        if (diffDay < 7) return `${diffDay}d`;
        return `${diffWeek}w`;
    };

    const renderItem = ({ item }) => {
        const iconConfig = getIcon(item.type);
        return (
            <TouchableOpacity
                style={[styles.notifCard, !item.isRead && styles.notifCardUnread]}
                onPress={() => handlePress(item)}
                activeOpacity={0.6}
            >
                <View style={[styles.iconBox, { backgroundColor: iconConfig.color + '14' }]}>
                    <Ionicons name={iconConfig.name} size={22} color={iconConfig.color} />
                </View>
                <View style={styles.notifContent}>
                    <Text style={[styles.notifTitle, !item.isRead && styles.textUnread]} numberOfLines={1}>
                        {item.title}
                    </Text>
                    <Text style={[styles.notifMessage, !item.isRead && styles.messageUnread]} numberOfLines={2}>
                        {item.message}
                    </Text>
                    <Text style={styles.notifTime}>
                        {formatTimeAgo(item.createdAt)}
                    </Text>
                </View>
                {!item.isRead && <View style={styles.unreadDot} />}
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <View style={styles.header}>
                    <CharmTitle text="Notifications" fontSize={22} fontWeight="800" letterSpacing={-0.4} />
                </View>
                <View style={styles.skeletonWrap}>
                    <SkeletonLoader height={72} style={styles.skeletonItem} />
                    <SkeletonLoader height={72} style={styles.skeletonItem} />
                    <SkeletonLoader height={72} style={styles.skeletonItem} />
                    <SkeletonLoader height={72} style={styles.skeletonItem} />
                    <SkeletonLoader height={72} style={styles.skeletonItem} />
                </View>
            </SafeAreaView>
        );
    }

    const unreadCount = notifications.filter(n => !n.isRead).length;

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <CharmTitle text="Notifications" fontSize={22} fontWeight="800" letterSpacing={-0.4} />
                <View style={styles.headerActions}>
                    {unreadCount > 0 && (
                        <TouchableOpacity onPress={markAllRead} style={styles.headerActionBtn} activeOpacity={0.7}>
                            <Ionicons name="checkmark-done-outline" size={22} color={PALETTE.textPrimary} />
                        </TouchableOpacity>
                    )}
                    {notifications.length > 0 && (
                        <TouchableOpacity onPress={clearAll} disabled={clearing} style={styles.headerActionBtn} activeOpacity={0.7}>
                            <Ionicons name="trash-outline" size={20} color={clearing ? PALETTE.textTertiary : PALETTE.textPrimary} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {error ? null : notifications.length === 0 ? (
                <EmptyState
                    icon="🔔"
                    title="You're all caught up"
                    subtitle={status || 'Notifications appear here when there is activity.'}
                />
            ) : (
                <FlatList
                    data={notifications}
                    keyExtractor={(item, index) => String(item?._id || `notification-${index}`)}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => fetchNotifications({ showLoader: false })}
                            tintColor={PALETTE.textPrimary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                    removeClippedSubviews={Platform.OS === 'android'}
                    maxToRenderPerBatch={10}
                    windowSize={10}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.surface,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: PALETTE.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: PALETTE.separator,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: PALETTE.accent,
        letterSpacing: -0.3,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    headerActionBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    skeletonWrap: {
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    skeletonItem: {
        borderRadius: 0,
        marginBottom: 1,
    },
    listContent: {
        paddingBottom: 20,
    },
    notifCard: {
        flexDirection: 'row',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: PALETTE.surface,
        alignItems: 'flex-start',
    },
    notifCardUnread: {
        backgroundColor: PALETTE.surface,
    },
    iconBox: {
        width: 52,
        height: 52,
        borderRadius: 26,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    notifContent: {
        flex: 1,
        paddingTop: 2,
    },
    notifTitle: {
        fontSize: 14,
        color: PALETTE.textSecondary,
        fontWeight: '400',
        lineHeight: 18,
    },
    textUnread: {
        color: PALETTE.textPrimary,
        fontWeight: '600',
    },
    notifMessage: {
        fontSize: 14,
        color: PALETTE.textTertiary,
        lineHeight: 19,
        marginTop: 2,
    },
    messageUnread: {
        color: PALETTE.textSecondary,
    },
    notifTime: {
        fontSize: 12,
        color: PALETTE.textTertiary,
        marginTop: 4,
    },
    unreadDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#3b82f6',
        marginTop: 6,
        marginLeft: 8,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: '20%',
    },
    emptyText: {
        marginTop: 16,
        color: PALETTE.textTertiary,
        fontSize: 16,
    },
});
