import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { IconBell } from '../../components/Icons';
import { RADIUS, SHADOWS, SPACING } from '../../theme/theme';
import { connectPalette } from './connectPalette';

function ConnectHeaderComponent({ avatar, onNotificationsPress, onProfilePress }) {
    return (
        <View style={styles.header}>
            <View style={styles.headerLeft}>
                <View style={styles.logoBox}><Text style={styles.logoH}>H</Text></View>
                <Text style={styles.logoTitle}>HIRE<Text style={styles.logoCircle}>CIRCLE</Text></Text>
            </View>
            <View style={styles.headerRight}>
                <TouchableOpacity style={styles.bellButton} onPress={onNotificationsPress}>
                    <IconBell size={20} color={connectPalette.muted} />
                    <View style={styles.bellDot} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.avatarButton} onPress={onProfilePress} activeOpacity={0.85}>
                    <Image source={{ uri: avatar }} style={styles.avatarImage} />
                </TouchableOpacity>
            </View>
        </View>
    );
}

export default memo(ConnectHeaderComponent);

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: SPACING.md + 2,
        paddingVertical: SPACING.sm + 2,
        backgroundColor: connectPalette.surface,
        borderBottomWidth: 1,
        borderBottomColor: connectPalette.line,
        ...SHADOWS.sm,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logoBox: {
        width: 34,
        height: 34,
        borderRadius: RADIUS.sm,
        backgroundColor: connectPalette.accent,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    logoH: {
        color: connectPalette.surface,
        fontSize: 15,
        fontWeight: '900',
        fontStyle: 'italic',
    },
    logoTitle: {
        fontSize: 37 / 2,
        fontWeight: '800',
        color: connectPalette.text,
        letterSpacing: -0.3,
    },
    logoCircle: {
        color: connectPalette.accent,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    bellButton: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bellDot: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 7,
        height: 7,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.danger,
        borderWidth: 2,
        borderColor: connectPalette.surface,
    },
    avatarButton: {
        marginLeft: 10,
        borderRadius: RADIUS.full,
        borderWidth: 2,
        borderColor: connectPalette.accent,
        width: 38,
        height: 38,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: connectPalette.surface,
    },
    avatarImage: {
        width: 33,
        height: 33,
        borderRadius: RADIUS.full,
    },
});
