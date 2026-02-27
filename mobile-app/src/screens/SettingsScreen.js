import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { AuthContext } from '../context/AuthContext';

export default function SettingsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { logout } = React.useContext(AuthContext);

    const [notificationsOn, setNotificationsOn] = useState(true);
    const [darkModeOn, setDarkModeOn] = useState(false);
    const [dataSaverOn, setDataSaverOn] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    React.useEffect(() => {
        const checkAdmin = async () => {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            if (userInfoStr) {
                const user = JSON.parse(userInfoStr);
                setIsAdmin(user.isAdmin === true);
            }
        };
        checkAdmin();
    }, []);

    const handleSignOut = () => {
        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign Out', style: 'destructive', onPress: async () => {
                        try {
                            await SecureStore.deleteItemAsync('selectedRole');
                            await logout();
                        } catch (error) {
                            console.error('Sign out error:', error);
                        }
                    }
                }
            ]
        );
    };

    const renderHeader = () => (
        <View style={[styles.profileHeader, { paddingTop: insets.top + 16 }]}>
            <Image
                source={{ uri: 'https://i.pravatar.cc/150?img=11' }}
                style={styles.avatar}
            />
            <View>
                <Text style={styles.userName}>Lokesh G</Text>
                <Text style={styles.userRole}>Senior Software Engineer</Text>
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
                        {renderRow('Phone Number', '+91 98765 43210')}
                        {renderRow('Language', 'English (India)', false, false, null, null, !isAdmin)}
                        {isAdmin && renderRow('Admin Dashboard', null, true, false, null, null, true, () => navigation.navigate('AdminDashboard'))}
                    </View>

                    {/* Preferences Section */}
                    <View style={styles.sectionCard}>
                        {renderSectionTextHeader('Preferences')}
                        {renderRow('Notifications', null, false, true, notificationsOn, setNotificationsOn)}
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
                </View>
            </ScrollView>
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
    }
});
