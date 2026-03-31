import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTransactions } from '../services/FinancialService';

export default function TransactionHistoryScreen() {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [transactions, setTransactions] = useState([]);

    const load = useCallback(async () => {
        const data = await getTransactions({ limit: 100, offset: 0 });
        setTransactions(data);
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
            <Text style={styles.title}>Transaction History</Text>
            {transactions.length === 0 ? (
                <View style={styles.card}><Text style={styles.emptyText}>No transactions found.</Text></View>
            ) : transactions.map((item) => (
                <View style={styles.card} key={String(item._id)}>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Type</Text>
                        <Text style={styles.rowValue}>{String(item.type || '').toUpperCase()}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Source</Text>
                        <Text style={styles.rowValue}>{String(item.source || '').replace(/_/g, ' ')}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Amount</Text>
                        <Text style={styles.rowValue}>{item.currency} {Number(item.amount || 0).toFixed(2)}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Status</Text>
                        <Text style={styles.rowValue}>{String(item.status || '').toUpperCase()}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>Reference</Text>
                        <Text style={styles.rowValue}>{String(item.referenceId || '-')}</Text>
                    </View>
                </View>
            ))}
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
        padding: 14,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        gap: 6,
    },
    emptyText: {
        color: '#64748b',
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    rowLabel: {
        color: '#64748b',
        fontSize: 12,
    },
    rowValue: {
        color: '#0f172a',
        fontSize: 12,
        maxWidth: '70%',
        textAlign: 'right',
    },
});
