import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function NetworkRetryBanner({ visible, message, onRetry, onDismiss }) {
    if (!visible) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.message}>{message || 'Network unavailable. Please retry.'}</Text>
            <View style={styles.actions}>
                <TouchableOpacity style={styles.actionButton} onPress={onRetry} activeOpacity={0.8}>
                    <Text style={styles.actionText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dismissButton} onPress={onDismiss} activeOpacity={0.8}>
                    <Text style={styles.dismissText}>Dismiss</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 16,
        zIndex: 10000,
        borderRadius: 14,
        backgroundColor: '#1e293b',
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#334155',
    },
    message: {
        color: '#e2e8f0',
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 10,
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
    },
    actionButton: {
        borderRadius: 10,
        backgroundColor: '#2563eb',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    actionText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
    },
    dismissButton: {
        borderRadius: 10,
        backgroundColor: '#334155',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    dismissText: {
        color: '#cbd5e1',
        fontSize: 13,
        fontWeight: '600',
    },
});
