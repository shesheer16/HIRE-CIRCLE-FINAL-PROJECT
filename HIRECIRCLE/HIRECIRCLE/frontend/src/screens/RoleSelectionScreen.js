import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
    Animated, Easing, StyleSheet, Text,
    TouchableOpacity, View, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { PALETTE, RADIUS, SHADOWS } from '../theme/theme';
import { triggerHaptic } from '../utils/haptics';

const { width: SW, height: SH } = Dimensions.get('window');

export default function RoleSelectionScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { rememberAuthEntryRole } = useContext(AuthContext);
    const [selected, setSelected] = useState(null);

    // Entrance animations
    const fadeIn     = useRef(new Animated.Value(0)).current;
    const headerY    = useRef(new Animated.Value(24)).current;
    const card1Y     = useRef(new Animated.Value(50)).current;
    const card2Y     = useRef(new Animated.Value(70)).current;
    const footerFade = useRef(new Animated.Value(0)).current;

    // Interactive
    const card1Scale = useRef(new Animated.Value(1)).current;
    const card2Scale = useRef(new Animated.Value(1)).current;
    const card1Glow  = useRef(new Animated.Value(0)).current;
    const card2Glow  = useRef(new Animated.Value(0)).current;

    // Ambient
    const orb1Y = useRef(new Animated.Value(0)).current;
    const orb2Y = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Staggered entrance
        Animated.stagger(100, [
            Animated.parallel([
                Animated.timing(fadeIn, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                Animated.spring(headerY, { toValue: 0, damping: 16, stiffness: 140, useNativeDriver: true }),
            ]),
            Animated.spring(card1Y, { toValue: 0, damping: 14, stiffness: 120, useNativeDriver: true }),
            Animated.spring(card2Y, { toValue: 0, damping: 14, stiffness: 120, useNativeDriver: true }),
            Animated.timing(footerFade, { toValue: 1, duration: 400, useNativeDriver: true }),
        ]).start();

        // Floating orbs
        const float = (val, dur) => Animated.loop(Animated.sequence([
            Animated.timing(val, { toValue: -14, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(val, { toValue: 14, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]));
        const f1 = float(orb1Y, 3800);
        const f2 = float(orb2Y, 4600);
        f1.start(); f2.start();
        return () => { f1.stop(); f2.stop(); };
    }, [fadeIn, headerY, card1Y, card2Y, footerFade, orb1Y, orb2Y]);

    const handleSelect = useCallback((roleKey) => {
        if (selected) return;
        setSelected(roleKey);
        triggerHaptic?.medium?.();
        void rememberAuthEntryRole?.(roleKey);

        const isWorker = roleKey === 'worker';
        const aScale = isWorker ? card1Scale : card2Scale;
        const aGlow  = isWorker ? card1Glow : card2Glow;
        const bScale = isWorker ? card2Scale : card1Scale;

        Animated.parallel([
            Animated.sequence([
                Animated.spring(aScale, { toValue: 0.98, damping: 12, stiffness: 280, useNativeDriver: true }),
                Animated.spring(aScale, { toValue: 1.0, damping: 14, stiffness: 200, useNativeDriver: true }),
            ]),
            Animated.timing(aGlow, { toValue: 1, duration: 180, useNativeDriver: false }),
            Animated.timing(bScale, { toValue: 0.94, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start();

        setTimeout(() => {
            if (typeof navigation?.reset === 'function') {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login', params: { selectedRole: roleKey } }],
                });
                return;
            }
            navigation.replace('Login', { selectedRole: roleKey });
        }, 0);
    }, [selected, rememberAuthEntryRole, navigation, card1Scale, card2Scale, card1Glow, card2Glow]);

    const openLegal = useCallback((section) => {
        navigation.navigate('TermsPrivacy', { section });
    }, [navigation]);

    const card1BorderColor = card1Glow.interpolate({ inputRange: [0, 1], outputRange: ['#EFEFEF', '#A855F7'] });
    const card2BorderColor = card2Glow.interpolate({ inputRange: [0, 1], outputRange: ['#EFEFEF', '#7C3AED'] });

    return (
        <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {/* Ambient orbs */}
            <Animated.View style={[styles.orb1, { transform: [{ translateY: orb1Y }] }]} />
            <Animated.View style={[styles.orb2, { transform: [{ translateY: orb2Y }] }]} />

            {/* Header */}
            <Animated.View style={[styles.header, { opacity: fadeIn, transform: [{ translateY: headerY }] }]}>
                <View style={styles.logoRow}>
                    <View style={styles.logoMark}>
                        <View style={styles.logoOuter} />
                        <View style={styles.logoInner} />
                        <View style={styles.logoDot} />
                    </View>
                    <Text style={styles.logoText}>
                        Hire<Text style={styles.logoPurple}>Circle</Text>
                    </Text>
                </View>
                <Text style={styles.heading}>How would you{'\n'}like to start?</Text>
            </Animated.View>

            {/* Cards */}
            <View style={styles.cardsArea}>
                {/* Card 1 — Job Seeker */}
                <Animated.View style={{
                    opacity: fadeIn,
                    transform: [{ translateY: card1Y }, { scale: card1Scale }],
                }}>
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={() => handleSelect('worker')}
                    >
                        <Animated.View style={[styles.card, { borderColor: card1BorderColor }]}>
                            <LinearGradient
                                colors={['#FAF5FF', '#F3E8FF', '#FFFFFF']}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                style={styles.cardBg}
                            />
                            <View style={styles.cardContent}>
                                <View style={styles.cardLeft}>
                                    <View style={styles.iconBlock}>
                                        <Ionicons name="compass" size={28} color={PALETTE.accent} />
                                    </View>
                                    <View style={styles.cardTextWrap}>
                                        <Text style={styles.cardTitle}>Find Jobs</Text>
                                        <Text style={styles.cardDesc}>Discover AI-matched{'\n'}opportunities near you</Text>
                                    </View>
                                </View>
                                <View style={[
                                    styles.goCircle,
                                    selected === 'worker' && styles.goCircleActive,
                                ]}>
                                    <Ionicons
                                        name={selected === 'worker' ? 'checkmark' : 'arrow-forward'}
                                        size={18}
                                        color="#FFFFFF"
                                    />
                                </View>
                            </View>

                            {/* Active glow edge */}
                            {selected === 'worker' && <View style={styles.activeEdge} />}
                        </Animated.View>
                    </TouchableOpacity>
                </Animated.View>

                {/* Card 2 — Employer */}
                <Animated.View style={{
                    opacity: fadeIn,
                    transform: [{ translateY: card2Y }, { scale: card2Scale }],
                }}>
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={() => handleSelect('hybrid')}
                    >
                        <Animated.View style={[styles.card, { borderColor: card2BorderColor }]}>
                            <LinearGradient
                                colors={['#EDE9FE', '#DDD6FE', '#FFFFFF']}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                style={styles.cardBg}
                            />
                            <View style={styles.cardContent}>
                                <View style={styles.cardLeft}>
                                    <View style={[styles.iconBlock, styles.iconBlockDeep]}>
                                        <Ionicons name="flash" size={28} color={PALETTE.accentDeep} />
                                    </View>
                                    <View style={styles.cardTextWrap}>
                                        <Text style={styles.cardTitle}>Hire Talent</Text>
                                        <Text style={styles.cardDesc}>Post jobs and connect{'\n'}with verified candidates</Text>
                                    </View>
                                </View>
                                <View style={[
                                    styles.goCircle, styles.goCircleDeep,
                                    selected === 'hybrid' && styles.goCircleActive,
                                ]}>
                                    <Ionicons
                                        name={selected === 'hybrid' ? 'checkmark' : 'arrow-forward'}
                                        size={18}
                                        color="#FFFFFF"
                                    />
                                </View>
                            </View>

                            {selected === 'hybrid' && <View style={[styles.activeEdge, styles.activeEdgeDeep]} />}
                        </Animated.View>
                    </TouchableOpacity>
                </Animated.View>
            </View>

            {/* Footer */}
            <Animated.View style={[styles.footer, { opacity: footerFade }]}>
                <View style={styles.trustRow}>
                    <View style={styles.trustChip}>
                        <Ionicons name="shield-checkmark" size={13} color={PALETTE.accent} />
                        <Text style={styles.trustText}>Verified employers</Text>
                    </View>
                    <View style={styles.trustChip}>
                        <Ionicons name="lock-closed" size={13} color={PALETTE.accent} />
                        <Text style={styles.trustText}>End-to-end secure</Text>
                    </View>
                </View>
                <Text style={styles.legal}>
                    By continuing you agree to our{' '}
                    <Text style={styles.legalLink} onPress={() => openLegal('terms')}>Terms</Text>
                    {' & '}
                    <Text style={styles.legalLink} onPress={() => openLegal('privacy')}>Privacy</Text>
                </Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: PALETTE.background,
        paddingHorizontal: 24,
    },

    // Ambient orbs
    orb1: {
        position: 'absolute', top: '8%', right: -50,
        width: 180, height: 180, borderRadius: 90,
        backgroundColor: 'rgba(168,85,247,0.07)',
    },
    orb2: {
        position: 'absolute', bottom: '15%', left: -60,
        width: 200, height: 200, borderRadius: 100,
        backgroundColor: 'rgba(124,58,237,0.05)',
    },

    // Header
    header: {
        paddingTop: 32,
        marginBottom: 32,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 24,
    },
    logoMark: {
        width: 36, height: 36,
        alignItems: 'center', justifyContent: 'center',
    },
    logoOuter: {
        position: 'absolute', width: 34, height: 34, borderRadius: 17,
        borderWidth: 2, borderColor: PALETTE.accent,
    },
    logoInner: {
        position: 'absolute', width: 18, height: 18, borderRadius: 9,
        borderWidth: 2, borderColor: PALETTE.accentDeep,
    },
    logoDot: {
        width: 5, height: 5, borderRadius: 2.5,
        backgroundColor: PALETTE.accent,
    },
    logoText: {
        fontSize: 22, fontWeight: '700',
        color: PALETTE.textPrimary, letterSpacing: -0.5,
    },
    logoPurple: { color: PALETTE.accent },
    heading: {
        fontSize: 30, fontWeight: '800',
        color: PALETTE.textPrimary,
        letterSpacing: -0.8, lineHeight: 37,
    },

    // Cards
    cardsArea: {
        flex: 1,
        justifyContent: 'center',
        gap: 16,
    },
    card: {
        borderRadius: 24,
        borderWidth: 2,
        borderColor: '#EFEFEF',
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    cardBg: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 22,
    },
    cardContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingVertical: 28,
    },
    cardLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        flex: 1,
    },
    iconBlock: {
        width: 56, height: 56, borderRadius: 18,
        backgroundColor: 'rgba(168,85,247,0.12)',
        alignItems: 'center', justifyContent: 'center',
    },
    iconBlockDeep: {
        backgroundColor: 'rgba(124,58,237,0.12)',
    },
    cardTextWrap: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 20, fontWeight: '800',
        color: PALETTE.textPrimary,
        letterSpacing: -0.3, marginBottom: 4,
    },
    cardDesc: {
        fontSize: 13, fontWeight: '400',
        color: PALETTE.textSecondary, lineHeight: 18,
    },
    goCircle: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: PALETTE.accent,
        alignItems: 'center', justifyContent: 'center',
        marginLeft: 12,
        shadowColor: PALETTE.accent,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.30, shadowRadius: 10,
        elevation: 4,
    },
    goCircleDeep: {
        backgroundColor: PALETTE.accentDeep,
        shadowColor: PALETTE.accentDeep,
    },
    goCircleActive: {
        backgroundColor: '#22c55e',
        shadowColor: '#22c55e',
    },
    activeEdge: {
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: 4, backgroundColor: PALETTE.accent,
        borderTopLeftRadius: 24, borderBottomLeftRadius: 24,
    },
    activeEdgeDeep: {
        backgroundColor: PALETTE.accentDeep,
    },

    // Footer
    footer: {
        paddingBottom: 16,
        gap: 14,
    },
    trustRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
    },
    trustChip: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: PALETTE.accentTint,
        borderRadius: RADIUS.full,
        paddingHorizontal: 12, paddingVertical: 7,
        borderWidth: 1, borderColor: 'rgba(168,85,247,0.12)',
    },
    trustText: {
        fontSize: 11, fontWeight: '600', color: PALETTE.textSecondary,
    },
    legal: {
        textAlign: 'center', fontSize: 11,
        color: PALETTE.textTertiary, lineHeight: 16,
    },
    legalLink: {
        color: PALETTE.accent, fontWeight: '600',
    },
});
