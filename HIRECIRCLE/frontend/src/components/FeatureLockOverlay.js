import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function FeatureLockOverlay({
    locked,
    title = 'Premium feature',
    subtitle = 'Upgrade to unlock this capability.',
    onUnlock,
    unlockLabel = 'Unlock',
}) {
    if (!locked) return null;

    return (
        <View style={styles.overlay}>
            <View style={styles.card}>
                <Text style={styles.badge}>PREMIUM</Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
                {onUnlock ? (
                    <TouchableOpacity onPress={onUnlock} style={styles.btn} activeOpacity={0.85}>
                        <Text style={styles.btnText}>{unlockLabel}</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(15,23,42,0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 14,
        zIndex: 20,
    },
    card: {
        width: '84%',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
    },
    badge: {
        alignSelf: 'flex-start',
        fontSize: 10,
        fontWeight: '900',
        color: '#6d28d9',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    title: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 12,
        lineHeight: 17,
        color: '#475569',
    },
    btn: {
        marginTop: 10,
        alignSelf: 'flex-start',
        borderRadius: 999,
        backgroundColor: '#6d28d9',
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    btnText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
    },
});
