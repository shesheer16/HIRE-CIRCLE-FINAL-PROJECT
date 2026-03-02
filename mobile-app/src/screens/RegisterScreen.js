import React, { useCallback, useRef, useState } from 'react';
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
import UnifiedIdentityInput from '../components/UnifiedIdentityInput';
import { navigateToWelcomeFallback } from '../utils/authNavigation';

const DEFAULT_ACQUISITION_SOURCE = 'organic';

export default function RegisterScreen({ navigation }) {
    const insets = useSafeAreaInsets();

    const identityRef = useRef(null);
    const nameInputRef = useRef(null);
    const passwordInputRef = useRef(null);
    const confirmPasswordInputRef = useRef(null);
    const nameRef = useRef('');
    const passwordRef = useRef('');
    const confirmPasswordRef = useRef('');

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [focusedField, setFocusedField] = useState('');
    const [identityError, setIdentityError] = useState('');
    const [formError, setFormError] = useState('');

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }

        navigateToWelcomeFallback(navigation);
    }, [navigation]);

    const handleIdentityDetection = useCallback(() => {
        if (identityError) setIdentityError('');
        if (formError) setFormError('');
    }, [formError, identityError]);

    const handleRegister = useCallback(async () => {
        const snapshot = identityRef.current?.getSnapshot?.();
        const name = String(nameRef.current || '').trim();
        const password = String(passwordRef.current || '').trim();
        const confirmPassword = String(confirmPasswordRef.current || '').trim();

        if (!name) {
            setFormError('Enter your full name to continue.');
            return;
        }

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
            setFormError('Create a password to continue.');
            return;
        }

        if (password.length < 6) {
            setFormError('Use at least 6 characters for password.');
            return;
        }

        if (password !== confirmPassword) {
            setFormError('Passwords do not match.');
            return;
        }

        setIdentityError('');
        setFormError('');
        setLoading(true);

        try {
            const registerPayload = {
                name,
                email: snapshot.backendEmail,
                phoneNumber: snapshot.type === 'phone' ? snapshot.phoneE164 : '',
                password,
                acquisitionSource: DEFAULT_ACQUISITION_SOURCE,
            };

            await client.post('/api/users/register', registerPayload);

            const otpIdentity = snapshot.type === 'phone'
                ? { kind: 'phone', value: snapshot.phoneE164, label: snapshot.raw }
                : { kind: 'email', value: snapshot.backendEmail, label: snapshot.backendEmail };
            const otpPayload = otpIdentity.kind === 'phone'
                ? { phone: otpIdentity.value }
                : { email: otpIdentity.value };

            let otpDispatchError = '';
            let initialOtpDispatched = true;
            try {
                await client.post('/api/auth/send-otp', otpPayload);
            } catch (otpError) {
                initialOtpDispatched = false;
                otpDispatchError = otpError?.response?.data?.message || otpError?.message || 'Could not send OTP right now. Try resend.';
            }

            navigation.replace('OTPVerification', {
                identity: otpIdentity,
                intent: 'signup',
                initialOtpDispatched,
                initialError: otpDispatchError || '',
            });
        } catch (error) {
            const message = error?.response?.data?.message || error?.message || 'Registration failed';
            setFormError(message);
            Alert.alert('Sign-up Failed', message);
        } finally {
            setLoading(false);
        }
    }, [navigation]);

    const navigateToLogin = useCallback(() => {
        navigation.navigate('Login');
    }, [navigation]);

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
                    <Text style={styles.title}>Create Your Account</Text>
                    <Text style={styles.subtitle}>Takes about 30 seconds. You can preview jobs right after OTP.</Text>
                    <View style={styles.speedHint}>
                        <Text style={styles.speedHintText}>Step 1 of 2</Text>
                    </View>
                </View>

                <View style={styles.formBlock}>
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Full name</Text>
                        <TextInput
                            ref={nameInputRef}
                            style={[styles.textField, focusedField === 'name' && styles.textFieldFocused]}
                            placeholder="Enter your full name"
                            placeholderTextColor="rgba(71, 85, 105, 0.6)"
                            autoCapitalize="words"
                            autoCorrect={false}
                            editable={!loading}
                            onChangeText={(value) => {
                                nameRef.current = value;
                                if (formError) setFormError('');
                            }}
                            onFocus={() => setFocusedField('name')}
                            onBlur={() => setFocusedField('')}
                            returnKeyType="next"
                            blurOnSubmit={false}
                            onSubmitEditing={() => identityRef.current?.focus?.()}
                        />
                    </View>

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
                            style={[styles.passwordShell, focusedField === 'password' && styles.passwordShellFocused]}
                            onPress={() => passwordInputRef.current?.focus()}
                        >
                            <TextInput
                                ref={passwordInputRef}
                                style={styles.passwordInput}
                                placeholder="Create a password"
                                placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(value) => {
                                    passwordRef.current = value;
                                    if (formError) setFormError('');
                                }}
                                onFocus={() => setFocusedField('password')}
                                onBlur={() => setFocusedField('')}
                                returnKeyType="next"
                                blurOnSubmit={false}
                                onSubmitEditing={() => confirmPasswordInputRef.current?.focus()}
                            />
                            <TouchableOpacity
                                style={styles.eyeTap}
                                onPress={() => setShowPassword((current) => !current)}
                                activeOpacity={0.8}
                            >
                                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
                            </TouchableOpacity>
                        </Pressable>
                    </View>

                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Confirm password</Text>
                        <Pressable
                            style={[styles.passwordShell, focusedField === 'confirm' && styles.passwordShellFocused]}
                            onPress={() => confirmPasswordInputRef.current?.focus()}
                        >
                            <TextInput
                                ref={confirmPasswordInputRef}
                                style={styles.passwordInput}
                                placeholder="Re-enter your password"
                                placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                secureTextEntry={!showConfirmPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(value) => {
                                    confirmPasswordRef.current = value;
                                    if (formError) setFormError('');
                                }}
                                onFocus={() => setFocusedField('confirm')}
                                onBlur={() => setFocusedField('')}
                                returnKeyType="done"
                                onSubmitEditing={handleRegister}
                            />
                            <TouchableOpacity
                                style={styles.eyeTap}
                                onPress={() => setShowConfirmPassword((current) => !current)}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={18}
                                    color="#64748b"
                                />
                            </TouchableOpacity>
                        </Pressable>
                    </View>

                    {formError ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{formError}</Text>
                        </View>
                    ) : null}

                    <TouchableOpacity
                        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                        onPress={handleRegister}
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
                    <Text style={styles.footerText}>Already have an account?</Text>
                    <TouchableOpacity style={styles.footerLinkTap} onPress={navigateToLogin} activeOpacity={0.8}>
                        <Text style={styles.footerLink}>Sign in</Text>
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
        lineHeight: 18,
        fontWeight: '500',
        maxWidth: 320,
    },
    speedHint: {
        marginTop: 10,
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#d7e2fb',
        backgroundColor: '#eef4ff',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    speedHintText: {
        color: '#1e40af',
        fontSize: 11,
        fontWeight: '700',
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
    textField: {
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d1d9e4',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        fontSize: 15,
        fontWeight: '400',
        color: '#0f172a',
    },
    textFieldFocused: {
        borderColor: '#1d4ed8',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 1,
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
