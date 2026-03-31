import React, { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
    ScrollView, StyleSheet, Text, TextInput,
    TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { logger } from '../utils/logger';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import { normalizeSelectedRole } from '../utils/authRoleSelection';
import { PALETTE, RADIUS, SPACING, SHADOWS } from '../theme/theme';

export default function ResetPasswordScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const token = route.params?.token;
    const selectedRole = (() => {
        const rawRole = String(route.params?.selectedRole || '').trim();
        return rawRole ? normalizeSelectedRole(rawRole) : null;
    })();

    const passwordRef = useRef('');
    const confirmPasswordRef = useRef('');

    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [confirmFocused, setConfirmFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleBackPress = useCallback(() => {
        handleAuthBackNavigation(navigation, { selectedRole, target: 'Login' });
    }, [navigation, selectedRole]);

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
            Alert.alert('Success', 'Password updated successfully.', [{
                text: 'Sign in',
                onPress: () => navigation.navigate(
                    'Login',
                    selectedRole ? { selectedRole } : undefined
                ),
            }]);
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
                    { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Back */}
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={22} color={PALETTE.textPrimary} />
                </TouchableOpacity>

                {/* Icon */}
                <View style={styles.iconSection}>
                    <View style={styles.iconWrap}>
                        <Ionicons name="shield-checkmark-outline" size={32} color={PALETTE.accent} />
                    </View>
                </View>

                {/* Title */}
                <Text style={styles.title}>Set new password</Text>
                <Text style={styles.subtitle}>Create a strong, unique password</Text>

                {/* Form */}
                <View style={styles.formBlock}>
                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>New password</Text>
                        <View style={[styles.passwordShell, passwordFocused && styles.shellFocused]}>
                            <TextInput
                                style={styles.passwordInput}
                                placeholder="Enter new password"
                                placeholderTextColor={PALETTE.textTertiary}
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
                            <TouchableOpacity
                                style={styles.eyeTap}
                                onPress={() => setShowPassword((c) => !c)}
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

                    <View style={styles.fieldGroup}>
                        <Text style={styles.fieldLabel}>Confirm password</Text>
                        <View style={[styles.passwordShell, confirmFocused && styles.shellFocused]}>
                            <TextInput
                                style={styles.passwordInput}
                                placeholder="Confirm new password"
                                placeholderTextColor={PALETTE.textTertiary}
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
                            <TouchableOpacity
                                style={styles.eyeTap}
                                onPress={() => setShowConfirmPassword((c) => !c)}
                                activeOpacity={0.7}
                            >
                                <Ionicons
                                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={20}
                                    color={PALETTE.textTertiary}
                                />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Error */}
                    {errorText ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle-outline" size={14} color={PALETTE.error} />
                            <Text style={styles.errorText}>{errorText}</Text>
                        </View>
                    ) : null}

                    {/* Submit */}
                    <TouchableOpacity
                        style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                        onPress={handleResetPassword}
                        disabled={loading}
                        activeOpacity={0.88}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Text style={styles.primaryBtnText}>Update password</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: PALETTE.background },
    scrollContent: { flexGrow: 1, paddingHorizontal: 24 },
    backBtn: {
        width: 44, height: 44,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-start', marginBottom: 16,
    },
    iconSection: { alignItems: 'center', marginBottom: 20 },
    iconWrap: {
        width: 72, height: 72, borderRadius: 36,
        backgroundColor: PALETTE.accentSoft,
        borderWidth: 1, borderColor: PALETTE.accentBorder,
        alignItems: 'center', justifyContent: 'center',
    },
    title: {
        fontSize: 26, fontWeight: '800',
        color: PALETTE.textPrimary, textAlign: 'center',
        letterSpacing: -0.5, marginBottom: 6,
    },
    subtitle: {
        fontSize: 14, fontWeight: '400',
        color: PALETTE.textSecondary, textAlign: 'center',
        marginBottom: 32,
    },
    formBlock: { gap: 18 },
    fieldGroup: { gap: 8 },
    fieldLabel: {
        fontSize: 14, fontWeight: '600', color: PALETTE.textPrimary,
    },
    passwordShell: {
        minHeight: 50, borderRadius: RADIUS.md,
        borderWidth: 1, borderColor: PALETTE.separator,
        backgroundColor: PALETTE.backgroundSoft,
        flexDirection: 'row', alignItems: 'center',
        paddingLeft: 14, paddingRight: 6,
    },
    shellFocused: {
        borderColor: PALETTE.accent,
        shadowColor: PALETTE.accent,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.10,
        shadowRadius: 8,
        elevation: 1,
    },
    passwordInput: {
        flex: 1, fontSize: 15, fontWeight: '400',
        color: PALETTE.textPrimary, paddingVertical: 14,
    },
    eyeTap: {
        width: 40, height: 40,
        alignItems: 'center', justifyContent: 'center',
    },
    errorBox: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderRadius: RADIUS.md, borderWidth: 1,
        borderColor: PALETTE.errorSoft,
        backgroundColor: PALETTE.errorSoft,
        paddingHorizontal: 14, paddingVertical: 12,
    },
    errorText: {
        color: PALETTE.error, fontSize: 13, fontWeight: '500', flex: 1,
    },
    primaryBtn: {
        minHeight: 52, borderRadius: RADIUS.full,
        backgroundColor: PALETTE.accent,
        alignItems: 'center', justifyContent: 'center',
        ...SHADOWS.accent,
    },
    primaryBtnDisabled: { opacity: 0.60 },
    primaryBtnText: {
        color: '#FFFFFF', fontSize: 16, fontWeight: '700',
    },
});
