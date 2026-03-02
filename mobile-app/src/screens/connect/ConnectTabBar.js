import React, { memo, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { RADIUS } from '../../theme/theme';
import { connectPalette } from './connectPalette';
import { MOTION } from '../../theme/motion';

function AnimatedTabLabel({ tab, active, onPress }) {
    const scale = useRef(new Animated.Value(active ? 1 : 0.96)).current;
    const opacity = useRef(new Animated.Value(active ? 1 : 0.75)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(scale, {
                toValue: active ? 1 : 0.96,
                stiffness: 220,
                damping: 16,
                mass: 0.8,
                useNativeDriver: true,
            }),
            Animated.timing(opacity, {
                toValue: active ? 1 : 0.75,
                duration: MOTION.tabTransitionMs,
                useNativeDriver: true,
            }),
        ]).start();
    }, [active, opacity, scale]);

    return (
        <TouchableOpacity style={styles.tabButton} onPress={onPress} activeOpacity={0.75}>
            <Animated.View style={{ transform: [{ scale }], opacity }}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab}</Text>
            </Animated.View>
            {active ? <View style={styles.tabIndicator} /> : null}
        </TouchableOpacity>
    );
}

function ConnectTabBarComponent({ tabs, activeTab, onTabPress }) {
    const handleTabPress = useCallback((tab) => {
        onTabPress(tab);
    }, [onTabPress]);

    return (
        <View style={styles.container}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content}>
                {tabs.map((tab) => {
                    const isActive = activeTab === tab;
                    return (
                        <AnimatedTabLabel
                            key={tab}
                            tab={tab}
                            active={isActive}
                            onPress={() => handleTabPress(tab)}
                        />
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default memo(ConnectTabBarComponent);

const styles = StyleSheet.create({
    container: {
        backgroundColor: connectPalette.surface,
        borderBottomWidth: 1,
        borderBottomColor: connectPalette.line,
    },
    content: {
        paddingHorizontal: 10,
    },
    tabButton: {
        paddingHorizontal: 14,
        paddingVertical: 13,
        alignItems: 'center',
    },
    tabText: {
        fontSize: 28 / 2,
        fontWeight: '700',
        color: connectPalette.subtle,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
    },
    tabTextActive: {
        color: connectPalette.accent,
    },
    tabIndicator: {
        position: 'absolute',
        bottom: 0,
        left: 12,
        right: 12,
        height: 2.5,
        backgroundColor: connectPalette.accent,
        borderRadius: RADIUS.sm,
    },
});
