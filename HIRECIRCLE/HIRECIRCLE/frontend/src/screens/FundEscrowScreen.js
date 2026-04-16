import React, { useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { fundEscrow } from '../services/FinancialService';

export default function FundEscrowScreen({ navigation }) {
    const [jobId, setJobId] = useState('');
    const [workerId, setWorkerId] = useState('');
    const [amount, setAmount] = useState('');
    const [paymentRecordId, setPaymentRecordId] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        if (!jobId || !workerId || !amount || !paymentRecordId) {
            Alert.alert('Missing fields', 'Fill job, worker, amount, and verified payment record id.');
            return;
        }

        setSubmitting(true);
        try {
            const result = await fundEscrow({
                jobId,
                workerId,
                amount: Number(amount),
                paymentRecordId,
            });

            Alert.alert('Escrow funded', `Escrow ${result.escrowId} is ${result.status}.`);
            navigation.navigate('EscrowDetail', { escrowId: result.escrowId });
        } catch (error) {
            Alert.alert('Escrow funding failed', error?.response?.data?.message || 'Unable to fund escrow');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
                <Text style={styles.title}>Fund Escrow</Text>
                <Text style={styles.subtitle}>Use a server-verified `paymentRecordId` from payment verification.</Text>

                <View style={styles.card}>
                    <Text style={styles.label}>Job ID</Text>
                    <TextInput style={styles.input} value={jobId} onChangeText={setJobId} autoCapitalize="none" />

                    <Text style={styles.label}>Worker User ID</Text>
                    <TextInput style={styles.input} value={workerId} onChangeText={setWorkerId} autoCapitalize="none" />

                    <Text style={styles.label}>Amount</Text>
                    <TextInput
                        style={styles.input}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        autoCapitalize="none"
                    />

                    <Text style={styles.label}>Payment Record ID</Text>
                    <TextInput
                        style={styles.input}
                        value={paymentRecordId}
                        onChangeText={setPaymentRecordId}
                        autoCapitalize="none"
                    />
                </View>

                <TouchableOpacity style={styles.button} onPress={submit} disabled={submitting}>
                    <Text style={styles.buttonText}>{submitting ? 'Funding...' : 'Fund Escrow'}</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>
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
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#0f172a',
    },
    subtitle: {
        fontSize: 12,
        color: '#64748b',
    },
    card: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 12,
        padding: 16,
        gap: 6,
    },
    label: {
        fontSize: 12,
        color: '#475569',
    },
    input: {
        borderWidth: 1,
        borderColor: '#cbd5e1',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 9,
        fontSize: 14,
        backgroundColor: '#ffffff',
    },
    button: {
        backgroundColor: '#1d4ed8',
        borderRadius: 10,
        paddingVertical: 12,
    },
    buttonText: {
        color: '#ffffff',
        textAlign: 'center',
        fontWeight: '600',
    },
});
