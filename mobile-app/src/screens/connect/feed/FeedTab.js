import React, { memo, useCallback, useMemo } from 'react';
import { View, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import FeedComposer from './FeedComposer';
import FeedPostCard from './FeedPostCard';
import EmptyState from '../../../components/EmptyState';
import { connectPalette } from '../connectPalette';

function FeedTabComponent({
    feedPosts,
    loadingFeed,
    loadingMoreFeed,
    composerOpen,
    composerMediaType,
    composerText,
    likedPostIds,
    likeCountMap,
    commentsByPostId,
    activeCommentPostId,
    commentInputMap,
    currentUserAvatar,
    onRefreshFeed,
    onLoadMoreFeed,
    onMediaButtonClick,
    onInputAreaClick,
    onCancelComposer,
    onPost,
    onComposerTextChange,
    onToggleLike,
    onToggleComment,
    onToggleVouch,
    onCommentInputChange,
    onSubmitComment,
    onReportPost,
}) {
    const keyExtractor = useCallback((item) => String(item._id), []);

    const renderPostItem = useCallback(({ item }) => {
        const postId = item._id;
        return (
            <FeedPostCard
                post={item}
                isLiked={likedPostIds.has(postId)}
                likeCount={Number(likeCountMap[postId] ?? item.likes ?? 0)}
                commentList={commentsByPostId[postId] || []}
                isCommentOpen={activeCommentPostId === postId}
                commentInputValue={commentInputMap[postId] || ''}
                currentUserAvatar={currentUserAvatar}
                onToggleLike={onToggleLike}
                onToggleComment={onToggleComment}
                onToggleVouch={onToggleVouch}
                onCommentInputChange={onCommentInputChange}
                onSubmitComment={onSubmitComment}
                onReport={onReportPost}
            />
        );
    }, [
        likedPostIds,
        likeCountMap,
        commentsByPostId,
        activeCommentPostId,
        commentInputMap,
        currentUserAvatar,
        onToggleLike,
        onToggleComment,
        onToggleVouch,
        onCommentInputChange,
        onSubmitComment,
        onReportPost,
    ]);

    const listHeader = useMemo(() => (
        <FeedComposer
            composerOpen={composerOpen}
            composerMediaType={composerMediaType}
            composerText={composerText}
            currentUserAvatar={currentUserAvatar}
            onInputAreaClick={onInputAreaClick}
            onMediaButtonClick={onMediaButtonClick}
            onCancelComposer={onCancelComposer}
            onPost={onPost}
            onComposerTextChange={onComposerTextChange}
        />
    ), [
        composerOpen,
        composerMediaType,
        composerText,
        currentUserAvatar,
        onInputAreaClick,
        onMediaButtonClick,
        onCancelComposer,
        onPost,
        onComposerTextChange,
    ]);

    const listFooter = useMemo(() => {
        if (loadingMoreFeed) {
            return (
                <View style={styles.footerLoading}>
                    <ActivityIndicator color={connectPalette.accent} />
                </View>
            );
        }
        return <View style={styles.footerSpacer} />;
    }, [loadingMoreFeed]);

    const listEmpty = useMemo(() => (
        <EmptyState
            icon="✍️"
            title="No posts yet"
            subtitle="Be the first to share your work today"
            action={{ label: 'Create Post', onPress: onInputAreaClick }}
        />
    ), [onInputAreaClick]);

    return (
        <View style={styles.container}>
            <FlatList
                data={feedPosts}
                keyExtractor={keyExtractor}
                renderItem={renderPostItem}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
                refreshing={loadingFeed}
                onRefresh={onRefreshFeed}
                onEndReached={onLoadMoreFeed}
                onEndReachedThreshold={0.3}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={listEmpty}
                ListFooterComponent={listFooter}
                removeClippedSubviews
                windowSize={10}
                maxToRenderPerBatch={8}
                initialNumToRender={6}
            />
        </View>
    );
}

export default memo(FeedTabComponent);

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 12,
        paddingTop: 12,
    },
    footerLoading: {
        paddingVertical: 16,
    },
    footerSpacer: {
        height: 26,
    },
});
