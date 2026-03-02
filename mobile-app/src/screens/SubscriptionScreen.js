import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PLANS = [
    {
        id: 'free',
        name: 'FREE',
        price: '₹0',
        badge: null,
        features: ['5 apps', 'Basic match', 'Limited support']
    },
    {
        id: 'pro',
        name: 'PRO',
        price: '₹499/mo',
        badge: 'Popular',
        features: ['Unlimited apps', 'Priority AI match', 'Video calls', 'Analytics']
    },
    {
        id: 'enterprise',
        name: 'ENTERPRISE',
        price: '₹2,999/mo',
        badge: null,
        features: ['Custom seats', 'API access', 'Dedicated SLA']
    }
];

export default function SubscriptionScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const [selectedPlan, setSelectedPlan] = useState('free');
    const [processing, setProcessing] = useState(false);

    const handleUpgrade = async () => {
        setProcessing(true);
        try {
            await AsyncStorage.setItem('@hc_subscription_plan', selectedPlan);
            Alert.alert(
                'Plan saved',
                selectedPlan === 'free'
                    ? 'You are on the Free plan.'
                    : 'Premium plan flag enabled. Payment gateway wiring is pending.',
            );
        } catch (e) {
            Alert.alert('Error', 'Could not save plan preference right now.');
        } finally {
            setProcessing(false);
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}> 
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => {
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                            return;
                        }
                        navigation.navigate('MainTab', { screen: 'Settings' });
                    }}
                    style={styles.backButton}
                >
                    <Text style={styles.backText}>‹</Text>
                </TouchableOpacity>
                <View>
                    <Text style={styles.headerTitle}>HireCircle Plans</Text>
                    <Text style={styles.headerSubtitle}>Choose the plan that fits your team</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {PLANS.map(plan => {
                    const isSelected = selectedPlan === plan.id;
                    return (
                        <TouchableOpacity
                            key={plan.id}
                            style={[styles.planCard, isSelected && styles.planCardSelected]}
                            onPress={() => setSelectedPlan(plan.id)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.planHeaderRow}>
                                <View>
                                    <Text style={styles.planName}>{plan.name}</Text>
                                    <Text style={styles.planPrice}>{plan.price}</Text>
                                </View>
                                {plan.badge && (
                                    <View style={styles.planBadge}>
                                        <Text style={styles.planBadgeText}>{plan.badge}</Text>
                                    </View>
                                )}
                                {plan.id !== 'free' ? (
                                    <View style={styles.premiumPill}>
                                        <Text style={styles.premiumPillText}>Premium</Text>
                                    </View>
                                ) : null}
                            </View>
                            <View style={styles.featuresList}>
                                {plan.features.map((feature) => (
                                    <Text key={feature} style={styles.featureText}>• {feature}</Text>
                                ))}
                            </View>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}> 
                <TouchableOpacity
                    style={styles.upgradeButton}
                    onPress={handleUpgrade}
                    disabled={processing}
                >
                    {processing ? <ActivityIndicator color="#fff" /> : <Text style={styles.upgradeButtonText}>Activate {selectedPlan.toUpperCase()} Plan</Text>}
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 12,
    },
    backButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    backText: {
        fontSize: 24,
        color: '#0f172a',
        marginBottom: 2,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0f172a',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748b',
        marginTop: 2,
    },
    content: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 12,
    },
    planCard: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 16,
    },
    planCardSelected: {
        borderColor: '#7c3aed',
        backgroundColor: '#faf5ff',
    },
    planHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    planName: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0f172a',
    },
    planPrice: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748b',
        marginTop: 4,
    },
    planBadge: {
        backgroundColor: '#ede9fe',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    planBadgeText: {
        color: '#6d28d9',
        fontSize: 11,
        fontWeight: '700',
    },
    premiumPill: {
        backgroundColor: '#eff6ff',
        borderRadius: 10,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#bfdbfe',
    },
    premiumPillText: {
        color: '#1d4ed8',
        fontSize: 10,
        fontWeight: '800',
    },
    featuresList: {
        gap: 6,
    },
    featureText: {
        color: '#475569',
        fontSize: 13,
    },
    footer: {
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        paddingTop: 12,
    },
    upgradeButton: {
        backgroundColor: '#7c3aed',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    upgradeButtonText: {
        color: '#ffffff',
        fontWeight: '700',
    },
});
