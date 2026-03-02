import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Alert,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { navigateToWelcomeFallback } from '../utils/authNavigation';
import CelebrationConfetti from '../components/CelebrationConfetti';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function OTPVerificationScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);
    const intent = useMemo(
        () => String(route.params?.intent || '').trim().toLowerCase(),
        [route.params?.intent],
    );
    const identity = useMemo(() => {
        const incoming = route.params?.identity || {};
        const kind = String(incoming.kind || (route.params?.phone ? 'phone' : 'email')).toLowerCase();
        const value = String(incoming.value || route.params?.phone || route.params?.phoneNumber || route.params?.email || '').trim();
        const label = String(incoming.label || value);
        return {
            kind: kind === 'phone' ? 'phone' : 'email',
            value,
            label,
        };
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
                if (current <= 1) {
                    clearTimer();
                    return 0;
                }
                return current - 1;
            });
        }, 1000);
    }, [clearTimer]);

    useEffect(() => {
        setErrorText(String(route.params?.initialError || '').trim());
        if (initialOtpDispatched) {
            startTimer();
        } else {
            clearTimer();
            setResendTimer(0);
        }
        return () => clearTimer();
    }, [clearTimer, initialOtpDispatched, route.params?.initialError, startTimer]);

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }

        navigateToWelcomeFallback(navigation);
    }, [navigation]);

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
                    toValue: 1,
                    stiffness: 200,
                    damping: 14,
                    mass: 0.8,
                    useNativeDriver: true,
                }),
                Animated.delay(220),
            ]).start(() => {
                setShowSuccess(false);
                onDone?.();
            });
        };

        try {
            const { data } = await client.post('/api/auth/verify-otp', {
                ...otpPayload,
                otp: otpCodeRef.current,
                intent: intent === 'signup' ? 'signup' : undefined,
            });

            if ((intent === 'signup' || intent === 'signin' || intent === 'login') && data?.token) {
                runSuccessTransition(() => {
                    login(data);
                });
                return;
            }

            runSuccessTransition(() => {
                Alert.alert('Verified', 'Verification complete.', [
                    { text: 'Continue', onPress: () => navigation.navigate('Login') },
                ]);
            });
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Invalid OTP. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [identity.value, intent, login, navigation, otpPayload, successScale]);

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
        } finally {
            setLoading(false);
        }
    }, [identity.value, loading, otpPayload, resendTimer, startTimer]);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <View style={[styles.content, { paddingTop: insets.top + 16 }]}> 
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.75}>
                    <Ionicons name="arrow-back" size={18} color="#334155" />
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <Text style={styles.title}>Enter OTP</Text>
                <Text style={styles.meta}>
                    {initialOtpDispatched
                        ? `We sent a 6-digit code to ${identity.label || 'your account'}.`
                        : `We could not send an OTP to ${identity.label || 'your account'}. Tap Resend OTP after fixing your email service.`}
                </Text>

                <View style={styles.otpRow}>
                    {otpDigits.map((digit, index) => (
                        <TextInput
                            key={`otp-box-${index}`}
                            ref={otpRefs.current[index]}
                            style={styles.otpBox}
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

                <View style={styles.resendRow}>
                    <Text style={styles.resendMeta}>Didn&apos;t receive OTP?</Text>
                    <TouchableOpacity onPress={resendOtp} disabled={loading || resendTimer > 0}>
                        <Text style={styles.resendAction}>{resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}</Text>
                    </TouchableOpacity>
                </View>

                {errorText ? (
                    <View style={styles.errorBox}>
                        <Text style={styles.errorText}>{errorText}</Text>
                    </View>
                ) : null}

                <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                    onPress={verifyOtp}
                    disabled={loading || showSuccess}
                    activeOpacity={0.9}
                >
                    {loading ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>Verify OTP</Text>}
                </TouchableOpacity>
            </View>

            {showSuccess ? (
                <View style={styles.successOverlay} pointerEvents="none">
                    <CelebrationConfetti visible={showSuccess} />
                    <Animated.View style={[styles.successCard, { transform: [{ scale: successScale }] }]}>
                        <Ionicons name="checkmark-circle" size={56} color="#22c55e" />
                        <Text style={styles.successTitle}>Verified</Text>
                        <Text style={styles.successSub}>Account secured. Launching your workspace...</Text>
                    </Animated.View>
                </View>
            ) : null}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f7fa',
    },
    content: {
        flex: 1,
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
        marginBottom: 8,
        letterSpacing: -0.2,
    },
    meta: {
        fontSize: 14,
        fontWeight: '400',
        color: '#64748b',
        marginBottom: 20,
    },
    otpRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
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
        marginBottom: 16,
    },
    resendMeta: {
        fontSize: 12,
        color: '#64748b',
        fontWeight: '400',
    },
    resendAction: {
        fontSize: 12,
        color: '#1d4ed8',
        fontWeight: '500',
    },
    errorBox: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e8c7cb',
        backgroundColor: '#fcf3f4',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 16,
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
    successOverlay: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15, 23, 42, 0.32)',
        zIndex: 12,
    },
    successCard: {
        minWidth: 250,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#dcfce7',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    successTitle: {
        marginTop: 10,
        color: '#166534',
        fontSize: 20,
        fontWeight: '800',
    },
    successSub: {
        marginTop: 6,
        color: '#334155',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
});
