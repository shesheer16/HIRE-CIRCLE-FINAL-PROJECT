import React, { useCallback, useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet, Platform, Animated, Easing, Pressable } from 'react-native';
import { useIsFocused, useRoute } from '@react-navigation/native';
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
import { Ionicons } from '@expo/vector-icons';
import ErrorBoundary from '../components/ErrorBoundary';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { MOTION } from '../theme/motion';
import { SHADOWS, theme, RADIUS, SPACING } from '../theme/theme';

const Tab = createBottomTabNavigator();

function TabSceneTransition({ children }) {
    const isFocused = useIsFocused();
    const opacity = useRef(new Animated.Value(isFocused ? 1 : 0)).current;
    const translateY = useRef(new Animated.Value(isFocused ? 0 : 6)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, {
                toValue: isFocused ? 1 : 0.92,
                duration: MOTION.tabTransitionMs,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: isFocused ? 0 : 6,
                duration: MOTION.tabTransitionMs,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [isFocused, opacity, translateY]);

    return (
        <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
            {children}
        </Animated.View>
    );
}

export default function MainTabNavigator({ navigation }) {
    const { role } = useAppStore();
    const route = useRoute();
    const normalizedRole = String(role || '').toLowerCase();
    const isDemandMode = normalizedRole === 'employer' || normalizedRole === 'recruiter';
    const resolvedRole = isDemandMode ? 'employer' : 'worker';
    const tabState = route?.state;
    const activeTabRoute = tabState?.routes?.[tabState?.index ?? 0];
    const shouldHideFab = Boolean(activeTabRoute?.params?.hideFab);

    const handleRecordClick = () => {
        navigation.navigate('SmartInterview');
    };

    const handleMainTabPress = useCallback((routeName) => {
        triggerHaptic.light();
        trackEvent('TAB_SWITCH', {
            scope: 'main',
            tab: routeName,
        });
    }, []);

    const screenOptions = ({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => {
            let IconComponent;
            let iconColor = focused ? theme.surface : '#64748b';

            if (route.name === 'Connect') {
                IconComponent = IconGlobe;
            } else if (route.name === 'Profiles' || route.name === 'Talent') {
                IconComponent = IconUsers;
            } else if (route.name === 'Applications') {
                IconComponent = IconMessageSquare;
            } else if (route.name === 'Jobs' || route.name === 'My Jobs') {
                IconComponent = IconBriefcase;
            } else if (route.name === 'Notifications') {
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
                    <IconComponent size={24} color={iconColor} style={focused ? { fill: theme.surface } : {}} />
                </View>
            );
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginTop: -4,
            marginBottom: Platform.OS === 'android' ? 8 : 0,
        },
        tabBarStyle: {
            height: Platform.OS === 'ios' ? 92 : 72,
            paddingTop: SPACING.xs,
            backgroundColor: 'rgba(255,255,255,0.97)',
            borderTopWidth: 1,
            borderTopColor: '#e5ebf5',
            ...SHADOWS.lg,
        },
    });

    const tabDefinitions = [
        {
            name: 'Connect',
            roles: ['worker', 'employer'],
            component: ConnectScreen,
            tabBarLabel: 'Connect',
        },
        {
            name: 'Profiles',
            roles: ['worker'],
            component: ProfilesScreen,
            tabBarLabel: 'Profile',
        },
        {
            name: 'Talent',
            roles: ['employer'],
            component: TalentScreen,
            tabBarLabel: 'Talent',
        },
        {
            name: 'Applications',
            roles: ['worker', 'employer'],
            component: ApplicationsScreen,
            tabBarLabelByRole: {
                worker: 'Apps',
                employer: 'Applications',
            },
        },
        {
            name: 'Jobs',
            roles: ['worker'],
            component: JobsScreen,
            tabBarLabel: 'Find Work',
            wrapWithBoundary: false,
        },
        {
            name: 'My Jobs',
            roles: ['employer'],
            component: EmployerDashboardScreen,
            tabBarLabel: 'My Jobs',
        },
        {
            name: 'Settings',
            roles: ['worker', 'employer'],
            component: SettingsScreen,
            tabBarLabel: 'Settings',
            wrapWithBoundary: false,
        },
    ];

    const visibleTabs = tabDefinitions.filter((tab) => tab.roles.includes(resolvedRole));

    return (
        <View style={styles.container}>
            <Tab.Navigator
                sceneContainerStyle={styles.sceneContainer}
                screenOptions={screenOptions}
                screenListeners={({ route }) => ({
                    tabPress: () => {
                        handleMainTabPress(route.name);
                    }
                })}
            >
                {visibleTabs.map((tab) => {
                    const label = tab.tabBarLabelByRole?.[resolvedRole] || tab.tabBarLabel || tab.name;
                    const ScreenComponent = tab.component;
                    const shouldWrap = tab.wrapWithBoundary !== false;

                    if (shouldWrap) {
                        return (
                            <Tab.Screen key={tab.name} name={tab.name} options={{ tabBarLabel: label }}>
                                {(props) => (
                                    <TabSceneTransition>
                                        <ErrorBoundary>
                                            <ScreenComponent {...props} />
                                        </ErrorBoundary>
                                    </TabSceneTransition>
                                )}
                            </Tab.Screen>
                        );
                    }

                    return (
                        <Tab.Screen key={tab.name} name={tab.name} options={{ tabBarLabel: label }}>
                            {(props) => (
                                <TabSceneTransition>
                                    <ScreenComponent {...props} />
                                </TabSceneTransition>
                            )}
                        </Tab.Screen>
                    );
                })}
            </Tab.Navigator>

            {!shouldHideFab ? (
                <View style={styles.fabGroup}>
                    <Pressable
                        android_ripple={{ color: 'rgba(255,255,255,0.24)', borderless: false, radius: 28 }}
                        style={({ pressed }) => [
                            styles.fab,
                            pressed && styles.fabPressed,
                        ]}
                        onPress={handleRecordClick}
                    >
                        <IconVideo size={24} color="#ffffff" />
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
        backgroundColor: theme.background,
    },
    sceneContainer: {
        backgroundColor: theme.background,
    },
    iconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: SPACING.xs,
        borderRadius: RADIUS.md,
    },
    iconContainerFocused: {
        backgroundColor: theme.primary,
        ...SHADOWS.md,
    },
    fabGroup: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 108 : 88,
        right: SPACING.md,
        zIndex: 15,
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: theme.primary,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: theme.primary,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.34,
        shadowRadius: 12,
        elevation: 8,
    },
    fabPressed: {
        transform: [{ scale: 0.98 }],
    },
});
