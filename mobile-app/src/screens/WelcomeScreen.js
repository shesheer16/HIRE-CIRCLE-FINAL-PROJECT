import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { PALETTE, RADIUS, SHADOWS } from '../theme/theme';

const BRAND_WORD = 'HIRECIRCLE';

function AnimatedWordmark() {
    const letters = Array.from(BRAND_WORD);
    const letterProgress = useRef(letters.map(() => new Animated.Value(0))).current;

    useEffect(() => {
        letterProgress.forEach((value) => value.setValue(0));

        const stagger = Animated.stagger(
            56,
            letterProgress.map((value) => Animated.timing(value, {
                toValue: 1,
                duration: 330,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }))
        );

        const sequence = Animated.loop(
            Animated.sequence([
                Animated.delay(120),
                stagger,
                Animated.delay(1546),
            ]),
            { resetBeforeIteration: true }
        );

        sequence.start();
        return () => {
            sequence.stop?.();
        };
    }, [letterProgress]);

    return (
        <View
            style={styles.wordmarkRow}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {letters.map((char, index) => {
                const progress = letterProgress[index];
                const accent = index >= 4;

                return (
                    <Animated.Text
                        key={`${char}-${index}`}
                        style={[
                            styles.wordmarkLetter,
                            accent && styles.wordmarkAccent,
                            {
                                opacity: progress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 1],
                                }),
                                transform: [
                                    {
                                        translateY: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [14, 0],
                                        }),
                                    },
                                    {
                                        scale: progress.interpolate({
                                            inputRange: [0, 1],
                                            outputRange: [0.92, 1],
                                        }),
                                    },
                                ],
                            },
                        ]}
                    >
                        {char}
                    </Animated.Text>
                );
            })}
        </View>
    );
}

export default function WelcomeScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { completeOnboarding } = useContext(AuthContext);
    const contentOpacity = useRef(new Animated.Value(0)).current;
    const contentTranslateY = useRef(new Animated.Value(14)).current;
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const [shouldRenderVideo, setShouldRenderVideo] = useState(false);
    const [videoUnavailable, setVideoUnavailable] = useState(false);

    const handleGetStarted = useCallback(async () => {
        await completeOnboarding();
        navigation.replace('RoleSelection');
    }, [completeOnboarding, navigation]);

    const handleQuickGuide = useCallback(() => {
        navigation.navigate('Onboarding');
    }, [navigation]);

    useEffect(() => {
        Animated.parallel([
            Animated.timing(contentOpacity, {
                toValue: 1,
                duration: 520,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
            Animated.timing(contentTranslateY, {
                toValue: 0,
                duration: 520,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [contentOpacity, contentTranslateY]);

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.delay(120),
                Animated.timing(heroOpacity, {
                    toValue: 1,
                    duration: 420,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.delay(920),
                Animated.timing(heroOpacity, {
                    toValue: 0,
                    duration: 720,
                    easing: Easing.inOut(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.delay(320),
            ]),
            { resetBeforeIteration: true }
        );

        loop.start();
        return () => loop.stop();
    }, [heroOpacity]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setShouldRenderVideo(true);
        }, 350);

        return () => clearTimeout(timer);
    }, []);

    return (
        <View style={styles.container}>
            <StatusBar hidden style="light" />
            <LinearGradient
                colors={['#04070d', '#0b1220', '#120f1f']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            {shouldRenderVideo && !videoUnavailable ? (
                <Video
                    source={require('../../assets/onboarding/starfield.mp4')}
                    style={StyleSheet.absoluteFill}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay
                    isLooping
                    isMuted
                    onError={() => setVideoUnavailable(true)}
                />
            ) : null}
            <LinearGradient
                colors={['rgba(168,85,247,0.16)', 'rgba(0,0,0,0)']}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 0.7 }}
                style={styles.brandGlow}
            />
            <LinearGradient
                colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.75)']}
                style={StyleSheet.absoluteFill}
            />

            <Animated.View
                style={[
                    styles.content,
                    {
                        paddingTop: insets.top + 24,
                        paddingBottom: insets.bottom + 28,
                        opacity: contentOpacity,
                        transform: [{ translateY: contentTranslateY }],
                    },
                ]}
            >
                <Animated.View
                    style={[
                        styles.brandBlock,
                        {
                            opacity: heroOpacity,
                        },
                    ]}
                >
                    <AnimatedWordmark />
                    <Text style={styles.tagline}>Hire talent or find work in one app.</Text>
                </Animated.View>

                <View style={styles.ctaBlock}>
                    <Text style={styles.ctaEyebrow}>Choose your path</Text>
                    <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.88} onPress={handleGetStarted}>
                        <View style={styles.primaryBtnContent}>
                            <Text style={styles.primaryBtnText}>Get started</Text>
                            <Ionicons name="arrow-forward" size={18} color={PALETTE.textPrimary} />
                        </View>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7} onPress={handleQuickGuide}>
                        <View style={styles.secondaryBtnContent}>
                            <Ionicons name="book-outline" size={16} color={PALETTE.textInverted} />
                            <Text style={styles.secondaryBtnText}>Quick guide</Text>
                        </View>
                    </TouchableOpacity>
                </View>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.textPrimary,
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
        justifyContent: 'space-between',
    },
    brandGlow: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '46%',
    },
    brandBlock: {
        alignItems: 'center',
        marginTop: 28,
        marginBottom: 8,
        paddingHorizontal: 4,
    },
    wordmarkRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        minHeight: 54,
    },
    wordmarkLetter: {
        includeFontPadding: false,
        fontSize: 44,
        lineHeight: 46,
        color: PALETTE.textInverted,
        fontWeight: '900',
        letterSpacing: 0.3,
    },
    wordmarkAccent: {
        color: PALETTE.accent,
    },
    tagline: {
        marginTop: 10,
        fontSize: 14,
        lineHeight: 20,
        color: PALETTE.textInverted,
        textAlign: 'center',
        fontWeight: '600',
        opacity: 0.88,
        letterSpacing: 0.1,
    },
    ctaBlock: {
        gap: 10,
        padding: 14,
        borderRadius: 28,
        backgroundColor: 'rgba(6, 10, 18, 0.30)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.12)',
    },
    ctaEyebrow: {
        color: 'rgba(255, 255, 255, 0.76)',
        fontSize: 12,
        fontWeight: '700',
        letterSpacing: 0.9,
        textTransform: 'uppercase',
    },
    primaryBtnContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    primaryBtn: {
        minHeight: 58,
        borderRadius: RADIUS.full,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.78)',
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.md,
    },
    primaryBtnText: {
        color: PALETTE.textPrimary,
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 0.1,
    },
    secondaryBtnContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    secondaryBtn: {
        minHeight: 52,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.16)',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryBtnText: {
        color: PALETTE.textInverted,
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
});
