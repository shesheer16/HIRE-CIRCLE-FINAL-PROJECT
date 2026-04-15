import React, { memo, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MOTION } from '../../../theme/motion';
import { RADIUS, SCREEN_CHROME } from '../../../theme/theme';

const formatCompactNumber = (value) => {
    const safeValue = Number(value || 0);
    if (!Number.isFinite(safeValue) || safeValue <= 0) return '0';
    if (safeValue >= 1000000) {
        const millions = safeValue / 1000000;
        const rounded = millions >= 10 ? millions.toFixed(0) : millions.toFixed(1);
        return `${rounded.replace(/\.0$/, '')}M`;
    }
    if (safeValue >= 1000) {
        const thousands = safeValue / 1000;
        const rounded = thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1);
        return `${rounded.replace(/\.0$/, '')}K`;
    }
    return String(Math.round(safeValue));
};

function ActionIconButton({ children, onPress }) {
    const scale = useRef(new Animated.Value(1)).current;

    return (
        <Animated.View style={{ transform: [{ scale }] }}>
            <TouchableOpacity
                style={styles.iconButton}
                onPress={onPress}
                activeOpacity={0.88}
                onPressIn={() => {
                    Animated.timing(scale, {
                        toValue: 0.95,
                        duration: MOTION.pressInMs,
                        useNativeDriver: true,
                    }).start();
                }}
                onPressOut={() => {
                    Animated.spring(scale, {
                        toValue: 1,
                        stiffness: MOTION.modalSpring.stiffness,
                        damping: MOTION.modalSpring.damping,
                        mass: MOTION.modalSpring.mass,
                        useNativeDriver: true,
                    }).start();
                }}
            >
                {children}
            </TouchableOpacity>
        </Animated.View>
    );
}

function FeedActionsBarComponent({
    postId,
    likeCount,
    commentCount,
    viewCount,
    vouchCount,
    vouched,
    isLiked,
    isSaved,
    post,
    onToggleLike,
    onToggleSave,
    onToggleComment,
    onToggleVouch,
}) {
    const safeLikes = Math.max(0, Number(likeCount || 0));
    const safeComments = Math.max(0, Number(commentCount || 0));
    const safeViews = Math.max(0, Number(viewCount || 0));
    const safeVouches = Math.max(0, Number(vouchCount || 0));

    const handleLike = useCallback(() => {
        onToggleLike?.(postId);
    }, [onToggleLike, postId]);

    const handleComment = useCallback(() => {
        onToggleComment?.(postId);
    }, [onToggleComment, postId]);

    const handleVouch = useCallback(() => {
        onToggleVouch?.(postId, post);
    }, [onToggleVouch, postId, post]);

    const handleSave = useCallback(() => {
        onToggleSave?.(postId, post);
    }, [onToggleSave, postId, post]);

    const iconColor = '#1f2435';
    const likeIconColor = isLiked ? '#ef4444' : iconColor;
    const vouchIconColor = vouched ? '#7c3aed' : iconColor;
    const saveIconColor = isSaved ? '#7c3aed' : iconColor;

    return (
        <View style={styles.container}>
            <View style={styles.iconRow}>
                <View style={styles.leftIconRow}>
                    <ActionIconButton onPress={handleLike}>
                        <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={20} color={likeIconColor} />
                        <Text style={[styles.actionLabel, isLiked && styles.actionLabelLiked]}>
                            {safeLikes > 0 ? formatCompactNumber(safeLikes) : 'Like'}
                        </Text>
                    </ActionIconButton>
                    <ActionIconButton onPress={handleComment}>
                        <Ionicons name="chatbubble-outline" size={20} color={iconColor} />
                        <Text style={styles.actionLabel}>
                            {safeComments > 0 ? formatCompactNumber(safeComments) : 'Comment'}
                        </Text>
                    </ActionIconButton>
                    <ActionIconButton onPress={handleVouch}>
                        <Ionicons name={vouched ? 'ribbon' : 'ribbon-outline'} size={20} color={vouchIconColor} />
                        <Text style={[styles.actionLabel, vouched && styles.actionLabelVouched]}>
                            {safeVouches > 0 ? formatCompactNumber(safeVouches) : 'Vouch'}
                        </Text>
                    </ActionIconButton>
                </View>
                <ActionIconButton onPress={handleSave}>
                    <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={20} color={saveIconColor} />
                </ActionIconButton>
            </View>

            {safeViews > 0 ? (
                <TouchableOpacity style={styles.metaRow} activeOpacity={0.82} onPress={handleComment}>
                    <Text style={styles.metaText}>{formatCompactNumber(safeViews)} views</Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

export default memo(FeedActionsBarComponent);

const styles = StyleSheet.create({
    container: {
        marginTop: 6,
        gap: 8,
    },
    iconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    leftIconRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    iconButton: {
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 4,
    },
    actionLabel: {
        color: '#475569',
        fontSize: 13,
        fontWeight: '600',
    },
    actionLabelLiked: {
        color: '#ec4899',
    },
    actionLabelVouched: {
        color: '#8b5cf6',
    },
    metaRow: {
        paddingHorizontal: 4,
    },
    metaText: {
        color: '#94a3b8',
        fontSize: 11,
        fontWeight: '700',
    },
});
