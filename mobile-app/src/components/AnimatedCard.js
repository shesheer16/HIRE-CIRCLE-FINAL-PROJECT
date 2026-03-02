import React, { useRef } from 'react';
import { Animated, Easing, TouchableWithoutFeedback } from 'react-native';
import { triggerHaptic } from '../utils/haptics';
import { MOTION } from '../theme/motion';

export const AnimatedCard = ({ children, onPress, onLongPress, style }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const translateY = useRef(new Animated.Value(0)).current;

    const handlePressIn = () => {
        Animated.parallel([
            Animated.timing(scale, {
                toValue: 0.98,
                duration: MOTION.pressInMs,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 1,
                duration: MOTION.pressInMs,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }),
        ]).start();
        triggerHaptic.light();
    };

    const handlePressOut = () => {
        Animated.parallel([
            Animated.spring(scale, {
                toValue: 1,
                stiffness: MOTION.modalSpring.stiffness,
                damping: MOTION.modalSpring.damping,
                mass: MOTION.modalSpring.mass,
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: 0,
                duration: MOTION.pressOutMs,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }),
        ]).start();
    };

    return (
        <TouchableWithoutFeedback
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={onPress}
            onLongPress={onLongPress}
            delayPressIn={10}
        >
            <Animated.View style={[{ transform: [{ scale }, { translateY }] }, style]}>
                {children}
            </Animated.View>
        </TouchableWithoutFeedback>
    );
};
