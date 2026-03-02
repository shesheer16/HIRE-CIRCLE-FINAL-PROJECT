import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet } from 'react-native';
import { IconMic, IconImage, IconVideo } from '../../../components/Icons';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

function FeedComposerComponent({
    composerOpen,
    composerMediaType,
    composerText,
    currentUserAvatar,
    onInputAreaClick,
    onMediaButtonClick,
    onCancelComposer,
    onPost,
    onComposerTextChange,
}) {
    const onVoicePress = useCallback(() => onMediaButtonClick('VOICE'), [onMediaButtonClick]);
    const onPhotosPress = useCallback(() => onMediaButtonClick('PHOTOS'), [onMediaButtonClick]);
    const onVideoPress = useCallback(() => onMediaButtonClick('VIDEO'), [onMediaButtonClick]);

    const placeholder = useMemo(() => {
        if (composerMediaType === 'VOICE') return 'Describe your voice note...';
        if (composerMediaType === 'PHOTOS') return 'Caption your photos...';
        if (composerMediaType === 'VIDEO') return 'Caption your video...';
        return 'What do you want to share?';
    }, [composerMediaType]);

    const isPostDisabled = !composerText.trim();

    return (
        <View style={styles.container}>
            <View style={styles.topRow}>
                <Image source={{ uri: currentUserAvatar }} style={styles.avatar} />
                <TouchableOpacity style={styles.inputTrigger} onPress={onInputAreaClick} activeOpacity={0.8}>
                    <Text style={styles.inputTriggerText}>Share your work today...</Text>
                </TouchableOpacity>
            </View>

            {composerOpen ? (
                <TextInput
                    style={styles.textArea}
                    value={composerText}
                    onChangeText={onComposerTextChange}
                    placeholder={placeholder}
                    placeholderTextColor={connectPalette.subtle}
                    multiline
                    numberOfLines={3}
                    autoFocus
                />
            ) : null}

            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.toolButton} onPress={onVoicePress} activeOpacity={0.8}>
                    <IconMic size={14} color={composerMediaType === 'VOICE' ? connectPalette.accent : connectPalette.muted} />
                    <Text style={[styles.toolText, composerMediaType === 'VOICE' && styles.toolTextActive]}>VOICE</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.toolButton} onPress={onPhotosPress} activeOpacity={0.8}>
                    <IconImage size={14} color={composerMediaType === 'PHOTOS' ? connectPalette.accent : connectPalette.muted} />
                    <Text style={[styles.toolText, composerMediaType === 'PHOTOS' && styles.toolTextIndigo]}>PHOTOS</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.toolButton} onPress={onVideoPress} activeOpacity={0.8}>
                    <IconVideo size={14} color={composerMediaType === 'VIDEO' ? connectPalette.accent : connectPalette.muted} />
                    <Text style={[styles.toolText, composerMediaType === 'VIDEO' && styles.toolTextWarning]}>VIDEO</Text>
                </TouchableOpacity>

                <View style={styles.divider} />

                {composerOpen ? (
                    <View style={styles.actionsRow}>
                        <TouchableOpacity style={styles.cancelButton} onPress={onCancelComposer} activeOpacity={0.85}>
                            <Text style={styles.cancelText}>CANCEL</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.postButton, isPostDisabled && styles.postButtonDisabled]}
                            onPress={onPost}
                            disabled={isPostDisabled}
                            activeOpacity={0.85}
                        >
                            <Text style={styles.postText}>POST</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <TouchableOpacity style={styles.postButton} onPress={onInputAreaClick} activeOpacity={0.85}>
                        <Text style={styles.postText}>POST</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

export default memo(FeedComposerComponent);

const styles = StyleSheet.create({
    container: {
        backgroundColor: connectPalette.surface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: connectPalette.line,
        ...connectShadow,
        padding: 16,
        marginBottom: 16,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    avatar: {
        width: 42,
        height: 42,
        borderRadius: RADIUS.lg,
        marginRight: 12,
    },
    inputTrigger: {
        flex: 1,
        borderRadius: RADIUS.lg,
        backgroundColor: '#f8f9fc',
        borderWidth: 1,
        borderColor: connectPalette.line,
        paddingHorizontal: 16,
        paddingVertical: 11,
    },
    inputTriggerText: {
        color: connectPalette.subtle,
        fontSize: 14,
        fontWeight: '500',
    },
    textArea: {
        marginBottom: 12,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        backgroundColor: '#f8f9fc',
        color: connectPalette.text,
        minHeight: 80,
        fontSize: 14,
        lineHeight: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
        textAlignVertical: 'top',
    },
    toolbar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    toolButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    toolText: {
        color: connectPalette.muted,
        fontSize: 11,
        fontWeight: '700',
    },
    toolTextActive: {
        color: connectPalette.accent,
    },
    toolTextIndigo: {
        color: connectPalette.accent,
    },
    toolTextWarning: {
        color: connectPalette.accent,
    },
    divider: {
        width: 1,
        height: 16,
        backgroundColor: connectPalette.lineStrong,
        marginLeft: 8,
        marginRight: 8,
    },
    actionsRow: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cancelButton: {
        borderRadius: RADIUS.sm,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: '#eff2f8',
    },
    cancelText: {
        color: connectPalette.muted,
        fontSize: 10,
        fontWeight: '900',
    },
    postButton: {
        marginLeft: 'auto',
        borderRadius: RADIUS.sm,
        backgroundColor: connectPalette.accentSoft,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    postButtonDisabled: {
        opacity: 0.45,
    },
    postText: {
        color: connectPalette.accentDark,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.3,
    },
});
