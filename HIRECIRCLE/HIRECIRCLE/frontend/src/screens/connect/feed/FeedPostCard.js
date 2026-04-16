import React, { memo, useCallback, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { IconCheck } from '../../../components/Icons';
import FeedActionsBar from './FeedActionsBar';
import VoicePost from './VoicePost';
import GalleryPost from './GalleryPost';
import VideoPost from './VideoPost';
import BountyPost from './BountyPost';
import { RADIUS, SCREEN_CHROME, SPACING } from '../../../theme/theme';

function FeedPostCardComponent({
    post,
    isLiked,
    isSaved,
    likeCount,
    commentList,
    onToggleLike,
    onLikeFromGesture,
    onToggleSave,
    onToggleComment,
    onToggleVouch,
    onReport,
    onOpenAuthorProfile,
}) {
    const safePost = (post && typeof post === 'object') ? post : {};
    const safePostId = String(safePost?._id || '').trim();
    const isBounty = safePost?.type === 'bounty';
    const commentsCount = (Array.isArray(commentList) ? commentList.length : 0) + Number(safePost?.comments || 0);
    const vouchCount = Number(safePost?.vouchCount || 0);
    const totalEngagement = Number(likeCount || 0) + commentsCount + vouchCount;
    const calculatedViews = Number(
        safePost?.viewCount
        ?? safePost?.views
        ?? safePost?.impressions
        ?? (totalEngagement * 12 + 64)
    );
    const viewCount = Number.isFinite(calculatedViews) ? Math.max(0, Math.round(calculatedViews)) : 0;
    const authorName = String(safePost?.author || 'Member').trim() || 'Member';
    const roleLabel = String(safePost?.role || 'Member').trim();
    const timeLabel = String(safePost?.time || '').trim();
    const avatarUri = String(safePost?.avatar || '').trim()
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=d1d5db&color=111111&rounded=true`;

    const handleOpenAuthorProfile = useCallback(() => {
        onOpenAuthorProfile?.(safePost);
    }, [onOpenAuthorProfile, safePost]);
    const lastTapAtRef = useRef(0);

    const handleContentTapLike = useCallback(() => {
        if (!safePostId) return;
        const now = Date.now();
        const isDoubleTap = (now - lastTapAtRef.current) < 280;
        lastTapAtRef.current = now;
        onLikeFromGesture?.(safePostId, {
            forceLike: true,
            source: isDoubleTap ? 'double_tap' : 'single_tap',
        });
    }, [onLikeFromGesture, safePostId]);

    const postTypeBody = useMemo(() => {
        if (safePost?.type === 'voice') {
            return <VoicePost duration={safePost.duration} mediaUrl={safePost.mediaUrl} />;
        }
        if (safePost?.type === 'gallery') {
            return <GalleryPost post={safePost} />;
        }
        if (safePost?.type === 'video') {
            return <VideoPost mediaUrl={safePost.mediaUrl} />;
        }
        if (safePost?.type === 'bounty') {
            return <BountyPost reward={safePost.reward} />;
        }
        return null;
    }, [safePost]);
    const hasMediaBody = Boolean(postTypeBody);

    return (
        <View style={styles.card}>
            <View style={styles.headerRow}>
                <TouchableOpacity
                    style={styles.headerProfileButton}
                    activeOpacity={0.82}
                    onPress={handleOpenAuthorProfile}
                >
                    <Image source={{ uri: avatarUri }} style={styles.avatar} />
                    <View style={styles.headerTextBlock}>
                        <View style={styles.authorRow}>
                            <Text style={styles.author}>{authorName}</Text>
                            {safePost.karma > 1000 ? (
                                <View style={styles.verifiedWrap}>
                                    <IconCheck size={11} color="#6a41d8" />
                                </View>
                            ) : null}
                            {isBounty ? (
                                <View style={styles.postTypeBadge}>
                                    <Text style={styles.postTypeBadgeText}>Bounty</Text>
                                </View>
                            ) : null}
                        </View>
                        <View style={styles.metaRail}>
                            {roleLabel ? (
                                <View style={styles.metaChip}>
                                    <Text style={styles.metaChipText} numberOfLines={1}>{roleLabel}</Text>
                                </View>
                            ) : null}
                            {timeLabel ? (
                                <View style={styles.metaChipMuted}>
                                    <Text style={styles.metaChipTextMuted}>{timeLabel}</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.moreButton}
                    activeOpacity={0.8}
                    onPress={() => onReport?.(safePost)}
                >
                    <Ionicons name="ellipsis-horizontal" size={16} color="#5f6274" />
                </TouchableOpacity>
            </View>

            {!hasMediaBody && safePost.text ? (
                <TouchableOpacity
                    activeOpacity={0.96}
                    onPress={handleContentTapLike}
                    disabled={!safePostId}
                >
                    <Text style={styles.captionText}>
                        <Text style={styles.captionAuthor}>{authorName}</Text>
                        {' '}
                        {safePost.text}
                    </Text>
                </TouchableOpacity>
            ) : null}

            {hasMediaBody ? (
                <TouchableOpacity
                    style={styles.mediaWrapper}
                    activeOpacity={0.96}
                    onPress={handleContentTapLike}
                    disabled={!safePostId}
                >
                    {postTypeBody}
                </TouchableOpacity>
            ) : null}

            <View style={styles.actionsDivider} />
            <FeedActionsBar
                postId={safePostId}
                likeCount={likeCount}
                commentCount={commentsCount}
                vouchCount={vouchCount}
                viewCount={viewCount}
                vouched={Boolean(safePost.vouched)}
                isLiked={isLiked}
                isSaved={isSaved}
                isBounty={isBounty}
                isJobPost={Boolean(safePost.isJobPost)}
                post={safePost}
                onToggleLike={onToggleLike}
                onToggleSave={onToggleSave}
                onToggleComment={onToggleComment}
                onToggleVouch={onToggleVouch}
            />

            {hasMediaBody && safePost.text ? (
                <TouchableOpacity
                    activeOpacity={0.96}
                    onPress={handleContentTapLike}
                    disabled={!safePostId}
                >
                    <Text style={[styles.captionText, styles.captionAfterMedia]}>
                        <Text style={styles.captionAuthor}>{authorName}</Text>
                        {' '}
                        {safePost.text}
                    </Text>
                </TouchableOpacity>
            ) : null}
        </View>
    );
}

export default memo(FeedPostCardComponent);

const styles = StyleSheet.create({
    card: {
        ...SCREEN_CHROME.contentCard,
        borderRadius: 20,
        paddingHorizontal: SPACING.md,
        paddingTop: 16,
        paddingBottom: 14,
        marginHorizontal: 10,
        marginBottom: 16,
        shadowColor: '#475569',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.05,
        shadowRadius: 16,
        elevation: 3,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerProfileButton: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#e7def8',
        marginRight: 12,
        backgroundColor: '#f2ecff',
    },
    headerTextBlock: {
        flex: 1,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    author: {
        color: '#0f172a',
        fontSize: 15,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    verifiedWrap: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#f3ecff',
        borderWidth: 1,
        borderColor: '#e6dafd',
        alignItems: 'center',
        justifyContent: 'center',
    },
    meta: {
        marginTop: 2,
        color: '#64748b',
        fontSize: 12,
        fontWeight: '600',
    },
    metaRail: {
        marginTop: 6,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    metaChip: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    metaChipMuted: {
        ...SCREEN_CHROME.signalChip,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: '#fbfcfe',
    },
    metaChipText: {
        color: '#6a41d8',
        fontSize: 10.5,
        fontWeight: '800',
    },
    metaChipTextMuted: {
        color: '#8b92a6',
        fontSize: 10.5,
        fontWeight: '700',
    },
    postTypeBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        borderRadius: RADIUS.full,
        paddingHorizontal: 7,
        paddingVertical: 3,
    },
    postTypeBadgeText: {
        color: '#6a41d8',
        fontSize: 10,
        fontWeight: '800',
    },
    moreButton: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: '#efe8f9',
        backgroundColor: '#fcfbff',
    },
    captionText: {
        marginTop: 14,
        color: '#1e293b',
        fontSize: 14,
        lineHeight: 22,
        fontWeight: '400',
    },
    captionAfterMedia: {
        marginTop: 12,
    },
    mediaWrapper: {
        marginTop: 14,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: '#f6f3fb',
    },
    captionAuthor: {
        fontWeight: '800',
        color: '#0f172a',
    },
    actionsDivider: {
        height: 1,
        backgroundColor: '#f1f5f9',
        marginTop: 16,
        marginBottom: 8,
    },
});
