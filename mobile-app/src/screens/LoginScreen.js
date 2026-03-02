import React, { useCallback, useContext, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    Pressable,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import UnifiedIdentityInput from '../components/UnifiedIdentityInput';
import { navigateToWelcomeFallback } from '../utils/authNavigation';

export default function LoginScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);

    const identityRef = useRef(null);
    const passwordRef = useRef('');
    const passwordInputRef = useRef(null);

    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [identityError, setIdentityError] = useState('');
    const [formError, setFormError] = useState('');

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }

        navigateToWelcomeFallback(navigation);
    }, [navigation]);

    const handlePasswordChange = useCallback((value) => {
        passwordRef.current = value;
        if (formError) setFormError('');
    }, [formError]);

    const handleIdentityDetection = useCallback(() => {
        if (identityError) setIdentityError('');
        if (formError) setFormError('');
    }, [formError, identityError]);

    const handleLogin = useCallback(async () => {
        const snapshot = identityRef.current?.getSnapshot?.();
        const password = String(passwordRef.current || '').trim();

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

        if (!password) {
            setFormError('Enter your password to continue.');
            return;
        }

        setIdentityError('');
        setFormError('');
        setLoading(true);

        try {
            let data;

            try {
                const primaryPayload = {
                    email: snapshot.backendEmail,
                    password,
                };
                const primaryResponse = await client.post('/api/users/login', {
                    ...primaryPayload,
                });
                data = primaryResponse.data;
            } catch (primaryError) {
                const canTryAlternate = snapshot.type === 'phone'
                    && Boolean(snapshot.alternateBackendEmail)
                    && (primaryError?.response?.status === 401 || primaryError?.response?.status === 404);

                if (!canTryAlternate) {
                    throw primaryError;
                }

                const alternateResponse = await client.post('/api/users/login', {
                    email: snapshot.alternateBackendEmail,
                    password,
                });
                data = alternateResponse.data;
            }

            await login(data);
        } catch (error) {
            const requiresOtp = Boolean(error?.response?.data?.requiresOtpVerification);
            if (requiresOtp) {
                const identity = snapshot.type === 'phone'
                    ? { kind: 'phone', value: snapshot.phoneE164, label: snapshot.raw }
                    : { kind: 'email', value: snapshot.backendEmail, label: snapshot.backendEmail };
                const otpPayload = identity.kind === 'phone'
                    ? { phone: identity.value }
                    : { email: identity.value };

                let initialError = '';
                let initialOtpDispatched = true;
                try {
                    await client.post('/api/auth/send-otp', otpPayload);
                } catch (otpError) {
                    initialOtpDispatched = false;
                    initialError = otpError?.response?.data?.message || otpError?.message || 'Could not send OTP right now. Try resend.';
                }

                navigation.navigate('OTPVerification', {
                    identity,
                    intent: 'signin',
                    initialOtpDispatched,
                    initialError,
                });
                return;
            }

            const message = error?.response?.data?.message || 'We could not sign you in. Please verify your credentials.';
            setFormError(message);
            Alert.alert('Sign-In Failed', message);
        } finally {
            setLoading(false);
        }
    }, [login, navigation]);

    const navigateToRegister = useCallback(() => {
        navigation.navigate('Register');
    }, [navigation]);

    const navigateToForgot = useCallback(() => {
        navigation.navigate('ForgotPassword');
    }, [navigation]);

    const togglePasswordVisibility = useCallback(() => {
        setShowPassword((current) => !current);
    }, []);

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
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="none"
            >
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.75}>
                    <Ionicons name="arrow-back" size={18} color="#334155" />
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.headerBlock}>
                    <View style={styles.brandMark}>
                        <Ionicons name="sparkles-outline" size={14} color="#1d4ed8" />
                    </View>
                    <Text style={styles.title}>Sign in</Text>
                    <Text style={styles.subtitle}>Back in under 30 seconds.</Text>
                </View>

                <View style={styles.formBlock}>
                    <UnifiedIdentityInput
                        ref={identityRef}
                        editable={!loading}
                        errorText={identityError}
                        onDetectionChange={handleIdentityDetection}
                        inputProps={{
                            returnKeyType: 'next',
                            blurOnSubmit: false,
                            onSubmitEditing: () => passwordInputRef.current?.focus(),
                        }}
                    />

                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Password</Text>
                        <Pressable
                            style={[styles.passwordShell, passwordFocused && styles.passwordShellFocused]}
                            onPress={() => passwordInputRef.current?.focus()}
                        >
                            <TextInput
                                ref={passwordInputRef}
                                style={styles.passwordInput}
                                placeholder="Enter your password"
                                placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={handlePasswordChange}
                                onFocus={() => setPasswordFocused(true)}
                                onBlur={() => setPasswordFocused(false)}
                                returnKeyType="done"
                                onSubmitEditing={handleLogin}
                                blurOnSubmit={false}
                            />
                            <TouchableOpacity
                                style={styles.eyeTap}
                                onPress={togglePasswordVisibility}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={18}
                                    color="#64748b"
                                />
                            </TouchableOpacity>
                        </Pressable>
                    </View>

                    <TouchableOpacity style={styles.forgotTap} onPress={navigateToForgot} activeOpacity={0.8}>
                        <Text style={styles.forgotText}>Forgot password?</Text>
                    </TouchableOpacity>

                    {formError ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{formError}</Text>
                        </View>
                    ) : null}

                    <TouchableOpacity
                        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                        onPress={handleLogin}
                        disabled={loading}
                        activeOpacity={0.9}
                    >
                        {loading ? (
                            <ActivityIndicator color="#ffffff" />
                        ) : (
                            <Text style={styles.primaryButtonText}>Continue</Text>
                        )}
                    </TouchableOpacity>
                </View>

                <View style={styles.footerRow}>
                    <Text style={styles.footerText}>New to HIRE?</Text>
                    <TouchableOpacity style={styles.footerLinkTap} onPress={navigateToRegister} activeOpacity={0.8}>
                        <Text style={styles.footerLink}>Create account</Text>
                    </TouchableOpacity>
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
    headerBlock: {
        marginBottom: 32,
    },
    brandMark: {
        width: 28,
        height: 28,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: '#dbe3ec',
        backgroundColor: '#edf3ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        letterSpacing: -0.2,
    },
    subtitle: {
        marginTop: 6,
        color: '#64748b',
        fontSize: 13,
        fontWeight: '500',
    },
    formBlock: {
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
        color: '#0f172a',
        fontWeight: '400',
        paddingVertical: 14,
    },
    eyeTap: {
        minWidth: 32,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    forgotTap: {
        minHeight: 28,
        alignSelf: 'flex-start',
        justifyContent: 'center',
    },
    forgotText: {
        fontSize: 12,
        fontWeight: '400',
        color: '#475569',
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
    },
    primaryButtonDisabled: {
        opacity: 0.72,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
    footerRow: {
        marginTop: 32,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    footerText: {
        fontSize: 14,
        fontWeight: '400',
        color: '#64748b',
    },
    footerLinkTap: {
        minHeight: 44,
        justifyContent: 'center',
    },
    footerLink: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1d4ed8',
    },
});
