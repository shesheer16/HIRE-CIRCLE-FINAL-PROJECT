import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { GLASS_GRADIENTS, GLASS_PALETTE, GLASS_SHADOWS, GLASS_SURFACES } from '../theme/glass';
import { logger } from '../utils/logger';
import {
    formatProfileCompletionStepLabel,
    getNormalizedProfileReadiness,
    getProfileStudioCompletion,
} from '../utils/profileReadiness';
import {
    getApDistrictOptions,
    getApLocalityHints,
} from '../config/apProfileCatalog';

const INDUSTRY_OPTIONS = [
    'Logistics',
    'Retail',
    'Hospitality',
    'Healthcare',
    'Technology',
    'Finance',
    'Staffing',
];
const LOCATION_OPTIONS = getApDistrictOptions();
const PRIORITY_LOCATION_OPTIONS = LOCATION_OPTIONS.slice(0, 8);
const COMPANY_NAME_OPTIONS = ['Acme Logistics', 'Nova Staffing', 'Swift Retail', 'Prime Hospitality', 'Apex Talent Labs'];

const normalizeToken = (value = '') => String(value || '').trim().toLowerCase();

const buildUniqueOptions = (entries = []) => [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))];

const buildTypeaheadSuggestions = (query = '', options = [], limit = 6) => {
    const normalizedQuery = normalizeToken(query);
    const safeOptions = buildUniqueOptions(options);
    if (!safeOptions.length) return [];
    if (!normalizedQuery) return safeOptions.slice(0, limit);

    const startsWith = safeOptions.filter((item) => normalizeToken(item).startsWith(normalizedQuery));
    const contains = safeOptions.filter((item) => (
        normalizeToken(item).includes(normalizedQuery) && !startsWith.includes(item)
    ));
    return [...startsWith, ...contains].slice(0, limit);
};

const inferCompanyPreset = (companyName = '') => {
    const normalized = normalizeToken(companyName);
    if (normalized.includes('logistics') || normalized.includes('delivery')) {
        return {
            industry: 'Logistics',
            tagline: 'Fast, reliable operations hiring across shifts.',
        };
    }
    if (normalized.includes('tech') || normalized.includes('software')) {
        return {
            industry: 'Technology',
            tagline: 'Product-led team hiring high-ownership talent.',
        };
    }
    if (normalized.includes('health')) {
        return {
            industry: 'Healthcare',
            tagline: 'Patient-first team hiring trained professionals.',
        };
    }
    return {
        industry: 'Staffing',
        tagline: 'Growing team hiring quality candidates quickly.',
    };
};

const TypeaheadInput = ({
    value = '',
    onChangeText,
    placeholder = '',
    suggestions = [],
    onSelectSuggestion,
    autoCapitalize = 'words',
}) => {
    const [focused, setFocused] = useState(false);
    const safeSuggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
    const showSuggestions = focused && safeSuggestions.length > 0;

    return (
        <View style={styles.typeaheadWrap}>
            <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
                <TextInput
                    style={styles.input}
                    value={value}
                    placeholder={placeholder}
                    placeholderTextColor={GLASS_PALETTE.textSoft}
                    autoCorrect={false}
                    autoCapitalize={autoCapitalize}
                    onChangeText={onChangeText}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setTimeout(() => setFocused(false), 100)}
                />
                <Ionicons name={showSuggestions ? 'chevron-up' : 'chevron-down'} size={14} color={GLASS_PALETTE.textMuted} />
            </View>
            {showSuggestions ? (
                <View style={styles.typeaheadMenu}>
                    {safeSuggestions.map((item) => (
                        <TouchableOpacity
                            key={`suggest-${item}`}
                            style={styles.typeaheadOption}
                            activeOpacity={0.85}
                            onPress={() => {
                                onSelectSuggestion?.(item);
                                setFocused(false);
                            }}
                        >
                            <Text style={styles.typeaheadOptionText}>{item}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            ) : null}
        </View>
    );
};

export default function EmployerProfileCreateScreen({ onCompleted }) {
    const { updateUserInfo, userInfo } = useContext(AuthContext);
    const [companyName, setCompanyName] = useState('');
    const [tagline, setTagline] = useState('');
    const [industry, setIndustry] = useState('');
    const [location, setLocation] = useState('');
    const [mandal, setMandal] = useState('');
    const [contactPerson, setContactPerson] = useState('');
    const [bootLoading, setBootLoading] = useState(true);
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [assistMessage, setAssistMessage] = useState('');
    const [errors, setErrors] = useState({});

    const companyNameTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...COMPANY_NAME_OPTIONS,
        companyName,
    ]), [companyName]);
    const industryTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...INDUSTRY_OPTIONS,
        industry,
    ]), [industry]);
    const locationTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...LOCATION_OPTIONS,
        location,
    ]), [location]);
    const localityTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...getApLocalityHints(location),
        mandal,
    ]), [location, mandal]);
    const signupSetupDraft = userInfo?.signupSetupDraft && typeof userInfo.signupSetupDraft === 'object'
        ? userInfo.signupSetupDraft
        : null;

    useEffect(() => {
        let active = true;
        const bootstrap = async () => {
            setBootLoading(true);
            try {
                const { data } = await client.get('/api/users/profile', {
                    params: { role: 'employer' },
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                }).catch(() => ({ data: {} }));

                if (!active) return;
                const profile = data?.profile || {};
                setCompanyName(String(profile?.companyName || signupSetupDraft?.companyName || '').trim());
                setTagline(String(profile?.description || signupSetupDraft?.description || '').trim());
                setIndustry(String(profile?.industry || signupSetupDraft?.industry || '').trim());
                setLocation(String(profile?.district || profile?.location || signupSetupDraft?.district || signupSetupDraft?.location || '').trim());
                setMandal(String(profile?.mandal || signupSetupDraft?.mandal || '').trim());
                setContactPerson(String(profile?.contactPerson || signupSetupDraft?.contactPerson || userInfo?.name || '').trim());
            } finally {
                if (active) setBootLoading(false);
            }
        };
        void bootstrap();
        return () => {
            active = false;
        };
    }, [signupSetupDraft?.companyName, signupSetupDraft?.contactPerson, signupSetupDraft?.description, signupSetupDraft?.district, signupSetupDraft?.industry, signupSetupDraft?.location, signupSetupDraft?.mandal, userInfo?.name]);

    const handleAutoFill = useCallback(() => {
        const preset = inferCompanyPreset(companyName);
        setIndustry((prev) => String(prev || preset.industry).trim());
        setTagline((prev) => String(prev || preset.tagline).trim());
        setAssistMessage('Smart defaults applied. You can edit everything before saving.');
    }, [companyName]);

    const handleAiAssist = useCallback(async () => {
        const company = String(companyName || '').trim();
        if (!company) {
            handleAutoFill();
            setAssistMessage('Added starter values. Enter company name for stronger AI suggestions.');
            return;
        }

        setAiLoading(true);
        setAssistMessage('');
        try {
            const { data } = await client.post('/api/features/ai/profile-suggestions', {
                roleName: company,
                context: 'employer_profile',
            }, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
            });

            const nextIndustry = String(data?.industry || '').trim();
            const nextCity = String(data?.city || '').trim();
            const nextTagline = String(data?.summary || '').trim();

            setIndustry((prev) => nextIndustry || prev || inferCompanyPreset(company).industry);
            setLocation((prev) => nextCity || prev);
            setTagline((prev) => nextTagline || prev || inferCompanyPreset(company).tagline);
            setAssistMessage('AI suggestions applied. Review and complete setup.');
        } catch (_error) {
            handleAutoFill();
            setAssistMessage('Network AI unavailable. Applied smart local suggestions.');
        } finally {
            setAiLoading(false);
        }
    }, [companyName, handleAutoFill]);

    const handleSave = async () => {
        const nextErrors = {};
        if (!String(companyName || '').trim()) nextErrors.companyName = 'Company name is required.';
        if (!String(industry || '').trim()) nextErrors.industry = 'Industry is required.';
        if (!String(tagline || '').trim()) nextErrors.tagline = 'Company summary is required.';
        if (!String(location || '').trim()) nextErrors.location = 'District is required.';
        if (!String(mandal || '').trim()) nextErrors.mandal = 'Mandal or locality is required.';
        if (!String(contactPerson || '').trim()) nextErrors.contactPerson = 'Contact person is required.';
        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        setErrors({});
        setLoading(true);
        try {
            const districtValue = String(location).trim();
            const mandalValue = String(mandal || '').trim();
            const locationLabel = [mandalValue, districtValue].filter(Boolean).join(', ');
            const updateData = {
                companyName: String(companyName).trim(),
                industry: String(industry || '').trim(),
                location: locationLabel || districtValue,
                district: districtValue,
                mandal: mandalValue,
                locationLabel,
                description: String(tagline || '').trim(),
                contactPerson: String(contactPerson || '').trim(),
            };

            const { data } = await client.put('/api/users/profile', updateData, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
            });

            const nextCompletion = data?.profileCompletion || null;
            const readiness = getNormalizedProfileReadiness({
                hasCompletedProfile: Boolean(nextCompletion?.meetsProfileCompleteThreshold),
                profileComplete: Boolean(nextCompletion?.meetsProfileCompleteThreshold),
                profileCompletion: nextCompletion,
            });
            const studioCompletion = getProfileStudioCompletion({
                role: 'employer',
                completion: nextCompletion,
            });

            if (!studioCompletion.isStudioReady) {
                const missing = studioCompletion.missingCoreSteps.map((stepId) => formatProfileCompletionStepLabel(stepId)).join(', ');
                Alert.alert('Complete company profile', missing ? `Add these details to finish profile setup: ${missing}.` : 'Please complete the remaining company details.');
                return;
            }

            await updateUserInfo({
                hasCompletedProfile: readiness.hasCompletedProfile,
                profileComplete: readiness.profileComplete,
                profileCompletion: nextCompletion,
                signupSetupDraft: null,
            });
            if (typeof onCompleted === 'function') {
                onCompleted();
            } else {
                Alert.alert(
                    'Saved',
                    studioCompletion.isVerificationPending
                        ? 'Company profile saved. Verify contact later to unlock job posting.'
                        : 'Employer profile updated.'
                );
            }
        } catch (error) {
            logger.error('Employer profile save error:', error);
            Alert.alert('Error', error?.response?.data?.message || 'Failed to save employer profile.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <LinearGradient colors={GLASS_GRADIENTS.screen} style={styles.container}>
            <View style={styles.bgGlowTop} />
            <View style={styles.bgGlowMid} />
            <View style={styles.bgGlowBottom} />
            <SafeAreaView style={styles.safeArea}>
                <KeyboardAvoidingView style={styles.safeArea} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
                {bootLoading ? (
                    <View style={styles.loaderWrap}>
                        <ActivityIndicator color={GLASS_PALETTE.accent} />
                        <Text style={styles.loaderText}>Loading employer setup...</Text>
                    </View>
                ) : (
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.heroCard}>
                        <View style={styles.heroIcon}>
                            <Ionicons name="briefcase-outline" size={22} color={GLASS_PALETTE.accentText} />
                        </View>
                        <Text style={styles.title}>Employer Setup</Text>
                        <Text style={styles.subtitle}>Keep it simple: company, Andhra Pradesh hiring base, and the contact your team uses.</Text>
                        <View style={styles.assistRow}>
                            <TouchableOpacity
                                style={styles.primaryAssistButton}
                                onPress={handleAiAssist}
                                activeOpacity={0.85}
                                disabled={aiLoading}
                            >
                                <Text style={styles.primaryAssistButtonText}>
                                    {aiLoading ? 'Thinking...' : 'AI Assist'}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.secondaryAssistButton}
                                onPress={handleAutoFill}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.secondaryAssistButtonText}>Auto-fill</Text>
                            </TouchableOpacity>
                        </View>
                        {String(assistMessage || '').trim() ? (
                            <Text style={styles.assistMessage}>{assistMessage}</Text>
                        ) : null}
                    </View>

                    <View style={styles.formCard}>
                        <Text style={styles.label}>Company Name *</Text>
                        <TypeaheadInput
                            value={companyName}
                            onChangeText={(value) => {
                                setCompanyName(value);
                                if (errors.companyName) setErrors((prev) => ({ ...prev, companyName: null }));
                            }}
                            placeholder="e.g. Acme Logistics"
                            suggestions={buildTypeaheadSuggestions(companyName, companyNameTypeaheadOptions, 5)}
                            onSelectSuggestion={(value) => {
                                setCompanyName(value);
                                if (errors.companyName) setErrors((prev) => ({ ...prev, companyName: null }));
                            }}
                        />
                        {errors.companyName ? <Text style={styles.errorText}>{errors.companyName}</Text> : null}

                        <Text style={styles.label}>Industry</Text>
                        <TypeaheadInput
                            value={industry}
                            onChangeText={(value) => {
                                setIndustry(value);
                                if (errors.industry) setErrors((prev) => ({ ...prev, industry: null }));
                            }}
                            placeholder="Choose industry"
                            suggestions={buildTypeaheadSuggestions(industry, industryTypeaheadOptions, 6)}
                            onSelectSuggestion={(value) => {
                                setIndustry(value);
                                if (errors.industry) setErrors((prev) => ({ ...prev, industry: null }));
                            }}
                        />
                        {errors.industry ? <Text style={styles.errorText}>{errors.industry}</Text> : null}
                        <View style={styles.pillsRow}>
                            {INDUSTRY_OPTIONS.map((item) => (
                                <TouchableOpacity
                                    key={item}
                                    style={[styles.pill, normalizeToken(industry) === normalizeToken(item) ? styles.pillActive : null]}
                                    onPress={() => setIndustry(item)}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[styles.pillText, normalizeToken(industry) === normalizeToken(item) ? styles.pillTextActive : null]}>
                                        {item}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.label}>Company Summary *</Text>
                        <View style={styles.inputWrap}>
                            <TextInput
                                style={styles.input}
                                placeholder="What your team does and who you hire"
                                placeholderTextColor={GLASS_PALETTE.textSoft}
                                value={tagline}
                                onChangeText={(value) => {
                                    setTagline(value);
                                    if (errors.tagline) setErrors((prev) => ({ ...prev, tagline: null }));
                                }}
                            />
                        </View>
                        {errors.tagline ? <Text style={styles.errorText}>{errors.tagline}</Text> : null}

                        <Text style={styles.label}>District *</Text>
                        <TypeaheadInput
                            value={location}
                            onChangeText={(value) => {
                                setLocation(value);
                                if (errors.location) setErrors((prev) => ({ ...prev, location: null }));
                            }}
                            placeholder="Type district"
                            suggestions={buildTypeaheadSuggestions(location, locationTypeaheadOptions, 6)}
                            onSelectSuggestion={(value) => {
                                setLocation(value);
                                if (errors.location) setErrors((prev) => ({ ...prev, location: null }));
                            }}
                        />
                        <View style={styles.pillsRow}>
                            {PRIORITY_LOCATION_OPTIONS.map((item) => (
                                <TouchableOpacity
                                    key={item}
                                    style={[styles.pill, normalizeToken(location) === normalizeToken(item) ? styles.pillActive : null]}
                                    onPress={() => {
                                        setLocation(item);
                                        if (errors.location) setErrors((prev) => ({ ...prev, location: null }));
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <Text style={[styles.pillText, normalizeToken(location) === normalizeToken(item) ? styles.pillTextActive : null]}>
                                        {item}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {errors.location ? <Text style={styles.errorText}>{errors.location}</Text> : null}
                        <Text style={styles.helperText}>If your district is not listed, type it exactly and continue.</Text>

                        <Text style={styles.label}>Mandal / Locality *</Text>
                        <TypeaheadInput
                            value={mandal}
                            onChangeText={(value) => {
                                setMandal(value);
                                if (errors.mandal) setErrors((prev) => ({ ...prev, mandal: null }));
                            }}
                            placeholder={String(location || '').trim() ? 'Type mandal, town, or area' : 'Enter district first'}
                            suggestions={buildTypeaheadSuggestions(mandal, localityTypeaheadOptions, 6)}
                            onSelectSuggestion={(value) => {
                                setMandal(value);
                                if (errors.mandal) setErrors((prev) => ({ ...prev, mandal: null }));
                            }}
                        />
                        {errors.mandal ? <Text style={styles.errorText}>{errors.mandal}</Text> : null}
                        <Text style={styles.helperText}>This helps nearby gigs and local hiring appear correctly.</Text>

                        <Text style={styles.label}>Contact Person *</Text>
                        <View style={styles.inputWrap}>
                            <TextInput
                                style={styles.input}
                                placeholder="Who candidates should expect to hear from"
                                placeholderTextColor={GLASS_PALETTE.textSoft}
                                value={contactPerson}
                                onChangeText={(value) => {
                                    setContactPerson(value);
                                    if (errors.contactPerson) setErrors((prev) => ({ ...prev, contactPerson: null }));
                                }}
                            />
                        </View>
                        {errors.contactPerson ? <Text style={styles.errorText}>{errors.contactPerson}</Text> : null}
                    </View>

                    <TouchableOpacity
                        style={[styles.saveButton, loading ? styles.saveButtonDisabled : null]}
                        onPress={handleSave}
                        disabled={loading}
                        activeOpacity={0.9}
                    >
                        <LinearGradient colors={GLASS_GRADIENTS.accent} style={styles.saveButtonGradient}>
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>Complete Setup</Text>}
                        </LinearGradient>
                    </TouchableOpacity>
                </ScrollView>
                )}
                </KeyboardAvoidingView>
            </SafeAreaView>
        </LinearGradient>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    safeArea: { flex: 1 },
    bgGlowTop: {
        position: 'absolute',
        top: -120,
        right: -80,
        width: 240,
        height: 240,
        borderRadius: 120,
        backgroundColor: GLASS_PALETTE.glowLavender,
    },
    bgGlowMid: {
        position: 'absolute',
        top: '36%',
        left: -56,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: GLASS_PALETTE.glowBlue,
    },
    bgGlowBottom: {
        position: 'absolute',
        left: -84,
        bottom: -96,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: GLASS_PALETTE.glowRose,
    },
    content: { padding: 18, paddingBottom: 28 },
    heroCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        borderRadius: 18,
        padding: 16,
        marginBottom: 14,
    },
    heroIcon: {
        ...GLASS_SURFACES.softPanel,
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    title: { fontSize: 22, fontWeight: '800', color: GLASS_PALETTE.textStrong, marginBottom: 4 },
    subtitle: { fontSize: 13, color: GLASS_PALETTE.textMuted, marginBottom: 12 },
    loaderWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },
    loaderText: {
        color: GLASS_PALETTE.accentText,
        fontSize: 13,
        fontWeight: '700',
    },
    assistRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    primaryAssistButton: {
        borderRadius: 10,
        backgroundColor: GLASS_PALETTE.accent,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    primaryAssistButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
    secondaryAssistButton: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    secondaryAssistButtonText: { color: GLASS_PALETTE.accentText, fontSize: 12, fontWeight: '800' },
    assistMessage: { fontSize: 11, color: GLASS_PALETTE.accentText, fontWeight: '600' },
    formCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        borderRadius: 16,
        padding: 14,
        marginBottom: 16,
    },
    label: {
        fontSize: 11,
        fontWeight: '800',
        color: GLASS_PALETTE.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.7,
        marginBottom: 8,
        marginTop: 8,
    },
    typeaheadWrap: { position: 'relative', zIndex: 20 },
    inputWrap: {
        ...GLASS_SURFACES.input,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        paddingHorizontal: 14,
        minHeight: 48,
    },
    inputWrapFocused: {
        borderColor: GLASS_PALETTE.accent,
        backgroundColor: 'rgba(255,255,255,0.86)',
    },
    input: {
        flex: 1,
        fontSize: 15,
        color: GLASS_PALETTE.textStrong,
        paddingVertical: 12,
        fontWeight: '500',
    },
    typeaheadMenu: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        ...GLASS_SURFACES.panel,
        borderRadius: 10,
        zIndex: 50,
        ...GLASS_SHADOWS.soft,
    },
    typeaheadOption: { paddingHorizontal: 12, paddingVertical: 10 },
    typeaheadOptionText: { fontSize: 13, color: GLASS_PALETTE.accentText, fontWeight: '600' },
    pillsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    pill: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    pillActive: {
        borderColor: 'rgba(111, 78, 246, 0.16)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    pillText: { fontSize: 11, fontWeight: '700', color: GLASS_PALETTE.textMuted },
    pillTextActive: { color: GLASS_PALETTE.accentText },
    errorText: { color: GLASS_PALETTE.danger, fontSize: 11, marginTop: 6 },
    helperText: { color: GLASS_PALETTE.textMuted, fontSize: 11, marginTop: 6, marginBottom: 2 },
    saveButton: {
        ...GLASS_SHADOWS.accent,
        borderRadius: 12,
        overflow: 'hidden',
    },
    saveButtonDisabled: { opacity: 0.7 },
    saveButtonGradient: {
        minHeight: 50,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
});
