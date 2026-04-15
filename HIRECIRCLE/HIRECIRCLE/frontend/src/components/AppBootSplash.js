import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, Dimensions } from 'react-native';
import { PALETTE } from '../theme/theme';

const { width: SCREEN_W } = Dimensions.get('window');

export default function AppBootSplash({ showProgress = true }) {
    const logoScale   = useRef(new Animated.Value(0.6)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const ringPulse   = useRef(new Animated.Value(0.85)).current;
    const tagOpacity  = useRef(new Animated.Value(0)).current;
    const dotScale    = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Phase 1: Logo appears with spring
        Animated.parallel([
            Animated.spring(logoScale, {
                toValue: 1,
                damping: 14,
                stiffness: 160,
                mass: 0.8,
                useNativeDriver: true,
            }),
            Animated.timing(logoOpacity, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();

        // Phase 2: Ring breathe loop
        const ringBreath = Animated.loop(
            Animated.sequence([
                Animated.timing(ringPulse, {
                    toValue: 1.06,
                    duration: 1800,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
                Animated.timing(ringPulse, {
                    toValue: 0.94,
                    duration: 1800,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
            ])
        );
        ringBreath.start();

        // Phase 3: "from" tag fades in
        const tagDelay = setTimeout(() => {
            Animated.timing(tagOpacity, {
                toValue: 1,
                duration: 500,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }, 600);

        // Phase 4: Loading dot pulse
        const dotPulse = Animated.loop(
            Animated.sequence([
                Animated.timing(dotScale, {
                    toValue: 1,
                    duration: 600,
                    easing: Easing.out(Easing.cubic),
                    useNativeDriver: true,
                }),
                Animated.timing(dotScale, {
                    toValue: 0.3,
                    duration: 600,
                    easing: Easing.in(Easing.cubic),
                    useNativeDriver: true,
                }),
            ])
        );
        const dotDelay = setTimeout(() => dotPulse.start(), 900);

        return () => {
            ringBreath.stop();
            dotPulse.stop();
            clearTimeout(tagDelay);
            clearTimeout(dotDelay);
        };
    }, [logoScale, logoOpacity, ringPulse, tagOpacity, dotScale]);

    return (
        <View style={styles.container}>
            {/* Center: Logo mark */}
            <Animated.View
                style={[
                    styles.logoWrap,
                    {
                        opacity: logoOpacity,
                        transform: [{ scale: logoScale }],
                    },
                ]}
            >
                <Animated.View
                    style={[
                        styles.ringOuter,
                        { transform: [{ scale: ringPulse }] },
                    ]}
                />
                <View style={styles.ringInner} />
                <View style={styles.coreDot} />
            </Animated.View>

            {/* Bottom: "from HireCircle" — like WhatsApp's "from Meta" */}
            <Animated.View style={[styles.bottomTag, { opacity: tagOpacity }]}>
                <Text style={styles.fromText}>from</Text>
                <Text style={styles.brandText}>
                    Hire<Text style={styles.brandAccent}>Circle</Text>
                </Text>
            </Animated.View>

            {/* Tiny loading pulse dot */}
            {showProgress && (
                <Animated.View
                    style={[
                        styles.loadDot,
                        { transform: [{ scale: dotScale }] },
                    ]}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Logo — just 3 shapes, nothing else
    logoWrap: {
        width: 120,
        height: 120,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ringOuter: {
        position: 'absolute',
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        borderColor: PALETTE.accent,
    },
    ringInner: {
        position: 'absolute',
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 3,
        borderColor: PALETTE.accentDeep,
    },
    coreDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: PALETTE.accent,
    },
    // Bottom tag — WhatsApp style
    bottomTag: {
        position: 'absolute',
        bottom: 48,
        alignItems: 'center',
    },
    fromText: {
        fontSize: 11,
        fontWeight: '400',
        color: PALETTE.textTertiary,
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    brandText: {
        fontSize: 18,
        fontWeight: '700',
        color: PALETTE.textPrimary,
        letterSpacing: -0.3,
    },
    brandAccent: {
        color: PALETTE.accent,
    },
    // Loading dot
    loadDot: {
        position: 'absolute',
        bottom: 110,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: PALETTE.accent,
    },
});
