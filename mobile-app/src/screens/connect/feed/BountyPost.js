import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RADIUS } from '../../../theme/theme';

function BountyPostComponent({ reward }) {
    return (
        <View style={styles.container}>
            <View style={styles.labelPill}>
                <Text style={styles.label}>REFERRAL BOUNTY</Text>
            </View>
            <Text style={styles.reward}>{reward || '₹2,000'}</Text>
            <LinearGradient
                colors={['#8b5cf6', '#6f4cf6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.button}
            >
                <Text style={styles.buttonText}>REFER A PEER</Text>
            </LinearGradient>
        </View>
    );
}

export default memo(BountyPostComponent);

const styles = StyleSheet.create({
    container: {
        position: 'relative',
        zIndex: 10,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#e7defc',
        borderRadius: 18,
        backgroundColor: '#f8f5ff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 14,
        elevation: 2,
    },
    labelPill: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        backgroundColor: '#efe9ff',
        borderWidth: 1,
        borderColor: '#e2d7ff',
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginBottom: 8,
    },
    label: {
        color: '#6f4cf6',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    reward: {
        color: '#1f1b2e',
        fontSize: 24,
        fontWeight: '900',
        marginBottom: 10,
        letterSpacing: -0.3,
    },
    button: {
        paddingVertical: 11,
        alignItems: 'center',
        borderRadius: 14,
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 12.5,
        fontWeight: '800',
    },
});
