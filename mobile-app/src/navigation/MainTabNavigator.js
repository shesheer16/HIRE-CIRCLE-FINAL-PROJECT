import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { triggerHaptic } from '../utils/haptics';

// Custom Icons
import {
    IconGlobe,
    IconUsers,
    IconMessageSquare,
    IconBriefcase,
    IconSettings,
    IconVideo
} from '../components/Icons';

// Screens
import ConnectScreen from '../screens/ConnectScreen';
import ProfilesScreen from '../screens/ProfilesScreen';
import ApplicationsScreen from '../screens/ApplicationsScreen';
import JobsScreen from '../screens/JobsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import EmployerDashboardScreen from '../screens/EmployerDashboardScreen';
import TalentScreen from '../screens/TalentScreen';
import NotificationsScreen from '../screens/NotificationsScreen'; // NEW: Notifications
import { Ionicons } from '@expo/vector-icons'; // Used for Bell Icon
import ErrorBoundary from '../components/ErrorBoundary';

const Tab = createBottomTabNavigator();

export default function MainTabNavigator({ navigation }) {
    const [userRole, setUserRole] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchRole = async () => {
            try {
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                if (userInfoStr) {
                    const user = JSON.parse(userInfoStr);
                    // Normalize role to lowercase to be safe
                    setUserRole(user.role ? user.role.toLowerCase() : 'candidate');
                }
            } catch (e) {
                console.error("Failed to fetch role", e);
            } finally {
                setLoading(false);
            }
        };
        fetchRole();
    }, []);

    const handleRecordClick = () => {
        if (userRole === 'candidate') {
            navigation.navigate('VideoRecord');
        } else {
            // Employer also uses VideoRecord to create jobs now
            navigation.navigate('VideoRecord');
        }
    };

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#7C3AED" />
            </View>
        );
    }

    // Tab Bar Config Helper
    const screenOptions = ({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
            let IconComponent;
            let iconColor = focused ? '#9333ea' : '#94a3b8'; // purple-600 vs slate-400

            if (route.name === 'Connect') {
                IconComponent = IconGlobe;
            } else if (route.name === 'Profiles' || route.name === 'Talent') {
                IconComponent = IconUsers;
            } else if (route.name === 'Applications') {
                IconComponent = IconMessageSquare;
            } else if (route.name === 'Jobs' || route.name === 'My Jobs') {
                IconComponent = IconBriefcase;
            } else if (route.name === 'Notifications') {
                // Return immediate Ionicons for the bell
                return (
                    <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
                        <Ionicons name="notifications" size={24} color={iconColor} />
                    </View>
                );
            } else if (route.name === 'Settings') {
                IconComponent = IconSettings;
            }

            return (
                <View style={[styles.iconContainer, focused && styles.iconContainerFocused]}>
                    <IconComponent size={24} color={iconColor} style={focused ? { fill: '#faf5ff' } : {}} />
                </View>
            );
        },
        tabBarActiveTintColor: '#9333ea',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            marginTop: -4,
            marginBottom: Platform.OS === 'android' ? 8 : 0,
        },
        tabBarStyle: {
            height: Platform.OS === 'ios' ? 88 : 68,
            paddingTop: 8,
            backgroundColor: '#ffffff',
            borderTopWidth: 1,
            borderTopColor: '#e2e8f0', // slate-200
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.05,
            shadowRadius: 10,
        },
    });

    return (
        <View style={styles.container}>
            <Tab.Navigator
                screenOptions={screenOptions}
                screenListeners={{
                    tabPress: () => {
                        triggerHaptic.light();
                    }
                }}
            >
                {userRole === 'employer' || userRole === 'recruiter' ? (
                    // --- EMPLOYER TABS ---
                    <>
                        <Tab.Screen name="Connect">
                            {props => <ErrorBoundary><ConnectScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Talent">
                            {props => <ErrorBoundary><TalentScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Applications" options={{ tabBarLabel: 'Apps' }}>
                            {props => <ErrorBoundary><ApplicationsScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="My Jobs">
                            {props => <ErrorBoundary><EmployerDashboardScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Settings">
                            {props => <ErrorBoundary><SettingsScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                    </>
                ) : (
                    // --- WORKER TABS ---
                    <>
                        <Tab.Screen name="Connect">
                            {props => <ErrorBoundary><ConnectScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Profiles" options={{ tabBarLabel: 'Profile' }}>
                            {props => <ErrorBoundary><ProfilesScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Applications" options={{ tabBarLabel: 'Apps' }}>
                            {props => <ErrorBoundary><ApplicationsScreen {...props} /></ErrorBoundary>}
                        </Tab.Screen>
                        <Tab.Screen name="Jobs" component={JobsScreen} />
                        <Tab.Screen name="Settings" component={SettingsScreen} />
                    </>
                )}
            </Tab.Navigator>

            {/* Floating Action Button */}
            <TouchableOpacity
                style={styles.fab}
                onPress={handleRecordClick}
                activeOpacity={0.8}
            >
                <IconVideo size={24} color="#ffffff" />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    iconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        borderRadius: 16,
    },
    iconContainerFocused: {
        // No explicit background pill needed if fill prop works well, but left here for future tweaking
    },
    fab: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 108 : 88, // Above the tab bar
        right: 16,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#9333ea', // purple-600
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#9333ea',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 8,
        zIndex: 10, // Ensure it's above everything
    },
});
