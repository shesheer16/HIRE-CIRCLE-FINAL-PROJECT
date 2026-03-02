import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

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
                <TouchableOpacity style={styles.button} onPress={resolvedAction}>
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
        paddingHorizontal: 32,
        paddingVertical: 40,
        minHeight: 300,
    },
    iconContainer: {
        marginBottom: 16,
        opacity: 0.72,
    },
    iconEmoji: {
        fontSize: 36,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 8,
        textAlign: 'center',
    },
    message: {
        fontSize: 14,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 24,
    },
    button: {
        backgroundColor: '#7c3aed',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 12,
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.18,
        shadowRadius: 8,
        elevation: 3,
    },
    buttonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    }
});

export default EmptyState;
