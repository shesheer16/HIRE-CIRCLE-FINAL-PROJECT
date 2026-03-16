import React, { useCallback, useContext, useMemo, useState } from 'react';
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
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import {
    buildRoleAwareSessionPayload,
    getAuthAccountLabel,
    isQaRoleBootstrapEnabled,
    resolveSelectedRoleSession,
} from '../utils/authRoleSelection';
import { buildPreviewAuthSession, isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import { GLASS_GRADIENTS, GLASS_PALETTE, GLASS_SHADOWS, GLASS_SURFACES } from '../theme/glass';
import { handleAuthBackNavigation } from '../utils/authNavigation';

const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();
const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

export default function LoginScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);
    const selectedSession = useMemo(
        () => resolveSelectedRoleSession(route?.params?.selectedRole || 'worker'),
        [route?.params?.selectedRole]
    );
    const selectedRole = selectedSession.selectedRole;
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const subtitleText = useMemo(
        () => `Sign in to your ${accountLabel} account`,
        [accountLabel]
    );

    const canSubmit = authMode === 'phone'
        ? Boolean(String(phoneNumber || '').trim() && String(password || '').trim())
        : Boolean(String(email || '').trim() && String(password || '').trim());

    const handleBack = useCallback(() => {
        handleAuthBackNavigation(navigation, { target: 'RoleSelection' });
    }, [navigation]);

    const handleSubmit = useCallback(async () => {
        if (loading || !canSubmit) return;
        const safePassword = String(password || '').trim();
        const safeEmail = String(email || '').trim().toLowerCase();
        const safePhone = String(phoneNumber || '').trim();
        setLoading(true);
        try {
            let authPayload = null;

            if (QA_ROLE_BOOTSTRAP_ENABLED) {
                if (INSTANT_PREVIEW_AUTH_ENABLED) {
                    authPayload = buildPreviewAuthSession({
                        selectedRole,
                        email: authMode === 'email' ? safeEmail : '',
                        phoneNumber: authMode === 'phone' ? safePhone : '',
                        hasCompletedProfile: true,
                        profileComplete: true,
                    });
                } else {
                    try {
                        const { data } = await client.post('/api/auth/dev-bootstrap', {
                            role: selectedSession.requestedActiveRole,
                        }, {
                            __skipUnauthorizedHandler: true,
                            __skipApiErrorHandler: true,
                            __allowWhenCircuitOpen: true,
                            __maxRetries: 1,
                            timeout: 2500,
                        });
                        authPayload = data;
                    } catch (_bootstrapError) {
                        authPayload = buildPreviewAuthSession({
                            selectedRole,
                            email: authMode === 'email' ? safeEmail : '',
                            phoneNumber: authMode === 'phone' ? safePhone : '',
                            hasCompletedProfile: true,
                            profileComplete: true,
                        });
                    }
                }
            } else {
                if (authMode !== 'email') {
                    Alert.alert('Use email sign in', 'Phone sign in is not available in this build yet. Please switch to email.');
                    return;
                }

                const { data } = await client.post('/api/users/login', {
                    email: safeEmail,
                    password: safePassword,
                }, {
                    __skipUnauthorizedHandler: true,
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                });
                authPayload = data;
            }

            if (!authPayload?.token) {
                throw new Error('Missing session token');
            }

            const sessionPayload = QA_ROLE_BOOTSTRAP_ENABLED
                ? buildRoleAwareSessionPayload(authPayload, selectedRole, {
                    enforceRequestedRole: true,
                    email: authMode === 'email' ? safeEmail : authPayload?.email,
                    phoneNumber: authMode === 'phone' ? safePhone : authPayload?.phoneNumber,
                    hasCompletedProfile: Boolean(authPayload?.hasCompletedProfile ?? true),
                    profileComplete: Boolean(authPayload?.profileComplete ?? authPayload?.hasCompletedProfile ?? true),
                })
                : buildRoleAwareSessionPayload(authPayload, selectedRole, {
                    enforceRequestedRole: false,
                    email: authMode === 'email' ? safeEmail : authPayload?.email,
                    phoneNumber: authMode === 'phone' ? safePhone : authPayload?.phoneNumber,
                    hasCompletedProfile: Boolean(authPayload?.hasCompletedProfile),
                });

            await login(sessionPayload, { authEntryRole: selectedRole });
        } catch (error) {
            const backendMessage = String(error?.response?.data?.message || error?.message || '').trim();
            Alert.alert(
                'Sign in unavailable',
                backendMessage || 'Unable to continue right now. Please try again.'
            );
        } finally {
            setLoading(false);
        }
    }, [
        authMode,
        canSubmit,
        email,
        loading,
        login,
        password,
        phoneNumber,
        selectedRole,
        selectedSession.requestedActiveRole,
    ]);

    const openForgotPassword = useCallback(() => {
        navigation.navigate('ForgotPassword', { selectedRole });
    }, [navigation, selectedRole]);

    const openSignUp = useCallback(() => {
        navigation.navigate('Register', { selectedRole });
    }, [navigation, selectedRole]);

    return (
        <LinearGradient colors={GLASS_GRADIENTS.screen} style={styles.container}>
            <View style={styles.bgGlowTop} />
            <View style={styles.bgGlowMid} />
            <View style={styles.bgGlowBottom} />
            <KeyboardAvoidingView
                style={styles.keyboardShell}
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
                        <Ionicons name="chevron-back" size={18} color={GLASS_PALETTE.accentText} />
                        <Text style={styles.backBtnText}>Back</Text>
                    </TouchableOpacity>

                    <View style={styles.heroCard}>
                        <View style={styles.heroPill}>
                            <Ionicons name="sparkles-outline" size={14} color={GLASS_PALETTE.accentText} />
                            <Text style={styles.heroPillText}>{accountLabel} access</Text>
                        </View>
                        <Text style={styles.title}>Welcome back</Text>
                        <Text style={styles.subtitle}>{subtitleText}</Text>
                    </View>

                    <View style={styles.formCard}>
                        <View style={styles.segmentWrap}>
                            <TouchableOpacity
                                style={[styles.segmentButton, authMode === 'phone' && styles.segmentButtonActive]}
                                activeOpacity={0.9}
                                onPress={() => setAuthMode('phone')}
                            >
                                <Text style={[styles.segmentText, authMode === 'phone' && styles.segmentTextActive]}>PHONE</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.segmentButton, authMode === 'email' && styles.segmentButtonActive]}
                                activeOpacity={0.9}
                                onPress={() => setAuthMode('email')}
                            >
                                <Text style={[styles.segmentText, authMode === 'email' && styles.segmentTextActive]}>EMAIL</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.formBlock}>
                            {authMode === 'phone' ? (
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
                                            placeholderTextColor={GLASS_PALETTE.textSoft}
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
                                        placeholderTextColor={GLASS_PALETTE.textSoft}
                                    />
                                </View>
                            )}

                            <View>
                                <Text style={styles.fieldLabel}>PASSWORD</Text>
                                <TextInput
                                    style={styles.input}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry
                                    placeholder="••••••••"
                                    placeholderTextColor={GLASS_PALETTE.textSoft}
                                />
                            </View>

                            <TouchableOpacity style={styles.forgotTap} activeOpacity={0.8} onPress={openForgotPassword}>
                                <Text style={styles.forgotText}>Forgot password?</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.submitWrap, (!canSubmit || loading) && styles.submitWrapDisabled]}
                                activeOpacity={0.9}
                                onPress={handleSubmit}
                                disabled={!canSubmit || loading}
                            >
                                <LinearGradient
                                    colors={GLASS_GRADIENTS.accent}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={styles.submitGradient}
                                >
                                    {loading ? (
                                        <ActivityIndicator size="small" color="#ffffff" />
                                    ) : (
                                        <Text style={styles.submitText}>Sign In</Text>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.footerCard}>
                        <View style={styles.footerRow}>
                            <Text style={styles.footerText}>Don't have an account? </Text>
                            <TouchableOpacity activeOpacity={0.8} onPress={openSignUp}>
                                <Text style={styles.footerLink}>Sign Up</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    keyboardShell: {
        flex: 1,
    },
    bgGlowTop: {
        position: 'absolute',
        top: -120,
        left: -88,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: GLASS_PALETTE.glowLavender,
    },
    bgGlowMid: {
        position: 'absolute',
        top: '36%',
        right: -64,
        width: 210,
        height: 210,
        borderRadius: 105,
        backgroundColor: GLASS_PALETTE.glowBlue,
    },
    bgGlowBottom: {
        position: 'absolute',
        right: -84,
        bottom: -84,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: GLASS_PALETTE.glowRose,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
    },
    backBtn: {
        ...GLASS_SURFACES.softPanel,
        minHeight: 44,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        marginBottom: 22,
    },
    backBtnText: {
        fontSize: 13,
        lineHeight: 18,
        color: GLASS_PALETTE.accentText,
        fontWeight: '700',
    },
    heroCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        borderRadius: 28,
        paddingHorizontal: 20,
        paddingVertical: 22,
        marginBottom: 18,
    },
    heroPill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: GLASS_PALETTE.accentSoft,
        marginBottom: 14,
    },
    heroPillText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '700',
        color: GLASS_PALETTE.accentText,
    },
    title: {
        fontSize: 30,
        lineHeight: 34,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        letterSpacing: -0.5,
    },
    subtitle: {
        marginTop: 8,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
    },
    formCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        borderRadius: 26,
        padding: 18,
    },
    segmentWrap: {
        flexDirection: 'row',
        backgroundColor: 'rgba(235, 239, 255, 0.78)',
        borderRadius: 16,
        padding: 4,
    },
    segmentButton: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        borderRadius: 12,
    },
    segmentButtonActive: {
        backgroundColor: 'rgba(255,255,255,0.88)',
    },
    segmentText: {
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '700',
        color: GLASS_PALETTE.textMuted,
    },
    segmentTextActive: {
        color: GLASS_PALETTE.textStrong,
    },
    formBlock: {
        marginTop: 22,
        gap: 16,
    },
    fieldLabel: {
        marginBottom: 8,
        fontSize: 11,
        lineHeight: 14,
        fontWeight: '700',
        color: GLASS_PALETTE.textSoft,
        letterSpacing: 0.9,
    },
    phoneRow: {
        ...GLASS_SURFACES.input,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        minHeight: 54,
        overflow: 'hidden',
    },
    countryCodeWrap: {
        minWidth: 66,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        paddingVertical: 16,
        borderRightWidth: 1,
        borderRightColor: GLASS_PALETTE.borderStrong,
        backgroundColor: 'rgba(255,255,255,0.55)',
    },
    countryCodeText: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '700',
        color: GLASS_PALETTE.textMuted,
    },
    phoneInput: {
        flex: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: '500',
        color: GLASS_PALETTE.textStrong,
    },
    input: {
        ...GLASS_SURFACES.input,
        borderRadius: 14,
        minHeight: 54,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        lineHeight: 19,
        fontWeight: '500',
        color: GLASS_PALETTE.textStrong,
    },
    forgotTap: {
        alignSelf: 'flex-end',
        minHeight: 30,
        justifyContent: 'center',
    },
    forgotText: {
        fontSize: 13,
        lineHeight: 18,
        color: GLASS_PALETTE.accentText,
        fontWeight: '700',
    },
    submitWrap: {
        ...GLASS_SHADOWS.accent,
        marginTop: 8,
        borderRadius: 18,
        overflow: 'hidden',
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
    footerCard: {
        ...GLASS_SURFACES.softPanel,
        ...GLASS_SHADOWS.soft,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginTop: 18,
    },
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footerText: {
        fontSize: 12,
        lineHeight: 16,
        color: GLASS_PALETTE.textSoft,
        fontWeight: '600',
    },
    footerLink: {
        fontSize: 12,
        lineHeight: 16,
        color: GLASS_PALETTE.accentText,
        fontWeight: '800',
    },
});
