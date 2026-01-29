import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';

export default function CompanyDetailsScreen({ navigation, route }) {
    const { applicationId } = route.params;
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchDetails = async () => {
            try {
                const res = await client.get(`/api/applications/${applicationId}`);
                setDetails(res.data);
            } catch (error) {
                console.error("Fetch Application Details Error:", error);
            } finally {
                setLoading(false);
            }
        };

        if (applicationId) fetchDetails();
    }, [applicationId]);

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#7C3AED" />
            </SafeAreaView>
        );
    }

    if (!details) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <Text style={styles.errorText}>Could not load company details.</Text>
            </SafeAreaView>
        );
    }

    const { job, employer } = details;
    const companyName = job?.companyName || employer?.name || "Company Name";
    const location = job?.location || employer?.location || "Location N/A";
    const industry = employer?.industry || "Industry N/A";

    const products = job?.requirements || [];

    return (
        <View style={styles.container}>
            {/* Header / Banner */}
            <View style={styles.headerBanner}>
                <View style={styles.bannerOverlay} />

                {/* Back Button */}
                <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                    <Ionicons name="chevron-back" size={24} color="#fff" />
                    <Text style={styles.backText}>{companyName}</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Profile Section Overlapping Banner */}
                <View style={styles.profileSection}>
                    <View style={styles.logoContainer}>
                        <Text style={styles.logoText}>{companyName.charAt(0)}</Text>
                    </View>

                    <View style={styles.nameRow}>
                        <Text style={styles.companyTitle}>{companyName}</Text>
                        <Ionicons name="checkmark-circle" size={20} color="#7C3AED" style={{ marginLeft: 6 }} />
                    </View>

                    <Text style={styles.tagline}>{industry.toUpperCase()} • {location}</Text>
                    <Text style={styles.subTagline}>MOVING THE WORLD, ONE DELIVERY AT A TIME.</Text>
                </View>

                {/* Products & Services */}
                {products.length > 0 && (
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Ionicons name="briefcase" size={18} color="#7C3AED" />
                            <Text style={styles.cardTitle}>PRODUCTS & SERVICES</Text>
                        </View>

                        {products.map((prod, index) => (
                            <View key={index} style={styles.serviceItem}>
                                <View style={styles.serviceIconBox}>
                                    <Ionicons name="cube" size={20} color="#F59E0B" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.serviceTitle}>{prod}</Text>
                                    <Text style={styles.serviceDesc}>
                                        Requirement/Service for this role.
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                {/* Contact Information (Dark Card) */}
                <View style={[styles.card, styles.darkCard]}>
                    <Text style={[styles.cardTitle, { color: '#fff', marginBottom: 20 }]}>CONTACT INFORMATION</Text>

                    <View style={styles.contactRow}>
                        <Text style={styles.contactLabel}>PARTNERSHIP</Text>
                        <Text style={styles.contactValue}>{employer.email || ""}</Text>
                    </View>

                    <View style={styles.contactRow}>
                        <Text style={styles.contactLabel}>SUPPORT</Text>
                        <Text style={styles.contactValue}>{employer.phone || ""}</Text>
                    </View>

                    <View style={styles.contactRow}>
                        <Text style={styles.contactLabel}>OFFICIAL WEB</Text>
                        <Text style={styles.contactValue}>{employer.website || ""}</Text>
                    </View>

                    {/* Background Globe Graphic Placeholder */}
                    <Ionicons name="globe-outline" size={120} color="rgba(255,255,255,0.05)" style={styles.globeBg} />
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorText: { color: '#EF4444', fontSize: 16 },

    headerBanner: {
        height: 160,
        backgroundColor: '#7C3AED', // Purple header
        paddingTop: 50, // For status bar
        paddingHorizontal: 16,
    },
    backButton: { flexDirection: 'row', alignItems: 'center' },
    backText: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginLeft: 8 },

    scrollContent: { paddingBottom: 40 },

    profileSection: {
        alignItems: 'center',
        marginTop: -40,
        marginBottom: 24,
    },
    logoContainer: {
        width: 80,
        height: 80,
        borderRadius: 20,
        backgroundColor: '#7C3AED',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 4,
        borderColor: '#fff',
        marginBottom: 12,
        shadowColor: '#000',
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
    },
    logoText: { color: '#fff', fontSize: 32, fontWeight: 'bold' },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    companyTitle: { fontSize: 22, fontWeight: 'bold', color: '#111827' },
    tagline: { fontSize: 14, color: '#6B7280', fontWeight: '600' },
    subTagline: { fontSize: 12, color: '#9CA3AF', marginTop: 4, fontWeight: '500' },

    // Cards
    card: {
        backgroundColor: '#fff',
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 20,
        padding: 20,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 10,
        elevation: 2,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    cardTitle: { fontSize: 14, fontWeight: 'bold', color: '#111827' },

    serviceItem: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 16,
        alignItems: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#F3F4F6',
        padding: 12,
        borderRadius: 16,
    },
    serviceIconBox: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#FEF3C7', // Light orange
        justifyContent: 'center',
        alignItems: 'center',
    },
    serviceTitle: { fontSize: 14, fontWeight: 'bold', color: '#1F2937' },
    serviceDesc: { fontSize: 12, color: '#6B7280', marginTop: 2 },

    // Dark Card
    darkCard: { backgroundColor: '#111827', position: 'relative', overflow: 'hidden' },
    contactRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
        paddingBottom: 12
    },
    contactLabel: { fontSize: 12, fontWeight: 'bold', color: '#9CA3AF' },
    contactValue: { fontSize: 14, fontWeight: 'bold', color: '#A78BFA' }, // Light purple
    globeBg: { position: 'absolute', right: -20, bottom: -20, opacity: 0.1 }
});