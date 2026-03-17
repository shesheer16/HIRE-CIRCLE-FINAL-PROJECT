import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IconBell } from '../../components/Icons';
import CharmTitle from '../../components/CharmTitle';
import { RADIUS, SCREEN_CHROME, SPACING } from '../../theme/theme';
import { connectPalette } from './connectPalette';

function BrandMark() {
    return (
        <View style={styles.logoMark}>
            <View style={styles.logoRingOuter} />
            <View style={styles.logoRingMiddle} />
            <View style={styles.logoRingInner} />
        </View>
    );
}

function ConnectHeaderComponent({
    onNotificationsPress,
    onComposePress,
    notificationsCount = 0,
    activeTab = 'Feed',
}) {
    const hasUnread = Number(notificationsCount || 0) > 0;
    const unreadLabel = Number(notificationsCount || 0) > 99 ? '99+' : String(Math.max(0, Number(notificationsCount || 0)));
    const activeTabLabel = String(activeTab || 'Feed').trim() || 'Feed';

    return (
        <View style={styles.headerShell}>
            <View style={styles.headerTopRow}>
                <View style={styles.headerLeft}>
                    <View style={styles.brandTextWrap}>
                        <CharmTitle text="HIRECIRCLE" fontSize={22} fontWeight="900" letterSpacing={-0.5} />
                    </View>
                </View>
                <View style={styles.headerRight}>
                    {activeTabLabel && activeTabLabel.toLowerCase() !== 'feed' ? (
                        <View style={styles.tabPill}>
                            <Text style={styles.tabPillText}>{activeTabLabel}</Text>
                        </View>
                    ) : null}
                    <TouchableOpacity style={styles.bellButton} onPress={onNotificationsPress} activeOpacity={0.82}>
                        <IconBell size={18} color={connectPalette.darkSoft} />
                        {hasUnread ? (
                            Number(notificationsCount || 0) > 9 ? (
                                <View style={styles.bellCountBadge}>
                                    <Text style={styles.bellCountText}>{unreadLabel}</Text>
                                </View>
                            ) : (
                                <View style={styles.bellDot} />
                            )
                        ) : null}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.composeButton} onPress={onComposePress} activeOpacity={0.85}>
                        <Ionicons name="add" size={24} color="#ffffff" />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

export default memo(ConnectHeaderComponent);

const styles = StyleSheet.create({
    headerShell: {
        ...SCREEN_CHROME.headerSurface,
        paddingHorizontal: SPACING.md,
        paddingTop: SPACING.sm + 4,
        paddingBottom: SPACING.sm,
        shadowColor: '#6d28d9',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 20,
        elevation: 4,
    },
    headerTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    brandTextWrap: {
        justifyContent: 'center',
        flexShrink: 1,
    },
    logoWordmark: {
        fontSize: 22,
        fontWeight: '900',
        letterSpacing: -0.5,
    },
    logoWordmarkDark: {
        color: '#0f172a',
    },
    logoWordmarkAccent: {
        color: '#9333ea',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    tabPill: {
        marginRight: 8,
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    tabPillText: {
        color: '#7e22ce',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    bellButton: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
        borderRadius: 20,
        shadowColor: '#a855f7',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
    },
    bellDot: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 8,
        height: 8,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.danger,
        borderWidth: 2,
        borderColor: '#f8fafc',
    },
    bellCountBadge: {
        position: 'absolute',
        top: -6,
        right: -6,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: connectPalette.danger,
        borderWidth: 2,
        borderColor: '#f8fafc',
    },
    bellCountText: {
        color: '#fff',
        fontSize: 10,
        fontWeight: '800',
        lineHeight: 11,
    },
    composeButton: {
        marginLeft: 10,
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 21,
        backgroundColor: '#7c3aed',
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 4,
    },
});
