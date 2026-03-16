import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, ActivityIndicator, Keyboard, Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    IconUsers, IconMapPin, IconBriefcase, IconCheck, IconGlobe, IconFile, IconX, IconMessageSquare, IconPlus, IconMic, IconAward
} from '../components/Icons';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import client from '../api/client';
import { useFocusEffect } from '@react-navigation/native';
import { validateProfileResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { AuthContext } from '../context/AuthContext';
import {
    getCommonCityHints,
    getCommonLanguageHints,
    getRoleCategories,
    getRoleDefaults,
    getRoleTitlesForCategory,
    hasExactRoleMatch,
    inferRoleCategory,
    searchRoleTitles,
} from '../config/workerRoleCatalog';
import { GLASS_GRADIENTS, GLASS_PALETTE, GLASS_SHADOWS, GLASS_SURFACES } from '../theme/glass';
import {
    getNormalizedProfileReadiness,
    getProfileStudioCompletion,
    isProfileRoleGateError,
} from '../utils/profileReadiness';
import {
    getApLanguageOptions,
    getApLocalityHints,
    getApLocationOptions,
    getApPriorityLocations,
    getDefaultApLanguage,
} from '../config/apProfileCatalog';
import { SCREEN_CHROME } from '../theme/theme';

const REQUEST_TIMEOUT_MS = 7000;
const PROFILE_SAVE_TIMEOUT_MS = 20000;
const PROFILE_ACTIVATION_TIMEOUT_MS = 12000;
const AVATAR_SYNC_TIMEOUT_MS = 15000;
const WORKER_PROFILE_CACHE_KEY = '@cached_worker_profiles';
const JOBS_CACHE_PREFIX = '@cached_jobs';
const WORKER_PROFILE_ID_KEY = '@worker_profile_id';
const WORKER_PROFILE_VERSION_KEY = '@worker_profile_version';
const DISMISSED_JOBS_KEY = '@hire_dismissed_jobs';
const EXPLAIN_CACHE_PREFIX = '@explain_';
const CACHED_CANDIDATES_PREFIX = '@cached_candidates_';
const SHIFT_OPTIONS = ['Day', 'Night', 'Flexible'];
const AVAILABILITY_OPTIONS = [
    { label: 'Now', value: 0, hint: 'Can join immediately', emoji: '⚡' },
    { label: '15d', value: 15, hint: 'Need two weeks', emoji: '🗓️' },
    { label: '30d', value: 30, hint: 'Need one month', emoji: '📅' },
];
const COMMUTE_DISTANCE_OPTIONS = [5, 10, 25, 40];
const MATCH_TIER_OPTIONS = [
    { label: 'Open', value: 'POSSIBLE', hint: 'Wider results', emoji: '🌤️' },
    { label: 'Balanced', value: 'GOOD', hint: 'Good fit', emoji: '🎯' },
    { label: 'Strict', value: 'STRONG', hint: 'Closest only', emoji: '💎' },
];
const EXPERIENCE_CARD_OPTIONS = [
    { value: 0, label: 'Fresher', hint: 'Starting out', emoji: '🌱' },
    { value: 1, label: '1 year', hint: 'Early experience', emoji: '🧰' },
    { value: 3, label: '3 years', hint: 'Hands-on work', emoji: '🚀' },
    { value: 5, label: '5+ years', hint: 'Strong experience', emoji: '🏆' },
];
const LANGUAGE_CARD_OPTIONS = [
    { label: 'Telugu', hint: 'Primary', emoji: 'తె' },
    { label: 'English', hint: 'Work ready', emoji: 'EN' },
    { label: 'Hindi', hint: 'Field friendly', emoji: 'हि' },
    { label: 'Urdu', hint: 'Useful locally', emoji: 'اردو' },
    { label: 'Tamil', hint: 'Optional', emoji: 'அ' },
    { label: 'Kannada', hint: 'Optional', emoji: 'ಕ' },
];
const COMMUTE_OPTION_META = [
    { value: 5, label: 'Near', hint: 'Same area', emoji: '📍' },
    { value: 10, label: 'Local', hint: 'Easy daily travel', emoji: '🛵' },
    { value: 25, label: 'Flexible', hint: 'Across district', emoji: '🚍' },
    { value: 40, label: 'Far', hint: 'Longer travel', emoji: '🛣️' },
];
const SHIFT_OPTION_META = [
    { label: 'Day', hint: 'Morning to evening', emoji: '🌤️' },
    { label: 'Night', hint: 'Late hours okay', emoji: '🌙' },
    { label: 'Flexible', hint: 'Any shift works', emoji: '🔄' },
];
const ROLE_AI_DEBOUNCE_MS = 600;
const COMMON_CITY_HINTS = getCommonCityHints();
const COMMON_LANGUAGE_HINTS = getCommonLanguageHints();
const AP_PRIORITY_LOCATIONS = getApPriorityLocations();
const AP_ALL_LOCATIONS = getApLocationOptions();
const AP_LANGUAGE_CHOICES = getApLanguageOptions();
const ROLE_CATEGORY_OPTIONS = getRoleCategories();
const STUDIO_CARD_ORDER = ['role', 'basics', 'fit', 'skills'];
const STUDIO_CARD_META = Object.freeze({
    role: { label: 'Role', Icon: IconBriefcase },
    basics: { label: 'Basics', Icon: IconMapPin },
    fit: { label: 'Fit', Icon: IconGlobe },
    skills: { label: 'Proofs', Icon: IconAward },
});
const ROLE_CATEGORY_VISUALS = Object.freeze({
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
const SEEDED_GENERIC_ROLE_TITLES = new Set([
    'general worker',
    'worker',
    'job seeker',
    'candidate',
    'profile',
]);
const SEEDED_GENERIC_PROFILE_NAMES = new Set([
    'lokesh user',
    'qa user',
    'demo user',
    'test user',
    'user',
    'candidate',
    'profile',
]);
const NEUTRAL_ROLE_PROFILE_TITLE = 'General Worker';
const generateProfileId = () => `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isLocalAssetUri = (value) => /^(file|content|ph|assets-library):/i.test(String(value || '').trim());
const withRequestTimeout = (promise, timeoutMessage, timeoutMs = REQUEST_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const safeTimeoutMs = Math.max(600, Number(timeoutMs) || REQUEST_TIMEOUT_MS);
    const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
    }, safeTimeoutMs);

    promise
        .then((response) => {
            clearTimeout(timeout);
            resolve(response);
        })
        .catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
});

const normalizeValue = (value) => String(value || '').trim().toLowerCase();
const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const sanitizeProfileNamePrefill = (value = '') => {
    const cleaned = String(value || '').trim();
    if (!cleaned) return '';
    if (SEEDED_GENERIC_PROFILE_NAMES.has(normalizeToken(cleaned))) return '';
    return cleaned;
};

const resolveProfileDisplayName = ({
    firstName = '',
    lastName = '',
    fallbackName = '',
} = {}) => {
    const combined = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim();
    const safeCombined = sanitizeProfileNamePrefill(combined);
    if (safeCombined) return safeCombined;
    const safeFallback = sanitizeProfileNamePrefill(fallbackName);
    if (safeFallback) return safeFallback;
    return 'Profile';
};

const buildUniqueOptions = (entries = []) => [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean))];

const buildUniqueNumbers = (entries = []) => [...new Set((Array.isArray(entries) ? entries : [])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry > 0))];

const formatCompactCurrency = (value = 0) => {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount) || amount <= 0) return '';
    if (amount >= 1000) {
        const compact = amount % 1000 === 0 ? amount / 1000 : (amount / 1000).toFixed(1);
        return `₹${compact}k`;
    }
    return `₹${amount}`;
};

const getRoleCategoryVisual = (category = '') => {
    const normalizedCategory = String(category || '').trim();
    return ROLE_CATEGORY_VISUALS[normalizedCategory] || { emoji: '💼', tint: 'rgba(111, 78, 246, 0.12)' };
};

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

const parseTokenArray = (candidate = [], limit = 12) => (
    Array.isArray(candidate)
        ? candidate
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, limit)
        : (typeof candidate === 'string'
            ? candidate
                .split(/[\n,]/)
                .map((item) => String(item || '').trim())
                .filter(Boolean)
                .slice(0, limit)
            : [])
);

const pickFirstTokenArray = (candidates = [], limit = 12) => {
    for (const candidate of candidates) {
        const parsed = parseTokenArray(candidate, limit);
        if (parsed.length > 0) return parsed;
    }
    return [];
};

const pickFirstString = (candidates = []) => {
    for (const candidate of candidates) {
        const parsed = String(candidate || '').trim();
        if (parsed) return parsed;
    }
    return '';
};

const pickFirstPositiveNumber = (candidates = []) => {
    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed);
        }
    }
    return 0;
};

const mergeUniqueTokens = (currentValues = [], nextValues = [], limit = 20) => {
    const merged = [];
    [...(Array.isArray(currentValues) ? currentValues : []), ...(Array.isArray(nextValues) ? nextValues : [])]
        .forEach((item) => {
            const token = String(item || '').trim();
            if (!token) return;
            if (merged.some((entry) => normalizeToken(entry) === normalizeToken(token))) return;
            merged.push(token);
        });
    return merged.slice(0, limit);
};

const normalizeProfileIdLikeBackend = (value, fallbackSeed = '') => {
    const normalized = String(value || '').trim();
    if (normalized) return normalized.slice(0, 120);

    const seeded = String(fallbackSeed || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (seeded) return `legacy-${seeded}`.slice(0, 120);
    return '';
};

const resolveProfileIdForApi = (profileLike = {}, profileIndex = 0) => normalizeProfileIdLikeBackend(
    profileLike?.profileId || profileLike?._id || '',
    `${profileIndex}-${String(profileLike?.roleName || profileLike?.roleTitle || '').trim()}`
);

const isSeededGenericRoleProfile = (roleProfile = {}) => {
    const roleTitle = normalizeValue(roleProfile?.roleName || roleProfile?.roleTitle);
    return SEEDED_GENERIC_ROLE_TITLES.has(roleTitle);
};

const toEmptyProfileTemplate = ({ profileId = 'profile-default', fullName = 'Profile', avatar = null, interviewVerified = false, activeProfile = false } = {}) => ({
    _id: profileId,
    profileId,
    name: fullName,
    roleTitle: '',
    experienceYears: null,
    expectedSalary: null,
    skills: [],
    location: '',
    panchayat: '',
    language: '',
    maxCommuteDistanceKm: 25,
    minimumMatchTier: 'GOOD',
    preferredShift: 'Flexible',
    isAvailable: true,
    availabilityWindowDays: 0,
    openToRelocation: false,
    openToNightShift: false,
    licenses: [],
    avatar: avatar || null,
    interviewVerified: Boolean(interviewVerified),
    activeProfile: Boolean(activeProfile),
    isDefault: Boolean(activeProfile),
    createdAt: new Date().toISOString(),
});

const hasMeaningfulProfileData = (profile = {}) => {
    const title = String(profile?.roleTitle || '').trim();
    const location = String(profile?.location || '').trim();
    const skills = Array.isArray(profile?.skills) ? profile.skills.filter(Boolean) : [];
    const experience = Number(profile?.experienceYears || 0);
    const expectedSalary = Number(profile?.expectedSalary || 0);
    const licenses = Array.isArray(profile?.licenses) ? profile.licenses.filter(Boolean) : [];

    return Boolean(
        title
        || location
        || skills.length > 0
        || licenses.length > 0
        || (Number.isFinite(expectedSalary) && expectedSalary > 0)
        || (Number.isFinite(experience) && experience > 0)
    );
};

const hasExperienceValue = (profile = {}) => (
    profile?.experienceYears !== null
    && profile?.experienceYears !== undefined
    && String(profile?.experienceYears).trim() !== ''
);

const isRoleReadyForStudio = (profile = {}, roleCategory = '') => Boolean(
    String(roleCategory || inferRoleCategory(String(profile?.roleTitle || '').trim()) || '').trim()
    && String(profile?.roleTitle || '').trim()
);

const isBasicsReadyForStudio = (profile = {}) => Boolean(
    String(profile?.location || '').trim()
    && String(profile?.language || '').trim()
    && hasExperienceValue(profile)
    && Number(profile?.expectedSalary || 0) > 0
);

const isJobFitReadyForStudio = (profile = {}) => Boolean(
    Number.isFinite(Number(profile?.maxCommuteDistanceKm))
    && [0, 15, 30].includes(Number(profile?.availabilityWindowDays || 0))
    && SHIFT_OPTIONS.includes(String(profile?.preferredShift || '').trim())
);

const isSkillsReadyForStudio = (profile = {}) => Boolean(
    Array.isArray(profile?.skills) && profile.skills.length > 0
);

const resolveInitialStudioCard = (profile = {}, roleCategory = '') => {
    if (!isRoleReadyForStudio(profile, roleCategory)) return 'role';
    if (!isBasicsReadyForStudio(profile)) return 'basics';
    if (!isJobFitReadyForStudio(profile)) return 'fit';
    return 'skills';
};

const isSameProfileEntry = (source = {}, target = {}, sourceIndex = 0, targetIndex = 0) => {
    const sourceResolvedId = resolveProfileIdForApi(source, sourceIndex);
    const targetResolvedId = resolveProfileIdForApi(target, targetIndex);
    if (sourceResolvedId && targetResolvedId && sourceResolvedId === targetResolvedId) {
        return true;
    }

    const sourceRawId = normalizeProfileIdLikeBackend(source?.profileId || source?._id || '', '');
    const targetRawId = normalizeProfileIdLikeBackend(target?.profileId || target?._id || '', '');
    if (sourceRawId && targetRawId && sourceRawId === targetRawId) {
        return true;
    }

    const sourceCreatedAt = String(source?.createdAt || '').trim();
    const targetCreatedAt = String(target?.createdAt || '').trim();
    const sourceRole = normalizeValue(source?.roleTitle || source?.roleName || '');
    const targetRole = normalizeValue(target?.roleTitle || target?.roleName || '');
    if (sourceCreatedAt && sourceCreatedAt === targetCreatedAt && sourceRole && sourceRole === targetRole) {
        return true;
    }

    return sourceIndex === targetIndex && sourceRole && sourceRole === targetRole;
};

const buildRoleProfilesPayloadFromUiProfiles = (profiles = []) => {
    const meaningfulProfiles = (Array.isArray(profiles) ? profiles : []).filter(hasMeaningfulProfileData);
    const hasActiveProfile = meaningfulProfiles.some((item) => Boolean(item?.activeProfile));

    return meaningfulProfiles
        .map((item, itemIndex) => ({
            profileId: resolveProfileIdForApi(item, itemIndex),
            roleName: String(item?.roleTitle || item?.roleName || '').trim(),
            experienceInRole: Number.isFinite(Number(item?.experienceYears))
                ? Number(item.experienceYears)
                : 0,
            expectedSalary: Number.isFinite(Number(item?.expectedSalary))
                ? Number(item.expectedSalary)
                : 0,
            skills: Array.isArray(item?.skills) ? item.skills.filter(Boolean) : [],
            activeProfile: hasActiveProfile ? Boolean(item?.activeProfile) : itemIndex === 0,
            createdAt: item?.createdAt || new Date().toISOString(),
        }))
        .filter((item) => Boolean(item.roleName));
};

const buildNeutralRoleProfilesPayload = () => ([
    {
        profileId: normalizeProfileIdLikeBackend('legacy-general-worker', ''),
        roleName: NEUTRAL_ROLE_PROFILE_TITLE,
        experienceInRole: 0,
        expectedSalary: 0,
        skills: [],
        activeProfile: true,
        createdAt: new Date().toISOString(),
    },
]);

const TypeaheadInput = ({
    value = '',
    onChangeText,
    placeholder = '',
    suggestions = [],
    onSelectSuggestion,
    formatSuggestion,
    keyboardType = 'default',
    autoCapitalize = 'words',
    returnKeyType = 'done',
    onSubmitEditing,
    containerStyle,
    onFocus,
    onBlur,
    listPlacement = 'below',
    pickerMode = false,
    pickerTitle = '',
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isPickerVisible, setIsPickerVisible] = useState(false);
    const inputRef = useRef(null);
    const selectingSuggestionRef = useRef(false);
    const keepExpandedRef = useRef(false);
    const safeSuggestions = Array.isArray(suggestions) ? suggestions.filter(Boolean) : [];
    const resolveSuggestion = useCallback((item) => {
        if (typeof formatSuggestion === 'function') {
            const custom = formatSuggestion(item);
            if (custom && typeof custom === 'object') {
                return {
                    label: String(custom.label || custom.value || '').trim(),
                    value: String(custom.value || custom.label || '').trim(),
                    meta: String(custom.meta || '').trim(),
                };
            }
        }
        if (typeof item === 'object') {
            return {
                label: String(item.label || item.value || '').trim(),
                value: String(item.value || item.label || '').trim(),
                meta: String(item.meta || '').trim(),
            };
        }
        const label = String(item || '').trim();
        return { label, value: label, meta: '' };
    }, [formatSuggestion]);
    const resolvedSuggestions = useMemo(
        () => safeSuggestions.map(resolveSuggestion).filter((item) => item?.value),
        [resolveSuggestion, safeSuggestions]
    );
    const normalizedValue = String(value || '').trim();
    const hasTypedValueInSuggestions = resolvedSuggestions.some((item) => normalizeToken(item.value) === normalizeToken(normalizedValue));
    const customTypedSuggestion = normalizedValue && !hasTypedValueInSuggestions
        ? { label: `Use "${normalizedValue}"`, value: normalizedValue, meta: 'Use your typed value' }
        : null;
    const showSuggestions = isExpanded && safeSuggestions.length > 0;

    const releaseManualDropdownHold = useCallback(() => {
        setTimeout(() => {
            keepExpandedRef.current = false;
        }, 220);
    }, []);

    const applySuggestionValue = useCallback((nextValue) => {
        if (typeof onSelectSuggestion === 'function') {
            onSelectSuggestion(nextValue);
        } else {
            onChangeText?.(nextValue);
        }
    }, [onChangeText, onSelectSuggestion]);

    const openPicker = useCallback(() => {
        Keyboard.dismiss();
        inputRef.current?.blur?.();
        setIsFocused(false);
        setIsPickerVisible(true);
    }, []);

    const closePicker = useCallback(() => {
        setIsPickerVisible(false);
        setIsFocused(false);
        Keyboard.dismiss();
        onBlur?.();
    }, [onBlur]);

    if (pickerMode) {
        return (
            <View style={[styles.typeaheadWrap, containerStyle]}>
                <TouchableOpacity
                    style={[styles.typeaheadShell, isPickerVisible && styles.typeaheadShellFocused]}
                    activeOpacity={0.88}
                    onPress={openPicker}
                >
                    <Text
                        style={normalizedValue ? styles.typeaheadDisplayText : styles.typeaheadPlaceholderText}
                        numberOfLines={1}
                    >
                        {normalizedValue || placeholder}
                    </Text>
                    <Text style={styles.typeaheadChevron}>{isPickerVisible ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                <Modal
                    visible={isPickerVisible}
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
                                    <Text style={styles.typeaheadPickerHint}>Pick one or type to narrow down.</Text>
                                </View>
                                <TouchableOpacity
                                    onPress={closePicker}
                                    style={styles.typeaheadPickerCloseBtn}
                                    activeOpacity={0.85}
                                >
                                    <IconX size={18} color="#6b7280" />
                                </TouchableOpacity>
                            </View>

                            <View style={[styles.typeaheadShell, styles.typeaheadPickerSearchShell, isFocused && styles.typeaheadShellFocused]}>
                                <TextInput
                                    ref={inputRef}
                                    value={value}
                                    onChangeText={onChangeText}
                                    style={styles.typeaheadInput}
                                    placeholder={placeholder}
                                    placeholderTextColor={GLASS_PALETTE.textSoft}
                                    keyboardType={keyboardType}
                                    autoCapitalize={autoCapitalize}
                                    autoCorrect={false}
                                    returnKeyType={returnKeyType}
                                    onFocus={() => setIsFocused(true)}
                                    onBlur={() => setIsFocused(false)}
                                    onSubmitEditing={() => {
                                        if (typeof onSubmitEditing === 'function') {
                                            onSubmitEditing();
                                            return;
                                        }
                                        closePicker();
                                    }}
                                />
                            </View>

                            <ScrollView
                                style={styles.typeaheadPickerList}
                                contentContainerStyle={styles.typeaheadPickerListContent}
                                keyboardShouldPersistTaps="always"
                                showsVerticalScrollIndicator={false}
                            >
                                {resolvedSuggestions.map((suggestion, index) => (
                                    <TouchableOpacity
                                        key={`picker-typeahead-${suggestion.value}-${index}`}
                                        style={styles.typeaheadPickerItem}
                                        activeOpacity={0.82}
                                        onPress={() => {
                                            applySuggestionValue(suggestion.value);
                                            closePicker();
                                        }}
                                    >
                                        <Text style={styles.typeaheadItemText}>{suggestion.label}</Text>
                                        {suggestion.meta ? (
                                            <Text style={styles.typeaheadItemMeta}>{suggestion.meta}</Text>
                                        ) : null}
                                    </TouchableOpacity>
                                ))}
                                {customTypedSuggestion ? (
                                    <TouchableOpacity
                                        style={[styles.typeaheadPickerItem, styles.typeaheadPickerItemPrimary]}
                                        activeOpacity={0.82}
                                        onPress={() => {
                                            applySuggestionValue(customTypedSuggestion.value);
                                            closePicker();
                                        }}
                                    >
                                        <Text style={[styles.typeaheadItemText, styles.typeaheadPickerItemPrimaryText]}>
                                            {customTypedSuggestion.label}
                                        </Text>
                                        <Text style={[styles.typeaheadItemMeta, styles.typeaheadPickerItemPrimaryMeta]}>
                                            {customTypedSuggestion.meta}
                                        </Text>
                                    </TouchableOpacity>
                                ) : null}
                                {!resolvedSuggestions.length && !customTypedSuggestion ? (
                                    <View style={styles.typeaheadPickerEmptyState}>
                                        <Text style={styles.typeaheadPickerEmptyText}>Start typing to narrow down.</Text>
                                    </View>
                                ) : null}
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </View>
        );
    }

    const openSuggestionMenu = useCallback(({ withKeyboard = false } = {}) => {
        keepExpandedRef.current = !withKeyboard;
        setIsExpanded(true);
        if (withKeyboard) {
            setIsFocused(true);
            onFocus?.();
            return;
        }
        Keyboard.dismiss();
        inputRef.current?.blur?.();
        setIsFocused(false);
        onFocus?.();
        releaseManualDropdownHold();
    }, [onFocus, releaseManualDropdownHold]);

    const closeSuggestionMenu = useCallback(() => {
        keepExpandedRef.current = false;
        selectingSuggestionRef.current = false;
        setIsExpanded(false);
        setIsFocused(false);
        inputRef.current?.blur?.();
        onBlur?.();
    }, [onBlur]);

    return (
        <View style={[styles.typeaheadWrap, isFocused && styles.typeaheadWrapFocused, containerStyle]}>
            <View style={[styles.typeaheadShell, isFocused && styles.typeaheadShellFocused]}>
                <View style={styles.typeaheadInputSlot}>
                    <TextInput
                        ref={inputRef}
                        value={value}
                        onChangeText={(text) => {
                            setIsExpanded(true);
                            keepExpandedRef.current = false;
                            onChangeText?.(text);
                        }}
                        style={styles.typeaheadInput}
                        placeholder={placeholder}
                        placeholderTextColor={GLASS_PALETTE.textSoft}
                        keyboardType={keyboardType}
                        autoCapitalize={autoCapitalize}
                        autoCorrect={false}
                        returnKeyType={returnKeyType}
                        onFocus={() => {
                            openSuggestionMenu({ withKeyboard: true });
                        }}
                        onBlur={() => {
                            setTimeout(() => {
                                if (selectingSuggestionRef.current) {
                                    selectingSuggestionRef.current = false;
                                    return;
                                }
                                setIsFocused(false);
                                if (!keepExpandedRef.current) {
                                    setIsExpanded(false);
                                } else {
                                    releaseManualDropdownHold();
                                }
                                onBlur?.();
                            }, 180);
                        }}
                        onSubmitEditing={onSubmitEditing}
                    />
                    {!isExpanded && !isFocused ? (
                        <TouchableOpacity
                            style={styles.typeaheadTapOverlay}
                            activeOpacity={1}
                            onPress={() => openSuggestionMenu({ withKeyboard: false })}
                        />
                    ) : null}
                </View>
                <TouchableOpacity
                    style={styles.typeaheadChevronButton}
                    activeOpacity={0.8}
                    onPress={() => {
                        if (showSuggestions) {
                            closeSuggestionMenu();
                            return;
                        }
                        openSuggestionMenu({ withKeyboard: false });
                    }}
                >
                    <Text style={styles.typeaheadChevron}>{showSuggestions ? '▲' : '▼'}</Text>
                </TouchableOpacity>
            </View>

            {showSuggestions ? (
                <ScrollView
                    style={[
                        styles.typeaheadList,
                        listPlacement === 'above' ? styles.typeaheadListAbove : styles.typeaheadListBelow,
                    ]}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator={false}
                >
                    {safeSuggestions.map((item, index) => {
                        const suggestion = resolveSuggestion(item);
                        if (!suggestion.value) return null;
                        return (
                            <TouchableOpacity
                                key={`typeahead-${suggestion.value}-${index}`}
                                style={styles.typeaheadItem}
                                activeOpacity={0.82}
                                onPressIn={() => {
                                    selectingSuggestionRef.current = true;
                                }}
                                onPress={() => {
                                    applySuggestionValue(suggestion.value);
                                    selectingSuggestionRef.current = false;
                                    setIsFocused(false);
                                    inputRef.current?.blur?.();
                                }}
                            >
                                <Text style={styles.typeaheadItemText}>{suggestion.label}</Text>
                                {suggestion.meta ? (
                                    <Text style={styles.typeaheadItemMeta}>{suggestion.meta}</Text>
                                ) : null}
                            </TouchableOpacity>
                        );
                    })}
                </ScrollView>
            ) : null}
        </View>
    );
};

const SelectionRail = ({
    options = [],
    selectedValue,
    onSelect,
    getValue = (item) => (item && typeof item === 'object' && 'value' in item ? item.value : item),
    getTitle = (item) => (item && typeof item === 'object' && 'label' in item ? item.label : String(item || '')),
    getHint = (item) => (item && typeof item === 'object' && 'hint' in item ? item.hint : ''),
    getEmoji = (item) => (item && typeof item === 'object' && 'emoji' in item ? item.emoji : ''),
    compact = false,
}) => {
    const normalizedSelected = normalizeToken(String(selectedValue ?? ''));

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectionRailContent}
        >
            {options.map((item, index) => {
                const optionValue = getValue(item);
                const optionTitle = String(getTitle(item) || '').trim();
                const optionHint = String(getHint(item) || '').trim();
                const optionEmoji = String(getEmoji(item) || '').trim();
                const isActive = normalizeToken(String(optionValue ?? '')) === normalizedSelected;
                if (!optionTitle) return null;

                return (
                    <TouchableOpacity
                        key={`rail-${String(optionValue ?? optionTitle)}-${index}`}
                        style={[
                            styles.selectionRailCard,
                            compact && styles.selectionRailCardCompact,
                            isActive && styles.selectionRailCardActive,
                        ]}
                        onPress={() => onSelect?.(optionValue)}
                        activeOpacity={0.86}
                    >
                        {optionEmoji ? (
                            <View style={[styles.selectionRailEmojiBubble, isActive && styles.selectionRailEmojiBubbleActive]}>
                                <Text style={styles.selectionRailEmoji}>{optionEmoji}</Text>
                            </View>
                        ) : null}
                        <Text style={[styles.selectionRailTitle, isActive && styles.selectionRailTitleActive]}>
                            {optionTitle}
                        </Text>
                        {optionHint ? (
                            <Text style={[styles.selectionRailHint, isActive && styles.selectionRailHintActive]}>
                                {optionHint}
                            </Text>
                        ) : null}
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );
};

export default function ProfilesScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { user, role: appRole } = useAppStore();
    const { updateUserInfo } = React.useContext(AuthContext);
    const normalizedAppRole = String(appRole || '').toLowerCase();
    const role = normalizedAppRole === 'employer' || normalizedAppRole === 'recruiter' ? 'employer' : 'employee';
    const [profiles, setProfiles] = useState([]);
    const [suppressedProfileIds, setSuppressedProfileIds] = useState([]);
    const [pools, setPools] = useState([]);
    const [poolProfiles, setPoolProfiles] = useState([]);
    const [isModalVisible, setIsModalVisible] = useState(false);

    // Employer State
    const [selectedPool, setSelectedPool] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);

    // Employee State
    const [editingProfile, setEditingProfile] = useState(null);
    const [skillInput, setSkillInput] = useState('');
    const [licenseInput, setLicenseInput] = useState('');
    const [aiAssistLoading, setAiAssistLoading] = useState(false);
    const [formAssistMessage, setFormAssistMessage] = useState('');
    const [roleSuggestedSkills, setRoleSuggestedSkills] = useState([]);
    const [roleSuggestedLicenses, setRoleSuggestedLicenses] = useState([]);
    const [roleSuggestedSalary, setRoleSuggestedSalary] = useState(0);
    const [isCustomExperience, setIsCustomExperience] = useState(false);
    const [isCustomSalary, setIsCustomSalary] = useState(false);
    const [selectedRoleCategory, setSelectedRoleCategory] = useState('');
    const [activeStudioCard, setActiveStudioCard] = useState('role');

    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const poolCandidatesRequestIdRef = useRef(0);
    const profileRequestIdRef = useRef(0);
    const poolsRequestIdRef = useRef(0);
    const roleAiCacheRef = useRef({});
    const roleAiDebounceRef = useRef(null);
    const roleAiRequestIdRef = useRef(0);
    const roleDefaultsAppliedKeyRef = useRef('');
    const modalScrollRef = useRef(null);
    const roleInputAnchorRef = useRef(null);
    const locationInputAnchorRef = useRef(null);
    const localityInputAnchorRef = useRef(null);
    const modalScrollOffsetRef = useRef(0);
    const keyboardHeightRef = useRef(0);

    const patchEditingProfile = useCallback((partial = {}) => {
        setEditingProfile((prev) => (prev ? { ...prev, ...partial } : prev));
    }, []);

    const scrollStudioToTop = useCallback(() => {
        requestAnimationFrame(() => {
            modalScrollRef.current?.scrollTo?.({ y: 0, animated: true });
        });
    }, []);

    const moveStudioToCardStart = useCallback(() => {
        Keyboard.dismiss();
        scrollStudioToTop();
    }, [scrollStudioToTop]);

    const scrollStudioFieldIntoView = useCallback((fieldRef, extraSpace = 220) => {
        setTimeout(() => {
            const measuredField = fieldRef?.current;
            if (!measuredField || typeof measuredField.measureInWindow !== 'function') return;
            measuredField.measureInWindow((_x, y, _width, height) => {
                const screenHeight = Dimensions.get('window').height;
                const keyboardHeight = Math.max(0, Number(keyboardHeightRef.current || 0));
                const visibleBottom = screenHeight - keyboardHeight - 28;
                const targetBottom = y + height + extraSpace;
                if (targetBottom <= visibleBottom) {
                    return;
                }
                const delta = targetBottom - visibleBottom;
                modalScrollRef.current?.scrollTo?.({
                    y: Math.max(0, modalScrollOffsetRef.current + delta),
                    animated: true,
                });
            });
        }, Platform.OS === 'ios' ? 120 : 180);
    }, []);

    const roleDefaults = useMemo(
        () => getRoleDefaults(String(editingProfile?.roleTitle || '').trim()),
        [editingProfile?.roleTitle]
    );

    const effectiveRoleCategory = useMemo(() => {
        const explicitCategory = String(selectedRoleCategory || '').trim();
        if (explicitCategory) return explicitCategory;
        return String(inferRoleCategory(String(editingProfile?.roleTitle || '').trim()) || '').trim();
    }, [editingProfile?.roleTitle, selectedRoleCategory]);

    const roleTitlesForCategory = useMemo(
        () => buildUniqueOptions(getRoleTitlesForCategory(effectiveRoleCategory)),
        [effectiveRoleCategory]
    );

    const roleTitleTypeaheadOptions = useMemo(() => {
        const normalizedCategory = normalizeToken(effectiveRoleCategory);
        const normalizedQuery = String(editingProfile?.roleTitle || '').trim();
        const categorySuggestions = roleTitlesForCategory.map((title) => ({
            label: title,
            value: title,
            meta: effectiveRoleCategory ? `${effectiveRoleCategory} role` : 'Suggested role',
        }));
        const catalogSuggestions = searchRoleTitles(normalizedQuery, 24)
            .filter((entry) => {
                if (!normalizedCategory) return true;
                return normalizeToken(entry.category) === normalizedCategory;
            })
            .map((entry) => ({
                label: entry.title,
                value: entry.title,
                meta: entry.category ? `${entry.category} role` : '',
            }));
        const seededSuggestions = buildUniqueOptions([...categorySuggestions, ...catalogSuggestions].map((entry) => entry.value))
            .map((title) => (
                categorySuggestions.find((entry) => entry.value === title)
                || catalogSuggestions.find((entry) => entry.value === title)
            ))
            .filter(Boolean);
        const catalogTitles = new Set(seededSuggestions.map((entry) => normalizeToken(entry.value)));
        const profileTitles = buildUniqueOptions([
            ...profiles.map((item) => item?.roleTitle),
            editingProfile?.roleTitle,
        ]).filter((title) => {
            if (!title || catalogTitles.has(normalizeToken(title))) return false;
            if (!normalizedCategory) return true;
            return normalizeToken(inferRoleCategory(title)) === normalizedCategory;
        });
        const profileSuggestions = profileTitles.slice(0, 4).map((title) => ({
            label: title,
            value: title,
            meta: 'Your existing role',
        }));
        return [...seededSuggestions, ...profileSuggestions];
    }, [editingProfile?.roleTitle, effectiveRoleCategory, profiles, roleTitlesForCategory]);

    const cityTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...AP_PRIORITY_LOCATIONS,
        ...AP_ALL_LOCATIONS,
        ...(Array.isArray(roleDefaults?.cityHints) ? roleDefaults.cityHints : []),
        ...COMMON_CITY_HINTS,
        ...profiles.map((item) => item?.location),
        editingProfile?.location,
    ]), [editingProfile?.location, profiles, roleDefaults?.cityHints]);

    const languageTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...AP_LANGUAGE_CHOICES,
        ...(Array.isArray(roleDefaults?.languageHints) ? roleDefaults.languageHints : []),
        ...COMMON_LANGUAGE_HINTS,
        ...profiles.map((item) => item?.language),
        editingProfile?.language,
    ]), [editingProfile?.language, profiles, roleDefaults?.languageHints]);

    const localityTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...getApLocalityHints(editingProfile?.location),
        editingProfile?.panchayat,
        ...profiles.map((item) => item?.panchayat),
    ]), [editingProfile?.location, editingProfile?.panchayat, profiles]);

    const skillTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...(Array.isArray(roleSuggestedSkills) ? roleSuggestedSkills : []),
        ...(Array.isArray(editingProfile?.skills) ? editingProfile.skills : []),
        skillInput,
    ]), [editingProfile?.skills, roleSuggestedSkills, skillInput]);

    const licenseTypeaheadOptions = useMemo(() => buildUniqueOptions([
        ...(Array.isArray(roleSuggestedLicenses) ? roleSuggestedLicenses : []),
        ...(Array.isArray(editingProfile?.licenses) ? editingProfile.licenses : []),
        licenseInput,
    ]), [editingProfile?.licenses, licenseInput, roleSuggestedLicenses]);

    const inferredRoleCategory = useMemo(
        () => inferRoleCategory(String(editingProfile?.roleTitle || '').trim()),
        [editingProfile?.roleTitle]
    );
    const hasExactRoleSelection = useMemo(
        () => hasExactRoleMatch(String(editingProfile?.roleTitle || '').trim()),
        [editingProfile?.roleTitle]
    );

    const hasExperienceSelection = hasExperienceValue(editingProfile);

    const studioFieldsMissing = useMemo(() => {
        const missing = [];
        if (!String(effectiveRoleCategory || '').trim()) missing.push('role family');
        if (!String(editingProfile?.roleTitle || '').trim()) missing.push('role');
        if (!String(editingProfile?.location || '').trim()) missing.push('location');
        if (!String(editingProfile?.language || '').trim()) missing.push('language');
        if (!Array.isArray(editingProfile?.skills) || editingProfile.skills.length === 0) missing.push('skills');
        if (!hasExperienceSelection) missing.push('experience');
        if (Number(editingProfile?.expectedSalary || 0) <= 0) missing.push('expected pay');
        return missing;
    }, [editingProfile?.expectedSalary, editingProfile?.language, editingProfile?.location, editingProfile?.roleTitle, editingProfile?.skills, effectiveRoleCategory, hasExperienceSelection]);

    const profileStudioSections = useMemo(() => {
        const hasRole = isRoleReadyForStudio(editingProfile, effectiveRoleCategory);
        const hasBasics = isBasicsReadyForStudio(editingProfile);
        const hasFit = isJobFitReadyForStudio(editingProfile);
        const hasSkills = isSkillsReadyForStudio(editingProfile);
        return [
            { id: 'role', label: 'Role', complete: hasRole },
            { id: 'basics', label: 'AP basics', complete: hasBasics },
            { id: 'fit', label: 'Job fit', complete: hasFit },
            { id: 'skills', label: 'Proofs', complete: hasSkills },
        ];
    }, [editingProfile, effectiveRoleCategory]);

    const isStudioCardUnlocked = useCallback((stepId) => {
        if (stepId === 'role') return true;
        if (stepId === 'basics') return isRoleReadyForStudio(editingProfile, effectiveRoleCategory);
        if (stepId === 'fit') return (
            isRoleReadyForStudio(editingProfile, effectiveRoleCategory)
            && isBasicsReadyForStudio(editingProfile)
        );
        if (stepId === 'skills') return (
            isRoleReadyForStudio(editingProfile, effectiveRoleCategory)
            && isBasicsReadyForStudio(editingProfile)
            && isJobFitReadyForStudio(editingProfile)
        );
        return false;
    }, [editingProfile, effectiveRoleCategory]);

    const canAdvanceStudioCard = useMemo(() => {
        if (activeStudioCard === 'role') return isRoleReadyForStudio(editingProfile, effectiveRoleCategory);
        if (activeStudioCard === 'basics') return isBasicsReadyForStudio(editingProfile);
        if (activeStudioCard === 'fit') return isJobFitReadyForStudio(editingProfile);
        return isSkillsReadyForStudio(editingProfile);
    }, [activeStudioCard, editingProfile, effectiveRoleCategory]);

    const effectiveSuggestedSalary = useMemo(
        () => Number(roleSuggestedSalary || roleDefaults?.suggestedSalary || 0),
        [roleDefaults?.suggestedSalary, roleSuggestedSalary]
    );

    const roleSpotlightOptions = useMemo(
        () => roleTitlesForCategory.slice(0, 8),
        [roleTitlesForCategory]
    );

    const localityQuickOptions = useMemo(
        () => localityTypeaheadOptions.slice(0, 6),
        [localityTypeaheadOptions]
    );

    const hasChosenLocation = Boolean(String(editingProfile?.location || '').trim());
    const hasChosenLanguage = Boolean(String(editingProfile?.language || '').trim());

    const guidedLocationOptions = useMemo(() => buildUniqueOptions([
        ...(Array.isArray(roleDefaults?.cityHints) ? roleDefaults.cityHints : []),
        editingProfile?.location,
        ...AP_PRIORITY_LOCATIONS,
    ])
        .filter((item) => !normalizeToken(item).includes('remote'))
        .slice(0, 6), [editingProfile?.location, roleDefaults?.cityHints]);

    const guidedLocalityOptions = useMemo(
        () => localityQuickOptions.slice(0, 4),
        [localityQuickOptions]
    );

    const guidedLanguageOptions = useMemo(() => buildUniqueOptions([
        editingProfile?.language,
        ...(Array.isArray(roleDefaults?.languageHints) ? roleDefaults.languageHints : []),
        ...AP_LANGUAGE_CHOICES,
    ]).slice(0, 4), [editingProfile?.language, roleDefaults?.languageHints]);

    const languageDisplayOptions = useMemo(() => buildUniqueOptions([
        editingProfile?.language,
        ...guidedLanguageOptions,
        ...LANGUAGE_CARD_OPTIONS.map((item) => item.label),
    ]).slice(0, 6), [editingProfile?.language, guidedLanguageOptions]);

    const salaryPresetOptions = useMemo(() => {
        const seedValues = buildUniqueNumbers([
            effectiveSuggestedSalary,
            roleDefaults?.suggestedSalary,
            18000,
            22000,
            28000,
            35000,
            editingProfile?.expectedSalary,
        ]);
        return seedValues.slice(0, 5);
    }, [editingProfile?.expectedSalary, effectiveSuggestedSalary, roleDefaults?.suggestedSalary]);

    const compactSalaryOptions = useMemo(
        () => salaryPresetOptions.slice(0, 4),
        [salaryPresetOptions]
    );

    const guidedSkillSuggestions = useMemo(
        () => roleSuggestedSkills.slice(0, 6),
        [roleSuggestedSkills]
    );

    const guidedLicenseSuggestions = useMemo(
        () => roleSuggestedLicenses.slice(0, 5),
        [roleSuggestedLicenses]
    );

    const studioRemainingCount = studioFieldsMissing.length;

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const showSub = Keyboard.addListener(showEvent, (event) => {
            keyboardHeightRef.current = Number(event?.endCoordinates?.height || 0);
        });
        const hideSub = Keyboard.addListener(hideEvent, () => {
            keyboardHeightRef.current = 0;
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const hydrateCachedProfiles = async () => {
            try {
                const raw = await AsyncStorage.getItem(WORKER_PROFILE_CACHE_KEY);
                if (!raw || cancelled) return;
                const parsed = JSON.parse(raw);
                if (!Array.isArray(parsed)) return;
                if (!parsed.some(hasMeaningfulProfileData)) return;
                setProfiles((previous) => (previous.length > 0 ? previous : parsed));
            } catch (_error) {
                // Best-effort cache hydration only.
            }
        };

        hydrateCachedProfiles();
        return () => {
            cancelled = true;
        };
    }, []);

    const mapProfilesFromApi = useCallback((profile) => {
        if (!profile) return [];
        const fullName = resolveProfileDisplayName({
            firstName: profile.firstName,
            lastName: profile.lastName,
            fallbackName: user?.name,
        });
        const roleProfiles = Array.isArray(profile.roleProfiles) ? profile.roleProfiles : [];
        if (roleProfiles.length === 0) {
            return [
                toEmptyProfileTemplate({
                    profileId: String(profile._id || 'profile-default'),
                    fullName,
                    avatar: profile.avatar || profile.logoUrl || null,
                    interviewVerified: profile.interviewVerified,
                    activeProfile: true,
                }),
            ];
        }
        const hasActiveProfile = roleProfiles.some((roleProfile) => Boolean(roleProfile?.activeProfile));
        const mappedProfiles = roleProfiles.map((rp, index) => {
            const profileId = resolveProfileIdForApi(
                { profileId: rp?.profileId, roleName: rp?.roleName, _id: rp?._id },
                index
            ) || String(profile._id || `profile-${index}`);
            if (suppressedProfileIds.includes(profileId)) {
                return null;
            }
            const isSeeded = isSeededGenericRoleProfile(rp, profile);
            if (isSeeded) {
                return toEmptyProfileTemplate({
                    profileId,
                    fullName,
                    avatar: profile.avatar || profile.logoUrl || null,
                    interviewVerified: profile.interviewVerified,
                    activeProfile: hasActiveProfile ? Boolean(rp?.activeProfile) : index === 0,
                });
            }

            return {
                _id: profileId,
                profileId,
                name: fullName,
                roleTitle: String(rp.roleName || rp.roleTitle || '').trim(),
                experienceYears: Number.isFinite(Number(rp.experienceInRole ?? rp.experienceYears))
                    ? Number(rp.experienceInRole ?? rp.experienceYears)
                    : null,
                expectedSalary: Number.isFinite(Number(rp.expectedSalary)) ? Number(rp.expectedSalary) : null,
                skills: Array.isArray(rp.skills) ? rp.skills.filter(Boolean) : [],
                location: String(profile.district || profile.city || '').trim(),
                panchayat: String(profile.mandal || profile.panchayat || '').trim(),
                language: String(profile.language || '').trim(),
                maxCommuteDistanceKm: Number.isFinite(Number(profile?.settings?.matchPreferences?.maxCommuteDistanceKm))
                    ? Number(profile.settings.matchPreferences.maxCommuteDistanceKm)
                    : 25,
                minimumMatchTier: ['STRONG', 'GOOD', 'POSSIBLE'].includes(String(profile?.settings?.matchPreferences?.minimumMatchTier || '').toUpperCase())
                    ? String(profile.settings.matchPreferences.minimumMatchTier).toUpperCase()
                    : 'GOOD',
                preferredShift: SHIFT_OPTIONS.includes(String(profile.preferredShift || '').trim())
                    ? String(profile.preferredShift || '').trim()
                    : 'Flexible',
                isAvailable: profile?.isAvailable !== false,
                availabilityWindowDays: [0, 15, 30].includes(Number(profile?.availabilityWindowDays))
                    ? Number(profile.availabilityWindowDays)
                    : 0,
                openToRelocation: Boolean(profile?.openToRelocation),
                openToNightShift: Boolean(profile?.openToNightShift),
                licenses: Array.isArray(profile.licenses) ? profile.licenses.filter(Boolean) : [],
                avatar: profile.avatar || profile.logoUrl || null,
                interviewVerified: Boolean(profile.interviewVerified),
                activeProfile: hasActiveProfile ? Boolean(rp?.activeProfile) : index === 0,
                isDefault: hasActiveProfile ? Boolean(rp?.activeProfile) : index === 0,
                createdAt: rp?.createdAt || profile?.createdAt || null,
            };
        }).filter(Boolean).sort((left, right) => {
            const leftCreatedAt = Date.parse(left?.createdAt || '') || 0;
            const rightCreatedAt = Date.parse(right?.createdAt || '') || 0;
            if (rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt;
            if (left.activeProfile === right.activeProfile) return 0;
            return left.activeProfile ? -1 : 1;
        });
        return mappedProfiles;
    }, [suppressedProfileIds, user?.name]);

    const fetchProfileData = useCallback(async ({ preservePreviousOnIncomplete = true } = {}) => {
        const requestId = profileRequestIdRef.current + 1;
        profileRequestIdRef.current = requestId;
        setIsLoading(true);
        try {
            setErrorMsg('');
            const profileResponse = await withRequestTimeout(
                client.get('/api/users/profile', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    __maxRetries: 1,
                    timeout: REQUEST_TIMEOUT_MS,
                    params: { role: 'worker' },
                }),
                'Profile request timed out',
            );
            if (requestId !== profileRequestIdRef.current) return;

            const validatedProfile = validateProfileResponse(profileResponse?.data);
            const workerProfileId = String(validatedProfile?._id || '').trim();
            if (workerProfileId) {
                AsyncStorage.setItem('@worker_profile_id', workerProfileId).catch(() => { });
            }
            const mappedProfiles = mapProfilesFromApi(validatedProfile);
            const hasExplicitRoleProfiles = Array.isArray(validatedProfile?.roleProfiles);
            let resolvedProfiles = mappedProfiles;
            setProfiles((previousProfiles) => {
                const previousHasMeaningfulData = previousProfiles.some(hasMeaningfulProfileData);
                const nextHasMeaningfulData = mappedProfiles.some(hasMeaningfulProfileData);

                // Preserve previous profiles only when server payload is incomplete.
                // If server explicitly returns roleProfiles (including empty), trust it.
                if (
                    preservePreviousOnIncomplete
                    && !nextHasMeaningfulData
                    && previousHasMeaningfulData
                    && !hasExplicitRoleProfiles
                ) {
                    resolvedProfiles = previousProfiles;
                    return previousProfiles;
                }
                resolvedProfiles = mappedProfiles;
                return mappedProfiles;
            });
            if (resolvedProfiles.some(hasMeaningfulProfileData)) {
                AsyncStorage.setItem(WORKER_PROFILE_CACHE_KEY, JSON.stringify(resolvedProfiles)).catch(() => { });
            } else {
                AsyncStorage.removeItem(WORKER_PROFILE_CACHE_KEY).catch(() => { });
            }
        } catch (e) {
            if (requestId !== profileRequestIdRef.current) return;
            if (e?.name === 'ApiValidationError') {
                logValidationError(e, '/api/users/profile');
            }
            if (isProfileRoleGateError(e)) {
                if (!preservePreviousOnIncomplete) {
                    setProfiles([]);
                    AsyncStorage.removeItem(WORKER_PROFILE_CACHE_KEY).catch(() => { });
                }
                setErrorMsg('');
                return;
            }
            if (!preservePreviousOnIncomplete) {
                setProfiles([]);
                AsyncStorage.removeItem(WORKER_PROFILE_CACHE_KEY).catch(() => { });
            }
            setErrorMsg('');
        } finally {
            if (requestId === profileRequestIdRef.current) {
                setIsLoading(false);
            }
        }
    }, [mapProfilesFromApi]);

    const fetchPools = useCallback(async () => {
        const requestId = poolsRequestIdRef.current + 1;
        poolsRequestIdRef.current = requestId;
        setIsLoading(true);
        try {
            setErrorMsg('');
            const { data } = await withRequestTimeout(
                client.get('/api/jobs/my-jobs', {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    __maxRetries: 1,
                    timeout: REQUEST_TIMEOUT_MS,
                }),
                'Talent pools request timed out',
            );
            if (requestId !== poolsRequestIdRef.current) return;
            const jobs = Array.isArray(data)
                ? data
                : (Array.isArray(data?.data) ? data.data : null);
            if (!jobs) {
                throw new Error('Invalid jobs response format.');
            }
            const mappedPools = jobs
                .map((job) => {
                    const id = String(job?._id || '').trim();
                    if (!id) return null;
                    return {
                        id,
                        name: job.title || 'Job Pool',
                        count: Number(job.applicantCount || 0),
                    };
                })
                .filter(Boolean);
            setPools(mappedPools);
        } catch (e) {
            if (requestId !== poolsRequestIdRef.current) return;
            if (isProfileRoleGateError(e)) {
                setPools([]);
                setErrorMsg('');
                return;
            }
            setPools([]);
            setErrorMsg('');
        } finally {
            if (requestId === poolsRequestIdRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    const fetchPoolCandidates = useCallback(async (jobId, { preserveSelection = true } = {}) => {
        const normalizedJobId = String(jobId || '').trim();
        if (!normalizedJobId) {
            setPoolProfiles([]);
            setSelectedCandidate(null);
            setErrorMsg('');
            setIsLoading(false);
            return;
        }

        const requestId = poolCandidatesRequestIdRef.current + 1;
        poolCandidatesRequestIdRef.current = requestId;
        setIsLoading(true);
        try {
            setErrorMsg('');
            const { data } = await withRequestTimeout(
                client.get(`/api/matches/employer/${normalizedJobId}`, {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    __maxRetries: 1,
                    timeout: REQUEST_TIMEOUT_MS,
                }),
                'Candidates request timed out',
            );
            if (requestId !== poolCandidatesRequestIdRef.current) return;
            const matches = Array.isArray(data)
                ? data
                : (Array.isArray(data?.matches) ? data.matches : null);
            if (!matches) {
                throw new Error('Invalid candidates response format.');
            }
            const mappedCandidates = matches.map((item, idx) => {
                const worker = item.worker || {};
                const firstRole = worker.roleProfiles && worker.roleProfiles[0] ? worker.roleProfiles[0] : {};
                const applicationKey = String(item?.applicationId || item?._id || '').trim();
                const workerKey = String(worker?._id || '').trim();
                const candidateId = applicationKey
                    ? `app-${applicationKey}`
                    : workerKey
                        ? `pool-${normalizedJobId}-worker-${workerKey}-${idx}`
                        : `pool-${normalizedJobId}-row-${idx}`;
                return {
                    id: candidateId,
                    name: String(worker?.user?.name || worker?.firstName || worker?.name || 'Job Seeker'),
                    roleTitle: firstRole.roleName || 'Job Seeker',
                    experienceYears: firstRole.experienceInRole || worker.totalExperience || 0,
                    location: worker.city || 'Remote',
                    summary: String(item?.whyThisMatchesYou || item?.matchWhy?.summary || '').trim(),
                    skills: firstRole.skills || [],
                };
            });
            setPoolProfiles(mappedCandidates);
            setSelectedCandidate((previous) => {
                if (!preserveSelection || !previous) return null;
                return mappedCandidates.find((candidate) => String(candidate.id) === String(previous.id)) || null;
            });
        } catch (e) {
            if (requestId !== poolCandidatesRequestIdRef.current) return;
            setErrorMsg('');
            setPoolProfiles([]);
        } finally {
            if (requestId === poolCandidatesRequestIdRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            const profileViewPayload = {
                source: 'profiles_screen',
                mode: role === 'employer' ? 'talent' : 'profile',
            };
            trackEvent('PROFILE_VIEWED', profileViewPayload);
        }, [role])
    );

    useFocusEffect(
        useCallback(() => {
            if (role === 'employee') {
                fetchProfileData();
            } else {
                if (selectedPool?.id) {
                    fetchPoolCandidates(selectedPool.id);
                } else {
                    fetchPools();
                }
            }
        }, [role, fetchProfileData, fetchPools, fetchPoolCandidates, selectedPool?.id])
    );

    const invalidateJobMatchCache = useCallback(async ({ deepClean = false } = {}) => {
        try {
            const allKeys = await AsyncStorage.getAllKeys();
            const matchKeys = allKeys.filter((key) => (
                key === JOBS_CACHE_PREFIX
                || key.startsWith(`${JOBS_CACHE_PREFIX}:`)
                || (deepClean && (
                    key === WORKER_PROFILE_CACHE_KEY
                    || key === WORKER_PROFILE_ID_KEY
                    || key === WORKER_PROFILE_VERSION_KEY
                    || key === DISMISSED_JOBS_KEY
                    || key.startsWith(EXPLAIN_CACHE_PREFIX)
                    || key.startsWith(CACHED_CANDIDATES_PREFIX)
                    || key.startsWith('@chat_history_')
                    || key.startsWith('@cached_')
                    || key === '@hc_last_active_at'
                ))
            ));
            if (matchKeys.length > 0) {
                await AsyncStorage.multiRemove(matchKeys);
            }
            await AsyncStorage.setItem(WORKER_PROFILE_VERSION_KEY, String(Date.now()));
        } catch (_error) {
            // Best-effort invalidation only.
        }
    }, []);

    const openEdit = (prof) => {
        const normalized = {
            ...prof,
            profileId: String(prof?.profileId || prof?._id || generateProfileId()),
            _id: String(prof?.profileId || prof?._id || generateProfileId()),
            skills: Array.isArray(prof?.skills) ? prof.skills : [],
            licenses: Array.isArray(prof?.licenses) ? prof.licenses : [],
            roleTitle: String(prof?.roleTitle || ''),
            name: String(prof?.name || ''),
            location: String(prof?.location || ''),
            panchayat: String(prof?.panchayat || ''),
            language: String(prof?.language || ''),
            maxCommuteDistanceKm: Number.isFinite(Number(prof?.maxCommuteDistanceKm))
                ? Number(prof.maxCommuteDistanceKm)
                : 25,
            minimumMatchTier: ['STRONG', 'GOOD', 'POSSIBLE'].includes(String(prof?.minimumMatchTier || '').toUpperCase())
                ? String(prof.minimumMatchTier).toUpperCase()
                : 'GOOD',
            activeProfile: Boolean(prof?.activeProfile),
            createdAt: prof?.createdAt || new Date().toISOString(),
            isNew: false,
            preferredShift: SHIFT_OPTIONS.includes(String(prof?.preferredShift || '').trim())
                ? String(prof?.preferredShift || '').trim()
                : 'Flexible',
            isAvailable: prof?.isAvailable !== false,
            availabilityWindowDays: [0, 15, 30].includes(Number(prof?.availabilityWindowDays))
                ? Number(prof.availabilityWindowDays)
                : 0,
            openToRelocation: Boolean(prof?.openToRelocation),
            openToNightShift: Boolean(prof?.openToNightShift),
            experienceYears: Number.isFinite(Number(prof?.experienceYears)) ? Number(prof.experienceYears) : null,
            expectedSalary: Number.isFinite(Number(prof?.expectedSalary)) ? Number(prof.expectedSalary) : null,
        };
        const normalizedRoleTitle = String(normalized.roleTitle || '').trim();
        const roleDefaultsForEdit = getRoleDefaults(normalizedRoleTitle);
        const seededSalary = Number(roleDefaultsForEdit?.suggestedSalary || 0);
        const seededProfile = {
            ...normalized,
            location: String(normalized.location || '').trim(),
            panchayat: String(normalized.panchayat || '').trim(),
            language: getDefaultApLanguage(String(normalized.language || user?.language || '')),
            expectedSalary: Number.isFinite(Number(normalized.expectedSalary)) && Number(normalized.expectedSalary) > 0
                ? Number(normalized.expectedSalary)
                : (seededSalary > 0 ? seededSalary : null),
        };

        setEditingProfile(seededProfile);
        setSkillInput('');
        setLicenseInput('');
        setAiAssistLoading(false);
        setFormAssistMessage('');
        setRoleSuggestedSkills(Array.isArray(roleDefaultsForEdit?.skills) ? roleDefaultsForEdit.skills : []);
        setRoleSuggestedLicenses(Array.isArray(roleDefaultsForEdit?.certifications) ? roleDefaultsForEdit.certifications : []);
        setRoleSuggestedSalary(seededSalary > 0 ? seededSalary : 0);
        setIsCustomExperience(Number(seededProfile.experienceYears || 0) > 10);
        setIsCustomSalary(
            Number(seededProfile.expectedSalary || 0) > 0
            && (
                seededSalary <= 0
                || Number(seededProfile.expectedSalary || 0) !== Number(seededSalary || 0)
            )
        );
        setSelectedRoleCategory(String(normalized.roleCategory || inferRoleCategory(normalizedRoleTitle) || '').trim());
        setActiveStudioCard(resolveInitialStudioCard(seededProfile, inferRoleCategory(normalizedRoleTitle)));
        roleDefaultsAppliedKeyRef.current = normalizeToken(normalizedRoleTitle);
        setIsModalVisible(true);
    };

    const handleSelectRoleCategory = useCallback((categoryLabel) => {
        const nextCategory = String(categoryLabel || '').trim();
        setSelectedRoleCategory(nextCategory);
        setFormAssistMessage('');
        setRoleSuggestedSkills([]);
        setRoleSuggestedLicenses([]);
        setRoleSuggestedSalary(0);
        roleDefaultsAppliedKeyRef.current = '';
        const allowedTitles = new Set(getRoleTitlesForCategory(nextCategory).map((item) => normalizeToken(item)));
        setEditingProfile((prev) => {
            if (!prev) return prev;
            const currentRole = String(prev.roleTitle || '').trim();
            if (!currentRole) return prev;
            if (allowedTitles.has(normalizeToken(currentRole))) {
                return prev;
            }
            return { ...prev, roleTitle: '' };
        });
    }, []);

    const handleSelectRoleTitle = useCallback((value, options = {}) => {
        const selectedRole = String(value || '').trim();
        patchEditingProfile({ roleTitle: selectedRole });
        const nextCategory = String(options?.category || inferRoleCategory(selectedRole) || selectedRoleCategory || '').trim();
        if (nextCategory) setSelectedRoleCategory(nextCategory);
        if (!selectedRole) return;
        applyRoleDefaults(selectedRole, { announce: false, applySalaryIfMissing: true });
        roleDefaultsAppliedKeyRef.current = normalizeToken(selectedRole);
    }, [applyRoleDefaults, patchEditingProfile, selectedRoleCategory]);

    const handleGoToStudioCard = useCallback((stepId) => {
        const safeStepId = String(stepId || '').trim();
        if (!safeStepId) return;
        if (safeStepId === 'role') {
            setActiveStudioCard('role');
            moveStudioToCardStart();
            return;
        }
        if (safeStepId === 'basics' && isRoleReadyForStudio(editingProfile, effectiveRoleCategory)) {
            setActiveStudioCard('basics');
            moveStudioToCardStart();
            return;
        }
        if (safeStepId === 'fit' && isRoleReadyForStudio(editingProfile, effectiveRoleCategory) && isBasicsReadyForStudio(editingProfile)) {
            setActiveStudioCard('fit');
            moveStudioToCardStart();
            return;
        }
        if (
            safeStepId === 'skills'
            && isRoleReadyForStudio(editingProfile, effectiveRoleCategory)
            && isBasicsReadyForStudio(editingProfile)
            && isJobFitReadyForStudio(editingProfile)
        ) {
            setActiveStudioCard('skills');
            moveStudioToCardStart();
        }
    }, [editingProfile, effectiveRoleCategory, moveStudioToCardStart]);

    const handleNextStudioCard = useCallback(() => {
        if (!canAdvanceStudioCard) return;
        const currentIndex = STUDIO_CARD_ORDER.indexOf(activeStudioCard);
        const nextStepId = STUDIO_CARD_ORDER[currentIndex + 1];
        if (nextStepId) {
            setActiveStudioCard(nextStepId);
            moveStudioToCardStart();
        }
    }, [activeStudioCard, canAdvanceStudioCard, moveStudioToCardStart]);

    const handleBackStudioCard = useCallback(() => {
        const currentIndex = STUDIO_CARD_ORDER.indexOf(activeStudioCard);
        const previousStepId = STUDIO_CARD_ORDER[Math.max(0, currentIndex - 1)];
        if (previousStepId) {
            setActiveStudioCard(previousStepId);
            moveStudioToCardStart();
        }
    }, [activeStudioCard, moveStudioToCardStart]);

    const addSkillToken = useCallback((value) => {
        const token = String(value || '').trim();
        if (!token) return false;
        setEditingProfile((prev) => {
            const existing = Array.isArray(prev?.skills) ? prev.skills : [];
            if (existing.some((item) => normalizeToken(item) === normalizeToken(token))) return prev;
            return { ...prev, skills: [...existing, token] };
        });
        return true;
    }, []);

    const handleAddSkill = () => {
        const didAdd = addSkillToken(skillInput);
        if (!didAdd) return;
        setSkillInput('');
    };

    const handleRemoveSkill = (idx) => {
        setEditingProfile((prev) => ({
            ...prev,
            skills: (Array.isArray(prev?.skills) ? prev.skills : []).filter((_, i) => i !== idx),
        }));
    };

    const handleAddLicense = () => {
        const license = licenseInput.trim();
        if (!license) return;
        setEditingProfile((prev) => {
            const existing = Array.isArray(prev?.licenses) ? prev.licenses : [];
            if (existing.some((item) => normalizeToken(item) === normalizeToken(license))) return prev;
            return { ...prev, licenses: [...existing, license] };
        });
        setLicenseInput('');
    };

    const handleRemoveLicense = (idx) => {
        setEditingProfile((prev) => ({
            ...prev,
            licenses: (Array.isArray(prev?.licenses) ? prev.licenses : []).filter((_, i) => i !== idx),
        }));
    };

    const applyRoleDefaults = useCallback((roleTitle, options = {}) => {
        const {
            announce = false,
            applySalaryIfMissing = true,
        } = options;
        const normalizedRoleTitle = String(roleTitle || '').trim();
        if (!normalizedRoleTitle) return;

        const defaults = getRoleDefaults(normalizedRoleTitle);
        const nextSuggestedSalary = Number(defaults?.suggestedSalary || 0);
        setRoleSuggestedSkills(Array.isArray(defaults?.skills) ? defaults.skills : []);
        setRoleSuggestedLicenses(Array.isArray(defaults?.certifications) ? defaults.certifications : []);
        setRoleSuggestedSalary(nextSuggestedSalary > 0 ? nextSuggestedSalary : 0);

        setEditingProfile((prev) => {
            if (!prev) return prev;
            const existingSkills = Array.isArray(prev.skills) ? prev.skills : [];
            const existingLicenses = Array.isArray(prev.licenses) ? prev.licenses : [];
            const safeExperience = Number.isFinite(Number(prev.experienceYears))
                ? Number(prev.experienceYears)
                : null;
            const existingSalary = Number(prev.expectedSalary || 0);
            const shouldSeedSalary = applySalaryIfMissing
                && !isCustomSalary
                && (!Number.isFinite(existingSalary) || existingSalary <= 0)
                && nextSuggestedSalary > 0;

            return {
                ...prev,
                skills: mergeUniqueTokens(existingSkills, defaults?.skills || [], 25),
                licenses: mergeUniqueTokens(existingLicenses, defaults?.certifications || [], 25),
                language: getDefaultApLanguage(String(prev.language || defaults?.languageHints?.[0] || '')),
                preferredShift: SHIFT_OPTIONS.includes(String(prev.preferredShift || '').trim())
                    ? String(prev.preferredShift || '').trim()
                    : 'Flexible',
                experienceYears: safeExperience,
                expectedSalary: shouldSeedSalary ? nextSuggestedSalary : prev.expectedSalary,
            };
        });

        if (announce) {
            setFormAssistMessage('Role defaults applied. You can still edit every field.');
        }
    }, [isCustomSalary]);

    const runRoleAiAssist = useCallback(async (roleTitle, options = {}) => {
        const {
            auto = false,
            force = false,
        } = options;
        const normalizedRoleTitle = String(roleTitle || '').trim();
        if (!normalizedRoleTitle) return;
        const roleKey = normalizeToken(normalizedRoleTitle);
        const fallbackDefaults = getRoleDefaults(normalizedRoleTitle);

        const cached = roleAiCacheRef.current?.[roleKey];
        if (!force && cached) {
            setRoleSuggestedSkills(cached.skills);
            setRoleSuggestedLicenses(cached.certifications);
            setRoleSuggestedSalary(cached.suggestedSalary);
            setEditingProfile((prev) => {
                if (!prev) return prev;
                const existingSalary = Number(prev.expectedSalary || 0);
                const shouldSeedSalary = !isCustomSalary
                    && (!Number.isFinite(existingSalary) || existingSalary <= 0)
                    && Number(cached.suggestedSalary) > 0;
                return {
                    ...prev,
                    skills: mergeUniqueTokens(prev.skills, cached.skills, 25),
                    licenses: mergeUniqueTokens(prev.licenses, cached.certifications, 25),
                    language: getDefaultApLanguage(String(prev.language || cached.language || '')),
                    preferredShift: SHIFT_OPTIONS.includes(String(prev.preferredShift || '').trim())
                        ? String(prev.preferredShift || '').trim()
                        : String(cached.preferredShift || 'Flexible').trim(),
                    expectedSalary: shouldSeedSalary ? Number(cached.suggestedSalary) : prev.expectedSalary,
                };
            });
            if (!auto) {
                setFormAssistMessage('Refreshed role suggestions.');
            }
            return;
        }

        const requestId = roleAiRequestIdRef.current + 1;
        roleAiRequestIdRef.current = requestId;
        setAiAssistLoading(true);
        if (!auto) setFormAssistMessage('');

        try {
            const roleCategory = inferRoleCategory(normalizedRoleTitle);
            const { data } = await client.post('/api/features/ai/profile-suggestions', {
                roleName: normalizedRoleTitle,
                roleCategory: roleCategory || undefined,
                context: 'worker_profile',
            }, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
            });

            if (requestId !== roleAiRequestIdRef.current) return;

            const responseRoot = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
            const nestedPayload = [
                responseRoot?.data,
                responseRoot?.result,
                responseRoot?.suggestions,
                responseRoot?.payload,
            ].find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) || responseRoot;

            const aiSkills = pickFirstTokenArray([
                nestedPayload?.skills,
                nestedPayload?.recommendedSkills,
                nestedPayload?.skillSuggestions,
                nestedPayload?.topSkills,
            ], 12);
            const aiCertifications = pickFirstTokenArray([
                nestedPayload?.certifications,
                nestedPayload?.licenses,
                nestedPayload?.licenseHints,
                nestedPayload?.recommendedCertifications,
                nestedPayload?.certificates,
            ], 12);
            const aiSuggestedSalary = pickFirstPositiveNumber([
                nestedPayload?.salaryHint,
                nestedPayload?.suggestedSalary,
                nestedPayload?.expectedSalary,
                nestedPayload?.salary,
            ]);
            const aiCity = pickFirstString([
                nestedPayload?.city,
                nestedPayload?.preferredCity,
                nestedPayload?.cityHint,
                nestedPayload?.location,
            ]);
            const aiLanguage = pickFirstString([
                nestedPayload?.language,
                nestedPayload?.primaryLanguage,
                nestedPayload?.languageHint,
            ]);
            const aiPreferredShift = pickFirstString([
                nestedPayload?.preferredShift,
                nestedPayload?.shift,
                nestedPayload?.workShift,
            ]);
            const normalizedAiShift = SHIFT_OPTIONS.find((shift) => normalizeToken(shift) === normalizeToken(aiPreferredShift)) || '';
            const payload = {
                skills: mergeUniqueTokens(fallbackDefaults.skills, aiSkills, 20),
                certifications: mergeUniqueTokens(fallbackDefaults.certifications, aiCertifications, 20),
                suggestedSalary: Number.isFinite(aiSuggestedSalary) && aiSuggestedSalary > 0
                    ? Math.round(aiSuggestedSalary)
                    : Number(fallbackDefaults.suggestedSalary || 0),
                city: String(aiCity || fallbackDefaults?.cityHints?.[0] || '').trim(),
                language: String(aiLanguage || fallbackDefaults?.languageHints?.[0] || '').trim(),
                preferredShift: normalizedAiShift
                    ? normalizedAiShift
                    : 'Flexible',
            };

            roleAiCacheRef.current[roleKey] = payload;
            setRoleSuggestedSkills(payload.skills);
            setRoleSuggestedLicenses(payload.certifications);
            setRoleSuggestedSalary(payload.suggestedSalary);

            setEditingProfile((prev) => {
                if (!prev) return prev;
                const existingSalary = Number(prev.expectedSalary || 0);
                const shouldSeedSalary = !isCustomSalary
                    && (!Number.isFinite(existingSalary) || existingSalary <= 0)
                    && Number(payload.suggestedSalary) > 0;
                return {
                    ...prev,
                    skills: mergeUniqueTokens(prev.skills, payload.skills, 25),
                    licenses: mergeUniqueTokens(prev.licenses, payload.certifications, 25),
                    language: getDefaultApLanguage(String(prev.language || payload.language || '')),
                    preferredShift: SHIFT_OPTIONS.includes(String(prev.preferredShift || '').trim())
                        ? String(prev.preferredShift || '').trim()
                        : payload.preferredShift,
                    expectedSalary: shouldSeedSalary ? Number(payload.suggestedSalary) : prev.expectedSalary,
                };
            });

            if (!auto) {
                setFormAssistMessage('AI suggestions applied for this role.');
            }
        } catch (_error) {
            if (requestId !== roleAiRequestIdRef.current) return;
            setRoleSuggestedSkills(Array.isArray(fallbackDefaults?.skills) ? fallbackDefaults.skills : []);
            setRoleSuggestedLicenses(Array.isArray(fallbackDefaults?.certifications) ? fallbackDefaults.certifications : []);
            setRoleSuggestedSalary(Number(fallbackDefaults?.suggestedSalary || 0));
            if (!auto) {
                setFormAssistMessage('AI unavailable right now. Showing role-based local suggestions.');
            }
        } finally {
            if (requestId === roleAiRequestIdRef.current) {
                setAiAssistLoading(false);
            }
        }
    }, [isCustomSalary]);

    const applyWorkerSmartPreset = useCallback(() => {
        const roleTitle = String(editingProfile?.roleTitle || '').trim();
        if (!roleTitle) {
            setFormAssistMessage('Enter a role title first to apply defaults.');
            return;
        }
        applyRoleDefaults(roleTitle, { announce: true, applySalaryIfMissing: true });
    }, [applyRoleDefaults, editingProfile?.roleTitle]);

    const handleAiProfileAssist = useCallback(async () => {
        const roleTitle = String(editingProfile?.roleTitle || '').trim();
        if (!roleTitle) {
            setFormAssistMessage('Enter a role title first to refresh AI suggestions.');
            return;
        }
        await runRoleAiAssist(roleTitle, { auto: false, force: true });
    }, [editingProfile?.roleTitle, runRoleAiAssist]);

    useEffect(() => {
        if (!isModalVisible) return undefined;
        const roleTitle = String(editingProfile?.roleTitle || '').trim();
        if (roleTitle.length < 2) {
            setRoleSuggestedSkills([]);
            setRoleSuggestedLicenses([]);
            setRoleSuggestedSalary(0);
            return undefined;
        }
        const roleKey = normalizeToken(roleTitle);
        if (!roleKey) return undefined;

        if (!hasExactRoleSelection) {
            setRoleSuggestedSkills([]);
            setRoleSuggestedLicenses([]);
            setRoleSuggestedSalary(0);
            roleDefaultsAppliedKeyRef.current = '';
            return undefined;
        }

        if (roleDefaultsAppliedKeyRef.current !== roleKey) {
            applyRoleDefaults(roleTitle, { announce: false, applySalaryIfMissing: true });
            roleDefaultsAppliedKeyRef.current = roleKey;
        }

        return () => {
            if (roleAiDebounceRef.current) {
                clearTimeout(roleAiDebounceRef.current);
            }
        };
    }, [applyRoleDefaults, editingProfile?.roleTitle, hasExactRoleSelection, isModalVisible]);

    useEffect(() => {
        if (isModalVisible) return;
        roleDefaultsAppliedKeyRef.current = '';
        roleAiCacheRef.current = {};
        if (roleAiDebounceRef.current) {
            clearTimeout(roleAiDebounceRef.current);
            roleAiDebounceRef.current = null;
        }
    }, [isModalVisible]);

    const uploadAvatarUri = useCallback(async (uri, mimeType = 'image/jpeg') => {
        const safeUri = String(uri || '').trim();
        if (!safeUri) return '';

        const fileName = safeUri.split('/').pop() || `avatar-${Date.now()}.jpg`;
        const formData = new FormData();
        formData.append('avatar', { uri: safeUri, name: fileName, type: mimeType });

        const response = await withRequestTimeout(
            client.post('/api/settings/avatar', formData, {
                __allowWhenCircuitOpen: true,
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: AVATAR_SYNC_TIMEOUT_MS,
            }),
            'Photo upload timed out',
            AVATAR_SYNC_TIMEOUT_MS
        );

        return String(response?.data?.avatarUrl || safeUri).trim();
    }, []);

    const handleAvatarPress = useCallback(async () => {
        if (!editingProfile) return;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission needed', 'Allow photo access to upload avatar');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.8,
        });

        if (result.canceled || !result.assets?.length) return;

        const asset = result.assets[0];
        const uri = asset.uri;
        if (!uri) return;

        setEditingProfile((prev) => (prev ? { ...prev, avatar: uri } : prev));
        setProfiles((prev) => prev.map((profile) => (
            profile._id === editingProfile._id
                ? { ...profile, avatar: uri }
                : profile
        )));
        setUploadingAvatar(false);
        setFormAssistMessage('Photo added. Save profile to finish syncing it.');
    }, [editingProfile]);

    const handleSave = async () => {
        if (!editingProfile) return;
        if (isSavingProfile) return;

        const roleTitle = String(editingProfile.roleTitle || '').trim();
        const location = String(editingProfile.location || '').trim();
        const mandal = String(editingProfile.panchayat || '').trim();
        const locationLabel = [mandal, location].filter(Boolean).join(', ');

        if (!roleTitle) {
            Alert.alert('Missing Field', 'Role Title is required.');
            return;
        }
        if (!location) {
            Alert.alert('Missing Field', 'Location is required.');
            return;
        }
        if (!Array.isArray(editingProfile.skills) || editingProfile.skills.length === 0) {
            Alert.alert('Missing Field', 'Add at least one skill before saving.');
            return;
        }
        if (!hasExperienceSelection) {
            Alert.alert('Missing Field', 'Select your experience before saving.');
            return;
        }
        if (Number(editingProfile.expectedSalary || 0) <= 0) {
            Alert.alert('Missing Field', 'Expected pay is required.');
            return;
        }

        const profileId = String(editingProfile.profileId || editingProfile._id || generateProfileId());
        const nameParts = String(editingProfile.name || '').trim().split(' ').filter(Boolean);
        const accountNameParts = sanitizeProfileNamePrefill(user?.name || '').split(' ').filter(Boolean);
        const firstName = nameParts[0] || accountNameParts[0] || 'Profile';
        const lastName = nameParts.length > 1
            ? nameParts.slice(1).join(' ')
            : accountNameParts.slice(1).join(' ');
        const safeExperience = Number.isFinite(Number(editingProfile.experienceYears))
            ? Number(editingProfile.experienceYears)
            : 0;
        const safeAvailability = [0, 15, 30].includes(Number(editingProfile.availabilityWindowDays))
            ? Number(editingProfile.availabilityWindowDays)
            : 0;
        const rawSkills = Array.isArray(editingProfile.skills) ? editingProfile.skills.filter(Boolean) : [];
        const skills = rawSkills.length > 0
            ? rawSkills
            : (roleTitle ? [roleTitle] : []);
        const rawAvatar = String(editingProfile.avatar || '').trim();
        const pendingLocalAvatar = isLocalAssetUri(rawAvatar) ? rawAvatar : '';
        const resolvedAvatar = pendingLocalAvatar ? '' : rawAvatar;

        let nextCompletion = null;
        try {
            setIsSavingProfile(true);
            Keyboard.dismiss();

            const payload = {
                profileId,
                roleName: roleTitle,
                experienceInRole: safeExperience,
                ...(Number.isFinite(Number(editingProfile.expectedSalary))
                    ? { expectedSalary: Number(editingProfile.expectedSalary) }
                    : {}),
                ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
                skills,
                activeProfile: Boolean(editingProfile.activeProfile),
                createdAt: editingProfile.createdAt || new Date().toISOString(),
                firstName,
                lastName,
                city: location,
                district: location,
                mandal,
                panchayat: mandal,
                locationLabel,
                language: String(editingProfile.language || '').trim(),
                totalExperience: safeExperience,
                preferredShift: SHIFT_OPTIONS.includes(String(editingProfile.preferredShift || '').trim())
                    ? String(editingProfile.preferredShift || '').trim()
                    : 'Flexible',
                isAvailable: editingProfile.isAvailable !== false,
                availabilityWindowDays: safeAvailability,
                openToRelocation: Boolean(editingProfile.openToRelocation),
                openToNightShift: Boolean(editingProfile.openToNightShift),
                licenses: Array.isArray(editingProfile.licenses)
                    ? editingProfile.licenses.filter(Boolean)
                    : [],
                matchPreferences: {
                    maxCommuteDistanceKm: Number.isFinite(Number(editingProfile.maxCommuteDistanceKm))
                        ? Number(editingProfile.maxCommuteDistanceKm)
                        : 25,
                    preferredShiftTimes: SHIFT_OPTIONS.includes(String(editingProfile.preferredShift || '').trim())
                        && String(editingProfile.preferredShift || '').trim() !== 'Flexible'
                        ? [String(editingProfile.preferredShift || '').trim()]
                        : [],
                    roleClusters: String(effectiveRoleCategory || inferredRoleCategory || '').trim()
                        ? [String(effectiveRoleCategory || inferredRoleCategory || '').trim()]
                        : [],
                    minimumMatchTier: ['STRONG', 'GOOD', 'POSSIBLE'].includes(String(editingProfile.minimumMatchTier || '').toUpperCase())
                        ? String(editingProfile.minimumMatchTier).toUpperCase()
                        : 'GOOD',
                },
            };

            let response;
            if (editingProfile.isNew) {
                response = await withRequestTimeout(
                    client.post('/api/users/profiles', payload, {
                        __skipApiErrorHandler: true,
                        __allowWhenCircuitOpen: true,
                        __maxRetries: 1,
                        timeout: PROFILE_SAVE_TIMEOUT_MS,
                    }),
                    'Profile save timed out',
                    PROFILE_SAVE_TIMEOUT_MS
                );
            } else {
                response = await withRequestTimeout(
                    client.put(`/api/users/profiles/${encodeURIComponent(profileId)}`, payload, {
                        __skipApiErrorHandler: true,
                        __allowWhenCircuitOpen: true,
                        __maxRetries: 1,
                        timeout: PROFILE_SAVE_TIMEOUT_MS,
                    }),
                    'Profile save timed out',
                    PROFILE_SAVE_TIMEOUT_MS
                );
            }
            nextCompletion = response?.data?.profileCompletion || null;

            const readiness = getNormalizedProfileReadiness({
                hasCompletedProfile: Boolean(nextCompletion?.meetsProfileCompleteThreshold),
                profileComplete: Boolean(nextCompletion?.meetsProfileCompleteThreshold),
                profileCompletion: nextCompletion,
            });

            const backgroundSyncTasks = [
                payload.activeProfile
                    ? withRequestTimeout(
                        client.post(`/api/users/profiles/${encodeURIComponent(profileId)}/activate`, {}, {
                            __skipApiErrorHandler: true,
                            __allowWhenCircuitOpen: true,
                            __maxRetries: 1,
                            timeout: PROFILE_ACTIVATION_TIMEOUT_MS,
                        }),
                        'Profile activation timed out',
                        PROFILE_ACTIVATION_TIMEOUT_MS
                    ).catch(() => null)
                    : null,
                Promise.resolve(updateUserInfo?.({
                    hasCompletedProfile: readiness.hasCompletedProfile,
                    profileComplete: readiness.profileComplete,
                    profileCompletion: nextCompletion,
                })),
                Promise.resolve(invalidateJobMatchCache?.()),
                Promise.resolve(fetchProfileData?.()),
                pendingLocalAvatar
                    ? uploadAvatarUri(pendingLocalAvatar)
                        .then((uploadedAvatar) => {
                            const nextAvatar = String(uploadedAvatar || '').trim();
                            if (!nextAvatar) return null;
                            setProfiles((prev) => prev.map((profile) => (
                                profile._id === editingProfile._id
                                    ? { ...profile, avatar: nextAvatar }
                                    : profile
                            )));
                            return fetchProfileData?.();
                        })
                        .catch(() => null)
                    : null,
            ].filter(Boolean);
            void Promise.allSettled(backgroundSyncTasks);
        } catch (error) {
            Alert.alert('Save failed', error?.response?.data?.message || error?.message || 'Unable to save profile right now.');
            return;
        } finally {
            setIsSavingProfile(false);
            setUploadingAvatar(false);
        }

        const studioCompletion = getProfileStudioCompletion({
            role: 'worker',
            completion: nextCompletion,
        });
        if (!studioCompletion.isStudioReady) {
            const missing = studioCompletion.missingCoreSteps.map((stepId) => stepId.replace(/_/g, ' ')).join(', ');
            Alert.alert('Complete profile details', missing ? `Add these details to finish the profile: ${missing}.` : 'Add the remaining profile details.');
            return;
        }

        setEditingProfile(null);
        setIsModalVisible(false);
        setAiAssistLoading(false);
        setFormAssistMessage('');
        setSelectedRoleCategory('');
        setActiveStudioCard('role');
        Alert.alert(
            'Saved',
            studioCompletion.isVerificationPending
                ? 'Profile details are saved. Verify contact later to unlock applications.'
                : 'Profile updated successfully. Check your matching jobs now?',
            [
                { text: 'Later', style: 'cancel' },
                {
                    text: 'View Matches',
                    onPress: () => navigation.navigate('MainTab', {
                        screen: 'Jobs',
                        params: {
                            source: 'profile_saved',
                            highlightMatches: true,
                        },
                    }),
                },
            ]
        );
    };

    const handleSetActiveProfile = useCallback(async (profileId) => {
        if (!profileId) return;
        try {
            await client.post(`/api/users/profiles/${encodeURIComponent(profileId)}/activate`, {}, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
            });
            await invalidateJobMatchCache();
            await fetchProfileData();
        } catch (error) {
            Alert.alert('Action failed', error?.response?.data?.message || 'Unable to set active profile right now.');
        }
    }, [fetchProfileData, invalidateJobMatchCache]);

    const handleDeleteProfile = useCallback((profileEntry, profileIndex = 0) => {
        const candidateIds = Array.from(new Set([
            resolveProfileIdForApi(profileEntry, profileIndex),
            normalizeProfileIdLikeBackend(profileEntry?.profileId || '', ''),
            normalizeProfileIdLikeBackend(profileEntry?._id || '', ''),
        ].filter(Boolean)));
        if (!profileEntry && candidateIds.length === 0) return;

        Alert.alert(
            'Delete Profile',
            'This profile will be removed permanently.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        setSuppressedProfileIds((previous) => Array.from(new Set([
                            ...previous,
                            ...candidateIds,
                        ])));

                        const matchesDeleteTarget = (item, itemIndex = 0) => {
                            if (!item) return false;
                            if (candidateIds.includes(resolveProfileIdForApi(item, itemIndex))) return true;
                            return isSameProfileEntry(profileEntry || {}, item, profileIndex, itemIndex);
                        };

                        const remainingLocalProfiles = profiles.filter((item, itemIndex) => (
                            !matchesDeleteTarget(item, itemIndex)
                        ));
                        const hasMeaningfulProfiles = remainingLocalProfiles.some(hasMeaningfulProfileData);

                        const editingProfileTargetsDeleted = (
                            editingProfile
                            && matchesDeleteTarget(editingProfile, profileIndex)
                        );
                        if (editingProfileTargetsDeleted) {
                            setIsModalVisible(false);
                            setEditingProfile(null);
                            setAiAssistLoading(false);
                            setFormAssistMessage('');
                        }

                        setProfiles(remainingLocalProfiles);
                        setPools([]);
                        setPoolProfiles([]);
                        setSelectedPool(null);
                        setSelectedCandidate(null);
                        if (hasMeaningfulProfiles) {
                            AsyncStorage.setItem(WORKER_PROFILE_CACHE_KEY, JSON.stringify(remainingLocalProfiles)).catch(() => { });
                        } else {
                            AsyncStorage.removeItem(WORKER_PROFILE_CACHE_KEY).catch(() => { });
                        }

                        if (typeof updateUserInfo === 'function') {
                            await updateUserInfo({
                                hasCompletedProfile: hasMeaningfulProfiles,
                                profileComplete: hasMeaningfulProfiles,
                            }).catch(() => { });
                        }

                        try {
                            let mutationResponse = null;
                            let lastDeleteError = null;

                            for (const candidateId of candidateIds) {
                                try {
                                    mutationResponse = await client.delete(`/api/users/profiles/${encodeURIComponent(candidateId)}`, {
                                        __skipApiErrorHandler: true,
                                        __allowWhenCircuitOpen: true,
                                    });
                                    break;
                                } catch (deleteError) {
                                    lastDeleteError = deleteError;
                                    const status = Number(deleteError?.response?.status || 0);
                                    if (![400, 404, 405].includes(status)) {
                                        break;
                                    }
                                }
                            }

                            if (!mutationResponse) {
                                const roleProfilesPayload = buildRoleProfilesPayloadFromUiProfiles(remainingLocalProfiles);
                                try {
                                    mutationResponse = await client.put('/api/users/profile', {
                                        roleProfiles: roleProfilesPayload,
                                    }, {
                                        __skipApiErrorHandler: true,
                                        __allowWhenCircuitOpen: true,
                                    });
                                } catch (replaceError) {
                                    const needsNeutralFallback = roleProfilesPayload.length === 0 && isProfileRoleGateError(replaceError);
                                    if (needsNeutralFallback) {
                                        mutationResponse = await client.put('/api/users/profile', {
                                            roleProfiles: buildNeutralRoleProfilesPayload(),
                                        }, {
                                            __skipApiErrorHandler: true,
                                            __allowWhenCircuitOpen: true,
                                        });
                                    } else if (lastDeleteError) {
                                        throw lastDeleteError;
                                    } else {
                                        throw replaceError;
                                    }
                                }
                            }

                            const completion = mutationResponse?.data?.profileCompletion || null;
                            if (completion) {
                                const isComplete = Boolean(completion?.meetsProfileCompleteThreshold);
                                await updateUserInfo?.({
                                    hasCompletedProfile: isComplete,
                                    profileComplete: isComplete,
                                });
                            } else {
                                await updateUserInfo?.({
                                    hasCompletedProfile: hasMeaningfulProfiles,
                                    profileComplete: hasMeaningfulProfiles,
                                });
                            }

                            await invalidateJobMatchCache({ deepClean: true });
                            await fetchProfileData({ preservePreviousOnIncomplete: false });
                        } catch (error) {
                            logger.warn('Profile delete sync issue:', error?.message || error);
                            await invalidateJobMatchCache({ deepClean: true });
                            await fetchProfileData({ preservePreviousOnIncomplete: false }).catch(() => { });
                            Alert.alert('Delete failed', 'Profile was removed locally. Server sync may take a moment, please refresh once.');
                        }
                    },
                },
            ]
        );
    }, [editingProfile, fetchProfileData, invalidateJobMatchCache, profiles, updateUserInfo]);

    const goBackFromPool = () => setSelectedPool(null);
    const goBackFromCandidate = () => setSelectedCandidate(null);
    const handleOpenSmartInterview = useCallback(() => {
        navigation.navigate('SmartInterview');
    }, [navigation]);
    const handleCreateFirstProfile = useCallback(() => {
        const seed = profiles.find((profile) => Boolean(profile.activeProfile)) || profiles[0] || {};
        const profileId = generateProfileId();
        const hasExistingProfile = profiles.some(hasMeaningfulProfileData);
        setEditingProfile({
            _id: profileId,
            profileId,
            name: sanitizeProfileNamePrefill(seed?.name || user?.name || ''),
            roleTitle: '',
            experienceYears: null,
            expectedSalary: null,
            skills: [],
            location: String(seed?.location || user?.city || '').trim(),
            panchayat: String(seed?.panchayat || '').trim(),
            language: getDefaultApLanguage(String(seed?.language || user?.language || '')),
            maxCommuteDistanceKm: Number.isFinite(Number(seed?.maxCommuteDistanceKm)) ? Number(seed.maxCommuteDistanceKm) : 25,
            minimumMatchTier: ['STRONG', 'GOOD', 'POSSIBLE'].includes(String(seed?.minimumMatchTier || '').toUpperCase())
                ? String(seed.minimumMatchTier).toUpperCase()
                : 'GOOD',
            preferredShift: SHIFT_OPTIONS.includes(String(seed?.preferredShift || '').trim())
                ? String(seed.preferredShift).trim()
                : 'Flexible',
            isAvailable: seed?.isAvailable !== false,
            availabilityWindowDays: [0, 15, 30].includes(Number(seed?.availabilityWindowDays))
                ? Number(seed.availabilityWindowDays)
                : 0,
            openToRelocation: Boolean(seed?.openToRelocation),
            openToNightShift: Boolean(seed?.openToNightShift),
            licenses: Array.isArray(seed?.licenses) ? seed.licenses.filter(Boolean) : [],
            avatar: seed?.avatar || null,
            interviewVerified: false,
            activeProfile: !hasExistingProfile,
            isDefault: !hasExistingProfile,
            createdAt: new Date().toISOString(),
            isNew: true,
        });
        setSkillInput('');
        setLicenseInput('');
        setAiAssistLoading(false);
        setFormAssistMessage('');
        setRoleSuggestedSkills([]);
        setRoleSuggestedLicenses([]);
        setRoleSuggestedSalary(0);
        setIsCustomExperience(false);
        setIsCustomSalary(false);
        setSelectedRoleCategory('');
        setActiveStudioCard('role');
        roleDefaultsAppliedKeyRef.current = '';
        setIsModalVisible(true);
    }, [profiles, user?.city, user?.language, user?.name]);
    const handleOpenQuickProfileForm = useCallback(() => {
        handleCreateFirstProfile();
    }, [handleCreateFirstProfile]);

    const closeEditModal = useCallback(() => {
        setIsModalVisible(false);
        setAiAssistLoading(false);
        setFormAssistMessage('');
        setEditingProfile(null);
        setSkillInput('');
        setLicenseInput('');
        setRoleSuggestedSkills([]);
        setRoleSuggestedLicenses([]);
        setRoleSuggestedSalary(0);
        setIsCustomExperience(false);
        setIsCustomSalary(false);
        setSelectedRoleCategory('');
        setActiveStudioCard('role');
    }, []);
    const handleSwitchToSmartInterview = useCallback(() => {
        Alert.alert(
            'Coming soon',
            'AI Interview will continue from this profile studio soon. For now, save your profile details here first.'
        );
    }, []);

    const submitProfileReport = useCallback(async (targetId, reason) => {
        try {
            await client.post('/api/reports', {
                targetId,
                targetType: 'profile',
                reason,
            });
        } catch (_error) {
            Alert.alert('Report failed', 'Could not submit report right now.');
            return;
        }

        Alert.alert('Report submitted', 'Thanks. Our safety team will review this profile.');
    }, []);

    const handleReportProfile = useCallback((targetId) => {
        if (!targetId) return;
        Alert.alert('Report profile', 'Choose a reason', [
            { text: 'Spam', onPress: () => submitProfileReport(targetId, 'spam') },
            { text: 'Misleading details', onPress: () => submitProfileReport(targetId, 'misleading') },
            { text: 'Unsafe behavior', onPress: () => submitProfileReport(targetId, 'unsafe') },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, [submitProfileReport]);

    // ── EMPLOYER VIEW ──────────────────────────────────────────────────────
    const renderEmployerFlow = () => {
        if (selectedCandidate) {
            return (
                <View style={styles.flex1}>
                    <View style={[styles.headerPurple, { paddingTop: insets.top + 16 }]}>
                        <TouchableOpacity style={styles.backBtnLight} onPress={goBackFromCandidate}>
                            <Text style={styles.backTextLight}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.headerTitleLight}>Job Seeker Profile</Text>
                    </View>
                    <ScrollView style={styles.flex1} contentContainerStyle={{ paddingBottom: 40 }}>
                        <View style={styles.candidateHero}>
                            <Image
                                source={{ uri: `https://ui-avatars.com/api/?name=${selectedCandidate.roleTitle}&background=7c3aed&color=fff&size=128` }}
                                style={styles.candidateHeroImage}
                            />
                            <Text style={styles.candidateHeroTitle}>{selectedCandidate.roleTitle} Expert</Text>
                            <View style={styles.candidateHeroLocationRow}>
                                <IconMapPin size={14} color="#a855f7" />
                                <Text style={styles.candidateHeroLocation}>{selectedCandidate.location}</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.reportProfileBtn}
                                onPress={() => handleReportProfile(selectedCandidate.id)}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.reportProfileBtnText}>Report Profile</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.candyWrapper}>
                            <View style={styles.candyCard}>
                                <View style={styles.candyCardTop}>
                                    <Text style={styles.candyCardTitle}>Professional Summary</Text>
                                    <View style={styles.candyResumeBtn}>
                                        <Text style={styles.candyResumeText}>VIEW RESUME</Text>
                                    </View>
                                </View>
                                <Text style={styles.candySummaryText}>{selectedCandidate.summary}</Text>
                            </View>
                            <View style={styles.candyCard}>
                                <Text style={styles.candyCardTitle}>Experience & Skills</Text>
                                <View style={styles.candidateSkillRow}>
                                    <View style={styles.candidateExpBox}>
                                        <Text style={styles.candidateExpValue}>{selectedCandidate.experienceYears || 0}</Text>
                                        <Text style={styles.candidateExpLabel}>YEARS EXP</Text>
                                    </View>
                                    <View style={styles.candidateSkillsWrap}>
                                        {(selectedCandidate.skills || []).map((skill) => (
                                            <View key={skill} style={styles.candidateSkillChip}>
                                                <Text style={styles.candidateSkillText}>{skill}</Text>
                                            </View>
                                        ))}
                                        {(!selectedCandidate.skills || selectedCandidate.skills.length === 0) ? (
                                            <Text style={styles.candidateNoSkillsText}>No skills listed</Text>
                                        ) : null}
                                    </View>
                                </View>
                            </View>
                        </View>
                    </ScrollView>
                </View>
            );
        }

        if (selectedPool) {
            return (
                <View style={[styles.containerLight]}>
                    <View style={[styles.headerPurple, { paddingTop: insets.top + 16 }]}>
                        <TouchableOpacity style={styles.backBtnLight} onPress={goBackFromPool}>
                            <Text style={styles.backTextLight}>‹</Text>
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.headerTitleLight}>{selectedPool.name}</Text>
                            <Text style={styles.headerSubLight}>{selectedPool.count} JOB SEEKERS FOUND</Text>
                        </View>
                    </View>
                    {isLoading ? (
                        <View style={styles.pad16}>
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                        </View>
                    ) : poolProfiles.length === 0 ? (
                        <EmptyState
                            title="No Job Seekers Yet"
                            message="Job seekers will appear here when matching is available for this job."
                            icon={<IconUsers size={56} color="#94a3b8" />}
                        />
                    ) : (
                        <ScrollView style={styles.flex1} contentContainerStyle={styles.pad16}>
                            {poolProfiles && poolProfiles.map((prof) => (
                                <TouchableOpacity
                                    key={prof.id}
                                    style={styles.poolCandCard}
                                    activeOpacity={0.8}
                                    onPress={() => setSelectedCandidate(prof)}
                                >
                                    <Image source={{ uri: `https://ui-avatars.com/api/?name=${encodeURIComponent(String(prof?.name || prof?.roleTitle || 'Job Seeker'))}&background=7c3aed&color=fff` }} style={styles.poolCandImg} />
                                    <View style={styles.flex1}>
                                        <Text style={styles.poolCandTitle} numberOfLines={1}>{prof?.name || 'Job Seeker'}</Text>
                                        <Text style={styles.poolCandMeta}>{prof?.roleTitle || 'Job Seeker'}</Text>
                                        <Text style={styles.poolCandMeta}>{prof?.experienceYears || 0} Years Exp • {prof?.location || 'Remote'}</Text>
                                    </View>
                                    <TouchableOpacity
                                        style={styles.poolReportBtn}
                                        onPress={() => handleReportProfile(prof.id)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.poolReportBtnText}>Report</Text>
                                    </TouchableOpacity>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    )}
                </View>
            );
        }

        return (
            <View style={[styles.containerLight]}>
                <View style={[styles.headerPurple, { paddingTop: insets.top + 16, paddingBottom: 24, paddingHorizontal: 24 }]}>
                    <Text style={styles.employerTitle}>Talent Pools</Text>
                    <Text style={styles.employerSub}>Organize and track your job seeker pipelines</Text>
                </View>
                {isLoading ? (
                    <View style={styles.pad16}>
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                    </View>
                ) : pools.length === 0 ? (
                    <EmptyState
                        title="No Talent Pools Yet"
                        message="Create your first post to see matching talent."
                        icon={<IconBriefcase size={56} color={GLASS_PALETTE.textSoft} />}
                    />
                ) : (
                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        {pools.map(pool => (
                            <View key={pool.id} style={styles.poolCardBox}>
                                <View style={styles.poolBoxTop}>
                                    <Text style={styles.poolBoxTitle}>{pool.name}</Text>
                                    <View style={styles.poolBoxBadge}>
                                        <Text style={styles.poolBoxBadgeText}>{pool.count} Job Seekers</Text>
                                    </View>
                                </View>
                                <TouchableOpacity
                                    style={styles.poolBoxBtn}
                                    activeOpacity={0.8}
                                    onPress={() => setSelectedPool(pool)}
                                >
                                    <Text style={styles.poolBoxBtnText}>View Job Seekers</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                )}
            </View>
        );
    };

    // ── EMPLOYEE VIEW ──────────────────────────────────────────────────────

    const renderEmployeeView = () => {
        const meaningfulProfiles = profiles.filter(hasMeaningfulProfileData);
        const verifiedProfileCount = meaningfulProfiles.filter((profile) => Boolean(profile?.interviewVerified)).length;
        const activeProfileCount = meaningfulProfiles.filter((profile) => Boolean(profile?.activeProfile)).length;
        const safeUserName = sanitizeProfileNamePrefill(user?.name || '') || 'You';
        const safeFirstName = String(safeUserName).trim().split(/\s+/)[0] || safeUserName;
        const headerAvatarUri = String(
            user?.avatar
            || user?.profilePicture
            || meaningfulProfiles.find((profile) => String(profile?.avatar || '').trim())?.avatar
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(safeUserName)}&background=d1d5db&color=111111&rounded=true`
        );
        const liveProfile = meaningfulProfiles.find((profile) => Boolean(profile?.activeProfile)) || meaningfulProfiles[0] || null;
        const profileStats = [
            { label: 'Profiles', value: String(meaningfulProfiles.length) },
            { label: 'Live', value: String(activeProfileCount) },
            { label: 'Verified', value: String(verifiedProfileCount) },
        ];
        const heroContext = liveProfile
            ? [
                String(liveProfile?.roleTitle || '').trim(),
                [String(liveProfile?.panchayat || '').trim(), String(liveProfile?.location || '').trim()]
                    .filter((item, index, array) => item && array.indexOf(item) === index)
                    .join(', '),
            ].filter(Boolean).join(' • ')
            : 'Create one clean profile and go live';

        return (
            <LinearGradient colors={GLASS_GRADIENTS.screen} style={styles.flex1}>
                <View style={styles.employeeGlowTop} />
                <View style={styles.employeeGlowBottom} />
                <View style={[styles.employeeTopBar, { paddingTop: insets.top + 8 }]}>
                    <View style={styles.employeeTopBarCopy}>
                        <Text style={styles.employeeTopBarEyebrow}>Profile</Text>
                        <Text style={styles.employeeTopBarTitle}>Hi, {safeFirstName}</Text>
                    </View>
                </View>

                {(isLoading && profiles.length === 0) ? (
                    <View style={styles.scrollContent}>
                        <SkeletonLoader height={162} style={{ borderRadius: 28, marginBottom: 16 }} />
                        <SkeletonLoader height={84} style={{ borderRadius: 12, marginBottom: 12 }} />
                        <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                        <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <View style={styles.employeeOverviewCard}>
                            <View style={styles.employeeOverviewTopRow}>
                                <Image source={{ uri: headerAvatarUri }} style={styles.employeeOverviewAvatar} />
                                <View style={styles.employeeOverviewCopy}>
                                    <View style={styles.employeeOverviewPill}>
                                        <IconGlobe size={11} color={GLASS_PALETTE.accentText} />
                                        <Text style={styles.employeeOverviewPillText}>Andhra Pradesh</Text>
                                    </View>
                                    <Text style={styles.employeeOverviewTitle}>{safeUserName}</Text>
                                    <Text style={styles.employeeOverviewSubtitle}>{heroContext}</Text>
                                </View>
                            </View>

                            <View style={styles.employeeOverviewMetrics}>
                                {profileStats.map((stat) => (
                                    <View key={stat.label} style={styles.employeeOverviewMetricPill}>
                                        <Text style={styles.employeeOverviewMetricValue}>{stat.value}</Text>
                                        <Text style={styles.employeeOverviewMetricLabel}>{stat.label}</Text>
                                    </View>
                                ))}
                            </View>

                            <View style={styles.employeeOverviewActions}>
                                <TouchableOpacity style={styles.employeeOverviewPrimaryAction} onPress={meaningfulProfiles.length === 0 ? handleCreateFirstProfile : handleOpenQuickProfileForm} activeOpacity={0.88}>
                                    <LinearGradient colors={GLASS_GRADIENTS.accent} style={styles.employeeOverviewPrimaryActionGradient}>
                                        <IconPlus size={14} color="#ffffff" />
                                        <Text style={styles.employeeOverviewPrimaryActionText}>{meaningfulProfiles.length === 0 ? 'Create profile' : 'New profile'}</Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.employeeOverviewSecondaryAction} onPress={handleOpenSmartInterview} activeOpacity={0.82}>
                                    <IconMic size={14} color={GLASS_PALETTE.accentText} />
                                    <Text style={styles.employeeOverviewSecondaryActionText}>AI fill</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {meaningfulProfiles.length === 0 ? (
                            <View style={styles.profileStarterCardAlt}>
                                <View style={styles.profileStarterIconWrapAlt}>
                                    <IconUsers size={22} color={GLASS_PALETTE.accent} />
                                </View>
                                <View style={styles.profileStarterCopyAlt}>
                                    <Text style={styles.profileStarterTitleAlt}>No profile yet</Text>
                                    <Text style={styles.profileStarterTextAlt}>Create one and start matching.</Text>
                                </View>
                            </View>
                        ) : meaningfulProfiles.map((prof, profileIndex) => {
                            const roleVisual = getRoleCategoryVisual(inferRoleCategory(String(prof.roleTitle || '').trim()));
                            const visibleSkills = Array.isArray(prof?.skills) ? prof.skills.slice(0, 3) : [];
                            const extraSkillCount = Array.isArray(prof?.skills) ? Math.max(0, prof.skills.length - visibleSkills.length) : 0;

                            return (
                                <View key={prof._id} style={[styles.empProfileCard, prof.isDefault && styles.empProfileCardDefault]}>
                                    <View style={styles.empProfTopRow}>
                                        <View style={styles.empProfIdentityWrap}>
                                            <View style={[styles.empProfAvatarWrap, { backgroundColor: roleVisual.tint }]}>
                                                <Text style={styles.empProfAvatarText}>{roleVisual.emoji}</Text>
                                            </View>
                                            <View style={styles.empProfTitleWrap}>
                                                <Text style={styles.empProfTitle}>{prof.roleTitle || 'Profile'}</Text>
                                                <Text style={styles.empProfSubtitle}>
                                                    {[
                                                        String(prof?.language || '').trim(),
                                                        [String(prof?.panchayat || '').trim(), String(prof?.location || '').trim()]
                                                            .filter((item, index, array) => item && array.indexOf(item) === index)
                                                            .join(', '),
                                                    ].filter(Boolean).join(' • ') || 'Add location and language'}
                                                </Text>
                                            </View>
                                        </View>
                                        <View style={styles.empProfBadgeRow}>
                                            {prof.isDefault ? (
                                                <View style={styles.empProfDefaultBadge}>
                                                    <Text style={styles.empProfDefaultText}>Primary</Text>
                                                </View>
                                            ) : null}
                                            {prof.interviewVerified ? (
                                                <View style={styles.empProfVerifiedBadge}>
                                                    <Text style={styles.empProfVerifiedText}>Verified</Text>
                                                </View>
                                            ) : null}
                                        </View>
                                    </View>

                                    <View style={styles.empProfMetaRow}>
                                        <View style={[styles.empProfMetaChip, styles.empProfMetaChipPrimary]}>
                                            <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextPrimary]}>
                                                {Number(prof?.expectedSalary || 0) > 0 ? `${formatCompactCurrency(prof.expectedSalary)}/mo` : 'Pay later'}
                                            </Text>
                                        </View>
                                        <View style={styles.empProfMetaChip}>
                                            <Text style={styles.empProfMetaChipText}>{String(prof?.preferredShift || 'Flexible')}</Text>
                                        </View>
                                        <View style={styles.empProfMetaChip}>
                                            <Text style={styles.empProfMetaChipText}>{`${Number(prof?.maxCommuteDistanceKm || 25)} km travel`}</Text>
                                        </View>
                                        {Number.isFinite(Number(prof?.experienceYears)) ? (
                                            <View style={styles.empProfMetaChip}>
                                                <Text style={styles.empProfMetaChipText}>
                                                    {Number(prof.experienceYears) > 0 ? `${Number(prof.experienceYears)} yrs` : 'Fresher'}
                                                </Text>
                                            </View>
                                        ) : null}
                                        {Boolean(prof?.activeProfile) ? (
                                            <View style={[styles.empProfMetaChip, styles.empProfMetaChipAccent]}>
                                                <Text style={[styles.empProfMetaChipText, styles.empProfMetaChipTextAccent]}>Live</Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <View style={styles.empProfSkillsRow}>
                                        {visibleSkills.map((skill, idx) => (
                                            <View key={idx} style={styles.empProfSkillPill}>
                                                <Text style={styles.empProfSkillText}>{skill}</Text>
                                            </View>
                                        ))}
                                        {extraSkillCount > 0 ? (
                                            <View style={[styles.empProfSkillPill, styles.empProfSkillPillMuted]}>
                                                <Text style={styles.empProfSkillText}>{`+${extraSkillCount}`}</Text>
                                            </View>
                                        ) : null}
                                    </View>

                                    <View style={styles.empProfFooter}>
                                        <View style={styles.empProfLocRow}>
                                            <IconMapPin size={12} color={GLASS_PALETTE.textSoft} />
                                            <Text style={styles.empProfLocText}>
                                                {[
                                                    String(prof?.panchayat || '').trim(),
                                                    String(prof?.location || '').trim(),
                                                ].filter((item, index, array) => item && array.indexOf(item) === index).join(', ') || 'Location pending'}
                                            </Text>
                                        </View>
                                        <View style={styles.empProfActions}>
                                            {!prof.activeProfile ? (
                                                <TouchableOpacity style={styles.empProfSecondaryBtn} onPress={() => handleSetActiveProfile(prof.profileId || prof._id)}>
                                                    <Text style={styles.empProfSecondaryText}>Set live</Text>
                                                </TouchableOpacity>
                                            ) : null}
                                            <TouchableOpacity style={styles.empProfEditBtn} onPress={() => openEdit(prof)}>
                                                <Text style={styles.empProfEditText}>Edit</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity style={styles.empProfDeleteBtn} onPress={() => handleDeleteProfile(prof, profileIndex)}>
                                                <Text style={styles.empProfDeleteText}>Delete</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </View>
                            );
                        })}
                        <View style={{ height: 40 }} />
                    </ScrollView>
                )}
            </LinearGradient>
        );
    };

    return (
        <View style={styles.container}>
            {role === 'employee' ? renderEmployeeView() : renderEmployerFlow()}

            {/* Edit Profile Modal */}
            <Modal visible={isModalVisible} animationType="slide" transparent onRequestClose={closeEditModal}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 18 : 18}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalSheet}>
                        <View style={styles.modalHandle} />
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderCopy}>
                                <Text style={styles.modalEyebrow}>PROFILE STUDIO</Text>
                                <Text style={styles.modalTitle}>Profile studio</Text>
                                <Text style={styles.modalSubtitle}>4 easy cards.</Text>
                                {editingProfile ? (
                                    <View style={styles.modalContextPill}>
                                        <Text style={styles.modalContextPillText}>
                                            {[
                                                String(editingProfile.roleTitle || '').trim(),
                                                String(editingProfile.location || '').trim(),
                                            ].filter(Boolean).join(' • ') || 'New profile'}
                                        </Text>
                                    </View>
                                ) : null}
                            </View>
                            <TouchableOpacity onPress={closeEditModal} style={styles.modalCloseBtn} activeOpacity={0.85}>
                                <IconX size={20} color="#6b7280" />
                            </TouchableOpacity>
                        </View>

                        {editingProfile && (
                            <ScrollView
                                ref={modalScrollRef}
                                showsVerticalScrollIndicator={false}
                                contentContainerStyle={styles.modalScroll}
                                keyboardShouldPersistTaps="always"
                                keyboardDismissMode="on-drag"
                                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                                onScroll={(event) => {
                                    modalScrollOffsetRef.current = Number(event?.nativeEvent?.contentOffset?.y || 0);
                                }}
                                scrollEventThrottle={16}
                            >
                                <View style={styles.fastSetupCard}>
                                    <View style={styles.studioHeaderTopRow}>
                                        <View style={styles.studioHeaderTopCopy}>
                                            <Text style={styles.fastSetupTitle}>Step {STUDIO_CARD_ORDER.indexOf(activeStudioCard) + 1} of 4</Text>
                                            <Text style={styles.fastSetupText}>
                                                {activeStudioCard === 'role'
                                                    ? 'Role'
                                                    : activeStudioCard === 'basics'
                                                        ? 'AP basics'
                                                        : activeStudioCard === 'fit'
                                                            ? 'Job fit'
                                                            : 'Skills & proofs'}
                                            </Text>
                                        </View>
                                        <View
                                            style={[
                                                styles.studioProgressPill,
                                                studioRemainingCount === 0 && styles.studioProgressPillDone,
                                            ]}
                                        >
                                            <Text
                                                style={[
                                                    styles.studioProgressPillText,
                                                    studioRemainingCount === 0 && styles.studioProgressPillTextDone,
                                                ]}
                                            >
                                                {studioRemainingCount === 0 ? 'Ready' : `${studioRemainingCount} left`}
                                            </Text>
                                        </View>
                                    </View>
                                    <Text style={styles.fastSetupStatus}>
                                        {activeStudioCard === 'skills' && studioRemainingCount === 0
                                            ? 'Save when this looks right.'
                                            : 'Finish this card, then continue.'}
                                    </Text>
                                    <View style={styles.studioSegmentRail}>
                                        {profileStudioSections.map((section) => {
                                            const isCurrent = activeStudioCard === section.id;
                                            const isUnlocked = isStudioCardUnlocked(section.id);
                                            const meta = STUDIO_CARD_META[section.id] || {};
                                            const StepIcon = meta.Icon || IconBriefcase;
                                            return (
                                                <TouchableOpacity
                                                    key={section.id}
                                                    disabled={!isUnlocked}
                                                    activeOpacity={isUnlocked ? 0.88 : 1}
                                                    onPress={() => handleGoToStudioCard(section.id)}
                                                    style={[
                                                        styles.studioSegmentTab,
                                                        isCurrent && styles.studioSegmentTabCurrent,
                                                        section.complete && styles.studioSegmentTabDone,
                                                        !isUnlocked && styles.studioSegmentTabLocked,
                                                    ]}
                                                >
                                                    <View
                                                        style={[
                                                            styles.studioSegmentBadge,
                                                            isCurrent && styles.studioSegmentBadgeCurrent,
                                                            section.complete && styles.studioSegmentBadgeDone,
                                                        ]}
                                                    >
                                                        {section.complete ? (
                                                            <IconCheck size={12} color={isCurrent ? '#ffffff' : '#059669'} />
                                                        ) : (
                                                            <StepIcon
                                                                size={12}
                                                                color={
                                                                    isCurrent
                                                                        ? '#ffffff'
                                                                        : isUnlocked
                                                                            ? GLASS_PALETTE.accentText
                                                                            : GLASS_PALETTE.textSoft
                                                                }
                                                            />
                                                        )}
                                                    </View>
                                                    <Text
                                                        style={[
                                                            styles.studioSegmentTabText,
                                                            isCurrent && styles.studioSegmentTabTextCurrent,
                                                            section.complete && styles.studioSegmentTabTextDone,
                                                            !isUnlocked && styles.studioSegmentTabTextLocked,
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {meta.label || section.label}
                                                    </Text>
                                                    <View
                                                        style={[
                                                            styles.studioSegmentTabDot,
                                                            isCurrent && styles.studioSegmentTabDotCurrent,
                                                            section.complete && styles.studioSegmentTabDotDone,
                                                        ]}
                                                    />
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>

                                {activeStudioCard === 'role' ? (
                                    <View style={styles.formSectionCard}>
                                        <View style={styles.formSectionHero}>
                                            <View style={styles.formSectionHeroIcon}>
                                                <IconBriefcase size={18} color={GLASS_PALETTE.accentText} />
                                            </View>
                                            <View style={styles.formSectionHeroCopy}>
                                                <Text style={styles.formSectionTitle}>1. Role</Text>
                                                <Text style={styles.formSectionSub}>Pick family and role.</Text>
                                            </View>
                                        </View>
                                        <View style={styles.formAssistActionsCompact}>
                                            <TouchableOpacity
                                                style={styles.formAssistPrimaryBtnCompact}
                                                activeOpacity={0.85}
                                                onPress={handleAiProfileAssist}
                                                disabled={aiAssistLoading}
                                            >
                                                <Text style={styles.formAssistPrimaryBtnTextCompact}>
                                                    {aiAssistLoading ? 'Filling…' : 'AI Fill'}
                                                </Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.formAssistSecondaryBtnCompact}
                                                activeOpacity={0.85}
                                                onPress={handleSwitchToSmartInterview}
                                            >
                                                <IconMic size={14} color={GLASS_PALETTE.accentText} />
                                                <Text style={styles.formAssistSecondaryBtnTextCompact}>Talk</Text>
                                            </TouchableOpacity>
                                        </View>
                                        {String(formAssistMessage || '').trim() ? (
                                            <Text style={styles.formAssistMessage}>{formAssistMessage}</Text>
                                        ) : null}

                                        <View style={styles.inputGroup}>
                                            <Text style={styles.inputLabel}>WORK FAMILY</Text>
                                            <View style={styles.roleFamilyGridCompact}>
                                                {ROLE_CATEGORY_OPTIONS.map((item) => {
                                                    const isActive = String(effectiveRoleCategory || '').trim() === item.label;
                                                    const visual = getRoleCategoryVisual(item.label);
                                                    return (
                                                        <TouchableOpacity
                                                            key={item.label}
                                                            style={[styles.roleFamilyCardCompact, isActive && styles.roleFamilyCardCompactActive]}
                                                            onPress={() => handleSelectRoleCategory(item.label)}
                                                            activeOpacity={0.85}
                                                        >
                                                            <View
                                                                style={[
                                                                    styles.roleFamilyGlyphBubble,
                                                                    { backgroundColor: visual.tint },
                                                                    isActive && styles.roleFamilyGlyphBubbleActive,
                                                                ]}
                                                            >
                                                                <Text style={styles.roleFamilyGlyph}>{visual.emoji}</Text>
                                                            </View>
                                                            <Text style={[styles.roleFamilyTitleCompact, isActive && styles.roleFamilyTitleCompactActive]} numberOfLines={2}>
                                                                {item.label}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                        </View>

                                        <View ref={roleInputAnchorRef} style={styles.inputGroup}>
                                            <Text style={styles.inputLabel}>ROLE</Text>
                                            <TypeaheadInput
                                                value={String(editingProfile.roleTitle || '')}
                                                onChangeText={(value) => {
                                                    patchEditingProfile({ roleTitle: value });
                                                    const inferredCategory = inferRoleCategory(value);
                                                    if (inferredCategory) {
                                                        setSelectedRoleCategory(inferredCategory);
                                                    } else if (!String(value || '').trim()) {
                                                        setSelectedRoleCategory('');
                                                    }
                                                }}
                                                placeholder="Type your role"
                                                suggestions={roleTitleTypeaheadOptions}
                                                formatSuggestion={(item) => item}
                                                onSelectSuggestion={(value) => handleSelectRoleTitle(value)}
                                                pickerMode
                                                pickerTitle="Choose your role"
                                            />
                                            <Text style={styles.inputHelperText}>
                                                {effectiveRoleCategory
                                                    ? 'Only roles from your selected work family appear here.'
                                                    : 'Pick a work family first, then type your role.'}
                                            </Text>
                                        </View>

                                        <View style={styles.inputGroup}>
                                            <Text style={styles.inputLabel}>SUGGESTED ROLES</Text>
                                            {roleSpotlightOptions.length > 0 ? (
                                                <SelectionRail
                                                    options={roleSpotlightOptions}
                                                    selectedValue={editingProfile.roleTitle}
                                                    onSelect={(value) => handleSelectRoleTitle(value, { category: effectiveRoleCategory })}
                                                    getTitle={(item) => item}
                                                    getHint={() => 'Tap to choose'}
                                                    getEmoji={() => getRoleCategoryVisual(effectiveRoleCategory || inferredRoleCategory).emoji}
                                                    compact
                                                />
                                            ) : (
                                                <Text style={styles.inputHelperText}>Pick a family or search.</Text>
                                            )}
                                        </View>

                                        {String(editingProfile.roleTitle || '').trim() ? (
                                            <View style={styles.selectionSummaryCard}>
                                                <Text style={styles.selectionSummaryText}>
                                                    {getRoleCategoryVisual(effectiveRoleCategory || inferredRoleCategory).emoji} {String(editingProfile.roleTitle || '').trim()}
                                                </Text>
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}

                                {activeStudioCard === 'basics' ? (
                                    <View style={styles.formSectionCard}>
                                        <View style={styles.formSectionHero}>
                                            <View style={styles.formSectionHeroIcon}>
                                                <IconMapPin size={18} color={GLASS_PALETTE.accentText} />
                                            </View>
                                            <View style={styles.formSectionHeroCopy}>
                                                <Text style={styles.formSectionTitle}>2. AP basics</Text>
                                                <Text style={styles.formSectionSub}>Place, language, experience, pay.</Text>
                                            </View>
                                        </View>

                                        <View style={styles.studioSummaryRow}>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Place</Text>
                                                <Text style={styles.studioSummaryValue} numberOfLines={1}>
                                                    {String(editingProfile.location || '').trim() || 'Choose'}
                                                </Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Language</Text>
                                                <Text style={styles.studioSummaryValue} numberOfLines={1}>
                                                    {String(editingProfile.language || '').trim() || 'Choose'}
                                                </Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Pay</Text>
                                                <Text style={styles.studioSummaryValue} numberOfLines={1}>
                                                    {Number(editingProfile.expectedSalary || 0) > 0
                                                        ? formatCompactCurrency(editingProfile.expectedSalary)
                                                        : 'Set'}
                                                </Text>
                                            </View>
                                        </View>

                                        <View ref={locationInputAnchorRef} style={styles.guidedFieldCard}>
                                            <View style={styles.guidedFieldHeader}>
                                                <View style={styles.guidedFieldIndex}>
                                                    <Text style={styles.guidedFieldIndexText}>1</Text>
                                                </View>
                                                <View style={styles.guidedFieldCopy}>
                                                    <Text style={styles.inputLabel}>District / mandal</Text>
                                                    <Text style={styles.guidedFieldHint}>Tap one or search.</Text>
                                                </View>
                                            </View>
                                            <View style={styles.quickChipsRow}>
                                                {guidedLocationOptions.map((item) => (
                                                    <TouchableOpacity
                                                        key={`ap-city-${item}`}
                                                        style={[
                                                            styles.choiceChip,
                                                            styles.choiceChipRoomy,
                                                            normalizeToken(editingProfile.location) === normalizeToken(item) ? styles.choiceChipActive : null,
                                                        ]}
                                                        onPress={() => patchEditingProfile({ location: item })}
                                                        activeOpacity={0.85}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.choiceChipText,
                                                                normalizeToken(editingProfile.location) === normalizeToken(item) ? styles.choiceChipTextActive : null,
                                                            ]}
                                                        >
                                                            {item}
                                                        </Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                            <TypeaheadInput
                                                value={String(editingProfile.location || '')}
                                                onChangeText={(value) => patchEditingProfile({ location: value })}
                                                placeholder="Search district or mandal"
                                                suggestions={buildTypeaheadSuggestions(editingProfile.location, cityTypeaheadOptions, 8)}
                                                onSelectSuggestion={(value) => patchEditingProfile({ location: value })}
                                                pickerMode
                                                pickerTitle="Choose your district or mandal"
                                            />
                                        </View>

                                        <View ref={localityInputAnchorRef} style={styles.guidedFieldCard}>
                                            <View style={styles.guidedFieldHeader}>
                                                <View style={styles.guidedFieldIndex}>
                                                    <Text style={styles.guidedFieldIndexText}>2</Text>
                                                </View>
                                                <View style={styles.guidedFieldCopy}>
                                                    <Text style={styles.inputLabel}>Local area</Text>
                                                    <Text style={styles.guidedFieldHint}>Village, area, or panchayat.</Text>
                                                </View>
                                            </View>
                                            {hasChosenLocation ? (
                                                <>
                                                    {guidedLocalityOptions.length > 0 ? (
                                                        <View style={styles.quickChipsRow}>
                                                            {guidedLocalityOptions.map((item) => (
                                                                <TouchableOpacity
                                                                    key={`locality-${item}`}
                                                                    style={[
                                                                        styles.choiceChip,
                                                                        normalizeToken(editingProfile.panchayat) === normalizeToken(item) ? styles.choiceChipActive : null,
                                                                    ]}
                                                                    onPress={() => patchEditingProfile({ panchayat: item })}
                                                                    activeOpacity={0.85}
                                                                >
                                                                    <Text
                                                                        style={[
                                                                            styles.choiceChipText,
                                                                            normalizeToken(editingProfile.panchayat) === normalizeToken(item) ? styles.choiceChipTextActive : null,
                                                                        ]}
                                                                    >
                                                                        {item}
                                                                    </Text>
                                                                </TouchableOpacity>
                                                            ))}
                                                        </View>
                                                    ) : null}
                                                    <TypeaheadInput
                                                        value={String(editingProfile.panchayat || '')}
                                                        onChangeText={(value) => patchEditingProfile({ panchayat: value })}
                                                        placeholder="Village / area / panchayat"
                                                        suggestions={buildTypeaheadSuggestions(editingProfile.panchayat, localityTypeaheadOptions, 8)}
                                                        onSelectSuggestion={(value) => patchEditingProfile({ panchayat: value })}
                                                        pickerMode
                                                        pickerTitle="Choose your village or area"
                                                    />
                                                </>
                                            ) : (
                                                <View style={styles.guidedEmptyState}>
                                                    <Text style={styles.guidedEmptyStateText}>Pick district first.</Text>
                                                </View>
                                            )}
                                        </View>

                                        {hasChosenLocation ? (
                                            <View style={styles.studioStack}>
                                                <View style={[styles.studioMiniCard, styles.studioMiniCardWide]}>
                                                    <View style={styles.guidedFieldHeader}>
                                                        <View style={styles.guidedFieldIndex}>
                                                            <Text style={styles.guidedFieldIndexText}>3</Text>
                                                        </View>
                                                        <View style={styles.guidedFieldCopy}>
                                                            <Text style={styles.inputLabel}>Language</Text>
                                                            <Text style={styles.guidedFieldHint}>Pick the one you can work in best.</Text>
                                                        </View>
                                                    </View>
                                                    <SelectionRail
                                                        options={languageDisplayOptions}
                                                        selectedValue={editingProfile.language}
                                                        onSelect={(value) => patchEditingProfile({ language: value })}
                                                        getTitle={(item) => item}
                                                        getHint={(item) => (
                                                            LANGUAGE_CARD_OPTIONS.find((entry) => normalizeToken(entry.label) === normalizeToken(item))?.hint || 'Language'
                                                        )}
                                                        getEmoji={(item) => (
                                                            LANGUAGE_CARD_OPTIONS.find((entry) => normalizeToken(entry.label) === normalizeToken(item))?.emoji || '🗣️'
                                                        )}
                                                    />
                                                    {!languageDisplayOptions.some((item) => normalizeToken(item) === normalizeToken(editingProfile.language)) && String(editingProfile.language || '').trim() ? (
                                                        <View style={styles.selectionSummaryCard}>
                                                            <Text style={styles.selectionSummaryText}>{String(editingProfile.language || '').trim()}</Text>
                                                        </View>
                                                    ) : null}
                                                </View>

                                                <View style={[styles.studioMiniCard, styles.studioMiniCardWide]}>
                                                    <View style={styles.inputLabelRow}>
                                                        <View style={styles.guidedFieldHeaderInline}>
                                                            <View style={styles.guidedFieldIndex}>
                                                                <Text style={styles.guidedFieldIndexText}>4</Text>
                                                            </View>
                                                            <View style={styles.guidedFieldCopy}>
                                                                <Text style={styles.inputLabel}>Experience</Text>
                                                                <Text style={styles.guidedFieldHint}>Choose your comfort level.</Text>
                                                            </View>
                                                        </View>
                                                        <TouchableOpacity
                                                            style={styles.inlineTextActionBtnCompact}
                                                            activeOpacity={0.85}
                                                            onPress={() => setIsCustomExperience((prev) => !prev)}
                                                        >
                                                            <Text style={styles.inlineTextActionTextCompact}>
                                                                {isCustomExperience ? 'Presets' : 'Custom'}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                    <SelectionRail
                                                        options={EXPERIENCE_CARD_OPTIONS}
                                                        selectedValue={editingProfile.experienceYears}
                                                        onSelect={(value) => {
                                                            setIsCustomExperience(false);
                                                            patchEditingProfile({ experienceYears: value });
                                                        }}
                                                        getValue={(item) => item.value}
                                                        getTitle={(item) => item.label}
                                                        getHint={(item) => item.hint}
                                                        getEmoji={(item) => item.emoji}
                                                    />
                                                    {isCustomExperience ? (
                                                        <TextInput
                                                            style={[styles.inputField, styles.compactInputField]}
                                                            value={editingProfile.experienceYears === null || editingProfile.experienceYears === undefined ? '' : String(editingProfile.experienceYears)}
                                                            keyboardType="number-pad"
                                                            onChangeText={(t) => patchEditingProfile({
                                                                experienceYears: String(t || '').trim() === '' ? null : Math.max(0, (parseInt(t, 10) || 0)),
                                                            })}
                                                            placeholder="Years"
                                                            placeholderTextColor={GLASS_PALETTE.textSoft}
                                                        />
                                                    ) : hasExperienceSelection ? (
                                                        <View style={styles.selectionSummaryCard}>
                                                            <Text style={styles.selectionSummaryText}>
                                                                {Number(editingProfile.experienceYears || 0) === 0 ? 'Fresher' : `${Number(editingProfile.experienceYears || 0)} years`}
                                                            </Text>
                                                        </View>
                                                    ) : null}
                                                </View>
                                            </View>
                                        ) : null}

                                        {hasChosenLocation && (hasChosenLanguage || hasExperienceSelection) ? (
                                            <View style={[styles.studioMiniCard, styles.studioMiniCardWide]}>
                                                <View style={styles.inputLabelRow}>
                                                    <View style={styles.guidedFieldHeaderInline}>
                                                        <View style={styles.guidedFieldIndex}>
                                                            <Text style={styles.guidedFieldIndexText}>5</Text>
                                                        </View>
                                                        <View style={styles.guidedFieldCopy}>
                                                            <Text style={styles.inputLabel}>Expected pay</Text>
                                                            <Text style={styles.guidedFieldHint}>Choose a monthly range.</Text>
                                                        </View>
                                                    </View>
                                                    <TouchableOpacity
                                                        style={styles.inlineTextActionBtnCompact}
                                                        activeOpacity={0.85}
                                                        onPress={() => setIsCustomSalary((prev) => !prev)}
                                                    >
                                                        <Text style={styles.inlineTextActionTextCompact}>
                                                            {isCustomSalary ? 'Presets' : 'Custom'}
                                                        </Text>
                                                    </TouchableOpacity>
                                                </View>
                                                {effectiveSuggestedSalary > 0 ? (
                                                    <TouchableOpacity
                                                        style={styles.salarySuggestionCard}
                                                        onPress={() => {
                                                            setIsCustomSalary(false);
                                                            patchEditingProfile({ expectedSalary: effectiveSuggestedSalary });
                                                        }}
                                                        activeOpacity={0.88}
                                                    >
                                                        <View style={styles.salarySuggestionCopy}>
                                                            <Text style={styles.salarySuggestionLabel}>Suggested for this role</Text>
                                                            <Text style={styles.salarySuggestionValue}>{formatCompactCurrency(effectiveSuggestedSalary)}</Text>
                                                        </View>
                                                        <View style={styles.salarySuggestionButton}>
                                                            <Text style={styles.salarySuggestionButtonText}>Use</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                ) : null}
                                                <View style={styles.quickChipsRow}>
                                                    {compactSalaryOptions.map((value) => (
                                                        <TouchableOpacity
                                                            key={`salary-${value}`}
                                                            style={[
                                                                styles.choiceChip,
                                                                styles.choiceChipRoomy,
                                                                Number(editingProfile.expectedSalary) === value ? styles.choiceChipActive : null,
                                                            ]}
                                                            onPress={() => {
                                                                setIsCustomSalary(false);
                                                                patchEditingProfile({ expectedSalary: value });
                                                            }}
                                                            activeOpacity={0.85}
                                                        >
                                                            <Text
                                                                style={[
                                                                    styles.choiceChipText,
                                                                    Number(editingProfile.expectedSalary) === value ? styles.choiceChipTextActive : null,
                                                                ]}
                                                            >
                                                                {formatCompactCurrency(value)}
                                                            </Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                                {isCustomSalary ? (
                                                    <TextInput
                                                        style={[styles.inputField, styles.compactInputField]}
                                                        value={editingProfile.expectedSalary === null || editingProfile.expectedSalary === undefined ? '' : String(editingProfile.expectedSalary)}
                                                        keyboardType="number-pad"
                                                        onChangeText={(t) => patchEditingProfile({
                                                            expectedSalary: String(t || '').trim() === '' ? null : Math.max(0, (parseInt(t, 10) || 0)),
                                                        })}
                                                        placeholder="Monthly pay"
                                                        placeholderTextColor={GLASS_PALETTE.textSoft}
                                                    />
                                                ) : (
                                                    <View style={styles.selectionSummaryCard}>
                                                        <Text style={styles.selectionSummaryText}>
                                                            {Number(editingProfile.expectedSalary || 0) > 0
                                                                ? `${formatCompactCurrency(editingProfile.expectedSalary)} / month`
                                                                : 'Choose pay'}
                                                        </Text>
                                                    </View>
                                                )}
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}

                                {activeStudioCard === 'fit' ? (
                                    <View style={styles.formSectionCard}>
                                        <View style={styles.formSectionHero}>
                                            <View style={styles.formSectionHeroIcon}>
                                                <IconGlobe size={18} color={GLASS_PALETTE.accentText} />
                                            </View>
                                            <View style={styles.formSectionHeroCopy}>
                                                <Text style={styles.formSectionTitle}>3. Job fit</Text>
                                                <Text style={styles.formSectionSub}>Travel, shift, joining, match.</Text>
                                            </View>
                                        </View>

                                        <View style={styles.studioSummaryRow}>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Travel</Text>
                                                <Text style={styles.studioSummaryValue}>{`${Number(editingProfile.maxCommuteDistanceKm || 25)} km`}</Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Shift</Text>
                                                <Text style={styles.studioSummaryValue}>{String(editingProfile.preferredShift || 'Flexible')}</Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Join</Text>
                                                <Text style={styles.studioSummaryValue}>
                                                    {AVAILABILITY_OPTIONS.find((option) => option.value === Number(editingProfile.availabilityWindowDays || 0))?.label || 'Now'}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.fitStack}>
                                            <View style={[styles.fitCard, styles.fitCardWide]}>
                                                <View style={styles.fitCardHeader}>
                                                    <Text style={styles.inputLabel}>Travel</Text>
                                                    <Text style={styles.fitCardHint}>How far feels comfortable daily.</Text>
                                                </View>
                                                <SelectionRail
                                                    options={COMMUTE_OPTION_META}
                                                    selectedValue={editingProfile.maxCommuteDistanceKm || 25}
                                                    onSelect={(value) => patchEditingProfile({ maxCommuteDistanceKm: value })}
                                                    getValue={(item) => item.value}
                                                    getTitle={(item) => `${item.value} km`}
                                                    getHint={(item) => item.hint}
                                                    getEmoji={(item) => item.emoji}
                                                />
                                            </View>

                                            <View style={[styles.fitCard, styles.fitCardWide]}>
                                                <View style={styles.fitCardHeader}>
                                                    <Text style={styles.inputLabel}>Match style</Text>
                                                    <Text style={styles.fitCardHint}>How closely jobs should match you.</Text>
                                                </View>
                                                <SelectionRail
                                                    options={MATCH_TIER_OPTIONS}
                                                    selectedValue={String(editingProfile.minimumMatchTier || 'GOOD')}
                                                    onSelect={(value) => patchEditingProfile({ minimumMatchTier: value })}
                                                    getValue={(item) => item.value}
                                                    getTitle={(item) => item.label}
                                                    getHint={(item) => item.hint}
                                                    getEmoji={(item) => item.emoji}
                                                    compact
                                                />
                                            </View>

                                            <View style={[styles.fitCard, styles.fitCardWide]}>
                                                <View style={styles.fitCardHeader}>
                                                    <Text style={styles.inputLabel}>Shift</Text>
                                                    <Text style={styles.fitCardHint}>Pick the timing you prefer.</Text>
                                                </View>
                                                <SelectionRail
                                                    options={SHIFT_OPTION_META}
                                                    selectedValue={editingProfile.preferredShift || 'Flexible'}
                                                    onSelect={(value) => patchEditingProfile({ preferredShift: value })}
                                                    getValue={(item) => item.label}
                                                    getTitle={(item) => item.label}
                                                    getHint={(item) => item.hint}
                                                    getEmoji={(item) => item.emoji}
                                                    compact
                                                />
                                            </View>

                                            <View style={[styles.fitCard, styles.fitCardWide]}>
                                                <View style={styles.fitCardHeader}>
                                                    <Text style={styles.inputLabel}>Joining</Text>
                                                    <Text style={styles.fitCardHint}>Tell us when you can start.</Text>
                                                </View>
                                                <SelectionRail
                                                    options={AVAILABILITY_OPTIONS}
                                                    selectedValue={Number(editingProfile.availabilityWindowDays || 0)}
                                                    onSelect={(value) => patchEditingProfile({ availabilityWindowDays: value })}
                                                    getValue={(item) => item.value}
                                                    getTitle={(item) => item.label}
                                                    getHint={(item) => item.hint}
                                                    getEmoji={(item) => item.emoji}
                                                    compact
                                                />
                                            </View>
                                        </View>

                                        <View style={styles.preferenceGrid}>
                                            <TouchableOpacity
                                                style={[styles.preferenceTile, editingProfile.isAvailable ? styles.preferenceTileActive : null]}
                                                onPress={() => setEditingProfile((prev) => (
                                                    prev ? { ...prev, isAvailable: !prev.isAvailable } : prev
                                                ))}
                                                activeOpacity={0.85}
                                            >
                                                <View style={[styles.preferenceCheck, editingProfile.isAvailable ? styles.preferenceCheckActive : null]}>
                                                    {editingProfile.isAvailable ? <IconCheck size={12} color="#ffffff" /> : null}
                                                </View>
                                                <Text style={styles.preferenceTitle}>Open now</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={[styles.preferenceTile, editingProfile.openToRelocation ? styles.preferenceTileActive : null]}
                                                onPress={() => setEditingProfile((prev) => (
                                                    prev ? { ...prev, openToRelocation: !prev.openToRelocation } : prev
                                                ))}
                                                activeOpacity={0.85}
                                            >
                                                <View style={[styles.preferenceCheck, editingProfile.openToRelocation ? styles.preferenceCheckActive : null]}>
                                                    {editingProfile.openToRelocation ? <IconCheck size={12} color="#ffffff" /> : null}
                                                </View>
                                                <Text style={styles.preferenceTitle}>Relocate</Text>
                                            </TouchableOpacity>

                                            <TouchableOpacity
                                                style={[styles.preferenceTile, editingProfile.openToNightShift ? styles.preferenceTileActive : null]}
                                                onPress={() => setEditingProfile((prev) => (
                                                    prev ? { ...prev, openToNightShift: !prev.openToNightShift } : prev
                                                ))}
                                                activeOpacity={0.85}
                                            >
                                                <View style={[styles.preferenceCheck, editingProfile.openToNightShift ? styles.preferenceCheckActive : null]}>
                                                    {editingProfile.openToNightShift ? <IconCheck size={12} color="#ffffff" /> : null}
                                                </View>
                                                <Text style={styles.preferenceTitle}>Night shift</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ) : null}

                                {activeStudioCard === 'skills' ? (
                                    <View style={styles.formSectionCard}>
                                        <View style={styles.formSectionHero}>
                                            <View style={styles.formSectionHeroIcon}>
                                                <IconAward size={18} color={GLASS_PALETTE.accentText} />
                                            </View>
                                            <View style={styles.formSectionHeroCopy}>
                                                <Text style={styles.formSectionTitle}>4. Skills & proofs</Text>
                                                <Text style={styles.formSectionSub}>Skills, certificates, photo, voice.</Text>
                                            </View>
                                        </View>

                                        <View style={styles.studioSummaryRow}>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Skills</Text>
                                                <Text style={styles.studioSummaryValue}>{Array.isArray(editingProfile.skills) ? editingProfile.skills.length : 0}</Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Certs</Text>
                                                <Text style={styles.studioSummaryValue}>{Array.isArray(editingProfile.licenses) ? editingProfile.licenses.length : 0}</Text>
                                            </View>
                                            <View style={styles.studioSummaryPill}>
                                                <Text style={styles.studioSummaryLabel}>Proof</Text>
                                                <Text style={styles.studioSummaryValue}>{editingProfile.interviewVerified || editingProfile.avatar ? 'Good' : 'Add'}</Text>
                                            </View>
                                        </View>

                                        <View style={styles.editorCard}>
                                            <View style={styles.editorCardHeader}>
                                                <Text style={styles.inputLabel}>Skills</Text>
                                                <View style={styles.editorCountPill}>
                                                    <Text style={styles.editorCountText}>{Array.isArray(editingProfile.skills) ? editingProfile.skills.length : 0}</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.editorHelperText}>
                                                {hasExactRoleSelection
                                                    ? 'Tap the matching ones first, then add your own if needed.'
                                                    : 'Pick your exact role first to unlock the right skill ideas.'}
                                            </Text>
                                            {guidedSkillSuggestions.length > 0 ? (
                                                <Text style={styles.editorSectionLabel}>Recommended for this role</Text>
                                            ) : null}
                                            {guidedSkillSuggestions.length > 0 ? (
                                                <View style={styles.suggestedSkillsRow}>
                                                    {guidedSkillSuggestions.map((skill) => (
                                                        <TouchableOpacity
                                                            key={skill}
                                                            style={styles.suggestedSkillChip}
                                                            onPress={() => {
                                                                setEditingProfile((prev) => {
                                                                    const existing = Array.isArray(prev?.skills) ? prev.skills : [];
                                                                    if (existing.some((item) => normalizeToken(item) === normalizeToken(skill))) return prev;
                                                                    return { ...prev, skills: [...existing, skill] };
                                                                });
                                                            }}
                                                        >
                                                            <Text style={styles.suggestedSkillText}>+ {skill}</Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            ) : (
                                                <Text style={styles.suggestedEmptyText}>No role-based skills yet.</Text>
                                            )}
                                            <Text style={styles.editorSectionLabel}>Added skills</Text>
                                            <View style={styles.skillsRow}>
                                                {(editingProfile.skills || []).map((s, idx) => (
                                                    <TouchableOpacity key={`${s}-${idx}`} style={styles.skillChip} onPress={() => handleRemoveSkill(idx)}>
                                                        <Text style={styles.skillChipText}>{s}</Text>
                                                        <Text style={styles.skillChipX}> ✕</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                            <View style={styles.editorInputRow}>
                                                <TextInput
                                                    value={skillInput}
                                                    onChangeText={setSkillInput}
                                                    placeholder="Type a skill you know"
                                                    onSubmitEditing={handleAddSkill}
                                                    returnKeyType="done"
                                                    placeholderTextColor={GLASS_PALETTE.textSoft}
                                                    style={[styles.inputField, styles.editorTextInput]}
                                                />
                                                <TouchableOpacity style={styles.addSkillBtn} onPress={handleAddSkill}>
                                                    <Text style={styles.addSkillBtnText}>Add</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>

                                        <View style={styles.editorCard}>
                                            <View style={styles.editorCardHeader}>
                                                <Text style={styles.inputLabel}>Certificates</Text>
                                                <View style={styles.editorCountPill}>
                                                    <Text style={styles.editorCountText}>{Array.isArray(editingProfile.licenses) ? editingProfile.licenses.length : 0}</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.editorHelperText}>
                                                {hasExactRoleSelection
                                                    ? 'Add only the certificates or proofs you truly have.'
                                                    : 'Choose an exact role first to see matching certificates.'}
                                            </Text>
                                            {guidedLicenseSuggestions.length > 0 ? (
                                                <Text style={styles.editorSectionLabel}>Recommended proofs</Text>
                                            ) : null}
                                            {guidedLicenseSuggestions.length > 0 ? (
                                                <View style={styles.suggestedSkillsRow}>
                                                    {guidedLicenseSuggestions.map((license) => (
                                                        <TouchableOpacity
                                                            key={license}
                                                            style={styles.suggestedSkillChip}
                                                            onPress={() => {
                                                                setEditingProfile((prev) => {
                                                                    const existing = Array.isArray(prev?.licenses) ? prev.licenses : [];
                                                                    if (existing.some((item) => normalizeToken(item) === normalizeToken(license))) return prev;
                                                                    return { ...prev, licenses: [...existing, license] };
                                                                });
                                                            }}
                                                        >
                                                            <Text style={styles.suggestedSkillText}>+ {license}</Text>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            ) : (
                                                <Text style={styles.suggestedEmptyText}>No role-based certificates yet.</Text>
                                            )}
                                            <Text style={styles.editorSectionLabel}>Added certificates</Text>
                                            <View style={styles.skillsRow}>
                                                {(editingProfile.licenses || []).map((license, idx) => (
                                                    <TouchableOpacity key={`${license}-${idx}`} style={styles.licenseChip} onPress={() => handleRemoveLicense(idx)}>
                                                        <Text style={styles.licenseChipText}>{license}</Text>
                                                        <Text style={styles.skillChipX}> ✕</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                            <View style={styles.editorInputRow}>
                                                <TextInput
                                                    value={licenseInput}
                                                    onChangeText={setLicenseInput}
                                                    placeholder="Type a certificate or proof"
                                                    onSubmitEditing={handleAddLicense}
                                                    returnKeyType="done"
                                                    placeholderTextColor={GLASS_PALETTE.textSoft}
                                                    style={[styles.inputField, styles.editorTextInput]}
                                                />
                                                <TouchableOpacity style={styles.addSkillBtn} onPress={handleAddLicense}>
                                                    <Text style={styles.addSkillBtnText}>Add</Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>

                                        <View style={styles.proofSignalGrid}>
                                            <View style={[styles.proofSignalCard, styles.proofSignalCardPhoto]}>
                                                <View style={styles.proofSignalGlow} />
                                                <View style={styles.proofSignalPhotoBadge}>
                                                    <Text style={styles.proofSignalPhotoBadgeText}>Needed</Text>
                                                </View>
                                                <Text style={styles.proofSignalTitle}>Profile photo</Text>
                                                <Text style={styles.proofSignalValue}>{editingProfile.avatar ? 'Ready to save' : 'Add now'}</Text>
                                                <Text style={styles.proofSignalHint}>Add one clear face photo. We will sync it when you save the profile.</Text>
                                                <TouchableOpacity style={styles.proofSignalButton} onPress={handleAvatarPress} activeOpacity={0.85}>
                                                    <Text style={styles.proofSignalButtonText}>
                                                        {isSavingProfile && uploadingAvatar ? 'Syncing photo...' : editingProfile.avatar ? 'Change photo' : 'Choose photo'}
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                            <View style={[styles.proofSignalCard, styles.proofSignalCardMuted]}>
                                                <Text style={styles.proofSignalTitle}>AI interview</Text>
                                                <Text style={styles.proofSignalValue}>{editingProfile.interviewVerified ? 'Ready' : 'Coming soon'}</Text>
                                                <Text style={styles.proofSignalHint}>
                                                    {editingProfile.interviewVerified
                                                        ? 'Interview proof is already linked to this profile.'
                                                        : 'We are still wiring interview carry-forward from this form.'}
                                                </Text>
                                                <TouchableOpacity
                                                    style={[styles.proofSignalButton, !editingProfile.interviewVerified && styles.proofSignalButtonMuted]}
                                                    onPress={handleSwitchToSmartInterview}
                                                    activeOpacity={0.85}
                                                >
                                                    <Text style={styles.proofSignalButtonText}>
                                                        {editingProfile.interviewVerified ? 'Interview linked' : 'Coming soon'}
                                                    </Text>
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                    </View>
                                ) : null}

                                <View style={styles.modalActionsSingle}>
                                    {activeStudioCard !== 'role' ? (
                                        <TouchableOpacity style={styles.studioBackLink} onPress={handleBackStudioCard} activeOpacity={0.85}>
                                            <Text style={styles.studioBackLinkText}>Back</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <TouchableOpacity style={styles.studioBackLink} onPress={closeEditModal} activeOpacity={0.85}>
                                            <Text style={styles.studioBackLinkText}>Cancel</Text>
                                        </TouchableOpacity>
                                    )}
                                    {activeStudioCard !== 'skills' ? (
                                        <TouchableOpacity
                                            style={[styles.studioStepPrimaryBtn, !canAdvanceStudioCard && styles.studioStepPrimaryBtnDisabled]}
                                            onPress={handleNextStudioCard}
                                            disabled={!canAdvanceStudioCard}
                                            activeOpacity={0.9}
                                        >
                                            <LinearGradient colors={GLASS_GRADIENTS.accent} style={styles.studioStepPrimaryBtnGradient}>
                                                <Text style={styles.studioStepPrimaryBtnText}>Next</Text>
                                            </LinearGradient>
                                        </TouchableOpacity>
                                    ) : (
                                        <TouchableOpacity style={[styles.saveBtn, isSavingProfile && styles.saveBtnDisabled]} onPress={handleSave} disabled={isSavingProfile}>
                                            <LinearGradient colors={GLASS_GRADIENTS.accent} style={[styles.saveBtnGradient, isSavingProfile && styles.saveBtnGradientDisabled]}>
                                                <Text style={styles.saveBtnText}>{isSavingProfile ? 'Saving...' : 'Save Profile'}</Text>
                                            </LinearGradient>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </ScrollView>
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: GLASS_PALETTE.bgTop },
    containerLight: { flex: 1, backgroundColor: GLASS_PALETTE.bgTop },
    flex1: { flex: 1 },
    pad16: { padding: 16 },

    // Employer Views
    headerPurple: { backgroundColor: '#9333ea', paddingHorizontal: 16, paddingBottom: 16, flexDirection: 'row', alignItems: 'center' },
    backBtnLight: { padding: 4, marginRight: 12, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
    backTextLight: { color: '#fff', fontSize: 24, lineHeight: 28, fontWeight: '300' },
    headerTitleLight: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
    headerSubLight: { fontSize: 10, color: '#e9d5ff', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4, fontWeight: '700' },

    employerTitle: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 4 },
    employerSub: { fontSize: 14, color: '#e9d5ff' },

    candidateHero: { alignItems: 'center', paddingTop: 32, paddingBottom: 24, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
    candidateHeroImage: { width: 96, height: 96, borderRadius: 48, marginBottom: 12, borderWidth: 4, borderColor: '#faf5ff' },
    candidateHeroTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
    candidateHeroLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    candidateHeroLocation: { fontSize: 14, color: '#64748b', fontWeight: '500' },
    reportProfileBtn: {
        marginTop: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    reportProfileBtnText: { fontSize: 11, fontWeight: '700', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 },

    candyWrapper: { padding: 16 },
    candyCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
    candyCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    candyCardTitle: { fontWeight: 'bold', color: '#0f172a', fontSize: 16 },
    candyResumeBtn: { backgroundColor: '#faf5ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#f3e8ff' },
    candyResumeText: { fontSize: 10, fontWeight: '900', color: '#7c3aed', letterSpacing: 0.5 },
    candySummaryText: { fontSize: 14, color: '#475569', lineHeight: 22 },
    candidateSkillRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 12 },
    candidateExpBox: { width: 88, backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 12, alignItems: 'center', paddingVertical: 10, marginRight: 10 },
    candidateExpValue: { fontSize: 26, lineHeight: 28, fontWeight: '900', color: '#7c3aed' },
    candidateExpLabel: { fontSize: 9, fontWeight: '900', color: '#7c3aed', letterSpacing: 1 },
    candidateSkillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
    candidateSkillChip: { backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 8, paddingVertical: 5 },
    candidateSkillText: { fontSize: 10, fontWeight: '900', color: '#475569', textTransform: 'uppercase' },
    candidateNoSkillsText: { fontSize: 12, color: '#94a3b8', fontWeight: '600' },

    poolCandCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    poolCandImg: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#f1f5f9', marginRight: 16 },
    poolCandTitle: { fontWeight: 'bold', color: '#0f172a', fontSize: 16, marginBottom: 4 },
    poolCandMeta: { fontSize: 12, color: '#64748b', fontWeight: '500' },
    poolReportBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        marginLeft: 10,
    },
    poolReportBtnText: { fontSize: 11, fontWeight: '700', color: '#475569' },

    scrollContent: { padding: 16, paddingBottom: 28 },
    poolCardBox: { backgroundColor: '#fff', padding: 20, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 16 },
    poolBoxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    poolBoxTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', flex: 1 },
    poolBoxBadge: { backgroundColor: '#f3e8ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff' },
    poolBoxBadgeText: { fontSize: 11, fontWeight: 'bold', color: '#6b21a8' },
    poolBoxBtn: { width: '100%', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e9d5ff', alignItems: 'center', backgroundColor: '#fff' },
    poolBoxBtnText: { fontSize: 14, fontWeight: 'bold', color: '#9333ea' },

    // Profile Completion Card
    completionCard: { ...GLASS_SURFACES.panel, ...GLASS_SHADOWS.soft, borderRadius: 18, padding: 16, marginBottom: 16 },
    completionTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    completionTitle: { fontSize: 14, fontWeight: '900', color: GLASS_PALETTE.textStrong },
    completionPct: { fontSize: 18, fontWeight: '900' },
    progressTrack: { height: 6, backgroundColor: 'rgba(230, 236, 255, 0.92)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
    progressFill: { height: '100%', borderRadius: 3 },
    completionHint: { fontSize: 12, color: GLASS_PALETTE.textMuted, fontWeight: '500' },
    completionHintBold: { fontWeight: '900', color: GLASS_PALETTE.accentText },
    nudgeCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 14,
        borderColor: '#fde68a',
        backgroundColor: '#fffbeb',
        padding: 14,
        marginBottom: 12,
    },
    nudgeCardAction: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 14,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        padding: 14,
        marginBottom: 12,
    },
    nudgeTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        marginBottom: 4,
    },
    nudgeText: {
        fontSize: 12,
        color: GLASS_PALETTE.textMuted,
        lineHeight: 18,
    },
    responseLiftCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
    },
    responseLiftTitle: {
        fontSize: 13,
        fontWeight: '900',
        color: GLASS_PALETTE.accentText,
        marginBottom: 4,
    },
    responseLiftText: {
        fontSize: 12,
        color: GLASS_PALETTE.text,
        lineHeight: 18,
        fontWeight: '500',
    },

    // Employee Views
    employeeGlowTop: {
        position: 'absolute',
        top: -96,
        right: -72,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(139, 108, 255, 0.16)',
    },
    employeeGlowBottom: {
        position: 'absolute',
        left: -54,
        bottom: -72,
        width: 180,
        height: 180,
        borderRadius: 90,
        backgroundColor: 'rgba(96, 165, 250, 0.14)',
    },
    employeeTopBar: {
        paddingHorizontal: 18,
        paddingBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    employeeTopBarCopy: {
        flex: 1,
        minWidth: 0,
    },
    employeeTopBarEyebrow: {
        fontSize: 11,
        fontWeight: '800',
        color: GLASS_PALETTE.textSoft,
        letterSpacing: 0.9,
        textTransform: 'uppercase',
    },
    employeeTopBarTitle: {
        marginTop: 2,
        fontSize: 21,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        letterSpacing: -0.5,
    },
    employeeTopBarAction: {
        ...GLASS_SHADOWS.soft,
        borderRadius: 20,
        overflow: 'hidden',
    },
    employeeTopBarActionGradient: {
        width: 46,
        height: 46,
        alignItems: 'center',
        justifyContent: 'center',
    },
    employeeOverviewCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        borderRadius: 26,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.52)',
    },
    employeeOverviewTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    employeeOverviewAvatar: {
        width: 54,
        height: 54,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.94)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.72)',
    },
    employeeOverviewCopy: {
        flex: 1,
        minWidth: 0,
    },
    employeeOverviewPill: {
        ...GLASS_SURFACES.softPanel,
        ...SCREEN_CHROME.signalChipAccent,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        marginBottom: 8,
    },
    employeeOverviewPillText: {
        fontSize: 10,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
        letterSpacing: 0.3,
    },
    employeeOverviewTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        letterSpacing: -0.55,
    },
    employeeOverviewSubtitle: {
        marginTop: 3,
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
    },
    employeeOverviewMetrics: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    employeeOverviewMetricPill: {
        ...GLASS_SURFACES.softPanel,
        ...SCREEN_CHROME.signalChip,
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    employeeOverviewMetricValue: {
        fontSize: 13,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        letterSpacing: -0.3,
    },
    employeeOverviewMetricLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: GLASS_PALETTE.textMuted,
    },
    employeeOverviewActions: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 14,
    },
    employeeOverviewPrimaryAction: {
        flex: 1,
        borderRadius: 16,
        overflow: 'hidden',
        ...GLASS_SHADOWS.accent,
    },
    employeeOverviewPrimaryActionGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    employeeOverviewPrimaryActionText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
    employeeOverviewSecondaryAction: {
        minWidth: 114,
        ...GLASS_SURFACES.softPanel,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
    },
    employeeOverviewSecondaryActionText: {
        fontSize: 13,
        fontWeight: '700',
        color: GLASS_PALETTE.accentText,
    },
    profileStarterCardAlt: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.soft,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 15,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.44)',
    },
    profileStarterIconWrapAlt: {
        width: 44,
        height: 44,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(111, 78, 246, 0.10)',
    },
    profileStarterCopyAlt: {
        flex: 1,
    },
    profileStarterTitleAlt: {
        fontSize: 15,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    profileStarterTextAlt: {
        marginTop: 3,
        fontSize: 12,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
    },

    empProfileCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.card,
        padding: 15,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.52)',
        marginBottom: 14,
    },
    empProfileCardDefault: {
        borderColor: 'rgba(111, 78, 246, 0.26)',
        shadowColor: GLASS_PALETTE.accent,
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 5,
    },
    empProfTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
        gap: 10,
    },
    empProfIdentityWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        minWidth: 0,
        gap: 12,
    },
    empProfAvatarWrap: {
        width: 50,
        height: 50,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.72)',
    },
    empProfAvatarText: {
        fontSize: 24,
    },
    empProfTitleWrap: {
        flex: 1,
        minWidth: 0,
    },
    empProfTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        letterSpacing: -0.3,
    },
    empProfSubtitle: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: '600',
        lineHeight: 17,
        color: GLASS_PALETTE.textMuted,
    },
    empProfBadgeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        gap: 6,
        maxWidth: 118,
    },
    empProfDefaultBadge: {
        ...GLASS_SURFACES.softPanel,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
    },
    empProfDefaultText: {
        fontSize: 10,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },
    empProfVerifiedBadge: {
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(16,185,129,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(16,185,129,0.24)',
    },
    empProfVerifiedText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#047857',
    },
    empProfMetaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 13,
    },
    empProfMetaChip: {
        ...GLASS_SURFACES.softPanel,
        ...SCREEN_CHROME.signalChip,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    empProfMetaChipPrimary: {
        ...SCREEN_CHROME.signalChipAccent,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
    },
    empProfMetaChipAccent: {
        ...SCREEN_CHROME.signalChipAccent,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
    },
    empProfMetaChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: GLASS_PALETTE.textMuted,
    },
    empProfMetaChipTextPrimary: {
        color: GLASS_PALETTE.accentText,
    },
    empProfMetaChipTextAccent: {
        color: GLASS_PALETTE.accentText,
    },
    empProfSkillsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 14,
    },
    empProfSkillPill: {
        ...GLASS_SURFACES.softPanel,
        ...SCREEN_CHROME.signalChip,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    empProfSkillPillMuted: {
        backgroundColor: 'rgba(17,24,39,0.06)',
    },
    empProfSkillText: {
        fontSize: 10.5,
        fontWeight: '700',
        color: GLASS_PALETTE.text,
    },
    empProfFooter: {
        borderTopWidth: 1,
        borderTopColor: 'rgba(122, 136, 180, 0.12)',
        paddingTop: 13,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
    },
    empProfLocRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
    },
    empProfLocText: {
        fontSize: 11.5,
        fontWeight: '600',
        color: GLASS_PALETTE.textSoft,
        flexShrink: 1,
    },
    empProfActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    empProfSecondaryBtn: {
        ...GLASS_SURFACES.softPanel,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
    },
    empProfSecondaryText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },
    empProfEditBtn: {
        ...GLASS_SURFACES.softPanel,
        backgroundColor: GLASS_PALETTE.accentSoft,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
    },
    empProfEditText: {
        fontSize: 11.5,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },
    empProfDeleteBtn: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.18)',
        backgroundColor: 'rgba(254,242,242,0.84)',
    },
    empProfDeleteText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: '#b91c1c',
    },

    // Edit Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(16, 24, 40, 0.40)', justifyContent: 'flex-end' },
    modalSheet: {
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 20,
        paddingTop: 12,
        maxHeight: '92%',
        borderTopWidth: 1,
        borderTopColor: GLASS_PALETTE.surfaceLine,
        ...GLASS_SHADOWS.card,
    },
    modalHandle: {
        alignSelf: 'center',
        width: 52,
        height: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(140, 152, 174, 0.55)',
        marginBottom: 12,
    },
    modalHeader: {
        ...GLASS_SURFACES.softPanel,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 13,
    },
    modalHeaderCopy: { flex: 1, paddingRight: 10 },
    modalEyebrow: {
        fontSize: 10,
        fontWeight: '900',
        color: GLASS_PALETTE.accentText,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    modalTitle: { fontSize: 21, fontWeight: '900', color: GLASS_PALETTE.textStrong },
    modalSubtitle: { marginTop: 2, fontSize: 11.5, color: GLASS_PALETTE.textMuted, fontWeight: '600', lineHeight: 16 },
    modalContextPill: {
        ...GLASS_SURFACES.softPanel,
        alignSelf: 'flex-start',
        marginTop: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
    },
    modalContextPillText: {
        fontSize: 11,
        color: GLASS_PALETTE.accentText,
        fontWeight: '700',
    },
    modalCloseBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        ...GLASS_SURFACES.panel,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalScroll: { paddingBottom: 24 },
    formSectionCard: {
        ...GLASS_SURFACES.panel,
        ...GLASS_SHADOWS.soft,
        borderRadius: 22,
        paddingHorizontal: 15,
        paddingVertical: 15,
        marginBottom: 12,
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
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    formSectionHeroCopy: {
        flex: 1,
    },
    formSectionTitle: {
        fontSize: 15,
        fontWeight: '900',
        color: GLASS_PALETTE.textStrong,
        marginBottom: 2,
    },
    formSectionSub: {
        fontSize: 11.5,
        color: GLASS_PALETTE.textMuted,
        marginBottom: 10,
    },
    fastSetupCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 22,
        paddingHorizontal: 14,
        paddingVertical: 13,
        marginBottom: 10,
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
        color: GLASS_PALETTE.accentText,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    fastSetupText: {
        marginTop: 3,
        fontSize: 15,
        color: GLASS_PALETTE.text,
        fontWeight: '800',
        lineHeight: 18,
    },
    fastSetupStatus: {
        marginTop: 6,
        fontSize: 11,
        color: GLASS_PALETTE.accentText,
        fontWeight: '700',
    },
    studioProgressPill: {
        ...GLASS_SURFACES.panel,
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 7,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 64,
    },
    studioProgressPillDone: {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.22)',
    },
    studioProgressPillText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
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
        ...GLASS_SURFACES.panel,
        flex: 1,
        borderRadius: 18,
        paddingHorizontal: 8,
        paddingVertical: 10,
        alignItems: 'center',
        gap: 6,
    },
    studioSegmentTabCurrent: {
        borderColor: 'rgba(111, 78, 246, 0.32)',
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
    },
    studioSegmentTabDone: {
        borderColor: 'rgba(16, 185, 129, 0.22)',
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
        backgroundColor: 'rgba(111, 78, 246, 0.10)',
    },
    studioSegmentBadgeCurrent: {
        backgroundColor: GLASS_PALETTE.accent,
    },
    studioSegmentBadgeDone: {
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
    },
    studioSegmentTabText: {
        fontSize: 10.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textMuted,
    },
    studioSegmentTabTextCurrent: {
        color: GLASS_PALETTE.accentText,
    },
    studioSegmentTabTextDone: {
        color: '#047857',
    },
    studioSegmentTabTextLocked: {
        color: GLASS_PALETTE.textSoft,
    },
    studioSegmentTabDot: {
        width: 5,
        height: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(148, 163, 184, 0.45)',
    },
    studioSegmentTabDotCurrent: {
        backgroundColor: GLASS_PALETTE.accent,
    },
    studioSegmentTabDotDone: {
        backgroundColor: '#10b981',
    },
    profileStudioStatusRow: {
        flexDirection: 'row',
        gap: 7,
        marginTop: 9,
    },
    profileStudioStatusPill: {
        ...GLASS_SURFACES.softPanel,
        flex: 1,
        borderRadius: 13,
        paddingHorizontal: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    profileStudioStatusPillCurrent: {
        borderColor: 'rgba(111, 78, 246, 0.25)',
        backgroundColor: 'rgba(111, 78, 246, 0.1)',
    },
    profileStudioStatusPillDone: {
        borderColor: 'rgba(16, 185, 129, 0.28)',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
    },
    profileStudioStatusPillText: {
        color: GLASS_PALETTE.textMuted,
        fontSize: 10.5,
        fontWeight: '700',
    },
    profileStudioStatusPillTextCurrent: {
        color: GLASS_PALETTE.accentText,
    },
    profileStudioStatusPillTextDone: {
        color: '#047857',
    },
    formAssistActionsCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    formAssistPrimaryBtnCompact: {
        borderRadius: 999,
        backgroundColor: GLASS_PALETTE.accent,
        paddingHorizontal: 15,
        paddingVertical: 10,
    },
    formAssistPrimaryBtnTextCompact: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
    },
    formAssistSecondaryBtnCompact: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    formAssistSecondaryBtnTextCompact: {
        color: GLASS_PALETTE.accentText,
        fontSize: 12,
        fontWeight: '800',
    },
    roleFamilyGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 4,
    },
    roleFamilyCard: {
        ...GLASS_SURFACES.softPanel,
        width: '48%',
        minHeight: 108,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 12,
        justifyContent: 'space-between',
    },
    roleFamilyCardActive: {
        borderColor: 'rgba(111, 78, 246, 0.26)',
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
    },
    roleFamilyTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    roleFamilyTitleActive: {
        color: GLASS_PALETTE.accentText,
    },
    roleFamilyHint: {
        marginTop: 6,
        fontSize: 11,
        lineHeight: 16,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    roleFamilyHintActive: {
        color: GLASS_PALETTE.text,
    },
    roleFamilyTag: {
        marginTop: 8,
        fontSize: 10,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    roleFamilyTagActive: {
        color: GLASS_PALETTE.accentText,
    },
    roleFamilyGridCompact: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    roleFamilyCardCompact: {
        ...GLASS_SURFACES.softPanel,
        width: '22.8%',
        minHeight: 74,
        borderRadius: 16,
        paddingHorizontal: 6,
        paddingVertical: 8,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
    },
    roleFamilyCardCompactActive: {
        borderColor: 'rgba(111, 78, 246, 0.28)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    roleFamilyGlyphBubble: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roleFamilyGlyphBubbleActive: {
        transform: [{ scale: 1.02 }],
    },
    roleFamilyGlyph: {
        fontSize: 16,
    },
    roleFamilyTitleCompact: {
        fontSize: 9.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        textAlign: 'center',
        lineHeight: 12,
    },
    roleFamilyTitleCompactActive: {
        color: GLASS_PALETTE.accentText,
    },
    roleFamilyOverflowRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
    },
    formAssistActions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    formAssistPrimaryBtn: {
        borderRadius: 10,
        backgroundColor: GLASS_PALETTE.accent,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    formAssistPrimaryBtnText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
    },
    formAssistSecondaryBtn: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    formAssistSecondaryBtnText: {
        color: GLASS_PALETTE.accentText,
        fontSize: 12,
        fontWeight: '800',
    },
    formAssistMessage: {
        fontSize: 11,
        color: GLASS_PALETTE.accentText,
        marginBottom: 10,
        fontWeight: '600',
    },
    formAssistLinkBtn: {
        alignSelf: 'flex-start',
        marginBottom: 10,
    },
    formAssistLinkText: {
        color: GLASS_PALETTE.accentText,
        fontSize: 12,
        fontWeight: '700',
    },

    // Avatar
    avatarSection: {
        alignItems: 'center',
        marginBottom: 20,
        borderRadius: 16,
        ...GLASS_SURFACES.softPanel,
        paddingVertical: 12,
    },
    avatarStage: {
        width: 96,
        height: 96,
        borderRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    avatarHalo: {
        position: 'absolute',
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: GLASS_PALETTE.accentTint,
    },
    avatarPreview: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: 'rgba(255,255,255,0.92)' },
    avatarUploadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 10,
        borderRadius: 40,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    changePhotoBtn: { ...GLASS_SURFACES.softPanel, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
    changePhotoText: { color: GLASS_PALETTE.accentText, fontSize: 13, fontWeight: '800' },

    inputGroup: { marginBottom: 14 },
    studioSummaryRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 12,
    },
    studioSummaryPill: {
        ...GLASS_SURFACES.softPanel,
        flex: 1,
        borderRadius: 16,
        paddingHorizontal: 11,
        paddingVertical: 11,
    },
    studioSummaryLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: GLASS_PALETTE.textSoft,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    studioSummaryValue: {
        marginTop: 3,
        fontSize: 12.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    inputLabel: { fontSize: 10.5, fontWeight: '800', color: GLASS_PALETTE.textSoft, letterSpacing: 0.2, marginBottom: 8 },
    inputField: { ...GLASS_SURFACES.input, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '500', color: GLASS_PALETTE.textStrong },
    inputInline: { flex: 1 },
    rowInputs: { flexDirection: 'row', alignItems: 'flex-start' },
    typeaheadWrap: {
        position: 'relative',
    },
    typeaheadWrapFocused: {
        zIndex: 80,
        elevation: 18,
    },
    typeaheadShell: {
        ...GLASS_SURFACES.input,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingHorizontal: 14,
        minHeight: 48,
    },
    typeaheadShellFocused: {
        borderColor: GLASS_PALETTE.accent,
        backgroundColor: 'rgba(255,255,255,0.86)',
    },
    typeaheadInputSlot: {
        flex: 1,
        position: 'relative',
    },
    typeaheadInput: {
        flex: 1,
        fontSize: 15,
        color: GLASS_PALETTE.textStrong,
        fontWeight: '500',
        paddingVertical: 12,
    },
    typeaheadTapOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    typeaheadChevron: {
        fontSize: 10,
        color: GLASS_PALETTE.textSoft,
    },
    typeaheadChevronButton: {
        marginLeft: 8,
        minWidth: 24,
        minHeight: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    typeaheadList: {
        position: 'absolute',
        left: 0,
        right: 0,
        ...GLASS_SURFACES.panel,
        borderRadius: 10,
        paddingVertical: 4,
        maxHeight: 188,
        ...GLASS_SHADOWS.soft,
        zIndex: 50,
        elevation: 12,
    },
    typeaheadListBelow: {
        top: 56,
    },
    typeaheadListAbove: {
        bottom: 56,
    },
    typeaheadPickerOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    typeaheadPickerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.24)',
    },
    typeaheadPickerSheet: {
        backgroundColor: 'rgba(249, 250, 251, 0.98)',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 20,
        minHeight: Dimensions.get('window').height * 0.58,
        maxHeight: Dimensions.get('window').height * 0.82,
        ...GLASS_SHADOWS.soft,
    },
    typeaheadPickerHandle: {
        alignSelf: 'center',
        width: 44,
        height: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(148, 163, 184, 0.35)',
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
        color: GLASS_PALETTE.textStrong,
    },
    typeaheadPickerHint: {
        fontSize: 11.5,
        lineHeight: 16,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    typeaheadPickerCloseBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.9)',
        borderWidth: 1,
        borderColor: 'rgba(148, 163, 184, 0.18)',
    },
    typeaheadPickerSearchShell: {
        marginBottom: 10,
    },
    typeaheadPickerList: {
        flex: 1,
    },
    typeaheadPickerListContent: {
        paddingBottom: 12,
        gap: 8,
    },
    typeaheadPickerItem: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    typeaheadPickerItemPrimary: {
        borderColor: 'rgba(111, 78, 246, 0.22)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    typeaheadPickerItemPrimaryText: {
        color: GLASS_PALETTE.accentText,
    },
    typeaheadPickerItemPrimaryMeta: {
        color: GLASS_PALETTE.accentText,
    },
    typeaheadPickerEmptyState: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    typeaheadPickerEmptyText: {
        fontSize: 11.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '700',
    },
    typeaheadItem: {
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    typeaheadItemText: {
        fontSize: 13,
        color: GLASS_PALETTE.textStrong,
        fontWeight: '600',
    },
    typeaheadItemMeta: {
        marginTop: 2,
        fontSize: 11,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    inlineMetaRow: {
        marginTop: 8,
    },
    inlineMetaText: {
        fontSize: 11,
        color: GLASS_PALETTE.accentText,
        fontWeight: '600',
    },
    inputHelperText: {
        marginTop: 5,
        fontSize: 10.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '500',
    },
    inputLabelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    inlineTextActionBtn: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    inlineTextActionText: {
        fontSize: 10,
        color: GLASS_PALETTE.accentText,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    inlineTextActionBtnCompact: {
        ...GLASS_SURFACES.softPanel,
        alignSelf: 'flex-start',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    inlineTextActionBtnCompactSpaced: {
        marginTop: 10,
    },
    inlineTextActionTextCompact: {
        fontSize: 10,
        color: GLASS_PALETTE.accentText,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    roleSpotlightGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    roleSpotlightCard: {
        ...GLASS_SURFACES.softPanel,
        width: '48%',
        minHeight: 68,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    roleSpotlightCardActive: {
        borderColor: 'rgba(111, 78, 246, 0.28)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    roleSpotlightGlyph: {
        fontSize: 18,
    },
    roleSpotlightText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
        lineHeight: 16,
    },
    roleSpotlightTextActive: {
        color: GLASS_PALETTE.accentText,
    },
    selectionSummaryCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 15,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    selectionSummaryText: {
        fontSize: 11.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    guidedFieldCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
        gap: 8,
    },
    guidedFieldHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    guidedFieldHeaderInline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    guidedFieldIndex: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    guidedFieldIndexText: {
        fontSize: 11,
        fontWeight: '900',
        color: GLASS_PALETTE.accentText,
    },
    guidedFieldCopy: {
        flex: 1,
    },
    guidedFieldHint: {
        marginTop: -2,
        fontSize: 10.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    guidedEmptyState: {
        ...GLASS_SURFACES.input,
        borderRadius: 14,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    guidedEmptyStateText: {
        fontSize: 11,
        fontWeight: '700',
        color: GLASS_PALETTE.textMuted,
    },
    optionTileGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    optionTile: {
        ...GLASS_SURFACES.softPanel,
        width: '48.3%',
        minHeight: 64,
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 11,
        justifyContent: 'center',
    },
    optionTileCompact: {
        minHeight: 58,
    },
    optionTileActive: {
        borderColor: 'rgba(111, 78, 246, 0.28)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    optionTileTitle: {
        fontSize: 12.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    optionTileTitleActive: {
        color: GLASS_PALETTE.accentText,
    },
    optionTileHint: {
        marginTop: 3,
        fontSize: 10.5,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
        lineHeight: 14,
    },
    optionTileHintActive: {
        color: GLASS_PALETTE.text,
    },
    selectionRailContent: {
        paddingRight: 6,
        gap: 10,
    },
    selectionRailCard: {
        ...GLASS_SURFACES.softPanel,
        minWidth: 122,
        maxWidth: 138,
        minHeight: 86,
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 12,
        justifyContent: 'space-between',
    },
    selectionRailCardCompact: {
        minWidth: 116,
        maxWidth: 130,
        minHeight: 82,
    },
    selectionRailCardActive: {
        borderColor: 'rgba(111, 78, 246, 0.28)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    selectionRailEmojiBubble: {
        alignSelf: 'flex-start',
        minWidth: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(111, 78, 246, 0.08)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 6,
    },
    selectionRailEmojiBubbleActive: {
        backgroundColor: 'rgba(111, 78, 246, 0.16)',
    },
    selectionRailEmoji: {
        fontSize: 14,
        color: GLASS_PALETTE.accentText,
        fontWeight: '800',
    },
    selectionRailTitle: {
        marginTop: 10,
        fontSize: 12.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    selectionRailTitleActive: {
        color: GLASS_PALETTE.accentText,
    },
    selectionRailHint: {
        marginTop: 4,
        fontSize: 10.5,
        lineHeight: 14,
        fontWeight: '600',
        color: GLASS_PALETTE.textMuted,
    },
    selectionRailHintActive: {
        color: GLASS_PALETTE.text,
    },
    studioStack: {
        gap: 10,
    },
    studioMiniGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    studioMiniCard: {
        ...GLASS_SURFACES.softPanel,
        width: '48%',
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 11,
        gap: 7,
        marginBottom: 8,
    },
    studioMiniCardWide: {
        width: '100%',
    },
    fitStack: {
        gap: 10,
        marginBottom: 10,
    },
    fitGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    fitCard: {
        ...GLASS_SURFACES.softPanel,
        width: '48%',
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 11,
        gap: 7,
    },
    fitCardWide: {
        width: '100%',
    },
    fitCardHeader: {
        marginBottom: 4,
    },
    fitCardHint: {
        marginTop: -2,
        fontSize: 10.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    compactInputField: {
        marginTop: 8,
        minHeight: 44,
        paddingVertical: 11,
    },
    salarySuggestionCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 10,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    salarySuggestionCopy: {
        flex: 1,
    },
    salarySuggestionLabel: {
        fontSize: 10,
        color: GLASS_PALETTE.accentText,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    salarySuggestionValue: {
        marginTop: 2,
        fontSize: 15,
        color: GLASS_PALETTE.textStrong,
        fontWeight: '800',
    },
    salarySuggestionButton: {
        borderRadius: 10,
        backgroundColor: GLASS_PALETTE.accent,
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    salarySuggestionButtonDisabled: {
        opacity: 0.45,
    },
    salarySuggestionButtonText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
    },
    readonlyValueShell: {
        ...GLASS_SURFACES.input,
        borderRadius: 12,
        minHeight: 48,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    readonlyValueText: {
        color: GLASS_PALETTE.text,
        fontSize: 13,
        fontWeight: '600',
    },
    optionalToggleBtn: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    optionalToggleBtnText: {
        color: GLASS_PALETTE.accentText,
        fontSize: 12,
        fontWeight: '800',
    },
    quickChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choiceChip: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        minHeight: 34,
        paddingHorizontal: 11,
        paddingVertical: 7,
        justifyContent: 'center',
    },
    choiceChipRoomy: {
        minHeight: 36,
        paddingHorizontal: 12,
    },
    choiceChipActive: {
        borderColor: 'rgba(111, 78, 246, 0.24)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    choiceChipText: {
        fontSize: 10.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '800',
    },
    choiceChipTextActive: {
        color: GLASS_PALETTE.accentText,
    },
    preferenceGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 2,
        justifyContent: 'flex-start',
    },
    preferenceTile: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        ...GLASS_SURFACES.softPanel,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    preferenceTileActive: {
        borderColor: 'rgba(111, 78, 246, 0.18)',
        backgroundColor: GLASS_PALETTE.accentSoft,
    },
    preferenceCheck: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: GLASS_PALETTE.borderStrong,
        marginRight: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.82)',
    },
    preferenceCheckActive: {
        borderColor: GLASS_PALETTE.accent,
        backgroundColor: GLASS_PALETTE.accent,
    },
    preferenceTitle: {
        fontSize: 10.5,
        fontWeight: '700',
        color: GLASS_PALETTE.text,
    },

    // Skills editor
    editorCard: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
    },
    editorCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    editorCountPill: {
        minWidth: 28,
        borderRadius: 999,
        backgroundColor: GLASS_PALETTE.accentSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignItems: 'center',
    },
    editorCountText: {
        fontSize: 11,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },
    editorHelperText: {
        fontSize: 10.5,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
        marginBottom: 8,
    },
    editorSectionLabel: {
        marginTop: 4,
        marginBottom: 8,
        fontSize: 10.5,
        fontWeight: '800',
        color: GLASS_PALETTE.textSoft,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 9 },
    skillChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: GLASS_PALETTE.accentSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(111, 78, 246, 0.12)' },
    skillChipText: { fontSize: 12, fontWeight: '700', color: GLASS_PALETTE.accentText },
    licenseChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(239,246,255,0.86)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#bfdbfe' },
    licenseChipText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
    skillChipX: { fontSize: 10, color: '#a855f7' },
    skillInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    skillTypeahead: { flex: 1 },
    editorInputRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
        marginTop: 4,
    },
    editorTextInput: {
        flex: 1,
        minHeight: 46,
        paddingVertical: 11,
    },
    suggestedSkillsRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestedSkillChip: {
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    suggestedSkillText: { fontSize: 11, color: GLASS_PALETTE.textMuted, fontWeight: '700' },
    suggestedEmptyText: { fontSize: 11, color: GLASS_PALETTE.textMuted, fontWeight: '600' },
    addSkillBtn: { ...GLASS_SHADOWS.accent, backgroundColor: GLASS_PALETTE.accent, width: 48, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    addSkillBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    proofSignalGrid: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 2,
    },
    proofSignalCard: {
        ...GLASS_SURFACES.softPanel,
        flex: 1,
        borderRadius: 18,
        paddingHorizontal: 13,
        paddingVertical: 13,
        overflow: 'hidden',
    },
    proofSignalCardPhoto: {
        borderColor: 'rgba(111, 78, 246, 0.24)',
        backgroundColor: 'rgba(245, 243, 255, 0.96)',
    },
    proofSignalCardMuted: {
        backgroundColor: 'rgba(245, 243, 255, 0.74)',
    },
    proofSignalGlow: {
        position: 'absolute',
        top: -24,
        right: -18,
        width: 96,
        height: 96,
        borderRadius: 48,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
    },
    proofSignalPhotoBadge: {
        alignSelf: 'flex-start',
        marginBottom: 8,
        borderRadius: 999,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    proofSignalPhotoBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    proofSignalTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: GLASS_PALETTE.textStrong,
    },
    proofSignalValue: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },
    proofSignalHint: {
        marginTop: 6,
        fontSize: 11,
        lineHeight: 16,
        color: GLASS_PALETTE.textMuted,
        fontWeight: '600',
    },
    proofSignalButton: {
        alignSelf: 'flex-start',
        marginTop: 9,
        borderRadius: 999,
        backgroundColor: 'rgba(111, 78, 246, 0.12)',
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    proofSignalButtonMuted: {
        backgroundColor: 'rgba(111, 78, 246, 0.18)',
    },
    proofSignalButtonText: {
        fontSize: 11,
        fontWeight: '800',
        color: GLASS_PALETTE.accentText,
    },

    modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    modalActionsSingle: {
        alignItems: 'center',
        marginTop: 10,
        gap: 12,
        paddingTop: 10,
        paddingBottom: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(148, 163, 184, 0.16)',
    },
    studioBackLink: {
        alignSelf: 'center',
        ...GLASS_SURFACES.softPanel,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    studioBackLinkText: {
        color: GLASS_PALETTE.textMuted,
        fontSize: 12,
        fontWeight: '800',
    },
    studioStepPrimaryBtn: {
        ...GLASS_SHADOWS.accent,
        width: '78%',
        borderRadius: 18,
        overflow: 'hidden',
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
        color: '#fff',
        fontSize: 15,
        fontWeight: '800',
    },
    cancelBtn: { ...GLASS_SURFACES.softPanel, flex: 1, paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
    cancelBtnText: { color: GLASS_PALETTE.textMuted, fontSize: 14, fontWeight: '800' },
    saveBtn: { ...GLASS_SHADOWS.accent, width: '78%', borderRadius: 18, alignItems: 'center', overflow: 'hidden' },
    saveBtnDisabled: {
        opacity: 0.72,
    },
    saveBtnGradient: {
        width: '100%',
        paddingVertical: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    saveBtnGradientDisabled: {
        opacity: 0.8,
    },
    saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
