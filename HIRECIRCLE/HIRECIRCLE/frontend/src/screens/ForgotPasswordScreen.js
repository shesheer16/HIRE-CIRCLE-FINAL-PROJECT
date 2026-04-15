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
import { normalizeSelectedRole } from '../utils/authRoleSelection';
import { PALETTE, RADIUS, SPACING, SHADOWS } from '../theme/theme';

export default function ForgotPasswordScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const selectedRole = normalizeSelectedRole(route?.params?.selectedRole || 'worker');
    const [stage, setStage] = useState('identity');
    const [identityMode, setIdentityMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const canSendOtp = useMemo(() => {
        if (identityMode === 'phone') return Boolean(String(phoneNumber || '').trim());
        return Boolean(String(email || '').trim());
    }, [email, identityMode, phoneNumber]);

    const canVerifyOtp = useMemo(() => String(otp || '').trim().length >= 4, [otp]);
    const canReset = useMemo(() => (
        Boolean(String(newPassword || '').trim())
        && Boolean(String(confirmPassword || '').trim())
    ), [confirmPassword, newPassword]);

    const handleBack = useCallback(() => {
        if (stage !== 'identity') {
            if (stage === 'verify') { setStage('identity'); return; }
            if (stage === 'reset') { setStage('verify'); return; }
            if (stage === 'success') { setStage('identity'); return; }
        }
        if (navigation.canGoBack()) { navigation.goBack(); return; }
        handleAuthBackNavigation(navigation, { selectedRole, target: 'Login' });
    }, [navigation, selectedRole, stage]);

    const sendOtp = useCallback(async () => {
        if (loading || !canSendOtp) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 400));
            setStage('verify');
        } finally { setLoading(false); }
    }, [canSendOtp, loading]);

    const verifyOtp = useCallback(async () => {
        if (loading || !canVerifyOtp) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 350));
            setStage('reset');
        } finally { setLoading(false); }
    }, [canVerifyOtp, loading]);

    const resendOtp = useCallback(async () => {
        if (loading) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            Alert.alert('OTP Sent', 'A new OTP has been sent.');
        } finally { setLoading(false); }
    }, [loading]);

    const resetPassword = useCallback(async () => {
        if (loading || !canReset) return;
        const safeNew = String(newPassword || '').trim();
        const safeConfirm = String(confirmPassword || '').trim();
        if (safeNew.length < 6) {
            Alert.alert('Invalid password', 'Password should be at least 6 characters.');
            return;
        }
        if (safeNew !== safeConfirm) {
            Alert.alert('Password mismatch', 'Password and confirm password should match.');
            return;
        }
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 450));
            setStage('success');
        } finally { setLoading(false); }
    }, [canReset, confirmPassword, loading, newPassword]);

    const goToLogin = useCallback(() => {
        navigation.navigate('Login', { selectedRole });
    }, [navigation, selectedRole]);

    const stageConfig = {
        identity: { icon: 'lock-closed-outline', title: 'Forgot Password', sub: 'Recover access in a few quick steps.' },
        verify:   { icon: 'keypad-outline',      title: 'Verify OTP',       sub: 'Enter the OTP sent to your account.' },
        reset:    { icon: 'shield-checkmark-outline', title: 'New Password', sub: 'Set a new password for your account.' },
        success:  { icon: 'checkmark-circle-outline', title: 'All Set!',     sub: 'Your password has been updated.' },
    };

    const current = stageConfig[stage];

    const renderIdentityStage = () => (
        <>
            {/* Segment */}
            <View style={styles.segmentWrap}>
                <TouchableOpacity
                    style={[styles.segmentBtn, identityMode === 'phone' && styles.segmentBtnActive]}
                    activeOpacity={0.85} onPress={() => setIdentityMode('phone')}
                >
                    <Text style={[styles.segmentText, identityMode === 'phone' && styles.segmentTextActive]}>Phone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.segmentBtn, identityMode === 'email' && styles.segmentBtnActive]}
                    activeOpacity={0.85} onPress={() => setIdentityMode('email')}
                >
                    <Text style={[styles.segmentText, identityMode === 'email' && styles.segmentTextActive]}>Email</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.formBlock}>
                {identityMode === 'phone' ? (
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

                <TouchableOpacity
                    style={[styles.submitBtn, (!canSendOtp || loading) && styles.submitBtnDisabled]}
                    activeOpacity={0.88} onPress={sendOtp}
                    disabled={!canSendOtp || loading}
                >
                    <LinearGradient
                        colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={styles.submitGradient}
                    >
                        {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> :
                            <Text style={styles.submitText}>Send OTP</Text>}
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </>
    );

    const renderVerifyStage = () => (
        <View style={styles.formBlock}>
            <View>
                <Text style={styles.fieldLabel}>Enter OTP</Text>
                <TextInput
                    style={styles.input}
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    placeholder="4-6 digit OTP"
                    placeholderTextColor={PALETTE.textTertiary}
                    maxLength={6}
                />
            </View>

            <TouchableOpacity
                style={[styles.submitBtn, (!canVerifyOtp || loading) && styles.submitBtnDisabled]}
                activeOpacity={0.88} onPress={verifyOtp}
                disabled={!canVerifyOtp || loading}
            >
                <LinearGradient
                    colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.submitGradient}
                >
                    {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> :
                        <Text style={styles.submitText}>Verify OTP</Text>}
                </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.helperTap} onPress={resendOtp} activeOpacity={0.7} disabled={loading}>
                <Text style={styles.helperText}>Resend OTP</Text>
            </TouchableOpacity>
        </View>
    );

    const renderResetStage = () => (
        <View style={styles.formBlock}>
            <View>
                <Text style={styles.fieldLabel}>New password</Text>
                <TextInput
                    style={styles.input} value={newPassword}
                    onChangeText={setNewPassword} secureTextEntry
                    placeholder="At least 6 characters"
                    placeholderTextColor={PALETTE.textTertiary}
                />
            </View>
            <View>
                <Text style={styles.fieldLabel}>Confirm password</Text>
                <TextInput
                    style={styles.input} value={confirmPassword}
                    onChangeText={setConfirmPassword} secureTextEntry
                    placeholder="Re-enter password"
                    placeholderTextColor={PALETTE.textTertiary}
                />
            </View>
            <TouchableOpacity
                style={[styles.submitBtn, (!canReset || loading) && styles.submitBtnDisabled]}
                activeOpacity={0.88} onPress={resetPassword}
                disabled={!canReset || loading}
            >
                <LinearGradient
                    colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.submitGradient}
                >
                    {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> :
                        <Text style={styles.submitText}>Reset Password</Text>}
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );

    const renderSuccessStage = () => (
        <View style={styles.successCard}>
            <View style={styles.successIconWrap}>
                <Ionicons name="checkmark" size={28} color="#FFFFFF" />
            </View>
            <Text style={styles.successTitle}>Password Updated</Text>
            <Text style={styles.successSub}>You can sign in with your new password.</Text>
            <TouchableOpacity style={styles.successBtn} activeOpacity={0.88} onPress={goToLogin}>
                <Text style={styles.successBtnText}>Back to Sign In</Text>
            </TouchableOpacity>
        </View>
    );

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
                        <View style={styles.stageIconSection}>
                            <View style={styles.stageIconWrap}>
                                <Ionicons name={current.icon} size={30} color={PALETTE.accentDeep} />
                            </View>
                        </View>

                        <Text style={styles.title}>{current.title}</Text>
                        <Text style={styles.subtitle}>{current.sub}</Text>

                        {stage !== 'success' && (
                            <View style={styles.stepsPill}>
                                {['identity', 'verify', 'reset'].map((s, i) => (
                                    <View key={s} style={[
                                        styles.stepDot,
                                        (stage === s || ['identity', 'verify', 'reset'].indexOf(stage) > i)
                                            && styles.stepDotActive,
                                    ]} />
                                ))}
                            </View>
                        )}
                    </View>

                    {stage !== 'success' ? (
                        <View style={styles.formCard}>
                            {stage === 'identity' && renderIdentityStage()}
                            {stage === 'verify' && renderVerifyStage()}
                            {stage === 'reset' && renderResetStage()}
                        </View>
                    ) : (
                        renderSuccessStage()
                    )}

                    {stage !== 'success' && (
                        <View style={styles.footerRow}>
                            <Text style={styles.footerText}>Remembered your password?{' '}</Text>
                            <TouchableOpacity activeOpacity={0.7} onPress={goToLogin}>
                                <Text style={styles.footerLink}>Sign In</Text>
                            </TouchableOpacity>
                        </View>
                    )}
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
    stageIconSection: { alignItems: 'center', marginBottom: 10 },
    stageIconWrap: {
        width: 68, height: 68, borderRadius: 34,
        backgroundColor: PALETTE.accentTint,
        borderWidth: 1, borderColor: PALETTE.accentBorder,
        alignItems: 'center', justifyContent: 'center',
    },
    title: {
        fontSize: 24, fontWeight: '800',
        color: PALETTE.textPrimary, textAlign: 'center',
        letterSpacing: -0.4,
    },
    subtitle: {
        marginTop: 6, fontSize: 13.5, fontWeight: '500',
        color: PALETTE.textSecondary, textAlign: 'center',
        lineHeight: 19,
    },
    stepsPill: {
        flexDirection: 'row', alignSelf: 'center',
        gap: 6, marginTop: 12,
    },
    stepDot: {
        width: 8, height: 8, borderRadius: 4,
        backgroundColor: PALETTE.surface3,
    },
    stepDotActive: {
        backgroundColor: PALETTE.accent, width: 20,
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
    helperTap: {
        alignSelf: 'center', minHeight: 44, justifyContent: 'center',
    },
    helperText: {
        fontSize: 14, fontWeight: '700', color: PALETTE.accentDeep,
    },
    successCard: {
        marginTop: 12, borderRadius: RADIUS.xl,
        borderWidth: 1, borderColor: PALETTE.border,
        backgroundColor: PALETTE.background,
        paddingHorizontal: 24, paddingVertical: 28,
        alignItems: 'center',
        ...SHADOWS.md,
    },
    successIconWrap: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: PALETTE.accent,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
        ...SHADOWS.accent,
    },
    successTitle: {
        fontSize: 20, fontWeight: '800', color: PALETTE.textPrimary,
    },
    successSub: {
        marginTop: 6, fontSize: 14, fontWeight: '400',
        color: PALETTE.textSecondary, textAlign: 'center',
    },
    successBtn: {
        marginTop: 18, minHeight: 48, borderRadius: RADIUS.full,
        backgroundColor: PALETTE.accent, paddingHorizontal: 28,
        alignItems: 'center', justifyContent: 'center',
        ...SHADOWS.accent,
    },
    successBtnText: {
        fontSize: 14, fontWeight: '700', color: '#FFFFFF',
    },
    footerRow: {
        marginTop: 28, flexDirection: 'row',
        justifyContent: 'center', alignItems: 'center',
    },
    footerText: {
        fontSize: 14, color: PALETTE.textSecondary, fontWeight: '400',
    },
    footerLink: {
        fontSize: 14, color: PALETTE.accentDeep, fontWeight: '700',
    },
});
