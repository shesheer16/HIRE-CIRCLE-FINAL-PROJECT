import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MOTION } from '../theme/motion';
import { RADIUS } from '../theme/theme';

const SkeletonLoader = ({ width, height, style, borderRadius = RADIUS.md, tone = 'default' }) => {
    const pulseValue = useRef(new Animated.Value(0)).current;
    const shimmerX = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseValue, {
                    toValue: 1,
                    duration: MOTION.skeletonPulseMs,
                    useNativeDriver: true,
                }),
                Animated.timing(pulseValue, {
                    toValue: 0,
                    duration: MOTION.skeletonPulseMs,
                    useNativeDriver: true,
                })
            ])
        );
        const shimmerLoop = Animated.loop(
            Animated.timing(shimmerX, {
                toValue: 1,
                duration: MOTION.shimmerTravelMs,
                useNativeDriver: true,
            })
        );

        pulseLoop.start();
        shimmerLoop.start();
        return () => {
            pulseLoop.stop();
            shimmerLoop.stop();
        };
    }, [pulseValue, shimmerX]);

    const opacity = pulseValue.interpolate({
        inputRange: [0, 1],
        outputRange: [0.58, 0.92],
    });

    const shimmerTranslateX = shimmerX.interpolate({
        inputRange: [0, 1],
        outputRange: [-220, 220],
    });

    const baseColor = tone === 'tint' ? '#e8edff' : '#e2e8f0';
    const shineColor = tone === 'tint' ? 'rgba(245, 248, 255, 0.95)' : 'rgba(248, 250, 252, 0.92)';

    return (
        <View
            style={[
                styles.skeleton,
                { width, height, borderRadius, backgroundColor: baseColor },
                style
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
                    colors={['rgba(255,255,255,0)', shineColor, 'rgba(255,255,255,0)']}
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
        width: 130,
    },
    shimmerGradient: {
        flex: 1,
    }
});

export default SkeletonLoader;
