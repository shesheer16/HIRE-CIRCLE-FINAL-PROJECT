import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '../theme/colors';

export default function Toast({ visible, message, onHide }) {
    const insets = useSafeAreaInsets();
    const translateY = useRef(new Animated.Value(-60)).current;
    const [mounted, setMounted] = useState(Boolean(visible && message));

    useEffect(() => {
        let timeoutId;

        if (visible && message) {
            setMounted(true);
            Animated.timing(translateY, {
                toValue: 0,
                duration: 250,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();

            timeoutId = setTimeout(() => {
                Animated.timing(translateY, {
                    toValue: -60,
                    duration: 200,
                    easing: Easing.in(Easing.quad),
                    useNativeDriver: true,
                }).start(() => {
                    setMounted(false);
                    onHide?.();
                });
            }, 2500);
        } else if (mounted) {
            Animated.timing(translateY, {
                toValue: -60,
                duration: 200,
                easing: Easing.in(Easing.quad),
                useNativeDriver: true,
            }).start(() => {
                setMounted(false);
                onHide?.();
            });
        }

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [message, mounted, onHide, translateY, visible]);

    if (!mounted || !message) return null;

    return (
        <Animated.View
            pointerEvents="none"
            style={[styles.container, { top: insets.top + 12, transform: [{ translateY }] }]}
        >
            <Text style={styles.text}>{message}</Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 50,
        backgroundColor: C.toastBg,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 20,
    },
    text: {
        fontSize: 14,
        fontWeight: '500',
        color: C.onAccent,
    },
});
