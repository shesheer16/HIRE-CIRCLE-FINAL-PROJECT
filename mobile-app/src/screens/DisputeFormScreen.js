import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { raiseDispute } from '../services/FinancialService';

export default function DisputeFormScreen() {
    const [escrowId, setEscrowId] = useState('');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async () => {
        if (!escrowId || !reason) {
            Alert.alert('Missing fields', 'Enter escrow id and reason.');
            return;
        }

        setSubmitting(true);
        try {
            const result = await raiseDispute({ escrowId, reason });
            Alert.alert('Dispute raised', `Status: ${result.dispute?.status || 'open'}`);
            setEscrowId('');
            setReason('');
        } catch (error) {
            Alert.alert('Dispute failed', error?.response?.data?.message || 'Unable to raise dispute');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <Text style={styles.title}>Dispute Form</Text>
            <View style={styles.card}>
                <Text style={styles.label}>Escrow ID</Text>
                <TextInput
                    style={styles.input}
                    value={escrowId}
                    onChangeText={setEscrowId}
                    autoCapitalize="none"
                />

                <Text style={styles.label}>Reason</Text>
                <TextInput
                    style={[styles.input, styles.textArea]}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                />

                <TouchableOpacity style={styles.button} onPress={submit} disabled={submitting}>
                    <Text style={styles.buttonText}>{submitting ? 'Submitting...' : 'Submit Dispute'}</Text>
                </TouchableOpacity>
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
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 12,
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
    textArea: {
        minHeight: 90,
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
});
