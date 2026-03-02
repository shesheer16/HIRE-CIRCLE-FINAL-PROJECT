import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSearch } from '../../../components/Icons';
import EmptyState from '../../../components/EmptyState';
import MyCommunitiesSection from './MyCommunitiesSection';
import CircleCard from './CircleCard';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

function CirclesTabComponent({
    circles,
    joinedCircles,
    onOpenCircle,
    onJoinCircle,
    contentContainerStyle,
}) {
    const joined = useMemo(() => (
        circles.filter((circle) => joinedCircles.has(circle._id))
    ), [circles, joinedCircles]);

    const explore = useMemo(() => (
        circles.filter((circle) => !joinedCircles.has(circle._id))
    ), [circles, joinedCircles]);

    const keyExtractor = useCallback((item) => String(item._id), []);

    const renderExploreItem = useCallback(({ item }) => (
        <CircleCard
            variant="explore"
            circle={item}
            onJoinCircle={onJoinCircle}
        />
    ), [onJoinCircle]);

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

            <View style={styles.sectionHeaderRow}>
                <IconSearch size={16} color={connectPalette.subtle} />
                <Text style={styles.sectionTitle}>EXPLORE CATEGORIES</Text>
            </View>
        </>
    ), [joined, onOpenCircle]);

    const listEmpty = useMemo(() => (
        <EmptyState
            icon="👥"
            title="No communities yet"
            subtitle="Circles appear here once created"
        />
    ), []);

    return (
        <FlatList
            data={explore}
            keyExtractor={keyExtractor}
            renderItem={renderExploreItem}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            ListFooterComponent={<View style={styles.bottomGap} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={contentContainerStyle}
            removeClippedSubviews
            windowSize={10}
            maxToRenderPerBatch={8}
            initialNumToRender={8}
        />
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
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.text,
        letterSpacing: 1,
    },
});
