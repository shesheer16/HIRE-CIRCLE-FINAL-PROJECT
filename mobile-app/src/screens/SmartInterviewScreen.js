import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Alert,
    AppState,
    Dimensions,
    Easing,
    Modal,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import InterviewClarificationSheet from '../components/InterviewClarificationSheet';
import { clarificationFieldMap } from '../config';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { triggerHaptic } from '../utils/haptics';
import { logger } from '../utils/logger';
import { trackEvent } from '../services/analytics';
import SkeletonLoader from '../components/SkeletonLoader';

const { width } = Dimensions.get('window');

const noopSpeechEventHook = () => {};

const loadSpeechRecognitionRuntime = () => {
    try {
        // Expo Go may not include this native module; use fallback mode when unavailable.
        const speechRecognition = require('expo-speech-recognition');
        const nativeModule = speechRecognition?.ExpoSpeechRecognitionModule || null;
        if (!nativeModule) {
            return {
                ExpoSpeechRecognitionModule: null,
                useSpeechRecognitionEvent: noopSpeechEventHook,
                isNativeSpeechRecognitionAvailable: false,
            };
        }
        return {
            ExpoSpeechRecognitionModule: nativeModule,
            useSpeechRecognitionEvent: typeof speechRecognition?.useSpeechRecognitionEvent === 'function'
                ? speechRecognition.useSpeechRecognitionEvent
                : noopSpeechEventHook,
            isNativeSpeechRecognitionAvailable: true,
        };
    } catch (_error) {
        return {
            ExpoSpeechRecognitionModule: null,
            useSpeechRecognitionEvent: noopSpeechEventHook,
            isNativeSpeechRecognitionAvailable: false,
        };
    }
};

const {
    ExpoSpeechRecognitionModule,
    useSpeechRecognitionEvent,
    isNativeSpeechRecognitionAvailable,
} = loadSpeechRecognitionRuntime();

const IS_EXPO_GO_RUNTIME = (
    Constants.executionEnvironment === 'storeClient'
    || Constants.appOwnership === 'expo'
);

const PROCESSING_MESSAGES = [
    'Transcribing your interview audio...',
    'Understanding your skills and role...',
    'Building your AI portfolio card...',
    'Optimizing your match quality...',
];

const PROCESSING_TRUST_STEPS = [
    { key: 'transcribe', label: 'Transcribing video to multilingual text' },
    { key: 'extract', label: 'Extracting role, skills, location, salary, and experience' },
    { key: 'portfolio', label: 'Building your AI portfolio card' },
    { key: 'match', label: 'Preparing matchmaking quality signals' },
];

const SMART_INTERVIEW_WALKTHROUGH = [
    {
        key: 'flow',
        title: 'How Smart Interview Works',
        subtitle: 'Record once. The system structures your profile automatically.',
        bullets: [
            'You answer guided questions in under 90 seconds.',
            'Video audio is transcribed and translated into structured English JSON.',
            'Role, skills, salary, location, and experience are extracted for matching.',
        ],
    },
    {
        key: 'controls',
        title: 'Know Your Recording Controls',
        subtitle: 'Every button has one clear action while recording.',
        bullets: [
            'Camera switch: front/back view.',
            'Check mark: finish recording and submit.',
            'Pause: pause prompts while timer continues, Close: discard and restart.',
        ],
    },
    {
        key: 'live',
        title: 'Live Step + Completion',
        subtitle: 'Progress updates while you speak.',
        bullets: [
            'Step updates from 1 to 8 based on capture progress.',
            'Completion percent updates in real time.',
            'Timer runs against the full 01:30 recording window.',
        ],
    },
    {
        key: 'review',
        title: 'Review Before Matchmaking',
        subtitle: 'Confirm profile fields, then start matchmaking.',
        bullets: [
            'Review extracted role, skills, salary, and location.',
            'Use Improve Profile to refine missing fields.',
            'Start Matchmaking publishes your profile/job to the correct tab.',
        ],
    },
];

const MAX_RECORD_DURATION_SECONDS = 90;
const LIVE_TURN_DEBOUNCE_MS = 1200;
const LIVE_MIN_TRANSCRIPT_WORDS = 2;
const POLL_INTERVAL_MS = 5 * 1000;
const PROCESSING_STAGNATION_TIMEOUT_MS = 10 * 1000;
const BOOST_UPSELL_TYPE = 'smart_interview_post_confirm';

const STAGES = {
    INTRO: 'intro',
    RECORDING: 'recording',
    UPLOADING: 'uploading',
    PROCESSING: 'processing',
    REVIEW: 'review',
    COMPLETE: 'complete',
};
const SMART_INTERVIEW_LIVE_ENABLED = false;

const REQUIRED_SLOT_FIELD_SET = new Set([
    'fullName',
    'city',
    'primaryRole',
    'primarySkills',
    'totalExperienceYears',
    'shiftPreference',
    'expectedSalary',
    'availabilityType',
]);
const REVIEW_COMMUTE_DISTANCE_OPTIONS = [5, 10, 25, 40];
const REVIEW_MATCH_TIER_OPTIONS = [
    { label: 'Explore more', value: 'POSSIBLE' },
    { label: 'Balanced', value: 'GOOD' },
    { label: 'Top only', value: 'STRONG' },
];
const REVIEW_AVAILABILITY_OPTIONS = [
    { label: 'Immediate', value: 0 },
    { label: '15 days', value: 15 },
    { label: '30 days', value: 30 },
];
const REVIEW_SHIFT_OPTIONS = ['Flexible', 'Day', 'Night'];

const normalizeWorkerShift = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'day') return 'Day';
    if (normalized === 'night') return 'Night';
    return 'Flexible';
};

const normalizeMatchTier = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    return ['STRONG', 'GOOD', 'POSSIBLE'].includes(normalized) ? normalized : 'GOOD';
};

const normalizeAvailabilityWindowDays = (value) => {
    const numeric = Number(value);
    return [0, 15, 30].includes(numeric) ? numeric : 0;
};

const normalizeCommuteDistance = (value) => {
    const numeric = Number(value);
    return REVIEW_COMMUTE_DISTANCE_OPTIONS.includes(numeric) ? numeric : 25;
};

const normalizeBooleanFlag = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
        if (['false', 'no', 'n', '0'].includes(normalized)) return false;
    }
    return Boolean(value);
};

const normalizeLanguageText = (value, fallback = '') => String(value || fallback || '').trim();

const buildDefaultExtractedData = (role, userInfo) => {
    if (role === 'employer') {
        return {
            jobTitle: '',
            companyName: userInfo?.name || '',
            requiredSkills: [],
            experienceRequired: '',
            salaryRange: '',
            shift: 'flexible',
            location: '',
            description: '',
            confidenceScore: null,
        };
    }

    return {
        name: userInfo?.name || '',
        roleTitle: '',
        skills: [],
        experienceYears: 0,
        expectedSalary: '',
        panchayat: '',
        language: normalizeLanguageText(userInfo?.languageCode),
        maxCommuteDistanceKm: 25,
        minimumMatchTier: 'GOOD',
        preferredShift: 'Flexible',
        availabilityWindowDays: 0,
        isAvailable: true,
        openToRelocation: false,
        openToNightShift: false,
        location: '',
        summary: '',
        confidenceScore: null,
    };
};

export default function SmartInterviewScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const { userInfo, completeOnboarding, updateUserInfo } = useContext(AuthContext);
    const role = getPrimaryRoleFromUser(userInfo);
    const isEmployer = role === 'employer';

    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

    const [stage, setStage] = useState(STAGES.INTRO);
    const [timer, setTimer] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [facing, setFacing] = useState('front');
    const [videoUri, setVideoUri] = useState(null);
    const [processingId, setProcessingId] = useState(null);
    const [createdJobId, setCreatedJobId] = useState(null);
    const [extractedData, setExtractedData] = useState(null);
    const [processingMessageIndex, setProcessingMessageIndex] = useState(0);
    const [showBoostUpsell, setShowBoostUpsell] = useState(false);
    const [upsellJobId, setUpsellJobId] = useState(null);
    const [uiPaused, setUiPaused] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [recordingRequested, setRecordingRequested] = useState(false);
    const [slotState, setSlotState] = useState({});
    const [slotConfidence, setSlotConfidence] = useState({});
    const [ambiguousFields, setAmbiguousFields] = useState([]);
    const [missingSlot, setMissingSlot] = useState(null);
    const [interviewComplete, setInterviewComplete] = useState(false);
    const [clarificationField, setClarificationField] = useState(null);
    const [clarificationVisible, setClarificationVisible] = useState(false);
    const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
    const [clarificationQueuedAt, setClarificationQueuedAt] = useState(null);
    const [clarificationContextText, setClarificationContextText] = useState('');
    const [clarificationHints, setClarificationHints] = useState({});
    const [showThinkingIndicator, setShowThinkingIndicator] = useState(false);
    const [processingFallbackMessage, setProcessingFallbackMessage] = useState(null);
    const [extractionWarning, setExtractionWarning] = useState(null);
    const [adaptiveQuestion, setAdaptiveQuestion] = useState(null);
    const [liveProcessingId, setLiveProcessingId] = useState(null);
    const [liveSttReady, setLiveSttReady] = useState(false);
    const [liveTranscriptPreview, setLiveTranscriptPreview] = useState('');
    const [liveProgressMode, setLiveProgressMode] = useState('timer');
    const [introSlideIndex, setIntroSlideIndex] = useState(0);
    const [interviewStep, setInterviewStep] = useState(0);
    const [maxSteps, setMaxSteps] = useState(8);
    const [profileQualityScore, setProfileQualityScore] = useState(0);
    const [slotCompletenessRatio, setSlotCompletenessRatio] = useState(0);
    const [communicationClarityScore, setCommunicationClarityScore] = useState(0);
    const [salaryOutlierFlag, setSalaryOutlierFlag] = useState(false);
    const [salaryMedianForRoleCity, setSalaryMedianForRoleCity] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [savingProfile, setSavingProfile] = useState(false);
    const [recordingFinalizing, setRecordingFinalizing] = useState(false);
    const [processingElapsedSeconds, setProcessingElapsedSeconds] = useState(0);

    const clampUnit = useCallback((value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(1, numeric));
    }, []);

    const hasMeaningfulValue = useCallback((value) => {
        if (value === null || value === undefined) return false;
        if (Array.isArray(value)) return value.length > 0;
        const normalized = String(value).trim();
        if (!normalized) return false;
        return !['n/a', 'na', 'unknown', 'none', 'null', 'undefined', '0'].includes(normalized.toLowerCase());
    }, []);

    const parseCurrencyNumber = useCallback((value) => {
        const normalized = String(value ?? '').replace(/,/g, '').trim();
        if (!normalized) return 0;
        const candidate = normalized.match(/-?\d+(?:\.\d+)?/);
        if (!candidate) return 0;
        const numeric = Number.parseFloat(candidate[0]);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, numeric);
    }, []);

    const deriveReviewMetricsFromPayload = useCallback((payload = {}) => {
        const upstreamQuality = clampUnit(payload?.profileQualityScore);
        const upstreamCompleteness = clampUnit(payload?.slotCompletenessRatio);
        const upstreamClarity = clampUnit(payload?.communicationClarityScore);

        const extracted = payload?.extractedData && typeof payload.extractedData === 'object'
            ? payload.extractedData
            : {};
        const slotState = payload?.slotState && typeof payload.slotState === 'object'
            ? payload.slotState
            : {};
        const normalizedSkills = Array.isArray(extracted?.skills)
            ? extracted.skills
            : (
                Array.isArray(extracted?.requiredSkills)
                    ? extracted.requiredSkills
                    : (Array.isArray(slotState?.primarySkills) ? slotState.primarySkills : [])
            );

        const normalizedRole = isEmployer
            ? String(extracted?.jobTitle || extracted?.roleTitle || extracted?.roleName || slotState?.primaryRole || '').trim()
            : String(extracted?.roleTitle || extracted?.roleName || slotState?.primaryRole || '').trim();
        const normalizedCity = String(extracted?.location || extracted?.city || slotState?.city || '').trim();
        const normalizedSalary = isEmployer
            ? parseCurrencyNumber(extracted?.salaryRange || extracted?.expectedSalary || slotState?.expectedSalary)
            : parseCurrencyNumber(extracted?.expectedSalary || slotState?.expectedSalary);
        const normalizedExperience = isEmployer
            ? parseCurrencyNumber(extracted?.experienceRequired || extracted?.totalExperience || slotState?.totalExperienceYears)
            : (
                Number.isFinite(Number(extracted?.experienceYears ?? extracted?.totalExperience ?? slotState?.totalExperienceYears))
                    ? Number(extracted?.experienceYears ?? extracted?.totalExperience ?? slotState?.totalExperienceYears)
                    : parseCurrencyNumber(extracted?.experienceYears ?? extracted?.totalExperience ?? slotState?.totalExperienceYears)
            );

        const requiredSignals = [
            hasMeaningfulValue(normalizedRole),
            normalizedSkills.length > 0,
            hasMeaningfulValue(normalizedCity),
            normalizedSalary > 0,
            Number.isFinite(Number(normalizedExperience)) && Number(normalizedExperience) > 0,
        ];

        const filledSignals = requiredSignals.filter(Boolean).length;
        const computedCompleteness = clampUnit(filledSignals / requiredSignals.length);
        const finalCompleteness = upstreamCompleteness > 0
            ? Math.min(upstreamCompleteness, computedCompleteness > 0 ? computedCompleteness : upstreamCompleteness)
            : computedCompleteness;
        const finalClarity = upstreamClarity > 0 ? upstreamClarity : 0;
        const rawQuality = upstreamQuality > 0 ? upstreamQuality : computedCompleteness;
        const finalQuality = clampUnit(Math.min(rawQuality, finalCompleteness > 0 ? finalCompleteness : rawQuality));

        return {
            profileQualityScore: clampUnit(finalQuality),
            slotCompletenessRatio: clampUnit(finalCompleteness),
            communicationClarityScore: clampUnit(finalClarity),
        };
    }, [clampUnit, hasMeaningfulValue, isEmployer, parseCurrencyNumber]);

    const safeGoBack = useCallback(() => {
        if (stage === STAGES.INTRO && introSlideIndex > 0) {
            setIntroSlideIndex((prev) => Math.max(0, prev - 1));
            return;
        }

        if (isRecording) {
            Alert.alert('Stop Recording?', 'Your current recording will be lost.', [
                { text: 'Continue Recording', style: 'cancel' },
                {
                    text: 'Stop & Exit',
                    style: 'destructive',
                    onPress: () => {
                        recordingDiscardRef.current = true;
                        setRecordingFinalizing(false);
                        if (liveTurnDebounceTimerRef.current) {
                            clearTimeout(liveTurnDebounceTimerRef.current);
                            liveTurnDebounceTimerRef.current = null;
                        }
                        try {
                            ExpoSpeechRecognitionModule?.stop?.();
                        } catch (error) {
                            logger.warn('Speech stop failed during exit:', error?.message || error);
                        }
                        if (cameraRef.current) {
                            cameraRef.current.stopRecording();
                        }
                        setIsRecording(false);
                        if (timerRef.current) {
                            clearInterval(timerRef.current);
                            timerRef.current = null;
                        }
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                            return;
                        }
                        navigation.navigate('MainTab');
                    },
                },
            ]);
            return;
        }

        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate('MainTab');
    }, [introSlideIndex, isRecording, navigation, stage]);

    const cameraRef = useRef(null);
    const timerRef = useRef(null);
    const pollingRef = useRef(null);
    const processingElapsedTimerRef = useRef(null);
    const processingStageStartedAtRef = useRef(0);
    const processingIdRef = useRef(processingId);
    const appStateRef = useRef(AppState.currentState);
    const statusRequestInFlightRef = useRef(false);
    const mountedRef = useRef(true);
    const stageRef = useRef(stage);
    const upsellShownRef = useRef(false);
    const uiPausedRef = useRef(uiPaused);
    const activeClarificationFieldRef = useRef(null);
    const sceneScaleAnimRef = useRef(new Animated.Value(1));
    const thinkingOpacityAnimRef = useRef(new Animated.Value(0));
    const clarificationOpenTimerRef = useRef(null);
    const clarificationResumeTimerRef = useRef(null);
    const liveTurnDebounceTimerRef = useRef(null);
    const clarificationEventKeyRef = useRef('');
    const lastStateSignatureRef = useRef('');
    const lastStateChangeAtRef = useRef(0);
    const lastHybridPayloadRef = useRef(null);
    const stagnationFallbackShownRef = useRef(false);
    const reviewBadgePulseRef = useRef(new Animated.Value(1));
    const successOpacityRef = useRef(new Animated.Value(0));
    const completionNavigationTimerRef = useRef(null);
    const completionAlertShownRef = useRef(false);
    const liveQueuedTranscriptRef = useRef('');
    const liveTurnInFlightRef = useRef(false);
    const lastLiveTranscriptHashRef = useRef('');
    const liveLastSentAtRef = useRef(0);
    const recordingDiscardRef = useRef(false);
    const recordingFinalizingRef = useRef(false);

    const statusSubtitle = useMemo(() => {
        if (stage === STAGES.RECORDING) return 'Recording...';
        if (stage === STAGES.UPLOADING || stage === STAGES.PROCESSING) return 'AI analyzing your video';
        if (stage === STAGES.REVIEW) return 'Review your profile';
        if (stage === STAGES.COMPLETE) return "You're all set!";
        return 'Tell us about yourself';
    }, [stage]);

    const activeInterviewPrompt = useMemo(() => {
        if (adaptiveQuestion) return adaptiveQuestion;
        if (!missingSlot) return null;
        return clarificationFieldMap?.[missingSlot]?.question || null;
    }, [adaptiveQuestion, missingSlot]);

    const lowConfidenceFields = useMemo(() => {
        return Object.entries(slotConfidence || {})
            .filter(([field, confidence]) => REQUIRED_SLOT_FIELD_SET.has(field) && Number(confidence || 0) < 0.75)
            .map(([field]) => field);
    }, [slotConfidence]);

    const highlightedStrengths = useMemo(() => {
        const strengths = [];
        if (slotState?.primaryRole) strengths.push(`Role identified: ${slotState.primaryRole}`);
        if (Array.isArray(slotState?.primarySkills) && slotState.primarySkills.length) {
            strengths.push(`${slotState.primarySkills.length} core skills captured`);
        }
        if (slotState?.city) strengths.push(`Location mapped: ${slotState.city}`);
        if (Number(slotState?.totalExperienceYears) >= 1) {
            strengths.push(`${slotState.totalExperienceYears} years experience captured`);
        }
        return strengths.slice(0, 3);
    }, [slotState]);

    const introSlide = SMART_INTERVIEW_WALKTHROUGH[introSlideIndex] || SMART_INTERVIEW_WALKTHROUGH[0];
    const isLastIntroSlide = introSlideIndex >= (SMART_INTERVIEW_WALKTHROUGH.length - 1);
    const timerProgressRatio = Math.max(0, Math.min(1, Number(timer || 0) / MAX_RECORD_DURATION_SECONDS));
    const liveSemanticProgressActive = stage === STAGES.RECORDING && liveSttReady && Boolean(liveProcessingId);
    const mergedCompletenessRatio = liveSemanticProgressActive
        ? Math.max(0, Math.min(1, Number(slotCompletenessRatio || 0)))
        : Math.max(0, Math.min(1, Math.max(Number(slotCompletenessRatio || 0), timerProgressRatio)));
    const completionPercent = Math.round(mergedCompletenessRatio * 100);
    const normalizedMaxSteps = Math.max(1, Number(maxSteps || 8));
    const stepFromBackend = Math.min(Math.max(Number(interviewStep || 0) + 1, 1), normalizedMaxSteps);
    const stepFromProgress = Math.min(normalizedMaxSteps, Math.max(1, Math.ceil(mergedCompletenessRatio * normalizedMaxSteps)));
    const displayStep = stage === STAGES.RECORDING
        ? (liveSemanticProgressActive ? stepFromBackend : Math.max(stepFromBackend, stepFromProgress))
        : stepFromBackend;
    const processingPhaseIndex = stage === STAGES.UPLOADING
        ? 0
        : Math.min(PROCESSING_TRUST_STEPS.length - 1, Math.max(0, Number(processingMessageIndex || 0)));
    const liveBadgeLabel = liveSemanticProgressActive ? 'LIVE' : (liveProgressMode === 'connecting' ? 'SYNC' : 'TIMER');
    const liveBadgeDotColor = liveSemanticProgressActive
        ? '#22c55e'
        : (liveProgressMode === 'connecting' ? '#f59e0b' : '#64748b');
    const liveProgressStatusText = liveSemanticProgressActive
        ? 'Progress updates from your spoken answers.'
        : (liveProgressMode === 'connecting'
            ? 'Starting live answer understanding...'
            : (
                IS_EXPO_GO_RUNTIME || !isNativeSpeechRecognitionAvailable
                    ? 'Expo Go mode: timer progress is active during recording.'
                    : 'Timer mode is active. Your profile will continue improving after processing.'
            ));

    const sceneScaleAnim = sceneScaleAnimRef.current;
    const thinkingOpacityAnim = thinkingOpacityAnimRef.current;
    const reviewBadgePulse = reviewBadgePulseRef.current;
    const successOpacity = successOpacityRef.current;

    useEffect(() => {
        processingIdRef.current = processingId;
    }, [processingId]);

    const truncateSnippet = useCallback((text) => {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        const maxLen = 72;
        if (normalized.length <= maxLen) return normalized;
        return `${normalized.slice(0, maxLen - 1)}…`;
    }, []);

    const extractTranscriptFromSpeechEvent = useCallback((eventPayload) => {
        if (!eventPayload || typeof eventPayload !== 'object') return '';

        if (typeof eventPayload?.value === 'string') {
            return String(eventPayload.value).replace(/\s+/g, ' ').trim();
        }
        if (typeof eventPayload?.transcript === 'string') {
            return String(eventPayload.transcript).replace(/\s+/g, ' ').trim();
        }

        const results = Array.isArray(eventPayload?.results) ? eventPayload.results : [];
        if (results.length > 0) {
            const normalized = results
                .map((row) => {
                    if (typeof row === 'string') return row;
                    if (typeof row?.transcript === 'string') return row.transcript;
                    if (Array.isArray(row) && row[0] && typeof row[0].transcript === 'string') return row[0].transcript;
                    if (row?.[0] && typeof row[0].transcript === 'string') return row[0].transcript;
                    return '';
                })
                .filter(Boolean)
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (normalized) return normalized;
        }

        return '';
    }, []);

    const clearClarificationTimers = useCallback(() => {
        if (clarificationOpenTimerRef.current) {
            clearTimeout(clarificationOpenTimerRef.current);
            clarificationOpenTimerRef.current = null;
        }
        if (clarificationResumeTimerRef.current) {
            clearTimeout(clarificationResumeTimerRef.current);
            clarificationResumeTimerRef.current = null;
        }
    }, []);

    const buildClarificationContext = useCallback((payload, fieldName) => {
        const hintedContext = payload?.clarificationHints?.[fieldName]?.contextText;
        if (hintedContext) {
            return String(hintedContext);
        }

        const sourceFromPayload = payload?.transcriptSnippet || payload?.latestTranscriptSnippet || payload?.transcriptChunk;
        if (sourceFromPayload) {
            return `You mentioned "${truncateSnippet(sourceFromPayload)}".`;
        }

        const fieldValue = payload?.slotState?.[fieldName];
        if (Array.isArray(fieldValue) && fieldValue.length) {
            return `You mentioned "${truncateSnippet(fieldValue.join(', '))}".`;
        }
        if (fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim()) {
            return `You mentioned "${truncateSnippet(String(fieldValue))}".`;
        }

        return 'You mentioned this briefly.';
    }, [truncateSnippet]);

    const presentClarificationForField = useCallback((fieldName, payload) => {
        const nextField = String(fieldName || '').trim();
        if (!nextField) return;

        const isAlreadyVisible = clarificationVisible && clarificationField === nextField;
        const isAlreadyThinking = showThinkingIndicator && activeClarificationFieldRef.current === nextField;
        if (isAlreadyVisible || isAlreadyThinking) return;

        clearClarificationTimers();
        const contextText = buildClarificationContext(payload, nextField);
        const eventKey = `${String(payload?.processingId || processingId || '')}:${String(payload?.interviewStep || '')}:${nextField}`;

        setUiPaused(true);
        setClarificationVisible(false);
        setClarificationField(nextField);
        setClarificationContextText(contextText);
        setShowThinkingIndicator(true);
        activeClarificationFieldRef.current = nextField;

        if (clarificationEventKeyRef.current !== eventKey) {
            clarificationEventKeyRef.current = eventKey;
            trackEvent('clarificationTriggered', {
                clarificationFieldName: nextField,
                processingId: String(payload?.processingId || processingId || ''),
            });
        }

        clarificationOpenTimerRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            setShowThinkingIndicator(false);
            setClarificationQueuedAt(Date.now());
            setClarificationVisible(true);
        }, 380);
    }, [
        buildClarificationContext,
        clarificationField,
        clarificationVisible,
        clearClarificationTimers,
        processingId,
        showThinkingIndicator,
    ]);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const stopStatusTracking = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
        if (processingElapsedTimerRef.current) {
            clearInterval(processingElapsedTimerRef.current);
            processingElapsedTimerRef.current = null;
        }
    }, []);

    const formatTimer = useCallback((seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const maxMins = Math.floor(MAX_RECORD_DURATION_SECONDS / 60);
        const maxSecs = MAX_RECORD_DURATION_SECONDS % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} / ${String(maxMins).padStart(2, '0')}:${String(maxSecs).padStart(2, '0')}`;
    }, []);

    const hydrateExtractedData = useCallback((payload) => {
        const defaults = buildDefaultExtractedData(role, userInfo);
        return {
            ...defaults,
            ...(payload || {}),
        };
    }, [role, userInfo]);

    const mapSlotStateToExtractedData = useCallback((slots = {}) => {
        if (isEmployer) {
            return {
                jobTitle: slots.primaryRole || '',
                companyName: userInfo?.name || '',
                requiredSkills: Array.isArray(slots.primarySkills) ? slots.primarySkills : [],
                experienceRequired: slots.totalExperienceYears != null ? String(slots.totalExperienceYears) : '',
                salaryRange: slots.expectedSalary != null ? String(slots.expectedSalary) : '',
                shift: slots.shiftPreference || 'flexible',
                location: slots.city || '',
                description: '',
            };
        }

        return {
            name: slots.fullName || userInfo?.name || '',
            roleTitle: slots.primaryRole || '',
            skills: Array.isArray(slots.primarySkills) ? slots.primarySkills : [],
            experienceYears: Number.isFinite(Number(slots.totalExperienceYears))
                ? Number(slots.totalExperienceYears)
                : 0,
            expectedSalary: slots.expectedSalary != null ? String(slots.expectedSalary) : '',
            panchayat: String(slots.panchayat || slots.locality || '').trim(),
            language: normalizeLanguageText(slots.language || slots.primaryLanguage, userInfo?.languageCode),
            maxCommuteDistanceKm: normalizeCommuteDistance(slots.maxCommuteDistanceKm),
            minimumMatchTier: normalizeMatchTier(slots.minimumMatchTier),
            preferredShift: normalizeWorkerShift(slots.shiftPreference),
            availabilityWindowDays: normalizeAvailabilityWindowDays(slots.availabilityWindowDays),
            isAvailable: normalizeBooleanFlag(slots.isAvailable, true),
            openToRelocation: normalizeBooleanFlag(slots.openToRelocation, false),
            openToNightShift: normalizeBooleanFlag(slots.openToNightShift, false),
            location: String(slots.city || slots.location || '').trim(),
            summary: '',
        };
    }, [isEmployer, userInfo?.languageCode, userInfo?.name]);

    const finalizeInterviewCompletion = useCallback(async (data = {}) => {
        if (completionAlertShownRef.current) {
            return;
        }
        completionAlertShownRef.current = true;
        stopStatusTracking();
        if (liveTurnDebounceTimerRef.current) {
            clearTimeout(liveTurnDebounceTimerRef.current);
            liveTurnDebounceTimerRef.current = null;
        }
        try {
            ExpoSpeechRecognitionModule?.stop?.();
        } catch (error) {
            logger.warn('Speech stop failed while finalizing:', error?.message || error);
        }
        setLiveProcessingId(null);
        setLiveTranscriptPreview('');
        setLiveProgressMode('timer');
        liveQueuedTranscriptRef.current = '';
        liveTurnInFlightRef.current = false;
        lastLiveTranscriptHashRef.current = '';
        liveLastSentAtRef.current = 0;
        setRecordingFinalizing(false);
        recordingDiscardRef.current = false;
        setShowThinkingIndicator(false);
        setClarificationVisible(false);
        setClarificationField(null);
        setClarificationContextText('');
        setUiPaused(false);
        setExtractionWarning(null);

        const slotDerived = mapSlotStateToExtractedData(data?.slotState || {});
        const merged = hydrateExtractedData({
            ...slotDerived,
            ...(data?.extractedData || {}),
        });
        setExtractedData(merged);
        const derivedMetrics = deriveReviewMetricsFromPayload({
            ...data,
            extractedData: merged,
        });
        setProfileQualityScore(derivedMetrics.profileQualityScore);
        setSlotCompletenessRatio(derivedMetrics.slotCompletenessRatio);
        setCommunicationClarityScore(derivedMetrics.communicationClarityScore);
        setCreatedJobId(data?.createdJobId || null);
        setStage(STAGES.COMPLETE);
        successOpacity.setValue(1);

        try {
            await updateUserInfo?.({
                hasCompletedProfile: true,
                profileComplete: true,
            });
            await completeOnboarding?.();
        } catch (error) {
            logger.warn('Smart interview completion sync warning:', error?.message || error);
        }

        const targetTab = isEmployer ? 'Talent' : 'Profiles';
        navigation.reset({
            index: 0,
            routes: [{
                name: 'MainTab',
                state: {
                    index: 0,
                    routes: [{
                        name: targetTab,
                        params: {
                            profileData: data?.profileData || merged,
                            processingId: String(data?.processingId || processingId || ''),
                        },
                    }],
                },
            }],
        });
        triggerHaptic.success();
    }, [
        completeOnboarding,
        deriveReviewMetricsFromPayload,
        hydrateExtractedData,
        isEmployer,
        mapSlotStateToExtractedData,
        navigation,
        processingId,
        stopStatusTracking,
        successOpacity,
        updateUserInfo,
    ]);

    const getBoostDismissKey = useCallback((jobId) => {
        const userId = String(userInfo?._id || 'unknown');
        return `@boost_upsell_dismissed:${userId}:${String(jobId)}:${BOOST_UPSELL_TYPE}`;
    }, [userInfo?._id]);

    const maybeShowBoostUpsell = useCallback(async (jobId) => {
        if (!jobId || !isEmployer || upsellShownRef.current) return;
        const dismissKey = getBoostDismissKey(jobId);
        const dismissed = await AsyncStorage.getItem(dismissKey);
        if (dismissed === '1') return;

        try {
            const { data } = await client.post(`/api/jobs/${jobId}/boost-upsell-exposure`, {}, {
                __skipApiErrorHandler: true,
            });
            if (data?.shouldShow) {
                upsellShownRef.current = true;
                setUpsellJobId(jobId);
                setShowBoostUpsell(true);
                trackEvent('EMPLOYER_BOOST_UPSELL_SHOWN', {
                    source: 'smart_interview_complete',
                    jobId: String(jobId),
                });
            }
        } catch (error) {
            logger.warn('Upsell exposure check failed:', error?.message || error);
        }
    }, [getBoostDismissKey, isEmployer]);

    const dismissBoostUpsell = useCallback(async () => {
        if (!upsellJobId) return;
        const dismissKey = getBoostDismissKey(upsellJobId);
        await AsyncStorage.setItem(dismissKey, '1');
        setShowBoostUpsell(false);
    }, [getBoostDismissKey, upsellJobId]);

    const handleBoostPurchase = useCallback(async () => {
        if (!upsellJobId) return;
        trackEvent('EMPLOYER_BOOST_UPSELL_CLICKED', {
            source: 'smart_interview_complete',
            jobId: String(upsellJobId),
        });
        setShowBoostUpsell(false);

        try {
            const { data } = await client.post('/api/payment/create-featured-listing', { jobId: upsellJobId }, {
                __skipApiErrorHandler: true,
            });
            trackEvent('EMPLOYER_BOOST_PURCHASE_INITIATED', {
                source: 'smart_interview_complete',
                jobId: String(upsellJobId),
            });
            if (data?.url) {
                const { Linking } = await import('react-native');
                Linking.openURL(data.url);
            } else {
                Alert.alert('Boost Unavailable', 'Could not start payment checkout right now.');
            }
        } catch (error) {
            Alert.alert('Boost Unavailable', 'Could not start payment checkout right now.');
        }
    }, [upsellJobId]);

    const clearLiveTurnDebounceTimer = useCallback(() => {
        if (liveTurnDebounceTimerRef.current) {
            clearTimeout(liveTurnDebounceTimerRef.current);
            liveTurnDebounceTimerRef.current = null;
        }
    }, []);

    const resetLiveSessionState = useCallback(({ preserveSttAvailability = true } = {}) => {
        setLiveProcessingId(null);
        setLiveTranscriptPreview('');
        setLiveProgressMode('timer');
        if (!preserveSttAvailability) {
            setLiveSttReady(false);
        }
        liveQueuedTranscriptRef.current = '';
        liveTurnInFlightRef.current = false;
        lastLiveTranscriptHashRef.current = '';
        liveLastSentAtRef.current = 0;
    }, []);

    const stopLiveSpeechRecognition = useCallback(() => {
        clearLiveTurnDebounceTimer();
        try {
            ExpoSpeechRecognitionModule?.stop?.();
        } catch (error) {
            logger.warn('Speech stop failed:', error?.message || error);
        }
    }, [clearLiveTurnDebounceTimer]);

    const startLiveSpeechRecognition = useCallback(() => {
        if (!liveSttReady) return;
        if (stageRef.current !== STAGES.RECORDING || uiPausedRef.current) return;
        try {
            ExpoSpeechRecognitionModule?.start?.({
                lang: 'en-US',
                interimResults: true,
                continuous: true,
                maxAlternatives: 1,
            });
        } catch (error) {
            logger.warn('Speech start failed, falling back to timer mode:', error?.message || error);
            setLiveSttReady(false);
            setLiveProgressMode('timer');
        }
    }, [liveSttReady]);

    const ensureLiveSpeechReady = useCallback(async () => {
        try {
            if (!isNativeSpeechRecognitionAvailable || !ExpoSpeechRecognitionModule) {
                setLiveSttReady(false);
                setLiveProgressMode('timer');
                return false;
            }

            if (
                typeof ExpoSpeechRecognitionModule?.isRecognitionAvailable === 'function'
                && !ExpoSpeechRecognitionModule.isRecognitionAvailable()
            ) {
                setLiveSttReady(false);
                setLiveProgressMode('timer');
                return false;
            }

            if (typeof ExpoSpeechRecognitionModule?.requestPermissionsAsync === 'function') {
                const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
                if (!permission?.granted) {
                    setLiveSttReady(false);
                    setLiveProgressMode('timer');
                    return false;
                }
            }

            setLiveSttReady(true);
            return true;
        } catch (error) {
            logger.warn('Speech permissions unavailable, using timer fallback:', error?.message || error);
            setLiveSttReady(false);
            setLiveProgressMode('timer');
            return false;
        }
    }, []);

    const applyHybridPayload = useCallback((data) => {
        const nextSlotState = data?.slotState && typeof data.slotState === 'object' ? data.slotState : {};
        const nextSlotConfidence = data?.slotConfidence && typeof data.slotConfidence === 'object' ? data.slotConfidence : {};
        const nextAmbiguousFields = Array.isArray(data?.ambiguousFields) ? data.ambiguousFields : [];
        const signature = [
            String(data?.status || ''),
            String(Boolean(data?.interviewComplete)),
            String(data?.missingSlot || ''),
            nextAmbiguousFields.join(','),
            String(data?.interviewStep ?? ''),
        ].join('|');

        setSlotState(nextSlotState);
        setSlotConfidence(nextSlotConfidence);
        setAmbiguousFields(nextAmbiguousFields);
        setMissingSlot(data?.missingSlot || null);
        setInterviewComplete(Boolean(data?.interviewComplete));
        setAdaptiveQuestion(data?.adaptiveQuestion || null);
        setClarificationHints(data?.clarificationHints && typeof data.clarificationHints === 'object' ? data.clarificationHints : {});
        setInterviewStep(Number(data?.interviewStep || 0));
        setMaxSteps(Math.max(1, Number(data?.maxSteps || 8)));
        const derivedMetrics = deriveReviewMetricsFromPayload(data);
        setProfileQualityScore(derivedMetrics.profileQualityScore);
        setSlotCompletenessRatio(derivedMetrics.slotCompletenessRatio);
        setCommunicationClarityScore(derivedMetrics.communicationClarityScore);
        setSalaryOutlierFlag(Boolean(data?.salaryOutlierFlag));
        setSalaryMedianForRoleCity(data?.salaryMedianForRoleCity ?? null);
        const completeness = Math.max(0, Math.min(1, Number(derivedMetrics.slotCompletenessRatio || 0)));
        const nextProcessingPhase = Math.min(
            PROCESSING_MESSAGES.length - 1,
            Math.max(0, Math.floor(completeness * PROCESSING_MESSAGES.length)),
        );
        setProcessingMessageIndex(nextProcessingPhase);
        lastHybridPayloadRef.current = data || null;

        if (lastStateSignatureRef.current !== signature) {
            lastStateSignatureRef.current = signature;
            lastStateChangeAtRef.current = Date.now();
            stagnationFallbackShownRef.current = false;
            setProcessingFallbackMessage(null);
        }

        if (nextAmbiguousFields.length > 0) {
            const firstField = String(
                nextAmbiguousFields.find((field) => Boolean(clarificationFieldMap[field]))
                || nextAmbiguousFields[0]
                || ''
            );
            if (!clarificationFieldMap[firstField]) {
                setUiPaused(false);
                return;
            }
            presentClarificationForField(firstField, data);
        } else {
            clearClarificationTimers();
            setShowThinkingIndicator(false);
            setClarificationVisible(false);
            setClarificationField(null);
            setClarificationQueuedAt(null);
            setClarificationContextText('');
            setUiPaused(false);
        }
    }, [clearClarificationTimers, deriveReviewMetricsFromPayload, presentClarificationForField]);

    const flushLiveTranscriptTurn = useCallback(async ({ force = false } = {}) => {
        if (!liveProcessingId) return;
        if (stageRef.current !== STAGES.RECORDING) return;
        if (uiPausedRef.current && !force) return;
        if (liveTurnInFlightRef.current) return;

        const transcriptChunk = String(liveQueuedTranscriptRef.current || '').trim();
        if (!transcriptChunk) return;

        const words = transcriptChunk.split(/\s+/).filter(Boolean);
        if (words.length < LIVE_MIN_TRANSCRIPT_WORDS && !force) return;

        const hash = transcriptChunk.toLowerCase();
        if (hash === lastLiveTranscriptHashRef.current && !force) return;

        liveTurnInFlightRef.current = true;
        liveQueuedTranscriptRef.current = '';

        try {
            const { data } = await client.post(`/api/v2/interview-processing/${liveProcessingId}/hybrid-turn`, {
                transcriptChunk,
            }, {
                __skipApiErrorHandler: true,
            });
            if (!mountedRef.current) return;

            liveLastSentAtRef.current = Date.now();
            lastLiveTranscriptHashRef.current = hash;
            applyHybridPayload(data);
        } catch (error) {
            logger.warn('Live hybrid turn failed:', error?.response?.data?.message || error?.message || error);
            liveQueuedTranscriptRef.current = transcriptChunk;
            setLiveProgressMode('timer');
        } finally {
            liveTurnInFlightRef.current = false;
            if (force && liveQueuedTranscriptRef.current) {
                flushLiveTranscriptTurn({ force: true });
            }
        }
    }, [applyHybridPayload, liveProcessingId]);

    const queueLiveTranscriptTurn = useCallback((rawTranscript, { force = false } = {}) => {
        const transcriptChunk = String(rawTranscript || '').replace(/\s+/g, ' ').trim();
        if (!transcriptChunk) return;

        liveQueuedTranscriptRef.current = transcriptChunk;
        if (force) {
            clearLiveTurnDebounceTimer();
            flushLiveTranscriptTurn({ force: true });
            return;
        }

        const elapsed = Date.now() - Number(liveLastSentAtRef.current || 0);
        if (elapsed >= LIVE_TURN_DEBOUNCE_MS) {
            flushLiveTranscriptTurn();
            return;
        }

        clearLiveTurnDebounceTimer();
        liveTurnDebounceTimerRef.current = setTimeout(() => {
            flushLiveTranscriptTurn();
        }, LIVE_TURN_DEBOUNCE_MS - elapsed);
    }, [clearLiveTurnDebounceTimer, flushLiveTranscriptTurn]);

    const flushPendingLiveTranscript = useCallback(async ({ includePreview = true } = {}) => {
        if (includePreview) {
            const previewTranscript = String(liveTranscriptPreview || '').trim();
            if (previewTranscript) {
                liveQueuedTranscriptRef.current = previewTranscript;
            }
        }

        clearLiveTurnDebounceTimer();

        const deadline = Date.now() + 4500;
        do {
            await flushLiveTranscriptTurn({ force: true });
            const hasPendingChunk = Boolean(String(liveQueuedTranscriptRef.current || '').trim());
            if (!liveTurnInFlightRef.current && !hasPendingChunk) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        } while (Date.now() < deadline);
    }, [clearLiveTurnDebounceTimer, flushLiveTranscriptTurn, liveTranscriptPreview]);

    const startLiveHybridSession = useCallback(async () => {
        if (stageRef.current !== STAGES.RECORDING) {
            return null;
        }

        try {
            const { data } = await client.post('/api/v2/interview-processing/hybrid/start', {
                maxSteps: 8,
            }, {
                __skipApiErrorHandler: true,
            });
            if (!mountedRef.current) return null;

            const nextLiveProcessingId = String(data?.processingId || '').trim();
            if (!nextLiveProcessingId) {
                setLiveProgressMode('timer');
                return null;
            }

            setLiveProcessingId(nextLiveProcessingId);
            setLiveProgressMode('live');
            applyHybridPayload(data);

            const speechReady = await ensureLiveSpeechReady();
            if (speechReady) {
                startLiveSpeechRecognition();
            }

            return nextLiveProcessingId;
        } catch (error) {
            logger.warn('Live hybrid session unavailable, using timer fallback:', error?.response?.data?.message || error?.message || error);
            setLiveProcessingId(null);
            setLiveProgressMode('timer');
            return null;
        }
    }, [applyHybridPayload, ensureLiveSpeechReady, startLiveSpeechRecognition]);

    useSpeechRecognitionEvent('result', (eventPayload) => {
        if (stageRef.current !== STAGES.RECORDING) return;
        if (uiPausedRef.current) return;
        if (recordingFinalizingRef.current) return;
        if (!liveProcessingId) return;

        const transcript = extractTranscriptFromSpeechEvent(eventPayload);
        if (!transcript) return;

        setLiveProgressMode('live');
        setLiveTranscriptPreview(transcript);
        queueLiveTranscriptTurn(transcript);
    });

    useSpeechRecognitionEvent('error', (eventPayload) => {
        const code = String(eventPayload?.error || '').toLowerCase();
        if (code === 'aborted') return;
        if (stageRef.current !== STAGES.RECORDING) return;
        if (recordingFinalizingRef.current) return;

        logger.warn('Speech event error:', eventPayload?.message || code || eventPayload);
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) {
            setLiveSttReady(false);
        }
        setLiveProgressMode('timer');
    });

    useSpeechRecognitionEvent('end', () => {
        if (stageRef.current !== STAGES.RECORDING) return;
        if (uiPausedRef.current) return;
        if (recordingFinalizingRef.current) return;
        if (!liveSttReady) return;
        if (!liveProcessingId) return;

        setTimeout(() => {
            if (!mountedRef.current) return;
            if (stageRef.current !== STAGES.RECORDING) return;
            if (uiPausedRef.current) return;
            startLiveSpeechRecognition();
        }, 220);
    });

    const checkProcessingStatus = useCallback(async () => {
        if (statusRequestInFlightRef.current) return;
        statusRequestInFlightRef.current = true;

        try {
            const trackedProcessingId = String(
                processingIdRef.current
                || route?.params?.processingId
                || ''
            ).trim();
            const statusEndpoint = trackedProcessingId
                ? `/api/v2/interview-processing/${encodeURIComponent(trackedProcessingId)}`
                : '/api/v2/interview-processing/latest';

            const { data } = await client.get(statusEndpoint, {
                __skipApiErrorHandler: true,
            });
            if (!mountedRef.current) return;

            const resolvedProcessingId = String(data?.processingId || '').trim();
            if (!resolvedProcessingId) {
                setProcessingFallbackMessage('Waiting for interview processing session to initialize...');
                setStage(STAGES.PROCESSING);
                return;
            }
            if (String(processingIdRef.current || '').trim() !== resolvedProcessingId) {
                processingIdRef.current = resolvedProcessingId;
                setProcessingId(resolvedProcessingId);
            }

            const status = String(data?.status || '').toLowerCase();
            applyHybridPayload(data);

            if (Boolean(data?.interviewComplete)) {
                await finalizeInterviewCompletion(data);
                return;
            }

            if (status === 'completed') {
                await finalizeInterviewCompletion(data);
                return;
            }

            if (status === 'failed') {
                stopStatusTracking();
                triggerHaptic.error();
                Alert.alert(
                    'Processing Failed',
                    data?.errorMessage || 'Could not process your interview.',
                    [
                        {
                            text: 'Retry',
                            onPress: () => {
                                setStage(STAGES.PROCESSING);
                                checkProcessingStatus();
                            },
                        },
                        {
                            text: 'Record Again',
                            style: 'destructive',
                            onPress: () => setStage(STAGES.INTRO),
                        },
                    ],
                );
                return;
            }

            if (Boolean(data?.staleProcessing)) {
                setProcessingFallbackMessage('Processing is delayed on server. Waiting for verified extraction result.');
            } else {
                setProcessingFallbackMessage(null);
            }

            setStage(STAGES.PROCESSING);
        } catch (error) {
            if (!mountedRef.current) return;
            const statusCode = Number(error?.response?.status || 0);
            if (statusCode === 404 && String(processingIdRef.current || route?.params?.processingId || '').trim()) {
                stopStatusTracking();
                setProcessingFallbackMessage('We could not find this interview session anymore. You can retry or record again.');
                setStage(STAGES.PROCESSING);
                logger.warn('Interview session missing during status check:', error?.message || error);
                return;
            }

            setProcessingFallbackMessage(
                statusCode >= 500
                    ? 'Server is taking longer than usual. Tap below to retry status sync.'
                    : 'Connection interrupted while checking progress. Tap below to retry.'
            );
            setStage(STAGES.PROCESSING);
            logger.warn('Interview status check failed:', error?.message || error);
        } finally {
            statusRequestInFlightRef.current = false;
        }
    }, [applyHybridPayload, finalizeInterviewCompletion, route?.params?.processingId, stopStatusTracking]);

    const beginHybridStatusTracking = useCallback(() => {
        stopStatusTracking();
        setProcessingFallbackMessage(null);
        lastStateChangeAtRef.current = Date.now();
        lastStateSignatureRef.current = '';
        lastHybridPayloadRef.current = null;
        stagnationFallbackShownRef.current = false;

        checkProcessingStatus();

        pollingRef.current = setInterval(() => {
            const stagnantMs = Date.now() - Number(lastStateChangeAtRef.current || 0);

            if (
                stagnantMs >= PROCESSING_STAGNATION_TIMEOUT_MS
                && !stagnationFallbackShownRef.current
                && stageRef.current === STAGES.PROCESSING
            ) {
                stagnationFallbackShownRef.current = true;
                setProcessingFallbackMessage('Still syncing your latest response. Waiting for verified extraction result...');
            }
            checkProcessingStatus();
        }, POLL_INTERVAL_MS);
    }, [checkProcessingStatus, stopStatusTracking]);

    const uploadForAsyncProcessing = useCallback(async (uri) => {
        setStage(STAGES.UPLOADING);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append('video', {
            uri,
            type: 'video/mp4',
            name: `smart-interview-${Date.now()}.mp4`,
        });

        try {
            const uploadConfig = {
                headers: { 'Content-Type': 'multipart/form-data' },
                transformRequest: (body) => body,
                timeout: 120000,
                __skipApiErrorHandler: true,
                onUploadProgress: (event) => {
                    if (!event?.total) return;
                    const progress = Math.round((event.loaded * 100) / event.total);
                    setUploadProgress(Math.max(0, Math.min(100, progress)));
                },
            };

            const v2Response = await client.post('/api/v2/upload/video', formData, uploadConfig);
            const data = v2Response?.data;

            if (!data?.success) {
                throw new Error(data?.error || 'Could not queue interview processing.');
            }

            if (data?.processingId) {
                processingIdRef.current = data.processingId;
                setProcessingId(data.processingId);
                setStage(STAGES.PROCESSING);
                beginHybridStatusTracking();
                return;
            }
            throw new Error('Upload response missing processingId.');
        } catch (error) {
            triggerHaptic.error();
            const statusCode = Number(error?.response?.status || 0);
            const validationIssues = Array.isArray(error?.response?.data?.validationIssues)
                ? error.response.data.validationIssues
                : [];
            if (statusCode === 422) {
                Alert.alert('Extraction Failed', 'Extraction failed. Please retry interview.');
                setStage(STAGES.INTRO);
                return;
            }
            const validationMessage = validationIssues.length
                ? `\nMissing: ${validationIssues.map((item) => item?.field).filter(Boolean).join(', ')}`
                : '';
            Alert.alert(
                'Upload Failed',
                `${error?.response?.data?.error || error?.message || 'Could not upload interview video. Please try again.'}${validationMessage}`
            );
            setStage(STAGES.INTRO);
        } finally {
            setUploadProgress(0);
        }
    }, [beginHybridStatusTracking]);

    const startRecordingInternal = useCallback(async () => {
        if (!cameraRef.current || isRecording) return;

        setStage(STAGES.RECORDING);
        setIsRecording(true);
        setRecordingFinalizing(false);
        setUiPaused(false);
        setExtractionWarning(null);
        setTimer(0);
        resetLiveSessionState({ preserveSttAvailability: true });
        setLiveProgressMode('connecting');
        recordingDiscardRef.current = false;
        triggerHaptic.medium();
        void startLiveHybridSession();

        timerRef.current = setInterval(() => {
            setTimer((prev) => Math.min(prev + 1, MAX_RECORD_DURATION_SECONDS));
        }, 1000);

        try {
            const recordingResult = await cameraRef.current.recordAsync({
                maxDuration: MAX_RECORD_DURATION_SECONDS,
            });

            if (!mountedRef.current) return;

            await flushPendingLiveTranscript({ includePreview: true });
            stopLiveSpeechRecognition();
            resetLiveSessionState({ preserveSttAvailability: true });
            clearTimer();
            setIsRecording(false);
            setUiPaused(false);
            setRecordingFinalizing(false);

            if (recordingDiscardRef.current) {
                recordingDiscardRef.current = false;
                setVideoUri(null);
                setStage(STAGES.INTRO);
                return;
            }

            if (recordingResult?.uri) {
                setVideoUri(recordingResult.uri);
                await uploadForAsyncProcessing(recordingResult.uri);
            } else {
                setStage(STAGES.INTRO);
            }
        } catch (error) {
            stopLiveSpeechRecognition();
            resetLiveSessionState({ preserveSttAvailability: true });
            clearTimer();
            setIsRecording(false);
            setUiPaused(false);
            setRecordingFinalizing(false);
            if (!mountedRef.current) return;
            if (recordingDiscardRef.current) {
                recordingDiscardRef.current = false;
                setVideoUri(null);
                setStage(STAGES.INTRO);
                return;
            }
            logger.error('Recording failed:', error?.message || error);
            Alert.alert('Recording Failed', 'Could not record video. Please try again.');
            setStage(STAGES.INTRO);
        }
    }, [
        clearTimer,
        flushPendingLiveTranscript,
        isRecording,
        resetLiveSessionState,
        startLiveHybridSession,
        stopLiveSpeechRecognition,
        uploadForAsyncProcessing,
    ]);

    const handleBeginInterview = useCallback(() => {
        setCameraReady(false);
        setRecordingRequested(true);
        setStage(STAGES.RECORDING);
        triggerHaptic.medium();
    }, []);

    const handleSkipIntro = useCallback(() => {
        setIntroSlideIndex(SMART_INTERVIEW_WALKTHROUGH.length - 1);
        triggerHaptic.light();
    }, []);

    const handleNextIntro = useCallback(() => {
        if (isLastIntroSlide) {
            handleBeginInterview();
            return;
        }
        setIntroSlideIndex((prev) => Math.min(prev + 1, SMART_INTERVIEW_WALKTHROUGH.length - 1));
        triggerHaptic.light();
    }, [handleBeginInterview, isLastIntroSlide]);

    const stopRecording = useCallback(async () => {
        if (!isRecording || recordingFinalizing) return;
        setRecordingFinalizing(true);
        recordingDiscardRef.current = false;
        setUiPaused(true);
        triggerHaptic.light();

        stopLiveSpeechRecognition();
        await flushPendingLiveTranscript({ includePreview: true });

        if (cameraRef.current) {
            cameraRef.current.stopRecording();
            return;
        }

        setRecordingFinalizing(false);
    }, [flushPendingLiveTranscript, isRecording, recordingFinalizing, stopLiveSpeechRecognition]);

    const handleRetakeInterview = useCallback(() => {
        recordingDiscardRef.current = true;
        stopLiveSpeechRecognition();
        resetLiveSessionState({ preserveSttAvailability: true });

        if (isRecording && cameraRef.current) {
            cameraRef.current.stopRecording();
        }

        clearTimer();
        stopStatusTracking();
        clearClarificationTimers();

        setIsRecording(false);
        setTimer(0);
        setVideoUri(null);
        processingIdRef.current = null;
        setProcessingId(null);
        setCreatedJobId(null);
        setExtractedData(null);
        setProcessingMessageIndex(0);
        setShowBoostUpsell(false);
        setUpsellJobId(null);
        setUiPaused(false);
        setCameraReady(false);
        setRecordingRequested(false);
        setSlotState({});
        setSlotConfidence({});
        setAmbiguousFields([]);
        setMissingSlot(null);
        setInterviewComplete(false);
        setClarificationField(null);
        setClarificationVisible(false);
        setClarificationSubmitting(false);
        setClarificationQueuedAt(null);
        setClarificationContextText('');
        setClarificationHints({});
        setShowThinkingIndicator(false);
        setProcessingFallbackMessage(null);
        setAdaptiveQuestion(null);
        setInterviewStep(0);
        setMaxSteps(8);
        setProfileQualityScore(0);
        setSlotCompletenessRatio(0);
        setCommunicationClarityScore(0);
        setSalaryOutlierFlag(false);
        setSalaryMedianForRoleCity(null);
        setUploadProgress(0);
        setSavingProfile(false);
        setRecordingFinalizing(false);
        setIntroSlideIndex(0);
        setStage(STAGES.INTRO);

        clarificationEventKeyRef.current = '';
        activeClarificationFieldRef.current = null;
        lastStateSignatureRef.current = '';
        lastStateChangeAtRef.current = 0;
        lastHybridPayloadRef.current = null;
        stagnationFallbackShownRef.current = false;
        completionAlertShownRef.current = false;

        triggerHaptic.light();
    }, [
        clearClarificationTimers,
        clearTimer,
        isRecording,
        resetLiveSessionState,
        stopLiveSpeechRecognition,
        stopStatusTracking,
    ]);

    const cancelRecording = useCallback(() => {
        if (!isRecording || recordingFinalizing) return;

        Alert.alert(
            'Discard Interview?',
            'This will delete the current recording and reset Smart Interview to step one.',
            [
                { text: 'Continue Recording', style: 'cancel' },
                {
                    text: 'Discard & Restart',
                    style: 'destructive',
                    onPress: handleRetakeInterview,
                },
            ],
        );
    }, [handleRetakeInterview, isRecording, recordingFinalizing]);

    const toggleUiPause = useCallback(() => {
        if (!isRecording || recordingFinalizing) return;
        setUiPaused((prev) => {
            const nextPaused = !prev;
            uiPausedRef.current = nextPaused;

            if (nextPaused) {
                clearLiveTurnDebounceTimer();
                stopLiveSpeechRecognition();
            } else if (liveSttReady && liveProcessingId) {
                setLiveProgressMode('live');
                startLiveSpeechRecognition();
            }

            return nextPaused;
        });
        triggerHaptic.light();
    }, [
        clearLiveTurnDebounceTimer,
        isRecording,
        liveProcessingId,
        liveSttReady,
        recordingFinalizing,
        startLiveSpeechRecognition,
        stopLiveSpeechRecognition,
    ]);

    const parseSkills = useCallback((value) => {
        if (Array.isArray(value)) return value;
        return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    }, []);

    const optimizeExtractedData = useCallback((rawData) => {
        const hydrated = hydrateExtractedData(rawData || {});

        if (isEmployer) {
            return {
                ...hydrated,
                jobTitle: String(hydrated?.jobTitle || '').trim(),
                companyName: String(hydrated?.companyName || userInfo?.name || 'My Company').trim(),
                requiredSkills: parseSkills(hydrated?.requiredSkills),
                experienceRequired: String(hydrated?.experienceRequired || '').trim(),
                salaryRange: String(hydrated?.salaryRange || '').trim(),
                shift: String(hydrated?.shift || 'flexible').trim() || 'flexible',
                location: String(hydrated?.location || '').trim(),
                description: String(hydrated?.description || '').trim(),
            };
        }

        const fullName = String(hydrated?.name || userInfo?.name || '').trim();
        const expectedSalaryNum = Number.parseInt(String(hydrated?.expectedSalary || '').replace(/[^0-9]/g, ''), 10);
        const normalizedSalary = Number.isFinite(expectedSalaryNum)
            ? `₹${expectedSalaryNum.toLocaleString('en-IN')}`
            : String(hydrated?.expectedSalary || '').trim();
        const normalizedExperience = Number.isFinite(Number(hydrated?.experienceYears))
            ? Number(hydrated.experienceYears)
            : 0;
        const normalizedCommuteDistance = normalizeCommuteDistance(hydrated?.maxCommuteDistanceKm);
        const normalizedMinimumMatchTier = normalizeMatchTier(hydrated?.minimumMatchTier);
        const normalizedAvailabilityWindowDays = normalizeAvailabilityWindowDays(hydrated?.availabilityWindowDays);
        const normalizedPreferredShift = normalizeWorkerShift(hydrated?.preferredShift);

        return {
            ...hydrated,
            name: fullName,
            roleTitle: String(hydrated?.roleTitle || '').trim(),
            skills: parseSkills(hydrated?.skills),
            experienceYears: normalizedExperience,
            expectedSalary: normalizedSalary,
            panchayat: String(hydrated?.panchayat || '').trim(),
            language: normalizeLanguageText(hydrated?.language, userInfo?.languageCode),
            maxCommuteDistanceKm: normalizedCommuteDistance,
            minimumMatchTier: normalizedMinimumMatchTier,
            preferredShift: normalizedPreferredShift,
            availabilityWindowDays: normalizedAvailabilityWindowDays,
            isAvailable: normalizeBooleanFlag(hydrated?.isAvailable, true),
            openToRelocation: normalizeBooleanFlag(hydrated?.openToRelocation, false),
            openToNightShift: normalizeBooleanFlag(hydrated?.openToNightShift, false),
            location: String(hydrated?.location || '').trim(),
            summary: String(hydrated?.summary || '').trim(),
        };
    }, [hydrateExtractedData, isEmployer, parseSkills, userInfo?.languageCode, userInfo?.name]);

    const getMissingMandatoryFields = useCallback((candidateData = {}) => {
        if (isEmployer) {
            const salaryValue = parseCurrencyNumber(candidateData?.salaryRange);
            const required = [
                { label: 'Job title', present: Boolean(String(candidateData?.jobTitle || '').trim()) },
                { label: 'Company name', present: Boolean(String(candidateData?.companyName || '').trim()) },
                { label: 'Required skills', present: Array.isArray(candidateData?.requiredSkills) && candidateData.requiredSkills.length > 0 },
                { label: 'Salary range', present: salaryValue > 0 },
                { label: 'Location', present: Boolean(String(candidateData?.location || '').trim()) },
            ];
            return required.filter((item) => !item.present).map((item) => item.label);
        }

        const salaryValue = parseCurrencyNumber(candidateData?.expectedSalary);
        const experienceYears = Number(candidateData?.experienceYears || 0);
        const required = [
            { label: 'Full name', present: Boolean(String(candidateData?.name || '').trim()) },
            { label: 'Role', present: Boolean(String(candidateData?.roleTitle || '').trim()) },
            { label: 'Skills', present: Array.isArray(candidateData?.skills) && candidateData.skills.length > 0 },
            { label: 'Expected salary', present: salaryValue > 0 },
            { label: 'Experience', present: Number.isFinite(experienceYears) && experienceYears > 0 },
            { label: 'Location', present: Boolean(String(candidateData?.location || '').trim()) },
        ];
        return required.filter((item) => !item.present).map((item) => item.label);
    }, [isEmployer, parseCurrencyNumber]);

    const handleImproveProfile = useCallback(() => {
        if (!extractedData) return;
        const slotDerived = mapSlotStateToExtractedData(slotState || {});
        const optimized = optimizeExtractedData({ ...slotDerived, ...(extractedData || {}) });
        setExtractedData(optimized);
        const missingFields = getMissingMandatoryFields(optimized);

        triggerHaptic.light();
        if (missingFields.length > 0) {
            Alert.alert('Improve Profile', `Please confirm: ${missingFields.join(', ')}.`);
            return;
        }

        Alert.alert('Profile Optimized', 'AI profile details are now refined and ready for matchmaking.');
    }, [extractedData, getMissingMandatoryFields, mapSlotStateToExtractedData, optimizeExtractedData, slotState]);

    const clarificationConfig = useMemo(() => {
        if (!clarificationField) return null;
        const baseConfig = clarificationFieldMap[clarificationField] || null;
        if (!baseConfig) return null;
        const hint = clarificationHints?.[clarificationField] || null;
        if (!hint?.question) return baseConfig;
        return {
            ...baseConfig,
            question: String(hint.question),
        };
    }, [clarificationField, clarificationHints]);

    const handleClarificationResolve = useCallback(async (value) => {
        if (!processingId || !clarificationField || clarificationSubmitting) return;
        setClarificationSubmitting(true);

        try {
            const { data } = await client.post(`/api/v2/interview-processing/${processingId}/clarification`, {
                overrideField: clarificationField,
                value,
            }, {
                __skipApiErrorHandler: true,
            });
            clearClarificationTimers();
            setClarificationVisible(false);
            setShowThinkingIndicator(false);
            setUiPaused(true);

            clarificationResumeTimerRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                applyHybridPayload(data);
            }, 200);

            triggerHaptic.success();
            trackEvent('clarificationResolved', {
                clarificationFieldName: clarificationField,
                processingId: String(processingId),
            });
        } catch (error) {
            Alert.alert('Update Failed', 'Could not apply clarification. Please try again.');
        } finally {
            setClarificationSubmitting(false);
        }
    }, [applyHybridPayload, clarificationField, clarificationSubmitting, clearClarificationTimers, processingId]);

    const handleClarificationSkip = useCallback(async () => {
        if (!processingId || !clarificationField || clarificationSubmitting) return;
        setClarificationSubmitting(true);

        try {
            const { data } = await client.post(`/api/v2/interview-processing/${processingId}/clarification`, {
                overrideField: clarificationField,
                skip: true,
            }, {
                __skipApiErrorHandler: true,
            });
            clearClarificationTimers();
            setClarificationVisible(false);
            setShowThinkingIndicator(false);
            setUiPaused(true);

            clarificationResumeTimerRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                applyHybridPayload(data);
            }, 200);

            trackEvent('clarificationSkipped', {
                clarificationFieldName: clarificationField,
                processingId: String(processingId),
                queuedLatencyMs: clarificationQueuedAt ? Date.now() - clarificationQueuedAt : null,
            });
        } catch (error) {
            Alert.alert('Skip Failed', 'Could not skip clarification right now.');
        } finally {
            setClarificationSubmitting(false);
        }
    }, [
        applyHybridPayload,
        clarificationField,
        clarificationQueuedAt,
        clarificationSubmitting,
        clearClarificationTimers,
        processingId,
    ]);

    const handleConfirmSave = useCallback(async () => {
        if (!extractedData || savingProfile) return;
        setSavingProfile(true);

        try {
            const slotDerived = mapSlotStateToExtractedData(slotState || {});
            const optimizedData = optimizeExtractedData({
                ...slotDerived,
                ...(extractedData || {}),
            });
            setExtractedData(optimizedData);

            const missingMandatoryFields = getMissingMandatoryFields(optimizedData);
            if (missingMandatoryFields.length > 0) {
                triggerHaptic.error();
                Alert.alert(
                    'Complete Required Details',
                    `Please fill these fields before starting matchmaking: ${missingMandatoryFields.join(', ')}.`
                );
                return;
            }

            if (isEmployer) {
                await client.put('/api/users/profile', {
                    companyName: optimizedData.companyName || userInfo?.name || '',
                    location: optimizedData.location || '',
                    industry: optimizedData.jobTitle || '',
                    processingId,
                }, {
                    __skipApiErrorHandler: true,
                });

                const jobPayload = {
                    title: optimizedData.jobTitle || '',
                    companyName: optimizedData.companyName || userInfo?.name || '',
                    salaryRange: optimizedData.salaryRange || '',
                    location: optimizedData.location || '',
                    requirements: parseSkills(optimizedData.requiredSkills),
                    shift: optimizedData.shift || 'flexible',
                    description: optimizedData.description || '',
                    processingId,
                };

                let finalJobId = createdJobId;
                if (finalJobId) {
                    await client.put(`/api/jobs/${finalJobId}`, {
                        ...jobPayload,
                        status: 'active',
                    }, {
                        __skipApiErrorHandler: true,
                    });
                } else {
                    const { data: createdJobResponse } = await client.post('/api/jobs', jobPayload, {
                        __skipApiErrorHandler: true,
                    });
                    const createdId = createdJobResponse?._id
                        || createdJobResponse?.data?._id
                        || createdJobResponse?.job?._id;
                    if (createdId) {
                        finalJobId = String(createdId);
                        setCreatedJobId(finalJobId);
                    }
                }

                if (finalJobId) {
                    await maybeShowBoostUpsell(finalJobId);
                }
            } else {
                const fullName = String(optimizedData.name || userInfo?.name || '').trim();
                const [firstName = '', ...rest] = fullName.split(' ').filter(Boolean);
                const lastName = rest.join(' ');
                const expectedSalaryNum = Number.parseInt(String(optimizedData.expectedSalary || '').replace(/[^0-9]/g, ''), 10);
                const experienceYears = Number.isFinite(Number(optimizedData.experienceYears))
                    ? Number(optimizedData.experienceYears)
                    : 0;
                const maxCommuteDistanceKm = normalizeCommuteDistance(optimizedData.maxCommuteDistanceKm);
                const minimumMatchTier = normalizeMatchTier(optimizedData.minimumMatchTier);
                const availabilityWindowDays = normalizeAvailabilityWindowDays(optimizedData.availabilityWindowDays);
                const preferredShift = normalizeWorkerShift(optimizedData.preferredShift);

                await client.put('/api/users/profile', {
                    firstName,
                    lastName,
                    city: String(optimizedData.location || '').trim(),
                    panchayat: String(optimizedData.panchayat || '').trim(),
                    language: normalizeLanguageText(optimizedData.language, userInfo?.languageCode),
                    totalExperience: experienceYears,
                    preferredShift,
                    availabilityWindowDays,
                    isAvailable: normalizeBooleanFlag(optimizedData.isAvailable, true),
                    openToRelocation: Boolean(optimizedData.openToRelocation),
                    openToNightShift: Boolean(optimizedData.openToNightShift),
                    matchPreferences: {
                        maxCommuteDistanceKm,
                        minimumMatchTier,
                    },
                    roleProfiles: [{
                        roleName: optimizedData.roleTitle || '',
                        experienceInRole: experienceYears,
                        expectedSalary: Number.isFinite(expectedSalaryNum) ? expectedSalaryNum : 0,
                        skills: parseSkills(optimizedData.skills),
                        lastUpdated: new Date(),
                    }],
                    processingId,
                }, {
                    __skipApiErrorHandler: true,
                });
            }

            await updateUserInfo?.({
                hasCompletedProfile: true,
            });
            await completeOnboarding?.();
            triggerHaptic.success();
            setStage(STAGES.COMPLETE);
        } catch (error) {
            logger.error('Smart interview confirm failed:', error?.message || error);
            Alert.alert('Save Failed', 'Could not save your profile data. Please try again.');
        } finally {
            setSavingProfile(false);
        }
    }, [completeOnboarding, createdJobId, extractedData, getMissingMandatoryFields, isEmployer, mapSlotStateToExtractedData, maybeShowBoostUpsell, optimizeExtractedData, parseSkills, processingId, savingProfile, slotState, updateUserInfo, userInfo]);

    const navigateToProfileLanding = useCallback(() => {
        const targetTab = isEmployer ? 'Talent' : 'Profiles';
        navigation.reset({
            index: 0,
            routes: [{
                name: 'MainTab',
                state: {
                    index: 0,
                    routes: [{ name: targetTab }],
                },
            }],
        });
    }, [isEmployer, navigation]);

    useEffect(() => {
        stageRef.current = stage;
    }, [stage]);

    useEffect(() => {
        uiPausedRef.current = uiPaused;
    }, [uiPaused]);

    useEffect(() => {
        recordingFinalizingRef.current = recordingFinalizing;
    }, [recordingFinalizing]);

    useEffect(() => {
        activeClarificationFieldRef.current = clarificationVisible ? clarificationField : null;
    }, [clarificationField, clarificationVisible]);

    useEffect(() => {
        Animated.timing(thinkingOpacityAnim, {
            toValue: showThinkingIndicator ? 1 : 0,
            duration: 180,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
        }).start();
    }, [showThinkingIndicator, thinkingOpacityAnim]);

    useEffect(() => {
        const shouldScaleDown = clarificationVisible || showThinkingIndicator;
        Animated.timing(sceneScaleAnim, {
            toValue: shouldScaleDown ? 0.98 : 1,
            duration: 240,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
        }).start();
    }, [clarificationVisible, sceneScaleAnim, showThinkingIndicator]);

    useEffect(() => {
        if (stage !== STAGES.REVIEW && stage !== STAGES.COMPLETE) {
            reviewBadgePulse.stopAnimation();
            reviewBadgePulse.setValue(1);
            return;
        }

        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(reviewBadgePulse, {
                    toValue: 1.06,
                    duration: 420,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(reviewBadgePulse, {
                    toValue: 1,
                    duration: 420,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [reviewBadgePulse, stage]);

    useEffect(() => {
        Animated.timing(successOpacity, {
            toValue: stage === STAGES.COMPLETE ? 1 : 0,
            duration: 220,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
        }).start();
    }, [stage, successOpacity]);

    useEffect(() => {
        if (stage !== STAGES.COMPLETE) {
            completionAlertShownRef.current = false;
            if (completionNavigationTimerRef.current) {
                clearTimeout(completionNavigationTimerRef.current);
                completionNavigationTimerRef.current = null;
            }
            return;
        }

        if (completionAlertShownRef.current) return;
        completionNavigationTimerRef.current = setTimeout(() => {
            if (!mountedRef.current || completionAlertShownRef.current) return;
            completionAlertShownRef.current = true;
            navigateToProfileLanding();
        }, 1500);
    }, [navigateToProfileLanding, stage]);

    useEffect(() => {
        if (!recordingRequested) return;
        if (stage !== STAGES.RECORDING) return;
        if (!cameraReady) return;
        if (!cameraRef.current) return;
        if (isRecording) return;

        setRecordingRequested(false);
        startRecordingInternal();
    }, [cameraReady, isRecording, recordingRequested, stage, startRecordingInternal]);

    useEffect(() => {
        if (stage !== STAGES.UPLOADING && stage !== STAGES.PROCESSING) {
            processingStageStartedAtRef.current = 0;
            setProcessingElapsedSeconds(0);
            if (processingElapsedTimerRef.current) {
                clearInterval(processingElapsedTimerRef.current);
                processingElapsedTimerRef.current = null;
            }
            return;
        }

        if (!processingStageStartedAtRef.current) {
            processingStageStartedAtRef.current = Date.now();
        }
        setProcessingElapsedSeconds(
            Math.max(0, Math.floor((Date.now() - Number(processingStageStartedAtRef.current || Date.now())) / 1000))
        );

        if (processingElapsedTimerRef.current) {
            clearInterval(processingElapsedTimerRef.current);
            processingElapsedTimerRef.current = null;
        }

        processingElapsedTimerRef.current = setInterval(() => {
            if (!mountedRef.current) return;
            setProcessingElapsedSeconds(
                Math.max(0, Math.floor((Date.now() - Number(processingStageStartedAtRef.current || Date.now())) / 1000))
            );
        }, 1000);

        return () => {
            if (processingElapsedTimerRef.current) {
                clearInterval(processingElapsedTimerRef.current);
                processingElapsedTimerRef.current = null;
            }
        };
    }, [stage]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            recordingDiscardRef.current = true;
            clearTimer();
            stopStatusTracking();
            clearClarificationTimers();
            stopLiveSpeechRecognition();
            resetLiveSessionState({ preserveSttAvailability: false });
            if (completionNavigationTimerRef.current) {
                clearTimeout(completionNavigationTimerRef.current);
                completionNavigationTimerRef.current = null;
            }
            if (cameraRef.current && isRecording) {
                cameraRef.current.stopRecording();
            }
        };
    }, [
        clearClarificationTimers,
        clearTimer,
        isRecording,
        resetLiveSessionState,
        stopLiveSpeechRecognition,
        stopStatusTracking,
    ]);

    useEffect(() => {
        if (!SMART_INTERVIEW_LIVE_ENABLED) return;
        requestCameraPermission();
        requestMicrophonePermission();
    }, [requestCameraPermission, requestMicrophonePermission]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            const wasBackground = appStateRef.current.match(/inactive|background/);
            if (wasBackground && nextState === 'active' && processingId && stage === STAGES.PROCESSING) {
                checkProcessingStatus();
            }
            if (wasBackground && nextState === 'active' && stageRef.current === STAGES.COMPLETE) {
                setShowBoostUpsell(false);
            }
            appStateRef.current = nextState;
        });

        return () => {
            subscription.remove();
        };
    }, [checkProcessingStatus, processingId, stage]);

    useEffect(() => {
        const incomingProcessingId = route?.params?.processingId;
        if (!incomingProcessingId) return;
        if (String(incomingProcessingId) === String(processingId)) return;

        processingIdRef.current = incomingProcessingId;
        setProcessingId(incomingProcessingId);
        setStage(STAGES.PROCESSING);
        beginHybridStatusTracking();
    }, [beginHybridStatusTracking, processingId, route?.params?.processingId]);

    const clarificationSheetNode = (
        <InterviewClarificationSheet
            visible={clarificationVisible && Boolean(clarificationConfig)}
            fieldName={clarificationField}
            fieldConfig={clarificationConfig}
            contextText={clarificationContextText}
            submitting={clarificationSubmitting}
            onResolve={handleClarificationResolve}
            onSkip={handleClarificationSkip}
        />
    );

    if (!SMART_INTERVIEW_LIVE_ENABLED) {
        return (
            <>
                <LinearGradient colors={['#120526', '#2b0a47', '#5b21b6']} style={[styles.container, { paddingTop: insets.top + 8 }]}>
                    <TouchableOpacity style={styles.backButton} onPress={safeGoBack}>
                        <Text style={styles.backButtonText}>‹</Text>
                    </TouchableOpacity>

                    <ScrollView
                        style={styles.introScroll}
                        contentContainerStyle={styles.introExperienceWrap}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        <View style={styles.interviewHeroShell}>
                            <View style={styles.comingSoonBadge}>
                                <Ionicons name="sparkles-outline" size={14} color="#efe4ff" />
                                <Text style={styles.comingSoonBadgeText}>Interview AI</Text>
                            </View>
                            <Text style={styles.heroBrandTitle}>HIRE Interview AI</Text>
                            <Text style={styles.heroTagline}>This feature is coming soon. Quick Form is active for now.</Text>
                        </View>

                        <View style={styles.comingSoonNoticeCard}>
                            <Text style={styles.comingSoonNoticeTitle}>What will happen when it launches</Text>
                            <Text style={styles.comingSoonNoticeText}>
                                You will record once, AI will structure your profile, and matchmaking quality will improve automatically.
                            </Text>
                        </View>

                        <View style={styles.comingSoonStepStack}>
                            {SMART_INTERVIEW_WALKTHROUGH.map((slide, idx) => (
                                <View key={slide.key} style={styles.comingSoonStepCard}>
                                    <View style={styles.comingSoonStepHeader}>
                                        <View style={styles.comingSoonStepIndex}>
                                            <Text style={styles.comingSoonStepIndexText}>{idx + 1}</Text>
                                        </View>
                                        <View style={styles.comingSoonStepCopy}>
                                            <Text style={styles.comingSoonStepTitle}>{slide.title}</Text>
                                            <Text style={styles.comingSoonStepText}>{slide.subtitle}</Text>
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </View>

                        <TouchableOpacity
                            style={[styles.primaryButton, styles.introPrimaryButton, styles.comingSoonPrimaryButton]}
                            onPress={safeGoBack}
                            activeOpacity={0.86}
                        >
                            <Text style={styles.primaryButtonText}>Got It</Text>
                        </TouchableOpacity>

                        <View style={styles.trustPill}>
                            <Ionicons name="information-circle-outline" size={13} color="#dbeafe" />
                            <Text style={styles.trustPillText}>Use Quick Form in Profile tab until Interview AI goes live.</Text>
                        </View>
                    </ScrollView>
                </LinearGradient>
                {clarificationSheetNode}
            </>
        );
    }

    if (!cameraPermission || !microphonePermission) {
        return (
            <>
                <View style={styles.loaderContainer}>
                    <SkeletonLoader width={56} height={56} borderRadius={28} tone="tint" />
                </View>
                {clarificationSheetNode}
            </>
        );
    }

    if (!cameraPermission.granted || !microphonePermission.granted) {
        return (
            <>
                <View style={styles.permissionContainer}>
                    <Text style={styles.permissionTitle}>Camera Access Needed</Text>
                    <Text style={styles.permissionText}>Smart Interview requires camera and microphone access.</Text>
                    <TouchableOpacity style={styles.primaryButton} onPress={() => {
                        requestCameraPermission();
                        requestMicrophonePermission();
                    }}>
                        <Text style={styles.primaryButtonText}>Grant Permissions</Text>
                    </TouchableOpacity>
                </View>
                {clarificationSheetNode}
            </>
        );
    }

    if (stage === STAGES.INTRO) {
        return (
            <>
                <LinearGradient colors={['#120526', '#2b0a47', '#5b21b6']} style={[styles.container, { paddingTop: insets.top + 8 }]}>
                    <TouchableOpacity style={styles.backButton} onPress={safeGoBack}>
                        <Text style={styles.backButtonText}>‹</Text>
                    </TouchableOpacity>

                    <ScrollView
                        style={styles.introScroll}
                        contentContainerStyle={styles.introExperienceWrap}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        <LinearGradient colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)']} style={styles.previewPhoneFrame}>
                            <View style={styles.previewFaceGlow} />
                            <View style={styles.previewFocusFrame} />
                            <View style={styles.previewWaveformRow}>
                                {[12, 20, 15, 24, 14, 19, 13].map((h, idx) => (
                                    <View key={`intro-wave-${idx}`} style={[styles.previewWaveBar, { height: h }]} />
                                ))}
                            </View>
                            <View style={styles.previewControlsRow}>
                                <View style={[styles.previewCtrl, styles.previewCtrlWhite]}>
                                    <Ionicons name="camera-reverse-outline" size={18} color="#0f172a" />
                                </View>
                                <View style={styles.previewCtrl}>
                                    <Ionicons name="checkmark" size={18} color="#ffffff" />
                                </View>
                                <View style={styles.previewCtrl}>
                                    <Ionicons name="pause" size={18} color="#ffffff" />
                                </View>
                                <View style={[styles.previewCtrl, styles.previewCtrlDanger]}>
                                    <Ionicons name="close" size={20} color="#ffffff" />
                                </View>
                            </View>
                        </LinearGradient>

                        <View style={styles.interviewHeroShell}>
                            <Text style={styles.heroBrandTitle}>HIRE Interview AI</Text>
                            <Text style={styles.heroTagline}>Natural conversation. Structured profile instantly.</Text>

                            <View style={styles.introSlideTracker}>
                                {SMART_INTERVIEW_WALKTHROUGH.map((slide, idx) => (
                                    <View
                                        key={slide.key}
                                        style={[styles.introSlideDot, idx === introSlideIndex && styles.introSlideDotActive]}
                                    />
                                ))}
                            </View>
                        </View>

                        <View style={styles.introCard}>
                            <Text style={styles.introCardStepLabel}>
                                Step {introSlideIndex + 1} of {SMART_INTERVIEW_WALKTHROUGH.length}
                            </Text>
                            <Text style={styles.introCardTitle}>{introSlide.title}</Text>
                            <Text style={styles.introCardText}>{introSlide.subtitle}</Text>
                            <View style={styles.introBulletStack}>
                                {introSlide.bullets.map((bullet) => (
                                    <View key={bullet} style={styles.introBulletRow}>
                                        <Ionicons name="checkmark-circle" size={14} color="#d8b4fe" />
                                        <Text style={styles.introBulletText}>{bullet}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        <View style={styles.introActionsRow}>
                            <TouchableOpacity style={styles.introGhostButton} onPress={handleSkipIntro} activeOpacity={0.82}>
                                <Text style={styles.introGhostButtonText}>Skip</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.primaryButton, styles.introPrimaryButton]}
                                onPress={handleNextIntro}
                                activeOpacity={0.86}
                            >
                                <Text style={styles.primaryButtonText}>{isLastIntroSlide ? 'Start Interview' : 'Next'}</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.trustPill}>
                            <Ionicons name="shield-checkmark-outline" size={13} color="#dbeafe" />
                            <Text style={styles.trustPillText}>Your interview data stays secure</Text>
                        </View>
                    </ScrollView>
                </LinearGradient>
                {clarificationSheetNode}
            </>
        );
    }

    if (stage === STAGES.REVIEW) {
        return (
            <>
                <View style={[styles.reviewContainer, { paddingTop: insets.top + 12 }]}> 
                    <ScrollView contentContainerStyle={styles.reviewScroll} showsVerticalScrollIndicator={false}>
                    <View style={styles.reviewTitleRow}>
                        <Text style={styles.reviewHeaderTitle}>Review Your Profile</Text>
                        <Animated.View style={[styles.aiBadge, { transform: [{ scale: reviewBadgePulse }] }]}>
                            <Text style={styles.aiBadgeText}>AI Structured</Text>
                        </Animated.View>
                    </View>
                    <Text style={styles.headerSubtitle}>AI extracted this from your interview. Edit before saving.</Text>
                    {extractionWarning ? (
                        <View style={styles.extractionWarningCard}>
                            <Ionicons name="alert-circle-outline" size={14} color="#fca5a5" />
                            <Text style={styles.extractionWarningText}>{extractionWarning}</Text>
                        </View>
                    ) : null}

                    <View style={styles.profileQualityRow}>
                        <View style={styles.profileQualityRing}>
                            <Text style={styles.profileQualityRingValue}>
                                {Math.round(Math.max(0, Math.min(1, profileQualityScore)) * 100)}%
                            </Text>
                            <Text style={styles.profileQualityRingMeta}>Quality</Text>
                        </View>
                        <View style={styles.profileQualitySummary}>
                            <Text style={styles.profileQualityTitle}>Verified Profile</Text>
                            <Text style={styles.profileQualitySubtext}>
                                Completion {Math.round(Math.max(0, Math.min(1, slotCompletenessRatio)) * 100)}% • Clarity {Math.round(Math.max(0, Math.min(1, communicationClarityScore)) * 100)}%
                            </Text>
                            <TouchableOpacity
                                style={styles.improveProfileCta}
                                onPress={handleImproveProfile}
                                activeOpacity={0.84}
                            >
                                <Text style={styles.improveProfileCtaText}>Improve Profile</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.strengthCard}>
                        <Text style={styles.strengthCardTitle}>Highlighted strengths</Text>
                        {(highlightedStrengths.length ? highlightedStrengths : ['Core profile fields captured']).map((item, index) => (
                            <Text key={`strength-${index}`} style={styles.strengthCardItem}>• {item}</Text>
                        ))}
                    </View>

                    <View style={[styles.salaryIndicatorCard, salaryOutlierFlag && styles.salaryIndicatorCardWarn]}>
                        <Text style={styles.salaryIndicatorTitle}>Salary realism</Text>
                        <Text style={styles.salaryIndicatorText}>
                            {salaryOutlierFlag
                                ? 'Higher than typical local range. Please confirm for better-quality matches.'
                                : 'Aligned with local role trends.'}
                        </Text>
                        {salaryOutlierFlag && Number.isFinite(Number(salaryMedianForRoleCity)) ? (
                            <Text style={styles.salaryIndicatorMeta}>
                                Median baseline: ₹{Math.round(Number(salaryMedianForRoleCity)).toLocaleString('en-IN')}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.reviewSnapshotRow}>
                        <View style={styles.reviewSnapshotCard}>
                            <Text style={styles.reviewSnapshotLabel}>Location</Text>
                            <Text style={styles.reviewSnapshotValue}>
                                {isEmployer
                                    ? String(extractedData?.location || 'No data extracted')
                                    : String(extractedData?.location || 'No data extracted')}
                            </Text>
                        </View>
                        <View style={styles.reviewSnapshotCard}>
                            <Text style={styles.reviewSnapshotLabel}>Salary</Text>
                            <Text style={styles.reviewSnapshotValue}>
                                {isEmployer
                                    ? String(extractedData?.salaryRange || 'No data extracted')
                                    : String(extractedData?.expectedSalary || 'No data extracted')}
                            </Text>
                        </View>
                    </View>

                    {lowConfidenceFields.length > 0 ? (
                        <View style={styles.lowConfidenceCard}>
                            <Text style={styles.lowConfidenceTitle}>Needs confirmation</Text>
                            <Text style={styles.lowConfidenceText}>
                                {lowConfidenceFields
                                    .map((field) => field.replace(/([A-Z])/g, ' $1'))
                                    .map((field) => field.charAt(0).toUpperCase() + field.slice(1))
                                    .join(', ')}
                            </Text>
                        </View>
                    ) : null}

                    <View style={styles.videoPreviewCard}>
                        <Text style={styles.videoPreviewLabel}>Recorded Video</Text>
                        <Text style={styles.videoPreviewValue}>{videoUri ? 'Ready' : 'Not available'}</Text>
                    </View>

                    <View style={styles.reviewCard}>
                        {isEmployer ? (
                            <>
                                <Text style={styles.reviewLabel}>Job Title</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.jobTitle || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), jobTitle: value }))}
                                />

                                <Text style={styles.reviewLabel}>Company Name</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.companyName || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), companyName: value }))}
                                />

                                <Text style={styles.reviewLabel}>Required Skills</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={Array.isArray(extractedData?.requiredSkills) ? extractedData.requiredSkills.join(', ') : String(extractedData?.requiredSkills || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), requiredSkills: value.split(',').map((item) => item.trim()).filter(Boolean) }))}
                                />

                                <Text style={styles.reviewLabel}>Salary Range</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.salaryRange || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), salaryRange: value }))}
                                />

                                <Text style={styles.reviewLabel}>Location</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.location || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), location: value }))}
                                />
                            </>
                        ) : (
                            <>
                                <Text style={styles.reviewSectionTitle}>Match basics</Text>
                                <Text style={styles.reviewFieldHint}>
                                    These fields directly shape role, salary, and AP-locality matching.
                                </Text>

                                <Text style={styles.reviewLabel}>Name</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.name || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), name: value }))}
                                />

                                <Text style={styles.reviewLabel}>Role</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.roleTitle || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), roleTitle: value }))}
                                />

                                <Text style={styles.reviewLabel}>Skills</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={Array.isArray(extractedData?.skills) ? extractedData.skills.join(', ') : String(extractedData?.skills || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), skills: value.split(',').map((item) => item.trim()).filter(Boolean) }))}
                                />

                                <Text style={styles.reviewLabel}>Experience (years)</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    keyboardType="numeric"
                                    value={String(extractedData?.experienceYears ?? '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), experienceYears: value }))}
                                />

                                <Text style={styles.reviewLabel}>Expected monthly pay</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    keyboardType="numeric"
                                    value={String(extractedData?.expectedSalary || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), expectedSalary: value }))}
                                />

                                <Text style={styles.reviewLabel}>City</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.location || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), location: value }))}
                                />

                                <Text style={styles.reviewLabel}>Local area / panchayat</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.panchayat || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), panchayat: value }))}
                                />

                                <Text style={styles.reviewLabel}>Primary language</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.language || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), language: value }))}
                                />

                                <Text style={styles.reviewSectionTitle}>Match preferences</Text>
                                <Text style={styles.reviewFieldHint}>
                                    We use these settings to decide nearby commute range, strictness, and availability.
                                </Text>

                                <Text style={styles.reviewLabel}>Preferred shift</Text>
                                <View style={styles.reviewChipRow}>
                                    {REVIEW_SHIFT_OPTIONS.map((option) => {
                                        const active = normalizeWorkerShift(extractedData?.preferredShift) === option;
                                        return (
                                            <TouchableOpacity
                                                key={`review-shift-${option}`}
                                                style={[styles.reviewChip, active ? styles.reviewChipActive : null]}
                                                onPress={() => setExtractedData((prev) => ({ ...(prev || {}), preferredShift: option }))}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={[styles.reviewChipText, active ? styles.reviewChipTextActive : null]}>
                                                    {option}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                <Text style={styles.reviewLabel}>Max travel distance</Text>
                                <View style={styles.reviewChipRow}>
                                    {REVIEW_COMMUTE_DISTANCE_OPTIONS.map((distance) => {
                                        const active = normalizeCommuteDistance(extractedData?.maxCommuteDistanceKm) === distance;
                                        return (
                                            <TouchableOpacity
                                                key={`review-commute-${distance}`}
                                                style={[styles.reviewChip, active ? styles.reviewChipActive : null]}
                                                onPress={() => setExtractedData((prev) => ({ ...(prev || {}), maxCommuteDistanceKm: distance }))}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={[styles.reviewChipText, active ? styles.reviewChipTextActive : null]}>
                                                    {distance} km
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                <Text style={styles.reviewLabel}>Match strictness</Text>
                                <View style={styles.reviewChipRow}>
                                    {REVIEW_MATCH_TIER_OPTIONS.map((option) => {
                                        const active = normalizeMatchTier(extractedData?.minimumMatchTier) === option.value;
                                        return (
                                            <TouchableOpacity
                                                key={`review-tier-${option.value}`}
                                                style={[styles.reviewChip, active ? styles.reviewChipActive : null]}
                                                onPress={() => setExtractedData((prev) => ({ ...(prev || {}), minimumMatchTier: option.value }))}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={[styles.reviewChipText, active ? styles.reviewChipTextActive : null]}>
                                                    {option.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                <Text style={styles.reviewLabel}>Joining window</Text>
                                <View style={styles.reviewChipRow}>
                                    {REVIEW_AVAILABILITY_OPTIONS.map((option) => {
                                        const active = normalizeAvailabilityWindowDays(extractedData?.availabilityWindowDays) === option.value;
                                        return (
                                            <TouchableOpacity
                                                key={`review-availability-${option.value}`}
                                                style={[styles.reviewChip, active ? styles.reviewChipActive : null]}
                                                onPress={() => setExtractedData((prev) => ({ ...(prev || {}), availabilityWindowDays: option.value }))}
                                                activeOpacity={0.82}
                                            >
                                                <Text style={[styles.reviewChipText, active ? styles.reviewChipTextActive : null]}>
                                                    {option.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                <View style={styles.reviewToggleRow}>
                                    <Text style={styles.reviewToggleLabel}>Open to opportunities</Text>
                                    <Switch
                                        value={normalizeBooleanFlag(extractedData?.isAvailable, true)}
                                        onValueChange={(value) => setExtractedData((prev) => ({ ...(prev || {}), isAvailable: value }))}
                                    />
                                </View>

                                <View style={styles.reviewToggleRow}>
                                    <Text style={styles.reviewToggleLabel}>Open to relocation</Text>
                                    <Switch
                                        value={Boolean(extractedData?.openToRelocation)}
                                        onValueChange={(value) => setExtractedData((prev) => ({ ...(prev || {}), openToRelocation: value }))}
                                    />
                                </View>

                                <View style={styles.reviewToggleRow}>
                                    <Text style={styles.reviewToggleLabel}>Open to night shift</Text>
                                    <Switch
                                        value={Boolean(extractedData?.openToNightShift)}
                                        onValueChange={(value) => setExtractedData((prev) => ({ ...(prev || {}), openToNightShift: value }))}
                                    />
                                </View>
                            </>
                        )}
                    </View>

                    <View style={styles.reviewActionRow}>
                        <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={handleRetakeInterview}
                            disabled={savingProfile}
                        >
                            <Text style={styles.secondaryButtonText}>Retake</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.primaryButton, styles.reviewPrimaryAction, savingProfile && styles.primaryButtonDisabled]}
                            onPress={handleConfirmSave}
                            disabled={savingProfile}
                        >
                            {savingProfile
                                ? <SkeletonLoader width={20} height={20} borderRadius={10} tone="tint" />
                                : <Text style={styles.primaryButtonText}>Start Matchmaking</Text>}
                        </TouchableOpacity>
                    </View>

                    <View style={styles.trustBadgeCard}>
                        <Text style={styles.trustBadgeTitle}>Visibility Boost</Text>
                        <Text style={styles.trustBadgeText}>Completing this interview improves your visibility by 3x.</Text>
                    </View>
                    </ScrollView>
                </View>
                {clarificationSheetNode}
            </>
        );
    }

    if (stage === STAGES.COMPLETE) {
        return (
            <>
                <LinearGradient colors={['#041026', '#0c2c57']} style={[styles.container, { paddingTop: insets.top + 24 }]}> 
                    <Animated.View style={[styles.centeredContent, { opacity: successOpacity }]}>
                    <Text style={styles.successEmoji}>✓</Text>
                    <Text style={styles.headerTitle}>Your Smart Profile Is Live</Text>
                    <Text style={styles.headerSubtitle}>
                        {isEmployer
                            ? 'Your job post is live and indexed for candidate matching.'
                            : 'Your profile is live and ready for role-based matching.'}
                    </Text>

                    <View style={styles.completionTrustCard}>
                        <Text style={styles.completionTrustTitle}>What happens next</Text>
                        <Text style={styles.completionTrustText}>
                            {isEmployer
                                ? 'Your job is now posted, and candidate buckets are synced in Talent for immediate review.'
                                : 'Your profile is now posted in Profiles, and personalized job matches are ranked in Find Work.'}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={navigateToProfileLanding}
                    >
                        <Text style={styles.primaryButtonText}>{isEmployer ? 'Open Talent' : 'Open Profiles'}</Text>
                    </TouchableOpacity>

                    {!isEmployer && (
                        <View style={styles.workerNudgeCard}>
                            <Text style={styles.workerNudgeTitle}>Your latest matches are now synced in Find Work.</Text>
                            <Text style={styles.workerNudgeText}>We prioritized opportunities based on your verified interview profile.</Text>
                        </View>
                    )}

                </Animated.View>
                <Modal
                    visible={isEmployer && showBoostUpsell}
                    transparent
                    animationType="fade"
                    onRequestClose={dismissBoostUpsell}
                >
                    <View style={styles.upsellModalBackdrop}>
                        <View style={styles.upsellModalCard}>
                            <Text style={styles.upsellTitle}>Boost this job to reach 3x more candidates</Text>
                            <Text style={styles.upsellText}>One-tap boost for ₹499. Higher visibility in city feed.</Text>
                            <View style={styles.upsellActions}>
                                <TouchableOpacity style={styles.upsellSecondaryButton} onPress={dismissBoostUpsell}>
                                    <Text style={styles.upsellSecondaryText}>Maybe Later</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.upsellPrimaryButton} onPress={handleBoostPurchase}>
                                    <Text style={styles.upsellPrimaryText}>Boost Job</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
                </LinearGradient>
                {clarificationSheetNode}
            </>
        );
    }

    return (
        <>
            <Animated.View style={[styles.cameraContainer, { transform: [{ scale: sceneScaleAnim }] }]}>
                <CameraView
                    style={styles.cameraView}
                    facing={facing}
                    mode="video"
                    ref={cameraRef}
                    onCameraReady={() => setCameraReady(true)}
                >
                    <LinearGradient colors={['rgba(3,10,24,0.62)', 'rgba(3,10,24,0.12)', 'rgba(3,10,24,0.9)']} style={styles.overlay}> 
                    <View style={[styles.topHeader, { paddingTop: insets.top + 8 }]}> 
                        <Text style={styles.headerTitleSmall}>Smart Interview</Text>
                        <Text style={styles.headerSubtitleSmall}>{statusSubtitle}</Text>
                    </View>

                    <View style={styles.middleArea}>
                        {(stage === STAGES.UPLOADING || stage === STAGES.PROCESSING) ? (
                            <View style={styles.processingCard}>
                                <SkeletonLoader width={48} height={48} borderRadius={24} tone="tint" />
                                <Text style={styles.processingTitle}>{PROCESSING_MESSAGES[processingMessageIndex]}</Text>
                                <Text style={styles.processingSubtext}>
                                    {processingFallbackMessage
                                        ? processingFallbackMessage
                                        : 'Please keep the app open for faster completion.'}
                                </Text>
                                <Text style={styles.processingElapsedText}>
                                    Elapsed: {Math.floor(processingElapsedSeconds / 60)}m {String(processingElapsedSeconds % 60).padStart(2, '0')}s
                                </Text>
                                <View style={styles.processingTrustList}>
                                    {PROCESSING_TRUST_STEPS.map((item, index) => {
                                        const isCompleted = index < processingPhaseIndex;
                                        const isActive = index === processingPhaseIndex;
                                        return (
                                            <View key={item.key} style={styles.processingTrustRow}>
                                                <Ionicons
                                                    name={isCompleted ? 'checkmark-circle' : (isActive ? 'radio-button-on' : 'ellipse-outline')}
                                                    size={15}
                                                    color={isCompleted || isActive ? '#93c5fd' : '#94a3b8'}
                                                />
                                                <Text
                                                    style={[
                                                        styles.processingTrustText,
                                                        isActive && styles.processingTrustTextActive,
                                                    ]}
                                                >
                                                    {item.label}
                                                </Text>
                                            </View>
                                        );
                                    })}
                                </View>
                                <View style={styles.processingShimmerStack}>
                                    <SkeletonLoader width="82%" height={8} borderRadius={4} tone="tint" />
                                    <SkeletonLoader width="64%" height={8} borderRadius={4} tone="tint" />
                                </View>
                                {stage === STAGES.PROCESSING && (processingFallbackMessage || processingElapsedSeconds >= 20) ? (
                                    <>
                                        <TouchableOpacity
                                            style={styles.processingFallbackButton}
                                            onPress={checkProcessingStatus}
                                            activeOpacity={0.84}
                                        >
                                            <Text style={styles.processingFallbackButtonText}>Retry status sync</Text>
                                        </TouchableOpacity>
                                        {processingFallbackMessage ? (
                                            <TouchableOpacity
                                                style={[styles.processingFallbackButton, styles.processingFallbackButtonSecondary]}
                                                onPress={handleRetakeInterview}
                                                activeOpacity={0.84}
                                            >
                                                <Text style={[styles.processingFallbackButtonText, styles.processingFallbackButtonSecondaryText]}>
                                                    Record again
                                                </Text>
                                            </TouchableOpacity>
                                        ) : null}
                                    </>
                                ) : null}
                                {stage === STAGES.UPLOADING ? (
                                    <Text style={styles.uploadProgressText}>{Math.max(0, Math.min(100, uploadProgress))}% uploaded</Text>
                                ) : null}
                            </View>
                        ) : stage === STAGES.RECORDING ? (
                            <View style={styles.recordingFocusWrap}>
                                <View style={styles.recordingGuideFrameOuter} />
                                <View style={styles.recordingGuideFrameInner} />
                                <View style={styles.recordingFocusPulse} />
                                <View style={styles.recordingGuideCenterDot} />
                            </View>
                        ) : (
                            <View style={styles.centerGlowRing} />
                        )}
                    </View>

                    <View style={[styles.bottomControls, { paddingBottom: insets.bottom + 18 }]}> 
                        {stage === STAGES.RECORDING && (
                            <>
                                {activeInterviewPrompt && (
                                    <View style={styles.adaptivePromptCard}>
                                        <Text style={styles.adaptivePromptLabel}>Current question</Text>
                                        <Text style={styles.adaptivePromptText}>{activeInterviewPrompt}</Text>
                                    </View>
                                )}

                                {showThinkingIndicator && (
                                    <Animated.View style={[styles.thinkingIndicatorWrap, { opacity: thinkingOpacityAnim }]}>
                                        <Text style={styles.thinkingIndicatorText}>Analyzing your response…</Text>
                                    </Animated.View>
                                )}

                                <View style={styles.recordingStatusRow}>
                                    <View style={styles.liveBadge}>
                                        <View style={[styles.liveBadgeDot, { backgroundColor: liveBadgeDotColor }]} />
                                        <Text style={styles.liveBadgeText}>{liveBadgeLabel}</Text>
                                    </View>
                                    <View style={styles.timerPillLive}>
                                        <Text style={styles.timerText}>{formatTimer(timer)}</Text>
                                    </View>
                                </View>
                                <View style={styles.stepProgressRow}>
                                    <Text style={styles.stepProgressText}>
                                        Step {displayStep} / {normalizedMaxSteps}
                                    </Text>
                                    <Text style={styles.stepProgressMeta}>
                                        {completionPercent}% complete
                                    </Text>
                                </View>
                                <Text style={[
                                    styles.liveProgressModeText,
                                    liveSemanticProgressActive
                                        ? styles.liveProgressModeTextLive
                                        : styles.liveProgressModeTextFallback,
                                ]}>
                                    {liveProgressStatusText}
                                </Text>

                                {liveTranscriptPreview ? (
                                    <Text style={styles.liveTranscriptPreviewText} numberOfLines={2}>
                                        Heard: {truncateSnippet(liveTranscriptPreview)}
                                    </Text>
                                ) : null}

                                <View style={styles.waveformRowLive}>
                                    {[9, 15, 22, 14, 20, 12, 18, 11].map((base, idx) => (
                                        <View
                                            key={`live-wave-${idx}`}
                                            style={[
                                                styles.waveBar,
                                                styles.waveBarLive,
                                                { height: base + ((timer + idx) % 3) * 2 },
                                            ]}
                                        />
                                    ))}
                                </View>

                                <View style={styles.recordingActionsRowLive}>
                                    <TouchableOpacity
                                        style={[
                                            styles.liveCircleButton,
                                            styles.liveCircleButtonWhite,
                                            recordingFinalizing && styles.liveCircleButtonDisabled,
                                        ]}
                                        onPress={() => setFacing((prev) => (prev === 'front' ? 'back' : 'front'))}
                                        activeOpacity={0.86}
                                        disabled={recordingFinalizing}
                                    >
                                        <Ionicons name="camera-reverse-outline" size={20} color="#0f172a" />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.liveCircleButton,
                                            styles.liveCirclePrimary,
                                            recordingFinalizing && styles.liveCircleButtonDisabled,
                                        ]}
                                        onPress={stopRecording}
                                        activeOpacity={0.86}
                                        disabled={recordingFinalizing}
                                    >
                                        <Ionicons name="checkmark" size={22} color="#ffffff" />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[styles.liveCircleButton, recordingFinalizing && styles.liveCircleButtonDisabled]}
                                        onPress={toggleUiPause}
                                        activeOpacity={0.86}
                                        disabled={recordingFinalizing}
                                    >
                                        <Ionicons name={uiPaused ? 'play' : 'pause'} size={20} color="#ffffff" />
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.liveCircleButton,
                                            styles.liveCircleDanger,
                                            recordingFinalizing && styles.liveCircleButtonDisabled,
                                        ]}
                                        onPress={cancelRecording}
                                        activeOpacity={0.86}
                                        disabled={recordingFinalizing}
                                    >
                                        <Ionicons name="close" size={22} color="#ffffff" />
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}

                        {(stage === STAGES.UPLOADING || stage === STAGES.PROCESSING) && (
                            <TouchableOpacity style={styles.exitButton} onPress={safeGoBack}>
                                <Text style={styles.exitButtonText}>Leave Screen</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                    </LinearGradient>
                </CameraView>
            </Animated.View>
            {clarificationSheetNode}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#140829',
    },
    loaderContainer: {
        flex: 1,
        backgroundColor: '#140829',
        alignItems: 'center',
        justifyContent: 'center',
    },
    centeredContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
    },
    backButton: {
        width: 42,
        height: 42,
        borderRadius: 21,
        marginLeft: 16,
        marginTop: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(233,213,255,0.3)',
    },
    backButtonText: {
        color: '#f8f5ff',
        fontSize: 26,
        marginTop: -2,
    },
    headerTitle: {
        color: '#fff',
        fontSize: 32,
        fontWeight: '700',
        textAlign: 'center',
    },
    headerSubtitle: {
        color: '#cbd5e1',
        marginTop: 10,
        fontSize: 15,
        fontWeight: '500',
        textAlign: 'center',
        maxWidth: 320,
    },
    extractionWarningCard: {
        marginTop: 12,
        marginBottom: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(252,165,165,0.4)',
        backgroundColor: 'rgba(127,29,29,0.35)',
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    extractionWarningText: {
        marginLeft: 8,
        color: '#fecaca',
        fontSize: 12,
        lineHeight: 17,
        flex: 1,
    },
    introExperienceWrap: {
        flexGrow: 1,
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingHorizontal: 22,
        paddingBottom: 26,
    },
    introScroll: {
        flex: 1,
    },
    previewPhoneFrame: {
        width: '100%',
        maxWidth: 360,
        minHeight: 420,
        borderRadius: 28,
        borderWidth: 1.4,
        borderColor: 'rgba(233,213,255,0.7)',
        overflow: 'hidden',
        marginTop: 8,
        marginBottom: 20,
        backgroundColor: 'rgba(29,13,56,0.56)',
    },
    previewFaceGlow: {
        position: 'absolute',
        top: -40,
        left: -20,
        right: -20,
        height: 280,
        backgroundColor: 'rgba(216,180,254,0.28)',
        borderBottomLeftRadius: 180,
        borderBottomRightRadius: 180,
    },
    previewFocusFrame: {
        position: 'absolute',
        top: 68,
        left: 26,
        right: 26,
        bottom: 88,
        borderRadius: 26,
        borderWidth: 1.6,
        borderColor: 'rgba(233,213,255,0.72)',
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    previewWaveformRow: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 78,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    previewWaveBar: {
        width: 4,
        borderRadius: 4,
        marginHorizontal: 2,
        backgroundColor: 'rgba(233,213,255,0.92)',
    },
    previewControlsRow: {
        marginTop: 'auto',
        marginBottom: 14,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
    },
    previewCtrl: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: 'rgba(23,10,42,0.86)',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 4,
        borderWidth: 1,
        borderColor: 'rgba(233,213,255,0.26)',
    },
    previewCtrlWhite: {
        backgroundColor: '#ffffff',
    },
    previewCtrlDanger: {
        backgroundColor: '#dc2626',
    },
    interviewHeroShell: {
        width: '100%',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(233,213,255,0.3)',
        backgroundColor: 'rgba(30,13,56,0.36)',
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 14,
        alignItems: 'center',
    },
    heroBrandTitle: {
        color: '#ffffff',
        fontSize: 34,
        fontWeight: '800',
        letterSpacing: -0.6,
        marginBottom: 4,
        textAlign: 'center',
    },
    heroTagline: {
        color: '#ece6ff',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 2,
    },
    comingSoonBadge: {
        alignSelf: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.55)',
        backgroundColor: 'rgba(109,40,217,0.35)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    comingSoonBadgeText: {
        color: '#efe4ff',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    comingSoonNoticeCard: {
        width: '100%',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.35)',
        backgroundColor: 'rgba(30,13,56,0.4)',
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 12,
    },
    comingSoonNoticeTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 4,
    },
    comingSoonNoticeText: {
        color: '#ede9fe',
        fontSize: 12,
        lineHeight: 18,
    },
    comingSoonStepStack: {
        width: '100%',
        gap: 10,
    },
    comingSoonStepCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.26)',
        backgroundColor: 'rgba(30,13,56,0.32)',
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    comingSoonStepHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    comingSoonStepIndex: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(216,180,254,0.3)',
        borderWidth: 1,
        borderColor: 'rgba(233,213,255,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
        marginTop: 1,
    },
    comingSoonStepIndexText: {
        color: '#f3e8ff',
        fontSize: 12,
        fontWeight: '800',
    },
    comingSoonStepCopy: {
        flex: 1,
    },
    comingSoonStepLabel: {
        color: '#d8b4fe',
        fontSize: 10,
        fontWeight: '700',
        textTransform: 'uppercase',
        marginBottom: 4,
        letterSpacing: 0.4,
    },
    comingSoonStepTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 3,
    },
    comingSoonStepText: {
        color: '#ede9fe',
        fontSize: 12,
        lineHeight: 17,
    },
    comingSoonPrimaryButton: {
        width: '100%',
        marginTop: 14,
    },
    introSlideTracker: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
    },
    introSlideDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        marginHorizontal: 4,
        backgroundColor: 'rgba(233,213,255,0.34)',
    },
    introSlideDotActive: {
        width: 18,
        backgroundColor: '#d8b4fe',
    },
    introCard: {
        width: '100%',
        backgroundColor: 'rgba(30,13,56,0.34)',
        borderRadius: 20,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.28)',
    },
    introCardStepLabel: {
        color: '#d8b4fe',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 6,
    },
    introCardTitle: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 16,
        marginBottom: 6,
    },
    introCardText: {
        color: '#ede9fe',
        fontSize: 14,
        lineHeight: 20,
    },
    introBulletStack: {
        marginTop: 10,
        gap: 8,
    },
    introBulletRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    introBulletText: {
        color: '#f3e8ff',
        fontSize: 12,
        lineHeight: 18,
        marginLeft: 8,
        flex: 1,
    },
    introActionsRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    introGhostButton: {
        minWidth: 84,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.52)',
        backgroundColor: 'rgba(109,40,217,0.22)',
        paddingHorizontal: 14,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    introGhostButtonText: {
        color: '#f3e8ff',
        fontSize: 14,
        fontWeight: '700',
    },
    introPrimaryButton: {
        flex: 1,
    },
    trustPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(216,180,254,0.34)',
        backgroundColor: 'rgba(109,40,217,0.2)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginTop: 12,
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
    trustPillText: {
        color: '#f3e8ff',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 6,
    },
    reviewActionRow: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    secondaryButton: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        backgroundColor: '#f8fafc',
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryButtonText: {
        color: '#334155',
        fontWeight: '700',
        fontSize: 16,
    },
    primaryButton: {
        width: '100%',
        backgroundColor: '#7c3aed',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#6d28d9',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 12,
        elevation: 6,
    },
    reviewPrimaryAction: {
        flex: 2,
        width: 'auto',
    },
    primaryButtonDisabled: {
        opacity: 0.7,
    },
    primaryButtonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
    },
    permissionContainer: {
        flex: 1,
        backgroundColor: '#0b1220',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    permissionTitle: {
        color: '#fff',
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 10,
    },
    permissionText: {
        color: '#cbd5e1',
        textAlign: 'center',
        marginBottom: 24,
    },
    cameraContainer: {
        flex: 1,
        backgroundColor: '#000',
    },
    cameraView: {
        flex: 1,
    },
    overlay: {
        flex: 1,
        justifyContent: 'space-between',
    },
    topHeader: {
        alignItems: 'center',
    },
    headerTitleSmall: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
    },
    headerSubtitleSmall: {
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: '500',
        marginTop: 4,
    },
    middleArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 22,
    },
    recordingFocusWrap: {
        width: '100%',
        height: width * 0.72,
        alignItems: 'center',
        justifyContent: 'center',
    },
    recordingGuideFrameOuter: {
        width: width * 0.64,
        height: width * 0.86,
        borderRadius: 34,
        borderWidth: 1.4,
        borderColor: 'rgba(219,234,254,0.74)',
        backgroundColor: 'rgba(255,255,255,0.015)',
    },
    recordingGuideFrameInner: {
        position: 'absolute',
        width: width * 0.57,
        height: width * 0.79,
        borderRadius: 30,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.35)',
    },
    centerGlowRing: {
        width: width * 0.46,
        height: width * 0.46,
        borderRadius: (width * 0.46) / 2,
        borderWidth: 1.8,
        borderColor: 'rgba(66,133,244,0.7)',
        backgroundColor: 'rgba(66,133,244,0.14)',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.24,
        shadowRadius: 18,
    },
    recordingFocusPulse: {
        position: 'absolute',
        width: width * 0.7,
        height: width * 0.7,
        borderRadius: (width * 0.7) / 2,
        borderWidth: 1.2,
        borderColor: 'rgba(147,197,253,0.22)',
        backgroundColor: 'transparent',
    },
    recordingGuideCenterDot: {
        position: 'absolute',
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(147,197,253,0.8)',
        shadowColor: '#60a5fa',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.45,
        shadowRadius: 8,
    },
    processingCard: {
        width: '100%',
        backgroundColor: 'rgba(8,15,30,0.92)',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'rgba(66,133,244,0.34)',
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
    },
    processingTitle: {
        marginTop: 14,
        color: '#fff',
        fontWeight: '700',
        fontSize: 16,
        textAlign: 'center',
    },
    processingSubtext: {
        marginTop: 10,
        color: '#cbd5e1',
        fontSize: 13,
        textAlign: 'center',
    },
    processingElapsedText: {
        marginTop: 6,
        color: '#93c5fd',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    processingTrustList: {
        width: '100%',
        marginTop: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.18)',
        backgroundColor: 'rgba(15,23,42,0.42)',
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    processingTrustRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 2,
    },
    processingTrustText: {
        marginLeft: 8,
        color: '#94a3b8',
        fontSize: 11,
        fontWeight: '500',
    },
    processingTrustTextActive: {
        color: '#dbeafe',
        fontWeight: '600',
    },
    processingShimmerStack: {
        width: '100%',
        alignItems: 'center',
        marginTop: 10,
        marginBottom: 2,
    },
    uploadProgressText: {
        marginTop: 10,
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
    },
    processingFallbackButton: {
        marginTop: 12,
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: 'rgba(30,64,175,0.85)',
        borderWidth: 1,
        borderColor: 'rgba(191,219,254,0.45)',
    },
    processingFallbackButtonSecondary: {
        backgroundColor: 'rgba(15,23,42,0.8)',
        borderColor: 'rgba(148,163,184,0.35)',
    },
    processingFallbackButtonText: {
        color: '#eff6ff',
        fontSize: 13,
        fontWeight: '700',
        textAlign: 'center',
    },
    processingFallbackButtonSecondaryText: {
        color: '#e2e8f0',
    },
    bottomControls: {
        paddingHorizontal: 18,
    },
    adaptivePromptCard: {
        width: '100%',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(125, 211, 252, 0.28)',
        backgroundColor: 'rgba(2, 6, 23, 0.62)',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 10,
    },
    adaptivePromptLabel: {
        color: '#bae6fd',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    adaptivePromptText: {
        color: '#f8fafc',
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
    },
    thinkingIndicatorWrap: {
        alignSelf: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(147,197,253,0.26)',
        backgroundColor: 'rgba(2,6,23,0.52)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginBottom: 10,
    },
    thinkingIndicatorText: {
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    stepProgressRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        paddingHorizontal: 4,
    },
    stepProgressText: {
        color: '#e2e8f0',
        fontSize: 12,
        fontWeight: '700',
    },
    stepProgressMeta: {
        color: '#93c5fd',
        fontSize: 11,
        fontWeight: '600',
    },
    liveProgressModeText: {
        width: '100%',
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 8,
        paddingHorizontal: 4,
    },
    liveProgressModeTextLive: {
        color: '#bbf7d0',
    },
    liveProgressModeTextFallback: {
        color: '#fcd34d',
    },
    liveTranscriptPreviewText: {
        width: '100%',
        color: '#dbeafe',
        fontSize: 11,
        lineHeight: 16,
        marginBottom: 8,
        paddingHorizontal: 4,
    },
    recordingStatusRow: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    liveBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 999,
        backgroundColor: 'rgba(3,10,24,0.62)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.26)',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    liveBadgeDot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#ef4444',
        marginRight: 6,
    },
    liveBadgeText: {
        color: '#e5e7eb',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.4,
    },
    timerPill: {
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.72)',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginBottom: 14,
    },
    timerPillLive: {
        backgroundColor: 'rgba(3,10,24,0.62)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.26)',
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 7,
    },
    timerText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 12,
    },
    waveformRow: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 18,
    },
    waveformRowLive: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginBottom: 12,
        backgroundColor: 'rgba(3,10,24,0.42)',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.22)',
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    waveBar: {
        width: 6,
        borderRadius: 4,
        marginHorizontal: 2,
        backgroundColor: '#84a9ff',
    },
    waveBarLive: {
        width: 5,
        marginHorizontal: 1.8,
        backgroundColor: '#c7d2fe',
    },
    recordingActionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        marginBottom: 2,
    },
    livePromptBubble: {
        alignSelf: 'center',
        width: '92%',
        borderRadius: 14,
        backgroundColor: 'rgba(5,11,20,0.85)',
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 14,
    },
    livePromptText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '500',
        textAlign: 'center',
    },
    recordingActionsRowLive: {
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        backgroundColor: 'rgba(3,10,24,0.62)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.26)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    liveCircleButton: {
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(15,23,42,0.82)',
        marginHorizontal: 4,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.22)',
    },
    liveCircleButtonWhite: {
        backgroundColor: '#ffffff',
        borderColor: 'rgba(255,255,255,0.55)',
    },
    liveCirclePrimary: {
        backgroundColor: '#1d4ed8',
        borderColor: '#2563eb',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.24,
        shadowRadius: 8,
    },
    liveCircleDanger: {
        backgroundColor: '#de4f4f',
        borderColor: 'rgba(255,255,255,0.28)',
    },
    liveCircleButtonDisabled: {
        opacity: 0.45,
    },
    smallCircleButton: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.58)',
    },
    smallCircleButtonText: {
        color: '#fff',
        fontSize: 22,
        fontWeight: '500',
    },
    stopButton: {
        width: 92,
        height: 92,
        borderRadius: 46,
        backgroundColor: '#b45359',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#b45359',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 8,
    },
    stopButtonInner: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: '#fff',
    },
    exitButton: {
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.58)',
        borderRadius: 999,
        paddingHorizontal: 18,
        paddingVertical: 10,
    },
    exitButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
    reviewContainer: {
        flex: 1,
        backgroundColor: '#0a1324',
    },
    reviewScroll: {
        paddingHorizontal: 20,
        paddingBottom: 30,
    },
    reviewTitleRow: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    reviewHeaderTitle: {
        color: '#ffffff',
        fontSize: 32,
        fontWeight: '700',
        letterSpacing: -0.3,
        flex: 1,
    },
    aiBadge: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.34)',
        backgroundColor: 'rgba(148,163,184,0.14)',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    aiBadgeText: {
        color: '#dbeafe',
        fontSize: 11,
        fontWeight: '600',
    },
    profileQualityRow: {
        marginTop: 14,
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#1f2937',
        backgroundColor: '#111827',
        padding: 14,
    },
    profileQualityRing: {
        width: 88,
        height: 88,
        borderRadius: 44,
        borderWidth: 2,
        borderColor: '#3b82f6',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0f172a',
    },
    profileQualityRingValue: {
        color: '#ffffff',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: -0.3,
    },
    profileQualityRingMeta: {
        color: '#93c5fd',
        fontSize: 11,
        fontWeight: '600',
        marginTop: 2,
    },
    profileQualitySummary: {
        flex: 1,
        marginLeft: 14,
    },
    profileQualityTitle: {
        color: '#f8fafc',
        fontSize: 17,
        fontWeight: '700',
    },
    profileQualitySubtext: {
        marginTop: 5,
        color: '#cbd5e1',
        fontSize: 12,
        lineHeight: 18,
    },
    improveProfileCta: {
        marginTop: 10,
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(59,130,246,0.5)',
        backgroundColor: 'rgba(37,99,235,0.14)',
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    improveProfileCtaText: {
        color: '#bfdbfe',
        fontSize: 12,
        fontWeight: '700',
    },
    strengthCard: {
        marginBottom: 12,
        backgroundColor: '#111827',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#1f2937',
        padding: 14,
    },
    strengthCardTitle: {
        color: '#f8fafc',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 7,
    },
    strengthCardItem: {
        color: '#cbd5e1',
        fontSize: 13,
        lineHeight: 19,
        marginBottom: 3,
    },
    salaryIndicatorCard: {
        marginBottom: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(16,185,129,0.3)',
        backgroundColor: 'rgba(16,185,129,0.08)',
        padding: 14,
    },
    salaryIndicatorCardWarn: {
        borderColor: 'rgba(245,158,11,0.4)',
        backgroundColor: 'rgba(245,158,11,0.12)',
    },
    salaryIndicatorTitle: {
        color: '#f8fafc',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 4,
    },
    salaryIndicatorText: {
        color: '#e2e8f0',
        fontSize: 13,
        lineHeight: 19,
    },
    salaryIndicatorMeta: {
        marginTop: 6,
        color: '#fde68a',
        fontSize: 12,
        fontWeight: '600',
    },
    reviewSnapshotRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 12,
    },
    reviewSnapshotCard: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#2b3442',
        backgroundColor: '#111827',
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    reviewSnapshotLabel: {
        color: '#94a3b8',
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 5,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    reviewSnapshotValue: {
        color: '#f8fafc',
        fontSize: 13,
        fontWeight: '600',
    },
    lowConfidenceCard: {
        marginBottom: 12,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(244,114,182,0.34)',
        backgroundColor: 'rgba(190,24,93,0.12)',
        padding: 14,
    },
    lowConfidenceTitle: {
        color: '#fbcfe8',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 4,
    },
    lowConfidenceText: {
        color: '#fce7f3',
        fontSize: 12,
        lineHeight: 18,
    },
    videoPreviewCard: {
        marginTop: 18,
        marginBottom: 12,
        backgroundColor: '#111827',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#1f2937',
        padding: 14,
    },
    videoPreviewLabel: {
        color: '#94a3b8',
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 6,
    },
    videoPreviewValue: {
        color: '#e2e8f0',
        fontSize: 15,
        fontWeight: '700',
    },
    confidenceCard: {
        backgroundColor: '#111827',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#1f2937',
        padding: 14,
        marginBottom: 12,
    },
    confidenceLabel: {
        color: '#94a3b8',
        fontSize: 12,
        fontWeight: '600',
    },
    confidenceBarTrack: {
        marginTop: 8,
        height: 8,
        borderRadius: 8,
        backgroundColor: '#1f2937',
        overflow: 'hidden',
    },
    confidenceBarFill: {
        height: '100%',
        backgroundColor: '#0f9d67',
    },
    confidenceValue: {
        marginTop: 6,
        color: '#e2e8f0',
        fontWeight: '700',
    },
    reviewCard: {
        backgroundColor: '#111827',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#1f2937',
        padding: 16,
        marginBottom: 16,
    },
    reviewSectionTitle: {
        color: '#f8fafc',
        fontSize: 14,
        fontWeight: '800',
        marginTop: 8,
        marginBottom: 6,
    },
    reviewFieldHint: {
        color: '#94a3b8',
        fontSize: 12,
        lineHeight: 18,
        marginBottom: 6,
    },
    reviewLabel: {
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 6,
        marginTop: 8,
    },
    reviewInput: {
        backgroundColor: '#0f172a',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#334155',
        color: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
    },
    reviewChipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 4,
    },
    reviewChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#334155',
        backgroundColor: '#0f172a',
        paddingHorizontal: 12,
        paddingVertical: 9,
    },
    reviewChipActive: {
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.14)',
    },
    reviewChipText: {
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: '700',
    },
    reviewChipTextActive: {
        color: '#dcfce7',
    },
    reviewToggleRow: {
        marginTop: 8,
        paddingVertical: 6,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
    },
    reviewToggleLabel: {
        flex: 1,
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: '600',
    },
    trustBadgeCard: {
        marginTop: 12,
        backgroundColor: 'rgba(15,157,103,0.16)',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(15,157,103,0.34)',
        padding: 14,
    },
    trustBadgeTitle: {
        color: '#86efac',
        fontSize: 13,
        fontWeight: '700',
    },
    trustBadgeText: {
        marginTop: 4,
        color: '#dcfce7',
        fontSize: 13,
    },
    completionTrustCard: {
        marginTop: 14,
        marginBottom: 12,
        width: '100%',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.38)',
        backgroundColor: 'rgba(15,23,42,0.55)',
        padding: 14,
    },
    completionTrustTitle: {
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: '700',
        marginBottom: 4,
    },
    completionTrustText: {
        color: '#cbd5e1',
        fontSize: 12,
        lineHeight: 17,
    },
    workerNudgeCard: {
        marginTop: 14,
        width: '100%',
        borderRadius: 14,
        backgroundColor: 'rgba(29,78,216,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.34)',
        padding: 14,
    },
    workerNudgeTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    workerNudgeText: {
        marginTop: 6,
        color: '#cbd5e1',
        fontSize: 12,
        lineHeight: 17,
    },
    upsellModalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.58)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    upsellModalCard: {
        width: '100%',
        borderRadius: 16,
        backgroundColor: '#111827',
        borderWidth: 1,
        borderColor: '#1f2937',
        padding: 16,
    },
    upsellTitle: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
    upsellText: {
        marginTop: 6,
        color: '#cbd5e1',
        fontSize: 12,
        lineHeight: 17,
    },
    upsellActions: {
        marginTop: 10,
        flexDirection: 'row',
        gap: 10,
    },
    upsellSecondaryButton: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#334155',
        paddingVertical: 10,
        alignItems: 'center',
    },
    upsellSecondaryText: {
        color: '#e2e8f0',
        fontWeight: '600',
        fontSize: 12,
    },
    upsellPrimaryButton: {
        flex: 1,
        borderRadius: 12,
        backgroundColor: '#1d4ed8',
        paddingVertical: 10,
        alignItems: 'center',
    },
    upsellPrimaryText: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 12,
    },
    successEmoji: {
        color: '#0f9d67',
        fontSize: 64,
        fontWeight: '700',
        marginBottom: 12,
    },
});
