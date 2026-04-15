import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { C } from '../theme/colors';

export default function CharmTitle({
    text = '',
    color = C.accent,
    accentDeep = C.accentDeep,
    fontSize = 22,
    fontWeight = '800',
    letterSpacing = -0.3,
    delay = 0,
}) {
    const letters = useMemo(() => Array.from(String(text || '')), [text]);
    const animsRef = useRef(letters.map(() => new Animated.Value(0)));

    useEffect(() => {
        const anims = animsRef.current;
        const rise = Animated.stagger(50, anims.map((val) => Animated.timing(val, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        })));
        const fall = Animated.stagger(50, anims.map((val) => Animated.timing(val, {
            toValue: 0,
            duration: 380,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
        })));
        const loop = Animated.loop(
            Animated.sequence([
                Animated.delay(delay),
                rise,
                Animated.delay(520),
                fall,
                Animated.delay(540),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [delay, letters]);

    return (
        <View style={styles.row} pointerEvents="none">
            {letters.map((char, index) => {
                const val = animsRef.current[index];
                const translateY = val.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -1.5],
                });
                const scale = val.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.02],
                });
                const tint = val.interpolate({
                    inputRange: [0, 1],
                    outputRange: [color, accentDeep],
                });
                return (
                    <Animated.Text
                        key={`${char}-${index}`}
                        style={[
                            styles.char,
                            {
                                color: tint,
                                fontSize,
                                fontWeight,
                                letterSpacing,
                                transform: [{ translateY }, { scale }],
                                opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
                            },
                        ]}
                    >
                        {char}
                    </Animated.Text>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    char: {
        includeFontPadding: false,
    },
});
