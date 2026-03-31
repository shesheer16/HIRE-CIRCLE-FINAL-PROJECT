import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Image,
    Keyboard,
    KeyboardAvoidingView,
    LayoutAnimation,
    Modal,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import FieldPicker from '../../components/FieldPicker';
import FormFooter from '../../components/FormFooter';
import PressableScale from '../../components/PressableScale';
import { logger } from '../../utils/logger';
import {
    AP_LANGUAGE_OPTIONS,
    getApDistrictOptions,
    getApLocalityHints,
} from '../../config/apProfileCatalog';
import {
    getRoleCategories,
    getRoleDefaults,
    getRoleTitlesForCategory,
    hasExactRoleMatch,
} from '../../config/workerRoleCatalog';
import { SCREEN_CHROME, SHADOWS } from '../../theme/theme';
import { C } from '../../theme/colors';

const SHIFT_OPTIONS = [
    { value: 'Day', icon: 'sunny-outline', hint: 'Day operations' },
    { value: 'Night', icon: 'moon-outline', hint: 'Night coverage' },
    { value: 'Flexible', icon: 'time-outline', hint: 'Shift rotation' },
];



const ROLE_FAMILY_OPTIONS = getRoleCategories();
const ROLE_FAMILY_VISUALS = Object.freeze({
    'Delivery & Logistics': { emoji: '🛵', tint: 'rgba(96, 165, 250, 0.18)' },
    'Sales & Voice': { emoji: '🎧', tint: 'rgba(251, 191, 36, 0.22)' },
    'Agriculture & Rural Work': { emoji: '🌾', tint: 'rgba(74, 222, 128, 0.20)' },
    'Skilled Trades': { emoji: '🛠️', tint: 'rgba(251, 146, 60, 0.20)' },
    'Construction & Infra': { emoji: '🏗️', tint: 'rgba(248, 113, 113, 0.18)' },
    'Manufacturing & Factory': { emoji: '⚙️', tint: 'rgba(125, 211, 252, 0.20)' },
    'Retail & Hospitality': { emoji: '🛍️', tint: 'rgba(244, 114, 182, 0.18)' },
    'Support & Back Office': { emoji: '💼', tint: 'rgba(192, 132, 252, 0.16)' },
    'Healthcare & Care': { emoji: '🩺', tint: 'rgba(52, 211, 153, 0.16)' },
    'Security & Facilities': { emoji: '🛡️', tint: 'rgba(148, 163, 184, 0.20)' },
    'Finance & Admin': { emoji: '📊', tint: 'rgba(45, 212, 191, 0.18)' },
    'Campus & Student Gigs': { emoji: '🎓', tint: 'rgba(236, 72, 153, 0.18)' },
});
const getRoleFamilyVisual = (family = '') => (
    ROLE_FAMILY_VISUALS[String(family || '').trim()] || { emoji: '💼', tint: 'rgba(111, 78, 246, 0.12)' }
);

const COMPANY_SUGGESTIONS = [];
const JOB_STUDIO_DRAFT_KEY = '@employer_job_studio_draft';
const JOB_POST_TIMEOUT_MS = 9000;
const JOB_POST_VERIFY_ATTEMPTS = 2;
const JOB_POST_VERIFY_DELAY_MS = 700;
const JOB_POST_VERIFY_REQUEST_TIMEOUT_MS = 3000;

const QUICK_SALARY_PRESETS = [
    { label: '15k-20k', min: '15000', max: '20000' },
    { label: '20k-30k', min: '20000', max: '30000' },
    { label: '30k-45k', min: '30000', max: '45000' },
    { label: '45k-60k', min: '45000', max: '60000' },
];

const QUICK_EXPERIENCE_PRESETS = [
    { label: '0-1 yrs', min: '0', max: '1' },
    { label: '1-3 yrs', min: '1', max: '3' },
    { label: '3-5 yrs', min: '3', max: '5' },
    { label: '5+ yrs', min: '5', max: '8' },
];

const STUDIO_STAGE_ORDER = ['family', 'role', 'basics', 'setup', 'skills', 'advanced', 'photo'];
const STUDIO_STAGE_META = {
    family: {
        header: 'Choose work family',
        title: 'What kind of role are you posting?',
        subtitle: 'Start with the work family.',
    },
    role: {
        header: 'Choose role title',
        title: 'Pick the role title',
        subtitle: 'Search or tap a recommended role.',
    },
    basics: {
        header: 'Hiring details',
        title: 'Who is hiring and where?',
        subtitle: 'Set the employer and the AP location.',
    },
    setup: {
        header: 'Pay and setup',
        title: 'Set the work setup',
        subtitle: 'Add salary, shift, and work mode.',
    },
    skills: {
        header: 'Must-have skills',
        title: 'Add the core skills',
        subtitle: 'Search, browse, and build the must-have stack.',
    },
    advanced: {
        header: 'Advanced settings',
        title: 'Fine-tune the role',
        subtitle: 'Optional filters, questions, and supporting signals.',
    },
    photo: {
        header: 'Company photo',
        title: 'Finish the post beautifully',
        subtitle: 'Add a company photo and publish the job.',
    },
};

const OPENING_OPTIONS = [1, 2, 3, 5, 10];
const COMMON_QUESTIONS = [
    'Can you start within 7 days?',
    'Are you comfortable with the selected shift?',
    'Do you have direct experience in this role?',
];

const normalizeText = (value = '') => String(value || '').trim().toLowerCase();

const clampText = (value = '', maxLength = 120) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const isLocalAssetUri = (value = '') => /^(file|content|ph|assets-library):/i.test(String(value || '').trim());

const parseCommaList = (value = '', maxItems = 50, maxLength = 120) => (
    String(value || '')
        .split(',')
        .map((item) => clampText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
);

const parseLineList = (value = '', maxItems = 20, maxLength = 250) => (
    String(value || '')
        .split('\n')
        .map((item) => clampText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems)
);

const toggleCommaToken = (currentValue = '', token = '') => {
    const normalized = clampText(token, 120);
    if (!normalized) return String(currentValue || '');
    const items = parseCommaList(currentValue, 80, 120);
    const hasValue = items.some((item) => normalizeText(item) === normalizeText(normalized));
    if (hasValue) return items.filter((item) => normalizeText(item) !== normalizeText(normalized)).join(', ');
    return [...items, normalized].join(', ');
};

const appendCommaToken = (currentValue = '', token = '') => {
    const normalized = clampText(token, 120);
    if (!normalized) return String(currentValue || '');
    const items = parseCommaList(currentValue, 80, 120);
    if (items.some((item) => normalizeText(item) === normalizeText(normalized))) return String(currentValue || '');
    return [...items, normalized].join(', ');
};

const toggleLineToken = (currentValue = '', token = '') => {
    const normalized = clampText(token, 200);
    if (!normalized) return String(currentValue || '');
    const items = parseLineList(currentValue, 40, 250);
    const hasValue = items.some((item) => normalizeText(item) === normalizeText(normalized));
    if (hasValue) return items.filter((item) => normalizeText(item) !== normalizeText(normalized)).join('\n');
    return [...items, normalized].join('\n');
};

const clampNonNegativeInt = (value) => {
    const digits = String(value || '').replace(/[^\d]/g, '');
    if (!digits) return null;
    const numeric = Number.parseInt(digits, 10);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return numeric;
};

const formatNumberWithCommas = (value) => {
    const numeric = clampNonNegativeInt(value);
    if (numeric === null) return '';
    return numeric.toLocaleString('en-IN');
};

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const withTimeout = (promise, timeoutMs, timeoutMessage = 'Request timed out.') => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

const parseSalaryRange = (salaryRange = '') => {
    const matches = String(salaryRange || '').match(/\d[\d,]*/g) || [];
    if (!matches.length) return { min: '', max: '' };
    const normalized = matches.map((entry) => entry.replace(/,/g, ''));
    if (normalized.length === 1) return { min: normalized[0], max: '' };
    return { min: normalized[0], max: normalized[1] };
};

const buildAutocompleteOptions = (query = '', options = [], limit = 6) => {
    const source = [...new Set((Array.isArray(options) ? options : []).map((item) => String(item || '').trim()).filter(Boolean))];
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return source.slice(0, limit);
    const startsWith = source.filter((option) => normalizeText(option).startsWith(normalizedQuery));
    const contains = source.filter((option) => (
        normalizeText(option).includes(normalizedQuery) && !startsWith.includes(option)
    ));
    return [...startsWith, ...contains].slice(0, limit);
};

const extractApiErrorMessage = (error, fallbackMessage = 'Please review the form and try again.') => {
    const payload = error?.response?.data || error?.originalError?.response?.data || {};
    const directMessage = String(payload?.message || '').trim();
    if (directMessage) return directMessage;
    const nestedMessage = String(payload?.error?.message || '').trim();
    if (nestedMessage) return nestedMessage;
    const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
    if (details.length > 0) {
        const first = details[0] || {};
        const path = String(first?.path || '').trim();
        const message = String(first?.message || '').trim();
        if (path && message) return `${path}: ${message}`;
        if (message) return message;
    }
    const genericMessage = String(error?.message || '').trim();
    return genericMessage || fallbackMessage;
};

const StudioChip = ({ label, selected, onPress }) => (
    <PressableScale
        onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onPress?.();
        }}
        pressInScale={0.97}
        style={[styles.studioChip, selected ? styles.studioChipSelected : null]}
    >
        <Text style={[styles.studioChipText, selected ? styles.studioChipTextSelected : null]}>{label}</Text>
    </PressableScale>
);

const TypeaheadInput = ({
    value = '',
    onChangeText,
    placeholder = '',
    suggestions = [],
    onSelectSuggestion,
    pickerTitle = '',
    pickerHint = 'Pick one or type your own.',
    disabled = false,
    emptyStateText = 'Nothing listed yet. Type your own value.',
}) => {
    const [visible, setVisible] = useState(false);
    const inputRef = useRef(null);
    const safeSuggestions = Array.isArray(suggestions)
        ? Array.from(new Set(suggestions.map((item) => String(item || '').trim()).filter(Boolean)))
        : [];
    const normalizedValue = String(value || '').trim();
    const customValue = normalizedValue && !safeSuggestions.some((item) => normalizeText(item) === normalizeText(normalizedValue))
        ? normalizedValue
        : '';

    const commitSelection = (nextValue) => {
        if (typeof onSelectSuggestion === 'function') {
            onSelectSuggestion(nextValue);
            return;
        }
        onChangeText?.(nextValue);
    };

    const openPicker = () => {
        if (disabled) return;
        Keyboard.dismiss();
        setVisible(true);
        requestAnimationFrame(() => inputRef.current?.focus?.());
    };

    const closePicker = () => {
        inputRef.current?.blur?.();
        Keyboard.dismiss();
        setVisible(false);
    };

    return (
        <View>
            <TouchableOpacity
                style={[styles.typeaheadShell, disabled && styles.typeaheadShellDisabled]}
                activeOpacity={disabled ? 1 : 0.88}
                onPress={openPicker}
                disabled={disabled}
            >
                <Text style={normalizedValue ? styles.typeaheadDisplayText : styles.typeaheadPlaceholderText} numberOfLines={1}>
                    {normalizedValue || placeholder}
                </Text>
                <Text style={styles.typeaheadChevron}>{visible ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            <Modal
                visible={visible}
                transparent
                animationType="fade"
                presentationStyle="overFullScreen"
                onRequestClose={closePicker}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
                    style={styles.typeaheadPickerOverlay}
                >
                    <TouchableOpacity style={styles.typeaheadPickerBackdrop} activeOpacity={1} onPress={closePicker} />
                    <View style={styles.typeaheadPickerSheet}>
                        <View style={styles.typeaheadPickerHandle} />
                        <View style={styles.typeaheadPickerHeader}>
                            <View style={styles.typeaheadPickerHeaderCopy}>
                                <Text style={styles.typeaheadPickerTitle}>{pickerTitle || placeholder}</Text>
                                <Text style={styles.typeaheadPickerHint}>{pickerHint}</Text>
                            </View>
                            <TouchableOpacity onPress={closePicker} style={styles.typeaheadPickerCloseBtn} activeOpacity={0.85}>
                                <Ionicons name="close" size={18} color="#6b7280" />
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.typeaheadShell, styles.typeaheadPickerSearchShell]}>
                            <TextInput
                                ref={inputRef}
                                value={value}
                                onChangeText={onChangeText}
                                style={styles.typeaheadInput}
                                placeholder={placeholder}
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="words"
                                autoCorrect={false}
                                returnKeyType="done"
                            />
                        </View>

                        <ScrollView
                            style={styles.typeaheadPickerList}
                            contentContainerStyle={styles.typeaheadPickerListContent}
                            keyboardShouldPersistTaps="always"
                            showsVerticalScrollIndicator={false}
                        >
                            {safeSuggestions.map((item, index) => (
                                <TouchableOpacity
                                    key={`typeahead-${item}-${index}`}
                                    style={styles.typeaheadPickerItem}
                                    activeOpacity={0.82}
                                    onPress={() => {
                                        commitSelection(item);
                                        closePicker();
                                    }}
                                >
                                    <Text style={styles.typeaheadItemText}>{item}</Text>
                                </TouchableOpacity>
                            ))}
                            {customValue ? (
                                <TouchableOpacity
                                    style={[styles.typeaheadPickerItem, styles.typeaheadPickerItemPrimary]}
                                    activeOpacity={0.82}
                                    onPress={() => {
                                        commitSelection(customValue);
                                        closePicker();
                                    }}
                                >
                                    <Text style={[styles.typeaheadItemText, styles.typeaheadPickerItemPrimaryText]}>
                                        {`Use "${customValue}"`}
                                    </Text>
                                    <Text style={[styles.typeaheadItemMeta, styles.typeaheadPickerItemPrimaryMeta]}>
                                        Type your own and continue
                                    </Text>
                                </TouchableOpacity>
                            ) : null}
                            {safeSuggestions.length === 0 && !customValue ? (
                                <View style={styles.typeaheadPickerEmptyState}>
                                    <Text style={styles.typeaheadPickerEmptyText}>{emptyStateText}</Text>
                                </View>
                            ) : null}
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
};

export default function PostJobScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();

    const [roleType, setRoleType] = useState('');
    const [title, setTitle] = useState('');
    const [hiringAsType, setHiringAsType] = useState(''); // 'profile', 'company', 'custom'
    const [profileName, setProfileName] = useState('');
    const [companyName, setCompanyName] = useState('');
    const [companyBrandPhoto, setCompanyBrandPhoto] = useState('');
    const [district, setDistrict] = useState('');
    const [locality, setLocality] = useState('');
    const [remoteAllowed, setRemoteAllowed] = useState(false);
    const [shift, setShift] = useState('Flexible');
    const [openings, setOpenings] = useState('');
    const [salaryMin, setSalaryMin] = useState('');
    const [salaryMax, setSalaryMax] = useState('');
    const [salaryRangeFallback, setSalaryRangeFallback] = useState('');
    const [experienceMin, setExperienceMin] = useState('');
    const [experienceMax, setExperienceMax] = useState('');
    const [mustHaveSkills, setMustHaveSkills] = useState('');
    const [goodToHaveSkills, setGoodToHaveSkills] = useState('');
    const [languages, setLanguages] = useState('');
    const [mandatoryLicensesText, setMandatoryLicensesText] = useState('');
    const [screeningQuestionsText, setScreeningQuestionsText] = useState('');
    const [customSkillInput, setCustomSkillInput] = useState('');
    const [customLicenseInput, setCustomLicenseInput] = useState('');
    const [customQuestionInput, setCustomQuestionInput] = useState('');
    const [videoUrl, setVideoUrl] = useState(null);
    const [skillSearchDraft, setSkillSearchDraft] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiQuestionsLoading, setAiQuestionsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [verifyingPost, setVerifyingPost] = useState(false);
    const [uploadingCompanyBrand, setUploadingCompanyBrand] = useState(false);
    const [draftHydrated, setDraftHydrated] = useState(false);
    const [studioStage, setStudioStage] = useState('family');
    const draftPersistencePausedRef = useRef(false);
    const contentScrollRef = useRef(null);
    const stagePrimedRef = useRef(false);

    const apDistrictOptions = useMemo(() => getApDistrictOptions(), []);
    const roleFamilyOptions = useMemo(() => ROLE_FAMILY_OPTIONS, []);
    const familyRoleTitles = useMemo(
        () => getRoleTitlesForCategory(roleType),
        [roleType]
    );
    const roleTitleOptions = useMemo(
        () => buildAutocompleteOptions(title, familyRoleTitles, 8),
        [familyRoleTitles, title]
    );
    const roleSearchOptions = useMemo(
        () => buildAutocompleteOptions(title, familyRoleTitles, 100),
        [familyRoleTitles, title]
    );
    const selectedRoleFamily = useMemo(
        () => roleFamilyOptions.find((item) => item.label === roleType) || null,
        [roleFamilyOptions, roleType]
    );
    const hasExactRoleTitle = useMemo(() => hasExactRoleMatch(title), [title]);
    const exactRoleDefaults = useMemo(() => getRoleDefaults(title), [title]);
    
    // Auto-select MBU location logic when Campus Gigs is chosen
    useEffect(() => {
        if (roleType === 'Campus & Student Gigs') {
            setDistrict('Mohan Babu University');
            setHiringAsType('profile'); // Students hire as themselves usually
        }
    }, [roleType]);

    const companyOptions = useMemo(
        () => [...new Set([String(companyName || '').trim(), ...COMPANY_SUGGESTIONS].filter(Boolean))].slice(0, 6),
        [companyName]
    );
    const skillOptions = useMemo(
        () => hasExactRoleTitle ? [...new Set((exactRoleDefaults.skills || []).filter(Boolean))].slice(0, 8) : [],
        [exactRoleDefaults.skills, hasExactRoleTitle]
    );
    const skillSearchOptions = useMemo(
        () => buildAutocompleteOptions(skillSearchDraft, skillOptions, 60),
        [skillOptions, skillSearchDraft]
    );
    const licenseOptions = useMemo(
        () => hasExactRoleTitle ? [...new Set((exactRoleDefaults.certifications || []).filter(Boolean))].slice(0, 8) : [],
        [exactRoleDefaults.certifications, hasExactRoleTitle]
    );
    const districtSuggestions = useMemo(
        () => buildAutocompleteOptions(district, apDistrictOptions, 6),
        [apDistrictOptions, district]
    );
    const localityHints = useMemo(
        () => getApLocalityHints(district),
        [district]
    );
    const localitySuggestions = useMemo(
        () => buildAutocompleteOptions(locality, localityHints, 6),
        [locality, localityHints]
    );
    const selectedMustHaveSkills = useMemo(() => parseCommaList(mustHaveSkills, 40, 120), [mustHaveSkills]);
    const selectedGoodToHaveSkills = useMemo(() => parseCommaList(goodToHaveSkills, 30, 120), [goodToHaveSkills]);
    const selectedLanguages = useMemo(() => parseCommaList(languages, 12, 60), [languages]);
    const selectedLicenses = useMemo(() => parseCommaList(mandatoryLicensesText, 20, 120), [mandatoryLicensesText]);
    const selectedQuestions = useMemo(() => parseLineList(screeningQuestionsText, 20, 250), [screeningQuestionsText]);
    const hasDraftContent = useMemo(() => ([
        roleType,
        title,
        companyName,
        profileName,
        hiringAsType,
        companyBrandPhoto,
        district,
        locality,
        remoteAllowed ? 'remote' : '',
        shift,
        openings,
        salaryMin,
        salaryMax,
        salaryRangeFallback,
        experienceMin,
        experienceMax,
        mustHaveSkills,
        goodToHaveSkills,
        languages,
        mandatoryLicensesText,
        screeningQuestionsText,
        customSkillInput,
        customLicenseInput,
        customQuestionInput,
        videoUrl,
    ].some((item) => {
        if (typeof item === 'boolean') return item;
        return Boolean(String(item || '').trim());
    })), [
        companyBrandPhoto,
        companyName,
        profileName,
        hiringAsType,
        customLicenseInput,
        customQuestionInput,
        customSkillInput,
        district,
        experienceMax,
        experienceMin,
        goodToHaveSkills,
        languages,
        locality,
        mandatoryLicensesText,
        mustHaveSkills,
        openings,
        remoteAllowed,
        roleType,
        salaryMax,
        salaryMin,
        salaryRangeFallback,
        screeningQuestionsText,
        shift,
        title,
        videoUrl,
    ]);

    useEffect(() => {
        if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    useEffect(() => {
        if (!draftHydrated) return;
        requestAnimationFrame(() => {
            contentScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: false });
        });
    }, [draftHydrated, studioStage]);

    useEffect(() => {
        let mounted = true;
        const hydrateDraft = async () => {
            if (route.params?.jobData || route.params?.videoUrl) {
                if (mounted) setDraftHydrated(true);
                return;
            }
            try {
                const rawDraft = await AsyncStorage.getItem(JOB_STUDIO_DRAFT_KEY);
                if (!rawDraft || !mounted) {
                    setDraftHydrated(true);
                    return;
                }
                const draft = JSON.parse(rawDraft);
                if (!draft || typeof draft !== 'object') {
                    setDraftHydrated(true);
                    return;
                }

                setRoleType(clampText(draft.roleType || '', 120));
                setTitle(clampText(draft.title || '', 120));
                setCompanyName(clampText(draft.companyName || '', 120));
                setProfileName(clampText(draft.profileName || '', 120));
                setHiringAsType(clampText(draft.hiringAsType || '', 40));
                setCompanyBrandPhoto(clampText(draft.companyBrandPhoto || '', 500));
                setDistrict(clampText(draft.district || '', 120));
                setLocality(clampText(draft.locality || '', 120));
                setRemoteAllowed(Boolean(draft.remoteAllowed));
                setShift(SHIFT_OPTIONS.some((option) => option.value === draft.shift) ? draft.shift : 'Flexible');
                setOpenings(clampText(draft.openings || '', 20));
                setSalaryMin(clampText(draft.salaryMin || '', 20));
                setSalaryMax(clampText(draft.salaryMax || '', 20));
                setSalaryRangeFallback(clampText(draft.salaryRangeFallback || '', 120));
                setExperienceMin(clampText(draft.experienceMin || '', 20));
                setExperienceMax(clampText(draft.experienceMax || '', 20));
                setMustHaveSkills(String(draft.mustHaveSkills || ''));
                setGoodToHaveSkills(String(draft.goodToHaveSkills || ''));
                setLanguages(String(draft.languages || ''));
                setMandatoryLicensesText(String(draft.mandatoryLicensesText || ''));
                setScreeningQuestionsText(String(draft.screeningQuestionsText || ''));
                setVideoUrl(clampText(draft.videoUrl || '', 500));
            } catch (_error) {
                // Ignore draft restore issues and keep the studio open.
            } finally {
                if (mounted) setDraftHydrated(true);
            }
        };
        hydrateDraft();
        return () => {
            mounted = false;
        };
    }, [route.params?.jobData, route.params?.videoUrl]);

    useEffect(() => {
        if (!draftHydrated || draftPersistencePausedRef.current) return;
        const draftPayload = {

            roleType,
            title,
            companyName,
            profileName,
            hiringAsType,
            companyBrandPhoto,
            district,
            locality,
            remoteAllowed,
            shift,
            openings,
            salaryMin,
            salaryMax,
            salaryRangeFallback,
            experienceMin,
            experienceMax,
            mustHaveSkills,
            goodToHaveSkills,
            languages,
            mandatoryLicensesText,
            screeningQuestionsText,
            videoUrl,
        };
        const persistDraft = async () => {
            try {
                if (hasDraftContent) {
                    await AsyncStorage.setItem(JOB_STUDIO_DRAFT_KEY, JSON.stringify(draftPayload));
                } else {
                    await AsyncStorage.removeItem(JOB_STUDIO_DRAFT_KEY);
                }
            } catch (_error) {
                // Keep typing flow uninterrupted if draft persistence fails.
            }
        };
        persistDraft();
    }, [
        companyBrandPhoto,
        companyName,
        profileName,
        hiringAsType,
        district,
        draftHydrated,
        experienceMax,
        experienceMin,
        goodToHaveSkills,
        hasDraftContent,
        languages,
        locality,
        mandatoryLicensesText,
        mustHaveSkills,
        openings,
        remoteAllowed,
        roleType,
        salaryMax,
        salaryMin,
        salaryRangeFallback,
        screeningQuestionsText,
        shift,

        title,
        videoUrl,
    ]);

    useEffect(() => {
        if (route.params?.videoUrl) {
            setVideoUrl(route.params.videoUrl);
        }
        const rawJobData = route.params?.jobData;
        if (!rawJobData || typeof rawJobData !== 'object') return;

        const incomingTitle = clampText(rawJobData.title || '', 120);
        const incomingShift = clampText(rawJobData.shift || '', 40);
        const incomingSalaryRange = clampText(rawJobData.salaryRange || '', 120);
        const incomingRequirements = Array.isArray(rawJobData.requirements) ? rawJobData.requirements : [];
        const incomingDistrict = clampText(rawJobData.district || '', 120);
        const incomingMandal = clampText(rawJobData.mandal || '', 120);
        const incomingLocation = clampText(rawJobData.locationLabel || rawJobData.location || '', 120);

        if (incomingTitle) setTitle(incomingTitle);
        if (SHIFT_OPTIONS.some((option) => option.value === incomingShift)) setShift(incomingShift);
        if (incomingSalaryRange) {
            const parsed = parseSalaryRange(incomingSalaryRange);
            if (parsed.min) setSalaryMin(parsed.min);
            if (parsed.max) setSalaryMax(parsed.max);
            setSalaryRangeFallback(incomingSalaryRange);
        }
        if (incomingRequirements.length) {
            setMustHaveSkills(incomingRequirements.join(', '));
        }
        if (incomingDistrict || incomingLocation) {
            if (incomingDistrict) {
                setDistrict(incomingDistrict);
            }
            if (incomingMandal) {
                setLocality(incomingMandal);
            }
        }
        if (!incomingDistrict && incomingLocation) {
            const matchingDistrict = apDistrictOptions.find((option) => normalizeText(incomingLocation).includes(normalizeText(option)));
            if (matchingDistrict) {
                setDistrict(matchingDistrict);
                const localityTokens = incomingLocation
                    .split(',')
                    .map((token) => clampText(token, 120))
                    .filter(Boolean)
                    .filter((token) => normalizeText(token) !== normalizeText(matchingDistrict));
                if (localityTokens.length > 0) {
                    setLocality(localityTokens[0]);
                }
            } else {
                setDistrict(incomingLocation);
            }
        }
    }, [apDistrictOptions, route.params]);

    useEffect(() => {
        const fetchEmployerProfile = async () => {
            try {
                const { data } = await client.get('/api/users/profile', {
                    __skipApiErrorHandler: true,
                    params: { role: 'employer' },
                });
                const fetchedName = clampText(data?.profile?.name || '', 120);
                const profileCompany = clampText(data?.profile?.companyName || '', 120);
                const profileBrandPhoto = clampText(
                    data?.profile?.logoUrl
                    || data?.profile?.avatar
                    || data?.organization?.logoUrl
                    || '',
                    500
                );
                
                if (fetchedName && !profileName) {
                    setProfileName(fetchedName);
                }

                if (profileCompany && !companyName) {
                    setCompanyName(profileCompany);
                }

                if (!hiringAsType && (fetchedName || profileCompany)) {
                    setHiringAsType(profileCompany ? 'company' : 'profile'); 
                }

                if (profileBrandPhoto && !companyBrandPhoto) {
                    setCompanyBrandPhoto(profileBrandPhoto);
                }
                if (!district) {
                    setDistrict(clampText(data?.profile?.district || data?.profile?.location || '', 120));
                }
                if (!locality) {
                    setLocality(clampText(data?.profile?.mandal || '', 120));
                }
            } catch (_error) {
                // Keep studio usable without prefill.
            }
        };
        fetchEmployerProfile();
    }, [companyBrandPhoto, companyName, profileName, hiringAsType, district, locality]);

    const computedSalaryRange = useMemo(() => {
        const minValue = formatNumberWithCommas(salaryMin);
        const maxValue = formatNumberWithCommas(salaryMax);
        if (minValue && maxValue) return `₹${minValue} - ₹${maxValue}`;
        if (minValue) return `₹${minValue}+`;
        if (maxValue) return `Up to ₹${maxValue}`;
        return clampText(salaryRangeFallback, 120);
    }, [salaryMin, salaryMax, salaryRangeFallback]);

    const resolvedLocation = useMemo(() => (
        [clampText(locality, 120), clampText(district, 120)].filter(Boolean).join(', ')
    ), [district, locality]);

    const resolvedEmployerName = useMemo(() => {
        const safeProfileName = clampText(profileName, 120);
        const safeCompanyName = clampText(companyName, 120);
        if (hiringAsType === 'profile' && safeProfileName) return safeProfileName;
        if (hiringAsType === 'company' && safeCompanyName) return safeCompanyName;
        if (hiringAsType === 'custom') return safeCompanyName;
        return safeCompanyName || safeProfileName;
    }, [companyName, hiringAsType, profileName]);

    const hasRoleSelection = Boolean(roleType && clampText(title, 120));
    const hasEmployerSelection = Boolean(resolvedEmployerName);
    const hasLocationSelection = Boolean(clampText(district, 120));
    const hasSalarySelection = Boolean(computedSalaryRange);
    const hasRequirementsSelection = selectedMustHaveSkills.length > 0;
    const showHiringDetails = hasRoleSelection;
    const showDistrictCard = showHiringDetails && hasEmployerSelection;
    const showLocalityCard = showDistrictCard && hasLocationSelection;
    const showWorkSetup = showDistrictCard && hasLocationSelection;
    const showWorkStyle = showWorkSetup && hasSalarySelection;
    const showRequirements = showWorkSetup && hasSalarySelection;
    const advancedSignalCount = [
        selectedGoodToHaveSkills.length,
        selectedLanguages.length,
        selectedLicenses.length,
        selectedQuestions.length,
        Boolean(clampText(companyBrandPhoto, 500)),
        Boolean(clampText(videoUrl, 500)),
        Boolean(clampText(openings, 20)),
        Boolean(clampText(experienceMin, 20) || clampText(experienceMax, 20)),
    ].filter(Boolean).length;
    const shouldShowEmployerInput = showHiringDetails && (
        hiringAsType === 'custom'
        || (!hiringAsType && !resolvedEmployerName)
        || (hiringAsType === 'company' && !clampText(companyName, 120))
    );
    const roleStageReady = hasRoleSelection;
    const basicsStageReady = hasEmployerSelection && hasLocationSelection;
    const setupStageReady = hasSalarySelection;
    const skillsStageReady = hasRequirementsSelection;
    const isPublishDisabled = (
        !hasRoleSelection
        || !hasEmployerSelection
        || !hasLocationSelection
        || !hasSalarySelection
        || !hasRequirementsSelection
        || saving
        || verifyingPost
    );

    useEffect(() => {
        if (!draftHydrated) return;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }, [showHiringDetails, showDistrictCard, showLocalityCard, showWorkSetup, showWorkStyle, showRequirements, draftHydrated]);

    useEffect(() => {
        if (!draftHydrated || stagePrimedRef.current) return;
        if (!roleType) {
            setStudioStage('family');
        } else if (!roleStageReady) {
            setStudioStage('role');
        } else if (!basicsStageReady) {
            setStudioStage('basics');
        } else if (!setupStageReady) {
            setStudioStage('setup');
        } else if (!skillsStageReady) {
            setStudioStage('skills');
        } else if (!companyBrandPhoto) {
            setStudioStage('advanced');
        } else {
            setStudioStage('photo');
        }
        stagePrimedRef.current = true;
    }, [basicsStageReady, companyBrandPhoto, draftHydrated, roleStageReady, roleType, setupStageReady, skillsStageReady]);

    const handleSelectRoleFamily = (nextFamily) => {
        const currentTitle = clampText(title, 120);
        const currentWasSuggested = getRoleTitlesForCategory(roleType).some(
            (roleTitle) => normalizeText(roleTitle) === normalizeText(currentTitle)
        );
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setRoleType(nextFamily);
        if (currentWasSuggested) {
            setTitle('');
        }
        setStudioStage('role');
    };

    const handleBackPress = () => {
        const stageIndex = STUDIO_STAGE_ORDER.indexOf(studioStage);
        if (stageIndex > 0) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage(STUDIO_STAGE_ORDER[stageIndex - 1]);
            return;
        }
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate('MainTab', { screen: 'My Jobs' });
    };

    const handleChangeFamily = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStudioStage('family');
    };

    const handleContinueStage = () => {
        if (studioStage === 'role') {
            if (!roleStageReady) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Choose role title', 'Pick or type the role title to continue.');
                return;
            }
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage('basics');
            return;
        }
        if (studioStage === 'basics') {
            if (!hasEmployerSelection) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Choose employer', 'Select who is hiring to continue.');
                return;
            }
            if (!hasLocationSelection) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Choose district', 'Select the district to continue.');
                return;
            }
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage('setup');
            return;
        }
        if (studioStage === 'setup') {
            if (!setupStageReady) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Add salary', 'Set the pay range to continue.');
                return;
            }
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage('skills');
            return;
        }
        if (studioStage === 'skills') {
            if (!skillsStageReady) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Add must-have skills', 'Choose at least one must-have skill to continue.');
                return;
            }
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage('advanced');
            return;
        }
        if (studioStage === 'advanced') {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setStudioStage('photo');
        }
    };

    const stageMeta = STUDIO_STAGE_META[studioStage] || STUDIO_STAGE_META.family;
    const selectedRoleFamilyVisual = selectedRoleFamily ? getRoleFamilyVisual(selectedRoleFamily.label) : null;
    const footerLabel = studioStage === 'photo' ? (verifyingPost ? 'Checking' : 'Publish job') : 'Continue';
    const footerEnabled = studioStage === 'photo'
        ? !isPublishDisabled
        : studioStage === 'role'
            ? roleStageReady
            : studioStage === 'basics'
                ? basicsStageReady
                : studioStage === 'setup'
                    ? setupStageReady
                    : studioStage === 'skills'
                        ? skillsStageReady
                        : studioStage === 'advanced'
                            ? true
                    : false;



    const handleSuggestRequirements = async (isAuto = false) => {
        const safeTitle = clampText(title, 120);
        if (!safeTitle) {
            if (!isAuto) Alert.alert('Add role title', 'Pick or type the role title first.');
            return;
        }
        setAiLoading(true);
        try {
            const { data } = await client.post('/api/jobs/suggest', { jobTitle: safeTitle }, { __skipApiErrorHandler: true });
            const structured = data?.data && typeof data.data === 'object' ? data.data : {};
            const suggestions = Array.isArray(structured.requirements)
                ? structured.requirements
                : (Array.isArray(data?.suggestions) ? data.suggestions : []);
            const suggestedShift = Array.isArray(structured.shiftSuggestions)
                ? structured.shiftSuggestions.find((item) => SHIFT_OPTIONS.some((option) => option.value === item))
                : '';
            
            // Auto mode only patches fields if they are completely empty
            if (suggestions.length && (!isAuto || !mustHaveSkills)) {
                setMustHaveSkills(suggestions.slice(0, 12).join(', '));
            }
            if (suggestedShift && (!isAuto || !shift)) {
                setShift(suggestedShift);
            }
            
            if (!suggestions.length && !suggestedShift && !isAuto) {
                Alert.alert('No suggestions yet', 'Please continue with your own role signals for now.');
            }
        } catch (_error) {
            if (!isAuto) Alert.alert('Suggestion unavailable', 'Could not fetch role suggestions right now.');
        } finally {
            setAiLoading(false);
        }
    };

    // Co-founder touch: Automatically suggest requirements when a title is firmly chosen
    useEffect(() => {
        const safeTitle = clampText(title, 120);
        if (!safeTitle || draftHydrated === false) return;
        
        const timeoutId = setTimeout(() => {
            if (!mustHaveSkills) {
                handleSuggestRequirements(true);
            }
        }, 1000); // Wait 1s after title stops changing
        
        return () => clearTimeout(timeoutId);
    }, [title, draftHydrated]);

    const handleSuggestQuestions = async () => {
        const safeTitle = clampText(title, 120);
        if (!safeTitle) {
            Alert.alert('Add role title', 'Pick or type the role title first.');
            return;
        }
        setAiQuestionsLoading(true);
        try {
            const { data } = await client.post('/api/features/ai/interview-questions', {
                jobTitle: safeTitle,
                skills: selectedMustHaveSkills.slice(0, 12),
            }, { __skipApiErrorHandler: true });
            const questions = Array.isArray(data?.questions)
                ? data.questions.map((entry) => clampText(entry, 200)).filter(Boolean)
                : [];
            if (!questions.length) {
                Alert.alert('No questions yet', 'Please add screening questions manually.');
                return;
            }
            setScreeningQuestionsText((prev) => {
                const merged = [...new Set([...parseLineList(prev, 40, 250), ...questions])].slice(0, 20);
                return merged.join('\n');
            });
        } catch (_error) {
            Alert.alert('Suggestion unavailable', 'Could not fetch screening questions right now.');
        } finally {
            setAiQuestionsLoading(false);
        }
    };

    const uploadCompanyBrandPhoto = async (uri, mimeType = 'image/jpeg') => {
        const safeUri = String(uri || '').trim();
        if (!safeUri) return '';

        const fileName = safeUri.split('/').pop() || `employer-brand-${Date.now()}.jpg`;
        const formData = new FormData();
        formData.append('avatar', { uri: safeUri, name: fileName, type: mimeType });

        const response = await client.post('/api/settings/avatar', formData, {
            __allowWhenCircuitOpen: true,
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 15000,
        });

        return String(response?.data?.avatarUrl || safeUri).trim();
    };

    const handlePickCompanyBrandPhoto = async () => {
        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (permission?.status !== 'granted') {
                Alert.alert('Permission needed', 'Allow photo access to choose a company or office photo.');
                return;
            }

            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                allowsEditing: false,
                quality: 0.82,
            });

            if (result?.canceled || !result?.assets?.length) return;

            const asset = result.assets[0];
            const nextUri = String(asset?.uri || '').trim();
            if (!nextUri) return;

            setCompanyBrandPhoto(nextUri);
        } catch (error) {
            Alert.alert('Photo unavailable', extractApiErrorMessage(error, 'Could not add company photo right now.'));
        } finally {
            setUploadingCompanyBrand(false);
        }
    };

    const handleAddCustomSkill = () => {
        const nextValue = clampText(customSkillInput, 80);
        if (!nextValue) return;
        setMustHaveSkills((prev) => appendCommaToken(prev, nextValue));
        setCustomSkillInput('');
    };

    const handleAddCustomLicense = () => {
        const nextValue = clampText(customLicenseInput, 80);
        if (!nextValue) return;
        setMandatoryLicensesText((prev) => appendCommaToken(prev, nextValue));
        setCustomLicenseInput('');
    };

    const handleAddCustomQuestion = () => {
        const nextValue = clampText(customQuestionInput, 200);
        if (!nextValue) return;
        setScreeningQuestionsText((prev) => (prev ? `${prev}\n${nextValue}` : nextValue));
        setCustomQuestionInput('');
    };

    const clearSavedDraft = async () => {
        draftPersistencePausedRef.current = true;
        try {
            await AsyncStorage.removeItem(JOB_STUDIO_DRAFT_KEY);
        } catch (_error) {
            // Ignore cleanup issues after a successful post.
        }
    };

    const verifyRecentJobCreation = async (payload) => {
        for (let attempt = 0; attempt < JOB_POST_VERIFY_ATTEMPTS; attempt += 1) {
            if (attempt > 0) {
                await wait(JOB_POST_VERIFY_DELAY_MS);
            }
            try {
                const { data } = await client.get('/api/jobs/my-jobs', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    __disableBaseFallback: true,
                    __maxRetries: 0,
                    timeout: JOB_POST_VERIFY_REQUEST_TIMEOUT_MS,
                    params: { page: 1, limit: 8 },
                });
                const jobs = Array.isArray(data?.data) ? data.data : [];
                const matchedJob = jobs.find((job) => (
                    normalizeText(job?.title) === normalizeText(payload.title)
                    && normalizeText(job?.companyName) === normalizeText(payload.companyName)
                    && (
                        !normalizeText(payload.location)
                        || normalizeText(job?.location) === normalizeText(payload.location)
                    )
                ));
                if (matchedJob) {
                    return matchedJob;
                }
            } catch (_error) {
                // Continue verification attempts quietly.
            }
        }
        return null;
    };

    const handleOpenTalent = () => {
        const navigateToTalent = () => navigation.navigate('MainTab', { screen: 'Talent' });
        if (!hasDraftContent) {
            navigateToTalent();
            return;
        }
        Alert.alert(
            'Open Talent?',
            'Your current job draft will stay saved. You can come back and continue from where you stopped.',
            [
                { text: 'Stay', style: 'cancel' },
                { text: 'Open Talent', onPress: navigateToTalent },
            ]
        );
    };

    const handlePostJob = async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => { });
        const safeTitle = clampText(title, 120);
        const safeCompanyName = clampText(resolvedEmployerName, 120);
        const safeLocation = clampText(resolvedLocation, 120);
        const safeSalaryRange = clampText(computedSalaryRange, 120);
        const mustHave = selectedMustHaveSkills.map((item) => clampText(item, 120)).filter(Boolean);
        const goodToHave = selectedGoodToHaveSkills.map((item) => clampText(`Nice to have: ${item}`, 120)).filter(Boolean);
        const languageList = selectedLanguages.map((item) => clampText(item, 60)).filter(Boolean);
        const minExpValue = clampNonNegativeInt(experienceMin);
        const maxExpValue = clampNonNegativeInt(experienceMax);
        const openingsValue = clampNonNegativeInt(openings);

        if (!roleType || !safeTitle || !safeCompanyName || !safeLocation) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            Alert.alert('Missing basics', 'Role, company, and AP location are required.');
            return;
        }
        if (!safeSalaryRange) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            Alert.alert('Missing salary', 'Add salary so matching can rank talent correctly.');
            return;
        }
        if (!mustHave.length) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            Alert.alert('Missing must-have skills', 'Select at least one core skill.');
            return;
        }
        if (minExpValue !== null && maxExpValue !== null && maxExpValue < minExpValue) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            Alert.alert('Invalid experience range', 'Maximum experience should be greater than minimum experience.');
            return;
        }

        const requirements = [
            ...mustHave,
            ...goodToHave,
            ...(languageList.length ? [clampText(`Language: ${languageList.join(', ')}`, 120)] : []),
            ...(minExpValue !== null || maxExpValue !== null ? [clampText(`Experience: ${minExpValue ?? 0}-${maxExpValue ?? 'plus'} years`, 120)] : []),
            ...(openingsValue !== null ? [clampText(`Openings: ${openingsValue}`, 120)] : []),
            clampText(`Role type: ${roleType}`, 120),
        ].filter(Boolean).slice(0, 50);

        const mandatoryLicenses = selectedLicenses.map((item) => clampText(item, 120)).filter(Boolean);
        const screeningQuestions = selectedQuestions.map((item) => clampText(item, 250)).filter(Boolean);
        const minSalaryValue = clampNonNegativeInt(salaryMin);
        const maxSalaryValue = clampNonNegativeInt(salaryMax);
        const pendingBrandPhoto = isLocalAssetUri(companyBrandPhoto) ? companyBrandPhoto : '';

        const payload = {
            title: safeTitle,
            companyName: safeCompanyName,
            salaryRange: safeSalaryRange,
            location: safeLocation,
            district: clampText(district, 120),
            mandal: clampText(locality, 120),
            locationLabel: safeLocation,
            requirements,
            screeningQuestions,
            shift,
            mandatoryLicenses,
            remoteAllowed: Boolean(remoteAllowed),
            ...(openingsValue !== null ? { openings: openingsValue } : {}),
            ...(minSalaryValue !== null ? { minSalary: minSalaryValue } : {}),
            ...(maxSalaryValue !== null ? { maxSalary: maxSalaryValue } : {}),
        };

        setSaving(true);
        setVerifyingPost(false);
        try {
            await withTimeout(
                client.post('/api/jobs', payload, {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    __disableBaseFallback: true,
                    __maxRetries: 0,
                    timeout: JOB_POST_TIMEOUT_MS,
                }),
                JOB_POST_TIMEOUT_MS + 1200,
                'Job post timed out.',
            );
            if (pendingBrandPhoto) {
                setUploadingCompanyBrand(true);
                uploadCompanyBrandPhoto(pendingBrandPhoto)
                    .then((uploadedUri) => {
                        if (uploadedUri) {
                            setCompanyBrandPhoto(uploadedUri);
                        }
                    })
                    .catch((photoError) => {
                        logger.warn('Company photo sync failed after job publish:', photoError?.message || photoError);
                    })
                    .finally(() => {
                        setUploadingCompanyBrand(false);
                    });
            }
            await clearSavedDraft();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            navigation.navigate('MainTab', {
                screen: 'My Jobs',
                params: { source: 'job_posted' },
            });
        } catch (error) {
            const timedOut = normalizeText(error?.message).includes('timed out');
            if (timedOut) {
                setSaving(false);
                setVerifyingPost(true);
                const matchedJob = await verifyRecentJobCreation(payload);
                setVerifyingPost(false);
                if (matchedJob) {
                    await clearSavedDraft();
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                    navigation.navigate('MainTab', {
                        screen: 'My Jobs',
                        params: { source: 'job_posted' },
                    });
                    return;
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
                Alert.alert('Still checking', 'We could not confirm the latest post yet. Open My Jobs and pull down once before retrying.');
                return;
            }
            const reason = extractApiErrorMessage(error, 'Please review the job studio and try again.');
            logger.warn('Job post failed:', reason);
            setVerifyingPost(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            Alert.alert('Could not post job', reason);
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
            <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
            <View style={[styles.statusBarFill, { height: insets.top }]} />
            <KeyboardAvoidingView
                style={styles.screenCanvas}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
            >
                <View style={styles.headerChrome}>
                    <TouchableOpacity
                        onPress={handleBackPress}
                        style={styles.backButton}
                        activeOpacity={0.86}
                    >
                        <Ionicons name="chevron-back" size={22} color={C.white} />
                    </TouchableOpacity>
                    <View style={styles.headerTextWrap}>
                        <Text style={styles.headerTitle}>{stageMeta.header}</Text>
                    </View>
                </View>

                <ScrollView
                    ref={contentScrollRef}
                    contentContainerStyle={[
                        styles.content,
                        { paddingBottom: studioStage === 'family' ? 32 : Math.max(insets.bottom, 18) + 132 },
                    ]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                >
                    {studioStage === 'family' ? (
                        <View style={styles.familyStageWrap}>
                            <View style={styles.familyStageIntro}>
                                <Text style={styles.familyStageTitle}>What kind of role are you posting?</Text>
                                <Text style={styles.familyStageSubtitle}>Start with the work family.</Text>
                            </View>
                            <View style={styles.roleGrid}>
                                {roleFamilyOptions.map((item) => {
                                    const selected = roleType === item.label;
                                    const visual = getRoleFamilyVisual(item.label);
                                    return (
                                        <TouchableOpacity
                                            key={item.label}
                                            style={[styles.roleCard, selected ? styles.roleCardActive : null]}
                                            onPress={() => handleSelectRoleFamily(item.label)}
                                            activeOpacity={0.9}
                                        >
                                            <View
                                                style={[
                                                    styles.roleCardIcon,
                                                    { backgroundColor: visual.tint },
                                                    selected ? styles.roleCardIconActive : null,
                                                ]}
                                            >
                                                <Text style={styles.roleCardEmoji}>{visual.emoji}</Text>
                                            </View>
                                            <Text style={[styles.roleCardTitle, selected ? styles.roleCardTitleActive : null]}>{item.label}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    ) : (
                        <>
                            <View style={styles.stageHeroCard}>
                                {selectedRoleFamily ? (
                                    <View style={styles.familySelectionBanner}>
                                        <View style={styles.familySelectionCopy}>
                                            <View
                                                style={[
                                                    styles.familySelectionIcon,
                                                    { backgroundColor: selectedRoleFamilyVisual?.tint || C.accentDim },
                                                ]}
                                            >
                                                <Text style={styles.familySelectionEmoji}>{selectedRoleFamilyVisual?.emoji || '💼'}</Text>
                                            </View>
                                            <View style={styles.familySelectionTextWrap}>
                                                <Text style={styles.familySelectionLabel}>Work family</Text>
                                                <Text style={styles.familySelectionTitle}>{selectedRoleFamily.label}</Text>
                                            </View>
                                        </View>
                                        <TouchableOpacity style={styles.changeFamilyButton} onPress={handleChangeFamily} activeOpacity={0.86}>
                                            <Text style={styles.changeFamilyButtonText}>Change</Text>
                                        </TouchableOpacity>
                                    </View>
                                ) : null}
                                <Text style={styles.stageHeroTitle}>{stageMeta.title}</Text>
                                <Text style={styles.stageHeroSubtitle}>{stageMeta.subtitle}</Text>
                            </View>

                            {studioStage === 'role' ? (
                                <View style={styles.formSectionCard}>
                                    <Text style={styles.sectionLabel}>Role title</Text>
                                    <TypeaheadInput
                                        value={title}
                                        onChangeText={setTitle}
                                        suggestions={roleSearchOptions}
                                        onSelectSuggestion={(roleTitle) => setTitle(clampText(roleTitle, 120))}
                                        placeholder="Search or type role"
                                        pickerTitle="Role title"
                                        pickerHint={`Roles for ${roleType || 'this family'}`}
                                        emptyStateText="Nothing matched yet. Type your own role."
                                    />
                                    {roleType ? (
                                        <>
                                            <Text style={styles.inlineLabel}>Recommended roles</Text>
                                            <View style={styles.choiceWrap}>
                                                {roleTitleOptions.map((roleTitle) => (
                                                    <StudioChip
                                                        key={roleTitle}
                                                        label={roleTitle}
                                                        selected={normalizeText(title) === normalizeText(roleTitle)}
                                                        onPress={() => setTitle(roleTitle)}
                                                    />
                                                ))}
                                            </View>
                                        </>
                                    ) : null}
                                </View>
                            ) : null}

                            {studioStage === 'basics' ? (
                                <>
                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Employer name</Text>
                                        <View style={styles.choiceWrap}>
                                            {profileName ? (
                                                <StudioChip
                                                    label="Your profile"
                                                    selected={hiringAsType === 'profile'}
                                                    onPress={() => setHiringAsType('profile')}
                                                />
                                            ) : null}
                                            {companyOptions
                                                .filter((comp) => comp && normalizeText(comp) !== normalizeText(profileName))
                                                .slice(0, 2)
                                                .map((comp) => (
                                                    <StudioChip
                                                        key={comp}
                                                        label={comp}
                                                        selected={hiringAsType === 'company' && normalizeText(companyName) === normalizeText(comp)}
                                                        onPress={() => {
                                                            setHiringAsType('company');
                                                            setCompanyName(comp);
                                                        }}
                                                    />
                                                ))}
                                            <StudioChip
                                                label="Custom name"
                                                selected={hiringAsType === 'custom'}
                                                onPress={() => setHiringAsType('custom')}
                                            />
                                        </View>
                                        {shouldShowEmployerInput ? (
                                            <FieldPicker
                                                label="Employer"
                                                value={companyName}
                                                placeholder="Select"
                                                suggestions={companyOptions}
                                                onChangeText={setCompanyName}
                                                onSelect={setCompanyName}
                                                title="Employer or company"
                                                hint="Choose employer or company"
                                                last
                                            />
                                        ) : resolvedEmployerName ? (
                                            <View style={styles.previewPill}>
                                                <Text style={styles.previewPillText}>{resolvedEmployerName}</Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Location</Text>
                                        <FieldPicker
                                            label="District"
                                            value={district}
                                            placeholder="Select"
                                            suggestions={districtSuggestions}
                                            onChangeText={setDistrict}
                                            onSelect={setDistrict}
                                            title="District"
                                            hint="Choose district"
                                        />
                                        {clampText(district, 120) ? (
                                            <FieldPicker
                                                label="Local area"
                                                value={locality}
                                                placeholder="Area"
                                                suggestions={localitySuggestions}
                                                onChangeText={setLocality}
                                                onSelect={setLocality}
                                                title="Local area"
                                                hint="Choose local area"
                                                last
                                            />
                                        ) : null}
                                    </View>
                                </>
                            ) : null}

                            {studioStage === 'setup' ? (
                                <>
                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Salary band</Text>
                                        <View style={styles.choiceWrap}>
                                            {QUICK_SALARY_PRESETS.map((preset) => (
                                                <StudioChip
                                                    key={preset.label}
                                                    label={preset.label}
                                                    selected={normalizeText(salaryMin) === normalizeText(preset.min) && normalizeText(salaryMax) === normalizeText(preset.max)}
                                                    onPress={() => {
                                                        setSalaryMin(preset.min);
                                                        setSalaryMax(preset.max);
                                                    }}
                                                />
                                            ))}
                                        </View>
                                        <View style={styles.previewPill}>
                                            <Text style={styles.previewPillText}>{computedSalaryRange || 'Set your pay range'}</Text>
                                        </View>
                                        <FieldPicker
                                            label="Minimum pay"
                                            value={salaryMin}
                                            displayValue={salaryMin ? `₹${Number(salaryMin || 0).toLocaleString('en-IN')}` : ''}
                                            placeholder="₹ —"
                                            onChangeText={setSalaryMin}
                                            onSelect={setSalaryMin}
                                            keyboardType="number-pad"
                                            title="Minimum pay"
                                            hint="Enter minimum pay"
                                        />
                                        <FieldPicker
                                            label="Maximum pay"
                                            value={salaryMax}
                                            displayValue={salaryMax ? `₹${Number(salaryMax || 0).toLocaleString('en-IN')}` : ''}
                                            placeholder="₹ —"
                                            onChangeText={setSalaryMax}
                                            onSelect={setSalaryMax}
                                            keyboardType="number-pad"
                                            title="Maximum pay"
                                            hint="Enter maximum pay"
                                            last
                                        />
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Shift</Text>
                                        <View style={styles.choiceWrap}>
                                            {SHIFT_OPTIONS.map((item) => (
                                                <StudioChip
                                                    key={item.value}
                                                    label={item.value}
                                                    selected={shift === item.value}
                                                    onPress={() => setShift(item.value)}
                                                />
                                            ))}
                                        </View>

                                        <Text style={styles.sectionLabel}>Work mode</Text>
                                        <View style={styles.choiceWrap}>
                                            <StudioChip
                                                label="On-site"
                                                selected={!remoteAllowed}
                                                onPress={() => setRemoteAllowed(false)}
                                            />
                                            <StudioChip
                                                label="Remote"
                                                selected={remoteAllowed}
                                                onPress={() => setRemoteAllowed(true)}
                                            />
                                        </View>
                                    </View>
                                </>
                            ) : null}

                            {studioStage === 'skills' ? (
                                <View style={styles.formSectionCard}>
                                    <View style={styles.editorHeaderRow}>
                                        <Text style={styles.sectionLabel}>Must-have skills</Text>
                                        <Text style={styles.editorCountBadge}>{selectedMustHaveSkills.length}</Text>
                                    </View>
                                    <TypeaheadInput
                                        value={skillSearchDraft}
                                        onChangeText={setSkillSearchDraft}
                                        suggestions={skillSearchOptions}
                                        onSelectSuggestion={(skill) => {
                                            const nextSkill = clampText(skill, 120);
                                            if (!nextSkill) return;
                                            setMustHaveSkills((prev) => appendCommaToken(prev, nextSkill));
                                            setSkillSearchDraft('');
                                        }}
                                        placeholder="Search skills"
                                        pickerTitle="Must-have skills"
                                        pickerHint="Pick role skills or type your own."
                                        emptyStateText="No suggested skills yet. Type your own skill."
                                    />
                                    {skillOptions.length ? (
                                        <>
                                            <Text style={styles.inlineLabel}>Recommended skills</Text>
                                            <View style={styles.choiceWrap}>
                                                {skillOptions.map((skill) => (
                                                    <StudioChip
                                                        key={skill}
                                                        label={skill}
                                                        selected={selectedMustHaveSkills.some((item) => normalizeText(item) === normalizeText(skill))}
                                                        onPress={() => setMustHaveSkills((prev) => toggleCommaToken(prev, skill))}
                                                    />
                                                ))}
                                            </View>
                                        </>
                                    ) : (
                                        <Text style={styles.fieldHelperText}>
                                            {aiLoading ? 'Pulling role-based skills...' : 'Pick from suggestions or type your own must-have skills.'}
                                        </Text>
                                    )}
                                    {selectedMustHaveSkills.length ? (
                                        <>
                                            <Text style={styles.inlineLabel}>Selected</Text>
                                            <View style={styles.choiceWrap}>
                                                {selectedMustHaveSkills.map((skill) => (
                                                    <StudioChip
                                                        key={`selected-${skill}`}
                                                        label={skill}
                                                        selected
                                                        onPress={() => setMustHaveSkills((prev) => toggleCommaToken(prev, skill))}
                                                    />
                                                ))}
                                            </View>
                                        </>
                                    ) : null}
                                    <View style={styles.aiRow}>
                                        <TouchableOpacity
                                            style={styles.aiAction}
                                            onPress={() => handleSuggestRequirements(false)}
                                            activeOpacity={0.86}
                                            disabled={aiLoading}
                                        >
                                            <Ionicons name="sparkles-outline" size={15} color="#6d28d9" />
                                            <Text style={styles.aiActionText}>{aiLoading ? 'Refreshing...' : 'Refresh skills'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : null}

                            {studioStage === 'advanced' ? (
                                <>
                                    <View style={styles.formSectionCard}>
                                        <View style={styles.studioMiniGrid}>
                                            <View style={styles.studioMiniCard}>
                                                <Text style={styles.sectionLabel}>Openings</Text>
                                                <View style={styles.choiceWrap}>
                                                    {OPENING_OPTIONS.map((count) => (
                                                        <StudioChip
                                                            key={`opening-${count}`}
                                                            label={`${count}`}
                                                            selected={String(openings) === String(count)}
                                                            onPress={() => setOpenings(String(count))}
                                                        />
                                                    ))}
                                                </View>
                                                <TextInput
                                                    style={styles.textInput}
                                                    placeholder="Custom openings"
                                                    placeholderTextColor="#94a3b8"
                                                    keyboardType="number-pad"
                                                    value={openings}
                                                    onChangeText={setOpenings}
                                                />
                                            </View>
                                            <View style={styles.studioMiniCard}>
                                                <Text style={styles.sectionLabel}>Experience</Text>
                                                <View style={styles.choiceWrap}>
                                                    {QUICK_EXPERIENCE_PRESETS.map((preset) => (
                                                        <StudioChip
                                                            key={preset.label}
                                                            label={preset.label}
                                                            selected={normalizeText(experienceMin) === normalizeText(preset.min) && normalizeText(experienceMax) === normalizeText(preset.max)}
                                                            onPress={() => {
                                                                setExperienceMin(preset.min);
                                                                setExperienceMax(preset.max);
                                                            }}
                                                        />
                                                    ))}
                                                </View>
                                                <View style={styles.inputRow}>
                                                    <TextInput
                                                        style={[styles.textInput, styles.halfInput]}
                                                        placeholder="Min years"
                                                        placeholderTextColor="#94a3b8"
                                                        keyboardType="number-pad"
                                                        value={experienceMin}
                                                        onChangeText={setExperienceMin}
                                                    />
                                                    <TextInput
                                                        style={[styles.textInput, styles.halfInput]}
                                                        placeholder="Max years"
                                                        placeholderTextColor="#94a3b8"
                                                        keyboardType="number-pad"
                                                        value={experienceMax}
                                                        onChangeText={setExperienceMax}
                                                    />
                                                </View>
                                            </View>
                                        </View>
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Languages</Text>
                                        <View style={styles.choiceWrap}>
                                            {AP_LANGUAGE_OPTIONS.map((language) => (
                                                <StudioChip
                                                    key={language}
                                                    label={language}
                                                    selected={selectedLanguages.some((item) => normalizeText(item) === normalizeText(language))}
                                                    onPress={() => setLanguages((prev) => toggleCommaToken(prev, language))}
                                                />
                                            ))}
                                        </View>
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <View style={styles.editorHeaderRow}>
                                            <Text style={styles.sectionLabel}>Nice-to-have skills</Text>
                                            <Text style={styles.editorCountBadge}>{selectedGoodToHaveSkills.length}</Text>
                                        </View>
                                        {skillOptions.length ? (
                                            <View style={styles.choiceWrap}>
                                                {skillOptions.map((skill) => (
                                                    <StudioChip
                                                        key={`nice-${skill}`}
                                                        label={skill}
                                                        selected={selectedGoodToHaveSkills.some((item) => normalizeText(item) === normalizeText(skill))}
                                                        onPress={() => setGoodToHaveSkills((prev) => toggleCommaToken(prev, skill))}
                                                    />
                                                ))}
                                            </View>
                                        ) : null}
                                        <TextInput
                                            style={[styles.textInput, styles.textAreaInput]}
                                            placeholder="Bonus skills"
                                            placeholderTextColor="#94a3b8"
                                            multiline
                                            value={goodToHaveSkills}
                                            onChangeText={setGoodToHaveSkills}
                                        />
                                        <View style={styles.addRow}>
                                            <TextInput
                                                style={[styles.textInput, styles.addInput]}
                                                placeholder="Add skill"
                                                placeholderTextColor="#94a3b8"
                                                value={customSkillInput}
                                                onChangeText={setCustomSkillInput}
                                            />
                                            <TouchableOpacity style={styles.addButton} onPress={handleAddCustomSkill} activeOpacity={0.86}>
                                                <Text style={styles.addButtonText}>Add</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <View style={styles.editorHeaderRow}>
                                            <Text style={styles.sectionLabel}>Licenses</Text>
                                            <Text style={styles.editorCountBadge}>{selectedLicenses.length}</Text>
                                        </View>
                                        {licenseOptions.length ? (
                                            <View style={styles.choiceWrap}>
                                                {licenseOptions.map((license) => (
                                                    <StudioChip
                                                        key={license}
                                                        label={license}
                                                        selected={selectedLicenses.some((item) => normalizeText(item) === normalizeText(license))}
                                                        onPress={() => setMandatoryLicensesText((prev) => toggleCommaToken(prev, license))}
                                                    />
                                                ))}
                                            </View>
                                        ) : null}
                                        <View style={styles.addRow}>
                                            <TextInput
                                                style={[styles.textInput, styles.addInput]}
                                                placeholder="Add proof"
                                                placeholderTextColor="#94a3b8"
                                                value={customLicenseInput}
                                                onChangeText={setCustomLicenseInput}
                                            />
                                            <TouchableOpacity style={styles.addButton} onPress={handleAddCustomLicense} activeOpacity={0.86}>
                                                <Text style={styles.addButtonText}>Add</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Screening questions</Text>
                                        <View style={styles.aiRow}>
                                            <TouchableOpacity
                                                style={styles.aiAction}
                                                onPress={handleSuggestQuestions}
                                                activeOpacity={0.86}
                                                disabled={aiQuestionsLoading}
                                            >
                                                <Ionicons name="help-circle-outline" size={15} color="#6d28d9" />
                                                <Text style={styles.aiActionText}>{aiQuestionsLoading ? 'Thinking...' : 'AI questions'}</Text>
                                            </TouchableOpacity>
                                        </View>
                                        <View style={styles.choiceWrap}>
                                            {COMMON_QUESTIONS.map((question) => (
                                                <StudioChip
                                                    key={question}
                                                    label={question}
                                                    selected={selectedQuestions.some((item) => normalizeText(item) === normalizeText(question))}
                                                    onPress={() => setScreeningQuestionsText((prev) => toggleLineToken(prev, question))}
                                                />
                                            ))}
                                        </View>
                                        <View style={styles.addRow}>
                                            <TextInput
                                                style={[styles.textInput, styles.addInput]}
                                                placeholder="Add question"
                                                placeholderTextColor="#94a3b8"
                                                value={customQuestionInput}
                                                onChangeText={setCustomQuestionInput}
                                            />
                                            <TouchableOpacity style={styles.addButton} onPress={handleAddCustomQuestion} activeOpacity={0.86}>
                                                <Text style={styles.addButtonText}>Add</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </>
                            ) : null}

                            {studioStage === 'photo' ? (
                                <>
                                    <View style={styles.formSectionCard}>
                                        <Text style={styles.sectionLabel}>Company photo</Text>
                                        <View style={styles.companyPhotoCard}>
                                            {!companyBrandPhoto ? (
                                                <View style={styles.companyPhotoBadge}>
                                                    <Text style={styles.companyPhotoBadgeText}>Recommended</Text>
                                                </View>
                                            ) : null}
                                            {companyBrandPhoto ? (
                                                <Image source={{ uri: companyBrandPhoto }} style={styles.companyPhotoPreview} />
                                            ) : (
                                                <View style={styles.companyPhotoPlaceholder}>
                                                    <Ionicons name="business-outline" size={24} color="#6d28d9" />
                                                    <Text style={styles.companyPhotoPlaceholderText}>Add office photo</Text>
                                                </View>
                                            )}
                                            <TouchableOpacity
                                                style={styles.companyPhotoButton}
                                                onPress={handlePickCompanyBrandPhoto}
                                                activeOpacity={0.86}
                                                disabled={uploadingCompanyBrand}
                                            >
                                                <Text style={styles.companyPhotoButtonText}>
                                                    {uploadingCompanyBrand ? 'Uploading...' : companyBrandPhoto ? 'Change photo' : 'Choose photo'}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {videoUrl ? (
                                        <View style={styles.formSectionCard}>
                                            <View style={styles.videoCard}>
                                                <Ionicons name="videocam-outline" size={18} color="#6d28d9" />
                                                <Text style={styles.videoText}>Video introduction is already linked to this job.</Text>
                                            </View>
                                        </View>
                                    ) : null}
                                </>
                            ) : null}
                        </>
                    )}
                </ScrollView>

                {studioStage !== 'family' ? (
                    <FormFooter
                        label={footerLabel}
                        enabled={footerEnabled}
                        loading={studioStage === 'photo' ? (saving || verifyingPost) : false}
                        onPress={studioStage === 'photo' ? handlePostJob : handleContinueStage}
                    />
                ) : null}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: C.bg,
    },
    screenCanvas: {
        flex: 1,
        backgroundColor: C.bg,
    },
    statusBarFill: {
        backgroundColor: C.bg,
    },
    headerChrome: {
        paddingHorizontal: 18,
        paddingTop: 10,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: C.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: C.border,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '500',
        color: C.white,
    },
    content: {
        paddingTop: 16,
        paddingBottom: 12,
    },
    familyStageWrap: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    familyStageIntro: {
        paddingHorizontal: 4,
        marginBottom: 18,
    },
    familyStageTitle: {
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '700',
        color: '#0f172a',
        letterSpacing: -0.3,
    },
    familyStageSubtitle: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        color: '#64748b',
        fontWeight: '500',
    },
    stageHeroCard: {
        marginHorizontal: 16,
        marginBottom: 14,
        paddingHorizontal: 18,
        paddingVertical: 18,
        borderRadius: 28,
        backgroundColor: '#fcfcff',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#ebe7ff',
    },
    stageHeroEyebrow: {
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.7,
        color: '#94a3b8',
    },
    stageHeroTitle: {
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '700',
        color: '#0f172a',
        letterSpacing: -0.3,
    },
    stageHeroSubtitle: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        color: '#64748b',
        fontWeight: '500',
    },
    stageSummaryRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 14,
        marginBottom: 14,
    },
    stageSummaryPill: {
        borderRadius: 14,
        backgroundColor: '#ffffff',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#e2e8f0',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    stageSummaryLabel: {
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: '#94a3b8',
    },
    stageSummaryValue: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: '700',
        color: '#0f172a',
    },
    formSectionCard: {
        marginHorizontal: 16,
        marginBottom: 14,
        backgroundColor: '#ffffff',
        borderRadius: 24,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: '#e2e8f0',
        paddingHorizontal: 16,
        paddingVertical: 16,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 16,
        elevation: 1,
    },
    guidedFieldCard: {
        backgroundColor: 'transparent',
        paddingHorizontal: 0,
        paddingVertical: 0,
        marginBottom: 10,
    },
    guidedFieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 8,
    },
    guidedFieldCopy: {
        flex: 1,
    },
    studioMiniGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 2,
    },
    studioMiniCard: {
        backgroundColor: C.surface2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        width: '48.4%',
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    editorCard: {
        backgroundColor: C.surface2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: C.border,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
    },
    editorHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    editorCountBadge: {
        minWidth: 28,
        borderRadius: 999,
        backgroundColor: C.accentDim,
        paddingHorizontal: 8,
        paddingVertical: 4,
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
        textAlign: 'center',
    },
    sectionLabel: {
        marginTop: 4,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
    },
    inlineLabel: {
        marginTop: 2,
        marginBottom: 8,
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: '#94a3b8',
    },
    roleGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 8,
    },
    roleCard: {
        width: '48%',
        minHeight: 148,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 18,
        justifyContent: 'space-between',
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.03,
        shadowRadius: 18,
        elevation: 1,
    },
    roleCardActive: {
        borderColor: '#c4b5fd',
        backgroundColor: '#faf5ff',
        shadowColor: '#7c3aed',
        shadowOpacity: 0.08,
    },
    roleCardIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roleCardIconActive: {
        transform: [{ scale: 1.02 }],
    },
    roleCardEmoji: {
        fontSize: 28,
    },
    roleCardTitle: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '700',
        color: '#0f172a',
    },
    roleCardTitleActive: {
        color: '#6d28d9',
    },
    roleCardHint: {
        fontSize: 11,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '400',
    },
    roleCardHintActive: {
        color: '#64748b',
    },
    familySelectionBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 16,
    },
    familySelectionCopy: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    familySelectionIcon: {
        width: 52,
        height: 52,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    familySelectionEmoji: {
        fontSize: 24,
    },
    familySelectionTextWrap: {
        flex: 1,
    },
    familySelectionLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: '#94a3b8',
    },
    familySelectionTitle: {
        marginTop: 4,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '700',
        color: '#0f172a',
    },
    changeFamilyButton: {
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#d8b4fe',
        alignItems: 'center',
        justifyContent: 'center',
    },
    changeFamilyButtonText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#6d28d9',
    },
    roleSearchInput: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#dbe4f0',
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        fontWeight: '600',
        color: '#0f172a',
        backgroundColor: '#f8fafc',
        marginBottom: 12,
    },
    fieldHelperText: {
        marginTop: -2,
        marginBottom: 4,
        fontSize: 11.5,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '400',
    },
    choiceWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 12,
    },
    studioChip: {
        minHeight: 40,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#dbe4f0',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    studioChipSelected: {
        borderColor: '#d8b4fe',
        backgroundColor: '#f5f3ff',
    },
    studioChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
    },
    studioChipTextSelected: {
        color: '#6d28d9',
    },
    choiceChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
    },
    choiceChipAccent: {
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
    },
    choiceChipActive: {
        borderColor: '#7c3aed',
        backgroundColor: '#7c3aed',
    },
    choiceChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
    },
    choiceChipTextAccent: {
        color: '#6d28d9',
    },
    choiceChipTextActive: {
        color: '#ffffff',
    },
    typeaheadShell: {
        borderWidth: 1,
        borderColor: '#dde5f0',
        borderRadius: 16,
        backgroundColor: '#f8fafc',
        paddingHorizontal: 14,
        minHeight: 50,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
    },
    typeaheadShellDisabled: {
        opacity: 0.52,
    },
    typeaheadDisplayText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#0f172a',
    },
    typeaheadPlaceholderText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '700',
        color: '#94a3b8',
    },
    typeaheadChevron: {
        fontSize: 11,
        fontWeight: '900',
        color: '#7c8798',
    },
    typeaheadPickerOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    typeaheadPickerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.28)',
    },
    typeaheadPickerSheet: {
        backgroundColor: '#f8fafc',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 20,
        minHeight: Dimensions.get('window').height * 0.56,
        maxHeight: Dimensions.get('window').height * 0.82,
        ...SHADOWS.lg,
    },
    typeaheadPickerHandle: {
        alignSelf: 'center',
        width: 44,
        height: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(148, 163, 184, 0.38)',
        marginBottom: 12,
    },
    typeaheadPickerHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 12,
    },
    typeaheadPickerHeaderCopy: {
        flex: 1,
        gap: 4,
    },
    typeaheadPickerTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: '#0f172a',
    },
    typeaheadPickerHint: {
        fontSize: 11.5,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '600',
    },
    typeaheadPickerCloseBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    typeaheadPickerSearchShell: {
        marginBottom: 10,
    },
    typeaheadInput: {
        flex: 1,
        fontSize: 15,
        color: '#0f172a',
        fontWeight: '700',
        paddingVertical: 12,
    },
    typeaheadPickerList: {
        flex: 1,
    },
    typeaheadPickerListContent: {
        paddingBottom: 12,
        gap: 8,
    },
    typeaheadPickerItem: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    typeaheadPickerItemPrimary: {
        borderColor: '#d8b4fe',
        backgroundColor: '#faf5ff',
    },
    typeaheadPickerItemPrimaryText: {
        color: '#6d28d9',
    },
    typeaheadPickerItemPrimaryMeta: {
        color: '#7c3aed',
    },
    typeaheadPickerEmptyState: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    typeaheadPickerEmptyText: {
        fontSize: 11.5,
        color: '#64748b',
        fontWeight: '700',
        textAlign: 'center',
    },
    typeaheadItemText: {
        fontSize: 13.5,
        color: '#0f172a',
        fontWeight: '700',
    },
    typeaheadItemMeta: {
        marginTop: 3,
        fontSize: 11,
        color: '#64748b',
        fontWeight: '600',
    },
    textInput: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#dde5f0',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        fontWeight: '600',
        color: '#0f172a',
        backgroundColor: '#f8fafc',
        marginBottom: 12,
    },
    textAreaInput: {
        minHeight: 96,
        textAlignVertical: 'top',
    },
    suggestionList: {
        marginTop: -4,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        borderRadius: 16,
        backgroundColor: '#ffffff',
        overflow: 'hidden',
    },
    suggestionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eef2f7',
    },
    suggestionText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#334155',
    },
    companyPhotoCard: {
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        padding: 12,
        gap: 12,
        overflow: 'hidden',
        marginBottom: 8,
    },
    companyPhotoBadge: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        backgroundColor: '#ede9fe',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    companyPhotoBadgeText: {
        fontSize: 10.5,
        fontWeight: '900',
        color: '#6d28d9',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    companyPhotoPreview: {
        width: '100%',
        height: 170,
        borderRadius: 18,
        backgroundColor: '#ede9fe',
    },
    companyPhotoPlaceholder: {
        width: '100%',
        minHeight: 170,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#d8b4fe',
        borderStyle: 'dashed',
        backgroundColor: 'rgba(255,255,255,0.76)',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingHorizontal: 18,
    },
    companyPhotoPlaceholderText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#6d28d9',
    },
    companyPhotoButton: {
        borderRadius: 16,
        backgroundColor: '#6d28d9',
        paddingHorizontal: 16,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    companyPhotoButtonText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#ffffff',
    },
    toggleCard: {
        marginTop: 4,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e7ecf4',
        backgroundColor: '#fbfcff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
    },
    setupSummaryRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 12,
    },
    setupSummaryTile: {
        ...SCREEN_CHROME.metricTile,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
    },
    setupSummaryLabel: {
        fontSize: 10.5,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.7,
        color: '#94a3b8',
    },
    setupSummaryValue: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: '800',
        color: '#111827',
    },
    toggleCopy: {
        flex: 1,
    },
    toggleTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#111827',
    },
    toggleHint: {
        marginTop: 4,
        fontSize: 12,
        lineHeight: 17,
        color: '#64748b',
        fontWeight: '600',
    },
    videoCard: {
        marginTop: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    videoText: {
        flex: 1,
        fontSize: 13,
        lineHeight: 18,
        color: '#5b21b6',
        fontWeight: '700',
    },
    advancedToggleCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e4eaf3',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
    },
    advancedToggleCopy: {
        flex: 1,
    },
    advancedToggleTitle: {
        fontSize: 13.5,
        fontWeight: '800',
        color: '#0f172a',
    },
    advancedToggleHint: {
        marginTop: 4,
        fontSize: 11.5,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '600',
    },
    advancedDrawer: {
        gap: 10,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 10,
    },
    halfInput: {
        flex: 1,
    },
    previewPill: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
    },
    previewPillText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#475569',
    },
    aiRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 4,
        marginBottom: 12,
    },
    fitSummaryStrip: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    fitSummaryChip: {
        ...SCREEN_CHROME.metricTile,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
    },
    fitSummaryValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#111827',
    },
    fitSummaryLabel: {
        marginTop: 3,
        fontSize: 10.5,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: '#94a3b8',
    },
    aiAction: {
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    aiActionText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#6d28d9',
    },
    addRow: {
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
        marginBottom: 12,
    },
    addInput: {
        flex: 1,
        marginBottom: 0,
    },
    addButton: {
        minWidth: 72,
        borderRadius: 16,
        backgroundColor: C.accent,
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addButtonText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#ffffff',
    },
    reviewCard: {
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        backgroundColor: '#fbfcff',
        paddingHorizontal: 14,
        paddingVertical: 8,
        marginTop: 10,
    },
    publishReadyCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        marginBottom: 14,
    },
    publishReadyBadge: {
        alignSelf: 'flex-start',
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    publishReadyBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    publishReadyTitle: {
        marginTop: 10,
        fontSize: 13,
        lineHeight: 19,
        fontWeight: '700',
        color: '#5b21b6',
    },
    reviewRow: {
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#eef2f7',
    },
    reviewLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c8798',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    reviewValue: {
        marginTop: 4,
        fontSize: 14,
        fontWeight: '700',
        color: '#0f172a',
    },
    summarySection: {
        marginTop: 14,
        paddingHorizontal: 4,
    },
    summaryTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    summaryBody: {
        marginTop: 6,
        fontSize: 13,
        lineHeight: 19,
        color: '#475569',
        fontWeight: '600',
    },
    modalActionsSingle: {
        alignItems: 'center',
        marginTop: 8,
        gap: 12,
        paddingTop: 10,
        paddingBottom: 10,
        borderTopWidth: 1,
        borderTopColor: '#e8edf5',
    },
    studioBackLink: {
        ...SCREEN_CHROME.signalChip,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    studioBackLinkText: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '800',
    },
    studioStepPrimaryBtn: {
        width: '100%',
        borderRadius: 18,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    studioStepPrimaryBtnDisabled: {
        opacity: 0.45,
    },
    studioStepPrimaryBtnSurface: {
        width: '100%',
        paddingVertical: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#7c3aed',
    },
    studioStepPrimaryBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
    stickyFooter: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: '#e7edf5',
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 10,
        alignItems: 'center',
    },
    stickyFooterMeta: {
        width: '100%',
        fontSize: 11.5,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '600',
        textAlign: 'center',
    },
});
