import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IconBell } from '../../components/Icons';
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
                    <BrandMark />
                    <View style={styles.brandTextWrap}>
                        <Text style={styles.logoWordmark}>
                            <Text style={styles.logoWordmarkDark}>HIRE</Text>
                            <Text style={styles.logoWordmarkAccent}>CIRCLE</Text>
                        </Text>
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
                        <Ionicons name="add" size={18} color="#ffffff" />
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
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 14,
        elevation: 2,
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
    logoMark: {
        width: 32,
        height: 32,
        marginRight: 10,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        borderRadius: 16,
        backgroundColor: '#f6f2ff',
        borderWidth: 1,
        borderColor: '#e5dcff',
    },
    logoRingOuter: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#8b5cf6',
    },
    logoRingMiddle: {
        position: 'absolute',
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: '#b9a3ff',
    },
    logoRingInner: {
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: '#e2d7ff',
        backgroundColor: '#ffffff',
    },
    logoWordmark: {
        fontSize: 19,
        fontWeight: '900',
        letterSpacing: -0.5,
    },
    logoWordmarkDark: {
        color: '#121726',
    },
    logoWordmarkAccent: {
        color: '#8b3dff',
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
        color: '#6a41d8',
        fontSize: 10.5,
        fontWeight: '800',
    },
    bellButton: {
        ...SCREEN_CHROME.actionButton,
        borderRadius: 20,
        shadowColor: '#a855f7',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 2,
    },
    bellDot: {
        position: 'absolute',
        top: 7,
        right: 7,
        width: 7,
        height: 7,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.danger,
        borderWidth: 2,
        borderColor: connectPalette.surface,
    },
    bellCountBadge: {
        position: 'absolute',
        top: -4,
        right: -5,
        minWidth: 17,
        height: 17,
        borderRadius: 9,
        paddingHorizontal: 4,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: connectPalette.danger,
        borderWidth: 1,
        borderColor: connectPalette.surface,
    },
    bellCountText: {
        color: '#fff',
        fontSize: 9,
        fontWeight: '800',
        lineHeight: 10,
    },
    composeButton: {
        marginLeft: 8,
        ...SCREEN_CHROME.actionButton,
        ...SCREEN_CHROME.actionButtonPrimary,
        borderRadius: RADIUS.full,
        backgroundColor: '#6f4cf6',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 4,
    },
});
