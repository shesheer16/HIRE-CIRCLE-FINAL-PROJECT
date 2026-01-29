import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
    Alert,
    Dimensions,
    ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import * as SecureStore from 'expo-secure-store';

const { width } = Dimensions.get('window');

export default function JobDetailsScreen({ navigation, route }) {
    const { job, matchScore, fitReason } = route.params;
    const [applying, setApplying] = useState(false);

    const handleApply = async () => {
        setApplying(true);
        try {
            // Initiate Application logic
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const user = JSON.parse(userInfoStr);
            const workerProfileRes = await client.get('/api/users/profile');
            const workerId = workerProfileRes.data.profile._id;

            await client.post('/api/applications', {
                jobId: job._id,
                workerId: workerId,
                initiatedBy: 'worker'
            });

            Alert.alert("Success", "Application Sent!", [
                {
                    text: "Go to Applications",
                    onPress: () => navigation.navigate("MainTab", { screen: "Applications" })
                },
                {
                    text: "Stay Here",
                    style: "cancel"
                }
            ]);
        } catch (error) {
            if (error.response?.status === 400) {
                Alert.alert("Info", "You have already applied to this job.");
            } else {
                Alert.alert("Error", "Could not apply.");
            }
        } finally {
            setApplying(false);
        }
    };

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
                {/* Header Banner - Placeholder for Company Image */}
                <View style={styles.banner}>
                    <View style={styles.bannerOverlay} />
                    {/* Back Button */}
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => navigation.goBack()}
                    >
                        <Ionicons name="chevron-back" size={24} color="#fff" />
                    </TouchableOpacity>
                </View>

                {/* Main Content Card (Overlapping Banner) */}
                <View style={styles.contentCard}>
                    {/* Header: Title & Company */}
                    <View style={styles.headerRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.jobTitle}>{job.title}</Text>
                            <Text style={styles.companyName}>{job.companyName}</Text>
                        </View>
                        <View style={styles.matchBadge}>
                            <Text style={styles.matchText}>{matchScore}%</Text>
                        </View>
                    </View>

                    {/* Info Cards Row */}
                    <View style={styles.infoRow}>
                        <View style={styles.infoCard}>
                            <Text style={styles.infoLabel}>SALARY</Text>
                            <Text style={styles.infoValue}>{job.salaryRange}</Text>
                        </View>
                        <View style={styles.infoCard}>
                            <Text style={styles.infoLabel}>TYPE</Text>
                            {/* Assuming Full-time as default since type isn't in model yet, or derived */}
                            <Text style={styles.infoValue}>Full-time</Text>
                        </View>
                    </View>

                    {/* Description */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Description</Text>
                        <Text style={styles.descriptionText}>
                            Looking for experienced {job.title.toLowerCase()} for daily operations.
                            Must be reliable and hardworking. This role requires dedication and skill.
                            {/* Generic placeholder text as backend currently only has 'requirements' array */}
                        </Text>
                    </View>

                    {/* Requirements */}
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Requirements</Text>
                        <View style={styles.tagsRow}>
                            {job.requirements && job.requirements.map((req, index) => (
                                <View key={index} style={styles.tag}>
                                    <Text style={styles.tagText}>{req}</Text>
                                </View>
                            ))}
                        </View>
                    </View>

                    {/* Smart Match Analysis */}
                    <View style={styles.smartMatchBox}>
                        <View style={styles.smartMatchHeader}>
                            <Ionicons name="sparkles" size={18} color="#7C3AED" />
                            <Text style={styles.smartMatchTitle}>Smart Match Analysis</Text>
                        </View>
                        <Text style={styles.smartMatchText}>
                            {fitReason}
                        </Text>
                    </View>

                    {/* Extra padding for scroll */}
                    <View style={{ height: 100 }} />
                </View>
            </ScrollView>

            {/* Sticky Bottom Footer */}
            <View style={styles.footer}>
                <TouchableOpacity
                    style={styles.applyButton}
                    onPress={handleApply}
                    disabled={applying}
                >
                    {applying ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Text style={styles.applyButtonText}>Apply Now</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scrollContent: {
        flexGrow: 1,
        backgroundColor: '#fff',
    },
    banner: {
        height: 180,
        backgroundColor: '#1E293B', // Dark blue placeholder
        position: 'relative',
    },
    bannerOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    backButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    contentCard: {
        flex: 1,
        marginTop: -30,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: '#fff',
        paddingHorizontal: 20,
        paddingTop: 30,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    jobTitle: {
        fontSize: 26,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
        lineHeight: 32,
    },
    companyName: {
        fontSize: 16,
        color: '#7C3AED',
        fontWeight: '600',
    },
    matchBadge: {
        backgroundColor: '#F3E8FF',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginLeft: 10,
    },
    matchText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#7C3AED',
    },
    infoRow: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 32,
    },
    infoCard: {
        flex: 1,
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    infoLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#9CA3AF',
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    infoValue: {
        fontSize: 15,
        fontWeight: 'bold',
        color: '#1F2937',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
    },
    descriptionText: {
        fontSize: 15,
        lineHeight: 24,
        color: '#4B5563',
    },
    tagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    tag: {
        backgroundColor: '#F9FAFB',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#F3E8FF',
    },
    tagText: {
        fontSize: 13,
        color: '#7C3AED',
        fontWeight: '500',
    },
    smartMatchBox: {
        backgroundColor: '#EEF2FF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#E0E7FF',
    },
    smartMatchHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    smartMatchTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1E1B4B',
    },
    smartMatchText: {
        fontSize: 14,
        lineHeight: 22,
        color: '#4338CA',
    },

    // Sticky Footer
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        padding: 20,
        paddingBottom: 30, // Safe area
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 10,
    },
    applyButton: {
        backgroundColor: '#8B5CF6', // Vivid Purple
        borderRadius: 16,
        paddingVertical: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#7C3AED',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 6,
    },
    applyButtonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
});
