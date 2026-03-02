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
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { logger } from '../utils/logger';
import { navigateToWelcomeFallback } from '../utils/authNavigation';

export default function ResetPasswordScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const token = route.params?.token;

    const passwordRef = useRef('');
    const confirmPasswordRef = useRef('');

    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [confirmFocused, setConfirmFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }

        navigateToWelcomeFallback(navigation);
    }, [navigation]);

    const handleResetPassword = useCallback(async () => {
        const password = String(passwordRef.current || '').trim();
        const confirmPassword = String(confirmPasswordRef.current || '').trim();

        if (!password || !confirmPassword) {
            setErrorText('Complete both fields to continue.');
            return;
        }

        if (password.length < 6) {
            setErrorText('Use at least 6 characters for password.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorText('Passwords do not match.');
            return;
        }

        if (!token) {
            Alert.alert('Invalid link', 'This reset link is missing or expired.');
            return;
        }

        setErrorText('');
        setLoading(true);

        try {
            await client.put(`/api/users/resetpassword/${token}`, { password });
            Alert.alert('Success', 'Password updated successfully.', [
                { text: 'Sign in', onPress: () => navigation.navigate('Login') },
            ]);
        } catch (error) {
            logger.error('Reset password failed:', error);
            const message = error?.response?.data?.message || 'Could not reset password right now.';
            setErrorText(message);
            Alert.alert('Reset Failed', message);
        } finally {
            setLoading(false);
        }
    }, [navigation, token]);

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

                <Text style={styles.title}>Set new password</Text>

                <View style={styles.formBlock}>
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>New password</Text>
                        <View style={[styles.passwordShell, passwordFocused && styles.passwordShellFocused]}>
                            <TextInput
                                style={styles.passwordInput}
                                placeholder="Enter new password"
                                placeholderTextColor="rgba(71, 85, 105, 0.6)"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(value) => {
                                    passwordRef.current = value;
                                    if (errorText) setErrorText('');
                                }}
                                onFocus={() => setPasswordFocused(true)}
                                onBlur={() => setPasswordFocused(false)}
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
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!loading}
                                onChangeText={(value) => {
                                    confirmPasswordRef.current = value;
                                    if (errorText) setErrorText('');
                                }}
                                onFocus={() => setConfirmFocused(true)}
                                onBlur={() => setConfirmFocused(false)}
                            />
                            <TouchableOpacity style={styles.eyeTap} onPress={() => setShowConfirmPassword((current) => !current)}>
                                <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#64748b" />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {errorText ? (
                        <View style={styles.errorBox}>
                            <Text style={styles.errorText}>{errorText}</Text>
                        </View>
                    ) : null}

                    <TouchableOpacity
                        style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                        onPress={handleResetPassword}
                        disabled={loading}
                        activeOpacity={0.9}
                    >
                        {loading ? (
                            <ActivityIndicator color="#ffffff" />
                        ) : (
                            <Text style={styles.primaryButtonText}>Update password</Text>
                        )}
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
    title: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 32,
        letterSpacing: -0.2,
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
});
