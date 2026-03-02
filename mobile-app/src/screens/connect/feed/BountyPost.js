import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RADIUS } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

function BountyPostComponent({ reward }) {
    return (
        <View style={styles.container}>
            <Text style={styles.label}>REFERRAL BOUNTY</Text>
            <Text style={styles.reward}>{reward || '₹2,000'}</Text>
            <View style={styles.button}>
                <Text style={styles.buttonText}>REFER A PEER</Text>
            </View>
        </View>
    );
}

export default memo(BountyPostComponent);

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 10,
        marginBottom: 16,
    },
    label: {
        color: '#e9ddff',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1,
        marginBottom: 4,
    },
    reward: {
        color: connectPalette.surface,
        fontSize: 24,
        fontWeight: '900',
        marginBottom: 12,
    },
    button: {
        backgroundColor: connectPalette.surface,
        paddingVertical: 10,
        alignItems: 'center',
        borderRadius: RADIUS.md,
    },
    buttonText: {
        color: connectPalette.accentDark,
        fontSize: 12,
        fontWeight: '900',
    },
});
