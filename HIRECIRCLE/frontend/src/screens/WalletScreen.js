import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getWallet, getMyWithdrawals } from '../services/FinancialService';

export default function WalletScreen({ navigation }) {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [wallet, setWallet] = useState(null);
    const [withdrawals, setWithdrawals] = useState([]);

    const load = useCallback(async () => {
        const [walletData, withdrawalsData] = await Promise.all([
            getWallet(),
            getMyWithdrawals(),
        ]);
        setWallet(walletData);
        setWithdrawals(withdrawalsData.slice(0, 5));
    }, []);

    useFocusEffect(useCallback(() => {
        let active = true;
        setLoading(true);
        load()
            .catch(() => null)
            .finally(() => {
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
            <Text style={styles.title}>Wallet</Text>
            <View style={styles.card}>
                <Text style={styles.metricLabel}>Available Balance</Text>
                <Text style={styles.metricValue}>{wallet?.currency || 'INR'} {Number(wallet?.balance || 0).toFixed(2)}</Text>
                <Text style={styles.metricLabel}>Pending Balance</Text>
                <Text style={styles.metricSecondary}>{wallet?.currency || 'INR'} {Number(wallet?.pendingBalance || 0).toFixed(2)}</Text>
                <Text style={styles.metricLabel}>KYC Status</Text>
                <Text style={styles.metricSecondary}>{String(wallet?.kycStatus || 'not_started').toUpperCase()}</Text>
            </View>

            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('TransactionHistory')}>
                <Text style={styles.actionText}>View Transactions</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('FundEscrow')}>
                <Text style={styles.actionText}>Fund Escrow</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('WithdrawRequest')}>
                <Text style={styles.actionText}>Request Withdrawal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={() => navigation.navigate('DisputeForm')}>
                <Text style={styles.actionText}>Raise Dispute</Text>
            </TouchableOpacity>

            <View style={styles.card}>
                <Text style={styles.sectionTitle}>Recent Withdrawals</Text>
                {withdrawals.length === 0 ? (
                    <Text style={styles.emptyText}>No withdrawals yet.</Text>
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
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        gap: 6,
    },
    metricLabel: {
        fontSize: 12,
        color: '#64748b',
    },
    metricValue: {
        fontSize: 30,
        fontWeight: '700',
        color: '#0f172a',
    },
    metricSecondary: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1e293b',
    },
    actionButton: {
        backgroundColor: '#1d4ed8',
        borderRadius: 10,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    actionText: {
        color: '#ffffff',
        fontWeight: '600',
        textAlign: 'center',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 8,
    },
    emptyText: {
        fontSize: 13,
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
