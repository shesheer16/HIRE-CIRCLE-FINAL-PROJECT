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

import AuthScreenShell from '../components/auth/AuthScreenShell';
import { AuthContext } from '../context/AuthContext';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import {
    buildRoleAwareSessionPayload,
    getAuthAccountLabel,
    isEmployerFacingSelectedRole,
    isQaRoleBootstrapEnabled,
    normalizeSelectedRole,
} from '../utils/authRoleSelection';
import { buildPreviewAuthSession } from '../utils/previewAuthSession';
import { PALETTE, SHADOWS } from '../theme/theme';

const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();

export default function RegisterScreen({ navigation, route }) {
    const { login } = useContext(AuthContext);
    const selectedRole = normalizeSelectedRole(route?.params?.selectedRole || 'worker');
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);
    const isEmployer = useMemo(() => isEmployerFacingSelectedRole(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const screenTitle = useMemo(
        () => (isEmployer ? 'Create Account' : 'Create Account'),
        [isEmployer]
    );
    const screenSubtitle = useMemo(
        () => (isEmployer ? 'Get started.' : 'Get started.'),
        [isEmployer]
    );

    const canSubmit = useMemo(() => {
        if (QA_ROLE_BOOTSTRAP_ENABLED) return true;
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
        if (!QA_ROLE_BOOTSTRAP_ENABLED && safePassword.length < 6) {
            Alert.alert('Invalid password', 'Password should be at least 6 characters.');
            return;
        }
        if (safePassword !== safeConfirmPassword) {
            Alert.alert('Password mismatch', 'Password and confirm password should match.');
            return;
        }

        setLoading(true);
        try {
            const safeEmail = authMode === 'email' ? String(email || '').trim().toLowerCase() : '';
            const safePhone = authMode === 'phone' ? String(phoneNumber || '').trim() : '';

            if (QA_ROLE_BOOTSTRAP_ENABLED) {
                const authPayload = buildPreviewAuthSession({
                    selectedRole,
                    email: safeEmail,
                    phoneNumber: safePhone,
                    hasCompletedProfile: true,
                    profileComplete: true,
                });

                await login(
                    buildRoleAwareSessionPayload(authPayload, selectedRole, {
                        enforceRequestedRole: true,
                        email: safeEmail || authPayload?.email,
                        phoneNumber: safePhone || authPayload?.phoneNumber,
                        hasCompletedProfile: true,
                        profileComplete: true,
                    }),
                    { authEntryRole: selectedRole }
                );
                return;
            }

            await new Promise((resolve) => setTimeout(resolve, 450));
            navigation.navigate('BasicProfileSetup', {
                selectedRole,
                authMode,
                email: safeEmail,
                phoneNumber: safePhone,
                password: safePassword,
            });
        } catch (_error) {
            Alert.alert('Sign up unavailable', 'Unable to continue right now. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [
        authMode,
        canSubmit,
        confirmPassword,
        email,
        login,
        loading,
        navigation,
        password,
        phoneNumber,
        selectedRole,
    ]);

    return (
        <AuthScreenShell
            selectedRole={selectedRole}
            modeLabel="Create account"
            title={screenTitle}
            subtitle={screenSubtitle}
            onBack={handleBack}
            footer={(
                <View style={styles.footerWrap}>
                    <Text style={styles.footerText}>Already have an account?</Text>
                    <TouchableOpacity activeOpacity={0.75} onPress={openSignIn}>
                        <Text style={styles.footerLink}>Sign In</Text>
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
                            textContentType="newPassword"
                            returnKeyType="next"
                            placeholder="At least 6 characters"
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

                <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Confirm password</Text>
                    <View style={styles.fieldShell}>
                        <Ionicons name="checkmark-circle-outline" size={17} color="#64748b" style={styles.fieldIcon} />
                        <TextInput
                            style={styles.fieldInput}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            secureTextEntry={!showConfirmPassword}
                            autoCorrect={false}
                            textContentType="password"
                            returnKeyType="done"
                            placeholder="Re-enter password"
                            placeholderTextColor={PALETTE.textTertiary}
                        />
                        <TouchableOpacity
                            style={styles.trailingBtn}
                            onPress={() => setShowConfirmPassword((prev) => !prev)}
                            activeOpacity={0.7}
                        >
                            <Ionicons
                                name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                                size={19}
                                color={PALETTE.textSecondary}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            <TouchableOpacity
                style={[styles.submitBtn, (!canSubmit || loading) && styles.submitBtnDisabled]}
                activeOpacity={0.9}
                onPress={handleCreateAccount}
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
                        <Text style={styles.submitText}>Continue</Text>
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
    submitBtn: {
        marginTop: 20,
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
