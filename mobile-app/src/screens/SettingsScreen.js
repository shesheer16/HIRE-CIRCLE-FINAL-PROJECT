import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { logger } from '../utils/logger';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { useAppStore } from '../store/AppStore';
import { deriveAuthEntryRoleFromUser } from '../utils/authEntryState';
import { buildPreviewAuthSession, isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import FeedbackModal from '../components/FeedbackModal';
import SkeletonLoader from '../components/SkeletonLoader';
import { useTheme } from '../theme/ThemeProvider';
import { RADIUS, SCREEN_CHROME, SHADOWS, SPACING } from '../theme/theme';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import Constants from 'expo-constants';
import { getAccountRoleLabel } from '../utils/profileReadiness';

const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

const withTimeout = (promise, timeoutMs, timeoutMessage) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(timeoutMessage || 'Request timed out.'));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        clearTimeout(timeoutId);
    });
};

const CONNECT_SAVED_POST_IDS_KEY_PREFIX = '@connect_saved_post_ids_';
const getSavedPostsStorageKey = (userId = 'guest') => (
    `${CONNECT_SAVED_POST_IDS_KEY_PREFIX}${String(userId || 'guest').trim() || 'guest'}`
);
const parseSavedPostCount = (rawValue) => {
    try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        if (!Array.isArray(parsed)) return 0;
        return parsed
            .map((id) => String(id || '').trim())
            .filter(Boolean)
            .length;
    } catch (_error) {
        return 0;
    }
};

const normalizeRoleList = (rolesValue) => (
    Array.isArray(rolesValue)
        ? Array.from(new Set(
            rolesValue
                .map((role) => String(role || '').trim().toLowerCase())
                .filter((role) => role === 'worker' || role === 'employer')
        ))
        : []
);

const resolveAllowedRoles = (user = {}, fallbackPrimaryRole = 'worker') => {
    const normalizedRoles = normalizeRoleList(user?.roles);
    if (normalizedRoles.length > 0) return normalizedRoles;

    const inferredPrimaryRole = String(
        user?.activeRole || user?.primaryRole || fallbackPrimaryRole || 'worker'
    ).toLowerCase() === 'employer' ? 'employer' : 'worker';
    return [inferredPrimaryRole];
};

const SETTINGS_SECTION_META = Object.freeze({
    Account: { icon: 'person-circle-outline', tint: '#ede9fe', iconColor: '#6d28d9' },
    Privacy: { icon: 'shield-checkmark-outline', tint: '#e0f2fe', iconColor: '#0284c7' },
    'Saved Posts': { icon: 'bookmark-outline', tint: '#fae8ff', iconColor: '#a21caf' },
    Notifications: { icon: 'notifications-outline', tint: '#dcfce7', iconColor: '#15803d' },
    'Role & Preferences': { icon: 'options-outline', tint: '#fee2e2', iconColor: '#c2410c' },
    Support: { icon: 'sparkles-outline', tint: '#fef3c7', iconColor: '#b45309' },
});

export default function SettingsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { logout, userInfo, updateUserInfo, rememberAuthEntryRole } = React.useContext(AuthContext);
    const { role: appRole, setRole } = useAppStore();
    const { mode, toggleTheme, palette } = useTheme();
    const { t } = useTranslation();
    const isExpoGo = (
        Constants.executionEnvironment === 'storeClient'
        || Constants.appOwnership === 'expo'
    );

    const [isAdmin, setIsAdmin] = useState(false);

    // Notification preferences
    const [notifNewMatches, setNotifNewMatches] = useState(true);
    const [notifMessages, setNotifMessages] = useState(true);
    const [notifJobAlerts, setNotifJobAlerts] = useState(true);
    const [notifAppUpdates, setNotifAppUpdates] = useState(false);
    const [pushPermissionStatus, setPushPermissionStatus] = useState('unknown');
    const [testingNotification, setTestingNotification] = useState(false);

    // Delete Account State
    const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');
    const [deletePassword, setDeletePassword] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [profileHeader, setProfileHeader] = useState({
        name: 'User',
        role: 'candidate',
        email: '',
        avatar: null,
    });
    const [primaryRole, setPrimaryRole] = useState(appRole || getPrimaryRoleFromUser(userInfo));
    const [isFeedbackModalVisible, setFeedbackModalVisible] = useState(false);
    const [isSwitchingRole, setIsSwitchingRole] = useState(false);
    const [roleSwitchMessage, setRoleSwitchMessage] = useState('');
    const roleSwitchAnim = React.useRef(new Animated.Value(0)).current;
    const [referralDashboard, setReferralDashboard] = useState(null);
    const [upgradePrompt, setUpgradePrompt] = useState(null);
    const [subscriptionPlan, setSubscriptionPlan] = useState('free');
    const [languagePref, setLanguagePref] = useState('en');
    const [accountPhoneNumber, setAccountPhoneNumber] = useState('Not set');
    const [savedPostsCount, setSavedPostsCount] = useState(0);
    const [clearingSavedPosts, setClearingSavedPosts] = useState(false);
    const savedPostsStorageKey = React.useMemo(
        () => getSavedPostsStorageKey(String(userInfo?._id || 'guest')),
        [userInfo?._id]
    );

    useEffect(() => {
        const loadUserHeader = async () => {
            let user = userInfo || {};
            if (!userInfo) {
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                if (userInfoStr) {
                    user = JSON.parse(userInfoStr);
                }
            }

            const resolvedPrimaryRole = appRole || getPrimaryRoleFromUser(user);
            setPrimaryRole(resolvedPrimaryRole);

            setIsAdmin(Boolean(user?.isAdmin) || String(user.role || '').toLowerCase() === 'admin');

            try {
                const { data } = await client.get('/api/users/profile', {
                    params: {
                        role: resolvedPrimaryRole === 'employer' ? 'employer' : 'worker',
                    },
                });
                const profile = data?.profile || {};
                setReferralDashboard(data?.referralDashboard || null);
                const settingsResponse = await client.get('/api/settings').catch(() => null);
                setAccountPhoneNumber(String(
                    settingsResponse?.data?.accountInfo?.phoneNumber
                    || user?.phoneNumber
                    || 'Not set'
                ));
                const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
                setProfileHeader({
                    name: fullName || user.name || 'User',
                    role: getAccountRoleLabel(resolvedPrimaryRole),
                    email: user.email || '',
                    avatar: profile.avatar || profile.logoUrl || null,
                });

                const growthRes = await client.get('/api/growth/monetization-intelligence').catch(() => null);
                setUpgradePrompt(growthRes?.data?.intelligence?.upgradePrompt || null);
            } catch (e) {
                setAccountPhoneNumber(String(user?.phoneNumber || 'Not set'));
                setProfileHeader({
                    name: user.name || 'User',
                    role: getAccountRoleLabel(resolvedPrimaryRole),
                    email: user.email || '',
                    avatar: null,
                });
            }
        };
        loadUserHeader();

        // Load notification preferences
        AsyncStorage.multiGet([
            '@notif_new_matches',
            '@notif_messages',
            '@notif_job_alerts',
            '@notif_app_updates',
            '@hc_subscription_plan',
            '@language_pref',
        ]).then(pairs => {
            const vals = Object.fromEntries(pairs.map(([k, v]) => [k, v === 'true']));
            setNotifNewMatches(vals['@notif_new_matches'] ?? true);
            setNotifMessages(vals['@notif_messages'] ?? true);
            setNotifJobAlerts(vals['@notif_job_alerts'] ?? true);
            setNotifAppUpdates(vals['@notif_app_updates'] ?? false);
            const planEntry = pairs.find(([key]) => key === '@hc_subscription_plan');
            if (planEntry?.[1]) {
                setSubscriptionPlan(planEntry[1]);
            }
            const languageEntry = pairs.find(([key]) => key === '@language_pref');
            const safeLanguage = languageEntry?.[1] === 'hi' ? 'hi' : 'en';
            setLanguagePref(safeLanguage);
            i18n.changeLanguage(safeLanguage).catch(() => { });
        });

        const loadNotificationPermission = async () => {
            if (isExpoGo) {
                setPushPermissionStatus('expo_go');
                return;
            }
            try {
                const Notifications = await import('expo-notifications');
                const status = await Notifications.getPermissionsAsync();
                setPushPermissionStatus(String(status?.status || 'unknown'));
            } catch (error) {
                setPushPermissionStatus('unknown');
            }
        };
        loadNotificationPermission();
    }, [userInfo, appRole, isExpoGo]);

    const handleToggle = async (key, setter, value) => {
        setter(value);
        await AsyncStorage.setItem(key, String(value));
    };

    const loadSavedPostsCount = React.useCallback(async () => {
        try {
            const rawValue = await AsyncStorage.getItem(savedPostsStorageKey);
            setSavedPostsCount(parseSavedPostCount(rawValue));
        } catch (_error) {
            setSavedPostsCount(0);
        }
    }, [savedPostsStorageKey]);

    useEffect(() => {
        loadSavedPostsCount();
    }, [loadSavedPostsCount]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            loadSavedPostsCount();
        });
        return unsubscribe;
    }, [navigation, loadSavedPostsCount]);

    const animateRoleSwitchToast = React.useCallback((message) => {
        setRoleSwitchMessage(message);
        roleSwitchAnim.setValue(0);
        Animated.sequence([
            Animated.timing(roleSwitchAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.delay(1300),
            Animated.timing(roleSwitchAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
        ]).start(() => setRoleSwitchMessage(''));
    }, [roleSwitchAnim]);

    const toggleLanguagePreference = async () => {
        const nextLanguage = languagePref === 'hi' ? 'en' : 'hi';
        setLanguagePref(nextLanguage);
        await AsyncStorage.setItem('@language_pref', nextLanguage);
        await i18n.changeLanguage(nextLanguage).catch(() => { });
    };

    const performLocalSignOut = async () => {
        try {
            const rememberedRole = deriveAuthEntryRoleFromUser({
                ...(userInfo || {}),
                activeRole: primaryRole || userInfo?.activeRole,
                primaryRole: primaryRole || userInfo?.primaryRole,
            });
            await rememberAuthEntryRole?.(rememberedRole);
            await SecureStore.deleteItemAsync('selectedRole');
            await logout();
        } catch (error) {
            logger.error('Sign out error:', error);
        }
    };

    const handleSignOut = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign Out', style: 'destructive', onPress: performLocalSignOut
                }
            ]
        );
    };

    const applyResolvedRoleLocally = React.useCallback(async (resolvedRole, roleContract = {}, bootstrapPayload = null) => {
        const normalizedResolvedRole = String(resolvedRole || '').toLowerCase() === 'employer' ? 'employer' : 'worker';
        const localAllowedRoles = resolveAllowedRoles(userInfo || {}, primaryRole || normalizedResolvedRole);
        setPrimaryRole(normalizedResolvedRole);
        setRole(normalizedResolvedRole);
        SecureStore.setItemAsync('selectedRole', normalizedResolvedRole).catch(() => { });
        setProfileHeader((prev) => ({
            ...prev,
            role: getAccountRoleLabel(normalizedResolvedRole),
        }));

        const fallbackRoleContract = {
            roles: localAllowedRoles,
            activeRole: normalizedResolvedRole,
            primaryRole: normalizedResolvedRole,
            capabilities: undefined,
        };

        await updateUserInfo({
            ...(bootstrapPayload || {}),
            role: normalizedResolvedRole === 'employer' ? 'recruiter' : 'candidate',
            activeRole: roleContract?.activeRole || fallbackRoleContract.activeRole,
            primaryRole: roleContract?.primaryRole || fallbackRoleContract.primaryRole,
            roles: Array.isArray(roleContract?.roles) && roleContract.roles.length > 0
                ? roleContract.roles
                : fallbackRoleContract.roles,
            capabilities: roleContract?.capabilities || fallbackRoleContract.capabilities,
            hasSelectedRole: true,
        });
        await rememberAuthEntryRole?.(deriveAuthEntryRoleFromUser({
            ...(userInfo || {}),
            ...(bootstrapPayload || {}),
            accountMode: userInfo?.accountMode,
            activeRole: roleContract?.activeRole || fallbackRoleContract.activeRole,
            primaryRole: roleContract?.primaryRole || fallbackRoleContract.primaryRole,
        }));
    }, [primaryRole, rememberAuthEntryRole, setRole, updateUserInfo, userInfo]);

    const attemptRoleSwitchServerSide = React.useCallback(async (nextRole) => {
        try {
            const { data } = await client.put('/api/settings', { accountInfo: { role: nextRole } }, {
                __skipApiErrorHandler: true,
                __skipUnauthorizedHandler: true,
                __allowWhenCircuitOpen: true,
                __maxRetries: 0,
                timeout: 5000,
            });
            return data || null;
        } catch (_error) {
            return null;
        }
    }, []);

    const attemptRoleBootstrap = React.useCallback(async (resolvedRole) => {
        if (INSTANT_PREVIEW_AUTH_ENABLED) {
            return buildPreviewAuthSession({
                selectedRole: resolvedRole === 'employer' ? 'employer' : 'worker',
                email: userInfo?.email || '',
                phoneNumber: userInfo?.phoneNumber || '',
                name: userInfo?.name || '',
                hasCompletedProfile: Boolean(userInfo?.hasCompletedProfile ?? userInfo?.profileComplete ?? true),
                profileComplete: Boolean(userInfo?.profileComplete ?? userInfo?.hasCompletedProfile ?? true),
            });
        }

        try {
            const { data } = await client.post('/api/auth/dev-bootstrap', {
                role: resolvedRole,
            }, {
                __skipUnauthorizedHandler: true,
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
                __maxRetries: 1,
                timeout: 7000,
            });

            if (!data || typeof data !== 'object') {
                return null;
            }
            return data;
        } catch (_error) {
            return null;
        }
    }, [userInfo?.email, userInfo?.hasCompletedProfile, userInfo?.name, userInfo?.phoneNumber, userInfo?.profileComplete]);

    const handleRoleToggle = async () => {
        if (isSwitchingRole) return;

        const accountMode = String(userInfo?.accountMode || '').toLowerCase();
        const isHybridAccount = accountMode === 'hybrid';
        const allowedRoles = ['worker', 'employer'];
        const canToggleRoles = isHybridAccount;
        if (!canToggleRoles) {
            Alert.alert(
                'Role switching not available',
                'Your account is set up for a single role. If you need both roles, please create a dual-role account.',
                [{ text: 'OK' }]
            );
            return;
        }

        const previousRole = primaryRole === 'employer' ? 'employer' : 'worker';
        const nextRole = previousRole === 'employer' ? 'worker' : 'employer';

        setIsSwitchingRole(true);
        try {
            // Apply locally and immediately — no waiting for server responses.
            setPrimaryRole(nextRole);
            setRole(nextRole);
            setProfileHeader((prev) => ({
                ...prev,
                role: getAccountRoleLabel(nextRole),
            }));
            SecureStore.setItemAsync('selectedRole', nextRole).catch(() => { });

            // Preserve user's allowed roles and avoid UI lock if local persistence is slow.
            await withTimeout(
                updateUserInfo({
                    role: nextRole === 'employer' ? 'recruiter' : 'candidate',
                    activeRole: nextRole,
                    primaryRole: nextRole,
                    roles: allowedRoles,
                    hasSelectedRole: true,
                }),
                1800,
                'Local role update timed out.',
            ).catch((error) => {
                logger.warn('Local role persistence delayed:', error?.message || error);
            });
            await rememberAuthEntryRole?.(deriveAuthEntryRoleFromUser({
                ...(userInfo || {}),
                accountMode: userInfo?.accountMode,
                activeRole: nextRole,
                primaryRole: nextRole,
            }));

            animateRoleSwitchToast(
                nextRole === 'employer'
                    ? 'Employer mode enabled'
                    : 'Job Seeker mode enabled'
            );
            if (nextRole === 'worker') {
                Alert.alert(
                    'Role switched',
                    'Your Job Seeker profile is active. View matching jobs now?',
                    [
                        { text: 'Later', style: 'cancel' },
                        {
                            text: 'View Matches',
                            onPress: () => navigation.navigate('MainTab', {
                                screen: 'Jobs',
                                params: { source: 'role_switch', highlightMatches: true },
                            }),
                        },
                    ]
                );
            }

            // Fire-and-forget background server sync — never blocks or reverts the UI.
            attemptRoleSwitchServerSide(nextRole).then((data) => {
                const roleContract = data?.settings?.roleContract || data?.roleContract || {};
                if (roleContract?.activeRole) {
                    applyResolvedRoleLocally(roleContract.activeRole, roleContract);
                }
            }).catch(() => {
                // Background sync failed — silently ignore. User already has the new role.
            });
        } catch (error) {
            logger.warn('Role toggle failed', error?.message || error);
            setPrimaryRole(previousRole);
            setRole(previousRole);
            setProfileHeader((prev) => ({
                ...prev,
                role: getAccountRoleLabel(previousRole),
            }));
            Alert.alert('Role switch failed', 'Please try again.');
        } finally {
            setIsSwitchingRole(false);
        }
    };

    const confirmDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This will permanently delete your account and all data. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue', style: 'destructive', onPress: () => setDeleteModalVisible(true) }
            ]
        );
    };

    const executeDeleteAccount = async () => {
        if (deleteInput !== 'DELETE' || !String(deletePassword || '').trim()) return;
        setIsDeleting(true);
        try {
            await client.delete('/api/users/delete', {
                data: {
                    password: deletePassword,
                },
            });
            setDeleteModalVisible(false);
            setDeleteInput('');
            setDeletePassword('');
            await performLocalSignOut();
        } catch (error) {
            logger.error('Delete account error:', error);
            Alert.alert('Error', 'Could not delete your account. Please try again or contact support.');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSubmitFeedback = async ({ type, message }) => {
        try {
            await client.post('/api/feedback', { type, message, source: 'mobile-settings' });
            Alert.alert('Thanks for the feedback', 'We review every submission and prioritize product quality.');
        } catch (error) {
            try {
                await client.post('/api/reports', {
                    targetType: 'feedback',
                    reason: type || 'general_feedback',
                    details: message,
                });
                Alert.alert('Feedback queued', 'Your feedback was received and will be reviewed.');
            } catch (secondaryError) {
                Alert.alert('Could not submit', 'Please try again in a moment.');
            }
        }
    };

    const readablePushPermission = pushPermissionStatus === 'granted'
        ? 'Granted'
        : (pushPermissionStatus === 'expo_go'
            ? 'Use development build'
            : (pushPermissionStatus === 'denied' ? 'Denied' : 'Not set'));
    const safeFirstName = String(profileHeader.name || 'You').trim().split(/\s+/)[0] || 'You';
    const enabledNotificationCount = [
        notifNewMatches,
        notifMessages,
        notifJobAlerts,
        notifAppUpdates,
    ].filter(Boolean).length;
    const heroStats = [
        {
            label: 'Plan',
            value: subscriptionPlan === 'free' ? 'Free' : String(subscriptionPlan || 'free').toUpperCase(),
        },
        { label: 'Saved', value: String(savedPostsCount) },
        { label: 'Alerts', value: String(enabledNotificationCount) },
    ];

    const handleRequestPushPermission = async () => {
        if (isExpoGo) {
            Alert.alert(
                'Development build required',
                'Remote push notifications are not supported in Expo Go (SDK 53+). Use an EAS development build.'
            );
            setPushPermissionStatus('expo_go');
            return;
        }
        try {
            const { requestNotificationPermission } = await import('../services/NotificationService');
            const result = await requestNotificationPermission();
            const status = String(result?.status || (result?.granted ? 'granted' : 'unknown'));
            setPushPermissionStatus(status);
            Alert.alert('Permission updated', status === 'granted' ? 'Push notifications enabled.' : 'Push permission not granted.');
        } catch (error) {
            Alert.alert('Could not update permission', 'Please try again.');
        }
    };

    const handleTestNotification = async () => {
        if (testingNotification) return;
        if (isExpoGo) {
            Alert.alert(
                'Development build required',
                'Remote notifications are not supported in Expo Go. Use a development build for full push testing.'
            );
            return;
        }
        setTestingNotification(true);
        try {
            const { scheduleLocalNotificationTest } = await import('../services/NotificationService');
            await scheduleLocalNotificationTest();
            Alert.alert('Test sent', 'A local notification test has been scheduled.');
        } catch (error) {
            Alert.alert('Test failed', 'Could not schedule test notification.');
        } finally {
            setTestingNotification(false);
        }
    };

    const clearSavedPosts = React.useCallback(async () => {
        if (clearingSavedPosts) return;
        setClearingSavedPosts(true);
        try {
            await AsyncStorage.removeItem(savedPostsStorageKey);
            setSavedPostsCount(0);
            Alert.alert('Saved posts cleared', 'Your saved posts list has been reset.');
        } catch (_error) {
            Alert.alert('Clear failed', 'Could not clear saved posts right now.');
        } finally {
            setClearingSavedPosts(false);
        }
    }, [clearingSavedPosts, savedPostsStorageKey]);

    const handleClearSavedPosts = React.useCallback(() => {
        if (savedPostsCount <= 0) {
            Alert.alert('No saved posts', 'You have not saved any posts yet.');
            return;
        }
        Alert.alert(
            'Clear saved posts',
            'Remove all saved posts from your account?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: clearSavedPosts,
                },
            ]
        );
    }, [clearSavedPosts, savedPostsCount]);

    const renderHeader = () => (
        <View style={styles.headerWrap}>
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                <View style={styles.topBarCopy}>
                    <Text style={styles.topBarEyebrow}>Settings</Text>
                    <Text style={styles.topBarTitle}>Hi, {safeFirstName}</Text>
                </View>
                <TouchableOpacity
                    style={styles.topBarAction}
                    activeOpacity={0.86}
                    onPress={() => setFeedbackModalVisible(true)}
                >
                    <Ionicons name="sparkles-outline" size={18} color="#6d28d9" />
                </TouchableOpacity>
            </View>

            <LinearGradient colors={['rgba(255,255,255,0.98)', '#f7f4ff']} style={styles.profileHeader}>
                <View style={styles.profileHeaderTopRow}>
                    <Image
                        source={{
                            uri: profileHeader.avatar ||
                                `https://ui-avatars.com/api/?name=${encodeURIComponent(profileHeader.name || 'User')}&background=7c3aed&color=fff`
                        }}
                        style={styles.avatar}
                    />
                    <View style={styles.profileHeaderCopy}>
                        <View style={styles.profileRolePill}>
                            <Ionicons name="shield-checkmark-outline" size={11} color="#6d28d9" />
                            <Text style={styles.profileRolePillText}>{profileHeader.role}</Text>
                        </View>
                        <Text style={styles.userName}>{profileHeader.name}</Text>
                        <Text style={styles.userRole} numberOfLines={1}>
                            {profileHeader.email || 'Account details stay here'}
                        </Text>
                    </View>
                </View>

                <View style={styles.heroStatsRow}>
                    {heroStats.map((stat) => (
                        <View key={stat.label} style={styles.heroStatCard}>
                            <Text style={styles.heroStatValue}>{stat.value}</Text>
                            <Text style={styles.heroStatLabel}>{stat.label}</Text>
                        </View>
                    ))}
                </View>

                <View style={styles.heroActionRow}>
                    {subscriptionPlan !== 'free' ? (
                        <View style={styles.premiumBadge}>
                            <Text style={styles.premiumBadgeText}>PREMIUM</Text>
                        </View>
                    ) : (
                        <View style={styles.neutralBadge}>
                            <Text style={styles.neutralBadgeText}>Core plan</Text>
                        </View>
                    )}
                    {canSwitchRole ? (
                        <View style={styles.neutralBadge}>
                            <Text style={styles.neutralBadgeText}>Hybrid ready</Text>
                        </View>
                    ) : null}
                </View>
            </LinearGradient>
        </View>
    );

    const renderSectionTextHeader = (title) => {
        const meta = SETTINGS_SECTION_META[title] || SETTINGS_SECTION_META.Account;
        return (
            <View style={styles.sectionHeaderBg}>
                <View style={[styles.sectionHeaderIconWrap, { backgroundColor: meta.tint }]}>
                    <Ionicons name={meta.icon} size={15} color={meta.iconColor} />
                </View>
                <Text style={styles.sectionTitle}>{title}</Text>
            </View>
        );
    };

    const renderRow = (
        label,
        value = null,
        hasArrow = false,
        isSwitch = false,
        switchValue,
        onSwitchChange,
        isLast = false,
        onRowPress = null,
        switchDisabled = false
    ) => (
        <TouchableOpacity
            style={[styles.row, !isLast && styles.rowBorder]}
            activeOpacity={0.7}
            disabled={isSwitch || (!hasArrow && !value && !onRowPress)}
            onPress={onRowPress}
        >
            <Text style={styles.rowLabel}>{label}</Text>
            <View style={styles.rowRight}>
                {value ? (
                    <View style={styles.rowValuePill}>
                        <Text style={styles.rowValue}>{value}</Text>
                    </View>
                ) : null}
                {isSwitch && (
                    <Switch
                        value={switchValue}
                        onValueChange={onSwitchChange}
                        disabled={switchDisabled}
                        trackColor={{ false: '#e2e8f0', true: '#10b981' }}
                        thumbColor="#ffffff"
                        style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
                    />
                )}
                {hasArrow && <Text style={styles.arrowIcon}>›</Text>}
            </View>
        </TouchableOpacity>
    );

    const canSwitchRole = String(userInfo?.accountMode || '').toLowerCase() === 'hybrid';

    return (
        <LinearGradient colors={['#f9fbff', palette.background || '#f4f7fc', '#fbfcff']} style={styles.container}>
            <View style={styles.settingsGlowTop} />
            <View style={styles.settingsGlowBottom} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                {renderHeader()}

                {roleSwitchMessage ? (
                    <Animated.View
                        style={[
                            styles.roleSwitchToast,
                            {
                                opacity: roleSwitchAnim,
                                transform: [{
                                    translateY: roleSwitchAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [-8, 0],
                                    }),
                                }],
                            },
                        ]}
                    >
                        <Text style={styles.roleSwitchToastText}>{roleSwitchMessage}</Text>
                    </Animated.View>
                ) : null}

                <View style={styles.sectionsContainer}>
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Account')}
                        {canSwitchRole && renderRow(
                            'Employer Mode',
                            isSwitchingRole ? 'Switching…' : (primaryRole === 'employer' ? 'On' : 'Off'),
                            false,
                            true,
                            primaryRole === 'employer',
                            handleRoleToggle,
                            false,
                            null,
                            isSwitchingRole
                        )}
                        {renderRow('Current Role', getAccountRoleLabel(primaryRole))}
                        {renderRow(
                            'HireCircle Plans',
                            subscriptionPlan === 'free' ? 'Free' : String(subscriptionPlan || 'free').toUpperCase(),
                            true,
                            false,
                            null,
                            null,
                            false,
                            () => navigation.navigate('Subscription')
                        )}
                        {renderRow('Change Password', null, true, false, null, null, !isAdmin, () => navigation.navigate('ForgotPassword'))}
                        {renderRow(
                            t('settings.language', 'Language'),
                            languagePref === 'hi'
                                ? t('settings.hindi', 'Hindi')
                                : t('settings.english', 'English'),
                            true,
                            false,
                            null,
                            null,
                            !isAdmin,
                            toggleLanguagePreference
                        )}
                        {isAdmin && renderRow('Admin Dashboard', null, true, false, null, null, true, () => navigation.navigate('AdminDashboard'))}
                    </View>

                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Privacy')}
                        {renderRow('Profile Visibility', 'Public')}
                        {renderRow('Blocked Contacts', '0')}
                        {renderRow('Delete Account', null, true, false, null, null, true, confirmDeleteAccount)}
                    </View>

                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Saved Posts')}
                        {renderRow('Saved Posts Count', String(savedPostsCount))}
                        {renderRow(
                            'Clear Saved Posts',
                            clearingSavedPosts ? 'Clearing…' : null,
                            false,
                            false,
                            null,
                            null,
                            true,
                            handleClearSavedPosts
                        )}
                    </View>

                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Notifications')}
                        {renderRow('New Job Matches', null, false, true, notifNewMatches, (v) => handleToggle('@notif_new_matches', setNotifNewMatches, v))}
                        {renderRow('Messages & Replies', null, false, true, notifMessages, (v) => handleToggle('@notif_messages', setNotifMessages, v))}
                        {renderRow('Job Alerts & Deadlines', null, false, true, notifJobAlerts, (v) => handleToggle('@notif_job_alerts', setNotifJobAlerts, v))}
                        {renderRow('App Updates', null, false, true, notifAppUpdates, (v) => handleToggle('@notif_app_updates', setNotifAppUpdates, v))}
                        {renderRow('Push Permission', readablePushPermission, true, false, null, null, false, handleRequestPushPermission)}
                        {renderRow('Send Test Notification', testingNotification ? 'Sending...' : null, true, false, null, null, true, handleTestNotification)}
                    </View>

                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Role & Preferences')}
                        {renderRow('Phone Number', accountPhoneNumber)}
                        {renderRow('Dark Mode (Beta)', null, false, true, mode === 'dark', () => toggleTheme())}
                        {upgradePrompt && renderRow(upgradePrompt.title || 'Suggested Upgrade', 'Contextual', false, false, null, null, true)}
                    </View>

                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Support')}
                        {renderRow('Referral Code', referralDashboard?.referralCode || 'Not available')}
                        {renderRow('Completed Referrals', String(referralDashboard?.completedReferrals || 0))}
                        {renderRow('Rewards Granted', String(referralDashboard?.rewardsGranted || 0))}
                        {renderRow('Send Product Feedback', null, true, false, null, null, true, () => setFeedbackModalVisible(true))}
                    </View>

                    <TouchableOpacity style={styles.signOutButton} activeOpacity={0.8} onPress={handleSignOut}>
                        <Text style={styles.signOutText}>Sign Out</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* Double Confirmation Modal via text input */}
            <Modal visible={isDeleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Are You Absolutely Sure?</Text>
                        <Text style={styles.modalSubtitle}>
                            Type <Text style={{ fontWeight: 'bold' }}>DELETE</Text> and enter your password to permanently delete your account.
                        </Text>

                        <TextInput
                            style={styles.deleteInput}
                            placeholder="Type DELETE"
                            placeholderTextColor="#94a3b8"
                            value={deleteInput}
                            onChangeText={setDeleteInput}
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                        <TextInput
                            style={styles.deleteInput}
                            placeholder="Current password"
                            placeholderTextColor="#94a3b8"
                            value={deletePassword}
                            onChangeText={setDeletePassword}
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                        />

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => { setDeleteModalVisible(false); setDeleteInput(''); setDeletePassword(''); }}
                                disabled={isDeleting}
                            >
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalDeleteBtn, (deleteInput !== 'DELETE' || !String(deletePassword || '').trim()) && styles.modalDeleteBtnDisabled]}
                                onPress={executeDeleteAccount}
                                disabled={deleteInput !== 'DELETE' || !String(deletePassword || '').trim() || isDeleting}
                            >
                                {isDeleting ? <SkeletonLoader width={18} height={18} borderRadius={9} tone="tint" /> : <Text style={styles.modalDeleteText}>Delete Forever</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <FeedbackModal
                visible={isFeedbackModalVisible}
                title="Feedback & Safety"
                subtitle="Report issues, suggest improvements, or share concerns."
                submitLabel="Submit"
                onClose={() => setFeedbackModalVisible(false)}
                onSubmit={handleSubmitFeedback}
            />
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    scrollContent: {
        paddingBottom: 40,
    },
    settingsGlowTop: {
        position: 'absolute',
        top: -120,
        right: -80,
        width: 240,
        height: 240,
        borderRadius: 120,
        backgroundColor: 'rgba(124, 58, 237, 0.14)',
    },
    settingsGlowBottom: {
        position: 'absolute',
        bottom: -140,
        left: -100,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: 'rgba(59, 130, 246, 0.10)',
    },
    roleSwitchToast: {
        marginHorizontal: SPACING.md,
        marginTop: SPACING.sm,
        marginBottom: SPACING.xs,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        paddingHorizontal: SPACING.smd,
        paddingVertical: SPACING.sm,
        ...SHADOWS.sm,
    },
    roleSwitchToastText: {
        color: '#1e40af',
        fontSize: 13,
        fontWeight: '700',
        textAlign: 'center',
    },
    headerWrap: {
        paddingHorizontal: SPACING.md,
        paddingBottom: SPACING.sm,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    topBarCopy: {
        flex: 1,
    },
    topBarEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c8798',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    topBarTitle: {
        marginTop: 2,
        fontSize: 28,
        fontWeight: '800',
        letterSpacing: -0.6,
        color: '#0f172a',
    },
    topBarAction: {
        ...SCREEN_CHROME.actionButton,
        ...SCREEN_CHROME.actionButtonPrimary,
    },
    profileHeader: {
        ...SCREEN_CHROME.heroSurface,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.lg,
        marginBottom: SPACING.md,
    },
    profileHeaderTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileHeaderCopy: {
        flex: 1,
        minWidth: 0,
    },
    avatar: {
        width: 72,
        height: 72,
        borderRadius: 36,
        marginRight: 16,
        borderWidth: 3,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    userName: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 2,
    },
    userRole: {
        color: '#64748b',
        fontSize: 14,
        fontWeight: '500',
    },
    profileRolePill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: 8,
    },
    profileRolePillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
    heroStatsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 18,
    },
    heroStatCard: {
        ...SCREEN_CHROME.metricTile,
        alignItems: 'flex-start',
        borderRadius: 18,
        paddingVertical: 14,
    },
    heroStatValue: {
        fontSize: 18,
        fontWeight: '800',
        color: '#111827',
    },
    heroStatLabel: {
        marginTop: 4,
        fontSize: 11,
        fontWeight: '700',
        color: '#7c8798',
        textTransform: 'uppercase',
        letterSpacing: 0.45,
    },
    heroActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
    },
    premiumBadge: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c7d2fe',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    premiumBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#4338ca',
        letterSpacing: 0.4,
    },
    neutralBadge: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    neutralBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#64748b',
        letterSpacing: 0.35,
        textTransform: 'uppercase',
    },
    sectionsContainer: {
        paddingHorizontal: SPACING.md,
        gap: 14,
    },
    sectionCard: {
        ...SCREEN_CHROME.contentCard,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#e7ecf4',
        overflow: 'hidden',
    },
    sectionHeaderBg: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#fbfcff',
        paddingHorizontal: SPACING.md,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    sectionHeaderIconWrap: {
        width: 30,
        height: 30,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#334155',
        textTransform: 'uppercase',
        letterSpacing: 0.55,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 15,
        paddingHorizontal: SPACING.md,
    },
    rowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    rowLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
        flex: 1,
        paddingRight: 12,
    },
    rowRight: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        gap: 6,
    },
    rowValuePill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    rowValue: {
        fontSize: 12,
        color: '#64748b',
        fontWeight: '700',
    },
    arrowIcon: {
        fontSize: 20,
        color: '#94a3b8',
        lineHeight: 20,
    },
    signOutButton: {
        backgroundColor: '#fff5f5',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#fee2e2',
        paddingVertical: 15,
        alignItems: 'center',
        marginTop: 6,
        marginBottom: 24,
        ...SHADOWS.sm,
    },
    signOutText: {
        color: '#dc2626',
        fontWeight: '800',
        fontSize: 15,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalContent: {
        backgroundColor: '#ffffff',
        borderRadius: RADIUS.lg,
        padding: SPACING.lg,
        width: '100%',
        maxWidth: 400,
        ...SHADOWS.lg,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0f172a',
        marginBottom: 12,
        textAlign: 'center',
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    deleteInput: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: RADIUS.sm,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        color: '#0f172a',
        marginBottom: 24,
        textAlign: 'center',
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
    },
    modalCancelBtn: {
        flex: 1,
        backgroundColor: '#f1f5f9',
        paddingVertical: 14,
        borderRadius: RADIUS.sm,
        alignItems: 'center',
    },
    modalCancelText: {
        color: '#475569',
        fontWeight: 'bold',
        fontSize: 15,
    },
    modalDeleteBtn: {
        flex: 1,
        backgroundColor: '#ef4444',
        paddingVertical: 14,
        borderRadius: RADIUS.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalDeleteBtnDisabled: {
        opacity: 0.4,
    },
    modalDeleteText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 15,
    }
});
