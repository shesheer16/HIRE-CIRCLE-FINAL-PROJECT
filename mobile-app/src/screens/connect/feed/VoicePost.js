import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RADIUS } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

function VoicePostComponent({ duration }) {
    return (
        <View style={styles.container}>
            <View style={styles.playButton}>
                <Text style={styles.playText}>▶</Text>
            </View>
            <View style={styles.progressTrack}>
                <View style={styles.progressFill} />
            </View>
            <Text style={styles.durationText}>{duration || '0:15'}</Text>
        </View>
    );
}

export default memo(VoicePostComponent);

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: connectPalette.accentSoft,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: connectPalette.accentSoftAlt,
        padding: 12,
        marginBottom: 16,
    },
    playButton: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.accent,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: connectPalette.accentDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.16,
        shadowRadius: 6,
    },
    playText: {
        color: connectPalette.surface,
        fontSize: 14,
        marginLeft: 2,
    },
    progressTrack: {
        flex: 1,
        height: 6,
        borderRadius: RADIUS.full,
        backgroundColor: '#dfccff',
        marginHorizontal: 12,
        overflow: 'hidden',
    },
    progressFill: {
        width: '35%',
        height: '100%',
        backgroundColor: connectPalette.accent,
    },
    durationText: {
        color: connectPalette.accentDark,
        fontSize: 11,
        fontWeight: '900',
    },
});
