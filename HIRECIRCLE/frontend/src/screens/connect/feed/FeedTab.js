import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, FlatList, ActivityIndicator, StyleSheet, Modal, Text, TouchableOpacity, ScrollView, TextInput, Image, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FeedComposer from './FeedComposer';
import FeedPostCard from './FeedPostCard';
import { IconSend } from '../../../components/Icons';
import ConnectEmptyStateCard from '../ConnectEmptyState';
import Chip from '../../../components/Chip';

const makeAvatarFromName = (name = 'Member') => (
    `https://ui-avatars.com/api/?name=${encodeURIComponent(String(name || 'Member'))}&background=d1d5db&color=111111&rounded=true`
);

const normalizeCommentEntries = (entries = []) => (
    (Array.isArray(entries) ? entries : [])
        .map((entry, index) => {
            if (typeof entry === 'string') {
                const text = String(entry || '').trim();
                if (!text) return null;
                return {
                    id: `comment-${index}`,
                    text,
                    author: 'Member',
                    time: '',
                };
            }
            if (!entry || typeof entry !== 'object') return null;
            const text = String(entry?.text || '').trim();
            if (!text) return null;
            const author = String(
                entry?.author
                || entry?.user?.name
                || entry?.authorName
                || 'Member'
            ).trim() || 'Member';
            const time = String(entry?.time || '').trim();
            return {
                id: String(entry?._id || entry?.id || `comment-${index}`),
                text,
                author,
                time,
            };
        })
        .filter(Boolean)
);

const formatPreviewDate = (value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    try {
        return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch (_error) {
        return parsed.toDateString().slice(4, 10);
    }
};

const derivePreviewStatus = (preview) => {
    if (!preview || typeof preview !== 'object') return { label: 'Open', closed: false };
    const status = String(preview.status || '').trim().toLowerCase();
    const isClosed = preview.isOpen === false || ['closed', 'expired', 'inactive', 'filled', 'paused'].includes(status);
    return {
        label: isClosed ? 'Closed' : 'Open',
        closed: isClosed,
    };
};

function FeedMark() {
    return (
        <View style={styles.feedMark}>
            <View style={styles.feedMarkOuter} />
            <View style={styles.feedMarkMiddle} />
            <View style={styles.feedMarkInner} />
        </View>
    );
}

function FeedSkeletonCard({ includeMedia = false }) {
    return (
        <View style={styles.skeletonCard}>
            <View style={styles.skeletonHeader}>
                <View style={styles.skeletonAvatar} />
                <View style={styles.skeletonHeaderText}>
                    <View style={[styles.skeletonLine, styles.skeletonLinePrimary]} />
                    <View style={[styles.skeletonLine, styles.skeletonLineSecondary]} />
                </View>
            </View>
            <View style={[styles.skeletonLine, styles.skeletonLineBodyLong]} />
            <View style={[styles.skeletonLine, styles.skeletonLineBodyShort]} />
            {includeMedia ? <View style={styles.skeletonMedia} /> : null}
            <View style={styles.skeletonActionsRow}>
                <View style={styles.skeletonActionChip} />
                <View style={styles.skeletonActionChip} />
                <View style={styles.skeletonActionChip} />
            </View>
        </View>
    );
}

function FeedLoadingState() {
    return (
        <View style={styles.loadingStateWrap}>
            <FeedSkeletonCard includeMedia />
            <FeedSkeletonCard />
        </View>
    );
}

function FeedEmptyStateCard({ onCreatePost }) {
    return (
        <ConnectEmptyStateCard
            title="Your feed is ready for the first post"
            subtitle="Share a quick update, voice note, or hiring need to start the conversation."
            actionLabel="Create first post"
            onAction={onCreatePost}
            style={styles.feedEmptyCard}
        />
    );
}

function FeedTabComponent({
    feedPosts,
    isEmployerRole,
    loadingFeed,
    feedPullRefreshing,
    loadingMoreFeed,
    feedError,
    composerOpen,
    composerMediaType,
    composerText,
    composerVisibility,
    composerMediaAssets,
    isVoiceRecording,
    postingFeed,
    likedPostIds,
    savedPostIds,
    likeCountMap,
    commentsByPostId,
    commentInputMap,
    currentUserId,
    currentUserAvatar,
    jobPreview,
    jobPreviewVisible,
    jobPreviewLoading,
    jobPreviewApplying,
    hasAppliedToPreviewJob,
    onRefreshFeed,
    onRetryFeed,
    onLoadMoreFeed,
    onMediaButtonClick,
    onInputAreaClick,
    onCancelComposer,
    onStopVoiceRecording,
    onRemoveComposerMedia,
    onPost,
    onComposerTextChange,
    onComposerVisibilityToggle,
    onComposerVisibilitySelect,
    onToggleLike,
    onToggleSavePost,
    onToggleVouch,
    onOpenComments,
    onCommentInputChange,
    onSubmitComment,
    onReportPost,
    onBlockUser,
    onDeletePost,
    onOpenAuthorProfile,
    onCloseJobPreview,
    onApplyJobPreview,
    onOpenPostJobForm,
    onFeedScrollDirection,
    onToggleSavedFilter,
    onSetVisibility,
    showSavedOnly,
    feedVisibility,
    showNewPostsToast,
    contentContainerStyle,
}) {
    const [commentModalPostId, setCommentModalPostId] = useState('');
    const [postActionPost, setPostActionPost] = useState(null);
    const [postActionBusy, setPostActionBusy] = useState(false);
    const lastScrollYRef = useRef(0);
    const lastScrollDirectionRef = useRef('up');

    const safeFeedPosts = useMemo(() => (
        Array.isArray(feedPosts)
            ? feedPosts.filter((post) => post && typeof post === 'object')
            : []
    ), [feedPosts]);
    const safeLikedPostIds = likedPostIds instanceof Set ? likedPostIds : new Set();
    const safeSavedPostIds = savedPostIds instanceof Set ? savedPostIds : new Set();
    const safeLikeCountMap = likeCountMap && typeof likeCountMap === 'object' ? likeCountMap : {};
    const safeCommentsByPostId = commentsByPostId && typeof commentsByPostId === 'object' ? commentsByPostId : {};
    const safeCommentInputMap = commentInputMap && typeof commentInputMap === 'object' ? commentInputMap : {};
    const activeCommentPost = useMemo(
        () => safeFeedPosts.find((post) => String(post?._id || '') === String(commentModalPostId || '')) || null,
        [commentModalPostId, safeFeedPosts]
    );
    const activeCommentPostKey = String(activeCommentPost?._id || '').trim();
    const activeCommentInputValue = activeCommentPostKey ? (safeCommentInputMap[activeCommentPostKey] || '') : '';
    const activeCommentList = useMemo(() => {
        const baseEntries = normalizeCommentEntries(activeCommentPost?.commentEntries || []);
        const runtimeEntries = normalizeCommentEntries(
            activeCommentPostKey ? safeCommentsByPostId[activeCommentPostKey] : []
        );
        if (!runtimeEntries.length) {
            return baseEntries;
        }
        const dedupe = new Set();
        const merged = [...baseEntries, ...runtimeEntries].filter((entry) => {
            const key = `${String(entry?.id || '')}:${String(entry?.author || '')}:${String(entry?.text || '')}`;
            if (!key.trim()) return false;
            if (dedupe.has(key)) return false;
            dedupe.add(key);
            return true;
        });
        return merged;
    }, [activeCommentPost?.commentEntries, activeCommentPostKey, safeCommentsByPostId]);
    const safeCurrentUserAvatar = String(currentUserAvatar || '').trim() || makeAvatarFromName('You');
    const safeCurrentUserId = String(currentUserId || '').trim();
    const selectedPostId = String(postActionPost?._id || '').trim();
    const selectedPostAuthorId = String(
        postActionPost?.authorId?._id
        || postActionPost?.authorId
        || ''
    ).trim();
    const canDeleteSelectedPost = Boolean(
        selectedPostId
        && (selectedPostId.startsWith('local-') || (safeCurrentUserId && selectedPostAuthorId === safeCurrentUserId))
    );
    const previewStatus = useMemo(() => derivePreviewStatus(jobPreview), [jobPreview]);
    const previewPostedLabel = useMemo(() => {
        const formatted = formatPreviewDate(jobPreview?.createdAt);
        return formatted ? `Posted ${formatted}` : 'Posted recently';
    }, [jobPreview?.createdAt]);
    const visibilityOptions = ['community', 'public', 'connections', 'private'];

    const handleOpenCommentsModal = useCallback((postId) => {
        const normalizedId = String(postId || '').trim();
        if (!normalizedId) return;
        setCommentModalPostId(normalizedId);
        onOpenComments?.(normalizedId);
    }, [onOpenComments]);

    const handleFeedScroll = useCallback((event) => {
        const offsetY = Number(event?.nativeEvent?.contentOffset?.y || 0);
        const delta = offsetY - lastScrollYRef.current;
        if (offsetY <= 12) {
            lastScrollDirectionRef.current = 'up';
            onFeedScrollDirection?.('top', offsetY);
            lastScrollYRef.current = offsetY;
            return;
        }
        if (Math.abs(delta) < 4) return;
        const nextDirection = delta > 0 ? 'down' : 'up';
        if (nextDirection !== lastScrollDirectionRef.current) {
            lastScrollDirectionRef.current = nextDirection;
            onFeedScrollDirection?.(nextDirection, offsetY);
        }
        lastScrollYRef.current = offsetY;
    }, [onFeedScrollDirection]);

    const closeCommentsModal = useCallback(() => {
        setCommentModalPostId('');
    }, []);

    const openPostActions = useCallback((post) => {
        setPostActionPost((post && typeof post === 'object') ? post : null);
    }, []);

    const closePostActions = useCallback(() => {
        if (postActionBusy) return;
        setPostActionPost(null);
    }, [postActionBusy]);

    const submitReportReason = useCallback(async (reason) => {
        if (!postActionPost || postActionBusy) return;
        setPostActionBusy(true);
        const result = await onReportPost?.(postActionPost, reason);
        setPostActionBusy(false);
        setPostActionPost(null);
        if (result?.ok) {
            Alert.alert('Thanks', result?.queued ? 'Report queued and will sync shortly.' : 'Report submitted.');
            return;
        }
        Alert.alert('Report failed', result?.message || 'Could not submit report right now.');
    }, [onReportPost, postActionBusy, postActionPost]);

    const submitBlockUser = useCallback(async () => {
        if (!postActionPost || postActionBusy) return;
        const authorId = String(postActionPost?.authorId?._id || postActionPost?.authorId || postActionPost?.user?._id || '').trim();
        if (!authorId) return;
        setPostActionBusy(true);
        const result = await onBlockUser?.(authorId);
        setPostActionBusy(false);
        setPostActionPost(null);
        if (result?.ok) {
            Alert.alert('Blocked', `You will no longer see content from ${postActionPost?.author || 'this user'}.`);
            return;
        }
        Alert.alert('Block failed', result?.message || 'Could not block this user right now.');
    }, [onBlockUser, postActionBusy, postActionPost]);

    const submitDeletePost = useCallback(async () => {
        if (!postActionPost || postActionBusy || !canDeleteSelectedPost) return;
        setPostActionBusy(true);
        const result = await onDeletePost?.(postActionPost);
        setPostActionBusy(false);
        setPostActionPost(null);
        if (!result?.ok && result?.message) {
            Alert.alert('Delete failed', result.message);
        }
    }, [canDeleteSelectedPost, onDeletePost, postActionBusy, postActionPost]);

    const handleCommentComposerChange = useCallback((text) => {
        if (!activeCommentPostKey) return;
        onCommentInputChange(activeCommentPostKey, text);
    }, [activeCommentPostKey, onCommentInputChange]);

    const handleSubmitCommentFromModal = useCallback(() => {
        if (!activeCommentPostKey) return;
        onSubmitComment(activeCommentPostKey);
    }, [activeCommentPostKey, onSubmitComment]);

    useEffect(() => {
        if (!commentModalPostId) return;
        if (activeCommentPost) return;
        setCommentModalPostId('');
    }, [activeCommentPost, commentModalPostId]);

    const keyExtractor = useCallback((item, index) => String(item?._id || `post-${index}`), []);

    const renderPostItem = useCallback(({ item }) => {
        const safeItem = (item && typeof item === 'object') ? item : {};
        const postId = String(safeItem._id || '').trim();
        return (
            <FeedPostCard
                post={safeItem}
                isLiked={safeLikedPostIds.has(postId)}
                isSaved={safeSavedPostIds.has(postId)}
                likeCount={Number(safeLikeCountMap[postId] ?? safeItem.likes ?? 0)}
                commentList={safeCommentsByPostId[postId] || []}
                isCommentOpen={false}
                commentInputValue={safeCommentInputMap[postId] || ''}
                currentUserAvatar={currentUserAvatar}
                onToggleLike={onToggleLike}
                onLikeFromGesture={onToggleLike}
                onToggleSave={onToggleSavePost}
                onToggleComment={handleOpenCommentsModal}
                onToggleVouch={onToggleVouch}
                onCommentInputChange={onCommentInputChange}
                onSubmitComment={onSubmitComment}
                onReport={openPostActions}
                onOpenAuthorProfile={onOpenAuthorProfile}
            />
        );
    }, [
        safeLikedPostIds,
        safeSavedPostIds,
        safeLikeCountMap,
        safeCommentsByPostId,
        safeCommentInputMap,
        currentUserAvatar,
        onToggleLike,
        onToggleSavePost,
        handleOpenCommentsModal,
        onToggleVouch,
        onCommentInputChange,
        onSubmitComment,
        openPostActions,
        onOpenAuthorProfile,
    ]);


    const listFooter = useMemo(() => {
        if (loadingMoreFeed && safeFeedPosts.length >= 6) {
            return (
                <View style={styles.footerLoading}>
                    <ActivityIndicator color="#5b48f2" />
                    <Text style={styles.footerLoadingText}>Loading more posts…</Text>
                </View>
            );
        }
        return <View style={styles.footerSpacer} />;
    }, [loadingMoreFeed, safeFeedPosts.length]);

    const listHeader = useMemo(() => null, []);

    const listEmpty = useMemo(() => {
        if (loadingFeed && !feedPullRefreshing) {
            return <FeedLoadingState />;
        }
        if (feedError) {
            return (
                <ConnectEmptyStateCard
                    title="No posts to show yet"
                    subtitle="We couldn't refresh just now. Pull to refresh or try again."
                    actionLabel="Try again"
                    onAction={onRetryFeed || onRefreshFeed}
                    tone="info"
                    style={styles.feedEmptyCard}
                />
            );
        }
        return (
            <FeedEmptyStateCard onCreatePost={onInputAreaClick} />
        );
    }, [feedError, feedPullRefreshing, loadingFeed, onInputAreaClick, onRefreshFeed, onRetryFeed]);

    return (
        <View style={styles.container}>
            {showNewPostsToast ? (
                <View style={styles.statusBar}>
                    <Text style={styles.statusBarText}>{showNewPostsToast}</Text>
                </View>
            ) : null}
            <FeedComposer
                composerOpen={composerOpen}
                composerMediaType={composerMediaType}
                composerText={composerText}
                composerVisibility={composerVisibility}
                composerMediaAssets={composerMediaAssets}
                isVoiceRecording={isVoiceRecording}
                isPosting={postingFeed}
                currentUserAvatar={currentUserAvatar}
                onInputAreaClick={onInputAreaClick}
                onMediaButtonClick={onMediaButtonClick}
                onCancelComposer={onCancelComposer}
                onStopVoiceRecording={onStopVoiceRecording}
                onRemoveComposerMedia={onRemoveComposerMedia}
                onPost={onPost}
                onComposerTextChange={onComposerTextChange}
                onComposerVisibilityToggle={onComposerVisibilityToggle}
                onComposerVisibilitySelect={onComposerVisibilitySelect}
                isEmployerRole={isEmployerRole}
                onOpenPostJobForm={onOpenPostJobForm}
                showInline={false}
            />
            <FlatList
                data={safeFeedPosts}
                keyExtractor={keyExtractor}
                renderItem={renderPostItem}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.content, contentContainerStyle, safeFeedPosts.length === 0 && styles.contentEmpty]}
                refreshing={Boolean(feedPullRefreshing)}
                onRefresh={onRefreshFeed}
                onScroll={handleFeedScroll}
                scrollEventThrottle={16}
                onEndReached={onLoadMoreFeed}
                onEndReachedThreshold={0.3}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={listEmpty}
                ListFooterComponent={listFooter}
                removeClippedSubviews={Platform.OS === 'android'}
                windowSize={10}
                maxToRenderPerBatch={8}
                initialNumToRender={6}
            />

            <Modal
                visible={Boolean(postActionPost)}
                transparent
                animationType="fade"
                onRequestClose={closePostActions}
            >
                <TouchableOpacity style={styles.postActionOverlay} activeOpacity={1} onPress={closePostActions}>
                    <TouchableOpacity style={styles.postActionSheet} activeOpacity={1} onPress={() => {}}>
                        <View style={styles.postActionHandle} />
                        <Text style={styles.postActionTitle}>Post actions</Text>
                        <View style={styles.postActionPreview}>
                            <Image
                                source={{ uri: makeAvatarFromName(String(postActionPost?.author || 'Member')) }}
                                style={styles.postActionPreviewAvatar}
                            />
                            <View style={styles.postActionPreviewTextWrap}>
                                <Text style={styles.postActionPreviewAuthor}>{String(postActionPost?.author || 'Member')}</Text>
                                <Text style={styles.postActionSubtitle} numberOfLines={2}>
                                    {String(postActionPost?.text || '').trim() || 'Choose what you want to do with this post.'}
                                </Text>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={styles.postActionItem}
                            activeOpacity={0.85}
                            disabled={postActionBusy}
                            onPress={() => submitReportReason('spam')}
                        >
                            <View style={styles.postActionIconWrap}>
                                <Ionicons name="alert-circle-outline" size={17} color="#5f6274" />
                            </View>
                            <View style={styles.postActionTextWrap}>
                                <Text style={styles.postActionItemText}>Report as spam</Text>
                                <Text style={styles.postActionItemHelper}>Hide obvious junk or unsafe promotion.</Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.postActionItem}
                            activeOpacity={0.85}
                            disabled={postActionBusy}
                            onPress={() => submitReportReason('harassment')}
                        >
                            <View style={styles.postActionIconWrap}>
                                <Ionicons name="shield-outline" size={17} color="#5f6274" />
                            </View>
                            <View style={styles.postActionTextWrap}>
                                <Text style={styles.postActionItemText}>Report harassment</Text>
                                <Text style={styles.postActionItemHelper}>Flag abusive, threatening, or targeted content.</Text>
                            </View>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.postActionItem}
                            activeOpacity={0.85}
                            disabled={postActionBusy}
                            onPress={() => submitReportReason('misleading')}
                        >
                            <View style={styles.postActionIconWrap}>
                                <Ionicons name="warning-outline" size={17} color="#5f6274" />
                            </View>
                            <View style={styles.postActionTextWrap}>
                                <Text style={styles.postActionItemText}>Report misleading info</Text>
                                <Text style={styles.postActionItemHelper}>Flag claims that look false or manipulative.</Text>
                            </View>
                        </TouchableOpacity>

                        {(selectedPostAuthorId && selectedPostAuthorId !== safeCurrentUserId) ? (
                            <TouchableOpacity
                                style={styles.postActionItem}
                                activeOpacity={0.85}
                                disabled={postActionBusy}
                                onPress={submitBlockUser}
                            >
                                <View style={styles.postActionIconWrap}>
                                    <Ionicons name="ban-outline" size={17} color="#5f6274" />
                                </View>
                                <View style={styles.postActionTextWrap}>
                                    <Text style={styles.postActionItemText}>Block {postActionPost?.author || 'User'}</Text>
                                    <Text style={styles.postActionItemHelper}>Hide all current and future posts from this user.</Text>
                                </View>
                            </TouchableOpacity>
                        ) : null}

                        {canDeleteSelectedPost ? (
                            <TouchableOpacity
                                style={[styles.postActionItem, styles.postActionItemDanger]}
                                activeOpacity={0.85}
                                disabled={postActionBusy}
                                onPress={submitDeletePost}
                            >
                                <View style={[styles.postActionIconWrap, styles.postActionIconWrapDanger]}>
                                    <Ionicons name="trash-outline" size={17} color="#dc2626" />
                                </View>
                                <View style={styles.postActionTextWrap}>
                                    <Text style={styles.postActionItemDangerText}>Delete post</Text>
                                    <Text style={styles.postActionItemDangerHelper}>Remove it from your feed permanently.</Text>
                                </View>
                            </TouchableOpacity>
                        ) : null}

                        <TouchableOpacity
                            style={styles.postActionCancel}
                            activeOpacity={0.85}
                            disabled={postActionBusy}
                            onPress={closePostActions}
                        >
                            <Text style={styles.postActionCancelText}>{postActionBusy ? 'Working...' : 'Cancel'}</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <Modal
                visible={Boolean(commentModalPostId)}
                transparent
                animationType="slide"
                onRequestClose={closeCommentsModal}
            >
                <View style={styles.commentsOverlay}>
                    <View style={styles.commentsSheet}>
                        <View style={styles.commentsHandle} />

                        <View style={styles.commentsHeaderRow}>
                            <View style={styles.commentsHeaderTextWrap}>
                                <Text style={styles.commentsTitle}>Comments</Text>
                                <Text style={styles.commentsCountText}>
                                    {activeCommentList.length > 0 ? `${activeCommentList.length} replies` : 'Start the conversation'}
                                </Text>
                            </View>
                            <TouchableOpacity style={styles.commentsCloseBtn} onPress={closeCommentsModal} activeOpacity={0.85}>
                                <Text style={styles.commentsCloseText}>×</Text>
                            </TouchableOpacity>
                        </View>

                        {activeCommentPost ? (
                            <>
                                <View style={styles.commentsPostMeta}>
                                    <Image
                                        source={{ uri: makeAvatarFromName(String(activeCommentPost.author || 'Member')) }}
                                        style={styles.commentsPostAvatar}
                                    />
                                    <View style={styles.commentsPostTextWrap}>
                                        <Text style={styles.commentsPostAuthor}>{activeCommentPost.author || 'Member'}</Text>
                                        <Text style={styles.commentsPostText} numberOfLines={2}>
                                            {String(activeCommentPost.text || '').trim() || 'Post'}
                                        </Text>
                                    </View>
                                </View>

                                <ScrollView
                                    style={styles.commentsScroll}
                                    contentContainerStyle={styles.commentsScrollContent}
                                    showsVerticalScrollIndicator={false}
                                >
                                    {activeCommentList.length > 0 ? (
                                        activeCommentList.map((comment, index) => (
                                            <View key={String(comment?.id || `comment-row-${index}`)} style={styles.commentRow}>
                                                <Image
                                                    source={{ uri: makeAvatarFromName(String(comment?.author || 'Member')) }}
                                                    style={styles.commentAvatar}
                                                />
                                                <View style={styles.commentBubble}>
                                                    <View style={styles.commentHeaderRow}>
                                                        <Text style={styles.commentAuthor}>{String(comment?.author || 'Member')}</Text>
                                                        <Text style={styles.commentTime}>{String(comment?.time || 'Just now')}</Text>
                                                    </View>
                                                    <Text style={styles.commentText}>{String(comment?.text || '')}</Text>
                                                </View>
                                            </View>
                                        ))
                                    ) : (
                                        <View style={styles.commentsEmptyState}>
                                            <View style={styles.commentsEmptyOrb} />
                                            <Text style={styles.commentsEmptyTitle}>No comments yet</Text>
                                            <Text style={styles.commentsEmptyText}>Be the first to reply and start the conversation.</Text>
                                        </View>
                                    )}
                                </ScrollView>

                                <View style={styles.commentComposerRow}>
                                    <Image source={{ uri: safeCurrentUserAvatar }} style={styles.commentComposerAvatar} />
                                    <TextInput
                                        style={styles.commentComposerInput}
                                        value={activeCommentInputValue}
                                        onChangeText={handleCommentComposerChange}
                                        onSubmitEditing={handleSubmitCommentFromModal}
                                        placeholder="Write a thoughtful reply..."
                                        placeholderTextColor="#9aa1b5"
                                        returnKeyType="send"
                                    />
                                    <TouchableOpacity
                                        style={styles.commentComposerSendBtn}
                                        onPress={handleSubmitCommentFromModal}
                                        activeOpacity={0.85}
                                    >
                                        <IconSend size={14} color="#ffffff" />
                                    </TouchableOpacity>
                                </View>
                            </>
                        ) : (
                            <View style={styles.commentsLoadingWrap}>
                                <ActivityIndicator size="small" color="#111111" />
                                <Text style={styles.commentsLoadingText}>Loading comments...</Text>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

            <Modal
                visible={Boolean(jobPreviewVisible)}
                transparent
                animationType="slide"
                onRequestClose={onCloseJobPreview}
            >
                <View style={styles.previewOverlay}>
                    <View style={styles.previewSheet}>
                        <View style={styles.previewHandle} />
                        {jobPreviewLoading ? (
                            <View style={styles.previewLoadingWrap}>
                                <ActivityIndicator size="small" color="#111111" />
                                <Text style={styles.previewLoadingText}>Loading job details...</Text>
                            </View>
                        ) : (
                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={styles.previewHeaderRow}>
                                    <View style={styles.previewHeaderText}>
                                        <Text style={styles.previewTitle}>{jobPreview?.title || 'Open Role'}</Text>
                                        <Text style={styles.previewCompany}>{jobPreview?.companyName || 'Employer'}</Text>
                                    </View>
                                    <TouchableOpacity style={styles.previewCloseBtn} onPress={onCloseJobPreview} activeOpacity={0.85}>
                                        <Ionicons name="close" size={18} color="#5b5f70" />
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.previewStatusRow}>
                                    <View style={[styles.previewStatusChip, previewStatus.closed && styles.previewStatusChipClosed]}>
                                        <View style={[styles.previewStatusDot, previewStatus.closed && styles.previewStatusDotClosed]} />
                                        <Text style={[styles.previewStatusText, previewStatus.closed && styles.previewStatusTextClosed]}>
                                            {previewStatus.label}
                                        </Text>
                                    </View>
                                    <Text style={styles.previewPostedText}>{previewPostedLabel}</Text>
                                </View>

                                <View style={styles.previewMetaRow}>
                                    <View style={styles.previewMetaChip}>
                                        <Ionicons name="location-outline" size={13} color="#5b5f70" />
                                        <Text style={styles.previewMetaChipText}>{jobPreview?.location || 'Location N/A'}</Text>
                                    </View>
                                    <View style={styles.previewMetaChip}>
                                        <Ionicons name="cash-outline" size={13} color="#5b5f70" />
                                        <Text style={styles.previewMetaChipText}>{jobPreview?.salaryRange || 'Salary N/A'}</Text>
                                    </View>
                                </View>
                                <View style={styles.previewMetaRow}>
                                    <View style={styles.previewMetaChip}>
                                        <Ionicons name={jobPreview?.remoteAllowed ? 'wifi-outline' : 'briefcase-outline'} size={13} color="#5b5f70" />
                                        <Text style={styles.previewMetaChipText}>{jobPreview?.remoteAllowed ? 'Remote allowed' : 'On-site'}</Text>
                                    </View>
                                    <View style={styles.previewMetaChip}>
                                        <Ionicons name="time-outline" size={13} color="#5b5f70" />
                                        <Text style={styles.previewMetaChipText}>{jobPreview?.shift || 'Flexible shift'}</Text>
                                    </View>
                                </View>
                                <Text style={styles.previewSectionTitle}>Requirements</Text>
                                {Array.isArray(jobPreview?.requirements) && jobPreview.requirements.length > 0 ? (
                                    jobPreview.requirements.slice(0, 8).map((item, index) => (
                                        <View key={`${String(item)}-${index}`} style={styles.previewRequirementRow}>
                                            <View style={styles.previewRequirementDot} />
                                            <Text style={styles.previewRequirementText}>{item}</Text>
                                        </View>
                                    ))
                                ) : (
                                    <View style={styles.previewRequirementRow}>
                                        <View style={styles.previewRequirementDot} />
                                        <Text style={styles.previewRequirementText}>Requirements will be shared by employer</Text>
                                    </View>
                                )}
                            </ScrollView>
                        )}

                        <View style={styles.previewActions}>
                            <TouchableOpacity style={styles.previewSecondaryBtn} onPress={onCloseJobPreview} activeOpacity={0.85}>
                                <Text style={styles.previewSecondaryText}>Close</Text>
                            </TouchableOpacity>
                            {!isEmployerRole ? (
                                <TouchableOpacity
                                    style={[styles.previewPrimaryBtn, (hasAppliedToPreviewJob || jobPreviewApplying) && styles.previewPrimaryBtnDisabled]}
                                    onPress={onApplyJobPreview}
                                    activeOpacity={0.85}
                                    disabled={Boolean(hasAppliedToPreviewJob || jobPreviewApplying)}
                                >
                                    <Text style={styles.previewPrimaryText}>
                                        {jobPreviewApplying ? 'Applying...' : (hasAppliedToPreviewJob ? 'Applied' : 'Apply')}
                                    </Text>
                                </TouchableOpacity>
                            ) : null}
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

export default memo(FeedTabComponent);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fcfbff',
    },
    content: {
        paddingHorizontal: 0,
        paddingTop: 4,
        paddingBottom: 34,
    },
    contentEmpty: {
        flexGrow: 1,
    },
    footerLoading: {
        marginHorizontal: 14,
        marginTop: 2,
        marginBottom: 6,
        paddingVertical: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ece4f8',
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    footerLoadingText: {
        color: '#7c8398',
        fontSize: 11.5,
        fontWeight: '700',
    },
    footerSpacer: {
        height: 34,
    },
    listLoadingWrap: {
        paddingVertical: 24,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    listLoadingText: {
        color: '#4b5563',
        fontSize: 12,
        fontWeight: '600',
    },
    feedMark: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    feedMarkOuter: {
        position: 'absolute',
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: '#d0d3db',
    },
    feedMarkMiddle: {
        position: 'absolute',
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 2,
        borderColor: '#d0d3db',
    },
    feedMarkInner: {
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: '#d0d3db',
        backgroundColor: '#ffffff',
    },
    loadingStateWrap: {
        paddingHorizontal: 10,
        paddingTop: 12,
        paddingBottom: 20,
        gap: 12,
    },
    loadingStateHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    loadingStateTextWrap: {
        flex: 1,
    },
    loadingStateTitle: {
        color: '#171a28',
        fontSize: 15,
        fontWeight: '800',
    },
    loadingStateSubtitle: {
        marginTop: 2,
        color: '#7c8398',
        fontSize: 12,
        fontWeight: '600',
    },
    skeletonCard: {
        borderWidth: 1,
        borderColor: '#efe9f8',
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 14,
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.03,
        shadowRadius: 16,
        elevation: 1,
    },
    skeletonHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    skeletonAvatar: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#f3eef8',
        marginRight: 12,
    },
    skeletonHeaderText: {
        flex: 1,
        gap: 8,
    },
    skeletonLine: {
        borderRadius: 999,
        backgroundColor: '#f3eef8',
    },
    skeletonLinePrimary: {
        width: '42%',
        height: 12,
    },
    skeletonLineSecondary: {
        width: '28%',
        height: 10,
    },
    skeletonLineBodyLong: {
        width: '96%',
        height: 11,
        marginBottom: 8,
    },
    skeletonLineBodyShort: {
        width: '68%',
        height: 11,
        marginBottom: 12,
    },
    skeletonMedia: {
        width: '100%',
        height: 220,
        borderRadius: 18,
        backgroundColor: '#f6f2fb',
        marginBottom: 12,
    },
    skeletonActionsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    skeletonActionChip: {
        width: 76,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#f5f0fa',
    },
    feedEmptyCard: {
        marginTop: 8,
        marginBottom: 16,
        marginHorizontal: 10,
        minHeight: 260,
        justifyContent: 'center',
    },
    inlineStatusCard: {
        marginTop: 8,
        marginBottom: 14,
        marginHorizontal: 10,
    },
    statusBar: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        alignSelf: 'center',
        backgroundColor: '#6d28d9',
        borderRadius: 999,
        marginTop: 6,
        marginBottom: 6,
    },
    statusBarText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#fff',
    },
    postActionOverlay: {
        flex: 1,
        backgroundColor: 'rgba(16, 18, 27, 0.32)',
        justifyContent: 'flex-end',
    },
    postActionSheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        borderTopWidth: 1,
        borderTopColor: '#eee6f8',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 22,
        gap: 10,
    },
    postActionHandle: {
        width: 38,
        height: 4,
        borderRadius: 999,
        alignSelf: 'center',
        backgroundColor: '#d6c9f3',
        marginBottom: 4,
    },
    postActionTitle: {
        color: '#171a28',
        fontSize: 17,
        fontWeight: '800',
    },
    postActionPreview: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#f0e9f8',
        backgroundColor: '#fcfbff',
    },
    postActionPreviewAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    postActionPreviewTextWrap: {
        flex: 1,
    },
    postActionPreviewAuthor: {
        color: '#171a28',
        fontSize: 13.5,
        fontWeight: '800',
        marginBottom: 2,
    },
    postActionSubtitle: {
        color: '#70778a',
        fontSize: 12,
        lineHeight: 17,
    },
    postActionItem: {
        minHeight: 58,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#eee6f8',
        backgroundColor: '#fcfbff',
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    postActionItemDanger: {
        borderColor: '#fecaca',
        backgroundColor: '#fff6f7',
    },
    postActionIconWrap: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f1fb',
        borderWidth: 1,
        borderColor: '#ebe3f8',
    },
    postActionIconWrapDanger: {
        backgroundColor: '#ffe8ec',
        borderColor: '#ffd6de',
    },
    postActionTextWrap: {
        flex: 1,
    },
    postActionItemText: {
        color: '#171a28',
        fontSize: 13,
        fontWeight: '800',
    },
    postActionItemHelper: {
        marginTop: 2,
        color: '#7d8497',
        fontSize: 11.5,
        lineHeight: 15,
    },
    postActionItemDangerText: {
        color: '#dc2626',
        fontSize: 13,
        fontWeight: '800',
    },
    postActionItemDangerHelper: {
        marginTop: 2,
        color: '#b45369',
        fontSize: 11.5,
        lineHeight: 15,
    },
    postActionCancel: {
        marginTop: 2,
        minHeight: 42,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ebe2f8',
        backgroundColor: '#f7f3fc',
        alignItems: 'center',
        justifyContent: 'center',
    },
    postActionCancelText: {
        color: '#4f5470',
        fontSize: 13,
        fontWeight: '800',
    },
    commentsOverlay: {
        flex: 1,
        backgroundColor: 'rgba(18, 16, 30, 0.32)',
        justifyContent: 'flex-end',
    },
    commentsSheet: {
        maxHeight: '96%',
        minHeight: '84%',
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 14,
        borderTopWidth: 1,
        borderTopColor: '#ede6fb',
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.06,
        shadowRadius: 16,
        elevation: 8,
    },
    commentsHandle: {
        alignSelf: 'center',
        width: 46,
        height: 5,
        borderRadius: 999,
        backgroundColor: '#d9cff4',
        marginBottom: 10,
    },
    commentsHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    commentsHeaderTextWrap: {
        flex: 1,
    },
    commentsTitle: {
        color: '#171a28',
        fontSize: 18,
        fontWeight: '800',
    },
    commentsCountText: {
        marginTop: 2,
        color: '#8b92a6',
        fontSize: 12,
        fontWeight: '600',
    },
    commentsCloseBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f6f2ff',
        borderWidth: 1,
        borderColor: '#e5dcff',
    },
    commentsCloseText: {
        color: '#50556f',
        fontSize: 20,
        lineHeight: 20,
        fontWeight: '700',
    },
    commentsPostMeta: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        borderWidth: 1,
        borderColor: '#efe7fb',
        borderRadius: 20,
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 12,
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.04,
        shadowRadius: 10,
    },
    commentsPostAvatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e5dcff',
        backgroundColor: '#f2ecff',
    },
    commentsPostTextWrap: {
        flex: 1,
    },
    commentsPostAuthor: {
        color: '#171a28',
        fontSize: 12,
        fontWeight: '800',
        marginBottom: 2,
    },
    commentsPostText: {
        color: '#50586e',
        fontSize: 12.5,
        lineHeight: 18,
    },
    commentsScroll: {
        flex: 1,
    },
    commentsScrollContent: {
        paddingBottom: 20,
        gap: 12,
    },
    commentRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    commentAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        marginTop: 1,
        borderWidth: 1,
        borderColor: '#e5dcff',
        backgroundColor: '#f2ecff',
    },
    commentBubble: {
        flex: 1,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#efe7fb',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.03,
        shadowRadius: 10,
    },
    commentHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 4,
    },
    commentAuthor: {
        color: '#171a28',
        fontSize: 12,
        fontWeight: '800',
    },
    commentText: {
        color: '#2a3043',
        fontSize: 13,
        lineHeight: 19,
    },
    commentTime: {
        color: '#8b92a4',
        fontSize: 10,
        fontWeight: '700',
    },
    commentsEmptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 24,
        gap: 6,
    },
    commentsEmptyOrb: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#f3edff',
        borderWidth: 1,
        borderColor: '#e4dafb',
        marginBottom: 4,
    },
    commentsEmptyTitle: {
        color: '#1f2436',
        fontSize: 14,
        fontWeight: '800',
    },
    commentsEmptyText: {
        color: '#7a8194',
        fontSize: 12.5,
        fontWeight: '600',
        textAlign: 'center',
        lineHeight: 18,
    },
    commentComposerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: '#f0e8fb',
        paddingTop: 12,
        paddingBottom: 4,
    },
    commentComposerAvatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: '#e5dcff',
        backgroundColor: '#f2ecff',
    },
    commentComposerInput: {
        flex: 1,
        minHeight: 42,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e8defc',
        backgroundColor: '#f7f4ff',
        paddingHorizontal: 14,
        color: '#171a28',
        fontSize: 13,
    },
    commentComposerSendBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6f4cf6',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 10,
    },
    commentsLoadingWrap: {
        paddingVertical: 24,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    commentsLoadingText: {
        color: '#6d7487',
        fontSize: 13,
        fontWeight: '600',
    },
    previewOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 17, 24, 0.3)',
        justifyContent: 'flex-end',
    },
    previewSheet: {
        maxHeight: '78%',
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 16,
        borderTopWidth: 1,
        borderTopColor: '#ebe3f8',
    },
    previewHandle: {
        alignSelf: 'center',
        width: 42,
        height: 4,
        borderRadius: 999,
        backgroundColor: '#d6c9f3',
        marginBottom: 10,
    },
    previewLoadingWrap: {
        paddingVertical: 28,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    previewLoadingText: {
        color: '#6d7487',
        fontSize: 13,
        fontWeight: '600',
    },
    previewHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
    },
    previewHeaderText: {
        flex: 1,
    },
    previewTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#171a28',
        marginBottom: 4,
    },
    previewCompany: {
        fontSize: 13,
        color: '#6d7487',
        fontWeight: '700',
    },
    previewCloseBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ece4f8',
    },
    previewStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    previewStatusChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#eefbf2',
        borderWidth: 1,
        borderColor: '#d8f2e2',
    },
    previewStatusChipClosed: {
        backgroundColor: '#fff4f5',
        borderColor: '#f7d6db',
    },
    previewStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#22c55e',
    },
    previewStatusDotClosed: {
        backgroundColor: '#ef4444',
    },
    previewStatusText: {
        color: '#15803d',
        fontSize: 11.5,
        fontWeight: '800',
    },
    previewStatusTextClosed: {
        color: '#b91c1c',
    },
    previewPostedText: {
        color: '#7c8398',
        fontSize: 11.5,
        fontWeight: '700',
    },
    previewMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    previewMetaChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f8f6fb',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ebe3f8',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    previewMetaChipText: {
        color: '#4d5163',
        fontSize: 12,
        fontWeight: '700',
    },
    previewSectionTitle: {
        marginTop: 6,
        marginBottom: 8,
        color: '#171a28',
        fontSize: 13,
        fontWeight: '800',
    },
    previewRequirementRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 6,
    },
    previewRequirementDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#c7bfdc',
        marginTop: 8,
    },
    previewRequirementText: {
        flex: 1,
        color: '#2c3244',
        fontSize: 13,
        lineHeight: 20,
    },
    previewActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#f0e8f8',
    },
    previewSecondaryBtn: {
        flex: 1,
        borderWidth: 1,
        borderColor: '#ebe2f8',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 11,
        backgroundColor: '#f7f3fc',
        alignItems: 'center',
    },
    previewSecondaryText: {
        color: '#4f5470',
        fontSize: 13,
        fontWeight: '800',
    },
    previewPrimaryBtn: {
        flex: 1,
        borderRadius: 14,
        paddingHorizontal: 18,
        paddingVertical: 11,
        backgroundColor: '#6f4cf6',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 2,
        alignItems: 'center',
    },
    previewPrimaryBtnDisabled: {
        opacity: 0.55,
    },
    previewPrimaryText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
});
