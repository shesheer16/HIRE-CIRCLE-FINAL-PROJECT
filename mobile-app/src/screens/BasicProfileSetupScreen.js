import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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
import * as ImagePicker from 'expo-image-picker';
import { PALETTE, SHADOWS } from '../theme/theme';
import { GLASS_SURFACES } from '../theme/glass';
import { handleAuthBackNavigation } from '../utils/authNavigation';
import { getProfileSetupLabel, normalizeSelectedRole } from '../utils/authRoleSelection';

export default function BasicProfileSetupScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();

    // Extracted from RegisterScreen routing
    const {
        selectedRole,
        authMode,
        email,
        phoneNumber,
        password
    } = route?.params || {};

    const [fullName, setFullName] = useState('');
    const [bio, setBio] = useState('');
    const [avatarUri, setAvatarUri] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const canSubmit = String(fullName || '').trim().length > 0;
    const normalizedRole = normalizeSelectedRole(selectedRole || 'worker');
    const roleLabel = useMemo(
        () => `${getProfileSetupLabel(normalizedRole)} Setup`,
        [normalizedRole]
    );
    const isEmployerFacing = normalizedRole === 'employer' || normalizedRole === 'hybrid';
    const titleText = isEmployerFacing ? 'Set up your recruiter identity' : 'Build your profile';
    const subtitleText = isEmployerFacing
        ? 'Add the basics once so we can open your hiring workspace smoothly.'
        : 'Set your identity once, we handle the rest across the app.';
    const avatarTitle = isEmployerFacing ? 'Logo or Profile Photo' : 'Profile Picture';
    const avatarHint = isEmployerFacing
        ? 'Use a company logo or recruiter photo'
        : 'Add a photo so people recognize you';
    const nameLabel = isEmployerFacing ? 'Contact Name' : 'Full Name';
    const namePlaceholder = isEmployerFacing ? 'E.g. Priya Sharma' : 'E.g. John Doe';
    const bioLabel = isEmployerFacing ? 'Company Tagline' : 'About Me (Bio)';
    const bioPlaceholder = isEmployerFacing
        ? 'One short line about your company or hiring team...'
        : 'Write a short description about yourself...';
    const bioCount = String(bio || '').trim().length;

    const avatarFallback = 'https://ui-avatars.com/api/?name=User&background=e9ddff&color=4c1d95&rounded=true&size=256';

    const handleBack = useCallback(() => {
        handleAuthBackNavigation(navigation, {
            selectedRole: normalizedRole,
            target: 'Register',
        });
    }, [navigation, normalizedRole]);

    const pickAvatar = useCallback(async () => {
        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (permission?.status !== 'granted') {
                Alert.alert('Permission needed', 'Allow gallery access to choose profile photo.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.85,
            });
            if (result?.canceled) return;
            const uri = String(result?.assets?.[0]?.uri || '').trim();
            if (uri) setAvatarUri(uri);
        } catch (_error) {
            Alert.alert('Photo unavailable', 'Could not pick profile photo right now.');
        }
    }, []);

    const handleContinue = useCallback(() => {
        if (submitting || !canSubmit) return;
        setSubmitting(true);
        setTimeout(() => {
            setSubmitting(false);
            navigation.navigate('AccountSetupDetails', {
                selectedRole: normalizedRole,
                authMode,
                email,
                phoneNumber,
                password,
                name: String(fullName || '').trim(),
                bio: String(bio || '').trim(),
                avatarUri,
            });
        }, 300);
    }, [submitting, canSubmit, navigation, selectedRole, authMode, email, phoneNumber, password, fullName, bio, avatarUri]);

    return (
        <LinearGradient colors={[PALETTE.background, PALETTE.backgroundSoft, PALETTE.surface2]} style={styles.container}>
            <View style={styles.bgOrbTop} />
            <View style={styles.bgOrbMid} />
            <View style={styles.bgOrbBottom} />
            <KeyboardAvoidingView style={styles.keyboardShell} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 26 }]}
                >
                    <TouchableOpacity style={styles.backBtn} activeOpacity={0.82} onPress={handleBack}>
                        <Ionicons name="chevron-back" size={18} color={PALETTE.textPrimary} />
                        <Text style={styles.backText}>Back</Text>
                    </TouchableOpacity>

                <View style={styles.heroCard}>
                    <LinearGradient
                        colors={[PALETTE.accent, PALETTE.accentDeep]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.heroAccent}
                    />
                    <View style={styles.stepPill}>
                        <Ionicons name="sparkles-outline" size={14} color={PALETTE.accentDeep} />
                        <Text style={styles.stepPillText}>Step 1 of 2</Text>
                    </View>
                    <Text style={styles.title}>{titleText}</Text>
                    <Text style={styles.subtitle}>{subtitleText}</Text>
                    <View style={styles.roleChip}>
                        <Text style={styles.roleChipText}>{roleLabel}</Text>
                    </View>
                </View>

                <View style={styles.avatarSection}>
                    <View style={styles.avatarRing}>
                        <Image source={{ uri: avatarUri || avatarFallback }} style={styles.avatarImage} />
                        <TouchableOpacity style={styles.cameraFab} onPress={pickAvatar} activeOpacity={0.85}>
                            <Ionicons name="camera" size={17} color="#ffffff" />
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.avatarTitle}>{avatarTitle}</Text>
                    <Text style={styles.avatarHint}>{avatarHint}</Text>
                </View>

                <View style={styles.formCard}>
                    <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>{nameLabel}</Text>
                        <View style={styles.inputShell}>
                            <Ionicons name="person-outline" size={16} color={PALETTE.accent} style={styles.fieldIcon} />
                            <TextInput
                                value={fullName}
                                onChangeText={setFullName}
                                style={styles.input}
                                placeholder={namePlaceholder}
                                placeholderTextColor={PALETTE.textTertiary}
                                autoCapitalize="words"
                            />
                        </View>
                    </View>

                    <View style={[styles.fieldBlock, { marginTop: 18 }]}>
                        <View style={styles.labelRow}>
                            <Text style={styles.fieldLabel}>{bioLabel}</Text>
                            <Text style={styles.fieldMeta}>{bioCount}/180</Text>
                        </View>
                        <View style={[styles.inputShell, styles.inputShellMultiline]}>
                            <TextInput
                                value={bio}
                                onChangeText={setBio}
                                style={[styles.input, styles.inputMultiline]}
                                placeholder={bioPlaceholder}
                                placeholderTextColor={PALETTE.textTertiary}
                                multiline
                                textAlignVertical="top"
                                maxLength={180}
                            />
                        </View>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.submitWrap, (!canSubmit || submitting) && styles.submitWrapDisabled]}
                    activeOpacity={0.9}
                    onPress={handleContinue}
                    disabled={!canSubmit || submitting}
                >
                    <LinearGradient
                        colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.submitGradient}
                    >
                        {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>Continue</Text>}
                    </LinearGradient>
                </TouchableOpacity>
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
    bgOrbTop: {
        position: 'absolute',
        top: -120,
        right: -80,
        width: 260,
        height: 260,
        borderRadius: 130,
        backgroundColor: PALETTE.accentTint,
        opacity: 0.6,
    },
    bgOrbMid: {
        position: 'absolute',
        top: '38%',
        left: -66,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: PALETTE.accentSoft,
        opacity: 0.6,
    },
    bgOrbBottom: {
        position: 'absolute',
        left: -90,
        bottom: -120,
        width: 240,
        height: 240,
        borderRadius: 120,
        backgroundColor: PALETTE.accentSoft,
        opacity: 0.6,
    },
    content: {
        flexGrow: 1,
        paddingHorizontal: 18,
    },
    backBtn: {
        ...GLASS_SURFACES.softPanel,
        minHeight: 42,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        marginBottom: 8,
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        ...SHADOWS.sm,
    },
    backText: {
        color: PALETTE.textPrimary,
        fontSize: 13,
        fontWeight: '700',
    },
    heroCard: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        overflow: 'hidden',
        ...SHADOWS.md,
        marginTop: 4,
        marginBottom: 16,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    heroAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 6,
    },
    stepPill: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: PALETTE.accentTint,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.accentBorder,
        marginBottom: 10,
    },
    stepPillText: {
        color: PALETTE.accentDeep,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    title: {
        fontSize: 29,
        lineHeight: 33,
        fontWeight: '800',
        letterSpacing: -0.6,
        color: PALETTE.textPrimary,
    },
    subtitle: {
        marginTop: 4,
        color: PALETTE.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '600',
    },
    roleChip: {
        marginTop: 12,
        alignSelf: 'flex-start',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentTint,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    roleChipText: {
        color: PALETTE.accentDeep,
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    avatarSection: {
        marginTop: 4,
        alignItems: 'center',
        marginBottom: 20,
    },
    avatarRing: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        ...SHADOWS.md,
        width: 132,
        height: 132,
        borderRadius: 66,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    avatarImage: {
        width: 122,
        height: 122,
        borderRadius: 61,
    },
    cameraFab: {
        position: 'absolute',
        right: -4,
        bottom: 4,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: PALETTE.accentDeep,
        borderWidth: 2,
        borderColor: PALETTE.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarTitle: {
        marginTop: 10,
        color: PALETTE.textPrimary,
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    avatarHint: {
        marginTop: 2,
        color: PALETTE.textSecondary,
        fontSize: 13,
        fontWeight: '600',
    },
    formCard: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        ...SHADOWS.md,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 18,
    },
    fieldBlock: {
        marginTop: 0,
    },
    fieldLabel: {
        color: PALETTE.textSecondary,
        fontSize: 13,
        fontWeight: '800',
        marginBottom: 7,
        letterSpacing: 0.2,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    fieldMeta: {
        color: PALETTE.textTertiary,
        fontSize: 11,
        fontWeight: '700',
    },
    inputShell: {
        backgroundColor: PALETTE.surface2,
        borderWidth: 1,
        borderColor: PALETTE.border,
        minHeight: 50,
        borderRadius: 14,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    fieldIcon: {
        marginRight: 8,
    },
    inputShellMultiline: {
        minHeight: 120,
        alignItems: 'flex-start',
        paddingVertical: 12,
    },
    input: {
        flex: 1,
        color: PALETTE.textPrimary,
        fontSize: 14,
        fontWeight: '500',
        minHeight: 48,
    },
    inputMultiline: {
        minHeight: 90,
    },
    submitWrap: {
        ...SHADOWS.accent,
        marginTop: 24,
        borderRadius: 16,
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
        color: '#ffffff',
        fontSize: 16,
        lineHeight: 20,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
});
