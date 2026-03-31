import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

const { width: screenWidth } = Dimensions.get('window');

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444'];

export default function CelebrationConfetti({ visible, onEnd }) {
    const particles = useMemo(() => Array.from({ length: 22 }).map((_, index) => ({
        id: `particle-${index}`,
        left: Math.random() * (screenWidth - 16),
        delay: Math.random() * 320,
        color: COLORS[index % COLORS.length],
        size: 6 + (Math.random() * 6),
    })), []);

    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) return;

        progress.setValue(0);
        Animated.timing(progress, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
        }).start(() => onEnd?.());
    }, [onEnd, progress, visible]);

    if (!visible) return null;

    return (
        <View pointerEvents="none" style={styles.overlay}>
            {particles.map((particle) => {
                const translateY = progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-30 - particle.delay, 420 + particle.delay],
                });
                const rotate = progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${280 + particle.delay}deg`],
                });
                const opacity = progress.interpolate({
                    inputRange: [0, 0.9, 1],
                    outputRange: [1, 1, 0],
                });

                return (
                    <Animated.View
                        key={particle.id}
                        style={[
                            styles.particle,
                            {
                                left: particle.left,
                                width: particle.size,
                                height: particle.size,
                                backgroundColor: particle.color,
                                opacity,
                                transform: [{ translateY }, { rotate }],
                            },
                        ]}
                    />
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 60,
    },
    particle: {
        position: 'absolute',
        top: -10,
        borderRadius: 2,
    },
});
