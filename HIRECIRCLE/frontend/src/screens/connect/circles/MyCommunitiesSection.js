import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IconCheck } from '../../../components/Icons';
import CircleCard from './CircleCard';
import { connectPalette } from '../connectPalette';

function MyCommunitiesSectionComponent({ circles, onOpenCircle }) {
    const safeCircles = useMemo(() => (
        (Array.isArray(circles) ? circles : []).filter((item) => (
            item
            && typeof item === 'object'
            && String(item?._id || '').trim().length > 0
        ))
    ), [circles]);

    const cards = useMemo(() => (
        safeCircles.map((item) => (
            <CircleCard
                key={item._id}
                variant="joined"
                circle={item}
                onOpenCircle={onOpenCircle}
            />
        ))
    ), [safeCircles, onOpenCircle]);

    if (!safeCircles.length) return null;

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
