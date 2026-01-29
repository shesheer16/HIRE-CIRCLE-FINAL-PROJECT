import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';

export default function PostJobScreen({ navigation, route }) {
    const [title, setTitle] = useState('');
    const [salary, setSalary] = useState('');
    const [location, setLocation] = useState(''); // Could default to profile location
    const [requirements, setRequirements] = useState(''); // Textarea for now, or comma separated
    const [aiLoading, setAiLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [companyName, setCompanyName] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);

    useEffect(() => {
        console.log('PostJob params received:', route.params);
        if (route.params?.videoUrl) {
            setVideoUrl(route.params.videoUrl);
        }
        if (route.params?.jobData) {
            const { title, salaryRange, location, requirements } = route.params.jobData;
            if (title) setTitle(title);
            if (salaryRange) setSalary(salaryRange);
            if (location) setLocation(location);
            if (requirements && Array.isArray(requirements)) {
                setRequirements(requirements.join(', '));
            }
        }
    }, [route.params]);

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const { data } = await client.get('/api/users/profile');
                if (data.profile) {
                    setCompanyName(data.profile.companyName || '');
                    setLocation(data.profile.location || '');
                }
            } catch (error) {
                console.log('Error fetching profile', error);
            }
        };
        fetchProfile();
    }, []);

    const handleSuggestRequirements = async () => {
        if (!title) {
            Alert.alert('Tip', 'Enter a Job Title first to get suggestions.');
            return;
        }

        setAiLoading(true);
        try {
            // Using the manual Gemini endpoint we created earlier?
            // Or a specific suggestive endpoint.
            // Let's use the generic 'generate' endpoint if available or create a specific one.
            // Assuming we reuse the gemini service via a new route or just hardcode a prompt here to a generic completions endpoint.
            // Ideally backend should handle this: POST /api/jobs/suggest-requirements
            // Since that doesn't exist yet, I'll mock the call or use the existing 'generate' if accessible.
            // For Phase 4.1, let's simulate or try to hit a generic endpoint. 
            // Better: Add the endpoint to backend in next step (or parallel).
            // I'll assume we can call `POST /api/jobs/suggest` (I should create this route).

            // Temporary: Mock response for UI testing if backend route isn't ready
            // const mockSuggestions = "Valid Driver's License, 2+ Years Experience, Clean Driving Record";
            // setRequirements(mockSuggestions);

            // Real attempt (will fail if route not exists, but I will add it)
            const prompt = `Suggest 3-5 short, bulleted requirements for a "${title}" job. Return only the text.`;
            // Actually, let's look for a generic AI route.
            // I'll create a dedicated route for this in the backend plan.
            const { data } = await client.post('/api/jobs/suggest', { title });
            setRequirements(data.suggestions);

        } catch (error) {
            Alert.alert('Error', 'Could not get suggestions. Please type manually.');
        } finally {
            setAiLoading(false);
        }
    };

    const handlePostJob = async () => {
        if (!title || !salary || !requirements) {
            Alert.alert('Error', 'Please fill in all required fields');
            return;
        }

        setSaving(true);
        try {
            // Convert requirements string to array if needed, or keep as string block
            // Schema expects Array of strings.
            const requirementsArray = requirements.split(',').map(s => s.trim()).filter(Boolean);

            await client.post('/api/jobs', {
                title,
                salaryRange: salary,
                location,
                requirements: requirementsArray,
                companyName: companyName || "My Company",
                videoUrl: videoUrl
            });

            Alert.alert('Success', 'Job Posted!', [
                { text: 'OK', onPress: () => navigation.navigate('MainTab', { screen: 'My Jobs' }) }
            ]);
        } catch (error) {
            console.error(error);
            Alert.alert('Error', 'Failed to post job');
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#374151" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Create New Job</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* Section 1: Basics */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Basic Info</Text>

                    <Text style={styles.label}>Job Title *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Heavy Truck Driver"
                        value={title}
                        onChangeText={setTitle}
                    />

                    <Text style={styles.label}>Salary Range *</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. ₹25,000 - ₹35,000"
                        value={salary}
                        onChangeText={setSalary}
                    />

                    <Text style={styles.label}>Location</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="e.g. Mumbai"
                        value={location}
                        onChangeText={setLocation}
                    />
                </View>

                {/* Section 2: Matching Criteria */}
                <View style={styles.section}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.sectionTitle}>Requirements</Text>

                        {/* Section 3: AI Integration */}
                        <TouchableOpacity
                            style={styles.aiButton}
                            onPress={handleSuggestRequirements}
                            disabled={aiLoading}
                        >
                            <Ionicons name="sparkles" size={16} color="#4F46E5" style={{ marginRight: 4 }} />
                            <Text style={styles.aiButtonText}>
                                {aiLoading ? 'Thinking...' : 'AI Suggest'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.subtitle}>Separate with commas</Text>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        placeholder="Valid License, Night Shift, Experience..."
                        value={requirements}
                        onChangeText={setRequirements}
                        multiline
                        numberOfLines={4}
                    />

                    {videoUrl && (
                        <View style={styles.videoBadge}>
                            <Ionicons name="videocam" size={20} color="#fff" />
                            <Text style={styles.videoText}>Video Introduction Attached</Text>
                        </View>
                    )}
                </View>

                {/* Submit */}
                <TouchableOpacity
                    style={styles.postButton}
                    onPress={handlePostJob}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={styles.postButtonText}>Post Job</Text>
                    )}
                </TouchableOpacity>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F9FAFB',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#E5E7EB',
    },
    backButton: {
        padding: 8,
        marginRight: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    content: {
        padding: 20,
    },
    section: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 16,
    },
    rowBetween: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#F9FAFB',
        marginBottom: 16,
    },
    textArea: {
        height: 100,
        textAlignVertical: 'top',
    },
    aiButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EEF2FF',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
    },
    aiButtonText: {
        color: '#4F46E5',
        fontSize: 12,
        fontWeight: 'bold',
    },
    postButton: {
        backgroundColor: '#4F46E5',
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 40,
        shadowColor: '#4F46E5',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    postButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    videoBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#10B981',
        padding: 12,
        borderRadius: 8,
        marginTop: 12,
        gap: 8
    },
    videoText: {
        color: '#fff',
        fontWeight: '600',
        fontSize: 14
    }
});