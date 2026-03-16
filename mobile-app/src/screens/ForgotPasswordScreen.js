import React, { useCallback, useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import { normalizeSelectedRole } from '../utils/authRoleSelection';

export default function ForgotPasswordScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const selectedRole = normalizeSelectedRole(route?.params?.selectedRole || 'worker');
    const [stage, setStage] = useState('identity');
    const [identityMode, setIdentityMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const canSendOtp = useMemo(() => {
        if (identityMode === 'phone') return Boolean(String(phoneNumber || '').trim());
        return Boolean(String(email || '').trim());
    }, [email, identityMode, phoneNumber]);

    const canVerifyOtp = useMemo(() => String(otp || '').trim().length >= 4, [otp]);
    const canReset = useMemo(() => (
        Boolean(String(newPassword || '').trim())
        && Boolean(String(confirmPassword || '').trim())
    ), [confirmPassword, newPassword]);

    const handleBack = useCallback(() => {
        if (stage !== 'identity') {
            if (stage === 'verify') {
                setStage('identity');
                return;
            }
            if (stage === 'reset') {
                setStage('verify');
                return;
            }
            if (stage === 'success') {
                setStage('identity');
                return;
            }
        }
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        handleAuthBackNavigation(navigation, {
            selectedRole,
            target: 'Login',
        });
    }, [navigation, selectedRole, stage]);

    const sendOtp = useCallback(async () => {
        if (loading || !canSendOtp) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 400));
            setStage('verify');
        } finally {
            setLoading(false);
        }
    }, [canSendOtp, loading]);

    const verifyOtp = useCallback(async () => {
        if (loading || !canVerifyOtp) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 350));
            setStage('reset');
        } finally {
            setLoading(false);
        }
    }, [canVerifyOtp, loading]);

    const resendOtp = useCallback(async () => {
        if (loading) return;
        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 300));
            Alert.alert('OTP Sent', 'A new OTP has been sent.');
        } finally {
            setLoading(false);
        }
    }, [loading]);

    const resetPassword = useCallback(async () => {
        if (loading || !canReset) return;
        const safeNew = String(newPassword || '').trim();
        const safeConfirm = String(confirmPassword || '').trim();
        if (safeNew.length < 6) {
            Alert.alert('Invalid password', 'Password should be at least 6 characters.');
            return;
        }
        if (safeNew !== safeConfirm) {
            Alert.alert('Password mismatch', 'Password and confirm password should match.');
            return;
        }

        setLoading(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 450));
            setStage('success');
        } finally {
            setLoading(false);
        }
    }, [canReset, confirmPassword, loading, newPassword]);

    const goToLogin = useCallback(() => {
        navigation.navigate('Login', { selectedRole });
    }, [navigation, selectedRole]);

    const renderIdentityStage = () => (
        <>
            <View style={styles.segmentWrap}>
                <TouchableOpacity
                    style={[styles.segmentButton, identityMode === 'phone' && styles.segmentButtonActive]}
                    activeOpacity={0.9}
                    onPress={() => setIdentityMode('phone')}
                >
                    <Text style={[styles.segmentText, identityMode === 'phone' && styles.segmentTextActive]}>PHONE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.segmentButton, identityMode === 'email' && styles.segmentButtonActive]}
                    activeOpacity={0.9}
                    onPress={() => setIdentityMode('email')}
                >
                    <Text style={[styles.segmentText, identityMode === 'email' && styles.segmentTextActive]}>EMAIL</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.formBlock}>
                {identityMode === 'phone' ? (
                    <View>
                        <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
                        <View style={styles.phoneRow}>
                            <View style={styles.countryCodeWrap}>
                                <Text style={styles.countryCodeText}>+91</Text>
                            </View>
                            <TextInput
                                style={styles.phoneInput}
                                value={phoneNumber}
                                onChangeText={setPhoneNumber}
                                keyboardType="phone-pad"
                                placeholder="98765 43210"
                                placeholderTextColor="#94a3b8"
                                maxLength={15}
                            />
                        </View>
                    </View>
                ) : (
                    <View>
                        <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            placeholder="user@example.com"
                            placeholderTextColor="#94a3b8"
                        />
                    </View>
                )}

                <TouchableOpacity
                    style={[styles.submitWrap, (!canSendOtp || loading) && styles.submitWrapDisabled]}
                    activeOpacity={0.9}
                    onPress={sendOtp}
                    disabled={!canSendOtp || loading}
                >
                    <LinearGradient
                        colors={['#7c3aed', '#9333ea']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.submitGradient}
                    >
                        {loading ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                        ) : (
                            <Text style={styles.submitText}>Send OTP</Text>
                        )}
                    </LinearGradient>
                </TouchableOpacity>
            </View>
        </>
    );

    const renderVerifyStage = () => (
        <View style={styles.formBlock}>
            <View>
                <Text style={styles.fieldLabel}>ENTER OTP</Text>
                <TextInput
                    style={styles.input}
                    value={otp}
                    onChangeText={setOtp}
                    keyboardType="number-pad"
                    placeholder="4-6 digit OTP"
                    placeholderTextColor="#94a3b8"
                    maxLength={6}
                />
            </View>

            <TouchableOpacity
                style={[styles.submitWrap, (!canVerifyOtp || loading) && styles.submitWrapDisabled]}
                activeOpacity={0.9}
                onPress={verifyOtp}
                disabled={!canVerifyOtp || loading}
            >
                <LinearGradient
                    colors={['#7c3aed', '#9333ea']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.submitGradient}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text style={styles.submitText}>Verify OTP</Text>
                    )}
                </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.helperTap} onPress={resendOtp} activeOpacity={0.8} disabled={loading}>
                <Text style={styles.helperText}>Resend OTP</Text>
            </TouchableOpacity>
        </View>
    );

    const renderResetStage = () => (
        <View style={styles.formBlock}>
            <View>
                <Text style={styles.fieldLabel}>NEW PASSWORD</Text>
                <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    placeholder="At least 6 characters"
                    placeholderTextColor="#94a3b8"
                />
            </View>
            <View>
                <Text style={styles.fieldLabel}>CONFIRM PASSWORD</Text>
                <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="Re-enter password"
                    placeholderTextColor="#94a3b8"
                />
            </View>
            <TouchableOpacity
                style={[styles.submitWrap, (!canReset || loading) && styles.submitWrapDisabled]}
                activeOpacity={0.9}
                onPress={resetPassword}
                disabled={!canReset || loading}
            >
                <LinearGradient
                    colors={['#7c3aed', '#9333ea']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.submitGradient}
                >
                    {loading ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                        <Text style={styles.submitText}>Reset Password</Text>
                    )}
                </LinearGradient>
            </TouchableOpacity>
        </View>
    );

    const renderSuccessStage = () => (
        <View style={styles.successWrap}>
            <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={18} color="#ffffff" />
            </View>
            <Text style={styles.successTitle}>Password Updated</Text>
            <Text style={styles.successSubtitle}>You can sign in with your new password.</Text>
            <TouchableOpacity style={styles.successBtn} activeOpacity={0.9} onPress={goToLogin}>
                <Text style={styles.successBtnText}>Back to Sign In</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={[
                    styles.scrollContent,
                    { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 },
                ]}
            >
                <TouchableOpacity style={styles.backBtn} onPress={handleBack} activeOpacity={0.8}>
                    <Ionicons name="chevron-back" size={18} color="#94a3b8" />
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.headerBlock}>
                    <Text style={styles.title}>Forgot Password</Text>
                    <Text style={styles.subtitle}>
                        {stage === 'identity' && 'Recover access in a few quick steps.'}
                        {stage === 'verify' && 'Enter the OTP sent to your account.'}
                        {stage === 'reset' && 'Set a new password for your account.'}
                        {stage === 'success' && 'All set, you can sign in now.'}
                    </Text>
                </View>

                {stage === 'identity' && renderIdentityStage()}
                {stage === 'verify' && renderVerifyStage()}
                {stage === 'reset' && renderResetStage()}
                {stage === 'success' && renderSuccessStage()}

                {stage !== 'success' && (
                    <View style={styles.footerRow}>
                        <Text style={styles.footerText}>Remembered your password? </Text>
                        <TouchableOpacity activeOpacity={0.8} onPress={goToLogin}>
                            <Text style={styles.footerLink}>Sign In</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f4f5f7',
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
        gap: 4,
        marginBottom: 22,
    },
    backBtnText: {
        fontSize: 13,
        lineHeight: 18,
        color: '#94a3b8',
        fontWeight: '600',
    },
    headerBlock: {
        marginBottom: 18,
    },
    title: {
        fontSize: 27,
        lineHeight: 32,
        fontWeight: '800',
        color: '#0f172a',
        letterSpacing: -0.2,
    },
    subtitle: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
        color: '#64748b',
    },
    segmentWrap: {
        flexDirection: 'row',
        backgroundColor: '#e2e8f0',
        borderRadius: 14,
        padding: 4,
        marginTop: 6,
    },
    segmentButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 46,
        borderRadius: 10,
    },
    segmentButtonActive: {
        backgroundColor: '#ffffff',
    },
    segmentText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '700',
        color: '#64748b',
    },
    segmentTextActive: {
        color: '#0f172a',
    },
    formBlock: {
        marginTop: 20,
        gap: 14,
    },
    fieldLabel: {
        marginBottom: 8,
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '700',
        color: '#94a3b8',
        letterSpacing: 0.9,
    },
    phoneRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d5dee8',
        backgroundColor: '#f3f6f9',
        minHeight: 54,
        overflow: 'hidden',
    },
    countryCodeWrap: {
        minWidth: 64,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        paddingVertical: 14,
        borderRightWidth: 1,
        borderRightColor: '#d5dee8',
        backgroundColor: '#f8fafc',
    },
    countryCodeText: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '700',
        color: '#64748b',
    },
    phoneInput: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: '500',
        color: '#0f172a',
    },
    input: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d5dee8',
        backgroundColor: '#f3f6f9',
        minHeight: 54,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: '500',
        color: '#0f172a',
    },
    submitWrap: {
        marginTop: 10,
        borderRadius: 14,
        overflow: 'hidden',
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.22,
        shadowRadius: 10,
        elevation: 4,
    },
    submitWrapDisabled: {
        opacity: 0.55,
    },
    submitGradient: {
        minHeight: 54,
        alignItems: 'center',
        justifyContent: 'center',
    },
    submitText: {
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '800',
        color: '#ffffff',
    },
    helperTap: {
        alignSelf: 'center',
        minHeight: 30,
        justifyContent: 'center',
    },
    helperText: {
        fontSize: 12,
        lineHeight: 16,
        color: '#7c3aed',
        fontWeight: '700',
    },
    successWrap: {
        marginTop: 24,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f8f5ff',
        paddingHorizontal: 20,
        paddingVertical: 22,
        alignItems: 'center',
    },
    successIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#7c3aed',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    successTitle: {
        fontSize: 16,
        lineHeight: 20,
        fontWeight: '800',
        color: '#0f172a',
    },
    successSubtitle: {
        marginTop: 6,
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '500',
        color: '#64748b',
        textAlign: 'center',
    },
    successBtn: {
        marginTop: 14,
        minHeight: 44,
        paddingHorizontal: 16,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#7c3aed',
    },
    successBtnText: {
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '700',
        color: '#ffffff',
    },
    footerRow: {
        marginTop: 24,
        marginBottom: 8,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerText: {
        fontSize: 12,
        lineHeight: 16,
        color: '#94a3b8',
        fontWeight: '600',
    },
    footerLink: {
        fontSize: 12,
        lineHeight: 16,
        color: '#7c3aed',
        fontWeight: '700',
    },
});
