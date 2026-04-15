import React, { useCallback, useContext, useMemo, useState } from 'react';
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
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { PALETTE, SHADOWS } from '../theme/theme';
import { buildPreviewAuthSession, isInstantPreviewAuthEnabled } from '../utils/previewAuthSession';
import {
    buildRoleAwareSessionPayload,
    getProfileSetupLabel,
    isQaRoleBootstrapEnabled,
    resolveSelectedRoleSession,
} from '../utils/authRoleSelection';
import { handleAuthBackNavigation } from '../utils/authNavigation';

const QA_ROLE_BOOTSTRAP_ENABLED = isQaRoleBootstrapEnabled();
const INSTANT_PREVIEW_AUTH_ENABLED = isInstantPreviewAuthEnabled();

const FUNCTIONAL_AREA_OPTIONS = [
    'Customer Support',
    'Sales',
    'Operations',
    'HR / Recruiter',
    'Engineering',
    'Design',
    'Marketing',
    'Finance',
    'Warehouse / Logistics',
    'Admin',
];
const EMPLOYER_INDUSTRY_OPTIONS = [
    'Logistics',
    'Retail',
    'Hospitality',
    'Healthcare',
    'Technology',
    'Finance',
    'Staffing',
    'Manufacturing',
    'Construction',
];
const CITY_OPTIONS = [
    'Bengaluru',
    'Hyderabad',
    'Chennai',
    'Mumbai',
    'Pune',
    'Delhi NCR',
    'Kolkata',
    'Remote',
];
const SALARY_OPTIONS = [
    'INR 0 - 5 LPA',
    'INR 5 - 8 LPA',
    'INR 8 - 12 LPA',
    'INR 12 - 20 LPA',
    'INR 20+ LPA',
];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];

const estimateMonthlyAmountFromBand = (value = '') => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)/g)].map((entry) => Number(entry[1]));
    if (!matches.length) return '';
    const numeric = matches.length >= 2
        ? (matches[0] + matches[1]) / 2
        : matches[0];
    const annual = raw.includes('lpa') ? numeric * 100000 : numeric;
    const monthly = Math.round(annual / 12);
    return Number.isFinite(monthly) && monthly > 0 ? String(monthly) : '';
};

const inferWorkerRoleCategoryFromSetupArea = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized.includes('customer') || normalized.includes('support')) return 'Support / Service';
    if (normalized.includes('sales') || normalized.includes('marketing')) return 'Sales / Marketing';
    if (normalized.includes('engineering') || normalized.includes('design')) return 'Software / Tech';
    if (normalized.includes('finance') || normalized.includes('admin') || normalized.includes('hr')) return 'Finance / Admin';
    if (normalized.includes('warehouse') || normalized.includes('logistics') || normalized.includes('operations')) return 'Delivery / Logistics';
    return '';
};

const splitName = (fullName = '') => {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
        return { firstName: '', lastName: '' };
    }
    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' '),
    };
};

const buildSuggestions = (query = '', options = [], limit = 6) => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const safeOptions = Array.isArray(options) ? options.filter(Boolean) : [];
    if (!normalizedQuery) return safeOptions.slice(0, limit);
    const startsWith = safeOptions.filter((item) => String(item).toLowerCase().startsWith(normalizedQuery));
    const contains = safeOptions.filter((item) => (
        String(item).toLowerCase().includes(normalizedQuery) && !startsWith.includes(item)
    ));
    return [...startsWith, ...contains].slice(0, limit);
};

function TypeaheadField({
    label,
    value,
    onChangeText,
    placeholder,
    suggestions,
    onSelectSuggestion,
    keyboardType = 'default',
    autoCapitalize = 'words',
}) {
    const [isFocused, setIsFocused] = useState(false);
    const safeSuggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
    return (
        <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={[styles.inputShell, isFocused && styles.inputShellFocused]}>
                <TextInput
                    value={value}
                    onChangeText={onChangeText}
                    style={styles.input}
                    placeholder={placeholder}
                    placeholderTextColor={PALETTE.textTertiary}
                    keyboardType={keyboardType}
                    autoCapitalize={autoCapitalize}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setTimeout(() => setIsFocused(false), 120)}
                />
                <Ionicons name={isFocused ? 'chevron-up' : 'chevron-down'} size={16} color={PALETTE.accentDeep} />
            </View>

            {isFocused && safeSuggestions.length > 0 ? (
                <View style={styles.suggestionPanel}>
                    {safeSuggestions.map((item) => (
                        <TouchableOpacity
                            key={`${label}-${item}`}
                            activeOpacity={0.82}
                            style={styles.suggestionRow}
                            onPress={() => {
                                onSelectSuggestion?.(item);
                                setIsFocused(false);
                            }}
                        >
                            <Text style={styles.suggestionText}>{item}</Text>
                            <Ionicons name="arrow-forward" size={14} color={PALETTE.accentDeep} />
                        </TouchableOpacity>
                    ))}
                </View>
            ) : null}
        </View>
    );
}

export default function AccountSetupDetailsScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const { login } = useContext(AuthContext);
    const selectedSession = useMemo(
        () => resolveSelectedRoleSession(route?.params?.selectedRole || 'worker'),
        [route?.params?.selectedRole]
    );
    const selectedRole = selectedSession.selectedRole;
    const authMode = String(route?.params?.authMode || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';

    const seedName = String(route?.params?.name || '').trim();
    const nameParts = splitName(seedName);
    const bio = String(route?.params?.bio || '').trim();
    const avatarUri = String(route?.params?.avatarUri || '').trim();

    const [email, setEmail] = useState(String(route?.params?.email || '').trim());
    const [phoneNumber, setPhoneNumber] = useState(String(route?.params?.phoneNumber || '').trim());
    const [password, setPassword] = useState(String(route?.params?.password || '').trim());
    const [dateOfBirth, setDateOfBirth] = useState('');
    const [gender, setGender] = useState('Male');
    const [companyName, setCompanyName] = useState('');
    const [functionalArea, setFunctionalArea] = useState('');
    const [preferredCity, setPreferredCity] = useState('');
    const [expectedSalary, setExpectedSalary] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const roleLabel = `${getProfileSetupLabel(selectedRole)} Account`;
    const avatarFallback = `https://ui-avatars.com/api/?name=${encodeURIComponent(seedName || 'User')}&background=e9ddff&color=4c1d95&rounded=true&size=256`;
    const isEmployerSetup = selectedSession.requestedActiveRole === 'employer';
    const preferenceSectionTitle = isEmployerSetup ? 'Hiring Details' : 'Job Preference';
    const functionalAreaLabel = isEmployerSetup ? 'Industry' : 'Functional Areas';
    const functionalAreaPlaceholder = isEmployerSetup ? 'Select industry' : 'Select job title / role';
    const cityLabel = isEmployerSetup ? 'Primary Hiring City' : 'Preferred City';
    const salaryLabel = 'Expected Salary';
    const salaryPlaceholder = 'INR 0 - 5 LPA';
    const personalSectionTitle = isEmployerSetup ? 'Recruiter Basics' : 'Account Details';

    const functionalAreaOptions = isEmployerSetup ? EMPLOYER_INDUSTRY_OPTIONS : FUNCTIONAL_AREA_OPTIONS;
    const functionalSuggestions = useMemo(
        () => buildSuggestions(functionalArea, functionalAreaOptions),
        [functionalArea, functionalAreaOptions]
    );
    const citySuggestions = useMemo(
        () => buildSuggestions(preferredCity, CITY_OPTIONS),
        [preferredCity]
    );
    const salarySuggestions = useMemo(
        () => buildSuggestions(expectedSalary, SALARY_OPTIONS),
        [expectedSalary]
    );
    const topFunctionalPicks = useMemo(
        () => buildSuggestions(functionalArea, functionalAreaOptions, 4),
        [functionalArea, functionalAreaOptions]
    );
    const topCityPicks = useMemo(
        () => buildSuggestions(preferredCity, CITY_OPTIONS, 4),
        [preferredCity]
    );
    const topSalaryPicks = useMemo(
        () => buildSuggestions(expectedSalary, SALARY_OPTIONS, 4),
        [expectedSalary]
    );



    const canSubmit = useMemo(() => {
        if (!String(password || '').trim()) return false;
        if (authMode === 'email' && !String(email || '').trim()) return false;
        if (authMode === 'phone' && !String(phoneNumber || '').trim()) return false;
        if (isEmployerSetup && !String(companyName || '').trim()) return false;
        if (!String(functionalArea || '').trim()) return false;
        if (!String(preferredCity || '').trim()) return false;
        if (!isEmployerSetup && !String(expectedSalary || '').trim()) return false;
        return true;
    }, [authMode, companyName, email, expectedSalary, functionalArea, isEmployerSetup, password, phoneNumber, preferredCity]);

    const handleBack = useCallback(() => {
        handleAuthBackNavigation(navigation, {
            selectedRole,
            target: 'Register',
        });
    }, [navigation, selectedRole]);



    const handleCompleteSetup = useCallback(async () => {
        if (submitting || !canSubmit) return;

        const safePassword = String(password || '').trim();
        const safeEmail = String(email || '').trim();
        const safePhone = String(phoneNumber || '').trim();
        const isStrongPwd = safePassword.length >= 10
            && /[A-Z]/.test(safePassword)
            && /[a-z]/.test(safePassword)
            && /[0-9]/.test(safePassword)
            && /[^A-Za-z0-9]/.test(safePassword);
        if (!isStrongPwd) {
            Alert.alert('Weak password', 'Password must be at least 10 characters with uppercase, lowercase, a number, and a symbol.');
            return;
        }
        if (authMode === 'email' && !safeEmail.includes('@')) {
            Alert.alert('Invalid email', 'Please enter a valid email address.');
            return;
        }
        if (authMode === 'phone' && safePhone.replace(/\D/g, '').length < 10) {
            Alert.alert('Invalid phone', 'Please enter a valid phone number.');
            return;
        }

        setSubmitting(true);
        try {
            const name = seedName;
            const isHybrid = selectedSession.isHybrid;
            const mappedRole = selectedSession.legacyRole;
            const mappedActiveRole = selectedSession.requestedActiveRole;
            const rolesArr = selectedSession.defaultRoles;
            // No longer routing to forced wizard — avatar upload + profile setup happen post-OTP
            const signupSetupDraft = isEmployerSetup
                ? {
                    kind: 'employer',
                    companyName: String(companyName || '').trim(),
                    industry: String(functionalArea || '').trim(),
                    location: String(preferredCity || '').trim(),
                    contactPerson: name,
                    description: String(bio || '').trim(),
                    avatarUrl: avatarUri,
                }
                : {
                    kind: 'worker',
                    fullName: name,
                    city: String(preferredCity || '').trim(),
                    roleCategory: inferWorkerRoleCategoryFromSetupArea(functionalArea),
                    roleName: String(functionalArea || '').trim(),
                    expectedSalary: estimateMonthlyAmountFromBand(expectedSalary),
                    avatarUrl: avatarUri,
                };
            const sharedProfilePayload = {
                name,
                firstName: nameParts.firstName,
                lastName: nameParts.lastName,
                accountMode: isHybrid ? 'hybrid' : mappedActiveRole,
                bio,
                email: authMode === 'email' ? safeEmail : '',
                phoneNumber: authMode === 'phone' ? safePhone : '',
                avatar: avatarUri,
                profilePicture: avatarUri,
                dateOfBirth: String(dateOfBirth || '').trim(),
                gender: String(gender || '').trim(),
                functionalArea: String(functionalArea || '').trim(),
                preferredCity: String(preferredCity || '').trim(),
                expectedSalary: String(expectedSalary || '').trim(),
                signupSetupDraft,
                profileSetup: {
                    dateOfBirth: String(dateOfBirth || '').trim(),
                    gender: String(gender || '').trim(),
                    functionalArea: String(functionalArea || '').trim(),
                    preferredCity: String(preferredCity || '').trim(),
                    expectedSalary: String(expectedSalary || '').trim(),
                },
            };

            if (QA_ROLE_BOOTSTRAP_ENABLED) {
                let data = null;
                if (INSTANT_PREVIEW_AUTH_ENABLED) {
                    data = buildPreviewAuthSession({
                        selectedRole,
                        email: authMode === 'email' ? safeEmail : '',
                        phoneNumber: authMode === 'phone' ? safePhone : '',
                        name,
                        hasCompletedProfile: false,
                        profileComplete: false,
                        extra: {
                            signupSetupDraft,
                        },
                    });
                } else {
                    try {
                        const response = await client.post('/api/auth/dev-bootstrap', {
                            role: mappedActiveRole,
                        }, {
                            __skipUnauthorizedHandler: true,
                            __skipApiErrorHandler: true,
                            __allowWhenCircuitOpen: true,
                            __maxRetries: 1,
                            timeout: 2500,
                        });
                        data = response?.data;
                    } catch (_bootstrapError) {
                        data = buildPreviewAuthSession({
                            selectedRole,
                            email: authMode === 'email' ? safeEmail : '',
                            phoneNumber: authMode === 'phone' ? safePhone : '',
                            name,
                            hasCompletedProfile: false,
                            profileComplete: false,
                            extra: {
                                signupSetupDraft,
                            },
                        });
                    }
                }

                if (!data?.token) {
                    throw new Error('Missing session token');
                }

                await login(
                    buildRoleAwareSessionPayload(data, selectedRole, {
                        ...sharedProfilePayload,
                        enforceRequestedRole: true,
                        hasCompletedProfile: false,
                        profileComplete: false,
                        hasCompletedOnboarding: true,
                    }),
                    {
                        authEntryRole: selectedRole,
                        // pendingPostAuthSetup removed — user goes directly to MainTab after OTP
                    }
                );
                return;
            }

            const resolvedRole = ['employer', 'hybrid'].includes(selectedRole) ? 'employer' : 'worker';
            const { data: _registerData } = await client.post('/api/users/register', {
                name: seedName,
                email: safeEmail,
                password: safePassword,
                selectedRole: resolvedRole,
            });

            await client.post('/api/auth/send-otp', { email: safeEmail });

            navigation.navigate('OTPVerification', {
                selectedRole,
                intent: 'signup',
                identity: { kind: 'email', value: safeEmail, label: safeEmail },
                initialOtpDispatched: true,
                // Pass avatar so OTPVerificationScreen can upload it right after getting the token
                avatarUri: avatarUri || undefined,
            });
        } catch (error) {
            const backendMessage = String(error?.response?.data?.message || error?.message || '').trim();
            Alert.alert('Setup unavailable', backendMessage || 'Unable to complete account setup right now. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }, [
        authMode,
        avatarUri,
        bio,
        canSubmit,
        dateOfBirth,
        email,
        expectedSalary,
        functionalArea,
        gender,
        login,
        nameParts.firstName,
        nameParts.lastName,
        navigation,
        password,
        phoneNumber,
        preferredCity,
        seedName,
        selectedRole,
        selectedSession.defaultRoles,
        selectedSession.isHybrid,
        selectedSession.legacyRole,
        selectedSession.requestedActiveRole,
        submitting,
    ]);

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
                        <Text style={styles.stepPillText}>Step 2 of 2</Text>
                    </View>

                    <View style={styles.heroIdentity}>
                        <Image source={{ uri: avatarUri || avatarFallback }} style={styles.heroAvatar} />
                        <View style={styles.heroIdentityTextWrap}>
                            <Text style={styles.heroName}>{seedName || 'Your Profile'}</Text>
                            <Text style={styles.heroRole}>{roleLabel}</Text>
                        </View>
                    </View>

                    <Text style={styles.title}>Complete your account</Text>
                    <Text style={styles.subtitle}>A few details now, then we’ll take you to the right setup flow.</Text>
                </View>

                    <View style={[styles.formCard, { marginTop: 24 }]}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="shield-checkmark-outline" size={15} color={PALETTE.accentDeep} />
                            <Text style={styles.sectionHeaderText}>{personalSectionTitle}</Text>
                        </View>
                    {authMode === 'email' ? (
                        <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>Email</Text>
                            <View style={styles.inputShell}>
                                <Ionicons name="mail-outline" size={16} color={PALETTE.accent} style={styles.fieldIcon} />
                                <TextInput
                                    value={email}
                                    onChangeText={setEmail}
                                    style={styles.input}
                                    placeholder="Enter your email"
                                    placeholderTextColor={PALETTE.textTertiary}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                />
                            </View>
                        </View>
                    ) : (
                        <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>Phone Number</Text>
                            <View style={styles.phoneRow}>
                                <View style={styles.countryCodeWrap}>
                                    <Text style={styles.countryCodeText}>+91</Text>
                                </View>
                                <TextInput
                                    value={phoneNumber}
                                    onChangeText={setPhoneNumber}
                                    style={styles.phoneInput}
                                    placeholder="Enter your phone number"
                                    placeholderTextColor={PALETTE.textTertiary}
                                    keyboardType="phone-pad"
                                />
                            </View>
                        </View>
                    )}

                    <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>Password</Text>
                        <View style={styles.inputShell}>
                            <Ionicons name="lock-closed-outline" size={16} color={PALETTE.accent} style={styles.fieldIcon} />
                            <TextInput
                                value={password}
                                onChangeText={setPassword}
                                style={styles.input}
                                placeholder="Enter a strong login password"
                                placeholderTextColor={PALETTE.textTertiary}
                                secureTextEntry
                                autoCapitalize="none"
                            />
                        </View>
                    </View>

                    {isEmployerSetup ? (
                        <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>Company Name</Text>
                            <View style={styles.inputShell}>
                                <Ionicons name="business-outline" size={16} color={PALETTE.accent} style={styles.fieldIcon} />
                                <TextInput
                                    value={companyName}
                                    onChangeText={setCompanyName}
                                    style={styles.input}
                                    placeholder="Enter your company name"
                                    placeholderTextColor={PALETTE.textTertiary}
                                    autoCapitalize="words"
                                />
                            </View>
                        </View>
                    ) : (
                        <>
                            <View style={styles.fieldBlock}>
                                <Text style={styles.fieldLabel}>My Date of Birth</Text>
                                <View style={styles.inputShell}>
                                    <Ionicons name="calendar-outline" size={16} color={PALETTE.accent} style={styles.fieldIcon} />
                                    <TextInput
                                        value={dateOfBirth}
                                        onChangeText={setDateOfBirth}
                                        style={styles.input}
                                        placeholder="DD / MM / YYYY"
                                        placeholderTextColor={PALETTE.textTertiary}
                                        keyboardType="numbers-and-punctuation"
                                    />
                                </View>
                            </View>

                            <View style={styles.fieldBlock}>
                                <Text style={styles.fieldLabel}>My Gender</Text>
                                <View style={styles.genderRow}>
                                    {GENDER_OPTIONS.map((option) => {
                                        const active = option.toLowerCase() === String(gender || '').toLowerCase();
                                        return (
                                            <TouchableOpacity
                                                key={option}
                                                style={[styles.genderChip, active && styles.genderChipActive]}
                                                onPress={() => setGender(option)}
                                                activeOpacity={0.85}
                                            >
                                                <Text style={[styles.genderChipText, active && styles.genderChipTextActive]}>{option}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>
                        </>
                    )}

                    <View style={styles.sectionDivider} />
                    <Text style={styles.sectionTitle}>{preferenceSectionTitle}</Text>

                    <TypeaheadField
                        label={functionalAreaLabel}
                        value={functionalArea}
                        onChangeText={setFunctionalArea}
                        placeholder={functionalAreaPlaceholder}
                        suggestions={functionalSuggestions}
                        onSelectSuggestion={setFunctionalArea}
                    />
                    <View style={styles.quickRow}>
                        {topFunctionalPicks.map((item) => (
                            <TouchableOpacity key={`functional-${item}`} style={styles.quickChip} activeOpacity={0.85} onPress={() => setFunctionalArea(item)}>
                                <Text style={styles.quickChipText}>{item}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    <TypeaheadField
                        label={cityLabel}
                        value={preferredCity}
                        onChangeText={setPreferredCity}
                        placeholder="Select city"
                        suggestions={citySuggestions}
                        onSelectSuggestion={setPreferredCity}
                    />
                    <View style={styles.quickRow}>
                        {topCityPicks.map((item) => (
                            <TouchableOpacity key={`city-${item}`} style={styles.quickChip} activeOpacity={0.85} onPress={() => setPreferredCity(item)}>
                                <Text style={styles.quickChipText}>{item}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {!isEmployerSetup ? (
                        <>
                            <TypeaheadField
                                label={salaryLabel}
                                value={expectedSalary}
                                onChangeText={setExpectedSalary}
                                placeholder={salaryPlaceholder}
                                suggestions={salarySuggestions}
                                onSelectSuggestion={setExpectedSalary}
                                autoCapitalize="none"
                            />
                            <View style={styles.quickRow}>
                                {topSalaryPicks.map((item) => (
                                    <TouchableOpacity key={`salary-${item}`} style={styles.quickChip} activeOpacity={0.85} onPress={() => setExpectedSalary(item)}>
                                        <Text style={styles.quickChipText}>{item}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </>
                    ) : null}
                </View>

                <TouchableOpacity
                    style={[styles.submitWrap, (!canSubmit || submitting) && styles.submitWrapDisabled]}
                    activeOpacity={0.9}
                    onPress={handleCompleteSetup}
                    disabled={!canSubmit || submitting}
                >
                    <LinearGradient
                        colors={['#C084FC', PALETTE.accent, PALETTE.accentDeep]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.submitGradient}
                    >
                        {submitting ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.submitText}>Create Account</Text>}
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
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.border,
        minHeight: 42,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        marginBottom: 8,
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
        marginTop: 4,
        marginBottom: -6,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 16,
        overflow: 'hidden',
        ...SHADOWS.md,
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
    heroIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
    },
    heroAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.surface2,
    },
    heroIdentityTextWrap: {
        flex: 1,
    },
    heroName: {
        color: PALETTE.textPrimary,
        fontSize: 14,
        fontWeight: '800',
        letterSpacing: -0.1,
    },
    heroRole: {
        marginTop: 2,
        color: PALETTE.textSecondary,
        fontSize: 11,
        fontWeight: '700',
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
    avatarSection: {
        marginTop: 14,
        alignItems: 'center',
        marginBottom: 16,
    },
    avatarRing: {
        width: 124,
        height: 124,
        borderRadius: 62,
        borderWidth: 1,
        borderColor: PALETTE.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.background,
        position: 'relative',
        ...SHADOWS.sm,
    },
    avatarImage: {
        width: 116,
        height: 116,
        borderRadius: 58,
    },
    cameraFab: {
        position: 'absolute',
        right: -4,
        bottom: 4,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: PALETTE.accent,
        borderWidth: 2,
        borderColor: PALETTE.background,
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarTitle: {
        marginTop: 10,
        color: PALETTE.textPrimary,
        fontSize: 19,
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
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 16,
        ...SHADOWS.md,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 2,
        marginBottom: 4,
    },
    sectionHeaderText: {
        color: PALETTE.accentDeep,
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    rowTwo: {
        flexDirection: 'row',
        gap: 10,
    },
    halfField: {
        flex: 1,
    },
    fieldBlock: {
        marginTop: 10,
    },
    fieldLabel: {
        color: PALETTE.textSecondary,
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 7,
        letterSpacing: 0.2,
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
    inputShellFocused: {
        borderColor: PALETTE.accent,
        backgroundColor: PALETTE.background,
    },
    input: {
        flex: 1,
        color: PALETTE.textPrimary,
        fontSize: 14,
        fontWeight: '500',
        minHeight: 48,
    },
    phoneRow: {
        backgroundColor: PALETTE.surface2,
        borderWidth: 1,
        borderColor: PALETTE.border,
        minHeight: 50,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    countryCodeWrap: {
        width: 58,
        minHeight: 50,
        borderRightWidth: 1,
        borderRightColor: PALETTE.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.surface3,
    },
    countryCodeText: {
        color: PALETTE.textSecondary,
        fontSize: 14,
        fontWeight: '700',
    },
    phoneInput: {
        flex: 1,
        minHeight: 50,
        paddingHorizontal: 12,
        color: PALETTE.textPrimary,
        fontSize: 14,
        fontWeight: '500',
    },
    genderRow: {
        flexDirection: 'row',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: PALETTE.border,
        overflow: 'hidden',
    },
    genderChip: {
        flex: 1,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.surface2,
        borderRightWidth: 1,
        borderRightColor: PALETTE.border,
    },
    genderChipActive: {
        backgroundColor: PALETTE.accent,
    },
    genderChipText: {
        color: PALETTE.textSecondary,
        fontSize: 14,
        fontWeight: '700',
    },
    genderChipTextActive: {
        color: '#ffffff',
    },
    sectionDivider: {
        marginTop: 16,
        height: 1,
        backgroundColor: PALETTE.borderLight,
    },
    sectionTitle: {
        marginTop: 10,
        color: PALETTE.textPrimary,
        textAlign: 'center',
        fontSize: 21,
        lineHeight: 26,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    suggestionPanel: {
        backgroundColor: PALETTE.background,
        borderWidth: 1,
        borderColor: PALETTE.borderLight,
        marginTop: 6,
        borderRadius: 12,
        overflow: 'hidden',
        ...SHADOWS.sm,
    },
    suggestionRow: {
        minHeight: 40,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: PALETTE.borderLight,
    },
    suggestionText: {
        color: PALETTE.textPrimary,
        fontSize: 13,
        fontWeight: '600',
    },
    quickRow: {
        marginTop: 6,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 6,
    },
    quickChip: {
        backgroundColor: PALETTE.accentTint,
        borderWidth: 1,
        borderColor: PALETTE.accentBorder,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    quickChipText: {
        color: PALETTE.accentDeep,
        fontSize: 11,
        fontWeight: '700',
    },
    submitWrap: {
        ...SHADOWS.accent,
        marginTop: 14,
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
