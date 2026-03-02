import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function AppBootSplash({ showProgress = true }) {
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const logoScale = useRef(new Animated.Value(0.92)).current;
    const taglineOpacity = useRef(new Animated.Value(0)).current;
    const glowOpacity = useRef(new Animated.Value(0.08)).current;
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const animation = Animated.parallel([
            Animated.sequence([
                Animated.timing(glowOpacity, {
                    toValue: 0.18,
                    duration: 220,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(glowOpacity, {
                    toValue: 0.14,
                    duration: 360,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
            Animated.sequence([
                Animated.parallel([
                    Animated.timing(logoOpacity, {
                        toValue: 1,
                        duration: 300,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                    Animated.timing(logoScale, {
                        toValue: 1,
                        duration: 320,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                ]),
                Animated.timing(taglineOpacity, {
                    toValue: 1,
                    duration: 180,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.delay(140),
            ]),
            Animated.timing(progress, {
                toValue: 1,
                duration: 760,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: false,
            }),
        ]);

        animation.start();
        return () => animation.stop();
    }, [glowOpacity, logoOpacity, logoScale, progress, showProgress, taglineOpacity]);

    const progressWidth = progress.interpolate({
        inputRange: [0, 1],
        outputRange: ['6%', '94%'],
    });

    return (
        <LinearGradient
            colors={['#0f172a', '#0d1b33', '#111827']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.container}
        >
            <Animated.View style={[styles.glowLayer, { opacity: glowOpacity }]} />

            <Animated.View
                style={[
                    styles.logoBlock,
                    { opacity: logoOpacity, transform: [{ scale: logoScale }] },
                ]}
            >
                <Text style={styles.logoPrimary}>HIRE</Text>
                <Text style={styles.logoSecondary}>CIRCLE</Text>
                <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>AI Matches Work to Reality</Animated.Text>
            </Animated.View>

            {showProgress ? (
                <View style={styles.progressTrack}>
                    <Animated.View style={[styles.progressFill, { width: progressWidth }]} />
                </View>
            ) : null}
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    glowLayer: {
        position: 'absolute',
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: '#1d4ed8',
    },
    logoBlock: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoPrimary: {
        color: '#f8fbff',
        fontSize: 36,
        fontWeight: '700',
        letterSpacing: 1.1,
        lineHeight: 42,
    },
    logoSecondary: {
        color: '#a8c0ff',
        fontSize: 36,
        fontWeight: '700',
        letterSpacing: 1,
        lineHeight: 42,
    },
    tagline: {
        marginTop: 14,
        color: '#dbe6ff',
        fontSize: 13,
        fontWeight: '400',
        letterSpacing: 0.2,
    },
    progressTrack: {
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 32,
        height: 2,
        borderRadius: 2,
        overflow: 'hidden',
        backgroundColor: 'rgba(148,163,184,0.25)',
    },
    progressFill: {
        height: '100%',
        borderRadius: 2,
        backgroundColor: '#1d4ed8',
    },
});
