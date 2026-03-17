import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    Modal,
    TouchableOpacity,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Alert,
    Share,
    RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconPlus, IconSearch } from '../../../components/Icons';
import MyCommunitiesSection from './MyCommunitiesSection';
import CircleCard from './CircleCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';
import { ConnectSkeletonList } from '../ConnectSkeletons';
import ConnectEmptyStateCard from '../ConnectEmptyState';

function CirclesTabComponent({
    circles,
    joinedCircles,
    loading,
    refreshing,
    errorMessage,
    pendingJoinCircleIds,
    onOpenCircle,
    onJoinCircle,
    onRefreshCircles,
    onCreateCircle,
    communityFabTrigger,
    contentContainerStyle,
}) {
    const insets = useSafeAreaInsets();
    const [actionMenuVisible, setActionMenuVisible] = useState(false);
    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [createCommunityName, setCreateCommunityName] = useState('');
    const [createCategory, setCreateCategory] = useState('');
    const [createDescription, setCreateDescription] = useState('');
    const [createPrivacy, setCreatePrivacy] = useState('public');
    const [creatingCommunity, setCreatingCommunity] = useState(false);
    const [exploreQuery, setExploreQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const lastFabTriggerRef = useRef(0);

    const safeCircles = useMemo(() => (
        (Array.isArray(circles) ? circles : []).filter((circle) => (
            circle
            && typeof circle === 'object'
            && String(circle?._id || '').trim().length > 0
        ))
    ), [circles]);
    const safeJoinedCircles = joinedCircles instanceof Set ? joinedCircles : new Set();
    const joined = useMemo(() => (
        safeCircles.filter((circle) => safeJoinedCircles.has(circle._id))
    ), [safeCircles, safeJoinedCircles]);

    const explore = useMemo(() => (
        safeCircles.filter((circle) => !safeJoinedCircles.has(circle._id))
    ), [safeCircles, safeJoinedCircles]);
    const safePendingJoinCircleIds = pendingJoinCircleIds instanceof Set ? pendingJoinCircleIds : new Set();
    const normalizedExploreQuery = useMemo(() => (
        String(exploreQuery || '').trim().toLowerCase()
    ), [exploreQuery]);
    const exploreCategories = useMemo(() => {
        const set = new Set();
        explore.forEach((circle) => {
            const key = String(circle?.category || '').trim().toLowerCase();
            if (key) {
                set.add(key);
            }
        });
        return ['all', ...Array.from(set).slice(0, 10)];
    }, [explore]);
    const normalizedActiveCategory = useMemo(
        () => String(activeCategory || 'all').trim().toLowerCase() || 'all',
        [activeCategory]
    );
    const filteredExplore = useMemo(() => {
        return explore.filter((circle) => {
            const category = String(circle?.category || '').trim().toLowerCase();
            if (normalizedActiveCategory !== 'all' && category !== normalizedActiveCategory) {
                return false;
            }
            if (!normalizedExploreQuery) {
                return true;
            }
            const topics = Array.isArray(circle?.topics) ? circle.topics : [];
            const searchable = [
                String(circle?.name || ''),
                String(circle?.category || ''),
                String(circle?.desc || ''),
                topics.join(' '),
            ].join(' ').toLowerCase();
            return searchable.includes(normalizedExploreQuery);
        });
    }, [explore, normalizedExploreQuery, normalizedActiveCategory]);

    useEffect(() => {
        if (!exploreCategories.includes(normalizedActiveCategory)) {
            setActiveCategory('all');
        }
    }, [exploreCategories, normalizedActiveCategory]);

    useEffect(() => {
        const trigger = Number(communityFabTrigger || 0);
        if (!trigger || trigger === lastFabTriggerRef.current) return;
        lastFabTriggerRef.current = trigger;
        setActionMenuVisible(true);
    }, [communityFabTrigger]);

    const keyExtractor = useCallback((item, index) => String(item?._id || `circle-${index}`), []);

    const renderExploreItem = useCallback(({ item }) => (
        <CircleCard
            variant="explore"
            circle={(item && typeof item === 'object') ? item : {}}
            onJoinCircle={onJoinCircle}
            pendingJoinCircleIds={safePendingJoinCircleIds}
        />
    ), [onJoinCircle, safePendingJoinCircleIds]);

    const handleOpenCommunityActions = useCallback(() => {
        setActionMenuVisible(true);
    }, []);

    const listHeader = useMemo(() => (
        <>
            <LinearGradient
                colors={[connectPalette.accent, connectPalette.accentDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.hero}
            >
                <View style={styles.heroRing} />
                <Text style={styles.heroTitle}>Find Your Tribe</Text>
                <Text style={styles.heroSub}>
                    Connect with professionals in your category. Share rates, routes, and advice with people who understand your work.
                </Text>
            </LinearGradient>

            <MyCommunitiesSection circles={joined} onOpenCircle={onOpenCircle} />

            <View style={styles.searchBar}>
                <IconSearch size={16} color={connectPalette.subtle} />
                <TextInput
                    style={styles.searchInput}
                    value={exploreQuery}
                    onChangeText={setExploreQuery}
                    placeholder="Search communities or categories"
                    placeholderTextColor={connectPalette.subtle}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {normalizedExploreQuery ? (
                    <TouchableOpacity
                        activeOpacity={0.75}
                        onPress={() => setExploreQuery('')}
                        style={styles.searchClearButton}
                    >
                        <Text style={styles.searchClearText}>Clear</Text>
                    </TouchableOpacity>
                ) : null}
            </View>

            <View style={styles.categoryRow}>
                {exploreCategories.map((categoryKey) => {
                    const isActive = categoryKey === normalizedActiveCategory;
                    const label = categoryKey === 'all'
                        ? 'All'
                        : categoryKey.split(' ').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
                    return (
                        <TouchableOpacity
                            key={categoryKey}
                            style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                            activeOpacity={0.85}
                            onPress={() => setActiveCategory(categoryKey)}
                        >
                            <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{label}</Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {errorMessage && explore.length > 0 ? (
                <ConnectEmptyStateCard
                    title="Showing saved communities"
                    subtitle="We couldn't refresh just now. Pull to refresh anytime."
                    actionLabel="Try again"
                    onAction={onRefreshCircles}
                    tone="info"
                    inline
                    style={styles.inlineStatusCard}
                />
            ) : null}

        </>
    ), [explore.length, exploreQuery, joined, normalizedExploreQuery, onOpenCircle, exploreCategories, normalizedActiveCategory, errorMessage, onRefreshCircles]);

    const listEmpty = useMemo(() => (
        errorMessage && explore.length === 0 ? (
            <ConnectEmptyStateCard
                title="No communities to show right now"
                subtitle="We couldn't load new communities just now. Pull to refresh."
                actionLabel="Try again"
                onAction={onRefreshCircles}
                tone="info"
            />
        ) : (
            <ConnectEmptyStateCard
                title={normalizedExploreQuery ? 'No matching communities' : 'No communities yet'}
                subtitle={normalizedExploreQuery ? 'Try a different search term.' : 'Circles appear here once created'}
            />
        )
    ), [errorMessage, explore.length, normalizedExploreQuery, onRefreshCircles]);

    const loadingState = useMemo(() => (
        <ConnectSkeletonList count={3} />
    ), []);

    const closeActionMenu = useCallback(() => {
        setActionMenuVisible(false);
    }, []);

    const openCreateCommunityForm = useCallback((privacy = 'public') => {
        setCreatePrivacy(privacy === 'private' ? 'private' : 'public');
        setActionMenuVisible(false);
        setCreateModalVisible(true);
    }, []);

    const closeCreateCommunityForm = useCallback(() => {
        setCreateModalVisible(false);
        setCreateCommunityName('');
        setCreateCategory('');
        setCreateDescription('');
        setCreatePrivacy('public');
    }, []);

    const handleShareCommunityInvite = useCallback(async () => {
        const sourceCommunity = joined[0];
        const circleId = String(sourceCommunity?._id || '').trim();
        if (!circleId) {
            Alert.alert('No community yet', 'Create or join a community first, then share invite links.');
            return;
        }

        try {
            const { data } = await client.get(`/api/growth/share-link/community/${circleId}`, {
                __skipApiErrorHandler: true,
            });
            const shareLink = String(data?.shareLink || '').trim();
            if (!shareLink) {
                throw new Error('Share link unavailable');
            }
            await Share.share({
                message: `Join my community on HireCircle: ${shareLink}`,
            });
            setActionMenuVisible(false);
        } catch (_error) {
            Alert.alert('Share unavailable', 'Could not generate a community invite link right now.');
        }
    }, [joined]);

    const handleCreateCommunitySubmit = useCallback(async () => {
        const normalizedName = String(createCommunityName || '').trim();
        if (normalizedName.length < 2) {
            Alert.alert('Invalid name', 'Community name must be at least 2 characters.');
            return;
        }

        setCreatingCommunity(true);
        try {
            if (typeof onCreateCircle === 'function') {
                await onCreateCircle({
                    name: normalizedName,
                    category: String(createCategory || '').trim() || undefined,
                    description: String(createDescription || '').trim() || undefined,
                    privacy: createPrivacy,
                });
            } else {
                // Fallback: no-op if prop not provided
                throw new Error('Community creation is not available right now.');
            }
            closeCreateCommunityForm();
            Alert.alert('Community created', 'Your new community is now live in My Communities.');
        } catch (error) {
            Alert.alert(
                'Create failed',
                error?.response?.data?.message || error?.message || 'Could not create community right now.'
            );
        } finally {
            setCreatingCommunity(false);
        }
    }, [
        closeCreateCommunityForm,
        createCategory,
        createCommunityName,
        createDescription,
        createPrivacy,
        onCreateCircle,
    ]);

    return (
        <>
            <FlatList
                data={filteredExplore}
                keyExtractor={keyExtractor}
                renderItem={renderExploreItem}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={loading ? loadingState : listEmpty}
                ListFooterComponent={<View style={styles.bottomGap} />}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={contentContainerStyle}
                refreshControl={(
                    <RefreshControl
                        refreshing={Boolean(refreshing)}
                        onRefresh={onRefreshCircles}
                        tintColor={connectPalette.accent}
                        colors={[connectPalette.accent]}
                    />
                )}
                removeClippedSubviews={Platform.OS === 'android'}
                windowSize={10}
                maxToRenderPerBatch={8}
                initialNumToRender={8}
            />

            <TouchableOpacity
                activeOpacity={0.88}
                onPress={handleOpenCommunityActions}
                style={[styles.circlesFab, { bottom: (insets.bottom || 0) + 54 }]}
            >
                <IconPlus size={22} color="#ffffff" />
            </TouchableOpacity>

            <Modal
                visible={actionMenuVisible}
                transparent
                animationType="fade"
                onRequestClose={closeActionMenu}
            >
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <TouchableOpacity
                        style={StyleSheet.absoluteFill}
                        activeOpacity={1}
                        onPress={closeActionMenu}
                    />
                    <View style={styles.actionSheet}>
                        <Text style={styles.actionSheetTitle}>Community Actions</Text>
                        <Text style={styles.actionSheetSubtitle}>Choose how you want to grow your circle.</Text>
                        <TouchableOpacity
                            style={styles.actionPrimary}
                            activeOpacity={0.85}
                            onPress={() => openCreateCommunityForm('public')}
                        >
                            <Text style={styles.actionPrimaryText}>Create Public Community</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.actionSecondary}
                            activeOpacity={0.85}
                            onPress={() => openCreateCommunityForm('private')}
                        >
                            <Text style={styles.actionSecondaryText}>Create Private Community</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.actionSecondary}
                            activeOpacity={0.85}
                            onPress={handleShareCommunityInvite}
                        >
                            <Text style={styles.actionSecondaryText}>Share Community Invite</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionCancel} onPress={closeActionMenu}>
                            <Text style={styles.actionCancelText}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal
                visible={createModalVisible}
                transparent
                animationType="fade"
                onRequestClose={closeCreateCommunityForm}
            >
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <TouchableOpacity
                        style={StyleSheet.absoluteFill}
                        activeOpacity={1}
                        onPress={closeCreateCommunityForm}
                    />
                    <View style={styles.createSheet}>
                        <Text style={styles.actionSheetTitle}>Create Community</Text>
                        <Text style={styles.actionSheetSubtitle}>
                            Build your own group and invite people who share your work interests.
                        </Text>

                        <Text style={styles.inputLabel}>Community Name</Text>
                        <TextInput
                            style={styles.input}
                            value={createCommunityName}
                            onChangeText={setCreateCommunityName}
                            placeholder="e.g. Hyderabad Delivery Network"
                            placeholderTextColor={connectPalette.subtle}
                            maxLength={80}
                        />

                        <Text style={styles.inputLabel}>Category</Text>
                        <TextInput
                            style={styles.input}
                            value={createCategory}
                            onChangeText={setCreateCategory}
                            placeholder="e.g. Delivery, Warehouse, Retail"
                            placeholderTextColor={connectPalette.subtle}
                            maxLength={80}
                        />

                        <Text style={styles.inputLabel}>Description (Optional)</Text>
                        <TextInput
                            style={[styles.input, styles.descriptionInput]}
                            value={createDescription}
                            onChangeText={setCreateDescription}
                            placeholder="What this community is about..."
                            placeholderTextColor={connectPalette.subtle}
                            multiline
                            textAlignVertical="top"
                            maxLength={240}
                        />

                        <View style={styles.privacyRow}>
                            <TouchableOpacity
                                style={[styles.privacyChip, createPrivacy === 'public' && styles.privacyChipActive]}
                                onPress={() => setCreatePrivacy('public')}
                            >
                                <Text style={[styles.privacyChipText, createPrivacy === 'public' && styles.privacyChipTextActive]}>
                                    Public
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.privacyChip, createPrivacy === 'private' && styles.privacyChipActive]}
                                onPress={() => setCreatePrivacy('private')}
                            >
                                <Text style={[styles.privacyChipText, createPrivacy === 'private' && styles.privacyChipTextActive]}>
                                    Private
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity
                            style={styles.submitButton}
                            onPress={handleCreateCommunitySubmit}
                            activeOpacity={0.9}
                            disabled={creatingCommunity}
                        >
                            {creatingCommunity ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.submitButtonText}>Create Community</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </>
    );
}

export default memo(CirclesTabComponent);

const styles = StyleSheet.create({
    hero: {
        borderRadius: RADIUS.xl,
        padding: 24,
        marginBottom: 24,
        overflow: 'hidden',
        ...connectShadow,
    },
    heroRing: {
        position: 'absolute',
        top: -40,
        right: -40,
        width: 120,
        height: 120,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.surface,
        opacity: 0.1,
    },
    heroTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: connectPalette.surface,
        marginBottom: 8,
    },
    heroSub: {
        fontSize: 12,
        fontWeight: '500',
        color: '#efe1ff',
        lineHeight: 18,
    },
    bottomGap: {
        height: 32,
    },
    searchBar: {
        marginBottom: 16,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 13,
        color: connectPalette.text,
        paddingVertical: 0,
    },
    searchClearButton: {
        paddingVertical: 4,
        paddingHorizontal: 2,
    },
    searchClearText: {
        fontSize: 12,
        fontWeight: '700',
        color: connectPalette.accentDark,
    },
    categoryRow: {
        marginBottom: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    categoryChip: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    categoryChipActive: {
        borderColor: connectPalette.accent,
        backgroundColor: connectPalette.accentSoft,
    },
    categoryChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: connectPalette.subtle,
    },
    categoryChipTextActive: {
        color: connectPalette.accentDark,
    },
    inlineStatusCard: {
        marginBottom: 12,
    },
    errorBanner: {
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fef2f2',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
    },
    errorBannerText: {
        fontSize: 12,
        color: '#b91c1c',
        fontWeight: '600',
    },
    errorBannerRetryButton: {
        marginTop: 10,
        alignSelf: 'flex-start',
        borderRadius: RADIUS.md,
        backgroundColor: '#dc2626',
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    errorBannerRetryText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#ffffff',
    },
    circlesFab: {
        position: 'absolute',
        right: 18,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: connectPalette.accent,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: connectPalette.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.35,
        shadowRadius: 12,
        elevation: 9,
        zIndex: 40,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15, 23, 42, 0.35)',
    },
    actionSheet: {
        backgroundColor: connectPalette.surface,
        borderTopLeftRadius: RADIUS.xl + 6,
        borderTopRightRadius: RADIUS.xl + 6,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 28,
    },
    actionSheetTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: connectPalette.text,
        marginBottom: 4,
    },
    actionSheetSubtitle: {
        fontSize: 12,
        color: connectPalette.subtle,
        lineHeight: 18,
        marginBottom: 14,
    },
    actionPrimary: {
        borderRadius: RADIUS.md,
        backgroundColor: connectPalette.accent,
        paddingVertical: 12,
        alignItems: 'center',
        marginBottom: 10,
    },
    actionPrimaryText: {
        color: connectPalette.surface,
        fontWeight: '800',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    actionSecondary: {
        borderRadius: RADIUS.md,
        backgroundColor: '#f8f5ff',
        borderWidth: 1,
        borderColor: '#e7dffd',
        paddingVertical: 12,
        alignItems: 'center',
        marginBottom: 10,
    },
    actionSecondaryText: {
        color: connectPalette.accentDark,
        fontWeight: '700',
        fontSize: 13,
    },
    actionCancel: {
        marginTop: 4,
        alignItems: 'center',
        paddingVertical: 10,
    },
    actionCancelText: {
        color: connectPalette.subtle,
        fontWeight: '700',
        fontSize: 13,
    },
    createSheet: {
        backgroundColor: connectPalette.surface,
        borderTopLeftRadius: RADIUS.xl + 6,
        borderTopRightRadius: RADIUS.xl + 6,
        paddingHorizontal: 20,
        paddingTop: 18,
        paddingBottom: 30,
    },
    inputLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: connectPalette.subtle,
        marginBottom: 6,
        marginTop: 10,
    },
    input: {
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 11,
        fontSize: 14,
        color: connectPalette.text,
        backgroundColor: '#fafbff',
    },
    descriptionInput: {
        minHeight: 84,
    },
    privacyRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 14,
    },
    privacyChip: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: '#f6f8fc',
    },
    privacyChipActive: {
        backgroundColor: connectPalette.accentSoft,
        borderColor: '#d8b6ff',
    },
    privacyChipText: {
        color: connectPalette.subtle,
        fontSize: 12,
        fontWeight: '700',
    },
    privacyChipTextActive: {
        color: connectPalette.accentDark,
    },
    submitButton: {
        marginTop: 16,
        borderRadius: RADIUS.md,
        backgroundColor: connectPalette.dark,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 46,
    },
    submitButtonText: {
        color: connectPalette.surface,
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
});
