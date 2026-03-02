import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { logger } from '../utils/logger';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { useAppStore } from '../store/AppStore';
import FeedbackModal from '../components/FeedbackModal';
import SkeletonLoader from '../components/SkeletonLoader';
import { useTheme } from '../theme/ThemeProvider';
import { RADIUS, SHADOWS, SPACING } from '../theme/theme';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

export default function SettingsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { logout, userInfo, updateUserInfo } = React.useContext(AuthContext);
    const { role: appRole, setRole } = useAppStore();
    const { mode, toggleTheme, palette } = useTheme();
    const { t } = useTranslation();

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
                const { data } = await client.get('/api/users/profile');
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
                    role: resolvedPrimaryRole === 'employer' ? 'Recruiter' : 'Candidate',
                    email: user.email || '',
                    avatar: profile.avatar || profile.logoUrl || null,
                });

                const growthRes = await client.get('/api/growth/monetization-intelligence').catch(() => null);
                setUpgradePrompt(growthRes?.data?.intelligence?.upgradePrompt || null);
            } catch (e) {
                setAccountPhoneNumber(String(user?.phoneNumber || 'Not set'));
                setProfileHeader({
                    name: user.name || 'User',
                    role: resolvedPrimaryRole === 'employer' ? 'Recruiter' : 'Candidate',
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
            i18n.changeLanguage(safeLanguage).catch(() => {});
        });

        const loadNotificationPermission = async () => {
            try {
                const Notifications = await import('expo-notifications');
                const status = await Notifications.getPermissionsAsync();
                setPushPermissionStatus(String(status?.status || 'unknown'));
            } catch (error) {
                setPushPermissionStatus('unknown');
            }
        };
        loadNotificationPermission();
    }, [userInfo, appRole]);

    const handleToggle = async (key, setter, value) => {
        setter(value);
        await AsyncStorage.setItem(key, String(value));
    };

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
        await i18n.changeLanguage(nextLanguage).catch(() => {});
    };

    const performLocalSignOut = async () => {
        try {
            await SecureStore.deleteItemAsync('selectedRole');
            await logout();
            navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
            });
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

    const handleRoleToggle = async () => {
        if (isSwitchingRole) return;
        const previousRole = primaryRole === 'employer' ? 'employer' : 'worker';
        const nextRole = previousRole === 'employer' ? 'worker' : 'employer';

        setIsSwitchingRole(true);
        setPrimaryRole(nextRole);
        setProfileHeader((prev) => ({
            ...prev,
            role: nextRole === 'employer' ? 'Recruiter' : 'Candidate',
        }));

        try {
            const { data } = await client.put('/api/settings', {
                accountInfo: {
                    role: nextRole,
                },
            });

            const roleContract = data?.settings?.roleContract || {};
            const resolvedRole = String(roleContract.activeRole || nextRole).toLowerCase() === 'employer'
                ? 'employer'
                : 'worker';

            setPrimaryRole(resolvedRole);
            setRole(resolvedRole);
            await updateUserInfo({
                role: resolvedRole === 'employer' ? 'recruiter' : 'candidate',
                activeRole: resolvedRole,
                primaryRole: resolvedRole,
                roles: Array.isArray(roleContract.roles) && roleContract.roles.length > 0
                    ? roleContract.roles
                    : ['worker', 'employer'],
                capabilities: roleContract.capabilities || undefined,
                hasSelectedRole: true,
            });
            animateRoleSwitchToast(
                resolvedRole === 'employer'
                    ? 'Recruiter mode enabled'
                    : 'Candidate mode enabled'
            );
        } catch (error) {
            setPrimaryRole(previousRole);
            setProfileHeader((prev) => ({
                ...prev,
                role: previousRole === 'employer' ? 'Recruiter' : 'Candidate',
            }));
            Alert.alert('Role switch failed', error?.response?.data?.message || 'Unable to switch role right now.');
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
        : (pushPermissionStatus === 'denied' ? 'Denied' : 'Not set');

    const handleRequestPushPermission = async () => {
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

    const renderHeader = () => (
        <View style={[styles.profileHeader, { paddingTop: insets.top + 16 }]}>
            <Image
                source={{
                    uri: profileHeader.avatar ||
                        `https://ui-avatars.com/api/?name=${encodeURIComponent(profileHeader.name || 'User')}&background=7c3aed&color=fff`
                }}
                style={styles.avatar}
            />
            <View>
                <Text style={styles.userName}>{profileHeader.name}</Text>
                <Text style={styles.userRole}>{profileHeader.role}{profileHeader.email ? ` • ${profileHeader.email}` : ''}</Text>
                {subscriptionPlan !== 'free' ? (
                    <View style={styles.premiumBadge}>
                        <Text style={styles.premiumBadgeText}>PREMIUM</Text>
                    </View>
                ) : null}
            </View>
        </View>
    );

    const renderSectionTextHeader = (title) => (
        <View style={styles.sectionHeaderBg}>
            <Text style={styles.sectionTitle}>{title}</Text>
        </View>
    );

    const renderRow = (label, value = null, hasArrow = false, isSwitch = false, switchValue, onSwitchChange, isLast = false, onRowPress = null) => (
        <TouchableOpacity
            style={[styles.row, !isLast && styles.rowBorder]}
            activeOpacity={0.7}
            disabled={isSwitch || (!hasArrow && !value && !onRowPress)}
            onPress={onRowPress}
        >
            <Text style={styles.rowLabel}>{label}</Text>
            <View style={styles.rowRight}>
                {value && <Text style={styles.rowValue}>{value}</Text>}
                {isSwitch && (
                    <Switch
                        value={switchValue}
                        onValueChange={onSwitchChange}
                        trackColor={{ false: '#e2e8f0', true: '#10b981' }}
                        thumbColor="#ffffff"
                        style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
                    />
                )}
                {hasArrow && <Text style={styles.arrowIcon}>›</Text>}
            </View>
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
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
                        {renderRow(
                            'Recruiter Mode',
                            isSwitchingRole ? 'Switching…' : (primaryRole === 'employer' ? 'On' : 'Off'),
                            false,
                            true,
                            primaryRole === 'employer',
                            handleRoleToggle
                        )}
                        {renderRow('Current Role', primaryRole === 'employer' ? 'Recruiter' : 'Candidate')}
                        {renderRow('Go Pro', 'Upgrade', true, false, null, null, false, () => navigation.navigate('Subscription'))}
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    roleSwitchToast: {
        marginHorizontal: SPACING.md,
        marginTop: SPACING.sm,
        marginBottom: SPACING.xs,
        borderRadius: RADIUS.md,
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
    profileHeader: {
        backgroundColor: '#ffffff',
        paddingHorizontal: SPACING.lg,
        paddingBottom: SPACING.lg,
        flexDirection: 'row',
        alignItems: 'center',
        ...SHADOWS.md,
        marginBottom: SPACING.md,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        marginRight: 16,
    },
    userName: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#0f172a',
        marginBottom: 2,
    },
    userRole: {
        color: '#64748b',
        fontSize: 14,
        fontWeight: '500',
    },
    premiumBadge: {
        marginTop: 6,
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c7d2fe',
        backgroundColor: '#eef2ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    premiumBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#4338ca',
        letterSpacing: 0.4,
    },
    sectionsContainer: {
        paddingHorizontal: SPACING.md,
        gap: SPACING.md,
    },
    sectionCard: {
        backgroundColor: '#ffffff',
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    sectionHeaderBg: {
        backgroundColor: '#f8fafc',
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.smd,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.md,
    },
    rowBorder: {
        borderBottomWidth: 1,
        borderBottomColor: '#f8fafc',
    },
    rowLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    rowRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rowValue: {
        fontSize: 14,
        color: '#94a3b8',
    },
    arrowIcon: {
        fontSize: 20,
        color: '#94a3b8',
        marginLeft: 8,
        lineHeight: 20,
    },
    signOutButton: {
        backgroundColor: '#fef2f2',
        borderRadius: RADIUS.md,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 24,
    },
    signOutText: {
        color: '#dc2626',
        fontWeight: 'bold',
        fontSize: 16,
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
