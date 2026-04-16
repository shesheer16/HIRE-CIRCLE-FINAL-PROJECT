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
import { PALETTE, SHADOWS } from '../theme/theme';
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

    const [authMode, setAuthMode] = useState('email');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const isPhonePreviewOnly = authMode === 'phone' && !QA_ROLE_BOOTSTRAP_ENABLED;
    const screenTitle = 'Sign In';
    const screenSubtitle = isEmployer ? 'Welcome back.' : 'Welcome back.';

    const canSubmit = QA_ROLE_BOOTSTRAP_ENABLED
        ? true
        : (authMode === 'phone'
            ? Boolean(String(phoneNumber || '').trim() && String(password || '').trim())
            : Boolean(String(email || '').trim() && String(password || '').trim()));

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

                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(safeEmail)) {
                    Alert.alert('Invalid email', 'Please enter a valid email address (e.g., you@gmail.com).');
                    return;
                }

                const { data } = await client.post('/api/users/login', {
                    email: safeEmail,
                    password: safePassword,
                    selectedRole,
                }, {
                    __skipUnauthorizedHandler: true,
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                });
                if (data?.requiresOtpVerification) {
                    await client.post('/api/auth/send-otp', { email: safeEmail });
                    navigation.navigate('OTPVerification', {
                        selectedRole,
                        intent: 'signin',
                        identity: { kind: 'email', value: safeEmail, label: safeEmail },
                        initialOtpDispatched: true,
                    });
                    return;
                }
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
            const lowerMsg = backendMessage.toLowerCase();
            const status = error?.response?.status;

            if (status === 404 || lowerMsg.includes('not exist') || lowerMsg.includes('not found') || lowerMsg.includes('no account') || lowerMsg.includes('unregistered')) {
                Alert.alert(
                    'Sign in unavailable',
                    'This email is not registered. Please create a new account.'
                );
            } else {
                Alert.alert(
                    'Sign in unavailable',
                    backendMessage || 'Unable to continue right now. Please try again.'
                );
            }
        } finally {
            setLoading(false);
        }
    }, [
        authMode,
        canSubmit,
        email,
        loading,
        login,
        navigation,
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
            <View style={styles.segmentShell}>
                <View style={styles.segmentWrap}>
                    <TouchableOpacity
                        style={[styles.segmentBtn, authMode === 'phone' && styles.segmentBtnActive]}
                        activeOpacity={0.85}
                        onPress={() => setAuthMode('phone')}
                    >
                        <Ionicons name="call-outline" size={15} color={authMode === 'phone' ? '#1f1b17' : '#6a6258'} />
                        <Text style={[styles.segmentText, authMode === 'phone' && styles.segmentTextActive]}>Phone</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.segmentBtn, authMode === 'email' && styles.segmentBtnActive]}
                        activeOpacity={0.85}
                        onPress={() => setAuthMode('email')}
                    >
                        <Ionicons name="mail-outline" size={15} color={authMode === 'email' ? '#1f1b17' : '#6a6258'} />
                        <Text style={[styles.segmentText, authMode === 'email' && styles.segmentTextActive]}>Email</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {authMode === 'phone' ? (
                <Text style={[styles.noticeText, { color: '#ef4444', fontWeight: 'bold' }]}>
                    Phone login is currently unavailable. Please use Email to login.
                </Text>
            ) : null}

            <View style={styles.formBlock}>
                {authMode === 'phone' ? (
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Phone</Text>
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
                                autoCorrect={false}
                                textContentType="telephoneNumber"
                                returnKeyType="next"
                                placeholder="98765 43210"
                                placeholderTextColor={PALETTE.textTertiary}
                                maxLength={15}
                            />
                        </View>
                    </View>
                ) : (
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Email</Text>
                        <View style={styles.fieldShell}>
                            <Ionicons name="mail-outline" size={17} color="#64748b" style={styles.fieldIcon} />
                            <TextInput
                                style={styles.fieldInput}
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                autoCorrect={false}
                                textContentType="emailAddress"
                                returnKeyType="next"
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
                            autoCorrect={false}
                            textContentType="password"
                            returnKeyType="done"
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
                    colors={['#271f39', '#4c1d95', PALETTE.accent]}
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
        </AuthScreenShell>
    );
}

const styles = StyleSheet.create({
    segmentShell: {
        marginBottom: 18,
        padding: 4,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        backgroundColor: PALETTE.surface2,
    },
    segmentWrap: {
        flexDirection: 'row',
        gap: 6,
    },
    segmentBtn: {
        flex: 1,
        minHeight: 44,
        borderRadius: 14,
        backgroundColor: 'transparent',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    segmentBtnActive: {
        backgroundColor: PALETTE.surface,
        ...SHADOWS.sm,
    },
    segmentText: {
        fontSize: 13,
        fontWeight: '700',
        color: PALETTE.textSecondary,
    },
    segmentTextActive: {
        color: PALETTE.textPrimary,
    },
    noticeText: {
        marginBottom: 16,
        fontSize: 12,
        color: PALETTE.textSecondary,
        fontWeight: '600',
        textAlign: 'center',
    },
    formBlock: {
        gap: 14,
    },
    fieldGroup: {
        gap: 7,
    },
    fieldLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: PALETTE.textSecondary,
    },
    phoneShell: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface,
        overflow: 'hidden',
    },
    countryCode: {
        minHeight: 52,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRightWidth: 1,
        borderRightColor: PALETTE.borderLight,
        backgroundColor: PALETTE.surface2,
    },
    countryCodeText: {
        fontSize: 14,
        fontWeight: '700',
        color: PALETTE.textPrimary,
    },
    phoneInput: {
        flex: 1,
        paddingHorizontal: 12,
        fontSize: 15,
        color: PALETTE.textPrimary,
    },
    fieldShell: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface,
    },
    fieldIcon: {
        marginLeft: 12,
    },
    fieldInput: {
        flex: 1,
        paddingLeft: 8,
        paddingRight: 12,
        fontSize: 15,
        color: PALETTE.textPrimary,
    },
    trailingBtn: {
        width: 40,
        height: 40,
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
        fontSize: 13,
        fontWeight: '800',
        color: PALETTE.accentDeep,
    },
    submitBtn: {
        borderRadius: 14,
        overflow: 'hidden',
        ...SHADOWS.accent,
    },
    submitBtnDisabled: {
        opacity: 0.5,
    },
    submitGradient: {
        minHeight: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        fontSize: 15,
        fontWeight: '900',
        color: '#ffffff',
        letterSpacing: 0.1,
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
        color: PALETTE.textSecondary,
        fontWeight: '500',
    },
    footerLink: {
        fontSize: 14,
        color: PALETTE.accentDeep,
        fontWeight: '800',
    },
});
