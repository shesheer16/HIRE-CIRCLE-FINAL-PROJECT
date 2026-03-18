import React, { useCallback, useMemo, useState } from 'react';
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
import { handleAuthBackNavigation } from '../utils/authNavigation';
import {
    getAuthAccountLabel,
    isEmployerFacingSelectedRole,
    normalizeSelectedRole,
} from '../utils/authRoleSelection';
import { PALETTE, RADIUS, SHADOWS } from '../theme/theme';

export default function RegisterScreen({ navigation, route }) {
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
        () => (isEmployer
            ? 'Create your hiring workspace'
            : 'Create your job seeker account'),
        [isEmployer]
    );
    const screenSubtitle = useMemo(
        () => (isEmployer
            ? 'Start with your login details. Company basics and hiring setup come next.'
            : 'Start with your login details. Profile basics and work preferences come next.'),
        [isEmployer]
    );
    const panelSubtitle = useMemo(
        () => (authMode === 'phone'
            ? 'Use a mobile number you can access regularly for account recovery.'
            : 'Use an email address you can access regularly for account recovery.'),
        [authMode]
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
        authMode,
        canSubmit,
        confirmPassword,
        email,
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
            <Text style={styles.sectionEyebrow}>Step 1 of 3</Text>
            <Text style={styles.sectionTitle}>Create your sign-in details</Text>
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
                    colors={['#c084fc', PALETTE.accent, PALETTE.accentDeep]}
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

            <View style={styles.inlineMetaRow}>
                <Ionicons name="sparkles-outline" size={14} color="#7c3aed" />
                <Text style={styles.inlineMetaText}>
                    Next: {isEmployer ? 'company basics and role setup.' : 'profile basics and work preferences.'}
                </Text>
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
        marginBottom: 18,
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
    submitBtn: {
        marginTop: 20,
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
