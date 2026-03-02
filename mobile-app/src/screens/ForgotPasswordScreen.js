import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    LayoutAnimation,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import client from '../api/client';
import UnifiedIdentityInput from '../components/UnifiedIdentityInput';
import { navigateToWelcomeFallback } from '../utils/authNavigation';
import { logger } from '../utils/logger';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

const runLayoutAnimation = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
};

export default function ForgotPasswordScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const identityRef = useRef(null);
    const passwordRef = useRef('');
    const confirmPasswordRef = useRef('');

    const otpInputRefs = useRef(Array.from({ length: OTP_LENGTH }, () => React.createRef()));
    const activeIdentitySnapshotRef = useRef(null);
    const otpCodeRef = useRef('');

    const [stage, setStage] = useState('identity');
    const [loading, setLoading] = useState(false);
    const [identityError, setIdentityError] = useState('');
    const [stageError, setStageError] = useState('');
    const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(''));
    const [resendTimer, setResendTimer] = useState(0);
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [confirmFocused, setConfirmFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [successMessage, setSuccessMessage] = useState('Password updated successfully.');

    const resendIntervalRef = useRef(null);

    const clearResendTimer = useCallback(() => {
        if (resendIntervalRef.current) {
            clearInterval(resendIntervalRef.current);
            resendIntervalRef.current = null;
        }
    }, []);

    React.useEffect(() => () => clearResendTimer(), [clearResendTimer]);

    const startResendTimer = useCallback(() => {
        clearResendTimer();
        setResendTimer(RESEND_COOLDOWN_SECONDS);

        resendIntervalRef.current = setInterval(() => {
            setResendTimer((current) => {
                if (current <= 1) {
                    clearResendTimer();
                    return 0;
                }
                return current - 1;
            });
        }, 1000);
    }, [clearResendTimer]);

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }

        navigateToWelcomeFallback(navigation);
    }, [navigation]);

    const updateStage = useCallback((nextStage) => {
        runLayoutAnimation();
        setStage(nextStage);
    }, []);

    const sendOtpRequest = useCallback(async (snapshot) => {
        const emailCandidates = [snapshot.backendEmail, snapshot.alternateBackendEmail].filter(Boolean);

        let lastError = null;
        for (const email of emailCandidates) {
            try {
                await client.post('/api/auth/send-otp', { email });
                return { mode: 'otp', email };
            } catch (error) {
                lastError = error;
            }
        }

        for (const email of emailCandidates) {
            try {
                await client.post('/api/users/forgotpassword', { email });
                return { mode: 'email_link', email };
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError;
    }, []);

    const handleSendOtp = useCallback(async () => {
        const snapshot = identityRef.current?.getSnapshot?.();

        if (!snapshot?.raw) {
            setIdentityError('Enter your email or phone to continue.');
            return;
        }

        if (!snapshot.isValid) {
            setIdentityError(snapshot.type === 'phone'
                ? 'Enter a valid phone number (10-15 digits).'
                : 'Enter a valid email address.');
            return;
        }

        setIdentityError('');
        setStageError('');
        setLoading(true);

        try {
            const result = await sendOtpRequest(snapshot);
            activeIdentitySnapshotRef.current = {
                ...snapshot,
                backendEmail: result.email,
            };

            if (result.mode === 'otp') {
                setOtpDigits(Array(OTP_LENGTH).fill(''));
                otpCodeRef.current = '';
                updateStage('otp');
                startResendTimer();
                return;
            }

            setSuccessMessage('A secure reset link has been sent to your account email.');
            updateStage('success');
        } catch (error) {
            logger.error('Forgot password send OTP failed:', error);
            const message = error?.response?.data?.message || 'Could not start password reset right now.';
            setStageError(message);
            Alert.alert('Reset Failed', message);
        } finally {
            setLoading(false);
        }
    }, [sendOtpRequest, startResendTimer, updateStage]);

    const handleOtpDigitChange = useCallback((text, index) => {
        const digit = String(text || '').replace(/\D/g, '').slice(-1);
        setStageError('');

        setOtpDigits((current) => {
            const next = [...current];
            next[index] = digit;
            otpCodeRef.current = next.join('');
            return next;
        });

        if (digit && index < OTP_LENGTH - 1) {
            otpInputRefs.current[index + 1]?.current?.focus();
        }
    }, []);

    const handleOtpKeyPress = useCallback((event, index) => {
        if (event.nativeEvent.key === 'Backspace' && !otpDigits[index] && index > 0) {
            otpInputRefs.current[index - 1]?.current?.focus();
        }
    }, [otpDigits]);

    const verifyOtpRequest = useCallback(async () => {
        const snapshot = activeIdentitySnapshotRef.current;
        if (!snapshot?.backendEmail) {
            throw new Error('Identity snapshot missing for OTP verification.');
        }

        await client.post('/api/auth/verify-otp', {
            email: snapshot.backendEmail,
            otp: otpCodeRef.current,
        });
    }, []);

    const handleVerifyOtp = useCallback(async () => {
        if (otpCodeRef.current.length < OTP_LENGTH) {
            setStageError('Enter all 6 digits to continue.');
            return;
        }

        setStageError('');
        setLoading(true);

        try {
            await verifyOtpRequest();
            updateStage('password');
        } catch (error) {
            const message = error?.response?.data?.message || 'Invalid OTP. Please try again.';
            setStageError(message);
        } finally {
            setLoading(false);
        }
    }, [updateStage, verifyOtpRequest]);

    const handleResendOtp = useCallback(async () => {
        if (resendTimer > 0 || loading) return;

        const snapshot = activeIdentitySnapshotRef.current;
        if (!snapshot?.backendEmail) return;

        setStageError('');
        setLoading(true);

        try {
            await client.post('/api/auth/send-otp', { email: snapshot.backendEmail });
            setOtpDigits(Array(OTP_LENGTH).fill(''));
            otpCodeRef.current = '';
            startResendTimer();
            otpInputRefs.current[0]?.current?.focus();
        } catch (error) {
            const message = error?.response?.data?.message || 'Could not resend OTP right now.';
            setStageError(message);
        } finally {
            setLoading(false);
        }
    }, [loading, resendTimer, startResendTimer]);

    const applyPasswordReset = useCallback(async (password) => {
        const snapshot = activeIdentitySnapshotRef.current;

        const otpToken = otpCodeRef.current;
        const email = snapshot?.backendEmail;

        const attempts = [
            () => client.post('/api/auth/reset-password', { email, otp: otpToken, password }),
            () => client.put('/api/auth/reset-password', { email, otp: otpToken, password }),
            () => client.put(`/api/users/resetpassword/${otpToken}`, { password }),
        ];

        let lastError = null;
        for (const request of attempts) {
            try {
                await request();
                return { mode: 'inline_reset' };
            } catch (error) {
                lastError = error;
            }
        }

        if (email) {
            await client.post('/api/users/forgotpassword', { email });
            return { mode: 'email_link' };
        }

        throw lastError;
    }, []);

    const handleUpdatePassword = useCallback(async () => {
        const password = String(passwordRef.current || '').trim();
        const confirmPassword = String(confirmPasswordRef.current || '').trim();

        if (!password || !confirmPassword) {
            setStageError('Complete both password fields to continue.');
            return;
        }

        if (password.length < 6) {
            setStageError('Use at least 6 characters for password.');
            return;
        }

        if (password !== confirmPassword) {
            setStageError('Passwords do not match.');
            return;
        }

        setStageError('');
        setLoading(true);

        try {
            const result = await applyPasswordReset(password);
            if (result.mode === 'email_link') {
                setSuccessMessage('Verification complete. A secure reset link has been sent to your email.');
            } else {
                setSuccessMessage('Password updated successfully.');
            }
            updateStage('success');
        } catch (error) {
            const message = error?.response?.data?.message || 'Could not reset password right now.';
            setStageError(message);
        } finally {
            setLoading(false);
        }
    }, [applyPasswordReset, updateStage]);

    const stageTitle = useMemo(() => {
        if (stage === 'identity') return 'Reset your password';
        if (stage === 'otp') return 'Verify OTP';
        if (stage === 'password') return 'Set new password';
        return 'Reset complete';
    }, [stage]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.75}>
                    <Ionicons name="arrow-back" size={18} color="#334155" />
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <Text style={styles.title}>{stageTitle}</Text>

                <View style={styles.stageContainer}>
                    {(stage === 'identity' || stage === 'otp' || stage === 'password') ? (
                        <UnifiedIdentityInput
                            ref={identityRef}
                            editable={!loading && stage === 'identity'}
                            errorText={identityError}
                        />
                    ) : null}

                    {stage === 'identity' ? (
                        <TouchableOpacity
                            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                            onPress={handleSendOtp}
                            disabled={loading}
                            activeOpacity={0.9}
                        >
                            {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Send OTP</Text>}
                        </TouchableOpacity>
                    ) : null}

                    {stage === 'otp' ? (
                        <View style={styles.otpStage}>
                            <View style={styles.otpRow}>
                                {otpDigits.map((digit, index) => (
                                    <TextInput
                                        key={`otp-${index}`}
                                        ref={otpInputRefs.current[index]}
                                        style={styles.otpBox}
                                        keyboardType="number-pad"
                                        maxLength={1}
                                        value={digit}
                                        onChangeText={(text) => handleOtpDigitChange(text, index)}
                                        onKeyPress={(event) => handleOtpKeyPress(event, index)}
                                        textAlign="center"
                                        editable={!loading}
                                    />
                                ))}
                            </View>

                            <View style={styles.resendRow}>
                                <Text style={styles.resendText}>Didn&apos;t receive OTP?</Text>
                                <TouchableOpacity onPress={handleResendOtp} disabled={resendTimer > 0 || loading}>
                                    <Text style={styles.resendAction}>{resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}</Text>
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity
                                style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                                onPress={handleVerifyOtp}
                                disabled={loading}
                                activeOpacity={0.9}
                            >
                                {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Verify OTP</Text>}
                            </TouchableOpacity>
                        </View>
                    ) : null}

                    {stage === 'password' ? (
                        <View style={styles.passwordStage}>
                            <View style={styles.fieldGroup}>
                                <Text style={styles.fieldLabel}>New password</Text>
                                <View style={[styles.passwordShell, passwordFocused && styles.passwordShellFocused]}>
                                    <TextInput
                                        style={styles.passwordInput}
                                        placeholder="Enter new password"
                                        placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                        secureTextEntry={!showPassword}
                                        editable={!loading}
                                        onFocus={() => setPasswordFocused(true)}
                                        onBlur={() => setPasswordFocused(false)}
                                        onChangeText={(value) => {
                                            passwordRef.current = value;
                                            if (stageError) setStageError('');
                                        }}
                                    />
                                    <TouchableOpacity style={styles.eyeTap} onPress={() => setShowPassword((current) => !current)}>
                                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.fieldGroup}>
                                <Text style={styles.fieldLabel}>Confirm password</Text>
                                <View style={[styles.passwordShell, confirmFocused && styles.passwordShellFocused]}>
                                    <TextInput
                                        style={styles.passwordInput}
                                        placeholder="Confirm new password"
                                        placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                        secureTextEntry={!showConfirmPassword}
                                        editable={!loading}
                                        onFocus={() => setConfirmFocused(true)}
                                        onBlur={() => setConfirmFocused(false)}
                                        onChangeText={(value) => {
                                            confirmPasswordRef.current = value;
                                            if (stageError) setStageError('');
                                        }}
                                    />
                                    <TouchableOpacity style={styles.eyeTap} onPress={() => setShowConfirmPassword((current) => !current)}>
                                        <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <TouchableOpacity
                                style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                                onPress={handleUpdatePassword}
                                disabled={loading}
                                activeOpacity={0.9}
                            >
                                {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Update password</Text>}
                            </TouchableOpacity>
                        </View>
                    ) : null}

                    {stage === 'success' ? (
                        <View style={styles.successStage}>
                            <View style={styles.successBadge}>
                                <Ionicons name="checkmark" size={16} color="#ffffff" />
                            </View>
                            <Text style={styles.successText}>{successMessage}</Text>
                            <TouchableOpacity
                                style={styles.primaryButton}
                                onPress={() => navigation.navigate('Login')}
                                activeOpacity={0.9}
                            >
                                <Text style={styles.primaryButtonText}>Back to sign in</Text>
                            </TouchableOpacity>
                        </View>
                    ) : null}

                    {stageError ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{stageError}</Text>
                        </View>
                    ) : null}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f7fa',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
    },
    backBtn: {
        minHeight: 44,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 28,
    },
    backBtnText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 32,
        letterSpacing: -0.2,
    },
    stageContainer: {
        gap: 16,
    },
    otpStage: {
        gap: 16,
    },
    otpRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 8,
    },
    otpBox: {
        flex: 1,
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d1d9e4',
        backgroundColor: '#ffffff',
        fontSize: 18,
        fontWeight: '500',
        color: '#0f172a',
    },
    resendRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    resendText: {
        fontSize: 12,
        fontWeight: '400',
        color: '#64748b',
    },
    resendAction: {
        fontSize: 12,
        fontWeight: '500',
        color: '#1d4ed8',
    },
    passwordStage: {
        gap: 16,
    },
    fieldGroup: {
        gap: 6,
    },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
    },
    passwordShell: {
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d1d9e4',
        backgroundColor: '#ffffff',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 14,
        paddingRight: 10,
    },
    passwordShellFocused: {
        borderColor: '#1d4ed8',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 1,
    },
    passwordInput: {
        flex: 1,
        fontSize: 15,
        fontWeight: '400',
        color: '#0f172a',
        paddingVertical: 14,
    },
    eyeTap: {
        minWidth: 32,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    successStage: {
        gap: 16,
        alignItems: 'flex-start',
    },
    successBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#0f9d67',
        alignItems: 'center',
        justifyContent: 'center',
    },
    successText: {
        fontSize: 14,
        fontWeight: '400',
        color: '#475569',
        lineHeight: 20,
    },
    errorBox: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e8c7cb',
        backgroundColor: '#fcf3f4',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    errorText: {
        color: '#8f4b53',
        fontSize: 12,
        fontWeight: '400',
    },
    primaryButton: {
        minHeight: 52,
        borderRadius: 14,
        backgroundColor: '#1d4ed8',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    primaryButtonDisabled: {
        opacity: 0.72,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
});
