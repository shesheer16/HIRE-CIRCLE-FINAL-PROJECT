import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';

export default function EmployerProfileCreateScreen({ navigation }) {
    const [companyName, setCompanyName] = useState('');
    const [tagline, setTagline] = useState('');
    const [location, setLocation] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        if (!companyName || !location) {
            Alert.alert('Error', 'Please fill in required fields');
            return;
        }

        setLoading(true);
        try {
            // Corrected endpoint and data structure [cite: 174]
            const updateData = {
                companyName,
                industry: tagline,
                location,
                hasCompletedProfile: true
            };

            // Use PUT to update the existing user role to an established employer profile
            await client.put('/api/users/profile', updateData);

            Alert.alert('Success', 'Profile created!', [
                {
                    text: 'OK',
                    text: 'OK',
                    onPress: () => navigation.replace('MainTab', {
                        role: 'employer'
                    })
                }
            ]);

        } catch (error) {
            console.error("Profile Save Error:", error);
            Alert.alert('Error', 'Failed to save profile. Make sure you are logged in.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Company Setup</Text>
                    <Text style={styles.subtitle}>Establish your hiring identity</Text>
                </View>

                <TouchableOpacity style={styles.logoUpload}>
                    <View style={styles.logoPlaceholder}>
                        <Ionicons name="business" size={32} color="#7C3AED" />
                        <Text style={styles.uploadText}>Company Logo</Text>
                    </View>
                </TouchableOpacity>

                <View style={styles.form}>
                    <Text style={styles.label}>Company Name *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Acme Logistics"
                        value={companyName}
                        onChangeText={setCompanyName}
                    />

                    <Text style={styles.label}>Industry / Tagline</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Fast & Reliable Delivery"
                        value={tagline}
                        onChangeText={setTagline}
                    />

                    <Text style={styles.label}>Location *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Mumbai, Maharashtra"
                        value={location}
                        onChangeText={setLocation}
                    />
                </View>

                <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSave}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.saveButtonText}>Complete Setup</Text>
                    )}
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    content: { padding: 24 },
    header: { marginBottom: 32 },
    title: { fontSize: 28, fontWeight: 'bold', color: '#111827', marginBottom: 8 },
    subtitle: { fontSize: 16, color: '#6B7280' },
    logoUpload: { alignSelf: 'center', marginBottom: 32 },
    logoPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#7C3AED', borderStyle: 'dashed' },
    uploadText: { fontSize: 12, color: '#6B7280', marginTop: 4 },
    form: { gap: 20, marginBottom: 32 },
    label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8 },
    input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, padding: 16, fontSize: 16, backgroundColor: '#F9FAFB' },
    saveButton: { backgroundColor: '#7C3AED', padding: 16, borderRadius: 12, alignItems: 'center' },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});