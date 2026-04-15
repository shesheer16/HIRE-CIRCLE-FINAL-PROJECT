import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { C } from '../theme/colors';
import PressableScale from './PressableScale';

export default function Chip({ label, selected, onPress }) {
    return (
        <PressableScale
            onPress={onPress}
            pressInScale={0.96}
            durationIn={80}
            durationOut={80}
            style={[styles.base, selected ? styles.selected : styles.unselected]}
        >
            <Text style={selected ? styles.selectedText : styles.unselectedText}>{label}</Text>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    base: {
        minWidth: 44,
        minHeight: 44,
        borderRadius: 100,
        paddingVertical: 7,
        paddingHorizontal: 14,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selected: {
        backgroundColor: C.accent,
        borderColor: C.accent,
    },
    unselected: {
        backgroundColor: 'transparent',
        borderColor: C.borderMid,
    },
    selectedText: {
        fontSize: 13,
        fontWeight: '500',
        color: C.onAccent,
    },
    unselectedText: {
        fontSize: 13,
        fontWeight: '400',
        color: C.textMute,
    },
});
