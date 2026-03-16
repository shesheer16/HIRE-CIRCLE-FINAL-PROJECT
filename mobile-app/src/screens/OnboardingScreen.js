import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { AuthContext } from '../context/AuthContext';
import SkeletonLoader from '../components/SkeletonLoader';

const SLIDES = [
    {
        key: 'intro',
        title: 'Talk once. Profile done.',
        description: 'Answer a few prompts and start seeing verified jobs in under a minute.',
    },
    {
        key: 'precision',
        title: 'Smart matches. Zero spam.',
        description: 'Get ranked opportunities by fit, trust, and response speed.',
    },
    {
        key: 'outcomes',
        title: 'Real hiring. Real people.',
        description: 'Chat with active employers and move to offer faster.',
    },
];

const PREVIEW_JOBS = [
    { id: 'preview-job-1', title: 'Delivery Associate', salary: '₹18k-₹24k', urgency: 'Urgent Hiring' },
    { id: 'preview-job-2', title: 'Warehouse Loader', salary: '₹16k-₹22k', urgency: 'Actively Hiring' },
    { id: 'preview-job-3', title: 'Store Assistant', salary: '₹15k-₹20k', urgency: 'Fast Response Team' },
];

function SlideCard({ item, width, index }) {
    return (
        <View style={[styles.slide, { width }]}>
            <LinearGradient
                colors={['#111827', '#0d1b33']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.visualCard}
            >
                <View style={styles.orb} />
                <View style={styles.visualLine} />
                <View style={styles.visualLineShort} />
                <View style={styles.slideIndexChip}>
                    <Text style={styles.slideIndexChipText}>STEP {index + 1}</Text>
                </View>
            </LinearGradient>
            <Text style={styles.slideTitle}>{item.title}</Text>
            <Text style={styles.slideDescription}>{item.description}</Text>
        </View>
    );
}

export default function OnboardingScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const { completeOnboarding, authEntryRole } = useContext(AuthContext);

    const [activeIndex, setActiveIndex] = useState(0);
    const [detectedRegion, setDetectedRegion] = useState('');
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slidesRef = useRef(null);
    const progressAnim = useRef(new Animated.Value(1 / SLIDES.length)).current;

    const data = useMemo(() => SLIDES, []);
    const progressWidth = useMemo(() => progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    }), [progressAnim]);

    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
        }).start();

        const locale = Localization.getLocales?.()?.[0];
        const region = String(locale?.regionCode || '').trim();
        if (region) {
            setDetectedRegion(region);
        }
    }, [fadeAnim]);

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: (activeIndex + 1) / data.length,
            duration: 220,
            useNativeDriver: false,
        }).start();
    }, [activeIndex, data.length, progressAnim]);

    const handleMomentumEnd = useCallback((event) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / width);
        setActiveIndex(index);
    }, [width]);

    const markOnboardingComplete = useCallback(async () => {
        await AsyncStorage.setItem('@onboarding_completed', 'true');
        await completeOnboarding();
    }, [completeOnboarding]);

    const handleContinue = useCallback(async () => {
        if (activeIndex < data.length - 1) {
            slidesRef.current?.scrollToIndex({
                index: activeIndex + 1,
                animated: true,
            });
            return;
        }

        await markOnboardingComplete();
        if (authEntryRole) {
            navigation.replace('Login', { selectedRole: authEntryRole });
            return;
        }
        navigation.replace('RoleSelection');
    }, [activeIndex, authEntryRole, data.length, markOnboardingComplete, navigation]);

    const handleAlreadyHaveAccount = useCallback(async () => {
        await markOnboardingComplete();
        if (authEntryRole) {
            navigation.replace('Login', { selectedRole: authEntryRole });
            return;
        }
        navigation.replace('RoleSelection');
    }, [authEntryRole, markOnboardingComplete, navigation]);

    const handleSkip = useCallback(async () => {
        await markOnboardingComplete();
        if (authEntryRole) {
            navigation.replace('Login', { selectedRole: authEntryRole });
            return;
        }
        navigation.replace('RoleSelection');
    }, [authEntryRole, markOnboardingComplete, navigation]);

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#f5f7fa', '#edf2fb']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />

            <Animated.View
                style={[
                    styles.content,
                    {
                        opacity: fadeAnim,
                        paddingTop: insets.top + 20,
                        paddingBottom: insets.bottom + 20,
                    },
                ]}
            >
                <View style={styles.headerRow}>
                    <View style={styles.progressShell}>
                        <View style={styles.progressTrack}>
                            <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
                        </View>
                        <Text style={styles.progressMeta}>Step {activeIndex + 1} of {data.length}</Text>
                    </View>
                    <View style={styles.speedChip}>
                        <Text style={styles.speedChipText}>Takes ~30 sec</Text>
                    </View>
                </View>

                <FlatList
                    ref={slidesRef}
                    data={data}
                    keyExtractor={(item) => item.key}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={handleMomentumEnd}
                    renderItem={({ item, index }) => <SlideCard item={item} index={index} width={width - 48} />}
                    contentContainerStyle={styles.sliderTrack}
                    initialNumToRender={3}
                    windowSize={3}
                />

                <View style={styles.previewSection}>
                    <View style={styles.previewHeader}>
                        <Text style={styles.previewTitle}>Preview jobs near you</Text>
                        <Text style={styles.previewMeta}>{detectedRegion ? `Detected: ${detectedRegion}` : 'Detecting region...'}</Text>
                    </View>

                    {!detectedRegion ? (
                        <View style={styles.previewSkeletonRow}>
                            <SkeletonLoader width={168} height={88} borderRadius={16} />
                            <SkeletonLoader width={168} height={88} borderRadius={16} />
                        </View>
                    ) : (
                        <FlatList
                            data={PREVIEW_JOBS}
                            keyExtractor={(item) => item.id}
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.previewTrack}
                            renderItem={({ item }) => (
                                <View style={styles.previewCard}>
                                    <Text style={styles.previewCardTitle} numberOfLines={1}>{item.title}</Text>
                                    <Text style={styles.previewCardSalary}>{item.salary}</Text>
                                    <View style={styles.previewBadge}>
                                        <Text style={styles.previewBadgeText}>{item.urgency}</Text>
                                    </View>
                                </View>
                            )}
                        />
                    )}
                </View>

                <View style={styles.footer}>
                    <View style={styles.skipRow}>
                        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.8}>
                            <Text style={styles.skipBtnText}>Skip</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.dotsRow}>
                        {data.map((slide, index) => (
                            <View
                                key={slide.key}
                                style={[styles.dot, index === activeIndex && styles.dotActive]}
                            />
                        ))}
                    </View>

                    <TouchableOpacity style={styles.primaryButton} onPress={handleContinue} activeOpacity={0.9}>
                        <Text style={styles.primaryButtonText}>{activeIndex === data.length - 1 ? 'Get Started' : 'Continue'}</Text>
                    </TouchableOpacity>

                    {activeIndex === 0 ? (
                        <TouchableOpacity style={styles.secondaryButton} onPress={handleAlreadyHaveAccount} activeOpacity={0.8}>
                            <Text style={styles.secondaryButtonText}>I already have an account</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f7fa',
    },
    content: {
        flex: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 24,
        marginBottom: 14,
    },
    progressShell: {
        flex: 1,
        gap: 4,
    },
    progressTrack: {
        height: 6,
        borderRadius: 999,
        backgroundColor: '#dbe3f0',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#1d4ed8',
    },
    progressMeta: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
    },
    speedChip: {
        backgroundColor: '#e8eefc',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#d1dcf8',
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    speedChipText: {
        color: '#1e3a8a',
        fontSize: 11,
        fontWeight: '700',
    },
    sliderTrack: {
        paddingHorizontal: 24,
    },
    slide: {
        marginRight: 24,
    },
    visualCard: {
        height: 220,
        borderRadius: 20,
        padding: 24,
        justifyContent: 'center',
        marginBottom: 28,
    },
    orb: {
        width: 92,
        height: 92,
        borderRadius: 46,
        backgroundColor: 'rgba(168, 192, 255, 0.2)',
        marginBottom: 20,
    },
    visualLine: {
        height: 10,
        borderRadius: 999,
        backgroundColor: 'rgba(219, 230, 255, 0.35)',
        marginBottom: 8,
        width: '82%',
    },
    visualLineShort: {
        height: 10,
        borderRadius: 999,
        backgroundColor: 'rgba(219, 230, 255, 0.22)',
        width: '56%',
    },
    slideIndexChip: {
        marginTop: 14,
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(219, 230, 255, 0.35)',
        backgroundColor: 'rgba(15, 23, 42, 0.2)',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    slideIndexChipText: {
        color: '#e2e8f0',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    slideTitle: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 12,
        letterSpacing: -0.2,
    },
    slideDescription: {
        fontSize: 16,
        fontWeight: '400',
        color: '#475569',
        lineHeight: 24,
        maxWidth: 300,
    },
    previewSection: {
        marginTop: 18,
        paddingHorizontal: 24,
    },
    previewHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    previewTitle: {
        color: '#0f172a',
        fontSize: 15,
        fontWeight: '700',
    },
    previewMeta: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
    },
    previewSkeletonRow: {
        flexDirection: 'row',
        gap: 10,
    },
    previewTrack: {
        gap: 10,
        paddingRight: 4,
    },
    previewCard: {
        width: 170,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#dfe7f5',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    previewCardTitle: {
        color: '#0f172a',
        fontSize: 14,
        fontWeight: '700',
    },
    previewCardSalary: {
        color: '#1d4ed8',
        fontSize: 16,
        fontWeight: '800',
        marginTop: 5,
        marginBottom: 8,
    },
    previewBadge: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        backgroundColor: '#fef3c7',
        borderWidth: 1,
        borderColor: '#fde68a',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    previewBadgeText: {
        color: '#92400e',
        fontSize: 10,
        fontWeight: '800',
    },
    footer: {
        marginTop: 'auto',
        paddingHorizontal: 24,
    },
    skipRow: {
        alignItems: 'flex-end',
        marginBottom: 12,
    },
    skipBtn: {
        minHeight: 36,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    skipBtnText: {
        color: '#1d4ed8',
        fontSize: 14,
        fontWeight: '600',
    },
    dotsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginBottom: 24,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#cbd5e1',
    },
    dotActive: {
        width: 24,
        borderRadius: 999,
        backgroundColor: '#1d4ed8',
    },
    primaryButton: {
        minHeight: 52,
        borderRadius: 14,
        backgroundColor: '#1d4ed8',
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
    secondaryButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 8,
    },
    secondaryButtonText: {
        color: '#475569',
        fontSize: 14,
        fontWeight: '400',
    },
});
