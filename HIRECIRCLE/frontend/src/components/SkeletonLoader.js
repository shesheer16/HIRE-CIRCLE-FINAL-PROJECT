import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MOTION } from '../theme/motion';
import { RADIUS, PALETTE } from '../theme/theme';

const SkeletonLoader = ({ width, height, style, borderRadius = RADIUS.md }) => {
    const shimmerX = useRef(new Animated.Value(0)).current;
    const pulseValue = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const shimmerLoop = Animated.loop(
            Animated.timing(shimmerX, {
                toValue: 1,
                duration: MOTION.shimmerTravelMs || 1400,
                useNativeDriver: true,
            })
        );
        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseValue, {
                    toValue: 1,
                    duration: MOTION.skeletonPulseMs || 900,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseValue, {
                    toValue: 0,
                    duration: MOTION.skeletonPulseMs || 900,
                    useNativeDriver: true,
                }),
            ])
        );

        shimmerLoop.start();
        pulseLoop.start();
        return () => {
            shimmerLoop.stop();
            pulseLoop.stop();
        };
    }, [shimmerX, pulseValue]);

    const shimmerTranslateX = shimmerX.interpolate({
        inputRange: [0, 1],
        outputRange: [-220, 220],
    });

    const opacity = pulseValue.interpolate({
        inputRange: [0, 1],
        outputRange: [0.5, 0.85],
    });

    return (
        <View
            style={[
                styles.skeleton,
                { width, height, borderRadius, backgroundColor: PALETTE.surface2 },
                style,
            ]}
        >
            <Animated.View
                pointerEvents="none"
                style={[
                    styles.shimmerTrack,
                    {
                        transform: [{ translateX: shimmerTranslateX }],
                        opacity,
                    },
                ]}
            >
                <LinearGradient
                    colors={[
                        'rgba(255,255,255,0)',
                        'rgba(255,255,255,0.85)',
                        'rgba(255,255,255,0)',
                    ]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.shimmerGradient}
                />
            </Animated.View>
        </View>
    );
};

const styles = StyleSheet.create({
    skeleton: {
        marginVertical: 4,
        overflow: 'hidden',
    },
    shimmerTrack: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        width: 160,
    },
    shimmerGradient: {
        flex: 1,
    },
});

export default SkeletonLoader;
