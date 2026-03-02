import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

function MentorCardComponent({ mentor, isConnected, onConnect }) {
    const handleConnect = useCallback(() => {
        onConnect(mentor.id);
    }, [onConnect, mentor.id]);

    const buttonStyle = useMemo(() => [
        styles.connectButton,
        isConnected && styles.connectButtonDone,
    ], [isConnected]);

    const buttonTextStyle = useMemo(() => [
        styles.connectButtonText,
        isConnected && styles.connectButtonTextDone,
    ], [isConnected]);

    return (
        <View style={styles.card}>
            <Image source={{ uri: mentor.avatar }} style={styles.avatar} />
            <View style={styles.main}>
                <Text style={styles.skillLabel}>{mentor.skill.toUpperCase()}</Text>
                <Text style={styles.nameText}>{mentor.name} ({mentor.exp} Exp)</Text>
                <Text style={styles.metaText}>⭐ {mentor.rating} · {mentor.sessions} sessions</Text>
            </View>
            <TouchableOpacity style={buttonStyle} onPress={handleConnect}>
                <Text style={buttonTextStyle}>{isConnected ? 'REQUESTED ✓' : 'CONNECT'}</Text>
            </TouchableOpacity>
        </View>
    );
}

export default memo(MentorCardComponent);

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        backgroundColor: '#f6f2ff',
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: RADIUS.xl,
        padding: 16,
        marginBottom: 12,
        ...connectShadow,
    },
    avatar: {
        width: 48,
        height: 48,
        borderRadius: RADIUS.md,
    },
    main: {
        flex: 1,
    },
    skillLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.accentDark,
        marginBottom: 4,
    },
    nameText: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
    },
    metaText: {
        fontSize: 9,
        color: connectPalette.subtle,
        marginTop: 2,
    },
    connectButton: {
        backgroundColor: connectPalette.accent,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: RADIUS.md,
    },
    connectButtonDone: {
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.accentSoftAlt,
    },
    connectButtonText: {
        fontSize: 10,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    connectButtonTextDone: {
        color: connectPalette.accentDark,
    },
});
