import React, { useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated,
    Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PALETTE } from '../theme/theme';

export default function ComingSoonScreen() {
    const insets = useSafeAreaInsets();

    // Subtle floating animation for the icon
    const floatAnim = useRef(new Animated.Value(0)).current;
    // Fade-in animation for content
    const fadeAnim = useRef(new Animated.Value(0)).current;
    // Scale pulse for the badge
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        // Fade in on mount
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();

        // Continuous gentle float
        Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, {
                    toValue: -10,
                    duration: 2000,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
                Animated.timing(floatAnim, {
                    toValue: 0,
                    duration: 2000,
                    easing: Easing.inOut(Easing.sin),
                    useNativeDriver: true,
                }),
            ])
        ).start();

        // Subtle pulse on the "Coming Soon" badge
        Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1.06,
                    duration: 1200,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 1200,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        ).start();
    }, [fadeAnim, floatAnim, pulseAnim]);

    return (
        <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <LinearGradient
                colors={['#faf5ff', '#f3e8ff', '#ede9fe']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />

            {/* Decorative background blobs */}
            <View style={styles.blobTopRight} />
            <View style={styles.blobBottomLeft} />

            <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

                {/* Icon container with float animation */}
                <Animated.View style={[styles.iconWrap, { transform: [{ translateY: floatAnim }] }]}>
                    <LinearGradient
                        colors={['#7c3aed', '#a855f7', '#c084fc']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.iconGradient}
                    >
                        <Ionicons name="rocket-outline" size={52} color="#ffffff" />
                    </LinearGradient>

                    {/* Glow ring */}
                    <View style={styles.iconGlow} />
                </Animated.View>

                {/* Coming Soon badge */}
                <Animated.View style={[styles.badge, { transform: [{ scale: pulseAnim }] }]}>
                    <View style={styles.badgeDot} />
                    <Text style={styles.badgeText}>COMING SOON</Text>
                </Animated.View>

                {/* Heading */}
                <Text style={styles.heading}>Something Awesome{'\n'}Is on Its Way</Text>

                {/* Subtext */}
                <Text style={styles.subtext}>
                    We are building something awesome here.{'\n'}
                    The Connect feature is coming soon!
                </Text>

                {/* Divider */}
                <View style={styles.divider} />

                {/* Feature hint chips */}
                <View style={styles.chipRow}>
                    <View style={styles.chip}>
                        <Ionicons name="people-outline" size={13} color="#7c3aed" />
                        <Text style={styles.chipText}>Networking</Text>
                    </View>
                    <View style={styles.chip}>
                        <Ionicons name="chatbubbles-outline" size={13} color="#7c3aed" />
                        <Text style={styles.chipText}>Messaging</Text>
                    </View>
                    <View style={styles.chip}>
                        <Ionicons name="globe-outline" size={13} color="#7c3aed" />
                        <Text style={styles.chipText}>Communities</Text>
                    </View>
                </View>

            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    content: {
        alignItems: 'center',
        paddingHorizontal: 32,
        width: '100%',
    },

    // Decorative background blobs
    blobTopRight: {
        position: 'absolute',
        top: -80,
        right: -80,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: 'rgba(167, 139, 250, 0.18)',
    },
    blobBottomLeft: {
        position: 'absolute',
        bottom: -60,
        left: -60,
        width: 200,
        height: 200,
        borderRadius: 100,
        backgroundColor: 'rgba(196, 181, 253, 0.15)',
    },

    // Icon styles
    iconWrap: {
        marginBottom: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconGradient: {
        width: 112,
        height: 112,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.45,
        shadowRadius: 20,
        elevation: 12,
    },
    iconGlow: {
        position: 'absolute',
        width: 130,
        height: 130,
        borderRadius: 40,
        borderWidth: 1.5,
        borderColor: 'rgba(167,139,250,0.35)',
        top: -9,
        left: -9,
    },

    // Badge
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(124,58,237,0.10)',
        borderWidth: 1,
        borderColor: 'rgba(124,58,237,0.22)',
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginBottom: 22,
    },
    badgeDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#7c3aed',
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c3aed',
        letterSpacing: 1.2,
    },

    // Text
    heading: {
        fontSize: 26,
        fontWeight: '800',
        color: '#1e1b4b',
        textAlign: 'center',
        lineHeight: 34,
        marginBottom: 14,
    },
    subtext: {
        fontSize: 15,
        color: PALETTE.textSecondary,
        textAlign: 'center',
        lineHeight: 23,
        fontWeight: '400',
    },

    // Divider
    divider: {
        width: 48,
        height: 2,
        borderRadius: 2,
        backgroundColor: 'rgba(124,58,237,0.25)',
        marginVertical: 24,
    },

    // Feature chips
    chipRow: {
        flexDirection: 'row',
        gap: 10,
        flexWrap: 'wrap',
        justifyContent: 'center',
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(124,58,237,0.18)',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 7,
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
    },
    chipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#5b21b6',
    },
});
