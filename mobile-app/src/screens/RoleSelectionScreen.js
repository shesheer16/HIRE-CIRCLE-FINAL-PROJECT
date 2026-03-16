import React, { useCallback, useContext, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AuthContext } from '../context/AuthContext';
import { GLASS_GRADIENTS, GLASS_PALETTE, GLASS_SHADOWS, GLASS_SURFACES } from '../theme/glass';
import { triggerHaptic } from '../utils/haptics';

const SELECTION_DELAY_MS = 260;

const ROLE_CARDS = [
    {
        key: 'worker',
        title: "I'm a Job Seeker",
        subtitle: 'Find jobs and get matched by AI.',
        icon: 'person-outline',
    },
    {
        key: 'hybrid',
        title: 'Hybrid Mode',
        subtitle: 'Post jobs and find top talent fast.',
        icon: 'briefcase-outline',
    },
];

export default function RoleSelectionScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { rememberAuthEntryRole } = useContext(AuthContext);
    const [activeRole, setActiveRole] = useState(null);
    const cardAnimationsRef = useRef({
        worker: new Animated.Value(0),
        hybrid: new Animated.Value(0),
    });
    const cardAnimations = cardAnimationsRef.current;

    const animateRoleSelection = useCallback((selectedRole) => {
        Animated.parallel(
            ROLE_CARDS.map((card) => (
                Animated.timing(cardAnimations[card.key], {
                    toValue: selectedRole === card.key ? 1 : 0,
                    duration: 190,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: false,
                })
            ))
        ).start();
    }, [cardAnimations]);

    const openLogin = useCallback((roleKey) => {
        setActiveRole(roleKey);
        animateRoleSelection(roleKey);
        triggerHaptic.light();
        void rememberAuthEntryRole?.(roleKey);
        setTimeout(() => {
            navigation.navigate('Login', { selectedRole: roleKey });
        }, SELECTION_DELAY_MS);
    }, [animateRoleSelection, navigation, rememberAuthEntryRole]);

    return (
        <LinearGradient colors={GLASS_GRADIENTS.screen} style={styles.container}>
            <View style={styles.bgGlowTop} />
            <View style={styles.bgGlowMid} />
            <View style={styles.bgGlowBottom} />

            <View
                style={[
                    styles.content,
                    { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 30 },
                ]}
            >
                <View style={styles.header}>
                    <View style={styles.headerPill}>
                        <Ionicons name="sparkles-outline" size={14} color={GLASS_PALETTE.accentText} />
                        <Text style={styles.headerPillText}>Choose your clean workspace</Text>
                    </View>
                    <View style={styles.logoBadge}>
                        <View style={styles.logoGlyph}>
                            <View style={styles.logoRingOuter} />
                            <View style={styles.logoRingMid} />
                            <View style={styles.logoRingInner} />
                        </View>
                    </View>
                    <Text style={styles.mainTitle}>
                        Hire<Text style={styles.mainTitleAccent}>Circle</Text>
                    </Text>
                    <Text style={styles.subtitle}>Smart AI matching for everyone.</Text>
                </View>

                <View style={styles.cardStack}>
                    {ROLE_CARDS.map((card) => {
                        const isActive = activeRole === card.key;
                        const animationValue = cardAnimations[card.key];
                        const animatedCardStyle = {
                            borderColor: animationValue.interpolate({
                                inputRange: [0, 1],
                                outputRange: [GLASS_PALETTE.borderStrong, '#9C5AF7'],
                            }),
                            backgroundColor: animationValue.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['rgba(255,255,255,0.76)', 'rgba(255,255,255,0.92)'],
                            }),
                            transform: [
                                {
                                    scale: animationValue.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [1, 1.01],
                                    }),
                                },
                            ],
                        };
                        const animatedIconStyle = {
                            backgroundColor: animationValue.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['rgba(255,255,255,0.72)', GLASS_PALETTE.accentSoft],
                            }),
                        };

                        return (
                            <TouchableOpacity
                                key={card.key}
                                activeOpacity={0.96}
                                onPress={() => openLogin(card.key)}
                            >
                                <Animated.View style={[styles.cardWrapper, animatedCardStyle]}>
                                    <Animated.View style={[styles.iconContainer, animatedIconStyle]}>
                                        <Ionicons
                                            name={card.icon}
                                            size={28}
                                            color={isActive ? '#7C3AED' : '#A855F7'}
                                        />
                                    </Animated.View>

                                    <View style={styles.cardTextWrap}>
                                        <Text style={[styles.cardTitle, isActive && styles.cardTitleActive]}>
                                            {card.title}
                                        </Text>
                                        <Text style={styles.cardSubtitle}>{card.subtitle}</Text>
                                    </View>

                                    <View style={[styles.cardArrow, isActive && styles.cardArrowActive]}>
                                        <Ionicons
                                            name="arrow-forward"
                                            size={16}
                                            color={isActive ? '#ffffff' : GLASS_PALETTE.accentText}
                                        />
                                    </View>
                                    <View style={styles.decorCircle} />
                                </Animated.View>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            </View>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    bgGlowTop: {
        position: 'absolute',
        top: -120,
        left: -88,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: GLASS_PALETTE.glowLavender,
    },
    bgGlowMid: {
        position: 'absolute',
        top: '34%',
        right: -60,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: GLASS_PALETTE.glowBlue,
    },
    bgGlowBottom: {
        position: 'absolute',
        right: -84,
        bottom: -84,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: GLASS_PALETTE.glowRose,
    },
    content: {
        flex: 1,
        paddingHorizontal: 28,
        justifyContent: 'center',
    },
    header: {
        marginBottom: 36,
        alignItems: 'center',
    },
    headerPill: {
        ...GLASS_SURFACES.softPanel,
        ...GLASS_SHADOWS.soft,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        marginBottom: 18,
    },
    headerPillText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '700',
        color: GLASS_PALETTE.accentText,
        letterSpacing: 0.1,
    },
    logoBadge: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        width: 84,
        height: 84,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
    },
    logoGlyph: {
        width: 56,
        height: 56,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoRingOuter: {
        position: 'absolute',
        width: 52,
        height: 52,
        borderRadius: 26,
        borderWidth: 3,
        borderColor: GLASS_PALETTE.accent,
    },
    logoRingMid: {
        position: 'absolute',
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 3,
        borderColor: GLASS_PALETTE.accent,
    },
    logoRingInner: {
        position: 'absolute',
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 3,
        borderColor: GLASS_PALETTE.accent,
    },
    mainTitle: {
        fontSize: 44,
        lineHeight: 46,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        marginBottom: 10,
        letterSpacing: -1.2,
    },
    mainTitleAccent: {
        color: GLASS_PALETTE.accent,
    },
    subtitle: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
        textAlign: 'center',
    },
    cardStack: {
        gap: 18,
    },
    cardWrapper: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        minHeight: 124,
        borderRadius: 24,
        borderWidth: 1.8,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 22,
        overflow: 'hidden',
    },
    iconContainer: {
        ...GLASS_SURFACES.softPanel,
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
        zIndex: 2,
    },
    cardTextWrap: {
        flex: 1,
        zIndex: 2,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: GLASS_PALETTE.text,
        marginBottom: 6,
        letterSpacing: -0.15,
    },
    cardTitleActive: {
        color: GLASS_PALETTE.accentText,
    },
    cardSubtitle: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
        color: GLASS_PALETTE.textMuted,
    },
    cardArrow: {
        ...GLASS_SURFACES.softPanel,
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    cardArrowActive: {
        backgroundColor: GLASS_PALETTE.accent,
        borderColor: 'rgba(111, 78, 246, 0.2)',
    },
    decorCircle: {
        position: 'absolute',
        right: -14,
        top: '50%',
        width: 108,
        height: 108,
        borderRadius: 54,
        backgroundColor: GLASS_PALETTE.accentTint,
        transform: [{ translateY: -54 }],
    },
});
