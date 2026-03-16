import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, FlatList, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { IconMapPin, IconUsers } from '../../../components/Icons';
import { RADIUS, SPACING } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';
import SkeletonLoader from '../../../components/SkeletonLoader';
import { ConnectSkeletonBlock, ConnectSkeletonList } from '../ConnectSkeletons';
import ConnectEmptyStateCard from '../ConnectEmptyState';

const getCategoryTone = (label = '') => {
    const normalized = String(label).toLowerCase();
    if (normalized.includes('trade')) return { bg: connectPalette.accentSoft, fg: connectPalette.accentDark };
    if (normalized.includes('delivery')) return { bg: connectPalette.accent, fg: connectPalette.surface };
    if (normalized.includes('operation')) return { bg: connectPalette.warning, fg: connectPalette.surface };
    return { bg: '#f1f3f8', fg: connectPalette.muted };
};

const PulseGigCard = memo(function PulseGigCardComponent({
    gig,
    canApply,
    isApplied,
    onApplyGig,
    onOpenGigDetails,
}) {
    const tone = useMemo(() => getCategoryTone(gig.category), [gig.category]);
    const categoryBadgeStyle = useMemo(() => ({ backgroundColor: tone.bg }), [tone.bg]);
    const categoryBadgeTextStyle = useMemo(() => ({ color: tone.fg }), [tone.fg]);

    const applyBtnStyle = isApplied ? styles.applyBtnDone : styles.applyBtn;
    const applyTextStyle = isApplied ? styles.applyBtnTextDone : styles.applyBtnText;

    const handleApply = useCallback(() => {
        if (!canApply || isApplied) return;
        onApplyGig(gig);
    }, [canApply, isApplied, onApplyGig, gig]);

    const handleOpenDetails = useCallback(() => {
        onOpenGigDetails?.(gig);
    }, [gig, onOpenGigDetails]);

    return (
        <View style={styles.gigCard}>
            <View style={styles.gigTop}>
                <View style={styles.gigTopLeft}>
                    <View style={styles.titleRow}>
                        <Text style={styles.gigTitle}>{gig.title}</Text>
                        {gig.urgent ? (
                            <View style={styles.urgentBadge}>
                                <Text style={styles.urgentBadgeText}>URGENT</Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={styles.gigEmployer}>{gig.employer}</Text>
                    <View style={styles.gigProofRow}>
                        <Text style={styles.gigProofText}>{Number(gig.engagementCount || gig.applicantsCount || 0)} active responses</Text>
                        <Text style={styles.gigProofDot}>•</Text>
                        <Text style={styles.gigProofText}>{gig.responseTime || 'Fast reply'}</Text>
                    </View>
                </View>
                <View style={[styles.categoryBadge, categoryBadgeStyle]}>
                    <Text style={[styles.categoryBadgeText, categoryBadgeTextStyle]}>{gig.category}</Text>
                </View>
            </View>

            <View style={styles.gigBottom}>
                <Text style={styles.gigMeta}>📍 {gig.distance}  🕐 {gig.timePosted}</Text>
                <Text style={styles.gigPay}>{gig.pay}</Text>
            </View>

            <View style={styles.gigActionRow}>
                <TouchableOpacity style={styles.detailsBtn} onPress={handleOpenDetails} activeOpacity={0.85}>
                    <Text style={styles.detailsBtnText}>SEE DETAILS</Text>
                </TouchableOpacity>
                <View style={styles.gigBottomRight}>
                    {canApply ? (
                        <TouchableOpacity style={applyBtnStyle} onPress={handleApply} disabled={isApplied}>
                            <Text style={applyTextStyle}>{isApplied ? 'SENT ✓' : 'APPLY NOW'}</Text>
                        </TouchableOpacity>
                    ) : (
                        <View style={styles.updateBadge}>
                            <Text style={styles.updateBadgeText}>UPDATE</Text>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
});

const PulseProCard = memo(function PulseProCardComponent({
    pro,
    isRequested,
    onHirePro,
}) {
    const safePro = (pro && typeof pro === 'object') ? pro : {};
    const proName = String(safePro.name || 'Professional').trim() || 'Professional';
    const proRole = String(safePro.role || 'Pro').trim() || 'Pro';
    const proDistance = String(safePro.distance || 'Nearby').trim() || 'Nearby';
    const proKarma = String(safePro.karma || '0').trim() || '0';
    const proAvatar = String(safePro.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(proName)}&background=8b3dff&color=fff&rounded=true`);

    const availabilityDotStyle = useMemo(() => ({
        backgroundColor: safePro.available ? connectPalette.success : connectPalette.subtle,
    }), [safePro.available]);

    const hireBtnStyle = isRequested ? styles.hireBtnDone : styles.hireBtn;
    const hireBtnTextStyle = isRequested ? styles.hireBtnTextDone : styles.hireBtnText;

    const handleHire = useCallback(() => {
        if (!isRequested) onHirePro(safePro);
    }, [isRequested, onHirePro, safePro]);

    return (
        <View style={styles.proCard}>
            <View style={styles.proAvatarWrap}>
                <Image source={{ uri: proAvatar }} style={styles.proAvatar} />
                <View style={[styles.availabilityDot, availabilityDotStyle]} />
            </View>
            <View style={styles.proMain}>
                <Text style={styles.proName}>{proName}</Text>
                <Text style={styles.proMeta}>{proRole} · 📍 {proDistance}</Text>
            </View>
            <View style={styles.karmaBadge}>
                <Text style={styles.karmaBadgeText}>{proKarma} KARMA</Text>
            </View>
            {safePro.available ? (
                <TouchableOpacity style={hireBtnStyle} onPress={handleHire} disabled={isRequested}>
                    <Text style={hireBtnTextStyle}>{isRequested ? 'SENT ✓' : 'HIRE'}</Text>
                </TouchableOpacity>
            ) : (
                <View style={styles.busyTag}>
                    <Text style={styles.busyTagText}>BUSY</Text>
                </View>
            )}
        </View>
    );
});

const PulseHeroSkeleton = memo(function PulseHeroSkeletonComponent() {
    return (
        <View style={styles.pulseSkeletonCard}>
            <View style={styles.pulseSkeletonOrb} />
            <ConnectSkeletonBlock width={120} height={14} radius={8} style={styles.pulseSkeletonLine} />
            <ConnectSkeletonBlock width={180} height={10} radius={6} style={styles.pulseSkeletonLineTight} />
            <ConnectSkeletonBlock width={96} height={10} radius={6} style={styles.pulseSkeletonLineTight} />
            <View style={styles.pulseSkeletonButton}>
                <ConnectSkeletonBlock width={180} height={34} radius={17} />
            </View>
        </View>
    );
});

function PulseTabComponent({
    pulseItems,
    nearbyPros,
    isEmployerRole,
    appliedGigIds,
    hiredProIds,
    radarRefreshing,
    pulseLoading,
    pulseError,
    nearbyProsError,
    pulseAnim,
    onRefreshRadar,
    onRetryPulse,
    onApplyGig,
    onHirePro,
    contentContainerStyle,
}) {
    const navigation = useNavigation();
    const safePulseItems = useMemo(() => (
        Array.isArray(pulseItems)
            ? pulseItems.filter((item) => item && typeof item === 'object')
            : []
    ), [pulseItems]);
    const safeAppliedGigIds = appliedGigIds instanceof Set ? appliedGigIds : new Set();
    const safeHiredProIds = hiredProIds instanceof Set ? hiredProIds : new Set();
    const nearbyGigs = useMemo(() => (
        safePulseItems.filter((item) => {
            const postType = String(item?.postType || '').toLowerCase();
            const jobId = String(item?.jobId || item?.id || '').trim();
            return postType === 'job' && Boolean(jobId);
        })
    ), [safePulseItems]);
    const safeNearbyPros = useMemo(() => (
        Array.isArray(nearbyPros)
            ? nearbyPros.filter((item) => item && typeof item === 'object')
            : []
    ), [nearbyPros]);
    const showPulseLoading = Boolean(pulseLoading) && nearbyGigs.length === 0;

    const pulseScale = pulseAnim.interpolate({
        inputRange: [0.3, 1],
        outputRange: [0.9, 1.08],
    });
    const pulseRadarAnimatedStyle = useMemo(() => ({
        opacity: pulseAnim,
        transform: [{ scale: pulseScale }],
    }), [pulseAnim, pulseScale]);

    const keyExtractor = useCallback((item, index) => String(item?.id || `pulse-${index}`), []);

    const handleOpenGigDetails = useCallback((gig) => {
        const safeGig = (gig && typeof gig === 'object') ? gig : {};
        const jobId = String(safeGig?.jobId || safeGig?.id || '').trim();
        if (!jobId) {
            return;
        }
        navigation.navigate('JobDetails', {
            job: {
                _id: jobId,
                title: String(safeGig?.title || 'Urgent Requirement'),
                companyName: String(safeGig?.companyName || safeGig?.employer || 'Employer'),
                location: String(safeGig?.location || safeGig?.distance || 'Nearby'),
                salaryRange: String(safeGig?.pay || 'Negotiable'),
                description: String(safeGig?.description || '').trim(),
                createdAt: safeGig?.createdAt || null,
                requirements: Array.isArray(safeGig?.requirements) ? safeGig.requirements : [],
            },
            fitReason: 'Live Pulse gig near you.',
            entrySource: 'jobs_tab',
        });
    }, [navigation]);

    const renderGigItem = useCallback(({ item }) => {
        const safeItem = (item && typeof item === 'object') ? item : {};
        const actionId = String(safeItem.jobId || safeItem.id || '').trim();
        const canApply = Boolean(safeItem?.canApply) && Boolean(String(safeItem?.jobId || '').trim());
        const isApplied = canApply && safeAppliedGigIds.has(actionId);
        return (
            <PulseGigCard
                gig={safeItem}
                canApply={canApply}
                isApplied={isApplied}
                onApplyGig={onApplyGig}
                onOpenGigDetails={handleOpenGigDetails}
            />
        );
    }, [safeAppliedGigIds, onApplyGig, handleOpenGigDetails]);

    const listHeader = useMemo(() => (
        <>
            {showPulseLoading ? (
                <PulseHeroSkeleton />
            ) : (
                <View style={styles.pulseCard}>
                    <View style={styles.pulseBgEffect} />
                    <View style={styles.pulseContent}>
                        <Animated.View style={[styles.pulseRadarOuter, pulseRadarAnimatedStyle]}>
                            <View style={styles.pulseRadarInner} />
                        </Animated.View>
                        <Text style={styles.pulseTitle}>Live Radar</Text>
                        <Text style={styles.pulseSub}>{nearbyGigs.length} urgent gigs · {safeNearbyPros.length} pros within 2km</Text>
                        <View style={styles.trendingTag}>
                            <Text style={styles.trendingTagText}>Trending right now</Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.pulseBtn, radarRefreshing && styles.pulseBtnDisabled]}
                            onPress={onRefreshRadar}
                            disabled={radarRefreshing}
                            activeOpacity={0.85}
                        >
                            {radarRefreshing ? <SkeletonLoader width={14} height={14} borderRadius={RADIUS.full} style={styles.buttonLoader} tone="tint" /> : null}
                            <Text style={styles.pulseBtnText}>{radarRefreshing ? 'SCANNING...' : 'SEARCH LOCAL GIGS'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {pulseError && nearbyGigs.length > 0 ? (
                <ConnectEmptyStateCard
                    title="Pulse is showing your last live radar"
                    subtitle={pulseError}
                    actionLabel="Retry"
                    onAction={onRetryPulse || onRefreshRadar}
                    tone="info"
                    inline
                    style={styles.inlineStatusCard}
                />
            ) : null}

            <View style={styles.sectionHeaderRow}>
                <IconMapPin size={16} color={connectPalette.accent} />
                <Text style={styles.sectionTitle}>URGENT GIGS NEAR YOU</Text>
            </View>
        </>
    ), [nearbyGigs.length, safeNearbyPros.length, pulseRadarAnimatedStyle, radarRefreshing, onRefreshRadar, onRetryPulse, pulseError, showPulseLoading]);

    const listFooter = useMemo(() => {
        if (showPulseLoading) {
            return <View style={styles.bottomSpacer} />;
        }
        return (
            <>
                {safeNearbyPros.length > 0 ? (
                    <>
                        <View style={[styles.sectionHeaderRow, styles.sectionHeaderMargin]}>
                            <IconUsers size={16} color={connectPalette.accent} />
                            <Text style={styles.sectionTitle}>PROFESSIONALS READY TO HIRE</Text>
                        </View>
                        {safeNearbyPros.map((pro, index) => {
                            const proId = String(pro?.id || `pro-${index}`);
                            const isRequested = safeHiredProIds.has(proId);
                            return (
                                <PulseProCard key={proId} pro={pro} isRequested={isRequested} onHirePro={onHirePro} />
                            );
                        })}
                    </>
                ) : isEmployerRole ? (
                    nearbyProsError ? (
                        <ConnectEmptyStateCard
                            title="Nearby job seeker matches are unavailable"
                            subtitle={nearbyProsError}
                            actionLabel="Retry"
                            onAction={onRetryPulse || onRefreshRadar}
                            tone="error"
                            style={styles.emptyStateCard}
                        />
                    ) : (
                        <ConnectEmptyStateCard
                            title="No job seekers yet"
                            subtitle="Post jobs and ranked job seeker matches will surface here."
                            style={styles.emptyStateCard}
                        />
                    )
                ) : null}
                <View style={styles.bottomSpacer} />
            </>
        );
    }, [safeNearbyPros, safeHiredProIds, onHirePro, isEmployerRole, showPulseLoading, nearbyProsError, onRetryPulse, onRefreshRadar]);

    return (
        <FlatList
            data={nearbyGigs}
            keyExtractor={keyExtractor}
            renderItem={renderGigItem}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            ListEmptyComponent={showPulseLoading ? (
                <ConnectSkeletonList count={3} />
            ) : (
                pulseError ? (
                    <ConnectEmptyStateCard
                        title="Pulse is unavailable right now"
                        subtitle={pulseError}
                        actionLabel="Retry"
                        onAction={onRetryPulse || onRefreshRadar}
                        tone="error"
                        style={styles.emptyStateCard}
                    />
                ) : (
                    <ConnectEmptyStateCard
                        title="No posts yet"
                        subtitle="Urgent gigs will appear here when employers publish local jobs."
                        style={styles.emptyStateCard}
                    />
                )
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={contentContainerStyle}
            removeClippedSubviews={Platform.OS === 'android'}
            windowSize={10}
            maxToRenderPerBatch={8}
            initialNumToRender={8}
        />
    );
}

export default memo(PulseTabComponent);

const styles = StyleSheet.create({
    pulseCard: {
        backgroundColor: '#1b1430',
        borderRadius: 28,
        overflow: 'hidden',
        minHeight: 290,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#2a1f4d',
        shadowColor: '#1b1430',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 22,
        elevation: 4,
    },
    pulseBgEffect: {
        position: 'absolute',
        top: -50,
        left: -50,
        right: -50,
        bottom: -50,
        backgroundColor: connectPalette.accent,
        opacity: 0.18,
        borderRadius: RADIUS.full,
    },
    pulseContent: {
        position: 'relative',
        zIndex: 10,
        padding: SPACING.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pulseRadarOuter: {
        width: 80,
        height: 80,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.accent,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        borderWidth: 3,
        borderColor: '#6f4cf6',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 18,
        elevation: 3,
    },
    pulseRadarInner: {
        width: 12,
        height: 12,
        borderRadius: RADIUS.full,
        backgroundColor: '#e5d6ff',
    },
    pulseTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: connectPalette.surface,
        marginBottom: 8,
    },
    pulseSub: {
        fontSize: 12,
        color: '#c9c2e6',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 18,
        paddingHorizontal: 16,
    },
    trendingTag: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.25)',
        backgroundColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: 10,
        paddingVertical: 5,
        marginBottom: 12,
    },
    trendingTagText: {
        color: '#f8fafc',
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.35,
    },
    pulseBtn: {
        backgroundColor: '#6f4cf6',
        paddingHorizontal: SPACING.xl,
        paddingVertical: 14,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
        elevation: 3,
    },
    pulseBtnDisabled: {
        opacity: 0.75,
    },
    buttonLoader: {
        marginRight: 8,
    },
    pulseBtnText: {
        fontSize: 14,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    sectionHeaderMargin: {
        marginTop: 8,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.text,
        letterSpacing: 0.5,
    },
    gigCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#efe9f8',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    gigTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    gigTopLeft: {
        flex: 1,
        marginRight: 8,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 2,
    },
    gigTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: connectPalette.text,
        marginRight: 6,
    },
    gigEmployer: {
        fontSize: 10,
        fontWeight: '700',
        color: '#7c8398',
        marginTop: 2,
    },
    gigProofRow: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    gigProofText: {
        fontSize: 10,
        color: '#6d7487',
        fontWeight: '700',
    },
    gigProofDot: {
        fontSize: 10,
        color: '#94a3b8',
    },
    urgentBadge: {
        backgroundColor: '#ffe4e6',
        borderWidth: 1,
        borderColor: '#fecdd3',
        borderRadius: RADIUS.full,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginLeft: 6,
    },
    urgentBadgeText: {
        fontSize: 9,
        fontWeight: '900',
        color: '#b91c1c',
    },
    categoryBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e8e1f5',
    },
    categoryBadgeText: {
        fontSize: 9,
        fontWeight: '800',
    },
    gigBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    gigMeta: {
        fontSize: 10,
        color: '#7c8398',
        fontWeight: '600',
    },
    gigActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    gigBottomRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginLeft: 'auto',
    },
    gigPay: {
        fontSize: 15,
        fontWeight: '900',
        color: '#6a41d8',
    },
    detailsBtn: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f7f3ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    detailsBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: '#6a41d8',
        letterSpacing: 0.2,
    },
    applyBtn: {
        backgroundColor: '#6f4cf6',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
    },
    applyBtnDone: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    applyBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    applyBtnTextDone: {
        color: '#6a41d8',
    },
    updateBadge: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e7def8',
        backgroundColor: '#faf9fd',
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    updateBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#64748b',
        letterSpacing: 0.3,
    },
    proCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#efe9f8',
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    proAvatarWrap: {
        position: 'relative',
        marginRight: 12,
    },
    proAvatar: {
        width: 48,
        height: 48,
        borderRadius: RADIUS.full,
        backgroundColor: '#f3eef8',
        borderWidth: 1,
        borderColor: '#e6def8',
    },
    availabilityDot: {
        position: 'absolute',
        bottom: -1,
        right: -1,
        width: 14,
        height: 14,
        borderRadius: RADIUS.full,
        borderWidth: 2,
        borderColor: connectPalette.surface,
    },
    proMain: {
        flex: 1,
    },
    proName: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
    },
    proMeta: {
        fontSize: 10,
        fontWeight: '600',
        color: '#7c8398',
        marginTop: 2,
    },
    karmaBadge: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: RADIUS.md,
    },
    karmaBadgeText: {
        fontSize: 10,
        fontWeight: '900',
        color: '#6a41d8',
    },
    hireBtn: {
        backgroundColor: '#6f4cf6',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        marginLeft: 8,
    },
    hireBtnDone: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    hireBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    hireBtnTextDone: {
        color: '#6a41d8',
    },
    busyTag: {
        backgroundColor: '#faf9fd',
        borderWidth: 1,
        borderColor: '#e7def8',
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        marginLeft: 8,
    },
    busyTagText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#7c8398',
    },
    emptyStateCard: {
        marginTop: 14,
    },
    inlineStatusCard: {
        marginBottom: 14,
    },
    pulseSkeletonCard: {
        backgroundColor: '#201538',
        borderRadius: 28,
        paddingVertical: 26,
        paddingHorizontal: 20,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#2f2352',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1b1430',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 22,
        elevation: 4,
    },
    pulseSkeletonOrb: {
        width: 84,
        height: 84,
        borderRadius: 42,
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.18)',
        marginBottom: 18,
    },
    pulseSkeletonLine: {
        marginTop: 6,
    },
    pulseSkeletonLineTight: {
        marginTop: 8,
    },
    pulseSkeletonButton: {
        marginTop: 18,
    },
    bottomSpacer: {
        height: 32,
    },
});
