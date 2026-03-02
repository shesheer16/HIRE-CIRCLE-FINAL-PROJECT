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
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
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

const PROCESSING_MESSAGES = [
    'Transcribing your video...',
    'Understanding your skills...',
    'Building your profile...',
    'Optimizing your match quality...',
];

const MAX_RECORD_DURATION_SECONDS = 90;
const HYBRID_POLL_WINDOW_MS = 30 * 1000;
const POLL_INTERVAL_MS = 5 * 1000;
const PROCESSING_NOTICE_TIMEOUT_MS = 2 * 60 * 1000;
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
        preferredShift: 'flexible',
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
    const [waitingForPush, setWaitingForPush] = useState(false);
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
    const [adaptiveQuestion, setAdaptiveQuestion] = useState(null);
    const [interviewStep, setInterviewStep] = useState(0);
    const [maxSteps, setMaxSteps] = useState(8);
    const [profileQualityScore, setProfileQualityScore] = useState(0);
    const [slotCompletenessRatio, setSlotCompletenessRatio] = useState(0);
    const [communicationClarityScore, setCommunicationClarityScore] = useState(0);
    const [salaryOutlierFlag, setSalaryOutlierFlag] = useState(false);
    const [salaryMedianForRoleCity, setSalaryMedianForRoleCity] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [savingProfile, setSavingProfile] = useState(false);

    const safeGoBack = useCallback(() => {
        if (isRecording) {
            Alert.alert('Stop Recording?', 'Your current recording will be lost.', [
                { text: 'Continue Recording', style: 'cancel' },
                {
                    text: 'Stop & Exit',
                    style: 'destructive',
                    onPress: () => {
                        if (cameraRef.current) {
                            cameraRef.current.stopRecording();
                        }
                        setIsRecording(false);
                        clearTimer();
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
    }, [clearTimer, isRecording, navigation]);

    const cameraRef = useRef(null);
    const timerRef = useRef(null);
    const pollingRef = useRef(null);
    const pollingStartedAtRef = useRef(0);
    const processingTimeoutRef = useRef(null);
    const processingNoticeShownRef = useRef(false);
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
    const clarificationEventKeyRef = useRef('');
    const lastStateSignatureRef = useRef('');
    const lastStateChangeAtRef = useRef(0);
    const lastHybridPayloadRef = useRef(null);
    const stagnationFallbackShownRef = useRef(false);
    const reviewBadgePulseRef = useRef(new Animated.Value(1));
    const successOpacityRef = useRef(new Animated.Value(0));
    const completionNavigationTimerRef = useRef(null);
    const completionAlertShownRef = useRef(false);

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

    const sceneScaleAnim = sceneScaleAnimRef.current;
    const thinkingOpacityAnim = thinkingOpacityAnimRef.current;
    const reviewBadgePulse = reviewBadgePulseRef.current;
    const successOpacity = successOpacityRef.current;

    const truncateSnippet = useCallback((text) => {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        const maxLen = 72;
        if (normalized.length <= maxLen) return normalized;
        return `${normalized.slice(0, maxLen - 1)}…`;
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
        if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
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
            preferredShift: slots.shiftPreference || 'flexible',
            location: slots.city || '',
            summary: '',
        };
    }, [isEmployer, userInfo?.name]);

    const finalizeToReview = useCallback((data = {}) => {
        stopStatusTracking();
        setWaitingForPush(false);
        setShowThinkingIndicator(false);
        setClarificationVisible(false);
        setClarificationField(null);
        setClarificationContextText('');
        setUiPaused(false);

        const slotDerived = mapSlotStateToExtractedData(data?.slotState || {});
        const merged = hydrateExtractedData(data?.extractedData || slotDerived);
        setExtractedData(merged);
        setCreatedJobId(data?.createdJobId || null);
        setStage(STAGES.REVIEW);
        successOpacity.setValue(0);
        triggerHaptic.success();
    }, [hydrateExtractedData, mapSlotStateToExtractedData, stopStatusTracking, successOpacity]);

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
            const { data } = await client.post(`/api/jobs/${jobId}/boost-upsell-exposure`);
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
            const { data } = await client.post('/api/payment/create-featured-listing', { jobId: upsellJobId });
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
        setProfileQualityScore(Number(data?.profileQualityScore || 0));
        setSlotCompletenessRatio(Number(data?.slotCompletenessRatio || 0));
        setCommunicationClarityScore(Number(data?.communicationClarityScore || 0));
        setSalaryOutlierFlag(Boolean(data?.salaryOutlierFlag));
        setSalaryMedianForRoleCity(data?.salaryMedianForRoleCity ?? null);
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
    }, [clearClarificationTimers, presentClarificationForField]);

    const checkProcessingStatus = useCallback(async (id) => {
        if (!id || statusRequestInFlightRef.current) return;
        statusRequestInFlightRef.current = true;

        try {
            const { data } = await client.get(`/api/v2/interview-processing/${id}`);
            if (!mountedRef.current) return;

            const status = String(data?.status || '').toLowerCase();
            applyHybridPayload(data);

            if (Boolean(data?.interviewComplete)) {
                finalizeToReview(data);
                return;
            }

            if (status === 'completed') {
                finalizeToReview(data);
                return;
            }

            if (status === 'failed') {
                stopStatusTracking();
                setWaitingForPush(false);
                triggerHaptic.error();
                Alert.alert('Processing Failed', data?.errorMessage || 'Could not process your interview. Please record again.');
                setStage(STAGES.INTRO);
                return;
            }

            setStage(STAGES.PROCESSING);
        } catch (error) {
            logger.warn('Interview status check failed:', error?.message || error);
        } finally {
            statusRequestInFlightRef.current = false;
        }
    }, [applyHybridPayload, finalizeToReview, stopStatusTracking]);

    const beginHybridStatusTracking = useCallback((id) => {
        stopStatusTracking();
        setWaitingForPush(false);
        setProcessingFallbackMessage(null);
        processingNoticeShownRef.current = false;
        pollingStartedAtRef.current = Date.now();
        lastStateChangeAtRef.current = Date.now();
        lastStateSignatureRef.current = '';
        lastHybridPayloadRef.current = null;
        stagnationFallbackShownRef.current = false;

        checkProcessingStatus(id);

        pollingRef.current = setInterval(() => {
            const elapsed = Date.now() - pollingStartedAtRef.current;
            const stagnantMs = Date.now() - Number(lastStateChangeAtRef.current || 0);

            if (
                stagnantMs >= PROCESSING_STAGNATION_TIMEOUT_MS
                && !stagnationFallbackShownRef.current
                && stageRef.current === STAGES.PROCESSING
            ) {
                stagnationFallbackShownRef.current = true;
                setProcessingFallbackMessage('Still syncing your latest response. Finalizing with current details...');

                const fallbackPayload = lastHybridPayloadRef.current;
                if (fallbackPayload?.slotState && Object.keys(fallbackPayload.slotState).length > 0) {
                    finalizeToReview({
                        ...fallbackPayload,
                        interviewComplete: true,
                    });
                    return;
                }
            }

            if (elapsed >= HYBRID_POLL_WINDOW_MS) {
                if (pollingRef.current) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                }
                setWaitingForPush(true);
                return;
            }
            checkProcessingStatus(id);
        }, POLL_INTERVAL_MS);

        processingTimeoutRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            if (processingNoticeShownRef.current) return;
            if (stageRef.current !== STAGES.PROCESSING && stageRef.current !== STAGES.UPLOADING) return;

            processingNoticeShownRef.current = true;
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }
            setWaitingForPush(true);
            Alert.alert(
                'Still Processing',
                'Your interview is still processing. We’ll notify you when it’s ready.'
            );
        }, PROCESSING_NOTICE_TIMEOUT_MS);
    }, [checkProcessingStatus, finalizeToReview, stopStatusTracking]);

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
                timeout: 20000,
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
                setProcessingId(data.processingId);
                setStage(STAGES.PROCESSING);
                beginHybridStatusTracking(data.processingId);
                return;
            }

            if (data?.extractedData) {
                setExtractedData(data.extractedData);
                if (data?.job?._id) {
                    setCreatedJobId(String(data.job._id));
                }
                setStage(STAGES.REVIEW);
                return;
            }

            throw new Error('Unexpected upload response.');
        } catch (error) {
            triggerHaptic.error();
            Alert.alert(
                'Upload Failed',
                error?.response?.data?.error || error?.message || 'Could not upload interview video. Please try again.'
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
        setUiPaused(false);
        setTimer(0);
        triggerHaptic.medium();

        timerRef.current = setInterval(() => {
            if (!uiPausedRef.current) {
                setTimer((prev) => prev + 1);
            }
        }, 1000);

        try {
            const recordingResult = await cameraRef.current.recordAsync({
                maxDuration: MAX_RECORD_DURATION_SECONDS,
            });

            if (!mountedRef.current) return;

            clearTimer();
            setIsRecording(false);

            if (recordingResult?.uri) {
                setVideoUri(recordingResult.uri);
                await uploadForAsyncProcessing(recordingResult.uri);
            } else {
                setStage(STAGES.INTRO);
            }
        } catch (error) {
            clearTimer();
            setIsRecording(false);
            if (!mountedRef.current) return;
            logger.error('Recording failed:', error?.message || error);
            Alert.alert('Recording Failed', 'Could not record video. Please try again.');
            setStage(STAGES.INTRO);
        }
    }, [clearTimer, isRecording, uploadForAsyncProcessing]);

    const handleBeginInterview = useCallback(() => {
        setCameraReady(false);
        setRecordingRequested(true);
        setStage(STAGES.RECORDING);
        triggerHaptic.medium();
    }, []);

    const stopRecording = useCallback(() => {
        if (cameraRef.current && isRecording) {
            triggerHaptic.light();
            cameraRef.current.stopRecording();
        }
    }, [isRecording]);

    const cancelRecording = useCallback(() => {
        if (isRecording && cameraRef.current) {
            cameraRef.current.stopRecording();
        }
        clearTimer();
        setIsRecording(false);
        setTimer(0);
        setStage(STAGES.INTRO);
    }, [clearTimer, isRecording]);

    const handleRetakeInterview = useCallback(() => {
        if (isRecording && cameraRef.current) {
            cameraRef.current.stopRecording();
        }

        clearTimer();
        stopStatusTracking();
        clearClarificationTimers();

        setIsRecording(false);
        setTimer(0);
        setVideoUri(null);
        setProcessingId(null);
        setCreatedJobId(null);
        setExtractedData(null);
        setWaitingForPush(false);
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
        setStage(STAGES.INTRO);

        clarificationEventKeyRef.current = '';
        activeClarificationFieldRef.current = null;
        lastStateSignatureRef.current = '';
        lastStateChangeAtRef.current = 0;
        lastHybridPayloadRef.current = null;
        stagnationFallbackShownRef.current = false;
        completionAlertShownRef.current = false;

        triggerHaptic.light();
    }, [clearClarificationTimers, clearTimer, isRecording, stopStatusTracking]);

    const toggleUiPause = useCallback(() => {
        setUiPaused((prev) => !prev);
        triggerHaptic.light();
    }, []);

    const parseSkills = useCallback((value) => {
        if (Array.isArray(value)) return value;
        return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    }, []);

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
            if (isEmployer) {
                await client.put('/api/users/profile', {
                    companyName: extractedData.companyName || userInfo?.name || 'My Company',
                    location: extractedData.location || 'Remote',
                    industry: extractedData.jobTitle || '',
                    hasCompletedProfile: true,
                    processingId,
                });

                if (createdJobId) {
                    await client.put(`/api/jobs/${createdJobId}`, {
                        title: extractedData.jobTitle || 'Open Position',
                        companyName: extractedData.companyName || userInfo?.name || 'My Company',
                        salaryRange: extractedData.salaryRange || 'Negotiable',
                        location: extractedData.location || 'Remote',
                        requirements: parseSkills(extractedData.requiredSkills),
                        status: 'active',
                        processingId,
                    });

                    await maybeShowBoostUpsell(createdJobId);
                }
            } else {
                const fullName = String(extractedData.name || userInfo?.name || '').trim();
                const [firstName = 'Unknown', ...rest] = fullName.split(' ').filter(Boolean);
                const lastName = rest.join(' ');
                const expectedSalaryNum = Number.parseInt(String(extractedData.expectedSalary || '').replace(/[^0-9]/g, ''), 10);
                const experienceYears = Number.isFinite(Number(extractedData.experienceYears))
                    ? Number(extractedData.experienceYears)
                    : 0;

                await client.put('/api/users/profile', {
                    firstName,
                    lastName,
                    city: extractedData.location || 'Unknown',
                    totalExperience: experienceYears,
                    roleProfiles: [{
                        roleName: extractedData.roleTitle || 'General',
                        experienceInRole: experienceYears,
                        expectedSalary: Number.isFinite(expectedSalaryNum) ? expectedSalaryNum : 0,
                        skills: parseSkills(extractedData.skills),
                        lastUpdated: new Date(),
                    }],
                    hasCompletedProfile: true,
                    processingId,
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
    }, [completeOnboarding, createdJobId, extractedData, isEmployer, maybeShowBoostUpsell, parseSkills, processingId, savingProfile, updateUserInfo, userInfo]);

    const navigateToProfileLanding = useCallback(() => {
        const targetTab = isEmployer ? 'Talent' : 'Profiles';
        Alert.alert(
            '✅ Profile Created',
            isEmployer
                ? 'Your job post is live. Review it below.'
                : 'Your profile is live. Employers can now find you.',
            [{
                text: 'View Profile',
                onPress: () => navigation.reset({
                    index: 0,
                    routes: [{
                        name: 'MainTab',
                        state: {
                            index: 0,
                            routes: [{ name: targetTab }],
                        },
                    }],
                }),
            }]
        );
    }, [isEmployer, navigation]);

    useEffect(() => {
        stageRef.current = stage;
    }, [stage]);

    useEffect(() => {
        uiPausedRef.current = uiPaused;
    }, [uiPaused]);

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
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            clearTimer();
            stopStatusTracking();
            clearClarificationTimers();
            if (completionNavigationTimerRef.current) {
                clearTimeout(completionNavigationTimerRef.current);
                completionNavigationTimerRef.current = null;
            }
            if (cameraRef.current && isRecording) {
                cameraRef.current.stopRecording();
            }
        };
    }, [clearClarificationTimers, clearTimer, isRecording, stopStatusTracking]);

    useEffect(() => {
        requestCameraPermission();
        requestMicrophonePermission();
    }, [requestCameraPermission, requestMicrophonePermission]);

    useEffect(() => {
        if (stage !== STAGES.PROCESSING && stage !== STAGES.UPLOADING) return undefined;

        const interval = setInterval(() => {
            setProcessingMessageIndex((prev) => (prev + 1) % PROCESSING_MESSAGES.length);
        }, 1800);

        return () => clearInterval(interval);
    }, [stage]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            const wasBackground = appStateRef.current.match(/inactive|background/);
            if (wasBackground && nextState === 'active' && processingId && (stage === STAGES.PROCESSING || waitingForPush)) {
                checkProcessingStatus(processingId);
            }
            if (wasBackground && nextState === 'active' && stageRef.current === STAGES.COMPLETE) {
                setShowBoostUpsell(false);
            }
            appStateRef.current = nextState;
        });

        return () => {
            subscription.remove();
        };
    }, [checkProcessingStatus, processingId, stage, waitingForPush]);

    useEffect(() => {
        const incomingProcessingId = route?.params?.processingId;
        if (!incomingProcessingId) return;
        if (String(incomingProcessingId) === String(processingId) && !waitingForPush) return;

        setProcessingId(incomingProcessingId);
        setStage(STAGES.PROCESSING);
        beginHybridStatusTracking(incomingProcessingId);
    }, [beginHybridStatusTracking, processingId, route?.params?.processingId, waitingForPush]);

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
                <LinearGradient colors={['#080a10', '#3a2516', '#120e1a']} style={[styles.container, { paddingTop: insets.top + 8 }]}>
                    <TouchableOpacity style={styles.backButton} onPress={safeGoBack}>
                        <Text style={styles.backButtonText}>‹</Text>
                    </TouchableOpacity>

                    <View style={styles.introExperienceWrap}>
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
                                    <Ionicons name="videocam-outline" size={18} color="#0f172a" />
                                </View>
                                <View style={styles.previewCtrl}>
                                    <Ionicons name="share-outline" size={18} color="#ffffff" />
                                </View>
                                <View style={styles.previewCtrl}>
                                    <Ionicons name="pause" size={18} color="#ffffff" />
                                </View>
                                <View style={[styles.previewCtrl, styles.previewCtrlDanger]}>
                                    <Ionicons name="close" size={20} color="#ffffff" />
                                </View>
                            </View>
                        </LinearGradient>

                        <Text style={styles.heroBrandTitle}>HIRE Interview AI</Text>
                        <Text style={styles.heroTagline}>Natural conversation. Structured profile instantly.</Text>

                        <TouchableOpacity style={styles.primaryButton} onPress={handleBeginInterview}>
                            <Text style={styles.primaryButtonText}>Begin Guided Interview</Text>
                        </TouchableOpacity>

                        <View style={styles.trustPill}>
                            <Ionicons name="shield-checkmark-outline" size={13} color="#dbeafe" />
                            <Text style={styles.trustPillText}>Your interview data stays secure</Text>
                        </View>
                    </View>
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
                            <View style={styles.improveProfileCta}>
                                <Text style={styles.improveProfileCtaText}>Improve Profile</Text>
                            </View>
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

                    <View style={styles.confidenceCard}>
                        <Text style={styles.confidenceLabel}>AI Confidence</Text>
                        <View style={styles.confidenceBarTrack}>
                            <View style={[styles.confidenceBarFill, { width: `${Math.max(40, Math.min(100, Number(extractedData?.confidenceScore) || 82))}%` }]} />
                        </View>
                        <Text style={styles.confidenceValue}>{Math.max(40, Math.min(100, Number(extractedData?.confidenceScore) || 82))}%</Text>
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

                                <Text style={styles.reviewLabel}>Location</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.location || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), location: value }))}
                                />
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
                                : <Text style={styles.primaryButtonText}>Confirm & Continue</Text>}
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
                <LinearGradient colors={['#050b18', '#0b1a35']} style={[styles.container, { paddingTop: insets.top + 24 }]}> 
                    <Animated.View style={[styles.centeredContent, { opacity: successOpacity }]}>
                    <Text style={styles.successEmoji}>✓</Text>
                    <Text style={styles.headerTitle}>Your Smart Profile Is Live</Text>
                    <Text style={styles.headerSubtitle}>
                        {isEmployer
                            ? 'Your job post is live. Opening your talent view…'
                            : 'Your profile is live. Opening your profile view…'}
                    </Text>

                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={navigateToProfileLanding}
                    >
                        <Text style={styles.primaryButtonText}>View Profile</Text>
                    </TouchableOpacity>

                    {!isEmployer && (
                        <View style={styles.workerNudgeCard}>
                            <Text style={styles.workerNudgeTitle}>3 jobs matching your profile right now</Text>
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
                        <Text style={styles.headerTitleSmall}>Smart Interview ✦</Text>
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
                                        : waitingForPush
                                        ? 'Processing continues in background. We will notify you when ready.'
                                        : 'Please keep the app open for faster completion.'}
                                </Text>
                                <View style={styles.processingShimmerStack}>
                                    <SkeletonLoader width="82%" height={8} borderRadius={4} tone="tint" />
                                    <SkeletonLoader width="64%" height={8} borderRadius={4} tone="tint" />
                                </View>
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
                                        <View style={styles.liveBadgeDot} />
                                        <Text style={styles.liveBadgeText}>LIVE</Text>
                                    </View>
                                    <View style={styles.timerPillLive}>
                                        <Text style={styles.timerText}>{formatTimer(timer)}</Text>
                                    </View>
                                </View>
                                <View style={styles.stepProgressRow}>
                                    <Text style={styles.stepProgressText}>
                                        Step {Math.min(Math.max(interviewStep + 1, 1), maxSteps)} / {maxSteps}
                                    </Text>
                                    <Text style={styles.stepProgressMeta}>
                                        {Math.round(Math.max(0, Math.min(1, slotCompletenessRatio)) * 100)}% complete
                                    </Text>
                                </View>

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
                                        style={[styles.liveCircleButton, styles.liveCircleButtonWhite]}
                                        onPress={() => setFacing((prev) => (prev === 'front' ? 'back' : 'front'))}
                                        activeOpacity={0.86}
                                    >
                                        <Ionicons name="camera-reverse-outline" size={20} color="#0f172a" />
                                    </TouchableOpacity>

                                    <TouchableOpacity style={[styles.liveCircleButton, styles.liveCirclePrimary]} onPress={stopRecording} activeOpacity={0.86}>
                                        <Ionicons name="checkmark" size={22} color="#ffffff" />
                                    </TouchableOpacity>

                                    <TouchableOpacity style={styles.liveCircleButton} onPress={toggleUiPause} activeOpacity={0.86}>
                                        <Ionicons name={uiPaused ? 'play' : 'pause'} size={20} color="#ffffff" />
                                    </TouchableOpacity>

                                    <TouchableOpacity style={[styles.liveCircleButton, styles.liveCircleDanger]} onPress={cancelRecording} activeOpacity={0.86}>
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
        backgroundColor: '#000',
    },
    loaderContainer: {
        flex: 1,
        backgroundColor: '#000',
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
        backgroundColor: 'rgba(255,255,255,0.12)',
    },
    backButtonText: {
        color: '#fff',
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
    introExperienceWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 22,
        paddingBottom: 18,
    },
    previewPhoneFrame: {
        width: '100%',
        maxWidth: 360,
        minHeight: 420,
        borderRadius: 28,
        borderWidth: 1.4,
        borderColor: 'rgba(255,255,255,0.78)',
        overflow: 'hidden',
        marginTop: 8,
        marginBottom: 20,
        backgroundColor: 'rgba(21,31,55,0.62)',
    },
    previewFaceGlow: {
        position: 'absolute',
        top: -40,
        left: -20,
        right: -20,
        height: 280,
        backgroundColor: 'rgba(255,170,95,0.22)',
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
        borderColor: 'rgba(255,255,255,0.72)',
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
        backgroundColor: 'rgba(203,213,225,0.92)',
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
        backgroundColor: 'rgba(9,15,26,0.86)',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 4,
    },
    previewCtrlWhite: {
        backgroundColor: '#ffffff',
    },
    previewCtrlDanger: {
        backgroundColor: '#de4f4f',
    },
    heroBrandTitle: {
        color: '#ffffff',
        fontSize: 38,
        fontWeight: '700',
        letterSpacing: -0.8,
        marginBottom: 4,
        textAlign: 'center',
    },
    heroTagline: {
        color: '#e2e8f0',
        fontSize: 15,
        fontWeight: '500',
        textAlign: 'center',
        marginBottom: 18,
    },
    introCard: {
        width: '100%',
        backgroundColor: 'rgba(148,163,184,0.12)',
        borderRadius: 20,
        padding: 20,
        marginTop: 28,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.24)',
    },
    introCardTitle: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 16,
        marginBottom: 6,
    },
    introCardText: {
        color: '#cbd5e1',
        fontSize: 14,
        lineHeight: 20,
    },
    trustPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.32)',
        backgroundColor: 'rgba(148,163,184,0.12)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        marginTop: 12,
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
    },
    trustPillText: {
        color: '#dbeafe',
        fontSize: 12,
        fontWeight: '500',
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
        shadowColor: '#7c3aed',
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
