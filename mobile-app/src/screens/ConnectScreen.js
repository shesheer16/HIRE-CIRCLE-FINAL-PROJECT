import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeedTab from './connect/feed/FeedTab';
import PulseTab from './connect/pulse/PulseTab';
import CirclesTab from './connect/circles/CirclesTab';
import AcademyTab from './connect/academy/AcademyTab';
import BountiesTab from './connect/bounties/BountiesTab';
import CircleDetailView from './connect/circles/CircleDetailView';
import ConnectHeader from './connect/ConnectHeader';
import ConnectTabBar from './connect/ConnectTabBar';
import ReferModal from './connect/ReferModal';
import MyProfileModal from './connect/MyProfileModal';
import { CONNECT_TABS, CURRENT_USER, useConnectData } from './connect/useConnectData';
import { theme, RADIUS, SHADOWS, SPACING } from '../theme/theme';
import { connectPalette } from './connect/connectPalette';
import { trackEvent } from '../services/analytics';
import { MOTION } from '../theme/motion';

export default function ConnectScreen() {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();

    const {
        userInfo,
        activeTab,
        setActiveTab,
        showMyProfile,
        setShowMyProfile,
        feedTabProps,
        pulseTabProps,
        circlesTabProps,
        academyTabProps,
        bountiesTabProps,
        circleDetailProps,
        referralModalProps,
        pulseToast,
        bountyToast,
    } = useConnectData();

    const containerStyle = useMemo(() => [styles.container, { paddingTop: insets.top }], [insets.top]);
    const currentUserAvatar = useMemo(() => {
        const displayName = String(userInfo?.name || CURRENT_USER.name || 'You').trim() || 'You';
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=8b3dff&color=fff&rounded=true`;
    }, [userInfo?.name]);
    const tabFade = useRef(new Animated.Value(1)).current;
    const tabSlide = useRef(new Animated.Value(0)).current;

    const openNotifications = useCallback(() => {
        navigation.navigate('Notifications');
    }, [navigation]);

    const openProfile = useCallback(() => {
        setShowMyProfile(true);
    }, [setShowMyProfile]);

    const closeProfile = useCallback(() => {
        setShowMyProfile(false);
    }, [setShowMyProfile]);

    const handleEditProfile = useCallback(() => {
        setShowMyProfile(false);
        const routeNames = navigation.getState?.()?.routeNames || [];
        if (routeNames.includes('Profiles')) {
            navigation.navigate('Profiles');
            return;
        }
        navigation.navigate('Settings');
    }, [navigation, setShowMyProfile]);

    const handleTabPress = useCallback((nextTab) => {
        const normalizedTab = String(nextTab || '').toLowerCase();
        if (normalizedTab === String(activeTab || '').toLowerCase()) {
            return;
        }
        setActiveTab(nextTab);
        trackEvent('TAB_SWITCH', {
            scope: 'connect',
            tab: normalizedTab,
        });
    }, [activeTab, setActiveTab]);

    const tabContent = useMemo(() => {
        switch (activeTab.toLowerCase()) {
        case 'feed':
            return <FeedTab {...feedTabProps} contentContainerStyle={styles.tabContent} />;
        case 'pulse':
            return <PulseTab {...pulseTabProps} contentContainerStyle={styles.tabContent} />;
        case 'circles':
            return <CirclesTab {...circlesTabProps} contentContainerStyle={styles.tabContent} />;
        case 'academy':
            return <AcademyTab {...academyTabProps} contentContainerStyle={styles.tabContent} />;
        case 'bounties':
            return <BountiesTab {...bountiesTabProps} contentContainerStyle={styles.tabContent} />;
        default:
            return <FeedTab {...feedTabProps} contentContainerStyle={styles.tabContent} />;
        }
    }, [activeTab, feedTabProps, pulseTabProps, circlesTabProps, academyTabProps, bountiesTabProps]);

    useEffect(() => {
        tabFade.setValue(0.72);
        tabSlide.setValue(6);
        Animated.parallel([
            Animated.timing(tabFade, {
                toValue: 1,
                duration: MOTION.tabTransitionMs,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(tabSlide, {
                toValue: 0,
                duration: MOTION.tabTransitionMs,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [activeTab, tabFade, tabSlide]);

    return (
        <View style={containerStyle}>
            <ConnectHeader
                avatar={currentUserAvatar}
                onNotificationsPress={openNotifications}
                onProfilePress={openProfile}
            />

            <ConnectTabBar tabs={CONNECT_TABS} activeTab={activeTab} onTabPress={handleTabPress} />

            <Animated.View style={[styles.mainContent, { opacity: tabFade, transform: [{ translateY: tabSlide }] }]}>
                {tabContent}
            </Animated.View>

            <CircleDetailView {...circleDetailProps} insetsTop={insets.top} />

            <ReferModal {...referralModalProps} />

            <MyProfileModal
                visible={showMyProfile}
                insetsTop={insets.top}
                userInfo={userInfo}
                avatar={currentUserAvatar}
                onClose={closeProfile}
                onEditProfile={handleEditProfile}
            />

            {pulseToast ? (
                <View style={styles.toastContainer} pointerEvents="none">
                    <Text style={styles.toastText}>{pulseToast}</Text>
                </View>
            ) : null}

            {bountyToast ? (
                <View style={styles.toastContainer} pointerEvents="none">
                    <Text style={styles.toastText}>{bountyToast}</Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: connectPalette.page,
    },
    mainContent: {
        flex: 1,
    },
    tabContent: {
        padding: SPACING.md,
        paddingBottom: SPACING.lg,
    },
    toastContainer: {
        position: 'absolute',
        bottom: 90,
        alignSelf: 'center',
        backgroundColor: connectPalette.dark,
        paddingHorizontal: SPACING.lg - 2,
        paddingVertical: SPACING.smd,
        borderRadius: RADIUS.full,
        ...SHADOWS.lg,
        elevation: 20,
    },
    toastText: {
        color: theme.surface,
        fontSize: 12,
        fontWeight: '700',
    },
});
