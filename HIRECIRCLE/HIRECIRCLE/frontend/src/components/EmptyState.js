import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { PALETTE, RADIUS, SPACING } from '../theme/theme';

const EmptyState = ({ title, message, subtitle, icon = '📭', actionLabel, action, onAction }) => {
    const resolvedMessage = subtitle || message;
    const resolvedActionLabel = action?.label || actionLabel;
    const resolvedAction = action?.onPress || onAction;

    return (
        <View style={styles.container}>
            {icon ? (
                <View style={styles.iconContainer}>
                    {typeof icon === 'string'
                        ? <Text style={styles.iconEmoji}>{icon}</Text>
                        : icon}
                </View>
            ) : null}

            <Text style={styles.title}>{title}</Text>

            {resolvedMessage ? <Text style={styles.message}>{resolvedMessage}</Text> : null}

            {resolvedActionLabel && resolvedAction && (
                <TouchableOpacity style={styles.button} onPress={resolvedAction} activeOpacity={0.85}>
                    <Text style={styles.buttonText}>{resolvedActionLabel}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.xxl,
        minHeight: 300,
        backgroundColor: PALETTE.background,
    },
    iconContainer: {
        marginBottom: SPACING.md,
    },
    iconEmoji: {
        fontSize: 44,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: PALETTE.textPrimary,
        marginBottom: SPACING.sm,
        textAlign: 'center',
        letterSpacing: -0.3,
    },
    message: {
        fontSize: 14,
        color: PALETTE.textSecondary,
        textAlign: 'center',
        lineHeight: 21,
        marginBottom: SPACING.lg,
    },
    button: {
        backgroundColor: PALETTE.accent,
        paddingHorizontal: SPACING.xl,
        paddingVertical: 14,
        borderRadius: RADIUS.full,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: PALETTE.accent,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 4,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 0.1,
    },
});

export default EmptyState;
