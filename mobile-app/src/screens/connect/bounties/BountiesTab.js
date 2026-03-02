import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BountyCard from './BountyCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

function BountiesTabComponent({
    bounties,
    referredBountyIds,
    totalEarned,
    onOpenReferModal,
    contentContainerStyle,
}) {
    const keyExtractor = useCallback((item) => String(item.id), []);

    const isReferred = useCallback((id) => (
        referredBountyIds.has(id)
    ), [referredBountyIds]);

    const renderItem = useCallback(({ item }) => (
        <BountyCard
            bounty={item}
            isReferred={isReferred(item.id)}
            onReferPress={onOpenReferModal}
        />
    ), [isReferred, onOpenReferModal]);

    const listHeader = useMemo(() => (
        <LinearGradient
            colors={[connectPalette.accent, connectPalette.accentDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.hero}
        >
            <Text style={styles.heroLabel}>REFERRAL ECONOMY</Text>
            <Text style={styles.heroTitle}>Earn by Referring</Text>
            <Text style={styles.heroSub}>{bounties.length} active bounties available</Text>
            <View style={styles.earningsBox}>
                <View>
                    <Text style={styles.earningsLabel}>Your Earnings</Text>
                    <Text style={styles.earningsValue}>₹{totalEarned.toLocaleString()}</Text>
                </View>
                <Text style={styles.earningsIcon}>💰</Text>
            </View>
        </LinearGradient>
    ), [bounties.length, totalEarned]);

    const listFooter = useMemo(() => (
        <View style={styles.bottomSpacer} />
    ), []);

    return (
        <FlatList
            data={bounties}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            contentContainerStyle={contentContainerStyle}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            windowSize={10}
            maxToRenderPerBatch={8}
            initialNumToRender={6}
        />
    );
}

export default memo(BountiesTabComponent);

const styles = StyleSheet.create({
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
    bottomSpacer: {
        height: 32,
    },
});
