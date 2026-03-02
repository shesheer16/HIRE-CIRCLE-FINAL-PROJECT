import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, Image, TextInput, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconAward, IconCheck, IconSend } from '../../../components/Icons';
import FeedActionsBar from './FeedActionsBar';
import VoicePost from './VoicePost';
import GalleryPost from './GalleryPost';
import BountyPost from './BountyPost';
import { RADIUS, SHADOWS, SPACING } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

function FeedPostCardComponent({
    post,
    isLiked,
    likeCount,
    commentList,
    isCommentOpen,
    commentInputValue,
    currentUserAvatar,
    onToggleLike,
    onToggleComment,
    onToggleVouch,
    onCommentInputChange,
    onSubmitComment,
    onReport,
}) {
    const isBounty = post?.type === 'bounty';
    const commentsCount = (Array.isArray(commentList) ? commentList.length : 0) + Number(post?.comments || 0);
    const vouchCount = Number(post?.vouchCount || 0);
    const totalEngagement = Number(likeCount || 0) + commentsCount + vouchCount;
    const isTrending = Boolean(post?.trending) || totalEngagement >= 12;

    const handleCommentChange = useCallback((text) => {
        onCommentInputChange(post._id, text);
    }, [onCommentInputChange, post?._id]);

    const handleSubmitComment = useCallback(() => {
        onSubmitComment(post._id);
    }, [onSubmitComment, post?._id]);

    const postTypeBody = useMemo(() => {
        if (post?.type === 'voice') {
            return <VoicePost duration={post.duration} />;
        }
        if (post?.type === 'gallery') {
            return <GalleryPost post={post} />;
        }
        if (post?.type === 'bounty') {
            return <BountyPost reward={post.reward} />;
        }
        return null;
    }, [post]);

    return (
        <View style={[styles.card, isBounty && styles.bountyCard]}>
            {isBounty ? (
                <>
                    <LinearGradient
                        colors={[connectPalette.accent, connectPalette.accentDark]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={StyleSheet.absoluteFillObject}
                    />
                    <View style={styles.bountyAwardBg}>
                        <IconAward size={64} color="rgba(255,255,255,0.1)" />
                    </View>
                </>
            ) : null}

            <View style={styles.headerRow}>
                <Image source={{ uri: post.avatar }} style={styles.avatar} />
                <View style={styles.headerTextBlock}>
                    <View style={styles.authorRow}>
                        <Text style={[styles.author, isBounty && styles.authorBounty]}>{post.author}</Text>
                        {(post.karma > 1000 || isBounty) ? (
                            <IconCheck size={14} color={isBounty ? connectPalette.surface : connectPalette.accent} />
                        ) : null}
                        {isTrending ? (
                            <View style={styles.trendingBadge}>
                                <Text style={styles.trendingBadgeText}>Trending</Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={[styles.meta, isBounty && styles.metaBounty]}>
                        {String(post.role || 'Member').toUpperCase()}
                        {' • '}
                        {String(post.time || 'Just now').toUpperCase()}
                    </Text>
                </View>
                <TouchableOpacity
                    style={styles.reportPostBtn}
                    activeOpacity={0.8}
                    onPress={() => onReport?.(post)}
                >
                    <Text style={styles.reportPostBtnText}>Report</Text>
                </TouchableOpacity>
                <View style={styles.karmaBadge}>
                    <Text style={styles.karmaBadgeText}>+{post.karma || 0} KARMA</Text>
                </View>
            </View>

            <Text style={[styles.bodyText, isBounty && styles.bodyTextBounty]}>{post.text}</Text>

            <View style={[styles.engagementRow, isBounty && styles.engagementRowBounty]}>
                <Text style={[styles.engagementText, isBounty && styles.engagementTextBounty]}>
                    {totalEngagement} live interactions
                </Text>
                <Text style={[styles.engagementDot, isBounty && styles.engagementDotBounty]}>•</Text>
                <Text style={[styles.engagementText, isBounty && styles.engagementTextBounty]}>
                    {vouchCount} vouches
                </Text>
            </View>

            {postTypeBody}

            <FeedActionsBar
                postId={post._id}
                likeCount={likeCount}
                commentCount={commentsCount}
                vouched={Boolean(post.vouched)}
                isLiked={isLiked}
                isBounty={isBounty}
                onToggleLike={onToggleLike}
                onToggleComment={onToggleComment}
                onToggleVouch={onToggleVouch}
            />

            {isCommentOpen ? (
                <View style={styles.commentSection}>
                    {(commentList || []).map((comment, index) => (
                        <View key={`${post._id}-comment-${index}`} style={styles.commentRow}>
                            <Image source={{ uri: currentUserAvatar }} style={styles.commentAvatar} />
                            <View style={styles.commentBubble}>
                                <Text style={styles.commentBubbleText}>{comment}</Text>
                            </View>
                        </View>
                    ))}

                    <View style={styles.commentInputRow}>
                        <Image source={{ uri: currentUserAvatar }} style={styles.commentAvatar} />
                        <TextInput
                            style={styles.commentInput}
                            value={commentInputValue}
                            onChangeText={handleCommentChange}
                            onSubmitEditing={handleSubmitComment}
                            placeholder="Add a comment..."
                            placeholderTextColor={connectPalette.subtle}
                            returnKeyType="send"
                        />
                        <TouchableOpacity style={styles.commentSendButton} onPress={handleSubmitComment} activeOpacity={0.85}>
                            <IconSend size={14} color={connectPalette.surface} />
                        </TouchableOpacity>
                    </View>
                </View>
            ) : null}
        </View>
    );
}

export default memo(FeedPostCardComponent);

const styles = StyleSheet.create({
    card: {
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
        padding: SPACING.md,
        marginBottom: SPACING.smd,
        ...SHADOWS.md,
        overflow: 'hidden',
    },
    bountyCard: {
        backgroundColor: connectPalette.accent,
        borderColor: connectPalette.accentDark,
    },
    bountyAwardBg: {
        position: 'absolute',
        top: -10,
        right: -10,
        opacity: 0.2,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#dbe7ff',
        marginRight: 10,
    },
    headerTextBlock: {
        flex: 1,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginBottom: 2,
    },
    trendingBadge: {
        borderRadius: RADIUS.full,
        backgroundColor: '#fee2e2',
        borderWidth: 1,
        borderColor: '#fecaca',
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    trendingBadgeText: {
        color: '#b91c1c',
        fontSize: 9,
        fontWeight: '900',
        letterSpacing: 0.2,
    },
    author: {
        color: connectPalette.text,
        fontSize: 14,
        fontWeight: '800',
    },
    authorBounty: {
        color: connectPalette.surface,
    },
    meta: {
        color: connectPalette.subtle,
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    metaBounty: {
        color: 'rgba(255,255,255,0.72)',
    },
    karmaBadge: {
        borderRadius: RADIUS.full,
        backgroundColor: '#f1f6ff',
        borderWidth: 1,
        borderColor: '#dce9ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginLeft: 8,
    },
    reportPostBtn: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#e6ecf7',
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: '#fbfcff',
    },
    reportPostBtnText: {
        fontSize: 10,
        fontWeight: '700',
        color: connectPalette.subtle,
    },
    karmaBadgeText: {
        color: connectPalette.accentDark,
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.2,
    },
    bodyText: {
        marginTop: 12,
        color: connectPalette.text,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
    },
    bodyTextBounty: {
        color: 'rgba(255,255,255,0.92)',
    },
    engagementRow: {
        marginTop: 8,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    engagementRowBounty: {
        opacity: 0.9,
    },
    engagementText: {
        color: '#475569',
        fontSize: 11,
        fontWeight: '700',
    },
    engagementTextBounty: {
        color: 'rgba(255,255,255,0.86)',
    },
    engagementDot: {
        color: '#94a3b8',
        fontSize: 10,
        fontWeight: '700',
    },
    engagementDotBounty: {
        color: 'rgba(255,255,255,0.6)',
    },
    commentSection: {
        marginTop: SPACING.smd,
        borderTopWidth: 1,
        borderTopColor: connectPalette.line,
        paddingTop: SPACING.smd,
        gap: SPACING.sm,
    },
    commentRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },
    commentAvatar: {
        width: 24,
        height: 24,
        borderRadius: RADIUS.full,
    },
    commentBubble: {
        flex: 1,
        borderRadius: RADIUS.md,
        backgroundColor: '#f8fbff',
        borderWidth: 1,
        borderColor: '#e8eef8',
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    commentBubbleText: {
        color: connectPalette.text,
        fontSize: 12,
        lineHeight: 16,
    },
    commentInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    commentInput: {
        flex: 1,
        minHeight: 36,
        borderRadius: RADIUS.full,
        backgroundColor: '#f5f8ff',
        borderWidth: 1,
        borderColor: '#dce8ff',
        paddingHorizontal: 12,
        color: connectPalette.text,
        fontSize: 12,
    },
    commentSendButton: {
        width: 32,
        height: 32,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.accent,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
