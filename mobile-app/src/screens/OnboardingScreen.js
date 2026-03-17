import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    Image,
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { PALETTE, RADIUS, SHADOWS } from '../theme/theme';

const GUIDE_SECTIONS = {
    employer: 'Employer path - screens 1-6',
    jobSeeker: 'Job seeker path - screens 7-10',
};

const HERO_FLOW = [
    {
        icon: 'person-outline',
        title: 'Choose',
        copy: 'Employer or job seeker',
    },
    {
        icon: 'search-outline',
        title: 'See',
        copy: 'Jobs or people that fit',
    },
    {
        icon: 'chatbubble-ellipses-outline',
        title: 'Act',
        copy: 'Chat, apply, or follow up',
    },
];

const GUIDE_STEPS = [
    {
        section: GUIDE_SECTIONS.employer,
        key: 'explore',
        title: 'Explore the community',
        body: 'Start in Connect to browse real posts, hiring updates, and activity from people already using the app.',
        image: require('../../assets/onboarding/guide-1.png'),
    },
    {
        section: GUIDE_SECTIONS.employer,
        key: 'setup',
        title: 'Organize role-specific profiles',
        body: 'Keep multiple profiles ready with the right skills, experience, and edits so the version you share stays consistent.',
        image: require('../../assets/onboarding/guide-2.png'),
    },
    {
        section: GUIDE_SECTIONS.employer,
        key: 'profile',
        title: 'Review candidate details with confidence',
        body: 'Open a full profile to check rating, location, summary, skills, and response signals before you move forward.',
        image: require('../../assets/onboarding/guide-5.png'),
    },
    {
        section: GUIDE_SECTIONS.employer,
        key: 'match',
        title: 'Understand every match',
        body: 'Use Smart Match Analysis to see why a profile fits, from salary alignment and distance to skills and experience.',
        image: require('../../assets/onboarding/guide-3.png'),
    },
    {
        section: GUIDE_SECTIONS.employer,
        key: 'review',
        title: 'Keep applications organized',
        body: 'See active conversations and status updates in Apps so follow-up stays simple.',
        image: require('../../assets/onboarding/guide-6.png'),
    },
    {
        section: GUIDE_SECTIONS.employer,
        key: 'follow-up',
        title: 'Move the conversation to chat',
        body: 'Open the thread when someone is ready and keep the next step attached to the application.',
        image: require('../../assets/onboarding/guide-4.png'),
    },
    {
        section: GUIDE_SECTIONS.jobSeeker,
        key: 'browse',
        title: 'Choose the job seeker path',
        body: 'Pick Job Seeker on the first screen so the app can show local work, matched jobs, and your application history.',
        image: require('../../assets/onboarding/guide-7.png'),
    },
    {
        section: GUIDE_SECTIONS.jobSeeker,
        key: 'confirm',
        title: 'Search local jobs',
        body: 'Use Live Radar to scan nearby opportunities and see what is active around you right now.',
        image: require('../../assets/onboarding/guide-8.png'),
    },
    {
        section: GUIDE_SECTIONS.jobSeeker,
        key: 'availability',
        title: 'See jobs for you',
        body: 'Browse matched roles with pay, location, and fit at a glance before you apply.',
        image: require('../../assets/onboarding/guide-9.png'),
    },
    {
        section: GUIDE_SECTIONS.jobSeeker,
        key: 'payout',
        title: 'Track applications',
        body: 'Keep every application and reply in one place so you can follow up fast.',
        image: require('../../assets/onboarding/guide-10.png'),
    },
];

const FAQS = [
    {
        question: 'Does the guide show both sides of the app?',
        answer: 'Yes. Screens 1-6 cover the employer flow, and screens 7-10 cover the job seeker flow.',
    },
    {
        question: 'Can I manage multiple profiles?',
        answer: 'Yes. My Profiles lets you keep role-specific versions ready so you can switch between them as needed.',
    },
    {
        question: 'What helps people trust a profile here?',
        answer: 'Clear role titles, ratings, skills, location, experience, and response details make each profile feel real and actionable.',
    },
    {
        question: 'How are matches ranked?',
        answer: 'Matches use the details you add, such as skills, experience, availability, language, and location, to surface the most relevant people or opportunities.',
    },
    {
        question: 'Can I see why someone matched?',
        answer: 'Yes. Smart Match Analysis explains the score with a breakdown like skill match, salary alignment, distance, and experience fit.',
    },
    {
        question: 'Where do job seekers start in the guide?',
        answer: 'Pick Job Seeker, then use Live Radar, Jobs for You, and Applications to follow each lead.',
    },
    {
        question: 'Where do I manage applications and follow-ups?',
        answer: 'Use Apps or Applications to review status changes, check who is chat ready, and jump into the next conversation.',
    },
    {
        question: 'Can I update my details later?',
        answer: 'Yes. You can edit profile details, role setup, and matching signals later as your needs change.',
    },
];

export default function OnboardingScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const { completeOnboarding } = useContext(AuthContext);
    const [openIndex, setOpenIndex] = useState(null);

    useEffect(() => {
        if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    const handleContinue = useCallback(async () => {
        await completeOnboarding();
        navigation.replace('RoleSelection');
    }, [completeOnboarding, navigation]);

    const toggleFaq = useCallback((index) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpenIndex((prev) => (prev === index ? null : index));
    }, []);

    const contentPaddingBottom = useMemo(
        () => insets.bottom + 140,
        [insets.bottom]
    );

    return (
        <View style={styles.container}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20, paddingBottom: contentPaddingBottom }]}
            >
                <View style={styles.heroCard}>
                    <LinearGradient
                        colors={[PALETTE.accent, PALETTE.accentDeep]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.heroAccent}
                    />
                    <Text style={styles.heroKicker}>10-second overview</Text>
                    <Text style={styles.heroTitle}>One app. Two paths.</Text>
                    <Text style={styles.heroSubtitle}>See how HireCircle works for employers and job seekers in 10 quick screens.</Text>
                    <View style={styles.heroFlowRow}>
                        {HERO_FLOW.map((item) => (
                            <View key={item.title} style={styles.heroFlowItem}>
                                <View style={styles.heroFlowIconWrap}>
                                    <Ionicons name={item.icon} size={16} color={PALETTE.accentDeep} />
                                </View>
                                <Text style={styles.heroFlowTitle}>{item.title}</Text>
                                <Text style={styles.heroFlowCopy}>{item.copy}</Text>
                            </View>
                        ))}
                    </View>
                </View>

                <View style={styles.stepStack}>
                    {GUIDE_STEPS.map((step, index) => (
                        <View key={step.key} style={styles.stepGroup}>
                            {index === 0 || step.section !== GUIDE_STEPS[index - 1].section ? (
                                <Text style={styles.sectionLabel}>{step.section}</Text>
                            ) : null}
                            <View style={styles.stepCard}>
                                <Text style={styles.stepTitle}>
                                    <Text style={styles.stepIndex}>{index + 1}. </Text>
                                    {step.title}
                                </Text>
                                <Text style={styles.stepBody}>{step.body}</Text>
                                <View style={styles.stepImageWrap}>
                                    <Image source={step.image} style={styles.stepImage} resizeMode="contain" />
                                </View>
                            </View>
                        </View>
                    ))}
                </View>

                <View style={styles.faqSection}>
                    <Text style={styles.faqTitle}>Frequently Asked Questions</Text>
                    <View style={styles.faqCard}>
                        {FAQS.map((item, index) => {
                            const isOpen = index === openIndex;
                            return (
                                <View key={item.question} style={styles.faqRow}>
                                    <TouchableOpacity
                                        style={styles.faqHeader}
                                        onPress={() => toggleFaq(index)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.faqQuestion}>{item.question}</Text>
                                        <Ionicons
                                            name={isOpen ? 'chevron-up' : 'chevron-down'}
                                            size={18}
                                            color={PALETTE.textSecondary}
                                        />
                                    </TouchableOpacity>
                                    {isOpen ? <Text style={styles.faqAnswer}>{item.answer}</Text> : null}
                                </View>
                            );
                        })}
                    </View>
                </View>
            </ScrollView>

            <View style={[styles.stickyFooter, { paddingBottom: insets.bottom + 18 }]}>
                <TouchableOpacity style={styles.ctaButton} onPress={handleContinue} activeOpacity={0.88}>
                    <Text style={styles.ctaText}>Continue</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.background,
    },
    scrollContent: {
        paddingHorizontal: 22,
    },
    heroCard: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        borderRadius: RADIUS.xl,
        paddingHorizontal: 18,
        paddingVertical: 18,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    heroAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 6,
    },
    heroKicker: {
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#f1e9ff',
        color: PALETTE.accentDeep,
        fontSize: 12,
        lineHeight: 14,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    heroTitle: {
        fontSize: 22,
        lineHeight: 30,
        fontWeight: '800',
        color: PALETTE.textPrimary,
    },
    heroSubtitle: {
        marginTop: 6,
        color: PALETTE.textSecondary,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
    },
    heroFlowRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    heroFlowItem: {
        flex: 1,
        minHeight: 96,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#EEE4FF',
        backgroundColor: '#FCF9FF',
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    heroFlowIconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F2E9FF',
        marginBottom: 8,
    },
    heroFlowTitle: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        textAlign: 'center',
    },
    heroFlowCopy: {
        marginTop: 4,
        fontSize: 11,
        lineHeight: 15,
        color: PALETTE.textSecondary,
        textAlign: 'center',
        fontWeight: '500',
    },
    stepStack: {
        marginTop: 22,
        gap: 28,
    },
    stepGroup: {
        gap: 10,
    },
    sectionLabel: {
        alignSelf: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#f1e9ff',
        color: PALETTE.accentDeep,
        fontSize: 12,
        lineHeight: 14,
        fontWeight: '800',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    stepCard: {
        gap: 12,
    },
    stepImageWrap: {
        marginTop: 4,
        borderRadius: 28,
        backgroundColor: '#eff1f5',
        overflow: 'hidden',
        paddingHorizontal: 18,
        paddingVertical: 18,
        minHeight: 400,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stepImage: {
        width: '100%',
        height: 400,
        alignSelf: 'center',
    },
    stepTitle: {
        fontSize: 21,
        lineHeight: 30,
        fontWeight: '800',
        color: PALETTE.textPrimary,
    },
    stepIndex: {
        color: PALETTE.textPrimary,
    },
    stepBody: {
        fontSize: 16,
        lineHeight: 30,
        color: PALETTE.textPrimary,
        fontWeight: '400',
    },
    faqSection: {
        marginTop: 26,
        marginBottom: 16,
    },
    faqTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        marginBottom: 12,
    },
    faqCard: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        borderRadius: RADIUS.lg,
        ...SHADOWS.sm,
    },
    faqRow: {
        borderBottomWidth: 1,
        borderBottomColor: PALETTE.borderLight,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    faqHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
    },
    faqQuestion: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: PALETTE.textPrimary,
        paddingRight: 12,
    },
    faqAnswer: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 19,
        color: PALETTE.textSecondary,
        fontWeight: '500',
    },
    stickyFooter: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        paddingTop: 12,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderTopWidth: 1,
        borderTopColor: PALETTE.borderLight,
    },
    ctaButton: {
        minHeight: 54,
        borderRadius: RADIUS.full,
        backgroundColor: PALETTE.textPrimary,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.md,
    },
    ctaText: {
        color: PALETTE.textInverted,
        fontSize: 16,
        fontWeight: '700',
    },
});
