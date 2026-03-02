import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyWithdrawals, requestWithdrawal } from '../services/FinancialService';

export default function WithdrawRequestScreen() {
    const [amount, setAmount] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [withdrawals, setWithdrawals] = useState([]);

    const load = useCallback(async () => {
        const data = await getMyWithdrawals();
        setWithdrawals(data);
    }, []);

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

    const onRefresh = async () => {
        setRefreshing(true);
        try {
            await load();
        } finally {
            setRefreshing(false);
        }
    };

    const submit = async () => {
        if (!amount) {
            Alert.alert('Missing amount', 'Enter withdrawal amount.');
            return;
        }

        setSubmitting(true);
        try {
            const withdrawal = await requestWithdrawal({ amount: Number(amount), currency: 'INR' });
            Alert.alert('Withdrawal requested', `Status: ${withdrawal.status}`);
            setAmount('');
            await load();
        } catch (error) {
            Alert.alert('Request failed', error?.response?.data?.message || 'Unable to request withdrawal');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator color="#2563eb" />
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
            <Text style={styles.title}>Withdraw Request</Text>
            <View style={styles.card}>
                <Text style={styles.label}>Amount (INR)</Text>
                <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                />
                <TouchableOpacity style={styles.button} onPress={submit} disabled={submitting}>
                    <Text style={styles.buttonText}>{submitting ? 'Submitting...' : 'Submit Request'}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.card}>
                <Text style={styles.sectionTitle}>My Requests</Text>
                {withdrawals.length === 0 ? (
                    <Text style={styles.emptyText}>No withdrawal requests yet.</Text>
                ) : withdrawals.map((item) => (
                    <View key={String(item._id)} style={styles.row}>
                        <Text style={styles.rowTitle}>{item.currency} {Number(item.amount || 0).toFixed(2)}</Text>
                        <Text style={styles.rowMeta}>{String(item.status || '').toUpperCase()}</Text>
                    </View>
                ))}
            </View>
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
        justifyContent: 'center',
        alignItems: 'center',
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
        gap: 8,
    },
    label: {
        fontSize: 12,
        color: '#64748b',
    },
    input: {
        borderWidth: 1,
        borderColor: '#cbd5e1',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 9,
        fontSize: 14,
    },
    button: {
        marginTop: 6,
        backgroundColor: '#1d4ed8',
        borderRadius: 8,
        paddingVertical: 11,
    },
    buttonText: {
        color: '#ffffff',
        textAlign: 'center',
        fontWeight: '600',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0f172a',
    },
    emptyText: {
        color: '#64748b',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTopWidth: 1,
        borderColor: '#f1f5f9',
        paddingVertical: 10,
    },
    rowTitle: {
        fontWeight: '600',
        color: '#0f172a',
    },
    rowMeta: {
        color: '#475569',
    },
});
