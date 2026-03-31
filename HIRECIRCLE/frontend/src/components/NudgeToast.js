import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';

export default function NudgeToast({ visible, text, actionLabel, onAction, onDismiss }) {
    const translateY = useRef(new Animated.Value(24)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!visible) return;

        Animated.parallel([
            Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
            Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        ]).start();

        const timeout = setTimeout(() => {
            Animated.parallel([
                Animated.timing(translateY, { toValue: 24, duration: 220, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
            ]).start(() => onDismiss?.());
        }, 3400);

        return () => clearTimeout(timeout);
    }, [opacity, onDismiss, translateY, visible]);

    if (!visible) return null;

    return (
        <Animated.View style={[styles.container, { opacity, transform: [{ translateY }] }]}>
            <Text style={styles.text}>{text}</Text>
            {actionLabel && onAction ? (
                <TouchableOpacity onPress={onAction} style={styles.actionBtn} activeOpacity={0.85}>
                    <Text style={styles.actionText}>{actionLabel}</Text>
                </TouchableOpacity>
            ) : null}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 96,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.13,
        shadowRadius: 14,
        elevation: 5,
        zIndex: 40,
        gap: 10,
    },
    text: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '600',
        color: '#1e3a8a',
    },
    actionBtn: {
        borderRadius: 999,
        backgroundColor: '#1d4ed8',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    actionText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
    },
});
