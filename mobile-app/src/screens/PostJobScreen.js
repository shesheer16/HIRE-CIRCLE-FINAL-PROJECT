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
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    UIManager,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';
import { logger } from '../utils/logger';
import {
    AP_LANGUAGE_OPTIONS,
    getApDistrictOptions,
    getApLocalityHints,
} from '../config/apProfileCatalog';
import {
    getRoleCategories,
    getRoleDefaults,
    getRoleTitlesForCategory,
    hasExactRoleMatch,
} from '../config/workerRoleCatalog';
import { SCREEN_CHROME, SHADOWS } from '../theme/theme';

const SHIFT_OPTIONS = [
    { value: 'Day', icon: 'sunny-outline', hint: 'Day operations' },
    { value: 'Night', icon: 'moon-outline', hint: 'Night coverage' },
    { value: 'Flexible', icon: 'time-outline', hint: 'Shift rotation' },
];

const STEP_TITLES = [
    { key: 'basics', label: 'Basics', title: 'Role and employer' },
    { key: 'setup', label: 'AP Setup', title: 'Where and how this role runs' },
    { key: 'fit', label: 'Job Fit', title: 'Signals that guide matching' },
    { key: 'review', label: 'Review', title: 'Questions and publish' },
];

const STEP_META = {
    basics: { icon: 'briefcase-outline', label: 'Basics', hint: 'Family, role, employer' },
    setup: { icon: 'location-outline', label: 'AP Setup', hint: 'District, locality, shift' },
    fit: { icon: 'options-outline', label: 'Job Fit', hint: 'Salary, skills, proofs' },
    review: { icon: 'checkmark-done-outline', label: 'Review', hint: 'Questions and publish' },
};

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
    'Technology & Digital': { emoji: '💻', tint: 'rgba(99, 102, 241, 0.18)' },
    'Finance & Admin': { emoji: '📊', tint: 'rgba(45, 212, 191, 0.18)' },
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

const StudioChip = ({ label, selected, onPress, accent = false, icon = null }) => (
    <TouchableOpacity
        style={[
            styles.choiceChip,
            selected ? styles.choiceChipActive : null,
            accent && !selected ? styles.choiceChipAccent : null,
        ]}
        onPress={onPress}
        activeOpacity={0.84}
    >
        {icon ? <Ionicons name={icon} size={14} color={selected ? '#ffffff' : accent ? '#6d28d9' : '#475569'} /> : null}
        <Text style={[
            styles.choiceChipText,
            selected ? styles.choiceChipTextActive : null,
            accent && !selected ? styles.choiceChipTextAccent : null,
        ]}>
            {label}
        </Text>
    </TouchableOpacity>
);

const ReviewRow = ({ label, value }) => (
    <View style={styles.reviewRow}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue}>{value || 'Not set'}</Text>
    </View>
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
    const [stepIndex, setStepIndex] = useState(0);
    const [roleType, setRoleType] = useState('');
    const [title, setTitle] = useState('');
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
    const [aiLoading, setAiLoading] = useState(false);
    const [aiQuestionsLoading, setAiQuestionsLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [verifyingPost, setVerifyingPost] = useState(false);
    const [uploadingCompanyBrand, setUploadingCompanyBrand] = useState(false);
    const [draftHydrated, setDraftHydrated] = useState(false);
    const draftPersistencePausedRef = useRef(false);
    const contentScrollRef = useRef(null);

    const apDistrictOptions = useMemo(() => getApDistrictOptions(), []);
    const roleFamilyOptions = useMemo(() => ROLE_FAMILY_OPTIONS, []);
    const roleTitleOptions = useMemo(
        () => buildAutocompleteOptions(title, getRoleTitlesForCategory(roleType), 10),
        [roleType, title]
    );
    const exactRoleDefaults = useMemo(() => getRoleDefaults(title), [title]);
    const hasExactRoleTitle = useMemo(() => hasExactRoleMatch(title), [title]);
    const companyOptions = useMemo(
        () => [...new Set([String(companyName || '').trim(), ...COMPANY_SUGGESTIONS].filter(Boolean))].slice(0, 6),
        [companyName]
    );
    const skillOptions = useMemo(
        () => hasExactRoleTitle ? [...new Set((exactRoleDefaults.skills || []).filter(Boolean))].slice(0, 8) : [],
        [exactRoleDefaults.skills, hasExactRoleTitle]
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
    const readinessCount = [
        Boolean(roleType),
        Boolean(clampText(title, 120)),
        Boolean(clampText(companyName, 120)),
        Boolean(clampText(district, 120)),
        Boolean(computedSalaryRange),
        selectedMustHaveSkills.length > 0,
    ].filter(Boolean).length;
    const studioSignalCount = selectedMustHaveSkills.length + selectedLicenses.length + selectedQuestions.length;
    const hasDraftContent = useMemo(() => ([
        roleType,
        title,
        companyName,
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
            contentScrollRef.current?.scrollTo?.({ x: 0, y: 0, animated: true });
        });
    }, [draftHydrated, stepIndex]);

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
                setStepIndex(Number.isFinite(Number(draft.stepIndex)) ? Math.max(0, Math.min(Number(draft.stepIndex), STEP_TITLES.length - 1)) : 0);
                setRoleType(clampText(draft.roleType || '', 120));
                setTitle(clampText(draft.title || '', 120));
                setCompanyName(clampText(draft.companyName || '', 120));
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
            stepIndex,
            roleType,
            title,
            companyName,
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
        stepIndex,
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
                const profileCompany = clampText(data?.profile?.companyName || '', 120);
                const profileBrandPhoto = clampText(
                    data?.profile?.logoUrl
                    || data?.profile?.avatar
                    || data?.organization?.logoUrl
                    || '',
                    500
                );
                if (profileCompany && !companyName) {
                    setCompanyName(profileCompany);
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
    }, [companyBrandPhoto, companyName, district, locality]);

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

    const currentStep = STEP_TITLES[stepIndex] || STEP_TITLES[0];
    const studioRemainingCount = Math.max(0, 6 - readinessCount);
    const canAdvanceStep = useMemo(() => {
        if (stepIndex === 0) {
            return Boolean(roleType && clampText(title, 120) && clampText(companyName, 120));
        }
        if (stepIndex === 1) {
            return Boolean(clampText(district, 120));
        }
        if (stepIndex === 2) {
            return Boolean(computedSalaryRange && selectedMustHaveSkills.length);
        }
        return true;
    }, [
        companyName,
        computedSalaryRange,
        district,
        roleType,
        selectedMustHaveSkills.length,
        stepIndex,
        title,
    ]);

    const handleSuggestRequirements = async () => {
        const safeTitle = clampText(title, 120);
        if (!safeTitle) {
            Alert.alert('Add role title', 'Pick or type the role title first.');
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
            if (suggestions.length) {
                setMustHaveSkills(suggestions.slice(0, 12).join(', '));
            }
            if (suggestedShift) {
                setShift(suggestedShift);
            }
            if (!suggestions.length && !suggestedShift) {
                Alert.alert('No suggestions yet', 'Please continue with your own role signals for now.');
            }
        } catch (_error) {
            Alert.alert('Suggestion unavailable', 'Could not fetch role suggestions right now.');
        } finally {
            setAiLoading(false);
        }
    };

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

    const validateStep = (index) => {
        const safeTitle = clampText(title, 120);
        const safeCompany = clampText(companyName, 120);
        if (index === 0) {
            if (!roleType) {
                Alert.alert('Select role family', 'Choose one hiring family to continue.');
                return false;
            }
            if (!safeTitle) {
                Alert.alert('Add role title', 'Pick or type the role title.');
                return false;
            }
            if (!safeCompany) {
                Alert.alert('Add company', 'Enter the employer or company name.');
                return false;
            }
            return true;
        }
        if (index === 1) {
            if (!clampText(district, 120)) {
                Alert.alert('Add district', 'Type the district where this job should appear first.');
                return false;
            }
            return true;
        }
        if (index === 2) {
            if (!computedSalaryRange) {
                Alert.alert('Add salary', 'Choose or type a salary band.');
                return false;
            }
            if (!selectedMustHaveSkills.length) {
                Alert.alert('Add must-have skills', 'Select at least one skill so matching works properly.');
                return false;
            }
            return true;
        }
        return true;
    };

    const handleNextStep = () => {
        if (!validateStep(stepIndex)) return;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStepIndex((prev) => Math.min(prev + 1, STEP_TITLES.length - 1));
    };

    const handlePreviousStep = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setStepIndex((prev) => Math.max(prev - 1, 0));
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
        const safeTitle = clampText(title, 120);
        const safeCompanyName = clampText(companyName, 120);
        const safeLocation = clampText(resolvedLocation, 120);
        const safeSalaryRange = clampText(computedSalaryRange, 120);
        const mustHave = selectedMustHaveSkills.map((item) => clampText(item, 120)).filter(Boolean);
        const goodToHave = selectedGoodToHaveSkills.map((item) => clampText(`Nice to have: ${item}`, 120)).filter(Boolean);
        const languageList = selectedLanguages.map((item) => clampText(item, 60)).filter(Boolean);
        const minExpValue = clampNonNegativeInt(experienceMin);
        const maxExpValue = clampNonNegativeInt(experienceMax);
        const openingsValue = clampNonNegativeInt(openings);

        if (!roleType || !safeTitle || !safeCompanyName || !safeLocation) {
            Alert.alert('Missing basics', 'Role, company, and AP location are required.');
            return;
        }
        if (!safeSalaryRange) {
            Alert.alert('Missing salary', 'Add salary so matching can rank talent correctly.');
            return;
        }
        if (!mustHave.length) {
            Alert.alert('Missing must-have skills', 'Select at least one core skill.');
            return;
        }
        if (minExpValue !== null && maxExpValue !== null && maxExpValue < minExpValue) {
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
            Alert.alert('Job posted', pendingBrandPhoto ? 'Your new job is live. Company photo will finish syncing in the background.' : 'Your new job is live in My Jobs.', [
                { text: 'Open My Jobs', onPress: () => navigation.navigate('MainTab', { screen: 'My Jobs' }) },
            ]);
        } catch (error) {
            const timedOut = normalizeText(error?.message).includes('timed out');
            if (timedOut) {
                setSaving(false);
                setVerifyingPost(true);
                const matchedJob = await verifyRecentJobCreation(payload);
                setVerifyingPost(false);
                if (matchedJob) {
                    await clearSavedDraft();
                    Alert.alert(
                        'Job posted',
                        pendingBrandPhoto
                            ? 'Your job was created. Company photo will keep syncing in the background.'
                            : 'Your new job is live in My Jobs.',
                        [{ text: 'Open My Jobs', onPress: () => navigation.navigate('MainTab', { screen: 'My Jobs' }) }],
                    );
                    return;
                }
                Alert.alert('Still checking', 'We could not confirm the latest post yet. Open My Jobs and pull down once before retrying.');
                return;
            }
            const reason = extractApiErrorMessage(error, 'Please review the job studio and try again.');
            logger.warn('Job post failed:', reason);
            setVerifyingPost(false);
            Alert.alert('Could not post job', reason);
        } finally {
            setSaving(false);
        }
    };

    const currentStepMeta = STEP_META[currentStep.key] || STEP_META.basics;

    return (
        <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
            <StatusBar barStyle="light-content" backgroundColor="#6d28d9" />
            <View style={[styles.statusBarFill, { height: insets.top }]} />
            <KeyboardAvoidingView
                style={styles.screenCanvas}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
            >
                <View style={styles.headerChrome}>
                    <TouchableOpacity
                        onPress={() => {
                            if (navigation.canGoBack()) {
                                navigation.goBack();
                                return;
                            }
                            navigation.navigate('MainTab', { screen: 'My Jobs' });
                        }}
                        style={styles.backButton}
                        activeOpacity={0.86}
                    >
                        <Ionicons name="chevron-back" size={22} color="#0f172a" />
                    </TouchableOpacity>
                    <View style={styles.headerTextWrap}>
                        <Text style={styles.headerEyebrow}>JOB STUDIO</Text>
                        <Text style={styles.headerTitle}>Post job</Text>
                        <Text style={styles.headerSubtitle}>4 easy cards.</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.headerAction}
                        onPress={handleOpenTalent}
                        activeOpacity={0.86}
                    >
                        <Ionicons name="people-outline" size={18} color="#6d28d9" />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    ref={contentScrollRef}
                    contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 28 }]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                >
                    <View style={styles.fastSetupCard}>
                        <View style={styles.studioHeaderTopRow}>
                            <View style={styles.studioHeaderTopCopy}>
                                <Text style={styles.fastSetupTitle}>Step {stepIndex + 1} of {STEP_TITLES.length}</Text>
                                <Text style={styles.fastSetupText}>{currentStepMeta.label}</Text>
                            </View>
                            <View style={[styles.studioProgressPill, studioRemainingCount === 0 && styles.studioProgressPillDone]}>
                                <Text style={[styles.studioProgressPillText, studioRemainingCount === 0 && styles.studioProgressPillTextDone]}>
                                    {studioRemainingCount === 0 ? 'Ready' : `${studioRemainingCount} left`}
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.fastSetupStatus}>{currentStepMeta.hint}</Text>
                        <View style={styles.studioSegmentRail}>
                            {STEP_TITLES.map((step, index) => {
                                const meta = STEP_META[step.key] || STEP_META.basics;
                                const active = stepIndex === index;
                                const done = stepIndex > index;
                                const unlocked = index <= stepIndex;
                                return (
                                    <TouchableOpacity
                                        key={step.key}
                                        style={[
                                            styles.studioSegmentTab,
                                            active && styles.studioSegmentTabCurrent,
                                            done && styles.studioSegmentTabDone,
                                            !unlocked && styles.studioSegmentTabLocked,
                                        ]}
                                        onPress={() => {
                                            if (unlocked) {
                                                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                                                setStepIndex(index);
                                            }
                                        }}
                                        activeOpacity={unlocked ? 0.86 : 1}
                                        disabled={!unlocked}
                                    >
                                        <View style={[
                                            styles.studioSegmentBadge,
                                            active && styles.studioSegmentBadgeCurrent,
                                            done && styles.studioSegmentBadgeDone,
                                        ]}>
                                            {done ? (
                                                <Ionicons name="checkmark" size={12} color={active ? '#ffffff' : '#059669'} />
                                            ) : (
                                                <Ionicons
                                                    name={meta.icon}
                                                    size={12}
                                                    color={active ? '#ffffff' : unlocked ? '#6d28d9' : '#94a3b8'}
                                                />
                                            )}
                                        </View>
                                        <Text style={[
                                            styles.studioSegmentTabText,
                                            active && styles.studioSegmentTabTextCurrent,
                                            done && styles.studioSegmentTabTextDone,
                                            !unlocked && styles.studioSegmentTabTextLocked,
                                        ]}>
                                            {meta.label}
                                        </Text>
                                        <View style={[
                                            styles.studioSegmentTabDot,
                                            active && styles.studioSegmentTabDotCurrent,
                                            done && styles.studioSegmentTabDotDone,
                                        ]} />
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </View>

                    {stepIndex === 0 ? (
                        <View style={styles.formSectionCard}>
                            <View style={styles.formSectionHero}>
                                <View style={styles.formSectionHeroIcon}>
                                    <Ionicons name="briefcase-outline" size={18} color="#6d28d9" />
                                </View>
                                <View style={styles.formSectionHeroCopy}>
                                    <Text style={styles.formSectionTitle}>1. Basics</Text>
                                    <Text style={styles.formSectionSub}>Pick family, title, employer.</Text>
                                </View>
                            </View>

                            <View style={styles.studioSummaryRow}>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Family</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{roleType || 'Choose'}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Role</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{title || 'Choose'}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Employer</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{companyName || 'Add'}</Text>
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>1</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Work family</Text>
                                        <Text style={styles.guidedFieldHint}>Choose the hiring lane first. Role title comes next.</Text>
                                    </View>
                                </View>
                                <View style={styles.roleGrid}>
                                    {roleFamilyOptions.map((item) => {
                                        const selected = roleType === item.label;
                                        const visual = getRoleFamilyVisual(item.label);
                                        return (
                                            <TouchableOpacity
                                                key={item.label}
                                                style={[styles.roleCard, selected ? styles.roleCardActive : null]}
                                                onPress={() => {
                                                    const currentTitle = clampText(title, 120);
                                                    const currentWasSuggested = getRoleTitlesForCategory(roleType).some(
                                                        (roleTitle) => normalizeText(roleTitle) === normalizeText(currentTitle)
                                                    );
                                                    setRoleType(item.label);
                                                    if (currentWasSuggested) {
                                                        setTitle('');
                                                    }
                                                }}
                                                activeOpacity={0.86}
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
                                                <Text style={[styles.roleCardHint, selected ? styles.roleCardHintActive : null]}>{item.hint}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>2</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Role title</Text>
                                        <Text style={styles.guidedFieldHint}>
                                            {roleType ? 'Pick one from this family or type your own exact title.' : 'Choose a work family first.'}
                                        </Text>
                                    </View>
                                </View>
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
                                <TypeaheadInput
                                    value={title}
                                    onChangeText={setTitle}
                                    placeholder="Type exact job title"
                                    suggestions={roleTitleOptions}
                                    onSelectSuggestion={setTitle}
                                    pickerTitle="Choose the role title"
                                    pickerHint={roleType ? 'Suggested roles come from the selected work family. If yours is not listed, type it.' : 'Choose a work family first, then pick or type the role title.'}
                                    disabled={!roleType}
                                    emptyStateText={roleType ? 'No suggestions yet. Type the exact job title you want.' : 'Choose a work family first.'}
                                />
                                <Text style={styles.fieldHelperText}>
                                    {roleType
                                        ? 'You can pick a suggested title or type your own exact job title.'
                                        : 'Pick a work family first to unlock role suggestions.'}
                                </Text>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>3</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Company / hiring team</Text>
                                        <Text style={styles.guidedFieldHint}>Use the public employer name candidates should trust first.</Text>
                                    </View>
                                </View>
                                <TypeaheadInput
                                    value={companyName}
                                    onChangeText={setCompanyName}
                                    placeholder="Type employer or company name"
                                    suggestions={companyOptions}
                                    onSelectSuggestion={setCompanyName}
                                    pickerTitle="Choose the employer name"
                                    pickerHint="Pick one or type the exact company or hiring team name."
                                    emptyStateText="Type the company or hiring team name you want job seekers to see."
                                />
                                <Text style={styles.fieldHelperText}>This is the name shown on the job card and in the talent review flow.</Text>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>4</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Company photo</Text>
                                        <Text style={styles.guidedFieldHint}>Add one clear office or company photo. It syncs when you publish.</Text>
                                    </View>
                                </View>
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
                                <Text style={styles.fieldHelperText}>A real company visual helps job seekers trust the role faster.</Text>
                            </View>
                        </View>
                    ) : null}

                    {stepIndex === 1 ? (
                        <View style={styles.formSectionCard}>
                            <View style={styles.formSectionHero}>
                                <View style={styles.formSectionHeroIcon}>
                                    <Ionicons name="location-outline" size={18} color="#6d28d9" />
                                </View>
                                <View style={styles.formSectionHeroCopy}>
                                    <Text style={styles.formSectionTitle}>2. AP setup</Text>
                                    <Text style={styles.formSectionSub}>District first. Mandal or locality next.</Text>
                                </View>
                            </View>

                            <View style={styles.studioSummaryRow}>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>District</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{district || 'Choose'}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Locality</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{locality || 'Optional'}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Shift</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{shift || 'Choose'}</Text>
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>1</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>District *</Text>
                                        <Text style={styles.guidedFieldHint}>Type the district where the job should appear first.</Text>
                                    </View>
                                </View>
                                <TypeaheadInput
                                    value={district}
                                    onChangeText={setDistrict}
                                    placeholder="Search district"
                                    suggestions={districtSuggestions}
                                    onSelectSuggestion={setDistrict}
                                    pickerTitle="Choose the district"
                                    pickerHint="Pick a district or type your own. If yours is not listed, keep typing and use it."
                                    emptyStateText="No district suggestion yet. Type your district and continue."
                                />
                                <Text style={styles.fieldHelperText}>If your district is not listed, type it exactly and keep going.</Text>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>2</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Mandal / locality</Text>
                                        <Text style={styles.guidedFieldHint}>Add only if you want a tighter area.</Text>
                                    </View>
                                </View>
                                <TypeaheadInput
                                    value={locality}
                                    onChangeText={setLocality}
                                    placeholder={clampText(district, 40) ? 'Type mandal, city, or locality' : 'Enter district first'}
                                    suggestions={localitySuggestions}
                                    onSelectSuggestion={setLocality}
                                    pickerTitle="Choose the mandal or locality"
                                    pickerHint="Pick one or type your own mandal, town, or area."
                                    disabled={!clampText(district, 120)}
                                    emptyStateText={clampText(district, 120)
                                        ? 'No locality suggestion yet. Type the exact mandal, town, or area.'
                                        : 'Enter the district first.'}
                                />
                                <Text style={styles.fieldHelperText}>
                                    {clampText(district, 120)
                                        ? 'If your mandal is not listed, type it exactly and continue.'
                                        : 'Choose the district first to unlock mandal suggestions.'}
                                </Text>
                            </View>

                            <View style={styles.studioMiniGrid}>
                                <View style={styles.studioMiniCard}>
                                    <Text style={styles.sectionLabel}>Shift</Text>
                                    <View style={styles.choiceWrap}>
                                        {SHIFT_OPTIONS.map((item) => (
                                            <StudioChip
                                                key={item.value}
                                                label={item.value}
                                                selected={shift === item.value}
                                                onPress={() => setShift(item.value)}
                                                icon={item.icon}
                                            />
                                        ))}
                                    </View>
                                </View>
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
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>3</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Work mode</Text>
                                        <Text style={styles.guidedFieldHint}>Turn this on only if the role can be done away from site.</Text>
                                    </View>
                                </View>
                                <View style={styles.toggleCard}>
                                    <View style={styles.toggleCopy}>
                                        <Text style={styles.toggleTitle}>Remote allowed</Text>
                                        <Text style={styles.toggleHint}>Keep it off for on-site jobs.</Text>
                                    </View>
                                    <Switch
                                        value={remoteAllowed}
                                        onValueChange={setRemoteAllowed}
                                        trackColor={{ false: '#d9e2ef', true: '#c4b5fd' }}
                                        thumbColor={remoteAllowed ? '#6d28d9' : '#ffffff'}
                                    />
                                </View>
                            </View>

                            {videoUrl ? (
                                <View style={styles.videoCard}>
                                    <Ionicons name="videocam-outline" size={18} color="#6d28d9" />
                                    <Text style={styles.videoText}>Video introduction is linked to this job.</Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}

                    {stepIndex === 2 ? (
                        <View style={styles.formSectionCard}>
                            <View style={styles.formSectionHero}>
                                <View style={styles.formSectionHeroIcon}>
                                    <Ionicons name="options-outline" size={18} color="#6d28d9" />
                                </View>
                                <View style={styles.formSectionHeroCopy}>
                                    <Text style={styles.formSectionTitle}>3. Job fit</Text>
                                    <Text style={styles.formSectionSub}>Only keep the signals that help matching.</Text>
                                </View>
                            </View>

                            <View style={styles.studioSummaryRow}>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Salary</Text>
                                    <Text style={styles.studioSummaryValue} numberOfLines={1}>{computedSalaryRange || 'Set'}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Must-have</Text>
                                    <Text style={styles.studioSummaryValue}>{selectedMustHaveSkills.length}</Text>
                                </View>
                                <View style={styles.studioSummaryPill}>
                                    <Text style={styles.studioSummaryLabel}>Proofs</Text>
                                    <Text style={styles.studioSummaryValue}>{selectedLicenses.length}</Text>
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>1</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Salary band *</Text>
                                        <Text style={styles.guidedFieldHint}>Choose a range or type your own.</Text>
                                    </View>
                                </View>
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
                                <View style={styles.inputRow}>
                                    <TextInput
                                        style={[styles.textInput, styles.halfInput]}
                                        placeholder="Min salary"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="number-pad"
                                        value={salaryMin}
                                        onChangeText={setSalaryMin}
                                    />
                                    <TextInput
                                        style={[styles.textInput, styles.halfInput]}
                                        placeholder="Max salary"
                                        placeholderTextColor="#94a3b8"
                                        keyboardType="number-pad"
                                        value={salaryMax}
                                        onChangeText={setSalaryMax}
                                    />
                                </View>
                                <View style={styles.previewPill}>
                                    <Text style={styles.previewPillText}>{computedSalaryRange || 'Choose or type a salary band'}</Text>
                                </View>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>2</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Experience</Text>
                                        <Text style={styles.guidedFieldHint}>Use only if experience matters for the role.</Text>
                                    </View>
                                </View>
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

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>3</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Languages</Text>
                                        <Text style={styles.guidedFieldHint}>Add only the languages really needed for this job.</Text>
                                    </View>
                                </View>
                                <View style={styles.choiceWrap}>
                                    {AP_LANGUAGE_OPTIONS.map((language) => (
                                        <StudioChip
                                            key={language}
                                            label={language}
                                            selected={selectedLanguages.some((item) => normalizeText(item) === normalizeText(language))}
                                            onPress={() => setLanguages((prev) => toggleCommaToken(prev, language))}
                                            accent
                                        />
                                    ))}
                                </View>
                            </View>

                            <View style={styles.aiRow}>
                                <TouchableOpacity
                                    style={styles.aiAction}
                                    onPress={handleSuggestRequirements}
                                    activeOpacity={0.86}
                                    disabled={aiLoading}
                                >
                                    <Ionicons name="sparkles-outline" size={15} color="#6d28d9" />
                                    <Text style={styles.aiActionText}>{aiLoading ? 'Thinking…' : 'AI skills'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.aiAction}
                                    onPress={handleSuggestQuestions}
                                    activeOpacity={0.86}
                                    disabled={aiQuestionsLoading}
                                >
                                    <Ionicons name="help-circle-outline" size={15} color="#6d28d9" />
                                    <Text style={styles.aiActionText}>{aiQuestionsLoading ? 'Thinking…' : 'AI questions'}</Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.editorCard}>
                                <View style={styles.editorHeaderRow}>
                                    <Text style={styles.sectionLabel}>Must-have skills *</Text>
                                    <Text style={styles.editorCountBadge}>{selectedMustHaveSkills.length}</Text>
                                </View>
                                {skillOptions.length ? (
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
                                ) : (
                                    <Text style={styles.fieldHelperText}>Type the exact role title above to unlock role-based skill suggestions.</Text>
                                )}
                                <View style={styles.addRow}>
                                    <TextInput
                                        style={[styles.textInput, styles.addInput]}
                                        placeholder="Type extra must-have skill"
                                        placeholderTextColor="#94a3b8"
                                        value={customSkillInput}
                                        onChangeText={setCustomSkillInput}
                                    />
                                    <TouchableOpacity style={styles.addButton} onPress={handleAddCustomSkill} activeOpacity={0.86}>
                                        <Text style={styles.addButtonText}>Add</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.editorCard}>
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
                                                accent
                                            />
                                        ))}
                                    </View>
                                ) : null}
                            </View>

                            <View style={styles.editorCard}>
                                <View style={styles.editorHeaderRow}>
                                    <Text style={styles.sectionLabel}>Licenses / proofs</Text>
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
                                ) : (
                                    <Text style={styles.fieldHelperText}>Role-based proofs appear when the role title matches a known job title.</Text>
                                )}
                                <View style={styles.addRow}>
                                    <TextInput
                                        style={[styles.textInput, styles.addInput]}
                                        placeholder="Type extra license or proof"
                                        placeholderTextColor="#94a3b8"
                                        value={customLicenseInput}
                                        onChangeText={setCustomLicenseInput}
                                    />
                                    <TouchableOpacity style={styles.addButton} onPress={handleAddCustomLicense} activeOpacity={0.86}>
                                        <Text style={styles.addButtonText}>Add</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : null}

                    {stepIndex === 3 ? (
                        <View style={styles.formSectionCard}>
                            <View style={styles.formSectionHero}>
                                <View style={styles.formSectionHeroIcon}>
                                    <Ionicons name="checkmark-done-outline" size={18} color="#6d28d9" />
                                </View>
                                <View style={styles.formSectionHeroCopy}>
                                    <Text style={styles.formSectionTitle}>4. Review</Text>
                                    <Text style={styles.formSectionSub}>Final questions and publish check.</Text>
                                </View>
                            </View>

                            <View style={styles.publishReadyCard}>
                                <View style={styles.publishReadyBadge}>
                                    <Text style={styles.publishReadyBadgeText}>{`${readinessCount}/6 ready`}</Text>
                                </View>
                                <Text style={styles.publishReadyTitle}>Publish when basics, AP setup, salary, and must-have skills look right.</Text>
                            </View>

                            <View style={styles.guidedFieldCard}>
                                <View style={styles.guidedFieldHeader}>
                                    <View style={styles.guidedFieldIndex}><Text style={styles.guidedFieldIndexText}>1</Text></View>
                                    <View style={styles.guidedFieldCopy}>
                                        <Text style={styles.sectionLabel}>Screening questions</Text>
                                        <Text style={styles.guidedFieldHint}>Keep only the questions that help you decide fast.</Text>
                                    </View>
                                </View>
                                <View style={styles.choiceWrap}>
                                    {COMMON_QUESTIONS.map((question) => (
                                        <StudioChip
                                            key={question}
                                            label={question}
                                            selected={selectedQuestions.some((item) => normalizeText(item) === normalizeText(question))}
                                            onPress={() => setScreeningQuestionsText((prev) => toggleLineToken(prev, question))}
                                            accent
                                        />
                                    ))}
                                </View>
                                <View style={styles.addRow}>
                                    <TextInput
                                        style={[styles.textInput, styles.addInput]}
                                        placeholder="Type your own question"
                                        placeholderTextColor="#94a3b8"
                                        value={customQuestionInput}
                                        onChangeText={setCustomQuestionInput}
                                    />
                                    <TouchableOpacity style={styles.addButton} onPress={handleAddCustomQuestion} activeOpacity={0.86}>
                                        <Text style={styles.addButtonText}>Add</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.reviewCard}>
                                <ReviewRow label="Role" value={title} />
                                <ReviewRow label="Company" value={companyName} />
                                <ReviewRow label="Location" value={resolvedLocation} />
                                <ReviewRow label="Shift" value={shift} />
                                <ReviewRow label="Salary" value={computedSalaryRange} />
                                <ReviewRow
                                    label="Experience"
                                    value={experienceMin || experienceMax ? `${experienceMin || 0}-${experienceMax || 'plus'} yrs` : ''}
                                />
                            </View>

                            <View style={styles.summarySection}>
                                <Text style={styles.summaryTitle}>Must-have skills</Text>
                                <Text style={styles.summaryBody}>{selectedMustHaveSkills.join(', ') || 'None added yet'}</Text>
                            </View>
                            <View style={styles.summarySection}>
                                <Text style={styles.summaryTitle}>Licenses / proofs</Text>
                                <Text style={styles.summaryBody}>{selectedLicenses.join(', ') || 'None added yet'}</Text>
                            </View>
                            <View style={styles.summarySection}>
                                <Text style={styles.summaryTitle}>Screening questions</Text>
                                <Text style={styles.summaryBody}>{selectedQuestions.join(' • ') || 'None added yet'}</Text>
                            </View>
                        </View>
                    ) : null}

                    <View style={styles.modalActionsSingle}>
                        <TouchableOpacity
                            style={styles.studioBackLink}
                            onPress={stepIndex > 0 ? handlePreviousStep : () => navigation.goBack()}
                            activeOpacity={0.86}
                        >
                            <Text style={styles.studioBackLinkText}>{stepIndex > 0 ? 'Back' : 'Cancel'}</Text>
                        </TouchableOpacity>

                        {stepIndex < STEP_TITLES.length - 1 ? (
                            <TouchableOpacity
                                style={[styles.studioStepPrimaryBtn, !canAdvanceStep && styles.studioStepPrimaryBtnDisabled]}
                                onPress={handleNextStep}
                                activeOpacity={0.9}
                                disabled={!canAdvanceStep}
                            >
                                <LinearGradient colors={['#7c3aed', '#a855f7']} style={styles.studioStepPrimaryBtnGradient}>
                                    <Text style={styles.studioStepPrimaryBtnText}>Next</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.studioStepPrimaryBtn, (saving || verifyingPost) && styles.studioStepPrimaryBtnDisabled]}
                                onPress={handlePostJob}
                                activeOpacity={0.9}
                                disabled={saving || verifyingPost}
                            >
                                <LinearGradient colors={['#7c3aed', '#a855f7']} style={styles.studioStepPrimaryBtnGradient}>
                                    {saving ? (
                                        <ActivityIndicator color="#ffffff" />
                                    ) : verifyingPost ? (
                                        <Text style={styles.studioStepPrimaryBtnText}>Checking…</Text>
                                    ) : (
                                        <Text style={styles.studioStepPrimaryBtnText}>Publish Job</Text>
                                    )}
                                </LinearGradient>
                            </TouchableOpacity>
                        )}
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f4f7fc',
    },
    screenCanvas: {
        flex: 1,
        backgroundColor: '#f4f7fc',
    },
    statusBarFill: {
        backgroundColor: '#6d28d9',
    },
    headerChrome: {
        ...SCREEN_CHROME.headerSurface,
        paddingHorizontal: 18,
        paddingTop: 10,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...SHADOWS.sm,
    },
    backButton: {
        ...SCREEN_CHROME.actionButton,
    },
    headerAction: {
        ...SCREEN_CHROME.actionButton,
        ...SCREEN_CHROME.actionButtonPrimary,
    },
    headerTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    headerEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: '#7c8798',
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
    headerTitle: {
        marginTop: 2,
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: -0.5,
        color: '#111827',
    },
    headerSubtitle: {
        marginTop: 2,
        fontSize: 11.5,
        fontWeight: '700',
        color: '#7c8798',
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    fastSetupCard: {
        ...SCREEN_CHROME.contentCard,
        paddingHorizontal: 14,
        paddingVertical: 14,
        marginBottom: 14,
        borderRadius: 24,
    },
    studioHeaderTopRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 10,
    },
    studioHeaderTopCopy: {
        flex: 1,
    },
    fastSetupTitle: {
        fontSize: 11,
        color: '#6d28d9',
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    fastSetupText: {
        marginTop: 3,
        fontSize: 15,
        color: '#111827',
        fontWeight: '800',
        lineHeight: 18,
    },
    fastSetupStatus: {
        marginTop: 6,
        fontSize: 11,
        color: '#6d28d9',
        fontWeight: '700',
    },
    studioProgressPill: {
        ...SCREEN_CHROME.signalChip,
        minWidth: 66,
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    studioProgressPillDone: {
        backgroundColor: '#f0fdf4',
        borderColor: '#bbf7d0',
    },
    studioProgressPillText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#6d28d9',
    },
    studioProgressPillTextDone: {
        color: '#047857',
    },
    studioSegmentRail: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },
    studioSegmentTab: {
        ...SCREEN_CHROME.signalChip,
        flex: 1,
        borderRadius: 18,
        paddingHorizontal: 8,
        paddingVertical: 10,
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 6,
    },
    studioSegmentTabCurrent: {
        borderColor: '#d8b4fe',
        backgroundColor: '#faf5ff',
    },
    studioSegmentTabDone: {
        borderColor: '#bbf7d0',
        backgroundColor: '#f0fdf4',
    },
    studioSegmentTabLocked: {
        opacity: 0.58,
    },
    studioSegmentBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        alignSelf: 'center',
    },
    studioSegmentBadgeCurrent: {
        backgroundColor: '#7c3aed',
    },
    studioSegmentBadgeDone: {
        backgroundColor: '#dcfce7',
    },
    studioSegmentTabText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#64748b',
        textAlign: 'center',
    },
    studioSegmentTabTextCurrent: {
        color: '#6d28d9',
    },
    studioSegmentTabTextDone: {
        color: '#047857',
    },
    studioSegmentTabTextLocked: {
        color: '#94a3b8',
    },
    studioSegmentTabDot: {
        width: 5,
        height: 5,
        borderRadius: 999,
        alignSelf: 'center',
        backgroundColor: '#cbd5e1',
    },
    studioSegmentTabDotCurrent: {
        backgroundColor: '#7c3aed',
    },
    studioSegmentTabDotDone: {
        backgroundColor: '#10b981',
    },
    formSectionCard: {
        ...SCREEN_CHROME.contentCard,
        borderRadius: 24,
        paddingHorizontal: 14,
        paddingVertical: 14,
        marginBottom: 14,
    },
    formSectionHero: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
    },
    formSectionHeroIcon: {
        width: 42,
        height: 42,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
    },
    formSectionHeroCopy: {
        flex: 1,
    },
    formSectionTitle: {
        fontSize: 15,
        fontWeight: '900',
        color: '#111827',
        marginBottom: 2,
    },
    formSectionSub: {
        fontSize: 11.5,
        color: '#64748b',
        marginBottom: 4,
    },
    studioSummaryRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    studioSummaryPill: {
        ...SCREEN_CHROME.metricTile,
        paddingHorizontal: 11,
        paddingVertical: 11,
    },
    studioSummaryLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    studioSummaryValue: {
        marginTop: 3,
        fontSize: 12.5,
        fontWeight: '800',
        color: '#111827',
    },
    guidedFieldCard: {
        ...SCREEN_CHROME.metricTile,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
    },
    guidedFieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 8,
    },
    guidedFieldIndex: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ede9fe',
    },
    guidedFieldIndexText: {
        fontSize: 11,
        fontWeight: '900',
        color: '#6d28d9',
    },
    guidedFieldCopy: {
        flex: 1,
    },
    guidedFieldHint: {
        marginTop: -2,
        fontSize: 10.5,
        color: '#64748b',
        fontWeight: '600',
    },
    studioMiniGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 2,
    },
    studioMiniCard: {
        ...SCREEN_CHROME.metricTile,
        width: '48.4%',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    editorCard: {
        ...SCREEN_CHROME.metricTile,
        borderRadius: 20,
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
        backgroundColor: '#ede9fe',
        paddingHorizontal: 8,
        paddingVertical: 4,
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
        textAlign: 'center',
    },
    heroCard: {
        ...SCREEN_CHROME.heroSurface,
        paddingHorizontal: 18,
        paddingVertical: 18,
        marginBottom: 14,
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    heroBadge: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
    },
    heroBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#6d28d9',
    },
    heroMiniPill: {
        ...SCREEN_CHROME.signalChip,
    },
    heroMiniPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#475569',
    },
    heroTitle: {
        marginTop: 14,
        fontSize: 24,
        lineHeight: 30,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.5,
    },
    heroMetricRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    heroMetricTile: {
        ...SCREEN_CHROME.metricTile,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
    },
    heroMetricValue: {
        fontSize: 17,
        fontWeight: '800',
        color: '#111827',
    },
    heroMetricLabel: {
        marginTop: 3,
        fontSize: 10.5,
        fontWeight: '800',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: '#94a3b8',
    },
    heroSignalRail: {
        marginTop: 14,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    heroSignalChip: {
        ...SCREEN_CHROME.signalChip,
        gap: 6,
    },
    heroSignalText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
    },
    stepRail: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 14,
    },
    stepPill: {
        flex: 1,
        borderRadius: 16,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#ffffff',
        ...SHADOWS.sm,
    },
    stepDot: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#eef2f7',
        marginBottom: 6,
    },
    stepDotActive: {
        backgroundColor: '#7c3aed',
    },
    stepDotDone: {
        backgroundColor: '#c4b5fd',
    },
    stepDotText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#64748b',
    },
    stepDotTextActive: {
        color: '#ffffff',
    },
    stepPillActive: {
        backgroundColor: '#f5f3ff',
        borderColor: '#d8b4fe',
    },
    stepPillDone: {
        backgroundColor: '#f8fafc',
        borderColor: '#dbe4f0',
    },
    stepPillText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#64748b',
    },
    stepPillTextActive: {
        color: '#6d28d9',
    },
    card: {
        ...SCREEN_CHROME.contentCard,
        paddingHorizontal: 16,
        paddingVertical: 16,
        marginBottom: 14,
    },
    cardHeaderBlock: {
        marginBottom: 14,
    },
    sectionPillRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
    },
    sectionPill: {
        ...SCREEN_CHROME.signalChip,
        backgroundColor: '#ffffff',
    },
    sectionPillText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#64748b',
    },
    cardTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#111827',
        letterSpacing: -0.3,
    },
    cardSubtitle: {
        marginTop: 4,
        fontSize: 13,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '600',
    },
    sectionLabel: {
        marginTop: 4,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    roleGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 12,
    },
    roleCard: {
        width: '48%',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        backgroundColor: '#f8fafc',
        padding: 14,
        gap: 8,
    },
    roleCardActive: {
        borderColor: '#d8b4fe',
        backgroundColor: '#faf5ff',
    },
    roleCardIcon: {
        width: 34,
        height: 34,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roleCardIconActive: {
        transform: [{ scale: 1.04 }],
    },
    roleCardEmoji: {
        fontSize: 18,
    },
    roleCardTitle: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '800',
        color: '#0f172a',
    },
    roleCardTitleActive: {
        color: '#6d28d9',
    },
    roleCardHint: {
        fontSize: 11,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '600',
    },
    roleCardHintActive: {
        color: '#7c3aed',
    },
    fieldHelperText: {
        marginTop: -2,
        marginBottom: 4,
        fontSize: 11.5,
        lineHeight: 16,
        color: '#64748b',
        fontWeight: '600',
    },
    choiceWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12,
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
        backgroundColor: '#111827',
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
        width: '78%',
        borderRadius: 18,
        overflow: 'hidden',
        ...SHADOWS.md,
    },
    studioStepPrimaryBtnDisabled: {
        opacity: 0.45,
    },
    studioStepPrimaryBtnGradient: {
        width: '100%',
        paddingVertical: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    studioStepPrimaryBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '800',
    },
});
