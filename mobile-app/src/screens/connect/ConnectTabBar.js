import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { MOTION } from '../../theme/motion';
import { SCREEN_CHROME } from '../../theme/theme';

const TAB_META = {
    Feed: { icon: 'newspaper-outline', iconActive: 'newspaper' },
    Pulse: { icon: 'flash-outline', iconActive: 'flash' },
    Academy: { icon: 'school-outline', iconActive: 'school' },
    Circles: { icon: 'people-outline', iconActive: 'people' },
    Bounties: { icon: 'trophy-outline', iconActive: 'trophy' },
};

function TabButton({ tab, active, onPress }) {
    const scale = useRef(new Animated.Value(active ? 1 : 0.96)).current;
    const opacity = useRef(new Animated.Value(active ? 1 : 0.8)).current;
    const tabMeta = TAB_META[tab] || TAB_META.Feed;
    const iconName = active ? tabMeta.iconActive : tabMeta.icon;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(scale, {
                toValue: active ? 1 : 0.96,
                stiffness: 220,
                damping: 18,
                mass: 0.85,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: active ? 1 : 0.8,
                duration: MOTION.tabTransitionMs,
                useNativeDriver: true,
            }),
        ]).start();
    }, [active, opacity, scale]);

    return (
        <TouchableOpacity
            style={styles.tabButtonPressable}
            onPress={onPress}
            activeOpacity={0.82}
        >
            <Animated.View style={[styles.tabButton, active && styles.tabButtonActive, { transform: [{ scale }], opacity }]}>
                {active ? (
                    <LinearGradient
                        colors={['#9f5cff', '#7c3aed', '#5b48f2']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.tabButtonGradient}
                    >
                        <View style={styles.tabIconBubbleActive}>
                            <Ionicons name={iconName} size={15} color="#ffffff" />
                        </View>
                        <Text style={[styles.tabText, styles.tabTextActive]} numberOfLines={1}>
                            {tab}
                        </Text>
                    </LinearGradient>
                ) : (
                    <>
                        <View style={styles.tabIconBubble}>
                            <Ionicons name={iconName} size={15} color="#6f5b98" />
                        </View>
                        <Text style={styles.tabText} numberOfLines={1}>
                            {tab}
                        </Text>
                    </>
                )}
            </Animated.View>
        </TouchableOpacity>
    );
}

function ConnectTabBarComponent({ tabs, activeTab, onTabPress }) {
    const safeTabs = Array.isArray(tabs) ? tabs : [];
    const handleTabPress = useCallback((tab) => onTabPress(tab), [onTabPress]);

    return (
        <View style={styles.container}>
            <View style={styles.tabRow}>
                {safeTabs.map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                        <View key={tab} style={styles.tabSlot}>
                            <TabButton tab={tab} active={isActive} onPress={() => handleTabPress(tab)} />
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

export default memo(ConnectTabBarComponent);

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fbf8ff',
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 12,
    },
    tabRow: {
        flexDirection: 'row',
        alignItems: 'stretch',
        borderRadius: 22,
        ...SCREEN_CHROME.contentCard,
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 6,
        paddingVertical: 6,
        gap: 6,
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 3,
    },
    tabSlot: {
        flex: 1,
    },
    tabButtonPressable: {
        borderRadius: 16,
    },
    tabButton: {
        minHeight: 54,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    tabButtonActive: {
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 14,
        elevation: 4,
    },
    tabButtonGradient: {
        minHeight: 54,
        width: '100%',
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 7,
        paddingHorizontal: 6,
    },
    tabIconBubble: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f4edff',
        borderWidth: 1,
        borderColor: '#e4d9ff',
        marginBottom: 4,
    },
    tabIconBubbleActive: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.18)',
        marginBottom: 4,
    },
    tabText: {
        color: '#5f4f82',
        fontSize: 10.5,
        fontWeight: '800',
        letterSpacing: 0.15,
    },
    tabTextActive: {
        color: '#ffffff',
    },
});
