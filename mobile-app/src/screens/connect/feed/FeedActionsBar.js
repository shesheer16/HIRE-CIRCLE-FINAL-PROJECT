import React, { memo, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { IconCheck } from '../../../components/Icons';
import { connectPalette } from '../connectPalette';
import { MOTION } from '../../../theme/motion';
import { RADIUS, SHADOWS } from '../../../theme/theme';

function ActionCountButton({ children, onPress }) {
    const scale = useRef(new Animated.Value(1)).current;

    return (
        <Animated.View style={{ transform: [{ scale }] }}>
            <TouchableOpacity
                style={styles.actionButton}
                onPress={onPress}
                activeOpacity={0.88}
                onPressIn={() => {
                    Animated.timing(scale, {
                        toValue: 0.96,
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
    vouched,
    isLiked,
    isBounty,
    onToggleLike,
    onToggleComment,
    onToggleVouch,
}) {
    const handleLike = useCallback(() => {
        onToggleLike(postId);
    }, [onToggleLike, postId]);

    const handleComment = useCallback(() => {
        onToggleComment(postId);
    }, [onToggleComment, postId]);

    const handleVouch = useCallback(() => {
        onToggleVouch(postId);
    }, [onToggleVouch, postId]);

    return (
        <View style={[styles.container, isBounty && styles.containerBounty]}>
            <ActionCountButton onPress={handleLike}>
                <Text style={[styles.actionText, isLiked && styles.actionTextLiked, isBounty && styles.actionTextBounty]}>
                    {'👍 '}
                    {likeCount}
                </Text>
            </ActionCountButton>

            <ActionCountButton onPress={handleComment}>
                <Text style={[styles.actionText, isBounty && styles.actionTextBounty]}>
                    {'💬 '}
                    {commentCount}
                </Text>
            </ActionCountButton>

            <TouchableOpacity
                style={[
                    styles.vouchButton,
                    vouched && styles.vouchButtonActive,
                    isBounty && !vouched && styles.vouchButtonBounty,
                ]}
                onPress={handleVouch}
                activeOpacity={0.85}
            >
                {vouched ? <IconCheck size={14} color={connectPalette.surface} /> : null}
                <Text
                    style={[
                        styles.vouchText,
                        vouched && styles.vouchTextActive,
                        isBounty && !vouched && styles.vouchTextBounty,
                    ]}
                >
                    {isBounty ? 'REFER & EARN' : (vouched ? 'VOUCHED' : 'VOUCH')}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

export default memo(FeedActionsBarComponent);

const styles = StyleSheet.create({
    container: {
        marginTop: 4,
        borderTopWidth: 1,
        borderTopColor: connectPalette.line,
        paddingTop: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    containerBounty: {
        borderTopColor: 'rgba(255,255,255,0.2)',
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: RADIUS.md,
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    actionText: {
        color: connectPalette.muted,
        fontSize: 12,
        fontWeight: '800',
    },
    actionTextLiked: {
        color: connectPalette.accent,
    },
    actionTextBounty: {
        color: connectPalette.surface,
    },
    vouchButton: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderWidth: 1,
        borderColor: 'transparent',
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: '#f5f6fb',
        ...SHADOWS.sm,
    },
    vouchButtonActive: {
        borderColor: connectPalette.accent,
        backgroundColor: connectPalette.accent,
    },
    vouchButtonBounty: {
        borderColor: connectPalette.surface,
        backgroundColor: 'rgba(255,255,255,0.12)',
    },
    vouchText: {
        color: connectPalette.accentDark,
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.4,
    },
    vouchTextActive: {
        color: connectPalette.surface,
    },
    vouchTextBounty: {
        color: connectPalette.surface,
    },
});
