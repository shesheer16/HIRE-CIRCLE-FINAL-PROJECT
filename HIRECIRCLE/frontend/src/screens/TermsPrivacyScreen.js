import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { PALETTE, RADIUS } from '../theme/theme';

const TERMS_CONTENT = [
    {
        heading: 'Using the App',
        body: 'Use HireCircle only for real hiring or job search activity. Keep profiles, posts, and listings accurate and up to date.',
    },
    {
        heading: 'Eligibility',
        body: 'You must be legally able to use the app and follow local laws where you live and work.',
    },
    {
        heading: 'Account Safety',
        body: 'Keep your login details private. You are responsible for all activity on your account.',
    },
    {
        heading: 'Hiring Outcomes',
        body: 'Employers and job seekers control their decisions. HireCircle does not guarantee hiring or job offers.',
    },
    {
        heading: 'Content Rights',
        body: 'You own what you post. You give HireCircle permission to display it in the app so others can discover it.',
    },
    {
        heading: 'Prohibited Activity',
        body: 'No spam, fraud, impersonation, or attempts to access data you are not authorized to view.',
    },
    {
        heading: 'Payments and Escrow',
        body: 'If you use payment or escrow features, you agree to any additional rules shown during that flow.',
    },
    {
        heading: 'Account Actions',
        body: 'We may suspend or remove accounts that violate these Terms or harm the community.',
    },
];

const PRIVACY_CONTENT = [
    {
        heading: 'What We Collect',
        body: 'Profile details, role, job activity, and basic device data so the app can function properly.',
    },
    {
        heading: 'Location Use',
        body: 'We use location signals to show nearby jobs or candidates. You can disable location access in your device settings.',
    },
    {
        heading: 'How We Use Data',
        body: 'To power matching, improve safety, support your requests, and make the app faster and more relevant.',
    },
    {
        heading: 'Sharing',
        body: 'We share the minimum needed to complete hiring workflows. We do not sell personal data.',
    },
    {
        heading: 'Security',
        body: 'We apply reasonable safeguards, but no system is 100% secure. Use strong passwords and avoid sharing OTPs.',
    },
    {
        heading: 'Retention',
        body: 'We keep data only as long as needed for the service or legal requirements.',
    },
    {
        heading: 'Your Controls',
        body: 'Update your profile, manage visibility, or request deletion through Settings.',
    },
];

const SUMMARY_POINTS = [
    { icon: 'shield-checkmark', label: 'We do not sell personal data.' },
    { icon: 'lock-closed', label: 'You control your profile visibility.' },
    { icon: 'sparkles', label: 'Clear rules for safe hiring.' },
];

export default function TermsPrivacyScreen({ navigation, route }) {
    const requestedSection = String(route?.params?.section || '').toLowerCase();
    const orderedSections = useMemo(() => {
        if (requestedSection === 'privacy') {
            return [
                { title: 'Privacy Policy', items: PRIVACY_CONTENT },
                { title: 'Terms of Service', items: TERMS_CONTENT },
            ];
        }
        return [
            { title: 'Terms of Service', items: TERMS_CONTENT },
            { title: 'Privacy Policy', items: PRIVACY_CONTENT },
        ];
    }, [requestedSection]);

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={22} color={PALETTE.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Terms & Privacy</Text>
                <View style={styles.headerSpacer} />
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.heroCard}>
                    <Text style={styles.heroTitle}>Clear. Human. Transparent.</Text>
                    <Text style={styles.heroSubtitle}>
                        These rules explain how HireCircle works, what we expect from the community,
                        and how we protect your data.
                    </Text>
                    <View style={styles.summaryRow}>
                        {SUMMARY_POINTS.map((point) => (
                            <View key={point.label} style={styles.summaryChip}>
                                <Ionicons name={point.icon} size={14} color={PALETTE.accentDeep} />
                                <Text style={styles.summaryText}>{point.label}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <Text style={styles.updated}>Last updated: March 17, 2026</Text>

                {orderedSections.map((section) => (
                    <View key={section.title} style={styles.section}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.sectionIcon}>
                                <Ionicons
                                    name={section.title.toLowerCase().includes('privacy') ? 'lock-closed' : 'document-text'}
                                    size={16}
                                    color={PALETTE.accentDeep}
                                />
                            </View>
                            <Text style={styles.sectionTitle}>{section.title}</Text>
                        </View>
                        {section.items.map((item) => (
                            <View key={item.heading} style={styles.block}>
                                <View style={styles.blockHeader}>
                                    <View style={styles.bullet} />
                                    <Text style={styles.blockTitle}>{item.heading}</Text>
                                </View>
                                <Text style={styles.blockBody}>{item.body}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <View style={styles.footerCard}>
                    <Text style={styles.footerTitle}>Need help?</Text>
                    <Text style={styles.footerText}>
                        Contact support from Settings. We respond fastest there and can verify your account quickly.
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.backgroundSoft,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: PALETTE.separator,
        backgroundColor: PALETTE.background,
    },
    backBtn: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        fontSize: 17,
        fontWeight: '700',
        color: PALETTE.textPrimary,
    },
    headerSpacer: {
        width: 40,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 32,
    },
    heroCard: {
        backgroundColor: PALETTE.background,
        borderRadius: RADIUS.xl,
        padding: 18,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.borderLight,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
        marginBottom: 12,
    },
    heroTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        marginBottom: 6,
        letterSpacing: -0.2,
    },
    heroSubtitle: {
        fontSize: 13,
        color: PALETTE.textSecondary,
        lineHeight: 19,
        marginBottom: 12,
    },
    summaryRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    summaryChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: PALETTE.accentTint,
        borderRadius: RADIUS.full,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.accentBorder,
    },
    summaryText: {
        fontSize: 11,
        color: PALETTE.textPrimary,
        fontWeight: '600',
    },
    updated: {
        fontSize: 12,
        color: PALETTE.textTertiary,
        marginBottom: 10,
    },
    section: {
        backgroundColor: PALETTE.background,
        borderRadius: RADIUS.xl,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.borderLight,
        padding: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
    },
    sectionIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: PALETTE.accentTint,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: PALETTE.textPrimary,
    },
    block: {
        marginBottom: 12,
    },
    blockHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    bullet: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: PALETTE.accentDeep,
        marginTop: 2,
    },
    blockTitle: {
        fontSize: 13.5,
        fontWeight: '700',
        color: PALETTE.textPrimary,
    },
    blockBody: {
        fontSize: 13,
        color: PALETTE.textSecondary,
        lineHeight: 19,
    },
    footerCard: {
        backgroundColor: PALETTE.surface2,
        borderRadius: RADIUS.lg,
        padding: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.borderLight,
    },
    footerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: PALETTE.textPrimary,
        marginBottom: 4,
    },
    footerText: {
        fontSize: 12,
        color: PALETTE.textSecondary,
        lineHeight: 18,
    },
});
