import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Alert, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import ContactInfoView from '../components/contact/ContactInfoView';
import { CONNECT_TABS, useConnectData } from './connect/useConnectData';
import { theme, PALETTE, RADIUS, SHADOWS, SPACING } from '../theme/theme';
import { connectPalette } from './connect/connectPalette';
import { trackEvent } from '../services/analytics';
import { MOTION } from '../theme/motion';
import { useAppStore } from '../store/AppStore';
import { getProfileTitleForRole } from '../utils/profileReadiness';

const COMPOSE_ENTRY_OPTIONS = [
    {
        key: 'PHOTOS',
        label: 'Photo',
        helper: 'Share one or more images',
        icon: 'image-outline',
    },
    {
        key: 'VIDEO',
        label: 'Video',
        helper: 'Post a short video update',
        icon: 'videocam-outline',
    },
    {
        key: 'VOICE',
        label: 'Voice',
        helper: 'Record a quick voice note',
        icon: 'mic-outline',
    },
];

export default function ConnectScreen() {
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const route = useRoute();
    const notificationsCount = useAppStore(state => state.notificationsCount) || 0;

    const {
        userInfo = null,
        activeTab = 'Feed',
        setActiveTab = () => {},
        showMyProfile = false,
        setShowMyProfile = () => {},
        resettingConnectData = false,
        clearConnectHistory = async () => ({ ok: false }),
        feedProfileVisible = false,
        feedProfileLoading = false,
        feedProfileData = null,
        closeFeedProfile = () => {},
        feedTabProps = {},
        pulseTabProps = {},
        circlesTabProps = {},
        academyTabProps = {},
        bountiesTabProps = {},
        circleDetailProps = {},
        referralModalProps = {},
        pulseToast,
        bountyToast,
    } = useConnectData() || {};

    const tabFade = useRef(new Animated.Value(1)).current;
    const tabSlide = useRef(new Animated.Value(0)).current;
    const [composeMenuVisible, setComposeMenuVisible] = useState(false);
    const isFeedTab = String(activeTab || '').toLowerCase() === 'feed';
    const connectBottomPadding = useMemo(() => Math.max(insets.bottom, 16) + 88, [insets.bottom]);
    const feedContentContainerStyle = useMemo(
        () => ({ paddingBottom: connectBottomPadding }),
        [connectBottomPadding]
    );
    const defaultTabContentContainerStyle = useMemo(
        () => ({
            paddingHorizontal: 10,
            paddingTop: 10,
            paddingBottom: connectBottomPadding,
        }),
        [connectBottomPadding]
    );
    const containerStyle = useMemo(
        () => [styles.container, { paddingTop: insets.top }, isFeedTab ? styles.containerFeed : null],
        [insets.top, isFeedTab]
    );
    const currentUserAvatar = useMemo(() => {
        const displayName = String(userInfo?.name || 'You').trim() || 'You';
        return String(
            userInfo?.avatar
            || userInfo?.profilePicture
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=d1d5db&color=111111&rounded=true`
        );
    }, [userInfo?.avatar, userInfo?.name, userInfo?.profilePicture]);

    const openNotifications = useCallback(() => {
        navigation.navigate('Notifications');
    }, [navigation]);

    const openProfile = useCallback(() => {
        setShowMyProfile(true);
    }, [setShowMyProfile]);

    const closeProfile = useCallback(() => {
        setShowMyProfile(false);
    }, [setShowMyProfile]);

    const handleClearConnectHistory = useCallback(() => {
        if (resettingConnectData) return;
        Alert.alert(
            'Clear Connect Data?',
            'This will remove past Connect data and refresh all Connect tabs.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: async () => {
                        const result = await clearConnectHistory();
                        if (result?.ok) {
                            return;
                        }
                        Alert.alert('Clear failed', String(result?.message || 'Could not clear Connect data right now.'));
                    },
                },
            ]
        );
    }, [clearConnectHistory, resettingConnectData]);

    const handleEditProfile = useCallback(() => {
        setShowMyProfile(false);
        const routeNames = navigation.getState?.()?.routeNames || [];
        if (routeNames.includes('Profiles')) {
            navigation.navigate('Profiles');
            return;
        }
        navigation.navigate('Settings');
    }, [navigation, setShowMyProfile]);

    const handleOpenSettings = useCallback(() => {
        setShowMyProfile(false);
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

    const handleOpenPostJobForm = useCallback(() => {
        navigation.navigate('PostJob');
    }, [navigation]);

    const openComposeMenu = useCallback(() => {
        setComposeMenuVisible(true);
    }, []);

    const closeComposeMenu = useCallback(() => {
        setComposeMenuVisible(false);
    }, []);

    const handleComposeOptionPress = useCallback((mediaType) => {
        closeComposeMenu();
        if (String(activeTab || '').toLowerCase() !== 'feed') {
            setActiveTab('Feed');
        }
        setTimeout(() => {
            if (typeof feedTabProps?.onMediaButtonClick === 'function') {
                feedTabProps.onMediaButtonClick(mediaType);
                return;
            }
            if (typeof feedTabProps?.onInputAreaClick === 'function') {
                feedTabProps.onInputAreaClick();
            }
        }, 0);
    }, [activeTab, closeComposeMenu, feedTabProps, setActiveTab]);

    const tabContent = useMemo(() => {
        switch (String(activeTab || 'Feed').toLowerCase()) {
        case 'feed':
            return (
                <FeedTab
                    {...feedTabProps}
                    contentContainerStyle={feedContentContainerStyle}
                    onOpenPostJobForm={handleOpenPostJobForm}
                />
            );
        case 'pulse':
            return <PulseTab {...pulseTabProps} contentContainerStyle={defaultTabContentContainerStyle} />;
        case 'circles':
            return (
                <CirclesTab
                    {...circlesTabProps}
                    communityFabTrigger={route.params?.communityFabTrigger}
                    contentContainerStyle={defaultTabContentContainerStyle}
                />
            );
        case 'academy':
            return <AcademyTab {...academyTabProps} contentContainerStyle={defaultTabContentContainerStyle} />;
        case 'bounties':
            return <BountiesTab {...bountiesTabProps} contentContainerStyle={defaultTabContentContainerStyle} />;
        default:
            return (
                <FeedTab
                    {...feedTabProps}
                    contentContainerStyle={feedContentContainerStyle}
                    onOpenPostJobForm={handleOpenPostJobForm}
                />
            );
        }
    }, [
        activeTab,
        feedTabProps,
        pulseTabProps,
        circlesTabProps,
        academyTabProps,
        bountiesTabProps,
        route.params?.communityFabTrigger,
        defaultTabContentContainerStyle,
        feedContentContainerStyle,
        handleOpenPostJobForm,
    ]);

    useEffect(() => {
        navigation.setParams({
            connectActiveTab: activeTab,
        });
    }, [activeTab, navigation]);

    // Clear communityFabTrigger once consumed to prevent repeated re-triggers on re-render
    useEffect(() => {
        if (!route.params?.communityFabTrigger) return;
        navigation.setParams({ communityFabTrigger: undefined });
    }, [route.params?.communityFabTrigger, navigation]);

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
            {!isFeedTab ? <View pointerEvents="none" style={styles.backdropOrbTop} /> : null}
            {!isFeedTab ? <View pointerEvents="none" style={styles.backdropOrbBottom} /> : null}

            <ConnectHeader
                onNotificationsPress={openNotifications}
                onComposePress={openComposeMenu}
                onResetPress={handleClearConnectHistory}
                resetBusy={resettingConnectData}
                notificationsCount={notificationsCount}
                activeTab={activeTab}
            />

            <View style={styles.tabBarWrap}>
                <ConnectTabBar tabs={CONNECT_TABS} activeTab={activeTab} onTabPress={handleTabPress} />
            </View>

            <Animated.View style={styles.mainContent}>
                <Animated.View style={[styles.contentWrap, { opacity: tabFade, transform: [{ translateY: tabSlide }] }]}>
                    <View style={[styles.contentSheet, isFeedTab && styles.contentSheetFeed]}>
                        {tabContent}
                    </View>
                </Animated.View>
            </Animated.View>

            <CircleDetailView {...circleDetailProps} insetsTop={insets.top} />

            <ReferModal {...referralModalProps} />

            <Modal
                visible={composeMenuVisible}
                transparent
                animationType="fade"
                onRequestClose={closeComposeMenu}
            >
                <TouchableOpacity style={styles.composeMenuOverlay} activeOpacity={1} onPress={closeComposeMenu}>
                    <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[styles.composeMenuSheet, { marginTop: insets.top + 54 }]}>
                        <Text style={styles.composeMenuTitle}>Create post</Text>
                        <Text style={styles.composeMenuSubtitle}>Choose how you want to share on Connect.</Text>
                        {COMPOSE_ENTRY_OPTIONS.map((option) => (
                            <TouchableOpacity
                                key={option.key}
                                style={styles.composeMenuItem}
                                activeOpacity={0.86}
                                onPress={() => handleComposeOptionPress(option.key)}
                            >
                                <View style={styles.composeMenuIconWrap}>
                                    <Ionicons name={option.icon} size={18} color="#7c3aed" />
                                </View>
                                <View style={styles.composeMenuTextWrap}>
                                    <Text style={styles.composeMenuItemLabel}>{option.label}</Text>
                                    <Text style={styles.composeMenuItemHelper}>{option.helper}</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color="#9aa1b5" />
                            </TouchableOpacity>
                        ))}
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <MyProfileModal
                visible={showMyProfile}
                insetsTop={insets.top}
                userInfo={userInfo}
                avatar={currentUserAvatar}
                onClose={closeProfile}
                onEditProfile={handleEditProfile}
                onOpenSettings={handleOpenSettings}
            />

            <Modal
                visible={Boolean(feedProfileVisible)}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={closeFeedProfile}
            >
                <View style={styles.profileOverlayShell}>
                    <View style={[styles.profileOverlayHeader, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.profileOverlayBackBtn} onPress={closeFeedProfile}>
                            <Text style={styles.profileOverlayBackIcon}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.profileOverlayTitle}>
                            {getProfileTitleForRole(String(feedProfileData?.mode || '').toLowerCase() === 'employer' ? 'employer' : 'worker')}
                        </Text>
                    </View>

                    {feedProfileLoading ? (
                        <View style={styles.profileLoadingWrap}>
                            <ActivityIndicator size="small" color="#111111" />
                            <Text style={styles.profileLoadingText}>Loading profile...</Text>
                        </View>
                    ) : (
                        <ContactInfoView
                            hideHeader
                            presentation="modal"
                            mode={String(feedProfileData?.mode || '').toLowerCase() === 'employer' ? 'employer' : 'candidate'}
                            title={getProfileTitleForRole(String(feedProfileData?.mode || '').toLowerCase() === 'employer' ? 'employer' : 'worker')}
                            data={feedProfileData || {}}
                            onBack={closeFeedProfile}
                        />
                    )}
                </View>
            </Modal>

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
        backgroundColor: '#ffffff',
    },
    containerFeed: {
        backgroundColor: '#ffffff',
    },
    backdropOrbTop: {
        position: 'absolute',
        top: 24,
        right: -58,
        width: 0,
        height: 0,
    },
    backdropOrbBottom: {
        position: 'absolute',
        bottom: 50,
        left: -72,
        width: 0,
        height: 0,
    },
    mainContent: {
        flex: 1,
        zIndex: 1,
    },
    contentWrap: {
        flex: 1,
    },
    contentSheet: {
        flex: 1,
        marginHorizontal: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
    },
    contentSheetFeed: {
        backgroundColor: '#ffffff',
        borderColor: 'transparent',
        borderWidth: 0,
        marginHorizontal: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
    },
    tabBarWrap: {
        overflow: 'hidden',
        zIndex: 2,
    },
    composeMenuOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.12)',
        alignItems: 'flex-end',
        paddingHorizontal: 14,
    },
    composeMenuSheet: {
        width: 244,
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 12,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.1,
        shadowRadius: 24,
        elevation: 8,
    },
    composeMenuTitle: {
        color: PALETTE.textPrimary,
        fontSize: 15,
        fontWeight: '800',
    },
    composeMenuSubtitle: {
        marginTop: 4,
        marginBottom: 10,
        color: PALETTE.textSecondary,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
    },
    composeMenuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        gap: 10,
    },
    composeMenuIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.accentTint,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
    },
    composeMenuTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    composeMenuItemLabel: {
        color: PALETTE.textPrimary,
        fontSize: 13,
        fontWeight: '800',
    },
    composeMenuItemHelper: {
        marginTop: 2,
        color: PALETTE.textSecondary,
        fontSize: 11.5,
        fontWeight: '600',
    },
    profileOverlayShell: {
        flex: 1,
        backgroundColor: PALETTE.surface,
    },
    profileOverlayHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: PALETTE.surface,
        borderBottomWidth: 1,
        borderBottomColor: PALETTE.separator,
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
    profileOverlayBackBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    profileOverlayBackIcon: {
        color: PALETTE.textPrimary,
        fontSize: 28,
        lineHeight: 28,
        fontWeight: '700',
    },
    profileOverlayTitle: {
        color: PALETTE.textPrimary,
        fontSize: 18,
        fontWeight: '800',
    },
    profileLoadingWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    profileLoadingText: {
        color: PALETTE.textSecondary,
        fontSize: 13,
        fontWeight: '600',
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
