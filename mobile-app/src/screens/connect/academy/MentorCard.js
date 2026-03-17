import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { RADIUS } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

function MentorCardComponent({ mentor, isConnected, onConnect }) {
    const safeMentor = (mentor && typeof mentor === 'object') ? mentor : {};
    const mentorId = String(safeMentor.id || '').trim();
    const mentorName = String(safeMentor.name || 'Mentor').trim() || 'Mentor';
    const mentorExp = String(safeMentor.exp || '0y').trim() || '0y';
    const mentorSkill = String(safeMentor.skill || 'General').trim() || 'General';
    const mentorRating = String(safeMentor.rating || '-').trim() || '-';
    const mentorSessions = String(safeMentor.sessions || '0').trim() || '0';
    const mentorReason = String(safeMentor.reason || '').trim();
    const mentorAvatar = String(safeMentor.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(mentorName)}&background=8b3dff&color=fff&rounded=true`);

    const handleConnect = useCallback(() => {
        if (mentorId) {
            onConnect(mentorId);
        }
    }, [onConnect, mentorId]);

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
            <Image source={{ uri: mentorAvatar }} style={styles.avatar} />
            <View style={styles.main}>
                <Text style={styles.skillLabel}>{mentorSkill.toUpperCase()}</Text>
                <Text style={styles.nameText}>{mentorName} ({mentorExp} Exp)</Text>
                <Text style={styles.metaText}>⭐ {mentorRating} · {mentorSessions} sessions</Text>
                {mentorReason ? <Text style={styles.reasonText}>{mentorReason}</Text> : null}
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
        gap: 14,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#efe9f8',
        borderRadius: 20,
        padding: 14,
        marginBottom: 12,
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    avatar: {
        width: 44,
        height: 44,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#e6def8',
        backgroundColor: '#f3eef8',
    },
    main: {
        flex: 1,
    },
    skillLabel: {
        alignSelf: 'flex-start',
        fontSize: 9.5,
        fontWeight: '800',
        color: '#6a41d8',
        backgroundColor: '#f8f4ff',
        borderWidth: 1,
        borderColor: '#eadcfb',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 999,
        marginBottom: 6,
    },
    nameText: {
        fontSize: 14,
        fontWeight: '800',
        color: connectPalette.text,
    },
    metaText: {
        fontSize: 10,
        color: '#7c8398',
        marginTop: 2,
    },
    reasonText: {
        marginTop: 6,
        fontSize: 10,
        color: '#8a91a3',
        lineHeight: 15,
    },
    connectButton: {
        backgroundColor: '#6f4cf6',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
    },
    connectButtonDone: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    connectButtonText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: connectPalette.surface,
    },
    connectButtonTextDone: {
        color: '#6a41d8',
    },
});
