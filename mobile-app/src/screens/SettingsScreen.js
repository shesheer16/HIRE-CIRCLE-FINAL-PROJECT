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
import FeedbackModal from '../components/FeedbackModal';
import SkeletonLoader from '../components/SkeletonLoader';
import { useTheme } from '../theme/ThemeProvider';
import { PALETTE, RADIUS, SCREEN_CHROME, SHADOWS, SPACING } from '../theme/theme';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import Constants from 'expo-constants';
import { getAccountRoleLabel } from '../utils/profileReadiness';

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
    const appRole = useAppStore(state => state.role);
    const setRole = useAppStore(state => state.setRole);
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
            if (languageEntry?.[1]) {
                setLanguagePref(languageEntry[1]);
            }
        }).catch((error) => {
            logger.warn('Failed to load notification/language preferences', error?.message || error);
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
        if (String(deleteInput || '').trim().toUpperCase() !== 'DELETE' || !String(deletePassword || '').trim()) return;
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
            const errorMessage = error?.response?.data?.message || 'Could not delete your account. Please try again or contact support.';
            Alert.alert('Error', errorMessage);
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
        <View style={styles.headerWrapPremium}>
            <View style={[styles.topBarPremium, { paddingTop: insets.top + 16 }]}>
                <Text style={styles.topBarTitlePremium}>Settings</Text>
                <TouchableOpacity
                    style={styles.topBarActionPremium}
                    activeOpacity={0.7}
                    onPress={() => setFeedbackModalVisible(true)}
                >
                    <Ionicons name="chatbubble-ellipses-outline" size={22} color="#0f172a" />
                </TouchableOpacity>
            </View>

            <LinearGradient
                colors={['rgba(255,255,255,0.98)', '#f7f4ff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.profileHeaderCardPremium}
            >
                <View style={styles.profileHeaderTopPremium}>
                    <Image
                        source={{
                            uri: profileHeader.avatar ||
                                `https://ui-avatars.com/api/?name=${encodeURIComponent(profileHeader.name || 'User')}&background=f1f5f9&color=0f172a`
                        }}
                        style={styles.avatarPremium}
                    />
                    <View style={styles.profileHeaderCopyPremium}>
                        <View style={styles.heroBadgeRowPremium}>
                            <View style={styles.profileRolePillPremium}>
                                <Ionicons name="shield-checkmark-outline" size={11} color="#6d28d9" />
                                <Text style={styles.profileRolePillTextPremium}>{profileHeader.role}</Text>
                            </View>
                            {subscriptionPlan !== 'free' ? (
                                <View style={styles.statusBadgePremium}>
                                    <Text style={styles.statusBadgeTextPremium}>Premium</Text>
                                </View>
                            ) : null}
                            {canSwitchRole ? (
                                <View style={styles.statusBadgeMutedPremium}>
                                    <Text style={styles.statusBadgeMutedTextPremium}>Dual mode</Text>
                                </View>
                            ) : null}
                        </View>
                        <Text style={styles.userNamePremium}>{profileHeader.name}</Text>
                        <Text style={styles.userRolePremium} numberOfLines={1}>
                            {profileHeader.email || 'Your account details'}
                        </Text>
                    </View>
                </View>

                <View style={styles.heroStatsPillRowPremium}>
                    {heroStats.map((stat, i) => (
                        <View key={stat.label} style={[styles.heroStatBlockPremium, i !== heroStats.length - 1 && styles.heroStatBorderRightPremium]}>
                            <Text style={styles.heroStatValuePremium}>{stat.value}</Text>
                            <Text style={styles.heroStatLabelPremium}>{stat.label}</Text>
                        </View>
                    ))}
                </View>
            </LinearGradient>
        </View>
    );

    const renderSectionTextHeader = (title) => {
        return (
            <View style={styles.sectionHeaderBgPremium}>
                <Text style={styles.sectionTitlePremium}>{title}</Text>
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
        switchDisabled = false,
        sectionTitle = 'Account'
    ) => {
        const meta = SETTINGS_SECTION_META[sectionTitle] || SETTINGS_SECTION_META['Account'];

        return (
            <TouchableOpacity
                style={[styles.rowPremium, !isLast && styles.rowBorderPremium]}
                activeOpacity={0.65}
                disabled={isSwitch || (!hasArrow && !value && !onRowPress)}
                onPress={onRowPress}
            >
                <View style={styles.rowLeftPremium}>
                    <View style={[styles.rowIconSquirclePremium, { backgroundColor: meta.tint }]}>
                        <Ionicons name={meta.icon} size={18} color={meta.iconColor} />
                    </View>
                    <Text style={styles.rowLabelPremium}>{label}</Text>
                </View>
                <View style={styles.rowRightPremium}>
                    {value ? (
                        <Text style={styles.rowValuePremium} numberOfLines={1}>{value}</Text>
                    ) : null}
                    {isSwitch && (
                        <Switch
                            value={switchValue}
                            onValueChange={onSwitchChange}
                            disabled={switchDisabled}
                            trackColor={{ false: '#e2e8f0', true: '#6d28d9' }}
                            thumbColor={'#ffffff'}
                            style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
                        />
                    )}
                    {hasArrow && <Ionicons name="chevron-forward" size={18} color="#94a3b8" marginLeft={4} />}
                </View>
            </TouchableOpacity>
        );
    };

    const canSwitchRole = String(userInfo?.accountMode || '').toLowerCase() === 'hybrid';

    return (
        <View style={styles.containerPremium}>
            {/* Ambient Background Glow */}
            <LinearGradient colors={['rgba(241,245,249,1)', 'rgba(248,250,252,1)']} style={StyleSheet.absoluteFillObject} />
            <View style={styles.screenGlowTop} />
            
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContentPremium, { paddingBottom: insets.bottom + 132 }]}
            >
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

                <View style={styles.sectionsContainerPremium}>
                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Account')}
                        <View style={styles.sectionCardInnerPremium}>
                            {canSwitchRole && renderRow('Employer Mode', isSwitchingRole ? 'Switching…' : (primaryRole === 'employer' ? 'On' : 'Off'), false, true, primaryRole === 'employer', handleRoleToggle, false, null, isSwitchingRole, 'Account')}
                            {renderRow('Current Role', getAccountRoleLabel(primaryRole), false, false, null, null, false, null, false, 'Account')}
                            {renderRow('HireCircle Plans', subscriptionPlan === 'free' ? 'Free' : String(subscriptionPlan || 'free').toUpperCase(), true, false, null, null, false, () => navigation.navigate('Subscription'), false, 'Account')}
                            {renderRow('Change Password', null, true, false, null, null, !isAdmin, () => navigation.navigate('ForgotPassword'), false, 'Account')}
                            {renderRow(t('settings.language', 'Language'), languagePref === 'hi' ? t('settings.hindi', 'Hindi') : t('settings.english', 'English'), true, false, null, null, !isAdmin, toggleLanguagePreference, false, 'Account')}
                            {isAdmin && renderRow('Admin Dashboard', null, true, false, null, null, true, () => navigation.navigate('AdminDashboard'), false, 'Account')}
                        </View>
                    </View>

                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Privacy')}
                        <View style={styles.sectionCardInnerPremium}>
                            {renderRow('Profile Visibility', 'Public', false, false, null, null, false, null, false, 'Privacy')}
                            {renderRow('Blocked Contacts', '0', false, false, null, null, false, null, false, 'Privacy')}
                            {renderRow('Delete Account', null, true, false, null, null, true, confirmDeleteAccount, false, 'Privacy')}
                        </View>
                    </View>

                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Saved Posts')}
                        <View style={styles.sectionCardInnerPremium}>
                            {renderRow('Saved Posts Count', String(savedPostsCount), false, false, null, null, false, null, false, 'Saved Posts')}
                            {renderRow('Clear Saved Posts', clearingSavedPosts ? 'Clearing…' : null, false, false, null, null, true, handleClearSavedPosts, false, 'Saved Posts')}
                        </View>
                    </View>

                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Notifications')}
                        <View style={styles.sectionCardInnerPremium}>
                            {renderRow('New Job Matches', null, false, true, notifNewMatches, (v) => handleToggle('@notif_new_matches', setNotifNewMatches, v), false, null, false, 'Notifications')}
                            {renderRow('Messages & Replies', null, false, true, notifMessages, (v) => handleToggle('@notif_messages', setNotifMessages, v), false, null, false, 'Notifications')}
                            {renderRow('Job Alerts & Deadlines', null, false, true, notifJobAlerts, (v) => handleToggle('@notif_job_alerts', setNotifJobAlerts, v), false, null, false, 'Notifications')}
                            {renderRow('App Updates', null, false, true, notifAppUpdates, (v) => handleToggle('@notif_app_updates', setNotifAppUpdates, v), false, null, false, 'Notifications')}
                            {renderRow('Push Permission', readablePushPermission, true, false, null, null, false, handleRequestPushPermission, false, 'Notifications')}
                            {renderRow('Send Test Notification', testingNotification ? 'Sending...' : null, true, false, null, null, true, handleTestNotification, false, 'Notifications')}
                        </View>
                    </View>

                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Role & Preferences')}
                        <View style={styles.sectionCardInnerPremium}>
                            {renderRow('Phone Number', accountPhoneNumber, false, false, null, null, false, null, false, 'Role & Preferences')}
                            {renderRow('Dark Mode (Beta)', null, false, true, mode === 'dark', () => toggleTheme(), upgradePrompt ? false : true, null, false, 'Role & Preferences')}
                            {upgradePrompt && renderRow(upgradePrompt.title || 'Suggested Upgrade', 'Contextual', false, false, null, null, true, null, false, 'Role & Preferences')}
                        </View>
                    </View>

                    <View style={styles.sectionCardPremium}>
                        {renderSectionTextHeader('Support')}
                        <View style={styles.sectionCardInnerPremium}>
                            {renderRow('Referral Code', referralDashboard?.referralCode || 'Not available', false, false, null, null, false, null, false, 'Support')}
                            {renderRow('Completed Referrals', String(referralDashboard?.completedReferrals || 0), false, false, null, null, false, null, false, 'Support')}
                            {renderRow('Rewards Granted', String(referralDashboard?.rewardsGranted || 0), false, false, null, null, false, null, false, 'Support')}
                            {renderRow('Send Product Feedback', null, true, false, null, null, true, () => setFeedbackModalVisible(true), false, 'Support')}
                            {__DEV__ && renderRow('Crash for Sentry', 'Test unhandled error', true, false, null, null, true, () => { throw new Error('Sentry Production Readiness Test'); }, false, 'Support')}
                        </View>
                    </View>

                    <TouchableOpacity style={styles.signOutButtonPremium} activeOpacity={0.88} onPress={handleSignOut}>
                        <Ionicons name="log-out-outline" size={20} color="#ef4444" />
                        <Text style={styles.signOutTextPremium}>Sign Out</Text>
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
                                style={[styles.modalDeleteBtn, (String(deleteInput || '').trim().toUpperCase() !== 'DELETE' || !String(deletePassword || '').trim()) && styles.modalDeleteBtnDisabled]}
                                onPress={executeDeleteAccount}
                                disabled={String(deleteInput || '').trim().toUpperCase() !== 'DELETE' || !String(deletePassword || '').trim() || isDeleting}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.surface,
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
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    roleSwitchToastText: {
        color: '#1e40af',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
    },
    containerPremium: {
        flex: 1,
        backgroundColor: '#f1f5f9',
    },
    screenGlowTop: {
        position: 'absolute',
        top: -100,
        right: -80,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: 'rgba(124, 58, 237, 0.08)',
    },
    scrollContentPremium: {
        paddingBottom: 40,
    },
    headerWrapPremium: {
        backgroundColor: 'transparent',
    },
    topBarPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 16,
    },
    topBarTitlePremium: {
        fontSize: 32,
        fontWeight: '800',
        letterSpacing: -0.7,
        color: PALETTE.accent,
    },
    topBarActionPremium: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.sm,
    },
    profileHeaderCardPremium: {
        marginHorizontal: 16,
        marginTop: 4,
        paddingVertical: 22,
        paddingHorizontal: 20,
        borderRadius: 24,
        ...SHADOWS.md,
    },
    profileHeaderTopPremium: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    profileHeaderCopyPremium: {
        flex: 1,
        marginLeft: 16,
    },
    avatarPremium: {
        width: 82,
        height: 82,
        borderRadius: 41,
        backgroundColor: '#f8fafc',
    },
    heroBadgeRowPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 10,
        gap: 8,
    },
    profileRolePillPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#ede9fe',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 5,
    },
    profileRolePillTextPremium: {
        color: '#6d28d9',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.55,
    },
    statusBadgePremium: {
        backgroundColor: '#dcfce7',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    statusBadgeTextPremium: {
        color: '#15803d',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.55,
    },
    statusBadgeMutedPremium: {
        backgroundColor: '#eef2ff',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    statusBadgeMutedTextPremium: {
        color: '#4f46e5',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.55,
    },
    userNamePremium: {
        fontSize: 22,
        fontWeight: '700',
        color: '#0f172a',
        letterSpacing: -0.4,
        marginBottom: 2,
    },
    userRolePremium: {
        color: '#64748b',
        fontSize: 15,
        fontWeight: '500',
    },
    heroStatsPillRowPremium: {
        flexDirection: 'row',
        marginTop: 20,
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        paddingVertical: 12,
        width: '100%',
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    heroStatBlockPremium: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroStatBorderRightPremium: {
        borderRightWidth: 1,
        borderRightColor: '#e2e8f0',
    },
    heroStatValuePremium: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
    },
    heroStatLabelPremium: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: '600',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.55,
    },
    sectionsContainerPremium: {
        paddingTop: 24,
        paddingHorizontal: 16,
    },
    sectionCardPremium: {
        marginBottom: 20,
    },
    sectionHeaderBgPremium: {
        paddingHorizontal: 12,
        paddingBottom: 10,
    },
    sectionTitlePremium: {
        fontSize: 13,
        fontWeight: '700',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    sectionCardInnerPremium: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    rowPremium: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
    },
    rowBorderPremium: {
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    rowLeftPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    rowIconSquirclePremium: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    rowLabelPremium: {
        fontSize: 16,
        fontWeight: '500',
        color: '#1e293b',
        flexShrink: 1,
    },
    rowRightPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
        maxWidth: '46%',
        paddingLeft: 12,
        justifyContent: 'flex-end',
    },
    rowValuePremium: {
        fontSize: 15,
        color: '#64748b',
        fontWeight: '500',
        maxWidth: 160,
        textAlign: 'right',
    },
    signOutButtonPremium: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fef2f2',
        paddingVertical: 16,
        borderRadius: 16,
        gap: 8,
        marginTop: 12,
        marginBottom: 32,
        borderWidth: 1,
        borderColor: '#fee2e2',
    },
    signOutTextPremium: {
        color: '#ef4444',
        fontWeight: '700',
        fontSize: 16,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: PALETTE.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalContent: {
        backgroundColor: PALETTE.surface,
        borderRadius: 14,
        padding: 20,
        width: '100%',
        maxWidth: 400,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: PALETTE.textPrimary,
        marginBottom: 12,
        textAlign: 'center',
    },
    modalSubtitle: {
        fontSize: 14,
        color: PALETTE.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    deleteInput: {
        backgroundColor: PALETTE.background,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.separator,
        borderRadius: 10,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        color: PALETTE.textPrimary,
        marginBottom: 20,
        textAlign: 'center',
    },
    modalActions: {
        flexDirection: 'row',
        gap: 10,
    },
    modalCancelBtn: {
        flex: 1,
        backgroundColor: PALETTE.background,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    modalCancelText: {
        color: PALETTE.textPrimary,
        fontWeight: '600',
        fontSize: 15,
    },
    modalDeleteBtn: {
        flex: 1,
        backgroundColor: PALETTE.error,
        paddingVertical: 14,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalDeleteBtnDisabled: {
        opacity: 0.4,
    },
    modalDeleteText: {
        color: PALETTE.textInverted,
        fontWeight: '600',
        fontSize: 15,
    },
});
