import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C } from '../theme/colors';
import PressableScale from './PressableScale';

export default function FieldRow({
    label,
    value,
    placeholder,
    onPress,
    last = false,
    disabled = false,
}) {
    const displayValue = String(value || '').trim();

    return (
        <PressableScale
            disabled={disabled}
            onPress={onPress}
            pressInScale={0.98}
            style={[styles.row, last ? styles.rowLast : null, disabled ? styles.rowDisabled : null]}
        >
            <View style={styles.copy}>
                <Text style={styles.label}>{label}</Text>
                <Text style={displayValue ? styles.value : styles.placeholder} numberOfLines={1}>
                    {displayValue || placeholder}
                </Text>
            </View>
            <Text style={styles.chevron}>{'›'}</Text>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 13,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: C.border,
    },
    rowLast: {
        borderBottomWidth: 0,
    },
    rowDisabled: {
        opacity: 0.45,
    },
    copy: {
        flex: 1,
        paddingRight: 12,
    },
    label: {
        fontSize: 12,
        color: C.textSoft,
        fontWeight: '500',
        marginBottom: 2,
    },
    value: {
        fontSize: 15,
        color: C.text,
        fontWeight: '500',
    },
    placeholder: {
        fontSize: 15,
        color: C.textMute,
        fontWeight: '400',
    },
    chevron: {
        fontSize: 17,
        color: C.accent,
        fontWeight: '700',
        minWidth: 18,
        textAlign: 'right',
    },
});
