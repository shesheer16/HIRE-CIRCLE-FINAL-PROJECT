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

import { PALETTE, RADIUS, SHADOWS } from '../../theme/theme';
import { getAuthAccountLabel, isEmployerFacingSelectedRole } from '../../utils/authRoleSelection';

const ROLE_CHROME = {
    worker: {
        icon: 'person-outline',
        tint: PALETTE.accentSoft,
        tintBorder: PALETTE.accentBorder,
    },
    employer: {
        icon: 'briefcase-outline',
        tint: PALETTE.accentSoft,
        tintBorder: PALETTE.accentBorder,
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
            <View pointerEvents="none" style={styles.topTint} />
            <View pointerEvents="none" style={styles.bottomTint} />

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 30 },
                    ]}
                >
                    <View style={styles.topRow}>
                        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.78}>
                            <Ionicons name="chevron-back" size={20} color={PALETTE.textPrimary} />
                        </TouchableOpacity>

                        <View style={[styles.rolePill, { backgroundColor: chrome.tint, borderColor: chrome.tintBorder }]}>
                            <Ionicons name={chrome.icon} size={13} color={PALETTE.accentDeep} />
                            <Text style={styles.rolePillText}>{accountLabel}</Text>
                        </View>
                    </View>

                    <View style={styles.headerBlock}>
                        <View style={styles.logoRow}>
                            <View style={styles.logoMark}>
                                <View style={styles.logoOuter} />
                                <View style={styles.logoInner} />
                                <View style={styles.logoDot} />
                            </View>
                            <Text style={styles.brandWordmark}>
                                Hire<Text style={styles.brandWordmarkAccent}>Circle</Text>
                            </Text>
                        </View>
                        <Text style={styles.heroTitle}>{title}</Text>
                        {subtitle ? <Text style={styles.heroSubtitle}>{subtitle}</Text> : null}
                    </View>

                    <View style={styles.formShell}>
                        <View style={styles.formAccent} />
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
        paddingHorizontal: 24,
    },
    topTint: {
        position: 'absolute',
        top: -30,
        left: -40,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: PALETTE.accentTint,
    },
    bottomTint: {
        position: 'absolute',
        right: -50,
        bottom: -40,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: PALETTE.accentTint,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 28,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: PALETTE.surface,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.sm,
    },
    rolePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    rolePillText: {
        fontSize: 12,
        fontWeight: '800',
        color: PALETTE.accentDeep,
    },
    headerBlock: {
        alignItems: 'center',
        marginBottom: 28,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 14,
    },
    logoMark: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoOuter: {
        position: 'absolute',
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: PALETTE.accent,
    },
    logoInner: {
        position: 'absolute',
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: PALETTE.accentDeep,
    },
    logoDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: PALETTE.accent,
    },
    brandWordmark: {
        fontSize: 20,
        fontWeight: '700',
        color: PALETTE.textPrimary,
        letterSpacing: -0.5,
    },
    brandWordmarkAccent: {
        color: PALETTE.accent,
    },
    heroTitle: {
        fontSize: 32,
        lineHeight: 36,
        fontWeight: '900',
        color: PALETTE.textPrimary,
        letterSpacing: -0.8,
        textAlign: 'center',
    },
    heroSubtitle: {
        marginTop: 10,
        fontSize: 15,
        lineHeight: 21,
        color: PALETTE.textSecondary,
        textAlign: 'center',
        maxWidth: 260,
    },
    formShell: {
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 26,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        backgroundColor: PALETTE.surface,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 18,
        ...SHADOWS.md,
    },
    formAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        backgroundColor: PALETTE.accent,
    },
});
