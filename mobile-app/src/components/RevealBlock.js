import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

export default function RevealBlock({ children, visible }) {
    const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

    useEffect(() => {
        if (!visible) return;
        anim.setValue(0);
        Animated.parallel([
            Animated.timing(anim, {
                toValue: 1,
                duration: 220,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }),
        ]).start();
    }, [anim, visible]);

    if (!visible) return null;

    return (
        <Animated.View
            style={{
                opacity: anim,
                transform: [{
                    translateY: anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, 0],
                    }),
                }],
            }}
        >
            {children}
        </Animated.View>
    );
}
