import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet, Platform, Animated, Easing, Pressable, StatusBar } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { triggerHaptic } from '../utils/haptics';

// Custom Icons
import {
    IconGlobe,
    IconUsers,
    IconMessageSquare,
    IconBriefcase,
    IconSettings,
    IconVideo,
} from '../components/Icons';

// Screens
import ConnectContainer from '../containers/ConnectContainer';
import ProfileContainer from '../containers/ProfileContainer';
import ApplicationsScreen from '../screens/ApplicationsScreen';
import JobsContainer from '../containers/JobsContainer';
import SettingsScreen from '../screens/SettingsScreen';
import EmployerDashboardScreen from '../screens/EmployerDashboardScreen';
import TalentScreen from '../screens/TalentScreen';
import { Ionicons } from '@expo/vector-icons';
import ErrorBoundary from '../components/ErrorBoundary';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { MOTION } from '../theme/motion';
import { theme, PALETTE, SPACING } from '../theme/theme';
import { isQaRoleBootstrapEnabled } from '../utils/authRoleSelection';

const Tab = createBottomTabNavigator();
const TAB_ACCENT = '#7c3aed';
const QA_WALKTHROUGH_MODE = isQaRoleBootstrapEnabled();

function TabSceneTransition({ children }) {
    const isFocused = useIsFocused();
    const opacity = useRef(new Animated.Value(isFocused ? 1 : 0.96)).current;

    useEffect(() => {
        Animated.timing(opacity, {
            toValue: isFocused ? 1 : 0.96,
            duration: MOTION.tabTransitionMs,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [isFocused, opacity]);

    return (
        <Animated.View style={{ flex: 1, opacity }}>
            {children}
        </Animated.View>
    );
}

export default function MainTabNavigator({ navigation }) {
    const role = useAppStore(state => state.role);
    const insets = useSafeAreaInsets();
    const normalizedRole = String(role || '').toLowerCase();
    const isDemandMode = normalizedRole === 'employer' || normalizedRole === 'recruiter';
    const resolvedRole = isDemandMode ? 'employer' : 'worker';
    const [activeTabName, setActiveTabName] = useState('');

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
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ focused }) => {
            let IconComponent;
            let iconColor = focused ? TAB_ACCENT : PALETTE.textTertiary;

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
                    <View style={styles.iconContainer}>
                        <Ionicons name="notifications" size={24} color={iconColor} />
                    </View>
                );
            } else if (route.name === 'Settings') {
                IconComponent = IconSettings;
            }

            if (!IconComponent) {
                return <View style={styles.iconContainer} />;
            }

            return (
                <View style={styles.iconContainer}>
                    <IconComponent size={24} color={iconColor} />
                </View>
            );
        },
        tabBarActiveTintColor: TAB_ACCENT,
        tabBarInactiveTintColor: PALETTE.textTertiary,
        tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            marginTop: 2,
            marginBottom: Platform.OS === 'android' ? 4 : 0,
        },
        tabBarStyle: {
            height: Platform.OS === 'ios' ? 80 : 66,
            paddingTop: 4,
            backgroundColor: PALETTE.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: PALETTE.separator,
            shadowColor: PALETTE.textPrimary,
            shadowOffset: { width: 0, height: -1 },
            shadowOpacity: 0.03,
            shadowRadius: 4,
            elevation: 4,
        },
    });

    const tabDefinitions = [
        {
            name: 'Connect',
            roles: ['worker', 'employer'],
            component: ConnectContainer,
            tabBarLabel: 'Connect',
        },
        {
            name: 'Profiles',
            roles: ['worker'],
            component: ProfileContainer,
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
                employer: 'Apps',
            },
        },
        {
            name: 'Jobs',
            roles: ['worker'],
            component: JobsContainer,
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
    const roleLandingTab = QA_WALKTHROUGH_MODE
        ? 'Connect'
        : (resolvedRole === 'employer' ? 'My Jobs' : 'Jobs');
    const initialTabName = visibleTabs.some((tab) => tab.name === roleLandingTab)
        ? roleLandingTab
        : String(visibleTabs[0]?.name || 'Connect');

    useEffect(() => {
        const defaultTab = initialTabName;
        if (!defaultTab) {
            setActiveTabName('');
            return;
        }
        setActiveTabName((current) => (current && visibleTabs.some((tab) => tab.name === current) ? current : defaultTab));
    }, [initialTabName, visibleTabs]);

    const fabAllowedTabs = resolvedRole === 'employer'
        ? new Set(['Talent'])
        : new Set(['Profiles']);
    const showSmartInterviewFab = fabAllowedTabs.has(activeTabName);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
            <View
                pointerEvents="none"
                style={[styles.statusBarTint, { height: insets.top + 3 }]}
            />
            <Tab.Navigator
                key={`main-tabs-${resolvedRole}`}
                initialRouteName={initialTabName}
                sceneContainerStyle={styles.sceneContainer}
                screenOptions={screenOptions}
                screenListeners={({ route }) => ({
                    tabPress: () => {
                        handleMainTabPress(route.name);
                        setActiveTabName(route.name);
                    },
                    focus: () => {
                        setActiveTabName(route.name);
                    },
                })}
            >
                {visibleTabs.map((tab) => {
                    const label = tab.tabBarLabelByRole?.[resolvedRole] || tab.tabBarLabel || tab.name;
                    const ScreenComponent = tab.component;
                    const shouldWrap = QA_WALKTHROUGH_MODE || tab.wrapWithBoundary !== false;

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

            {showSmartInterviewFab ? (
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
    statusBarTint: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: PALETTE.background,
        zIndex: 30,
    },
    sceneContainer: {
        backgroundColor: theme.background,
    },
    iconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 24,
    },
    fabGroup: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 108 : 88,
        right: SPACING.md,
        zIndex: 15,
    },
    fab: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: '#7c3aed',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: 'rgba(216,180,254,0.4)',
        shadowColor: '#8b5cf6',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
        elevation: 10,
    },
    fabPressed: {
        transform: [{ scale: 0.98 }],
    },
});
