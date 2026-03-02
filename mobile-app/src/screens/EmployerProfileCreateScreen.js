import React, { useContext, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { logger } from '../utils/logger';

export default function EmployerProfileCreateScreen() {
    const { updateUserInfo } = useContext(AuthContext);
    const [companyName, setCompanyName] = useState('');
    const [tagline, setTagline] = useState('');
    const [location, setLocation] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    const handleSave = async () => {
        let newErrors = {};
        if (!companyName.trim()) newErrors.companyName = 'Company Name is required.';
        if (!location.trim()) newErrors.location = 'Location is required.';

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        setErrors({});

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

            await updateUserInfo({
                hasCompletedProfile: true,
            });

            Alert.alert('Success', 'Profile created!');

        } catch (error) {
            logger.error("Profile Save Error:", error);
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

                <View style={styles.logoUpload}>
                    <View style={styles.logoPlaceholder}>
                        <Ionicons name="business" size={32} color="#7C3AED" />
                        <Text style={styles.uploadText}>Company Logo</Text>
                    </View>
                </View>

                <View style={styles.form}>
                    <Text style={styles.label}>Company Name *</Text>
                    <TextInput
                        style={[styles.input, errors.companyName && styles.inputError]}
                        placeholder="e.g. Acme Logistics"
                        value={companyName}
                        onChangeText={(t) => {
                            setCompanyName(t);
                            if (errors.companyName) setErrors(prev => ({ ...prev, companyName: null }));
                        }}
                    />
                    {errors.companyName && <Text style={styles.errorText}>{errors.companyName}</Text>}

                    <Text style={styles.label}>Industry / Tagline</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Fast & Reliable Delivery"
                        value={tagline}
                        onChangeText={setTagline}
                    />

                    <Text style={styles.label}>Location *</Text>
                    <TextInput
                        style={[styles.input, errors.location && styles.inputError]}
                        placeholder="e.g. Mumbai, Maharashtra"
                        value={location}
                        onChangeText={(t) => {
                            setLocation(t);
                            if (errors.location) setErrors(prev => ({ ...prev, location: null }));
                        }}
                    />
                    {errors.location && <Text style={styles.errorText}>{errors.location}</Text>}
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
    inputError: { borderColor: '#ef4444', backgroundColor: '#fef2f2' },
    errorText: { color: '#ef4444', fontSize: 12, marginTop: -16, marginBottom: 12 },
    saveButton: { backgroundColor: '#7C3AED', padding: 16, borderRadius: 12, alignItems: 'center' },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
