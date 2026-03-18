import React, { useMemo } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { PALETTE, RADIUS, SHADOWS } from '../../theme/theme';
import { getAuthAccountLabel, isEmployerFacingSelectedRole } from '../../utils/authRoleSelection';

const ROLE_CHROME = {
    worker: {
        pillIcon: 'compass-outline',
        pillBg: '#f3e8ff',
        pillBorder: '#d8b4fe',
        pillText: '#7c3aed',
        glowTop: 'rgba(168,85,247,0.10)',
        glowBottom: 'rgba(216,180,254,0.18)',
        signalBg: '#faf5ff',
        signalBorder: '#e9d5ff',
        signalText: '#7c3aed',
        signals: [
            { icon: 'flash-outline', label: 'Live matches' },
            { icon: 'receipt-outline', label: 'Track applications' },
        ],
    },
    employer: {
        pillIcon: 'briefcase-outline',
        pillBg: '#ede9fe',
        pillBorder: '#c4b5fd',
        pillText: '#6d28d9',
        glowTop: 'rgba(124,58,237,0.14)',
        glowBottom: 'rgba(196,181,253,0.22)',
        signalBg: '#f5f3ff',
        signalBorder: '#ddd6fe',
        signalText: '#6d28d9',
        signals: [
            { icon: 'layers-outline', label: 'Talent pipeline' },
            { icon: 'chatbubble-ellipses-outline', label: 'Chat-ready reviews' },
        ],
    },
};

export default function AuthScreenShell({
    selectedRole = 'worker',
    modeLabel = 'Access',
    title = '',
    subtitle = '',
    onBack,
    footer = null,
    children,
}) {
    const insets = useSafeAreaInsets();
    const isEmployer = isEmployerFacingSelectedRole(selectedRole);
    const chrome = useMemo(
        () => (isEmployer ? ROLE_CHROME.employer : ROLE_CHROME.worker),
        [isEmployer]
    );
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#ffffff', '#fcfbff', '#ffffff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
            />
            <View pointerEvents="none" style={[styles.glowOrbTop, { backgroundColor: chrome.glowTop }]} />
            <View pointerEvents="none" style={[styles.glowOrbBottom, { backgroundColor: chrome.glowBottom }]} />

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 },
                    ]}
                >
                    <View style={styles.topRow}>
                        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.76}>
                            <Ionicons name="chevron-back" size={21} color={PALETTE.textPrimary} />
                        </TouchableOpacity>

                        <View style={[
                            styles.rolePill,
                            {
                                backgroundColor: chrome.pillBg,
                                borderColor: chrome.pillBorder,
                            },
                        ]}>
                            <Ionicons name={chrome.pillIcon} size={14} color={chrome.pillText} />
                            <Text style={[styles.rolePillText, { color: chrome.pillText }]}>
                                {accountLabel} {modeLabel}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.heroBlock}>
                        <Text style={styles.brandWordmark}>HIRECIRCLE</Text>
                        <Text style={styles.heroTitle}>{title}</Text>
                        <Text style={styles.heroSubtitle}>{subtitle}</Text>
                    </View>

                    <View style={styles.signalRow}>
                        {chrome.signals.map((signal) => (
                            <View
                                key={signal.label}
                                style={[
                                    styles.signalChip,
                                    {
                                        backgroundColor: chrome.signalBg,
                                        borderColor: chrome.signalBorder,
                                    },
                                ]}
                            >
                                <Ionicons name={signal.icon} size={13} color={chrome.signalText} />
                                <Text style={[styles.signalChipText, { color: chrome.signalText }]}>
                                    {signal.label}
                                </Text>
                            </View>
                        ))}
                    </View>

                    <View style={styles.formShell}>
                        <LinearGradient
                            colors={['#c084fc', PALETTE.accent, PALETTE.accentDeep]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.formAccent}
                        />
                        {children}
                    </View>

                    {footer}
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: PALETTE.background,
    },
    flex: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 22,
    },
    glowOrbTop: {
        position: 'absolute',
        top: -90,
        right: -70,
        width: 220,
        height: 220,
        borderRadius: 110,
    },
    glowOrbBottom: {
        position: 'absolute',
        left: -80,
        bottom: -120,
        width: 260,
        height: 260,
        borderRadius: 130,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 26,
    },
    backBtn: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rolePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderWidth: 1,
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    rolePillText: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    heroBlock: {
        marginBottom: 18,
    },
    brandWordmark: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 1.6,
        color: PALETTE.textSecondary,
        marginBottom: 10,
    },
    heroTitle: {
        fontSize: 32,
        lineHeight: 38,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        letterSpacing: -0.9,
    },
    heroSubtitle: {
        marginTop: 10,
        fontSize: 15,
        lineHeight: 22,
        color: '#475569',
        maxWidth: '92%',
    },
    signalRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 20,
    },
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderWidth: 1,
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    signalChipText: {
        fontSize: 12,
        fontWeight: '700',
    },
    formShell: {
        backgroundColor: '#ffffff',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#ede9f3',
        paddingHorizontal: 18,
        paddingTop: 20,
        paddingBottom: 18,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    formAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
    },
});
