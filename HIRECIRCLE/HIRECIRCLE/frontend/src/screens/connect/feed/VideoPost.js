import React, { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { ResizeMode, Video } from 'expo-av';
import { RADIUS } from '../../../theme/theme';

const VIDEO_HEIGHT = 390;

function VideoPostComponent({ mediaUrl }) {
    const sourceUri = String(mediaUrl || '').trim();
    if (!sourceUri) return null;

    return (
        <View style={styles.container}>
            <Video
                source={{ uri: sourceUri }}
                style={styles.video}
                useNativeControls
                resizeMode={ResizeMode.COVER}
                isLooping={false}
                shouldPlay={false}
            />
        </View>
    );
}

export default memo(VideoPostComponent);

const styles = StyleSheet.create({
    container: {
        marginTop: 0,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: '#0f0b1f',
        borderWidth: 1,
        borderColor: '#e5dcff',
        shadowColor: '#2a1858',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
        elevation: 2,
        marginBottom: 0,
    },
    video: {
        width: '100%',
        height: VIDEO_HEIGHT,
        backgroundColor: '#000000',
    },
});
