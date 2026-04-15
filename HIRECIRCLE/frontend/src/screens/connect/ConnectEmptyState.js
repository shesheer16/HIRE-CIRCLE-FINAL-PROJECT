import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { RADIUS } from '../../theme/theme';

const TONE_STYLES = {
    default: {
        card: {
            borderColor: '#efe7fb',
            backgroundColor: 'rgba(255,255,255,0.96)',
        },
        mark: {
            backgroundColor: '#f6f2ff',
            borderColor: '#e4dafb',
        },
        outer: '#8b5cf6',
        middle: '#b9a3ff',
        inner: '#e2d7ff',
        title: '#1f2436',
        subtitle: '#7a8194',
        actionBg: '#6f4cf6',
        actionShadow: '#6f4cf6',
        actionText: '#ffffff',
    },
    info: {
        card: {
            borderColor: '#ddd6fe',
            backgroundColor: '#faf7ff',
        },
        mark: {
            backgroundColor: '#f4f0ff',
            borderColor: '#ddd3ff',
        },
        outer: '#7c3aed',
        middle: '#a78bfa',
        inner: '#ddd6fe',
        title: '#231942',
        subtitle: '#6d6685',
        actionBg: '#6f4cf6',
        actionShadow: '#6f4cf6',
        actionText: '#ffffff',
    },
    error: {
        card: {
            borderColor: '#f1d5e7',
            backgroundColor: '#fff7fb',
        },
        mark: {
            backgroundColor: '#fff1f8',
            borderColor: '#f6d8e9',
        },
        outer: '#db2777',
        middle: '#f472b6',
        inner: '#fbcfe8',
        title: '#3d1531',
        subtitle: '#7c5870',
        actionBg: '#7c3aed',
        actionShadow: '#7c3aed',
        actionText: '#ffffff',
    },
};

function ConnectEmptyStateCard({
    title,
    subtitle,
    actionLabel,
    onAction,
    style,
    tone = 'default',
    inline = false,
}) {
    const palette = TONE_STYLES[tone] || TONE_STYLES.default;
    const actionButtonStyle = {
        backgroundColor: palette.actionBg,
        shadowColor: palette.actionShadow,
    };

    return (
        <View style={[styles.card, palette.card, inline && styles.inlineCard, style]}>
            <View style={[styles.brandMark, palette.mark, inline && styles.inlineBrandMark]}>
                <View style={[styles.brandRingOuter, { borderColor: palette.outer }]} />
                <View style={[styles.brandRingMiddle, { borderColor: palette.middle }]} />
                <View style={[styles.brandRingInner, { borderColor: palette.inner }]} />
            </View>
            <View style={[styles.textWrap, inline && styles.inlineTextWrap]}>
                {title ? <Text style={[styles.title, { color: palette.title }, inline && styles.inlineTitle]}>{title}</Text> : null}
                {subtitle ? <Text style={[styles.subtitle, { color: palette.subtitle }, inline && styles.inlineSubtitle]}>{subtitle}</Text> : null}
            </View>
            {actionLabel && typeof onAction === 'function' ? (
                <TouchableOpacity
                    style={[styles.actionButton, actionButtonStyle, inline && styles.inlineActionButton]}
                    onPress={onAction}
                    activeOpacity={0.85}
                >
                    <Text style={[styles.actionButtonText, { color: palette.actionText }]}>{actionLabel}</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

export default memo(ConnectEmptyStateCard);

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderRadius: 20,
        paddingHorizontal: 18,
        paddingVertical: 20,
        alignItems: 'center',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    inlineCard: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 14,
        gap: 12,
    },
    brandMark: {
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 1,
        marginBottom: 10,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    inlineBrandMark: {
        width: 44,
        height: 44,
        borderRadius: 22,
        marginBottom: 0,
        flexShrink: 0,
    },
    brandRingOuter: {
        position: 'absolute',
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
    },
    brandRingMiddle: {
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
    },
    brandRingInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        backgroundColor: '#ffffff',
    },
    textWrap: {
        alignItems: 'center',
    },
    inlineTextWrap: {
        flex: 1,
        minWidth: 0,
        alignItems: 'flex-start',
    },
    title: {
        fontSize: 15,
        fontWeight: '800',
        textAlign: 'center',
        marginBottom: 4,
    },
    inlineTitle: {
        textAlign: 'left',
        marginBottom: 2,
    },
    subtitle: {
        fontSize: 12.5,
        fontWeight: '600',
        textAlign: 'center',
        lineHeight: 18,
    },
    inlineSubtitle: {
        textAlign: 'left',
    },
    actionButton: {
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: RADIUS.full,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
    },
    inlineActionButton: {
        marginTop: 0,
        marginLeft: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        shadowOpacity: 0.12,
        shadowRadius: 10,
        flexShrink: 0,
    },
    actionButtonText: {
        fontSize: 12.5,
        fontWeight: '800',
    },
});
