import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppStore } from '../store/AppStore';

export default function OfflineBanner() {
    const isOnline = useAppStore(state => state.isOnline);
    // Position it out of frame by default
    const [translateY] = useState(new Animated.Value(-150));
    const insets = useSafeAreaInsets();

    useEffect(() => {
        if (!isOnline) {
            Animated.spring(translateY, {
                toValue: 0,
                useNativeDriver: true,
                speed: 12,
            }).start();
        } else {
            Animated.timing(translateY, {
                toValue: -150,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    }, [isOnline, translateY]);

    return (
        <Animated.View style={[styles.container, { transform: [{ translateY }], paddingTop: insets.top || 40 }]}>
            <View style={styles.innerBox}>
                <Text style={styles.icon}>⚠️</Text>
                <Text style={styles.text}>No Internet Connection. Operating in offline mode.</Text>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: '#ef4444',
        paddingBottom: 12,
        paddingHorizontal: 16,
        zIndex: 9999,
        elevation: 10,
        shadowColor: '#ef4444',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
    },
    innerBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 8,
    },
    icon: {
        fontSize: 16,
        marginRight: 8,
    },
    text: {
        color: '#fff',
        fontSize: 13,
        fontWeight: 'bold',
        letterSpacing: 0.5,
    }
});
