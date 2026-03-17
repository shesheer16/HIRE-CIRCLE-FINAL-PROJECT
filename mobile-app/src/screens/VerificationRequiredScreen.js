import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { handleAuthBackNavigation, navigateToAuthFallback } from '../utils/authNavigation';
import { normalizeSelectedRole } from '../utils/authRoleSelection';

export default function VerificationRequiredScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const { email } = route.params || {};
    const selectedRole = (() => {
        const rawRole = String(route.params?.selectedRole || '').trim();
        return rawRole ? normalizeSelectedRole(rawRole) : null;
    })();
    const [loading, setLoading] = useState(false);

    const handleResendVerification = async () => {
        if (!email) {
            Alert.alert('Missing Email', 'Email address not found. Please sign in again.');
            return;
        }

        setLoading(true);
        try {
            await client.post('/api/users/resendverification', { email });
            Alert.alert('Verification Sent', 'A new verification link has been sent to your email.');
        } catch (error) {
            const msg = error?.response?.data?.message || 'Could not resend verification email.';
            Alert.alert('Resend Failed', msg);
        } finally {
            setLoading(false);
        }
    };

    const handleBackToLogin = () => {
        navigateToAuthFallback(navigation, {
            selectedRole,
            target: 'Login',
        });
    };

    const handleBackPress = () => {
        handleAuthBackNavigation(navigation, {
            selectedRole,
            target: 'Login',
        });
    };

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

                <View style={styles.headerWrap}>
                    <View style={styles.iconWrap}>
                        <Ionicons name="mail-open-outline" size={20} color="#1d4ed8" />
                    </View>
                    <Text style={styles.title}>Verify your email</Text>
                    <Text style={styles.subtitle}>
                        Please verify your email address before accessing your workspace.
                    </Text>
                </View>

                <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleResendVerification}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="#ffffff" />
                    ) : (
                        <Text style={styles.primaryButtonText}>Resend verification email</Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryButton} onPress={handleBackToLogin}>
                    <Text style={styles.secondaryButtonText}>Back to sign in</Text>
                </TouchableOpacity>
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
    headerWrap: {
        marginBottom: 24,
    },
    iconWrap: {
        width: 36,
        height: 36,
        borderRadius: 12,
        borderColor: '#d6deea',
        borderWidth: 1,
        backgroundColor: '#edf3ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 10,
        letterSpacing: -0.2,
    },
    subtitle: {
        fontSize: 15,
        color: '#475569',
        marginBottom: 24,
        lineHeight: 22,
        fontWeight: '400',
    },
    primaryButton: {
        backgroundColor: '#1d4ed8',
        borderRadius: 14,
        minHeight: 52,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    primaryButtonText: {
        color: '#ffffff',
        fontWeight: '600',
        fontSize: 15,
    },
    secondaryButton: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    secondaryButtonText: {
        color: '#475569',
        fontSize: 14,
        fontWeight: '500',
    },
});
