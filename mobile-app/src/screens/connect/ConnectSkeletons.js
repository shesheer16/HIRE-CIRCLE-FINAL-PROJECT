import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import SkeletonLoader from '../../components/SkeletonLoader';
import { RADIUS } from '../../theme/theme';

const ConnectSkeletonBlock = memo(function ConnectSkeletonBlockComponent({
    width,
    height,
    radius = RADIUS.md,
    style,
}) {
    return (
        <SkeletonLoader
            width={width}
            height={height}
            borderRadius={radius}
            style={style}
            tone="tint"
        />
    );
});

const ConnectSkeletonCard = memo(function ConnectSkeletonCardComponent({ children, style }) {
    return (
        <View style={[styles.card, style]}>
            {children}
        </View>
    );
});

const ConnectSkeletonList = memo(function ConnectSkeletonListComponent({ count = 3 }) {
    const items = Array.from({ length: Math.max(1, count) });
    return (
        <View>
            {items.map((_, index) => (
                <ConnectSkeletonCard key={`connect-skeleton-${index}`}>
                    <View style={styles.row}>
                        <ConnectSkeletonBlock width={38} height={38} radius={19} />
                        <View style={styles.column}>
                            <ConnectSkeletonBlock width="62%" height={12} radius={7} />
                            <ConnectSkeletonBlock width="40%" height={10} radius={6} style={styles.lineTight} />
                        </View>
                    </View>
                    <ConnectSkeletonBlock width="95%" height={12} radius={6} style={styles.lineLoose} />
                    <ConnectSkeletonBlock width="82%" height={12} radius={6} style={styles.lineTight} />
                    <View style={styles.chipRow}>
                        <ConnectSkeletonBlock width={72} height={24} radius={12} />
                        <ConnectSkeletonBlock width={88} height={24} radius={12} />
                        <ConnectSkeletonBlock width={56} height={24} radius={12} />
                    </View>
                </ConnectSkeletonCard>
            ))}
        </View>
    );
});

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderColor: '#efe9f8',
        backgroundColor: '#ffffff',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 14,
        marginHorizontal: 10,
        marginBottom: 12,
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 18,
        elevation: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    column: {
        flex: 1,
        minWidth: 0,
    },
    lineLoose: {
        marginTop: 12,
    },
    lineTight: {
        marginTop: 8,
    },
    chipRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
    },
});

export {
    ConnectSkeletonBlock,
    ConnectSkeletonCard,
    ConnectSkeletonList,
};
