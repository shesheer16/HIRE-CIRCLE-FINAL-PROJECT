import React, { useRef } from 'react';
import { Animated, Easing, StyleSheet, TouchableWithoutFeedback } from 'react-native';

export default function PressableScale({
    children,
    disabled = false,
    onPress,
    onPressIn,
    onPressOut,
    style,
    pressInScale = 0.97,
    pressInOpacity = 0.82,
    durationIn = 100,
    durationOut = 120,
    hitSlop,
}) {
    const scale = useRef(new Animated.Value(1)).current;
    const opacity = useRef(new Animated.Value(1)).current;

    const animateTo = (toScale, toOpacity, duration) => {
        Animated.parallel([
            Animated.timing(scale, {
                toValue: toScale,
                duration,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: toOpacity,
                duration,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
        ]).start();
    };

    return (
        <TouchableWithoutFeedback
            disabled={disabled}
            hitSlop={hitSlop}
            onPress={onPress}
            onPressIn={() => {
                animateTo(pressInScale, pressInOpacity, durationIn);
                onPressIn?.();
            }}
            onPressOut={() => {
                animateTo(1, 1, durationOut);
                onPressOut?.();
            }}
        >
            <Animated.View style={[styles.base, style, { opacity, transform: [{ scale }] }]}>
                {children}
            </Animated.View>
        </TouchableWithoutFeedback>
    );
}

const styles = StyleSheet.create({
    base: {
        minWidth: 44,
        minHeight: 44,
    },
});
