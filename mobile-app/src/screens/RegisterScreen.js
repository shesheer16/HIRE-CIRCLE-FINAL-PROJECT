import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
    ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import { getAuthAccountLabel, normalizeSelectedRole } from '../utils/authRoleSelection';
import { PALETTE, RADIUS, SPACING, SHADOWS } from '../theme/theme';

export default function RegisterScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const selectedRole = normalizeSelectedRole(route?.params?.selectedRole || 'worker');
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const subtitleText = useMemo(
        () => `Create your ${accountLabel} account`,
        [accountLabel]
    );

    const canSubmit = useMemo(() => {
        if (!String(password || '').trim()) return false;
        if (!String(confirmPassword || '').trim()) return false;
        if (authMode === 'phone' && !String(phoneNumber || '').trim()) return false;
        if (authMode === 'email' && !String(email || '').trim()) return false;
        return true;
    }, [authMode, confirmPassword, email, password, phoneNumber]);

    const handleBack = useCallback(() => {
        handleAuthBackNavigation(navigation, {
            selectedRole,
            target: 'Login',
        });
    }, [navigation, selectedRole]);

    const openSignIn = useCallback(() => {
        navigation.navigate('Login', { selectedRole });
    }, [navigation, selectedRole]);

    const handleCreateAccount = useCallback(async () => {
        if (loading || !canSubmit) return;

        const safePassword = String(password || '').trim();
        const safeConfirmPassword = String(confirmPassword || '').trim();
        if (safePassword.length < 6) {
            Alert.alert('Invalid password', 'Password should be at least 6 characters.');
            return;
        }
        if (safePassword !== safeConfirmPassword) {
            Alert.alert('Password mismatch', 'Password and confirm password should match.');
            return;
        }

        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 450));
            navigation.navigate('BasicProfileSetup', {
                selectedRole,
                authMode,
                email: authMode === 'email' ? String(email || '').trim() : '',
                phoneNumber: authMode === 'phone' ? String(phoneNumber || '').trim() : '',
                password: safePassword,
            });
        } catch (_error) {
            Alert.alert('Sign up unavailable', 'Unable to continue right now. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [
        authMode, canSubmit, confirmPassword, email, loading,
        password, phoneNumber, navigation, selectedRole,
    ]);

    return (
        <View style={styles.container}>
            <View pointerEvents="none" style={styles.bgOrbTop} />
            <View pointerEvents="none" style={styles.bgOrbBottom} />
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="always"
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
                    ]}
                >
                    {/* Back */}
                    <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.7}>
                        <Ionicons name="chevron-back" size={22} color={PALETTE.textPrimary} />
                    </TouchableOpacity>

                    <View style={styles.heroCard}>
                        <LinearGradient
                            colors={[PALETTE.accent, PALETTE.accentDeep]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={styles.heroAccent}
                        />
                        <View style={styles.logoSection}>
                            <View style={styles.logoMark}>
                                <View style={styles.logoRingOuter} />
                                <View style={styles.logoRingMid} />
                                <View style={styles.logoRingInner} />
                                <View style={styles.logoDot} />
                            </View>
                        </View>
                        <View style={styles.roleBadge}>
                            <Ionicons name="sparkles-outline" size={14} color={PALETTE.accentDeep} />
                            <Text style={styles.roleBadgeText}>{accountLabel} setup</Text>
                        </View>
                        <Text style={styles.title}>Create Account</Text>
                        <Text style={styles.subtitle}>{subtitleText}</Text>
                    </View>

                    <View style={styles.formCard}>
                        {/* Segment */}
                        <View style={styles.segmentWrap}>
                            <TouchableOpacity
                                style={[styles.segmentBtn, authMode === 'phone' && styles.segmentBtnActive]}
                                activeOpacity={0.85}
                                onPress={() => setAuthMode('phone')}
                            >
                                <Text style={[styles.segmentText, authMode === 'phone' && styles.segmentTextActive]}>Phone</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.segmentBtn, authMode === 'email' && styles.segmentBtnActive]}
                                activeOpacity={0.85}
                                onPress={() => setAuthMode('email')}
                            >
                                <Text style={[styles.segmentText, authMode === 'email' && styles.segmentTextActive]}>Email</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Form */}
                        <View style={styles.formBlock}>
                        {authMode === 'phone' ? (
                            <View>
                                <Text style={styles.fieldLabel}>Phone number</Text>
                                <View style={styles.phoneRow}>
                                    <View style={styles.countryCode}>
                                        <Text style={styles.countryCodeText}>+91</Text>
                                    </View>
                                    <TextInput
                                        style={styles.phoneInput}
                                        value={phoneNumber}
                                        onChangeText={setPhoneNumber}
                                        keyboardType="phone-pad"
                                        placeholder="98765 43210"
                                        placeholderTextColor={PALETTE.textTertiary}
                                        maxLength={15}
                                    />
                                </View>
                            </View>
                        ) : (
                            <View>
                                <Text style={styles.fieldLabel}>Email address</Text>
                                <TextInput
                                    style={styles.input}
                                    value={email}
                                    onChangeText={setEmail}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                    placeholder="you@example.com"
                                    placeholderTextColor={PALETTE.textTertiary}
                                />
                            </View>
                        )}

                        <View>
                            <Text style={styles.fieldLabel}>Password</Text>
                            <TextInput
                                style={styles.input}
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                placeholder="At least 6 characters"
                                placeholderTextColor={PALETTE.textTertiary}
                            />
                        </View>

                        <View>
                            <Text style={styles.fieldLabel}>Confirm password</Text>
                            <TextInput
                                style={styles.input}
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                secureTextEntry
                                placeholder="Re-enter password"
                                placeholderTextColor={PALETTE.textTertiary}
                            />
                        </View>

                        {/* Submit */}
                        <TouchableOpacity
                            style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
                            activeOpacity={0.88}
                            onPress={handleCreateAccount}
                            disabled={!canSubmit || loading}
                        >
                            <LinearGradient
                                colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.submitGradient}
                            >
                                {loading ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Text style={styles.submitText}>Create Account</Text>
                                )}
                            </LinearGradient>
                        </TouchableOpacity>
                        </View>
                    </View>

                    {/* Divider */}
                    <View style={styles.dividerRow}>
                        <View style={styles.dividerLine} />
                        <Text style={styles.dividerText}>or</Text>
                        <View style={styles.dividerLine} />
                    </View>

                    {/* Footer */}
                    <View style={styles.footerRow}>
                        <Text style={styles.footerText}>Already have an account?{' '}</Text>
                        <TouchableOpacity activeOpacity={0.7} onPress={openSignIn}>
                            <Text style={styles.footerLink}>Sign In</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: PALETTE.background },
    bgOrbTop: {
        position: 'absolute',
        top: -120,
        right: -80,
        width: 240,
        height: 240,
        borderRadius: 120,
        backgroundColor: PALETTE.accentTint,
        opacity: 0.6,
    },
    bgOrbBottom: {
        position: 'absolute',
        bottom: -140,
        left: -90,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: PALETTE.accentSoft,
        opacity: 0.6,
    },
    flex: { flex: 1 },
    scrollContent: { flexGrow: 1, paddingHorizontal: 24 },
    backBtn: {
        width: 44, height: 44,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-start', marginBottom: 12,
    },
    heroCard: {
        backgroundColor: PALETTE.background,
        borderRadius: RADIUS.xl,
        paddingVertical: 22,
        paddingHorizontal: 18,
        borderWidth: 1,
        borderColor: PALETTE.border,
        marginBottom: 16,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    heroAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 6,
    },
    logoSection: { alignItems: 'center', marginBottom: 16 },
    logoMark: {
        width: 56, height: 56,
        alignItems: 'center', justifyContent: 'center',
    },
    logoRingOuter: {
        position: 'absolute', width: 52, height: 52, borderRadius: 26,
        borderWidth: 2, borderColor: PALETTE.accent,
    },
    logoRingMid: {
        position: 'absolute', width: 34, height: 34, borderRadius: 17,
        borderWidth: 2, borderColor: PALETTE.accentMid,
    },
    logoRingInner: {
        position: 'absolute', width: 18, height: 18, borderRadius: 9,
        borderWidth: 2, borderColor: PALETTE.accentDeep,
    },
    logoDot: {
        width: 5, height: 5, borderRadius: 2.5,
        backgroundColor: PALETTE.accentDeep,
    },
    title: {
        fontSize: 25, fontWeight: '800',
        color: PALETTE.textPrimary, textAlign: 'center',
        letterSpacing: -0.4,
    },
    subtitle: {
        marginTop: 6, fontSize: 13.5, fontWeight: '500',
        color: PALETTE.textSecondary, textAlign: 'center',
        lineHeight: 19,
    },
    roleBadge: {
        alignSelf: 'center', flexDirection: 'row',
        alignItems: 'center', gap: 6,
        backgroundColor: PALETTE.accentTint,
        borderWidth: 1, borderColor: PALETTE.accentBorder,
        borderRadius: RADIUS.full,
        paddingHorizontal: 14, paddingVertical: 6,
        marginBottom: 12,
    },
    roleBadgeText: {
        fontSize: 12, fontWeight: '700', color: PALETTE.accent,
    },
    formCard: {
        backgroundColor: PALETTE.background,
        borderRadius: RADIUS.xl,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderWidth: 1,
        borderColor: PALETTE.border,
        ...SHADOWS.md,
    },
    segmentWrap: {
        flexDirection: 'row', backgroundColor: PALETTE.backgroundSoft,
        borderRadius: RADIUS.md, padding: 4, marginBottom: 18,
        borderWidth: 1, borderColor: PALETTE.borderLight,
    },
    segmentBtn: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        minHeight: 44, borderRadius: RADIUS.sm,
    },
    segmentBtnActive: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        ...SHADOWS.sm,
    },
    segmentText: {
        fontSize: 14, fontWeight: '600', color: PALETTE.textSecondary,
    },
    segmentTextActive: {
        color: PALETTE.textPrimary, fontWeight: '700',
    },
    formBlock: { gap: 16 },
    fieldLabel: {
        marginBottom: 8, fontSize: 13, fontWeight: '700',
        color: PALETTE.textSecondary,
    },
    phoneRow: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: RADIUS.md, borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        minHeight: 50, overflow: 'hidden',
    },
    countryCode: {
        paddingHorizontal: 14, borderRightWidth: 1,
        borderRightColor: PALETTE.border,
        backgroundColor: PALETTE.surface3,
        justifyContent: 'center', minHeight: 50,
    },
    countryCodeText: {
        fontSize: 15, fontWeight: '600', color: PALETTE.textSecondary,
    },
    phoneInput: {
        flex: 1, paddingHorizontal: 14, fontSize: 15,
        fontWeight: '400', color: PALETTE.textPrimary,
    },
    input: {
        borderRadius: RADIUS.md, borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        minHeight: 50, paddingHorizontal: 14,
        fontSize: 15, fontWeight: '400', color: PALETTE.textPrimary,
    },
    submitBtn: {
        borderRadius: RADIUS.full, overflow: 'hidden',
        marginTop: 6, ...SHADOWS.accent,
    },
    submitBtnDisabled: { opacity: 0.50 },
    submitGradient: {
        minHeight: 52, alignItems: 'center', justifyContent: 'center',
        borderRadius: RADIUS.full,
    },
    submitText: {
        fontSize: 16, fontWeight: '700', color: '#FFFFFF',
    },
    dividerRow: {
        flexDirection: 'row', alignItems: 'center',
        marginVertical: 22, gap: 16,
    },
    dividerLine: {
        flex: 1, height: 0.5, backgroundColor: PALETTE.separator,
    },
    dividerText: {
        fontSize: 13, fontWeight: '500', color: PALETTE.textTertiary,
    },
    footerRow: {
        flexDirection: 'row', justifyContent: 'center',
        alignItems: 'center', paddingBottom: 8,
    },
    footerText: {
        fontSize: 14, color: PALETTE.textSecondary, fontWeight: '400',
    },
    footerLink: {
        fontSize: 14, color: PALETTE.accentDeep, fontWeight: '700',
    },
});
