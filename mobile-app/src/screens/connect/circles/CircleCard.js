import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { IconUsers } from '../../../components/Icons';
import { RADIUS } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

function CircleCardComponent({ variant, circle, onOpenCircle, onJoinCircle, pendingJoinCircleIds }) {
    const safeCircle = (circle && typeof circle === 'object') ? circle : {};
    const circleId = String(safeCircle?._id || '').trim();
    const circleName = String(safeCircle?.name || 'Community').trim() || 'Community';
    const circleCategory = String(safeCircle?.category || 'Community').trim() || 'Community';
    const circleDescription = String(safeCircle?.desc || '').trim() || 'Join this circle to connect nearby.';
    const circleMembers = String(safeCircle?.members || '0').trim() || '0';
    const circleOnline = String(safeCircle?.online || '0').trim() || '0';
    const primaryTopic = String(safeCircle?.topics?.[0] || 'Updates').trim() || 'Updates';
    const circlePrivacy = String(safeCircle?.privacy || 'public').trim().toLowerCase();
    const safePendingJoinCircleIds = pendingJoinCircleIds instanceof Set ? pendingJoinCircleIds : new Set();
    const isJoinPending = circleId ? safePendingJoinCircleIds.has(circleId) : false;

    const handleOpen = useCallback(() => {
        if (typeof onOpenCircle === 'function') {
            onOpenCircle(safeCircle);
        }
    }, [onOpenCircle, safeCircle]);

    const handleJoin = useCallback(() => {
        if (isJoinPending) return;
        if (typeof onJoinCircle === 'function' && circleId) {
            onJoinCircle(circleId);
        }
    }, [isJoinPending, onJoinCircle, circleId]);

    if (variant === 'joined') {
        return (
            <View style={styles.joinedCard}>
                <View style={styles.joinedLeft}>
                    <View style={styles.relativeAvatar}>
                        <Image source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(circleName)}&background=8b3dff&color=fff&rounded=true` }} style={styles.joinedAvatar} />
                        <View style={styles.onlineDot} />
                    </View>
                    <View>
                        <Text style={styles.joinedTitle}>{circleName}</Text>
                        <Text style={styles.joinedMeta}>{circleMembers} MEMBERS</Text>
                    </View>
                </View>
                <TouchableOpacity style={styles.openBtn} onPress={handleOpen}>
                    <Text style={styles.openBtnText}>OPEN</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.exploreCard}>
            <IconUsers size={96} color={connectPalette.text} style={styles.exploreBgIcon} />
            <View style={styles.exploreTop}>
                <Image source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(circleName)}&background=8b3dff&color=fff&rounded=true` }} style={styles.exploreAvatar} />
                <View style={styles.exploreMain}>
                    <View style={styles.exploreHeaderRow}>
                        <View>
                            <Text style={styles.exploreTitle}>{circleName}</Text>
                            <Text style={styles.exploreCategory}>{circleCategory}</Text>
                            {Number(safeCircle?.members || 0) >= 200 ? (
                                <View style={styles.trendingBadge}>
                                    <Text style={styles.trendingBadgeText}>TRENDING CIRCLE</Text>
                                </View>
                            ) : null}
                        </View>
                        <TouchableOpacity
                            style={[styles.joinBtn, isJoinPending && styles.joinBtnPending]}
                            onPress={handleJoin}
                            disabled={isJoinPending}
                        >
                            <Text style={[styles.joinBtnText, isJoinPending && styles.joinBtnTextPending]}>
                                {isJoinPending ? 'REQUESTED' : (circlePrivacy === 'public' ? 'JOIN' : 'REQUEST')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.exploreDescription}>{circleDescription}</Text>
                </View>
            </View>
            <View style={styles.exploreBottom}>
                <View style={styles.exploreAvatarGroup}>
                    <View style={styles.miniAvatar}><Text style={styles.miniAvatarText}>A</Text></View>
                    <View style={[styles.miniAvatar, styles.miniAvatarShiftOne]}><Text style={styles.miniAvatarText}>B</Text></View>
                    <View style={[styles.miniAvatar, styles.miniAvatarShiftTwo]}><Text style={styles.miniAvatarText}>C</Text></View>
                </View>
                <Text style={styles.exploreOnline}>+{circleOnline} Online Now</Text>
                <View style={styles.exploreTopicWrap}>
                    <Text style={styles.exploreTopic}>🔥 {primaryTopic}</Text>
                </View>
            </View>
        </View>
    );
}

export default memo(CircleCardComponent);

const styles = StyleSheet.create({
    joinedCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: 20,
        padding: 14,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: '#efe9f8',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    joinedLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    relativeAvatar: {
        position: 'relative',
    },
    joinedAvatar: {
        width: 44,
        height: 44,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#e6def8',
    },
    onlineDot: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 12,
        height: 12,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.success,
        borderWidth: 2,
        borderColor: connectPalette.surface,
    },
    joinedTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
        marginBottom: 2,
    },
    joinedMeta: {
        fontSize: 10,
        fontWeight: '800',
        color: connectPalette.muted,
    },
    openBtn: {
        backgroundColor: '#f7f3fc',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    openBtnText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6a41d8',
    },

    exploreCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: 20,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#efe9f8',
        overflow: 'hidden',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    exploreBgIcon: {
        position: 'absolute',
        top: 16,
        right: 16,
        opacity: 0.03,
    },
    exploreTop: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 16,
    },
    exploreAvatar: {
        width: 52,
        height: 52,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#e6def8',
    },
    exploreMain: {
        flex: 1,
    },
    exploreHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    exploreTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
    },
    exploreCategory: {
        fontSize: 10,
        fontWeight: '800',
        color: '#6d7487',
        backgroundColor: '#f8f6fb',
        borderWidth: 1,
        borderColor: '#ebe3f8',
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
        marginTop: 4,
    },
    trendingBadge: {
        alignSelf: 'flex-start',
        marginTop: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#f7d6db',
        backgroundColor: '#fff4f5',
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    trendingBadgeText: {
        color: '#b91c1c',
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.3,
    },
    joinBtn: {
        backgroundColor: '#6f4cf6',
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 999,
    },
    joinBtnPending: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    joinBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    joinBtnTextPending: {
        color: '#6a41d8',
    },
    exploreDescription: {
        fontSize: 12,
        color: connectPalette.muted,
        lineHeight: 18,
    },
    exploreBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f0e8f8',
        paddingTop: 12,
    },
    exploreAvatarGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    miniAvatar: {
        width: 24,
        height: 24,
        borderRadius: RADIUS.full,
        backgroundColor: '#f3eef8',
        borderWidth: 2,
        borderColor: connectPalette.surface,
        justifyContent: 'center',
        alignItems: 'center',
    },
    miniAvatarShiftOne: {
        marginLeft: -8,
        zIndex: -1,
    },
    miniAvatarShiftTwo: {
        marginLeft: -8,
        zIndex: -2,
    },
    miniAvatarText: {
        fontSize: 10,
        color: connectPalette.muted,
        fontWeight: '700',
    },
    exploreOnline: {
        fontSize: 10,
        fontWeight: '800',
        color: connectPalette.muted,
    },
    exploreTopicWrap: {
        flex: 1,
        alignItems: 'flex-end',
    },
    exploreTopic: {
        fontSize: 10,
        fontWeight: '800',
        color: connectPalette.accentDark,
        backgroundColor: connectPalette.accentSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.md,
    },
});
