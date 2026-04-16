import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getEscrowDetail, releaseEscrow, refundEscrow } from '../services/FinancialService';

export default function EscrowDetailScreen({ route }) {
    const escrowId = route.params?.escrowId;
    const [loading, setLoading] = useState(true);
    const [escrow, setEscrow] = useState(null);

    const load = useCallback(async () => {
        if (!escrowId) return;
        const data = await getEscrowDetail(escrowId);
        setEscrow(data);
    }, [escrowId]);

    useFocusEffect(useCallback(() => {
        let active = true;
        setLoading(true);
        load().catch(() => null).finally(() => {
            if (active) setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [load]));

    const handleRelease = () => {
        Alert.alert('Release Escrow', 'Release funds to worker?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Release',
                onPress: async () => {
                    try {
                        await releaseEscrow(escrowId);
                        await load();
                    } catch (error) {
                        Alert.alert('Release failed', error?.response?.data?.message || 'Unable to release escrow');
                    }
                },
            },
        ]);
    };

    const handleRefund = () => {
        Alert.alert('Refund Escrow', 'Refund escrow to employer?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Refund',
                onPress: async () => {
                    try {
                        await refundEscrow(escrowId, 'manual_refund_from_mobile');
                        await load();
                    } catch (error) {
                        Alert.alert('Refund failed', error?.response?.data?.message || 'Unable to refund escrow');
                    }
                },
            },
        ]);
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator color="#2563eb" />
            </View>
        );
    }

    if (!escrow) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>Escrow not found.</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.title}>Escrow Detail</Text>
            <View style={styles.card}>
                <Text style={styles.label}>Escrow ID</Text>
                <Text style={styles.value}>{String(escrow._id)}</Text>
                <Text style={styles.label}>Status</Text>
                <Text style={styles.value}>{String(escrow.status || '').toUpperCase()}</Text>
                <Text style={styles.label}>Amount</Text>
                <Text style={styles.value}>{escrow.currency} {Number(escrow.amount || 0).toFixed(2)}</Text>
                <Text style={styles.label}>Employer</Text>
                <Text style={styles.value}>{escrow?.employerId?.email || '-'}</Text>
                <Text style={styles.label}>Worker</Text>
                <Text style={styles.value}>{escrow?.workerId?.email || '-'}</Text>
            </View>

            <TouchableOpacity style={styles.actionButton} onPress={handleRelease}>
                <Text style={styles.actionText}>Release Funds</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.refundButton]} onPress={handleRefund}>
                <Text style={styles.actionText}>Refund Escrow</Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    content: {
        padding: 16,
        gap: 12,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#0f172a',
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 16,
        gap: 6,
    },
    label: {
        fontSize: 12,
        color: '#64748b',
    },
    value: {
        fontSize: 13,
        color: '#0f172a',
    },
    actionButton: {
        backgroundColor: '#16a34a',
        borderRadius: 10,
        paddingVertical: 12,
    },
    refundButton: {
        backgroundColor: '#dc2626',
    },
    actionText: {
        color: '#ffffff',
        textAlign: 'center',
        fontWeight: '600',
    },
    emptyText: {
        color: '#64748b',
    },
});
