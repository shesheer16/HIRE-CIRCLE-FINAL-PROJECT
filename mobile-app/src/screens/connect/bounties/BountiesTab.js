import React, { memo, useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    Modal,
    TextInput,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BountyCard from './BountyCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';
import { ConnectSkeletonList } from '../ConnectSkeletons';
import ConnectEmptyStateCard from '../ConnectEmptyState';

const STATUS_FILTERS = ['all', 'open', 'reviewing', 'completed', 'expired'];
const OPEN_STATUSES = new Set(['open', 'reviewing']);

const formatFilterLabel = (value) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'all') return 'All';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

function BountiesTabComponent({
    bounties,
    isEmployerRole,
    loading,
    refreshing,
    errorMessage,
    bountyActionInFlightId,
    isCreatingBounty,
    referredBountyIds,
    totalEarned,
    onOpenReferModal,
    onRefreshBounties,
    onCreateBounty,
    onSubmitBountyEntry,
    onStartAction,
    contentContainerStyle,
}) {
    const [activeStatusFilter, setActiveStatusFilter] = useState('all');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showSubmitModal, setShowSubmitModal] = useState(false);
    const [selectedBounty, setSelectedBounty] = useState(null);
    const [createTitle, setCreateTitle] = useState('');
    const [createDescription, setCreateDescription] = useState('');
    const [createReward, setCreateReward] = useState('');
    const [createDeadlineDays, setCreateDeadlineDays] = useState('7');
    const [createError, setCreateError] = useState('');
    const [submitMessage, setSubmitMessage] = useState('');
    const [submitAttachment, setSubmitAttachment] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [submitSending, setSubmitSending] = useState(false);

    const safeBounties = useMemo(() => (
        Array.isArray(bounties)
            ? bounties.filter((bounty) => bounty && typeof bounty === 'object')
            : []
    ), [bounties]);
    const safeReferredBountyIds = referredBountyIds instanceof Set ? referredBountyIds : new Set();
    const safeTotalEarned = Number.isFinite(Number(totalEarned)) ? Number(totalEarned) : 0;
    const normalizedFilter = String(activeStatusFilter || 'all').toLowerCase();
    const keyExtractor = useCallback((item, index) => String(item?.id || item?._id || `bounty-${index}`), []);

    const filteredBounties = useMemo(() => {
        if (normalizedFilter === 'all') {
            return safeBounties;
        }
        return safeBounties.filter((item) => String(item?.status || 'open').toLowerCase() === normalizedFilter);
    }, [normalizedFilter, safeBounties]);

    const isReferred = useCallback((id) => (
        safeReferredBountyIds.has(id)
    ), [safeReferredBountyIds]);

    const handleCloseCreateModal = useCallback(() => {
        setShowCreateModal(false);
        setCreateTitle('');
        setCreateDescription('');
        setCreateReward('');
        setCreateDeadlineDays('7');
        setCreateError('');
    }, []);

    const handleOpenCreateModal = useCallback(() => {
        setCreateError('');
        setShowCreateModal(true);
    }, []);

    const handleOpenSubmitModal = useCallback((bountyItem) => {
        const safeItem = (bountyItem && typeof bountyItem === 'object') ? bountyItem : null;
        if (!safeItem?.id) return;
        setSelectedBounty(safeItem);
        setSubmitMessage('');
        setSubmitAttachment('');
        setSubmitError('');
        setShowSubmitModal(true);
    }, []);

    const handleCloseSubmitModal = useCallback(() => {
        setShowSubmitModal(false);
        setSelectedBounty(null);
        setSubmitMessage('');
        setSubmitAttachment('');
        setSubmitError('');
    }, []);

    const handleCreateBountySubmit = useCallback(async () => {
        const title = String(createTitle || '').trim();
        const rewardValue = Number(createReward || 0);
        const days = Number.parseInt(String(createDeadlineDays || '').trim(), 10);
        if (title.length < 2) {
            setCreateError('Title must be at least 2 characters.');
            return;
        }
        if (!Number.isFinite(rewardValue) || rewardValue <= 0) {
            setCreateError('Enter a valid reward amount.');
            return;
        }
        if (!Number.isFinite(days) || days <= 0) {
            setCreateError('Deadline must be at least 1 day.');
            return;
        }

        const deadline = new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();
        const result = await onCreateBounty({
            title,
            description: String(createDescription || '').trim(),
            reward: rewardValue,
            deadline,
        });
        if (result?.ok) {
            handleCloseCreateModal();
            return;
        }
        setCreateError(String(result?.message || 'Could not publish bounty right now.'));
    }, [createDeadlineDays, createDescription, createReward, createTitle, handleCloseCreateModal, onCreateBounty]);

    const handleSubmitEntry = useCallback(async () => {
        if (submitSending) return;
        if (!selectedBounty?.id) {
            setSubmitError('No bounty selected.');
            return;
        }
        setSubmitSending(true);
        const result = await onSubmitBountyEntry({
            bountyId: selectedBounty.id,
            message: String(submitMessage || '').trim(),
            attachmentUrl: String(submitAttachment || '').trim(),
        });
        setSubmitSending(false);
        if (result?.ok) {
            handleCloseSubmitModal();
            return;
        }
        setSubmitError(String(result?.message || 'Could not submit entry right now.'));
    }, [handleCloseSubmitModal, onSubmitBountyEntry, selectedBounty?.id, submitAttachment, submitMessage, submitSending]);

    const handlePrimaryAction = useCallback((item) => {
        if (isEmployerRole) {
            return;
        }
        const safeItem = (item && typeof item === 'object') ? item : null;
        if (!safeItem?.id || safeItem?.hasSubmitted) return;
        const status = String(safeItem?.status || 'open').toLowerCase();
        if (!OPEN_STATUSES.has(status)) return;
        handleOpenSubmitModal(safeItem);
    }, [handleOpenSubmitModal, isEmployerRole]);

    const renderItem = useCallback(({ item }) => (
        <BountyCard
            bounty={item}
            isReferred={isReferred(item.id)}
            isEmployerRole={isEmployerRole}
            isPrimaryLoading={String(bountyActionInFlightId || '') === String(item?.id || '')}
            onReferPress={onOpenReferModal}
            onPrimaryAction={handlePrimaryAction}
        />
    ), [isReferred, isEmployerRole, bountyActionInFlightId, onOpenReferModal, handlePrimaryAction]);

    const listHeader = useMemo(() => (
        <>
            <LinearGradient
                colors={[connectPalette.accent, connectPalette.accentDark]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.hero}
            >
                <Text style={styles.heroLabel}>REFERRAL ECONOMY</Text>
                <Text style={styles.heroTitle}>{isEmployerRole ? 'Run Hiring Bounties' : 'Earn by Referring'}</Text>
                <Text style={styles.heroSub}>{safeBounties.length} active bounties available</Text>
                <View style={styles.earningsBox}>
                    <View>
                        <Text style={styles.earningsLabel}>Your Earnings</Text>
                        <Text style={styles.earningsValue}>₹{safeTotalEarned.toLocaleString()}</Text>
                    </View>
                    <Text style={styles.earningsIcon}>💰</Text>
                </View>
            </LinearGradient>

            <View style={styles.actionCard}>
                <Text style={styles.actionCardTitle}>
                    {isEmployerRole ? 'Need referrals quickly?' : 'Want to refer someone now?'}
                </Text>
                <Text style={styles.actionCardSub}>
                    {isEmployerRole
                        ? 'Create a bounty with reward and deadline. Candidates can submit directly from this tab.'
                        : 'Pick any open bounty and refer your network. You can also submit your own entry.'}
                </Text>
                <TouchableOpacity
                    style={styles.actionCardButton}
                    activeOpacity={0.85}
                    onPress={isEmployerRole ? handleOpenCreateModal : onStartAction}
                >
                    <Text style={styles.actionCardButtonText}>
                        {isEmployerRole ? 'Create Bounty' : 'Start Referring'}
                    </Text>
                </TouchableOpacity>
            </View>

            <View style={styles.filterRow}>
                {STATUS_FILTERS.map((status) => {
                    const isActive = status === normalizedFilter;
                    return (
                        <TouchableOpacity
                            key={status}
                            style={[styles.filterChip, isActive && styles.filterChipActive]}
                            activeOpacity={0.85}
                            onPress={() => setActiveStatusFilter(status)}
                        >
                            <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                                {formatFilterLabel(status)}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {errorMessage && safeBounties.length > 0 ? (
                <ConnectEmptyStateCard
                    title="Bounties are showing your last saved view"
                    subtitle={errorMessage}
                    actionLabel="Retry"
                    onAction={onRefreshBounties}
                    tone="info"
                    inline
                    style={styles.inlineStatusCard}
                />
            ) : null}
        </>
    ), [
        errorMessage,
        handleOpenCreateModal,
        isEmployerRole,
        normalizedFilter,
        onRefreshBounties,
        onStartAction,
        safeBounties.length,
        safeTotalEarned,
    ]);

    const listFooter = useMemo(() => (
        <View style={styles.bottomSpacer} />
    ), []);

    const listLoading = useMemo(() => (
        <ConnectSkeletonList count={3} />
    ), []);

    const listEmpty = useMemo(() => (
        errorMessage && safeBounties.length === 0 ? (
            <ConnectEmptyStateCard
                title="Bounties are unavailable right now"
                subtitle={errorMessage}
                actionLabel="Retry"
                onAction={onRefreshBounties}
                tone="error"
            />
        ) : (
            <ConnectEmptyStateCard
                title={normalizedFilter === 'all' ? 'No bounties yet' : `No ${formatFilterLabel(normalizedFilter).toLowerCase()} bounties`}
                subtitle={
                    isEmployerRole
                        ? 'Create your first bounty and watch submissions appear here.'
                        : 'Open bounties and referral opportunities will appear here.'
                }
                actionLabel={isEmployerRole ? 'Create Bounty' : 'Start Referring'}
                onAction={isEmployerRole ? handleOpenCreateModal : onStartAction}
            />
        )
    ), [errorMessage, handleOpenCreateModal, isEmployerRole, normalizedFilter, onRefreshBounties, onStartAction, safeBounties.length]);

    return (
        <>
            <FlatList
                data={filteredBounties}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={loading ? listLoading : listEmpty}
                ListFooterComponent={listFooter}
                contentContainerStyle={[styles.listContent, contentContainerStyle]}
                showsVerticalScrollIndicator={false}
                refreshControl={(
                    <RefreshControl
                        refreshing={Boolean(refreshing)}
                        onRefresh={onRefreshBounties}
                        tintColor={connectPalette.accent}
                        colors={[connectPalette.accent]}
                    />
                )}
                removeClippedSubviews={Platform.OS === 'android'}
                windowSize={10}
                maxToRenderPerBatch={8}
                initialNumToRender={6}
            />

            <Modal visible={showCreateModal} animationType="slide" transparent onRequestClose={handleCloseCreateModal}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleCloseCreateModal}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={styles.modalKeyboardWrap}
                    >
                        <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
                            <Text style={styles.modalTitle}>Create New Bounty</Text>
                            <Text style={styles.modalSub}>Add reward, title, and deadline. You can refine details anytime.</Text>

                            <TextInput
                                style={styles.input}
                                value={createTitle}
                                onChangeText={(value) => {
                                    setCreateTitle(value);
                                    setCreateError('');
                                }}
                                placeholder="Bounty title"
                                placeholderTextColor={connectPalette.subtle}
                                maxLength={120}
                            />
                            <TextInput
                                style={styles.input}
                                value={createReward}
                                onChangeText={(value) => {
                                    setCreateReward(value.replace(/[^0-9]/g, ''));
                                    setCreateError('');
                                }}
                                keyboardType="number-pad"
                                placeholder="Reward amount (INR)"
                                placeholderTextColor={connectPalette.subtle}
                                maxLength={9}
                            />
                            <TextInput
                                style={styles.input}
                                value={createDeadlineDays}
                                onChangeText={(value) => {
                                    setCreateDeadlineDays(value.replace(/[^0-9]/g, ''));
                                    setCreateError('');
                                }}
                                keyboardType="number-pad"
                                placeholder="Deadline in days"
                                placeholderTextColor={connectPalette.subtle}
                                maxLength={3}
                            />
                            <TextInput
                                style={[styles.input, styles.inputMultiline]}
                                value={createDescription}
                                onChangeText={(value) => {
                                    setCreateDescription(value);
                                    setCreateError('');
                                }}
                                placeholder="Add context for good referrals (optional)"
                                placeholderTextColor={connectPalette.subtle}
                                multiline
                                textAlignVertical="top"
                                maxLength={600}
                            />

                            {createError ? <Text style={styles.modalError}>{createError}</Text> : null}

                            <View style={styles.modalActionRow}>
                                <TouchableOpacity
                                    style={styles.modalCancelButton}
                                    activeOpacity={0.85}
                                    onPress={handleCloseCreateModal}
                                    disabled={Boolean(isCreatingBounty)}
                                >
                                    <Text style={styles.modalCancelText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.modalSubmitButton, Boolean(isCreatingBounty) && styles.modalSubmitButtonDisabled]}
                                    activeOpacity={0.85}
                                    onPress={handleCreateBountySubmit}
                                    disabled={Boolean(isCreatingBounty)}
                                >
                                    {isCreatingBounty ? (
                                        <ActivityIndicator size="small" color={connectPalette.surface} />
                                    ) : (
                                        <Text style={styles.modalSubmitText}>Publish Bounty</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    </KeyboardAvoidingView>
                </TouchableOpacity>
            </Modal>

            <Modal visible={showSubmitModal} animationType="slide" transparent onRequestClose={handleCloseSubmitModal}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleCloseSubmitModal}>
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={styles.modalKeyboardWrap}
                    >
                        <TouchableOpacity style={styles.modalSheet} activeOpacity={1}>
                            <Text style={styles.modalTitle}>Submit Entry</Text>
                            <Text style={styles.modalSub}>{selectedBounty?.role || 'Selected bounty'}</Text>

                            <TextInput
                                style={[styles.input, styles.inputMultiline]}
                                value={submitMessage}
                                onChangeText={(value) => {
                                    setSubmitMessage(value);
                                    setSubmitError('');
                                }}
                                placeholder="Share why this referral is strong (optional)"
                                placeholderTextColor={connectPalette.subtle}
                                multiline
                                textAlignVertical="top"
                                maxLength={500}
                            />
                            <TextInput
                                style={styles.input}
                                value={submitAttachment}
                                onChangeText={(value) => {
                                    setSubmitAttachment(value);
                                    setSubmitError('');
                                }}
                                placeholder="Attachment URL (optional)"
                                placeholderTextColor={connectPalette.subtle}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />

                            {submitError ? <Text style={styles.modalError}>{submitError}</Text> : null}

                            <View style={styles.modalActionRow}>
                                <TouchableOpacity
                                    style={styles.modalCancelButton}
                                    activeOpacity={0.85}
                                    onPress={handleCloseSubmitModal}
                                    disabled={submitSending}
                                >
                                    <Text style={styles.modalCancelText}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.modalSubmitButton, submitSending && styles.modalSubmitButtonDisabled]}
                                    activeOpacity={0.85}
                                    onPress={handleSubmitEntry}
                                    disabled={submitSending}
                                >
                                    {submitSending ? (
                                        <ActivityIndicator size="small" color={connectPalette.surface} />
                                    ) : (
                                        <Text style={styles.modalSubmitText}>Send Entry</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </TouchableOpacity>
                    </KeyboardAvoidingView>
                </TouchableOpacity>
            </Modal>
        </>
    );
}

export default memo(BountiesTabComponent);

const styles = StyleSheet.create({
    listContent: {
        paddingBottom: 24,
    },
    hero: {
        borderRadius: RADIUS.xl,
        padding: 24,
        marginBottom: 16,
        ...connectShadow,
    },
    heroLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: '#e9ddff',
        letterSpacing: 1,
        marginBottom: 4,
    },
    heroTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: connectPalette.surface,
        marginBottom: 4,
    },
    heroSub: {
        fontSize: 12,
        color: '#ece3ff',
        fontWeight: '600',
        marginBottom: 14,
    },
    earningsBox: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.lg,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    earningsLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: connectPalette.muted,
    },
    earningsValue: {
        fontSize: 24,
        fontWeight: '900',
        color: connectPalette.text,
    },
    earningsIcon: {
        fontSize: 28,
    },
    actionCard: {
        backgroundColor: connectPalette.surface,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderColor: connectPalette.line,
        padding: 16,
        marginBottom: 14,
        ...connectShadow,
    },
    actionCardTitle: {
        fontSize: 14,
        fontWeight: '900',
        color: connectPalette.text,
    },
    actionCardSub: {
        marginTop: 4,
        fontSize: 12,
        color: connectPalette.muted,
        lineHeight: 18,
    },
    actionCardButton: {
        marginTop: 12,
        alignSelf: 'flex-start',
        backgroundColor: connectPalette.dark,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: RADIUS.md,
    },
    actionCardButtonText: {
        color: connectPalette.surface,
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 0.3,
    },
    filterRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 12,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        borderRadius: RADIUS.full,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: connectPalette.surface,
    },
    filterChipActive: {
        borderColor: connectPalette.accent,
        backgroundColor: connectPalette.accentSoft,
    },
    filterChipText: {
        fontSize: 11,
        fontWeight: '800',
        color: connectPalette.muted,
    },
    filterChipTextActive: {
        color: connectPalette.accentDark,
    },
    inlineStatusCard: {
        marginBottom: 12,
    },
    errorBanner: {
        backgroundColor: '#fef2f2',
        borderColor: '#fecaca',
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 12,
    },
    errorBannerText: {
        fontSize: 12,
        color: '#b91c1c',
        fontWeight: '700',
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
    bottomSpacer: {
        height: 32,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.35)',
        justifyContent: 'flex-end',
    },
    modalKeyboardWrap: {
        width: '100%',
        justifyContent: 'flex-end',
    },
    modalSheet: {
        backgroundColor: connectPalette.surface,
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 28,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: connectPalette.text,
        marginBottom: 4,
    },
    modalSub: {
        fontSize: 12,
        color: connectPalette.muted,
        marginBottom: 14,
        lineHeight: 18,
    },
    input: {
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: RADIUS.md,
        fontSize: 13,
        color: connectPalette.text,
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginBottom: 10,
    },
    inputMultiline: {
        minHeight: 90,
    },
    modalError: {
        color: connectPalette.danger,
        fontSize: 11,
        fontWeight: '700',
        marginTop: -2,
        marginBottom: 8,
    },
    modalActionRow: {
        flexDirection: 'row',
        marginTop: 4,
    },
    modalCancelButton: {
        flex: 1,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        borderRadius: RADIUS.md,
        paddingVertical: 12,
        alignItems: 'center',
        marginRight: 8,
    },
    modalCancelText: {
        fontSize: 12,
        color: connectPalette.muted,
        fontWeight: '800',
    },
    modalSubmitButton: {
        flex: 1,
        borderRadius: RADIUS.md,
        backgroundColor: connectPalette.dark,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalSubmitButtonDisabled: {
        opacity: 0.7,
    },
    modalSubmitText: {
        fontSize: 12,
        color: connectPalette.surface,
        fontWeight: '900',
    },
});
