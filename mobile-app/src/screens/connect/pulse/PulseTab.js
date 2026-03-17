import React, { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Animated, FlatList, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { IconMapPin, IconUsers } from '../../../components/Icons';
import { RADIUS, SPACING } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';
import SkeletonLoader from '../../../components/SkeletonLoader';
import { ConnectSkeletonBlock, ConnectSkeletonList } from '../ConnectSkeletons';
import ConnectEmptyStateCard from '../ConnectEmptyState';

const PulseGigCard = memo(function PulseGigCardComponent({
    gig,
    isEmployerView,
    canApply,
    isApplied,
    onOpenGigDetails,
}) {
    const availabilityLabel = isEmployerView
        ? 'Employer view'
        : (isApplied ? 'Applied' : (canApply ? 'Apply in details' : 'Profile needed'));

    const handleOpenDetails = useCallback(() => {
        onOpenGigDetails?.(gig);
    }, [gig, onOpenGigDetails]);

    return (
        <View style={styles.gigCard}>
            <View style={styles.gigHeaderRow}>
                <View style={styles.gigTitleWrap}>
                    <Text style={styles.gigTitle} numberOfLines={1}>{gig.title}</Text>
                    <View style={styles.gigMetaRow}>
                        <Text style={styles.gigLocation} numberOfLines={1}>{gig.distance || gig.location || 'Nearby'}</Text>
                        <Text style={styles.gigMetaDot}>•</Text>
                        <Text style={styles.gigPay} numberOfLines={1}>{gig.pay || 'Negotiable'}</Text>
                    </View>
                </View>
                <View style={styles.gigSideMeta}>
                    {gig.urgent ? (
                        <View style={styles.urgentBadge}>
                            <Text style={styles.urgentBadgeText}>URGENT</Text>
                        </View>
                    ) : null}
                    <Text style={styles.gigTimePosted}>{gig.timePosted || 'Just now'}</Text>
                </View>
            </View>

            <View style={styles.gigActionRow}>
                <View style={[
                    styles.statusPill,
                    isEmployerView
                        ? styles.statusPillLocked
                        : (isApplied ? styles.statusPillApplied : (canApply ? styles.statusPillReady : styles.statusPillLocked)),
                ]}>
                    <Text style={[
                        styles.statusPillText,
                        isEmployerView
                            ? styles.statusPillTextLocked
                            : (isApplied ? styles.statusPillTextApplied : (canApply ? styles.statusPillTextReady : styles.statusPillTextLocked)),
                    ]}>
                        {availabilityLabel}
                    </Text>
                </View>
                <TouchableOpacity style={styles.detailsBtn} onPress={handleOpenDetails} activeOpacity={0.88}>
                    <Text style={styles.detailsBtnText}>SEE DETAILS</Text>
                </TouchableOpacity>
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
    const [loadCapTriggered, setLoadCapTriggered] = useState(false);
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
    const showPulseLoading = Boolean(pulseLoading) && nearbyGigs.length === 0 && !loadCapTriggered;
    const loadCapRef = useRef(null);
    useEffect(() => {
        if (pulseLoading && nearbyGigs.length === 0) {
            loadCapRef.current = setTimeout(() => {
                if (nearbyGigs.length === 0) {
                    setLoadCapTriggered(true);
                    onRetryPulse?.();
                }
            }, 2000);
        }
        return () => {
            if (loadCapRef.current) clearTimeout(loadCapRef.current);
        };
    }, [nearbyGigs.length, onRetryPulse, pulseLoading]);

    useEffect(() => {
        if (!pulseLoading || nearbyGigs.length > 0) {
            setLoadCapTriggered(false);
        }
    }, [nearbyGigs.length, pulseLoading]);

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
            entrySource: 'pulse_tab',
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
                isEmployerView={isEmployerRole}
                canApply={canApply}
                isApplied={isApplied}
                onOpenGigDetails={handleOpenGigDetails}
            />
        );
    }, [isEmployerRole, safeAppliedGigIds, handleOpenGigDetails]);

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
                    title="Showing your last radar"
                    subtitle="We couldn't refresh just now. Pull to refresh anytime."
                    actionLabel="Try again"
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
                        title="No live gigs to show"
                        subtitle="We couldn't load new gigs right now. Pull to refresh."
                        actionLabel="Try again"
                        onAction={onRetryPulse || onRefreshRadar}
                        tone="info"
                        style={styles.emptyStateCard}
                    />
                ) : (
                    <ConnectEmptyStateCard
                        title="No live gigs yet"
                        subtitle="Urgent gigs will appear here as soon as employers publish nearby jobs."
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
        paddingHorizontal: 14,
        paddingVertical: 13,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#efe9f8',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 16,
        elevation: 2,
    },
    gigHeaderRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 12,
        gap: 10,
    },
    gigTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    gigTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
        lineHeight: 19,
    },
    gigMetaRow: {
        marginTop: 5,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    gigLocation: {
        flexShrink: 1,
        fontSize: 11,
        fontWeight: '700',
        color: '#7b8498',
    },
    gigMetaDot: {
        fontSize: 11,
        color: '#a1a8ba',
    },
    gigPay: {
        fontSize: 11,
        fontWeight: '900',
        color: '#5b48f2',
    },
    gigSideMeta: {
        alignItems: 'flex-end',
        gap: 6,
    },
    urgentBadge: {
        backgroundColor: '#fff1f2',
        borderWidth: 1,
        borderColor: '#fecdd3',
        borderRadius: RADIUS.full,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    urgentBadgeText: {
        fontSize: 9,
        fontWeight: '900',
        color: '#b91c1c',
        letterSpacing: 0.2,
    },
    gigTimePosted: {
        fontSize: 10,
        fontWeight: '700',
        color: '#8b93a7',
    },
    gigActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    statusPill: {
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    statusPillReady: {
        borderColor: '#c7d2fe',
        backgroundColor: '#eef2ff',
    },
    statusPillApplied: {
        borderColor: '#bbf7d0',
        backgroundColor: '#f0fdf4',
    },
    statusPillLocked: {
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
    },
    statusPillText: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    statusPillTextReady: {
        color: '#4338ca',
    },
    statusPillTextApplied: {
        color: '#15803d',
    },
    statusPillTextLocked: {
        color: '#64748b',
    },
    detailsBtn: {
        borderRadius: 999,
        backgroundColor: '#5b48f2',
        paddingHorizontal: 14,
        paddingVertical: 9,
        shadowColor: '#5b48f2',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.14,
        shadowRadius: 10,
        elevation: 2,
    },
    detailsBtnText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
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
