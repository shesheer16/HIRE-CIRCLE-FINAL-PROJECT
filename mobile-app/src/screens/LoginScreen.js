import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
    ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import {
    buildRoleAwareSessionPayload, getAuthAccountLabel,
    isQaRoleBootstrapEnabled, resolveSelectedRoleSession,
} from '../utils/authRoleSelection';
import { buildPreviewAuthSession, isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import { PALETTE, RADIUS, SPACING, SHADOWS } from '../theme/theme';
import { handleAuthBackNavigation } from '../utils/authNavigation';

const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();
const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

export default function LoginScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);
    const selectedSession = useMemo(
        () => resolveSelectedRoleSession(route?.params?.selectedRole || 'worker'),
        [route?.params?.selectedRole]
    );
    const selectedRole = selectedSession.selectedRole;
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const subtitleText = useMemo(
        () => `Sign in to your ${accountLabel} account`,
        [accountLabel]
    );

    const canSubmit = authMode === 'phone'
        ? Boolean(String(phoneNumber || '').trim() && String(password || '').trim())
        : Boolean(String(email || '').trim() && String(password || '').trim());

    const handleBack = useCallback(() => {
        handleAuthBackNavigation(navigation, { target: 'RoleSelection' });
    }, [navigation]);

    const handleSubmit = useCallback(async () => {
        if (loading || !canSubmit) return;
        const safePassword = String(password || '').trim();
        const safeEmail = String(email || '').trim().toLowerCase();
        const safePhone = String(phoneNumber || '').trim();
        setLoading(true);
        try {
            let authPayload = null;

            if (QA_ROLE_BOOTSTRAP_ENABLED) {
                if (INSTANT_PREVIEW_AUTH_ENABLED) {
                    authPayload = buildPreviewAuthSession({
                        selectedRole,
                        email: authMode === 'email' ? safeEmail : '',
                        phoneNumber: authMode === 'phone' ? safePhone : '',
                        hasCompletedProfile: true,
                        profileComplete: true,
                    });
                } else {
                    try {
                        const { data } = await client.post('/api/auth/dev-bootstrap', {
                            role: selectedSession.requestedActiveRole,
                        }, {
                            __skipUnauthorizedHandler: true,
                            __skipApiErrorHandler: true,
                            __allowWhenCircuitOpen: true,
                            __maxRetries: 1,
                            timeout: 2500,
                        });
                        authPayload = data;
                    } catch (_bootstrapError) {
                        authPayload = buildPreviewAuthSession({
                            selectedRole,
                            email: authMode === 'email' ? safeEmail : '',
                            phoneNumber: authMode === 'phone' ? safePhone : '',
                            hasCompletedProfile: true,
                            profileComplete: true,
                        });
                    }
                }
            } else {
                if (authMode !== 'email') {
                    Alert.alert('Use email sign in', 'Phone sign in is not available in this build yet. Please switch to email.');
                    return;
                }

                const { data } = await client.post('/api/users/login', {
                    email: safeEmail,
                    password: safePassword,
                }, {
                    __skipUnauthorizedHandler: true,
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                });
                authPayload = data;
            }

            if (!authPayload?.token) {
                throw new Error('Missing session token');
            }

            const sessionPayload = QA_ROLE_BOOTSTRAP_ENABLED
                ? buildRoleAwareSessionPayload(authPayload, selectedRole, {
                    enforceRequestedRole: true,
                    email: authMode === 'email' ? safeEmail : authPayload?.email,
                    phoneNumber: authMode === 'phone' ? safePhone : authPayload?.phoneNumber,
                    hasCompletedProfile: Boolean(authPayload?.hasCompletedProfile ?? true),
                    profileComplete: Boolean(authPayload?.profileComplete ?? authPayload?.hasCompletedProfile ?? true),
                })
                : buildRoleAwareSessionPayload(authPayload, selectedRole, {
                    enforceRequestedRole: false,
                    email: authMode === 'email' ? safeEmail : authPayload?.email,
                    phoneNumber: authMode === 'phone' ? safePhone : authPayload?.phoneNumber,
                    hasCompletedProfile: Boolean(authPayload?.hasCompletedProfile),
                });

            await login(sessionPayload, { authEntryRole: selectedRole });
        } catch (error) {
            const backendMessage = String(error?.response?.data?.message || error?.message || '').trim();
            Alert.alert(
                'Sign in unavailable',
                backendMessage || 'Unable to continue right now. Please try again.'
            );
        } finally {
            setLoading(false);
        }
    }, [
        authMode, canSubmit, email, loading, login,
        password, phoneNumber, selectedRole, selectedSession.requestedActiveRole,
    ]);

    const openForgotPassword = useCallback(() => {
        navigation.navigate('ForgotPassword', { selectedRole });
    }, [navigation, selectedRole]);

    const openSignUp = useCallback(() => {
        navigation.navigate('Register', { selectedRole });
    }, [navigation, selectedRole]);

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
                    {/* Back button */}
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
                        <View style={styles.heroBadge}>
                            <Ionicons name="sparkles-outline" size={14} color={PALETTE.accentDeep} />
                            <Text style={styles.heroBadgeText}>{accountLabel} sign in</Text>
                        </View>
                        <Text style={styles.title}>Welcome back</Text>
                        <Text style={styles.subtitle}>{subtitleText}</Text>
                    </View>

                    <View style={styles.formCard}>
                        {/* Segment control */}
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

                        {/* Form fields */}
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
                            <View style={styles.passwordRow}>
                                <TextInput
                                    style={styles.passwordInput}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                    placeholder="Enter password"
                                    placeholderTextColor={PALETTE.textTertiary}
                                />
                                <TouchableOpacity
                                    style={styles.eyeBtn}
                                    onPress={() => setShowPassword((p) => !p)}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={20}
                                        color={PALETTE.textTertiary}
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Forgot password */}
                        <TouchableOpacity
                            style={styles.forgotTap}
                            activeOpacity={0.7}
                            onPress={openForgotPassword}
                        >
                            <Text style={styles.forgotText}>Forgot password?</Text>
                        </TouchableOpacity>

                        {/* Submit */}
                        <TouchableOpacity
                            style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
                            activeOpacity={0.88}
                            onPress={handleSubmit}
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
                                    <Text style={styles.submitText}>Sign In</Text>
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
                        <Text style={styles.footerText}>Don't have an account?{' '}</Text>
                        <TouchableOpacity activeOpacity={0.7} onPress={openSignUp}>
                            <Text style={styles.footerLink}>Sign Up</Text>
                        </TouchableOpacity>
                    </View>
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
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
    },
    // Back
    backBtn: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'flex-start',
        marginBottom: 16,
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
    heroBadge: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: RADIUS.full,
        backgroundColor: PALETTE.accentTint,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.accentBorder,
        marginBottom: 12,
    },
    heroBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: PALETTE.accentDeep,
    },
    // Logo
    logoSection: {
        alignItems: 'center',
        marginBottom: 16,
    },
    logoMark: {
        width: 64,
        height: 64,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoRingOuter: {
        position: 'absolute',
        width: 60,
        height: 60,
        borderRadius: 30,
        borderWidth: 2.5,
        borderColor: PALETTE.accent,
    },
    logoRingMid: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: 2.5,
        borderColor: PALETTE.accentMid,
    },
    logoRingInner: {
        position: 'absolute',
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 2.5,
        borderColor: PALETTE.accentDeep,
    },
    logoDot: {
        width: 6, height: 6, borderRadius: 3,
        backgroundColor: PALETTE.accentDeep,
    },
    // Title
    title: {
        fontSize: 26,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        textAlign: 'center',
        letterSpacing: -0.4,
    },
    subtitle: {
        marginTop: 6,
        fontSize: 13.5,
        fontWeight: '500',
        color: PALETTE.textSecondary,
        textAlign: 'center',
        lineHeight: 19,
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
    // Segment
    segmentWrap: {
        flexDirection: 'row',
        backgroundColor: PALETTE.backgroundSoft,
        borderRadius: RADIUS.md,
        padding: 4,
        marginBottom: 18,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
    },
    segmentBtn: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
        borderRadius: RADIUS.sm,
    },
    segmentBtnActive: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        ...SHADOWS.sm,
    },
    segmentText: {
        fontSize: 14,
        fontWeight: '600',
        color: PALETTE.textSecondary,
    },
    segmentTextActive: {
        color: PALETTE.textPrimary,
        fontWeight: '700',
    },
    // Form
    formBlock: {
        gap: 16,
    },
    fieldLabel: {
        marginBottom: 8,
        fontSize: 13,
        fontWeight: '700',
        color: PALETTE.textSecondary,
    },
    phoneRow: {
        ...GLASS_SURFACES.input,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        minHeight: 50,
        overflow: 'hidden',
    },
    countryCode: {
        paddingHorizontal: 14,
        borderRightWidth: 1,
        borderRightColor: PALETTE.border,
        backgroundColor: PALETTE.surface3,
        justifyContent: 'center',
        minHeight: 50,
    },
    countryCodeText: {
        fontSize: 15,
        fontWeight: '600',
        color: PALETTE.textSecondary,
    },
    phoneInput: {
        flex: 1,
        paddingHorizontal: 14,
        fontSize: 15,
        fontWeight: '400',
        color: PALETTE.textPrimary,
    },
    input: {
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        minHeight: 50,
        paddingHorizontal: 14,
        fontSize: 15,
        fontWeight: '400',
        color: PALETTE.textPrimary,
    },
    passwordRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        minHeight: 50,
        overflow: 'hidden',
    },
    passwordInput: {
        flex: 1,
        paddingHorizontal: 14,
        fontSize: 15,
        fontWeight: '400',
        color: PALETTE.textPrimary,
    },
    eyeBtn: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    forgotTap: {
        alignSelf: 'flex-end',
        minHeight: 44,
        justifyContent: 'center',
    },
    forgotText: {
        fontSize: 14,
        fontWeight: '600',
        color: PALETTE.accentDeep,
    },
    // Submit
    submitBtn: {
        borderRadius: RADIUS.full,
        overflow: 'hidden',
        marginTop: 6,
        ...SHADOWS.accent,
    },
    submitBtnDisabled: {
        opacity: 0.50,
    },
    submitGradient: {
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.full,
    },
    submitText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    // Divider
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 20,
        gap: 16,
    },
    dividerLine: {
        flex: 1,
        height: 0.5,
        backgroundColor: PALETTE.separator,
    },
    dividerText: {
        fontSize: 13,
        fontWeight: '500',
        color: PALETTE.textTertiary,
    },
    // Footer
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: 8,
    },
    footerText: {
        fontSize: 14,
        color: PALETTE.textSecondary,
        fontWeight: '400',
    },
    footerLink: {
        fontSize: 14,
        color: PALETTE.accentDeep,
        fontWeight: '700',
    },
});
