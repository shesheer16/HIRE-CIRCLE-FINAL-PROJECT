import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Switch, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { logger } from '../utils/logger';
import { getLegacyRoleForPrimaryRole, getModeCopy, getPrimaryRoleFromUser } from '../utils/roleMode';

export default function SettingsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { logout, userInfo, updateUserInfo } = React.useContext(AuthContext);

    const [notificationsOn, setNotificationsOn] = useState(true);
    const [darkModeOn, setDarkModeOn] = useState(false);
    const [dataSaverOn, setDataSaverOn] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    // Notification preferences
    const [notifNewMatches, setNotifNewMatches] = useState(true);
    const [notifMessages, setNotifMessages] = useState(true);
    const [notifJobAlerts, setNotifJobAlerts] = useState(true);
    const [notifAppUpdates, setNotifAppUpdates] = useState(false);

    // Delete Account State
    const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSwitchingMode, setIsSwitchingMode] = useState(false);
    const [profileHeader, setProfileHeader] = useState({
        name: 'User',
        role: 'candidate',
        email: '',
        avatar: null,
    });
    const [primaryRole, setPrimaryRole] = useState(getPrimaryRoleFromUser(userInfo));

    useEffect(() => {
        const loadUserHeader = async () => {
            let user = userInfo || {};
            if (!userInfo) {
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                if (userInfoStr) {
                    user = JSON.parse(userInfoStr);
                }
            }

            const resolvedPrimaryRole = getPrimaryRoleFromUser(user);
            setPrimaryRole(resolvedPrimaryRole);

            setIsAdmin(String(user.role || '').toLowerCase() === 'admin');

            try {
                const { data } = await client.get('/api/users/profile');
                const profile = data?.profile || {};
                const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
                setProfileHeader({
                    name: fullName || user.name || 'User',
                    role: resolvedPrimaryRole === 'employer' ? 'I Need Someone (Demand)' : 'Helping Others (Supply)',
                    email: user.email || '',
                    avatar: profile.avatar || profile.logoUrl || null,
                });
            } catch (e) {
                setProfileHeader({
                    name: user.name || 'User',
                    role: resolvedPrimaryRole === 'employer' ? 'I Need Someone (Demand)' : 'Helping Others (Supply)',
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
            '@notif_app_updates'
        ]).then(pairs => {
            const vals = Object.fromEntries(pairs.map(([k, v]) => [k, v === 'true']));
            setNotifNewMatches(vals['@notif_new_matches'] ?? true);
            setNotifMessages(vals['@notif_messages'] ?? true);
            setNotifJobAlerts(vals['@notif_job_alerts'] ?? true);
            setNotifAppUpdates(vals['@notif_app_updates'] ?? false);
        });
    }, [userInfo]);

    const handleToggle = async (key, setter, value) => {
        setter(value);
        await AsyncStorage.setItem(key, String(value));
    };

    const handleSwitchMode = async () => {
        if (isSwitchingMode) return;
        const nextPrimaryRole = primaryRole === 'employer' ? 'worker' : 'employer';
        const modeCopy = getModeCopy(primaryRole);

        setIsSwitchingMode(true);
        try {
            await client.put('/api/users/profile', { primaryRole: nextPrimaryRole });
            await SecureStore.setItemAsync('selectedRole', getLegacyRoleForPrimaryRole(nextPrimaryRole));
            await updateUserInfo({ primaryRole: nextPrimaryRole });
            setPrimaryRole(nextPrimaryRole);
            setProfileHeader((prev) => ({
                ...prev,
                role: nextPrimaryRole === 'employer' ? 'I Need Someone (Demand)' : 'Helping Others (Supply)',
            }));
            Alert.alert('Mode Switched', modeCopy.switchedMessage);
        } catch (error) {
            logger.error('Switch mode error:', error);
            Alert.alert('Switch Failed', 'Could not switch mode. Please try again.');
        } finally {
            setIsSwitchingMode(false);
        }
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
        if (deleteInput !== 'DELETE') return;
        setIsDeleting(true);
        try {
            await client.delete('/api/users/delete');
            setDeleteModalVisible(false);
            setDeleteInput('');
            await performLocalSignOut();
        } catch (error) {
            logger.error('Delete account error:', error);
            Alert.alert('Error', 'Could not delete your account. Please try again or contact support.');
        } finally {
            setIsDeleting(false);
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
        <View style={styles.container}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                {renderHeader()}

                <View style={styles.sectionsContainer}>
                    {/* Account Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Account')}
                        {renderRow('Current Mode', getModeCopy(primaryRole).modeLabel)}
                        {renderRow(
                            getModeCopy(primaryRole).switchLabel,
                            isSwitchingMode ? 'Switching...' : null,
                            !isSwitchingMode,
                            false,
                            null,
                            null,
                            false,
                            handleSwitchMode
                        )}
                        {renderRow('Phone Number', '+91 98765 43210')}
                        {renderRow('Change Password', null, true, false, null, null, false, () => navigation.navigate('ForgotPassword'))}
                        {renderRow('Go Pro', 'Upgrade', true, false, null, null, false, () => navigation.navigate('Subscription'))}
                        {renderRow('Language', 'English (India)', false, false, null, null, !isAdmin)}
                        {isAdmin && renderRow('Admin Dashboard', null, true, false, null, null, true, () => navigation.navigate('AdminDashboard'))}
                    </View>

                    {/* Notification Preferences Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Notifications')}
                        {renderRow('New Job Matches', null, false, true, notifNewMatches, (v) => handleToggle('@notif_new_matches', setNotifNewMatches, v))}
                        {renderRow('Messages & Replies', null, false, true, notifMessages, (v) => handleToggle('@notif_messages', setNotifMessages, v))}
                        {renderRow('Job Alerts & Deadlines', null, false, true, notifJobAlerts, (v) => handleToggle('@notif_job_alerts', setNotifJobAlerts, v))}
                        {renderRow('App Updates', null, false, true, notifAppUpdates, (v) => handleToggle('@notif_app_updates', setNotifAppUpdates, v), true)}
                    </View>

                    {/* Preferences Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Preferences')}
                        {renderRow('Dark Mode', null, false, true, darkModeOn, setDarkModeOn)}
                        {renderRow('Data Saver', null, false, true, dataSaverOn, setDataSaverOn, true)}
                    </View>

                    {/* Privacy & Security Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Privacy & Security')}
                        {renderRow('Profile Visibility', 'Public')}
                        {renderRow('Blocked Contacts', '0', false, false, null, null, true)}
                    </View>

                    {/* About Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('About')}
                        {renderRow('Version', '1.0.0 (MVP)')}
                        {renderRow('Terms of Service', null, true)}
                        {renderRow('Privacy Policy', null, true, false, null, null, true)}
                    </View>

                    {/* Sign Out Button */}
                    <TouchableOpacity style={styles.signOutButton} activeOpacity={0.8} onPress={handleSignOut}>
                        <Text style={styles.signOutText}>Sign Out</Text>
                    </TouchableOpacity>

                    {/* Delete Account Button */}
                    <View style={styles.deleteAccountContainer}>
                        <View style={styles.divider} />
                        <TouchableOpacity style={styles.deleteButton} activeOpacity={0.8} onPress={confirmDeleteAccount}>
                            <Text style={styles.deleteText}>Delete Account</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>

            {/* Double Confirmation Modal via text input */}
            <Modal visible={isDeleteModalVisible} transparent animationType="fade" onRequestClose={() => setDeleteModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Are You Absolutely Sure?</Text>
                        <Text style={styles.modalSubtitle}>
                            Type <Text style={{ fontWeight: 'bold' }}>DELETE</Text> to confirm you want to permanently delete your account.
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

                        <View style={styles.modalActions}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => { setDeleteModalVisible(false); setDeleteInput(''); }}
                                disabled={isDeleting}
                            >
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.modalDeleteBtn, deleteInput !== 'DELETE' && styles.modalDeleteBtnDisabled]}
                                onPress={executeDeleteAccount}
                                disabled={deleteInput !== 'DELETE' || isDeleting}
                            >
                                {isDeleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalDeleteText}>Delete Forever</Text>}
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
    scrollContent: {
        paddingBottom: 40,
    },
    profileHeader: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 24,
        paddingBottom: 24,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
        elevation: 2,
        marginBottom: 16,
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
    sectionsContainer: {
        paddingHorizontal: 16,
        gap: 16,
    },
    sectionCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.02,
        shadowRadius: 2,
        elevation: 1,
    },
    sectionHeaderBg: {
        backgroundColor: '#f8fafc',
        paddingHorizontal: 16,
        paddingVertical: 12,
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
        paddingVertical: 16,
        paddingHorizontal: 16,
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
        borderRadius: 12,
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
    deleteAccountContainer: {
        marginTop: 16,
        paddingBottom: 24,
    },
    divider: {
        height: 1,
        backgroundColor: '#e2e8f0', // slate-200
        marginBottom: 24,
    },
    deleteButton: {
        alignItems: 'center',
    },
    deleteText: {
        color: '#ef4444', // theme.error
        fontSize: 13,
        fontWeight: '500',
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
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 4,
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
        borderRadius: 8,
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
        borderRadius: 8,
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
        borderRadius: 8,
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
