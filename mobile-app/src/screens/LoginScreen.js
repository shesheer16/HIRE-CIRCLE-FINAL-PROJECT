import React, { useCallback, useContext, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import client from '../api/client';
import AuthScreenShell from '../components/auth/AuthScreenShell';
import { AuthContext } from '../context/AuthContext';
import {
    buildRoleAwareSessionPayload,
    getAuthAccountLabel,
    isEmployerFacingSelectedRole,
    isQaRoleBootstrapEnabled,
    resolveSelectedRoleSession,
} from '../utils/authRoleSelection';
import { buildPreviewAuthSession, isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import { PALETTE, RADIUS, SHADOWS } from '../theme/theme';
import { handleAuthBackNavigation } from '../utils/authNavigation';

const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();
const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

export default function LoginScreen({ navigation, route }) {
    const { login } = useContext(AuthContext);
    const selectedSession = useMemo(
        () => resolveSelectedRoleSession(route?.params?.selectedRole || 'worker'),
        [route?.params?.selectedRole]
    );
    const selectedRole = selectedSession.selectedRole;
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);
    const isEmployer = useMemo(() => isEmployerFacingSelectedRole(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const isPhonePreviewOnly = authMode === 'phone' && !QA_ROLE_BOOTSTRAP_ENABLED;
    const screenTitle = useMemo(
        () => (isEmployer
            ? 'Sign in to your hiring workspace'
            : 'Sign in to keep your work search moving'),
        [isEmployer]
    );
    const screenSubtitle = useMemo(
        () => (isEmployer
            ? 'Open your jobs, review talent, and move applicants forward from one place.'
            : 'Check live matches, follow every application, and get back to opportunities faster.'),
        [isEmployer]
    );
    const panelSubtitle = useMemo(() => {
        if (authMode === 'phone') {
            return QA_ROLE_BOOTSTRAP_ENABLED
                ? 'Use the mobile number linked to your account.'
                : 'Phone access is preview-only in this build. Switch to email for server sign in.';
        }
        return 'Use the email and password already linked to your account.';
    }, [authMode]);

    const canSubmit = authMode === 'phone'
        ? Boolean(QA_ROLE_BOOTSTRAP_ENABLED && String(phoneNumber || '').trim() && String(password || '').trim())
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
        authMode,
        canSubmit,
        email,
        loading,
        login,
        password,
        phoneNumber,
        selectedRole,
        selectedSession.requestedActiveRole,
    ]);

    const openForgotPassword = useCallback(() => {
        navigation.navigate('ForgotPassword', { selectedRole });
    }, [navigation, selectedRole]);

    const openSignUp = useCallback(() => {
        navigation.navigate('Register', { selectedRole });
    }, [navigation, selectedRole]);

    return (
        <AuthScreenShell
            selectedRole={selectedRole}
            modeLabel="Sign in"
            title={screenTitle}
            subtitle={screenSubtitle}
            onBack={handleBack}
            footer={(
                <View style={styles.footerWrap}>
                    <Text style={styles.footerText}>New to HireCircle?</Text>
                    <TouchableOpacity activeOpacity={0.75} onPress={openSignUp}>
                        <Text style={styles.footerLink}>Create {accountLabel} account</Text>
                    </TouchableOpacity>
                </View>
            )}
        >
            <Text style={styles.sectionEyebrow}>Access details</Text>
            <Text style={styles.sectionTitle}>{authMode === 'phone' ? 'Continue with phone' : 'Continue with email'}</Text>
            <Text style={styles.sectionSubtitle}>{panelSubtitle}</Text>

            <View style={styles.segmentWrap}>
                <TouchableOpacity
                    style={[styles.segmentBtn, authMode === 'phone' && styles.segmentBtnActive]}
                    activeOpacity={0.85}
                    onPress={() => setAuthMode('phone')}
                >
                    <Ionicons name="call-outline" size={15} color={authMode === 'phone' ? PALETTE.accentDeep : '#64748b'} />
                    <Text style={[styles.segmentText, authMode === 'phone' && styles.segmentTextActive]}>Phone</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.segmentBtn, authMode === 'email' && styles.segmentBtnActive]}
                    activeOpacity={0.85}
                    onPress={() => setAuthMode('email')}
                >
                    <Ionicons name="mail-outline" size={15} color={authMode === 'email' ? PALETTE.accentDeep : '#64748b'} />
                    <Text style={[styles.segmentText, authMode === 'email' && styles.segmentTextActive]}>Email</Text>
                </TouchableOpacity>
            </View>

            {isPhonePreviewOnly ? (
                <View style={styles.noticeCard}>
                    <Ionicons name="information-circle-outline" size={16} color="#7c3aed" />
                    <Text style={styles.noticeText}>Phone sign in is preview-only here. Use email for live authentication.</Text>
                </View>
            ) : null}

            <View style={styles.formBlock}>
                {authMode === 'phone' ? (
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Phone number</Text>
                        <View style={styles.phoneShell}>
                            <View style={styles.countryCode}>
                                <Ionicons name="phone-portrait-outline" size={15} color="#64748b" />
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
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Email address</Text>
                        <View style={styles.fieldShell}>
                            <Ionicons name="mail-outline" size={17} color="#64748b" style={styles.fieldIcon} />
                            <TextInput
                                style={styles.fieldInput}
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                placeholder="you@example.com"
                                placeholderTextColor={PALETTE.textTertiary}
                            />
                        </View>
                    </View>
                )}

                <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View style={styles.fieldShell}>
                        <Ionicons name="lock-closed-outline" size={17} color="#64748b" style={styles.fieldIcon} />
                        <TextInput
                            style={styles.fieldInput}
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry={!showPassword}
                            placeholder="Enter password"
                            placeholderTextColor={PALETTE.textTertiary}
                        />
                        <TouchableOpacity
                            style={styles.trailingBtn}
                            onPress={() => setShowPassword((prev) => !prev)}
                            activeOpacity={0.7}
                        >
                            <Ionicons
                                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                size={19}
                                color={PALETTE.textSecondary}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <View style={styles.utilityRow}>
                <TouchableOpacity activeOpacity={0.75} onPress={openForgotPassword}>
                    <Text style={styles.utilityLink}>Forgot password?</Text>
                </TouchableOpacity>
            </View>

            <TouchableOpacity
                style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
                activeOpacity={0.9}
                onPress={handleSubmit}
                disabled={!canSubmit || loading}
            >
                <LinearGradient
                    colors={['#c084fc', PALETTE.accent, PALETTE.accentDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.submitGradient}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text style={styles.submitText}>Sign In</Text>
                    )}
                </LinearGradient>
            </TouchableOpacity>

            <View style={styles.inlineMetaRow}>
                <Ionicons name="shield-checkmark-outline" size={14} color="#7c3aed" />
                <Text style={styles.inlineMetaText}>Secure access for your {accountLabel.toLowerCase()} workspace.</Text>
            </View>
        </AuthScreenShell>
    );
}

const styles = StyleSheet.create({
    sectionEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: '#7c3aed',
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 21,
        fontWeight: '800',
        color: PALETTE.textPrimary,
        letterSpacing: -0.4,
    },
    sectionSubtitle: {
        marginTop: 6,
        marginBottom: 18,
        fontSize: 14,
        lineHeight: 21,
        color: '#64748b',
    },
    segmentWrap: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 16,
    },
    segmentBtn: {
        flex: 1,
        minHeight: 48,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    segmentBtnActive: {
        backgroundColor: '#f3e8ff',
        borderColor: '#d8b4fe',
        ...SHADOWS.sm,
    },
    segmentText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#64748b',
    },
    segmentTextActive: {
        color: PALETTE.accentDeep,
    },
    noticeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 16,
    },
    noticeText: {
        flex: 1,
        fontSize: 12.5,
        lineHeight: 18,
        color: '#6d28d9',
        fontWeight: '600',
    },
    formBlock: {
        gap: 16,
    },
    fieldGroup: {
        gap: 8,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    phoneShell: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 54,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        overflow: 'hidden',
    },
    countryCode: {
        minHeight: 54,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRightWidth: 1,
        borderRightColor: '#e2e8f0',
        backgroundColor: '#f1f5f9',
    },
    countryCodeText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#475569',
    },
    phoneInput: {
        flex: 1,
        paddingHorizontal: 14,
        fontSize: 15,
        color: PALETTE.textPrimary,
    },
    fieldShell: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 54,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
    },
    fieldIcon: {
        marginLeft: 14,
    },
    fieldInput: {
        flex: 1,
        paddingLeft: 10,
        paddingRight: 12,
        fontSize: 15,
        color: PALETTE.textPrimary,
    },
    trailingBtn: {
        width: 42,
        height: 42,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 4,
    },
    utilityRow: {
        marginTop: 14,
        marginBottom: 18,
        alignItems: 'flex-end',
    },
    utilityLink: {
        fontSize: 14,
        fontWeight: '700',
        color: PALETTE.accentDeep,
    },
    submitBtn: {
        borderRadius: RADIUS.full,
        overflow: 'hidden',
        ...SHADOWS.accent,
    },
    submitBtnDisabled: {
        opacity: 0.5,
    },
    submitGradient: {
        minHeight: 54,
        borderRadius: RADIUS.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        fontSize: 16,
        fontWeight: '800',
        color: '#ffffff',
        letterSpacing: 0.2,
    },
    inlineMetaRow: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inlineMetaText: {
        flex: 1,
        fontSize: 12.5,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    footerWrap: {
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingBottom: 4,
    },
    footerText: {
        fontSize: 14,
        color: '#64748b',
        fontWeight: '500',
    },
    footerLink: {
        fontSize: 14,
        color: PALETTE.accentDeep,
        fontWeight: '800',
    },
});
