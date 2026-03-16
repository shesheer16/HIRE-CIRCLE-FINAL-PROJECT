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
import { getAuthAccountLabel, normalizeSelectedRole } from '../utils/authRoleSelection';
import { GLASS_GRADIENTS, GLASS_PALETTE, GLASS_SHADOWS, GLASS_SURFACES } from '../theme/glass';

export default function RegisterScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const selectedRole = normalizeSelectedRole(route?.params?.selectedRole || 'worker');
    const accountLabel = useMemo(() => getAuthAccountLabel(selectedRole), [selectedRole]);

    const [authMode, setAuthMode] = useState('phone');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const subtitleText = useMemo(
        () => `Create your ${accountLabel} account`,
        [accountLabel]
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
        password,
        phoneNumber,
        navigation,
        selectedRole,
    ]);

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
                            <Text style={styles.heroPillText}>{accountLabel} setup</Text>
                        </View>
                        <Text style={styles.title}>Create Account</Text>
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
                                    placeholder="At least 6 characters"
                                    placeholderTextColor={GLASS_PALETTE.textSoft}
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
                                    placeholderTextColor={GLASS_PALETTE.textSoft}
                                />
                            </View>

                            <TouchableOpacity
                                style={[styles.submitWrap, (!canSubmit || loading) && styles.submitWrapDisabled]}
                                activeOpacity={0.9}
                                onPress={handleCreateAccount}
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
                                        <Text style={styles.submitText}>Create Account</Text>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.footerCard}>
                        <View style={styles.footerRow}>
                            <Text style={styles.footerText}>Already have an account? </Text>
                            <TouchableOpacity activeOpacity={0.8} onPress={openSignIn}>
                                <Text style={styles.footerLink}>Sign In</Text>
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
        top: '34%',
        right: -64,
        width: 220,
        height: 220,
        borderRadius: 110,
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
        minHeight: 46,
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
        marginTop: 20,
        gap: 14,
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
        minWidth: 64,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        paddingVertical: 14,
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
    submitWrap: {
        ...GLASS_SHADOWS.accent,
        marginTop: 10,
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
