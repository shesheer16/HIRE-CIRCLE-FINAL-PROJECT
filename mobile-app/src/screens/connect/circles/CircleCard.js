import React, { memo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { IconUsers } from '../../../components/Icons';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

function CircleCardComponent({ variant, circle, onOpenCircle, onJoinCircle }) {
    const handleOpen = useCallback(() => {
        onOpenCircle(circle);
    }, [onOpenCircle, circle]);

    const handleJoin = useCallback(() => {
        if (typeof onJoinCircle === 'function') {
            onJoinCircle(circle._id);
        }
    }, [onJoinCircle, circle?._id]);

    if (variant === 'joined') {
        return (
            <View style={styles.joinedCard}>
                <View style={styles.joinedLeft}>
                    <View style={styles.relativeAvatar}>
                        <Image source={{ uri: `https://ui-avatars.com/api/?name=${circle.name}&background=8b3dff&color=fff&rounded=true` }} style={styles.joinedAvatar} />
                        <View style={styles.onlineDot} />
                    </View>
                    <View>
                        <Text style={styles.joinedTitle}>{circle.name}</Text>
                        <Text style={styles.joinedMeta}>{circle.members} MEMBERS</Text>
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
                <Image source={{ uri: `https://ui-avatars.com/api/?name=${circle.name}&background=8b3dff&color=fff&rounded=true` }} style={styles.exploreAvatar} />
                <View style={styles.exploreMain}>
                    <View style={styles.exploreHeaderRow}>
                        <View>
                            <Text style={styles.exploreTitle}>{circle.name}</Text>
                            <Text style={styles.exploreCategory}>{circle.category}</Text>
                            {Number(circle?.members || 0) >= 200 ? (
                                <View style={styles.trendingBadge}>
                                    <Text style={styles.trendingBadgeText}>TRENDING CIRCLE</Text>
                                </View>
                            ) : null}
                        </View>
                        <TouchableOpacity style={styles.joinBtn} onPress={handleJoin}>
                            <Text style={styles.joinBtnText}>JOIN</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.exploreDescription}>{circle.desc}</Text>
                </View>
            </View>
            <View style={styles.exploreBottom}>
                <View style={styles.exploreAvatarGroup}>
                    <View style={styles.miniAvatar}><Text style={styles.miniAvatarText}>A</Text></View>
                    <View style={[styles.miniAvatar, styles.miniAvatarShiftOne]}><Text style={styles.miniAvatarText}>B</Text></View>
                    <View style={[styles.miniAvatar, styles.miniAvatarShiftTwo]}><Text style={styles.miniAvatarText}>C</Text></View>
                </View>
                <Text style={styles.exploreOnline}>+{circle.online} Online Now</Text>
                <View style={styles.exploreTopicWrap}>
                    <Text style={styles.exploreTopic}>🔥 {circle.topics?.[0]}</Text>
                </View>
            </View>
        </View>
    );
}

export default memo(CircleCardComponent);

const styles = StyleSheet.create({
    joinedCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.xl,
        padding: 16,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: connectPalette.line,
        ...connectShadow,
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
        width: 48,
        height: 48,
        borderRadius: RADIUS.full,
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
        backgroundColor: connectPalette.accentSoft,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: RADIUS.md,
    },
    openBtnText: {
        fontSize: 11,
        fontWeight: '800',
        color: connectPalette.accentDark,
    },

    exploreCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.xl,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: connectPalette.line,
        overflow: 'hidden',
        ...connectShadow,
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
        width: 56,
        height: 56,
        borderRadius: RADIUS.lg,
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
        color: connectPalette.muted,
        backgroundColor: '#f2f4f8',
        alignSelf: 'flex-start',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: RADIUS.sm,
        marginTop: 4,
    },
    trendingBadge: {
        alignSelf: 'flex-start',
        marginTop: 4,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fee2e2',
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
        backgroundColor: connectPalette.dark,
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: RADIUS.sm,
    },
    joinBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
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
        borderTopColor: connectPalette.line,
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
        backgroundColor: '#edf0f8',
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
