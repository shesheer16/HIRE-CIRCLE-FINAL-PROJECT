import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C } from '../theme/colors';
import PressableScale from './PressableScale';

export default function FormFooter({ label, onPress, enabled, loading = false }) {
    const enableAnim = useRef(new Animated.Value(0)).current;
    const previousEnabled = useRef(Boolean(enabled));

    useEffect(() => {
        if (!previousEnabled.current && enabled) {
            enableAnim.setValue(0);
            Animated.spring(enableAnim, {
                toValue: 1,
                tension: 220,
                friction: 7,
                useNativeDriver: true,
            }).start();
        }
        previousEnabled.current = Boolean(enabled);
    }, [enableAnim, enabled]);

    return (
        <View style={styles.container}>
            <Animated.View
                style={[
                    styles.buttonWrap,
                    {
                        transform: [{
                            scale: enableAnim.interpolate({
                                inputRange: [0, 0.6, 1],
                                outputRange: [1, 1.04, 1],
                            }),
                        }],
                    },
                ]}
            >
                <PressableScale
                    disabled={!enabled || loading}
                    onPress={onPress}
                    onPressIn={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                    }}
                    style={styles.pressable}
                >
                    <View style={[styles.button, !enabled || loading ? styles.buttonDisabled : null]}>
                        {loading ? <ActivityIndicator color={C.onAccent} /> : <Text style={styles.label}>{label}</Text>}
                    </View>
                </PressableScale>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: C.border,
        backgroundColor: C.bg,
    },
    buttonWrap: {
        width: '100%',
    },
    pressable: {
        width: '100%',
    },
    button: {
        width: '100%',
        height: 52,
        borderRadius: 12,
        backgroundColor: C.accent,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonDisabled: {
        opacity: 0.28,
    },
    label: {
        fontSize: 15,
        fontWeight: '500',
        color: C.onAccent,
    },
});
