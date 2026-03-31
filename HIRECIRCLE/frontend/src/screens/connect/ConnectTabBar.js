import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const TAB_META = {
    Feed: { icon: 'newspaper-outline', iconActive: 'newspaper' },
    Pulse: { icon: 'flash-outline', iconActive: 'flash' },
    Academy: { icon: 'school-outline', iconActive: 'school' },
    Circles: { icon: 'people-outline', iconActive: 'people' },
    Bounties: { icon: 'trophy-outline', iconActive: 'trophy' },
};

function ConnectTabBarComponent({ tabs, activeTab, onTabPress }) {
    const safeTabs = Array.isArray(tabs) ? tabs : [];

    return (
        <View style={styles.container}>
            <View style={styles.tabRow}>
                {safeTabs.map((tab) => {
                    const isActive = activeTab === tab;
                    const meta = TAB_META[tab] || { icon: 'document-outline', iconActive: 'document' };
                    
                    return (
                        <TouchableOpacity
                            key={tab}
                            style={styles.tabButton}
                            onPress={() => onTabPress(tab)}
                            activeOpacity={0.6}
                        >
                            <View style={styles.iconContainer}>
                                {isActive ? (
                                    <LinearGradient
                                        colors={['#9333ea', '#7e22ce', '#6b21a8']}
                                        style={styles.activeIconBubble}
                                        start={{x: 0, y: 0}}
                                        end={{x: 1, y: 1}}
                                    >
                                        <Ionicons name={meta.iconActive} size={18} color="#ffffff" />
                                    </LinearGradient>
                                ) : (
                                    <View style={styles.inactiveIconBubble}>
                                        <Ionicons name={meta.icon} size={22} color="#64748b" />
                                    </View>
                                )}
                            </View>
                            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                                {tab}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </View>
    );
}

export default memo(ConnectTabBarComponent);

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        paddingBottom: 12,
        paddingTop: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02,
        shadowRadius: 4,
        elevation: 2,
        zIndex: 10,
    },
    tabRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
    },
    tabButtonPressable: {
        borderRadius: 16,
    },
    tabButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    iconContainer: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeIconBubble: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#9333ea',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 4,
    },
    inactiveIconBubble: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    tabText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#64748b',
        letterSpacing: 0.2,
    },
    tabTextActive: {
        color: '#9333ea',
        fontWeight: '800',
    },
});
