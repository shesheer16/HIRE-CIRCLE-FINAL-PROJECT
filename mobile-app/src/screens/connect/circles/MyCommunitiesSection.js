import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconCheck } from '../../../components/Icons';
import CircleCard from './CircleCard';
import { connectPalette } from '../connectPalette';

function MyCommunitiesSectionComponent({ circles, onOpenCircle }) {
    const cards = useMemo(() => (
        circles.map((item) => (
            <CircleCard
                key={item._id}
                variant="joined"
                circle={item}
                onOpenCircle={onOpenCircle}
            />
        ))
    ), [circles, onOpenCircle]);

    if (!circles || circles.length === 0) return null;

    return (
        <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
                <IconCheck size={16} color={connectPalette.accent} />
                <Text style={styles.sectionTitle}>MY COMMUNITIES</Text>
            </View>
            {cards}
        </View>
    );
}

export default memo(MyCommunitiesSectionComponent);

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
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
