import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
    ActivityIndicator, Animated, Alert, KeyboardAvoidingView, Platform,
    StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import { normalizeSelectedRole } from '../utils/authRoleSelection';
import CelebrationConfetti from '../components/CelebrationConfetti';
import { PALETTE, RADIUS, SPACING, SHADOWS } from '../theme/theme';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function OTPVerificationScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);
    const selectedRole = useMemo(() => {
        const rawRole = String(route.params?.selectedRole || '').trim();
        return rawRole ? normalizeSelectedRole(rawRole) : null;
    }, [route.params?.selectedRole]);
    const intent = useMemo(
        () => String(route.params?.intent || '').trim().toLowerCase(),
        [route.params?.intent],
    );
    const identity = useMemo(() => {
        const incoming = route.params?.identity || {};
        const kind = String(incoming.kind || (route.params?.phone ? 'phone' : 'email')).toLowerCase();
        const value = String(incoming.value || route.params?.phone || route.params?.phoneNumber || route.params?.email || '').trim();
        const label = String(incoming.label || value);
        return { kind: kind === 'phone' ? 'phone' : 'email', value, label };
    }, [route.params]);
    const otpPayload = useMemo(() => (
        identity.kind === 'phone'
            ? { phone: identity.value }
            : { email: identity.value }
    ), [identity.kind, identity.value]);
    const initialOtpDispatched = useMemo(
        () => route.params?.initialOtpDispatched !== false,
        [route.params?.initialOtpDispatched],
    );

    const [otpDigits, setOtpDigits] = useState(Array(OTP_LENGTH).fill(''));
    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState('');
    const [resendTimer, setResendTimer] = useState(0);
    const [showSuccess, setShowSuccess] = useState(false);

    const otpRefs = useRef(Array.from({ length: OTP_LENGTH }, () => React.createRef()));
    const otpCodeRef = useRef('');
    const intervalRef = useRef(null);
    const successScale = useRef(new Animated.Value(0.9)).current;

    const clearTimer = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const startTimer = useCallback(() => {
        clearTimer();
        setResendTimer(RESEND_COOLDOWN_SECONDS);
        intervalRef.current = setInterval(() => {
            setResendTimer((current) => {
                if (current <= 1) { clearTimer(); return 0; }
                return current - 1;
            });
        }, 1000);
    }, [clearTimer]);

    useEffect(() => {
        setErrorText(String(route.params?.initialError || '').trim());
        if (initialOtpDispatched) { startTimer(); }
        else { clearTimer(); setResendTimer(0); }
        return () => clearTimer();
    }, [clearTimer, initialOtpDispatched, route.params?.initialError, startTimer]);

    const handleBackPress = useCallback(() => {
        handleAuthBackNavigation(navigation, { selectedRole, target: 'Login' });
    }, [navigation, selectedRole]);

    const handleOtpChange = useCallback((text, index) => {
        const digit = String(text || '').replace(/\D/g, '').slice(-1);
        setErrorText('');
        setOtpDigits((current) => {
            const next = [...current];
            next[index] = digit;
            otpCodeRef.current = next.join('');
            return next;
        });
        if (digit && index < OTP_LENGTH - 1) {
            otpRefs.current[index + 1]?.current?.focus();
        }
    }, []);

    const handleOtpKeyPress = useCallback((event, index) => {
        if (event.nativeEvent.key === 'Backspace' && !otpDigits[index] && index > 0) {
            otpRefs.current[index - 1]?.current?.focus();
        }
    }, [otpDigits]);

    const verifyOtp = useCallback(async () => {
        if (otpCodeRef.current.length < OTP_LENGTH) {
            setErrorText('Enter all 6 digits to continue.');
            return;
        }
        if (!identity.value) {
            setErrorText('Missing account identity for verification.');
            return;
        }
        setErrorText('');
        setLoading(true);

        const runSuccessTransition = (onDone) => {
            setShowSuccess(true);
            successScale.setValue(0.9);
            Animated.sequence([
                Animated.spring(successScale, {
                    toValue: 1, stiffness: 200, damping: 14, mass: 0.8,
                    useNativeDriver: true,
                }),
                Animated.delay(220),
            ]).start(() => { setShowSuccess(false); onDone?.(); });
        };

        try {
            const { data } = await client.post('/api/auth/verify-otp', {
                ...otpPayload,
                otp: otpCodeRef.current,
                intent: intent === 'signup' ? 'signup' : undefined,
            });
            if ((intent === 'signup' || intent === 'signin' || intent === 'login') && data?.token) {
                // If we also got an avatar URI from registration step 1, upload it now
                // BEFORE committing the new login state
                let resolvedAvatarUrl = null;
                const avatarUri = String(route.params?.avatarUri || '').trim();
                
                if (avatarUri && data.token) {
                    try {
                        const formData = new FormData();
                        const ext = avatarUri.split('.').pop()?.toLowerCase() || 'jpg';
                        const mimeType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
                        
                        const cloudName = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME || 'YOUR_CLOUD_NAME';
                        const uploadPreset = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'YOUR_UPLOAD_PRESET';
                        const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

                        formData.append('file', {
                            uri: avatarUri,
                            name: `avatar-${Date.now()}.${ext}`,
                            type: mimeType
                        });

                        formData.append('upload_preset', uploadPreset);

                        const uploadRes = await axios.post(cloudinaryUrl, formData, {
                            headers: {
                                'Content-Type': 'multipart/form-data',
                            },
                        });
                        
                        resolvedAvatarUrl = String(uploadRes?.data?.secure_url || '').trim() || null;
                    } catch (_uploadErr) {
                        // Silently swallow avatar upload failures so we don't break the whole registration
                        console.warn('Post-OTP Avatar Upload Failed:', _uploadErr);
                    }
                }

                // Inject the returned absolute storage URL into the local payload before giving it to login()
                if (resolvedAvatarUrl) {
                    data.avatar = resolvedAvatarUrl;
                    data.logoUrl = resolvedAvatarUrl;
                    try {
                        await client.post('/api/settings/avatar-url', { avatarUrl: resolvedAvatarUrl, role: selectedRole }, {
                            headers: { Authorization: `Bearer ${data.token}` }
                        });
                    } catch (syncErr) {
                        console.warn('Backend sync for avatar failed:', syncErr);
                    }
                }

                runSuccessTransition(() => {
                    login(data, selectedRole ? { authEntryRole: selectedRole } : undefined);
                });
                return;
            }
            runSuccessTransition(() => {
                Alert.alert('Verified', 'Verification complete.', [{
                    text: 'Continue',
                    onPress: () => navigation.navigate('Login', selectedRole ? { selectedRole } : undefined),
                }]);
            });
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Invalid OTP. Please try again.');
        } finally { setLoading(false); }
    }, [identity.value, intent, login, navigation, otpPayload, selectedRole, successScale, route.params?.avatarUri]);

    const resendOtp = useCallback(async () => {
        if (loading || resendTimer > 0 || !identity.value) return;
        setLoading(true);
        setErrorText('');
        try {
            await client.post('/api/auth/send-otp', otpPayload);
            setOtpDigits(Array(OTP_LENGTH).fill(''));
            otpCodeRef.current = '';
            startTimer();
            otpRefs.current[0]?.current?.focus();
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Could not resend OTP.');
        } finally { setLoading(false); }
    }, [identity.value, loading, otpPayload, resendTimer, startTimer]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <View style={[styles.content, { paddingTop: insets.top + 12 }]}>
                {/* Back */}
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={22} color={PALETTE.textPrimary} />
                </TouchableOpacity>

                {/* Icon */}
                <View style={styles.iconSection}>
                    <View style={styles.iconWrap}>
                        <Ionicons name="keypad-outline" size={32} color={PALETTE.accent} />
                    </View>
                </View>

                {/* Title */}
                <Text style={styles.title}>Enter OTP</Text>
                <Text style={styles.meta}>
                    {initialOtpDispatched
                        ? `We sent a 6-digit code to ${identity.label || 'your account'}.`
                        : `We could not send an OTP to ${identity.label || 'your account'}. Tap Resend OTP after fixing your email service.`}
                </Text>

                {/* OTP boxes */}
                <View style={styles.otpRow}>
                    {otpDigits.map((digit, index) => (
                        <TextInput
                            key={`otp-box-${index}`}
                            ref={otpRefs.current[index]}
                            style={[styles.otpBox, digit && styles.otpBoxFilled]}
                            keyboardType="number-pad"
                            maxLength={1}
                            value={digit}
                            onChangeText={(text) => handleOtpChange(text, index)}
                            onKeyPress={(event) => handleOtpKeyPress(event, index)}
                            textAlign="center"
                            editable={!loading}
                        />
                    ))}
                </View>

                {/* Resend row */}
                <View style={styles.resendRow}>
                    <Text style={styles.resendMeta}>Didn't receive OTP?</Text>
                    <TouchableOpacity onPress={resendOtp} disabled={loading || resendTimer > 0} activeOpacity={0.7}>
                        <Text style={[styles.resendAction, (resendTimer > 0) && styles.resendActionDisabled]}>
                            {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Error */}
                {errorText ? (
                    <View style={styles.errorBox}>
                        <Ionicons name="alert-circle-outline" size={14} color={PALETTE.error} />
                        <Text style={styles.errorText}>{errorText}</Text>
                    </View>
                ) : null}

                {/* Verify button */}
                <TouchableOpacity
                    style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
                    onPress={verifyOtp}
                    disabled={loading || showSuccess}
                    activeOpacity={0.88}
                >
                    {loading ? (
                        <ActivityIndicator color="#FFFFFF" />
                    ) : (
                        <Text style={styles.primaryBtnText}>Verify OTP</Text>
                    )}
                </TouchableOpacity>
            </View>

            {/* Success overlay */}
            {showSuccess ? (
                <View style={styles.successOverlay} pointerEvents="none">
                    <CelebrationConfetti visible={showSuccess} />
                    <Animated.View style={[styles.successCard, { transform: [{ scale: successScale }] }]}>
                        <View style={styles.successCheckWrap}>
                            <Ionicons name="checkmark" size={32} color="#FFFFFF" />
                        </View>
                        <Text style={styles.successTitle}>Verified</Text>
                        <Text style={styles.successSub}>Account secured. Launching your workspace...</Text>
                    </Animated.View>
                </View>
            ) : null}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: PALETTE.background },
    content: { flex: 1, paddingHorizontal: 24 },
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
        letterSpacing: -0.5, marginBottom: 8,
    },
    meta: {
        fontSize: 14, fontWeight: '400',
        color: PALETTE.textSecondary, textAlign: 'center',
        marginBottom: 28, lineHeight: 20,
    },
    otpRow: {
        flexDirection: 'row', gap: 10, marginBottom: 20,
    },
    otpBox: {
        flex: 1, minHeight: 56, borderRadius: RADIUS.md,
        borderWidth: 1.5, borderColor: PALETTE.separator,
        backgroundColor: PALETTE.backgroundSoft,
        fontSize: 22, fontWeight: '700',
        color: PALETTE.textPrimary,
    },
    otpBoxFilled: {
        borderColor: PALETTE.accent,
        backgroundColor: PALETTE.accentTint,
    },
    resendRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 20,
    },
    resendMeta: {
        fontSize: 13, color: PALETTE.textSecondary, fontWeight: '400',
    },
    resendAction: {
        fontSize: 13, color: PALETTE.accentDeep, fontWeight: '700',
    },
    resendActionDisabled: {
        color: PALETTE.textTertiary,
    },
    errorBox: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        borderRadius: RADIUS.md, borderWidth: 1,
        borderColor: PALETTE.errorSoft,
        backgroundColor: PALETTE.errorSoft,
        paddingHorizontal: 14, paddingVertical: 12,
        marginBottom: 20,
    },
    errorText: {
        color: PALETTE.error, fontSize: 13, fontWeight: '500',
        flex: 1,
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
    successOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: PALETTE.overlay, zIndex: 12,
    },
    successCard: {
        minWidth: 260, borderRadius: RADIUS.xl,
        backgroundColor: PALETTE.surface,
        borderWidth: 1, borderColor: PALETTE.separator,
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 24, paddingVertical: 28,
        ...SHADOWS.lg,
    },
    successCheckWrap: {
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: PALETTE.success,
        alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
    },
    successTitle: {
        color: PALETTE.textPrimary, fontSize: 22, fontWeight: '800',
    },
    successSub: {
        marginTop: 6, color: PALETTE.textSecondary,
        fontSize: 13, fontWeight: '500', textAlign: 'center',
    },
});
