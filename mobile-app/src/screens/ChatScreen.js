import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, FlatList,
    StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated, Image, Modal, Alert, Linking, Pressable, ActivityIndicator, Keyboard
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconVideo, IconPhone, IconPlus, IconSend, IconMic } from '../components/Icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveLimitedCache } from '../utils/cacheManager';
import { triggerHaptic } from '../utils/haptics';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import ContactInfoView from '../components/contact/ContactInfoView';
import SocketService from '../services/socket';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { initiateCall } from '../services/WebRTCService';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { validateChatMessagesResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { MOTION } from '../theme/motion';
import { RADIUS, SHADOWS, SPACING, theme } from '../theme/theme';
import { API_BASE_URL } from '../config';
import {
    APPLICATION_TIMELINE_MILESTONES,
    findTimelineEventForMilestone,
    getApplicationStatusLabel,
    isChatReadyForApplicationStatus,
    normalizeApplicationStatus,
} from '../utils/applicationPresentation';
import { getProfileTitleForRole } from '../utils/profileReadiness';

const CHAT_ACCENT = '#7c3aed';
const CHAT_ACCENT_DARK = '#6d28d9';
const CHAT_ACCENT_SOFT = '#f3e8ff';
const CHAT_ACCENT_SOFTER = '#faf5ff';
const CHAT_ACCENT_BORDER = '#ddd6fe';
const CHAT_ACCENT_BORDER_STRONG = '#c4b5fd';
const CHAT_ACCENT_TEXT = '#6d28d9';
const CHAT_ACCENT_TEXT_LIGHT = '#ede9fe';
const CHAT_ACCENT_WAVE = '#c4b5fd';
const MAX_AI_REPLY_SUGGESTIONS = 3;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_CHAT_MESSAGES_IN_MEMORY = 220;
const CHAT_HISTORY_CACHE_VERSION = 'v2';
const VOICE_STOP_TIMEOUT_MS = 5000;
const VOICE_MAX_DURATION_SECONDS = 180;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const ALLOWED_ATTACHMENT_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
]);
const isPlaceholderApiHost = (hostname = '') => {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized === 'example.com' || normalized.endsWith('.example.com');
};

const isChatEnabledStatus = (status) => isChatReadyForApplicationStatus(status);

const normalizeRoleForChatSide = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['employer', 'recruiter', 'hirer', 'company'].includes(normalized)) return 'employer';
    if (['worker', 'candidate', 'jobseeker', 'job_seeker', 'employee'].includes(normalized)) return 'worker';
    return '';
};

const normalizeObjectId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
        const normalized = value.trim();
        return OBJECT_ID_PATTERN.test(normalized) ? normalized : '';
    }
    if (typeof value === 'object') {
        const nestedId = normalizeObjectId(value._id || value.id || value.$oid || '');
        if (nestedId) return nestedId;

        const bufferNode = value.buffer || value.data || null;
        const byteArray = Array.isArray(bufferNode?.data)
            ? bufferNode.data
            : (Array.isArray(bufferNode) ? bufferNode : null);
        if (byteArray && byteArray.length === 12) {
            const hex = byteArray
                .map((part) => Number(part).toString(16).padStart(2, '0'))
                .join('');
            return OBJECT_ID_PATTERN.test(hex) ? hex : '';
        }
    }
    return '';
};

const resolveMessageSenderSide = (message = {}) => {
    const directRole = normalizeRoleForChatSide(message?.senderRole);
    if (directRole) return directRole;
    const senderRole = normalizeRoleForChatSide(message?.sender?.activeRole || message?.sender?.role);
    return senderRole || '';
};

const resolveMessageType = (message = {}) => {
    const normalized = String(message?.type || '').trim().toLowerCase();
    if (normalized === 'audio' || normalized === 'voice') return 'audio';
    if (normalized === 'file' || normalized === 'attachment') return 'file';
    if (normalized === 'text') return 'text';
    const mimeType = String(message?.mimeType || '').trim().toLowerCase();
    if (mimeType.startsWith('audio/') || message?.audioUrl) return 'audio';
    if (message?.fileUrl || message?.attachmentUrl) return 'file';
    return 'text';
};

const isChatLockedByStatusError = (error) => {
    const statusCode = Number(error?.response?.status || error?.originalError?.response?.status || 0);
    const message = String(
        error?.response?.data?.message
        || error?.originalError?.response?.data?.message
        || error?.message
        || ''
    ).toLowerCase();

    return statusCode === 403 && (
        message.includes('chat is available after shortlisting')
        || message.includes('available after shortlisting')
        || message.includes('shortlist')
    );
};

const toPercent = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    if (parsed <= 1) return Math.round(parsed * 100);
    return Math.max(0, Math.min(100, Math.round(parsed)));
};

const formatPercent = (value, suffix = '%') => {
    const normalized = toPercent(value);
    if (!Number.isFinite(normalized)) return 'N/A';
    return `${normalized}${suffix}`;
};

const toHoursLabel = (hours) => {
    const parsed = Number(hours);
    if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
    if (parsed < 1) return '<1h';
    return `${Math.round(parsed)}h`;
};

const toDateLabel = (isoValue) => {
    const date = new Date(isoValue || '');
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString();
};

const resolveVoiceMimeType = (uri = '') => {
    const normalizedUri = String(uri || '').toLowerCase();
    if (normalizedUri.endsWith('.m4a')) return 'audio/x-m4a';
    if (normalizedUri.endsWith('.aac')) return 'audio/aac';
    if (normalizedUri.endsWith('.wav')) return 'audio/wav';
    if (normalizedUri.endsWith('.mp3')) return 'audio/mpeg';
    if (normalizedUri.endsWith('.ogg')) return 'audio/ogg';
    if (normalizedUri.endsWith('.webm')) return 'audio/webm';
    return Platform.OS === 'ios' ? 'audio/x-m4a' : 'audio/mp4';
};

const normalizeVoiceMimeType = (rawMimeType = '', uri = '') => {
    const normalized = String(rawMimeType || '').trim().toLowerCase();
    if (!normalized) {
        return resolveVoiceMimeType(uri);
    }
    if (normalized === 'audio/m4a') {
        return 'audio/x-m4a';
    }
    return normalized;
};

const resolveApiErrorMessage = (error, fallback = '') => {
    const responseMessage = String(
        error?.response?.data?.message
        || error?.originalError?.response?.data?.message
        || ''
    ).trim();
    if (responseMessage) return responseMessage;

    const directMessage = String(error?.message || '').trim();
    if (directMessage) return directMessage;

    const originalMessage = String(error?.originalError?.message || '').trim();
    if (originalMessage) return originalMessage;

    return String(fallback || '').trim();
};

const withPromiseTimeout = (promise, timeoutMs, timeoutMessage = 'Operation timed out') => new Promise((resolve, reject) => {
    const safeTimeout = Math.max(600, Number(timeoutMs) || 0);
    const timer = setTimeout(() => {
        reject(new Error(timeoutMessage));
    }, safeTimeout);

    Promise.resolve(promise)
        .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
        .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
});

const formatDurationLabel = (seconds = 0) => {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatDurationFromMillis = (millis = 0) => {
    const safeMillis = Math.max(0, Number(millis) || 0);
    return formatDurationLabel(Math.floor(safeMillis / 1000));
};

const trimChatMessagesForMemory = (messageList = []) => {
    if (!Array.isArray(messageList)) return [];
    if (messageList.length <= MAX_CHAT_MESSAGES_IN_MEMORY) return messageList;
    return messageList.slice(-MAX_CHAT_MESSAGES_IN_MEMORY);
};

const resolveAudioExtensionForAndroid = (url = '', mimeType = '') => {
    const normalizedUrl = String(url || '').toLowerCase();
    const normalizedMimeType = String(mimeType || '').trim().toLowerCase();

    if (normalizedUrl.includes('.mp3') || normalizedMimeType.includes('audio/mpeg')) return 'mp3';
    if (normalizedUrl.includes('.wav') || normalizedMimeType.includes('audio/wav')) return 'wav';
    if (normalizedUrl.includes('.aac') || normalizedMimeType.includes('audio/aac')) return 'aac';
    if (normalizedUrl.includes('.ogg') || normalizedMimeType.includes('audio/ogg')) return 'ogg';
    if (normalizedUrl.includes('.webm') || normalizedMimeType.includes('audio/webm')) return 'webm';
    return 'm4a';
};

const resolveMediaUrl = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const baseFromClient = String(client?.defaults?.baseURL || '').trim();
    const baseCandidate = baseFromClient || String(API_BASE_URL || '').trim();
    const baseOrigin = baseCandidate
        .replace(/\/+$/, '')
        .replace(/\/api$/i, '');

    if (/^https?:\/\//i.test(raw)) {
        try {
            const parsed = new URL(raw);
            if (baseOrigin && isPlaceholderApiHost(parsed.hostname)) {
                return `${baseOrigin}${parsed.pathname || ''}${parsed.search || ''}`;
            }
        } catch (_error) {
            // Keep raw absolute URL when parsing fails.
        }
        return raw;
    }

    if (!baseOrigin) return raw;
    if (raw.startsWith('/')) return `${baseOrigin}${raw}`;
    return `${baseOrigin}/${raw.replace(/^\/+/, '')}`;
};

const normalizeIncomingMessagePayload = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return payload;
    const nestedMessage = payload?.message;
    if (!nestedMessage || typeof nestedMessage !== 'object') return payload;

    return {
        ...nestedMessage,
        applicationId: nestedMessage?.applicationId || payload?.applicationId || payload?.roomId || '',
        roomId: nestedMessage?.roomId || payload?.roomId || payload?.applicationId || '',
        fromUserId: nestedMessage?.fromUserId || payload?.fromUserId || '',
        senderRole: nestedMessage?.senderRole || payload?.senderRole || '',
    };
};

const firstNonEmptyText = (...values) => {
    for (const value of values) {
        const normalized = String(value || '').trim();
        if (normalized) return normalized;
    }
    return '';
};

const uniqueStringList = (values = []) => {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values
        .map((entry) => {
            if (typeof entry === 'string') return entry.trim();
            if (entry && typeof entry === 'object') {
                return firstNonEmptyText(entry.name, entry.label, entry.value, entry.title);
            }
            return '';
        })
        .filter((entry) => {
            if (!entry) return false;
            const key = entry.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

const buildChatFallbackProfile = ({
    profileMode = 'employer',
    otherPartyName = 'Contact',
    jobTitle = 'Opportunity',
    application = null,
} = {}) => {
    const safeApplication = application && typeof application === 'object' ? application : {};
    const worker = safeApplication?.worker && typeof safeApplication.worker === 'object' ? safeApplication.worker : {};
    const employer = safeApplication?.employer && typeof safeApplication.employer === 'object' ? safeApplication.employer : {};
    const job = safeApplication?.job && typeof safeApplication.job === 'object' ? safeApplication.job : {};

    if (profileMode === 'candidate') {
        const roleProfileSkills = (Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : []).flatMap((roleProfile) => (
            Array.isArray(roleProfile?.skills) ? roleProfile.skills : []
        ));
        const skills = uniqueStringList([
            ...(Array.isArray(worker?.skills) ? worker.skills : []),
            ...roleProfileSkills,
        ]).slice(0, 10);
        const candidateName = firstNonEmptyText(
            otherPartyName,
            [worker?.firstName, worker?.lastName].filter(Boolean).join(' ').trim(),
            worker?.name,
            'Job Seeker'
        );
        const preferredRole = firstNonEmptyText(jobTitle, job?.title, worker?.headline, worker?.preferredRole, 'Job Seeker Profile');
        const expectedSalaryValue = Number(worker?.expectedSalary);
        const expectedSalary = Number.isFinite(expectedSalaryValue) && expectedSalaryValue > 0
            ? `₹${expectedSalaryValue.toLocaleString()}`
            : firstNonEmptyText(worker?.salaryExpectation, worker?.expectedSalaryLabel, 'N/A');

        return {
            name: candidateName,
            headline: preferredRole,
            industryTag: 'JOB SEEKER PROFILE',
            summary: firstNonEmptyText(
                worker?.summary,
                worker?.about,
                worker?.bio,
                'Job seeker details are syncing. You can continue chat and view updates in real time.'
            ),
            experienceYears: Number(worker?.totalExperience || worker?.experienceYears || 0),
            skills: skills.length ? skills : ['Communication', 'Ownership'],
            highlights: [
                { label: 'Status', value: worker?.isAvailable ? 'Available now' : 'Open to opportunities' },
                { label: 'Preferred Role', value: preferredRole },
                { label: 'Location', value: firstNonEmptyText(worker?.location, job?.location, 'Not specified') },
                { label: 'Expected Salary', value: expectedSalary || 'N/A' },
            ],
            workHistory: Array.isArray(worker?.workHistory) ? worker.workHistory : [],
            avatar: firstNonEmptyText(worker?.avatar, worker?.profilePicture, worker?.profileImage),
        };
    }

    const employerName = firstNonEmptyText(
        otherPartyName,
        employer?.companyName,
        employer?.name,
        job?.companyName,
        'Employer'
    );
    const roleTitle = firstNonEmptyText(jobTitle, job?.title, 'Hiring Opportunity');
    const roleSummary = Array.isArray(job?.requirements)
        ? job.requirements.filter(Boolean).join(', ')
        : firstNonEmptyText(job?.requirements);
    return {
        name: employerName,
        headline: `${roleTitle}${job?.location ? ` · ${job.location}` : ''}`,
        industryTag: 'EMPLOYER',
        mission: firstNonEmptyText(
            job?.description,
            roleSummary,
            `Role: ${roleTitle}. Job details are syncing.`,
            'Hiring update available in this conversation.'
        ),
        industry: firstNonEmptyText(employer?.industry, 'Not specified'),
        hq: firstNonEmptyText(employer?.location, job?.location, 'Not specified'),
        contactInfo: {
            partnership: firstNonEmptyText(employer?.email, 'Not shared'),
            support: firstNonEmptyText(employer?.phone, 'Not shared'),
            website: firstNonEmptyText(employer?.website, 'Not shared'),
        },
        highlights: [
            { label: 'Role', value: roleTitle },
            { label: 'Salary', value: firstNonEmptyText(job?.salaryRange, job?.salary, 'N/A') },
            { label: 'Location', value: firstNonEmptyText(job?.location, 'N/A') },
            { label: 'Status', value: 'Open for discussion' },
        ],
        avatar: firstNonEmptyText(employer?.logo, employer?.avatar, employer?.profilePicture),
    };
};

const mergeChatProfileData = (fallbackProfile = {}, providedProfile = null) => {
    const safeFallback = fallbackProfile && typeof fallbackProfile === 'object' ? fallbackProfile : {};
    const safeProvided = providedProfile && typeof providedProfile === 'object' ? providedProfile : {};
    const merged = {
        ...safeFallback,
        ...safeProvided,
        contactInfo: {
            ...(safeFallback.contactInfo || {}),
            ...(safeProvided.contactInfo || {}),
        },
    };

    const fallbackHighlights = Array.isArray(safeFallback.highlights) ? safeFallback.highlights : [];
    const providedHighlights = Array.isArray(safeProvided.highlights) ? safeProvided.highlights : [];
    merged.highlights = providedHighlights.length ? providedHighlights : fallbackHighlights;

    const fallbackSkills = Array.isArray(safeFallback.skills) ? safeFallback.skills : [];
    const providedSkills = Array.isArray(safeProvided.skills) ? safeProvided.skills : [];
    merged.skills = providedSkills.length ? providedSkills : fallbackSkills;

    const fallbackWorkHistory = Array.isArray(safeFallback.workHistory) ? safeFallback.workHistory : [];
    const providedWorkHistory = Array.isArray(safeProvided.workHistory) ? safeProvided.workHistory : [];
    merged.workHistory = providedWorkHistory.length ? providedWorkHistory : fallbackWorkHistory;

    merged.name = firstNonEmptyText(safeProvided.name, safeFallback.name, 'Profile');
    merged.headline = firstNonEmptyText(safeProvided.headline, safeFallback.headline, 'Profile details');
    merged.summary = firstNonEmptyText(safeProvided.summary, safeFallback.summary);
    merged.mission = firstNonEmptyText(safeProvided.mission, safeFallback.mission);
    merged.avatar = firstNonEmptyText(
        safeProvided.avatar,
        safeProvided.profilePicture,
        safeProvided.profileImage,
        safeFallback.avatar
    );

    return merged;
};

// Typing Indicator Component
const TypingIndicator = () => {
    const dot1 = useRef(new Animated.Value(0.45)).current;
    const dot2 = useRef(new Animated.Value(0.45)).current;
    const dot3 = useRef(new Animated.Value(0.45)).current;
    const animationRefs = useRef([]);

    useEffect(() => {
        const createAnimation = (anim, delay) => {
            return Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(anim, {
                        toValue: 1,
                        duration: 260,
                        useNativeDriver: true,
                    }),
                    Animated.timing(anim, {
                        toValue: 0.45,
                        duration: 260,
                        useNativeDriver: true,
                    }),
                    Animated.delay(220),
                ])
            );
        };

        const loops = [
            createAnimation(dot1, 0),
            createAnimation(dot2, 150),
            createAnimation(dot3, 300),
        ];
        animationRefs.current = loops;
        loops.forEach((loop) => loop.start());

        return () => {
            animationRefs.current.forEach((loop) => loop.stop());
            animationRefs.current = [];
        };
    }, []);

    return (
        <View style={styles.typingContainer}>
            <Animated.View style={[styles.typingDot, { opacity: dot1, transform: [{ scale: dot1 }] }]} />
            <Animated.View style={[styles.typingDot, { opacity: dot2, transform: [{ scale: dot2 }] }]} />
            <Animated.View style={[styles.typingDot, { opacity: dot3, transform: [{ scale: dot3 }] }]} />
        </View>
    );
};

export default function ChatScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const applicationId = useMemo(() => normalizeObjectId(
        route?.params?.applicationId
        || route?.params?.application?._id
        || route?.params?._id
    ), [route?.params?.applicationId, route?.params?.application?._id, route?.params?._id]);

    const { userInfo } = React.useContext(AuthContext);
    const routeApplication = useMemo(() => (
        route?.params?.application && typeof route.params.application === 'object'
            ? route.params.application
            : null
    ), [route?.params?.application]);
    const viewerRoleSeed = useMemo(
        () => normalizeRoleForChatSide(userInfo?.activeRole || userInfo?.primaryRole || userInfo?.role),
        [userInfo?.activeRole, userInfo?.primaryRole, userInfo?.role]
    );
    const routeProfileModeSeed = viewerRoleSeed === 'employer' ? 'candidate' : 'employer';
    const routeOtherPartyNameSeed = useMemo(() => firstNonEmptyText(
        route?.params?.otherPartyName,
        route?.params?.candidateName,
        route?.params?.companyName,
        route?.params?.name
    ), [
        route?.params?.candidateName,
        route?.params?.companyName,
        route?.params?.name,
        route?.params?.otherPartyName,
    ]);
    const routeJobTitleSeed = useMemo(() => firstNonEmptyText(
        route?.params?.jobTitle,
        route?.params?.title,
        route?.params?.roleTitle
    ), [route?.params?.jobTitle, route?.params?.roleTitle, route?.params?.title]);
    const { setActiveChatId, clearActiveChatId, setSocketStatus } = useAppStore();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [showAttachments, setShowAttachments] = useState(false);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [lastReadByOther, setLastReadByOther] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isScreenReady] = useState(true);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [isUploadingVoiceNote, setIsUploadingVoiceNote] = useState(false);
    const [isSendingMessage, setIsSendingMessage] = useState(false);
    const [pendingRetryPayload, setPendingRetryPayload] = useState(null);
    const [pendingVoiceRetryFile, setPendingVoiceRetryFile] = useState(null);
    const [sendError, setSendError] = useState('');
    const [aiReplySuggestions, setAiReplySuggestions] = useState([]);
    const [aiReplyLoading, setAiReplyLoading] = useState(false);
    const [aiReplyError, setAiReplyError] = useState('');
    const [connectionStatus, setConnectionStatus] = useState('connected');
    const [historyError, setHistoryError] = useState('');
    const [applicationStatus, setApplicationStatus] = useState('applied');
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [isVoiceStopping, setIsVoiceStopping] = useState(false);
    const [voiceRecordingStartedAt, setVoiceRecordingStartedAt] = useState(0);
    const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
    const [playingAudioMessageId, setPlayingAudioMessageId] = useState('');
    const [playingAudioPositionMs, setPlayingAudioPositionMs] = useState(0);
    const [playingAudioDurationMs, setPlayingAudioDurationMs] = useState(0);
    const [keyboardInset, setKeyboardInset] = useState(0);
    const [chatMeta, setChatMeta] = useState(() => {
        const profileMode = routeProfileModeSeed;
        const otherPartyName = routeOtherPartyNameSeed || (profileMode === 'candidate' ? 'Job Seeker' : 'Employer');
        const jobTitle = routeJobTitleSeed || 'Opportunity';
        return {
            otherPartyName,
            jobTitle,
            companyId: null,
            profileMode,
            profileData: buildChatFallbackProfile({
                profileMode,
                otherPartyName,
                jobTitle,
                application: routeApplication,
            }),
            trustTag: '',
            responseTag: '',
        };
    });
    const [chatParticipants, setChatParticipants] = useState({
        employerId: '',
        workerUserId: '',
        employerProfileId: '',
        workerProfileId: '',
    });
    const [reloadKey, setReloadKey] = useState(0);
    // Enterprise Hub state
    const [activeHubPanel, setActiveHubPanel] = useState(null);
    const [hiringTimeline, setHiringTimeline] = useState([]);
    const [escrowPanel, setEscrowPanel] = useState(null);
    const [chatDocuments, setChatDocuments] = useState([]);
    const [privateNotes, setPrivateNotes] = useState([]);
    const [newNote, setNewNote] = useState('');
    const [hubLoading, setHubLoading] = useState(false);
    const [hubError, setHubError] = useState('');
    const [hubUploadingDocument, setHubUploadingDocument] = useState(false);
    const isEmployer = getPrimaryRoleFromUser(userInfo) === 'employer';

    const flatListRef = useRef(null);
    const typingTimeout = useRef(null);
    const reconnectBannerDelayRef = useRef(null);
    const previousRowCountRef = useRef(0);
    const hasInitialScrollRef = useRef(false);
    const hasTrackedChatStartRef = useRef(false);
    const joinedRoomRef = useRef(false);
    const locallySentMessageIdsRef = useRef(new Set());
    const audioUrlCacheRef = useRef(new Map());
    const lastAiReplySeedRef = useRef('');
    const voiceRecordingRef = useRef(null);
    const audioPlaybackRef = useRef(null);
    const sendScale = useRef(new Animated.Value(1)).current;
    const micWaveAnim = useRef(new Animated.Value(0.45)).current;
    const canChat = isChatEnabledStatus(applicationStatus);
    const currentUserId = userInfo?._id || userInfo?.id || userInfo?.userId || '';
    const viewerRoleSide = viewerRoleSeed;
    const normalizeIdForCompare = useCallback((value) => {
        const normalized = normalizeObjectId(value);
        if (normalized) return String(normalized).trim().toLowerCase();
        return String(value || '').trim().toLowerCase();
    }, []);
    const employerParticipantIds = useMemo(() => [
        normalizeIdForCompare(chatParticipants?.employerId),
        normalizeIdForCompare(chatParticipants?.employerProfileId),
    ].filter(Boolean), [
        chatParticipants?.employerId,
        chatParticipants?.employerProfileId,
        normalizeIdForCompare,
    ]);
    const workerParticipantIds = useMemo(() => [
        normalizeIdForCompare(chatParticipants?.workerUserId),
        normalizeIdForCompare(chatParticipants?.workerProfileId),
    ].filter(Boolean), [
        chatParticipants?.workerUserId,
        chatParticipants?.workerProfileId,
        normalizeIdForCompare,
    ]);
    const resolvedViewerRoleSide = useMemo(() => {
        if (viewerRoleSide) return viewerRoleSide;
        const currentUserIdText = normalizeIdForCompare(currentUserId);
        if (!currentUserIdText) return '';

        const matchesEmployer = employerParticipantIds.includes(currentUserIdText);
        const matchesWorker = workerParticipantIds.includes(currentUserIdText);
        if (matchesEmployer && !matchesWorker) return 'employer';
        if (matchesWorker && !matchesEmployer) return 'worker';
        return '';
    }, [
        currentUserId,
        employerParticipantIds,
        normalizeIdForCompare,
        viewerRoleSide,
        workerParticipantIds,
    ]);
    const isDualParticipantAccount = useMemo(() => {
        const employerUserId = normalizeIdForCompare(chatParticipants?.employerId);
        const workerUserId = normalizeIdForCompare(chatParticipants?.workerUserId);
        return Boolean(employerUserId && workerUserId && employerUserId === workerUserId);
    }, [
        chatParticipants?.employerId,
        chatParticipants?.workerUserId,
        normalizeIdForCompare,
    ]);
    const viewerParticipantIds = useMemo(() => {
        if (!resolvedViewerRoleSide) return [];
        if (resolvedViewerRoleSide === 'employer') return employerParticipantIds;
        if (resolvedViewerRoleSide === 'worker') return workerParticipantIds;
        return [];
    }, [
        employerParticipantIds,
        resolvedViewerRoleSide,
        workerParticipantIds,
    ]);
    const isMessageFromViewer = useCallback((rawMessage = {}) => {
        const message = normalizeIncomingMessagePayload(rawMessage);
        const senderRaw = typeof message?.sender === 'object'
            ? (message?.sender?._id || message?.sender?.id || message?.sender)
            : message?.sender;
        const senderIdCandidates = [
            normalizeIdForCompare(senderRaw),
            normalizeIdForCompare(message?.sender?._id),
            normalizeIdForCompare(message?.sender?.id),
            normalizeIdForCompare(message?.senderId),
            normalizeIdForCompare(message?.fromUserId),
            normalizeIdForCompare(message?.userId),
        ].filter(Boolean);
        const senderIdText = senderIdCandidates[0] || '';
        const currentUserIdText = normalizeIdForCompare(currentUserId);
        const messageId = String(message?._id || message?.id || rawMessage?._id || rawMessage?.id || '');
        if (messageId && locallySentMessageIdsRef.current.has(messageId)) {
            return true;
        }

        const senderSide = resolveMessageSenderSide(message)
            || normalizeRoleForChatSide(message?.senderType || message?.role || message?.userRole || rawMessage?.senderRole);
        const roleComparisonResult = (senderSide && resolvedViewerRoleSide)
            ? (senderSide === resolvedViewerRoleSide)
            : null;
        const isMineHint = typeof message?.isMine === 'boolean'
            ? message.isMine
            : (typeof rawMessage?.isMine === 'boolean' ? rawMessage.isMine : null);

        if (isDualParticipantAccount && roleComparisonResult !== null) {
            return roleComparisonResult;
        }

        if (!senderIdText && senderIdCandidates.length === 0) {
            if (roleComparisonResult !== null) {
                return roleComparisonResult;
            }
            if (isDualParticipantAccount && isMineHint !== null) {
                return Boolean(isMineHint);
            }
            return false;
        }

        const senderMatchesCurrentUser = Boolean(
            currentUserIdText
            && senderIdCandidates.some((candidateId) => candidateId === currentUserIdText)
        );
        const senderMatchesParticipant = Array.isArray(viewerParticipantIds) && viewerParticipantIds.length > 0
            ? senderIdCandidates.some((candidateId) => viewerParticipantIds.includes(candidateId))
            : false;

        if (senderMatchesCurrentUser) {
            if (isDualParticipantAccount) {
                if (roleComparisonResult !== null) {
                    return roleComparisonResult;
                }
                if (isMineHint !== null) {
                    return Boolean(isMineHint);
                }
                return false;
            }
            return true;
        }

        if (senderMatchesParticipant) {
            if (roleComparisonResult !== null) {
                return roleComparisonResult;
            }
            return true;
        }

        if (roleComparisonResult !== null) {
            return roleComparisonResult;
        }

        if (resolvedViewerRoleSide === 'employer' && employerParticipantIds.length > 0) {
            return senderIdCandidates.some((candidateId) => employerParticipantIds.includes(candidateId));
        }
        if (resolvedViewerRoleSide === 'worker' && workerParticipantIds.length > 0) {
            return senderIdCandidates.some((candidateId) => workerParticipantIds.includes(candidateId));
        }

        return false;
    }, [
        currentUserId,
        employerParticipantIds,
        isDualParticipantAccount,
        normalizeIdForCompare,
        resolvedViewerRoleSide,
        viewerParticipantIds,
        workerParticipantIds,
    ]);
    const safeGoBack = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate('MainTab', { screen: 'Applications' });
    }, [navigation]);

    const hasOwnMessageInList = useCallback((list = []) => {
        if (!Array.isArray(list)) return false;
        return list.some((message) => isMessageFromViewer(message));
    }, [isMessageFromViewer]);

    const latestIncomingMessageText = useMemo(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index] || {};
            if (isMessageFromViewer(message)) continue;
            if (resolveMessageType(message) !== 'text') continue;
            const text = String(message?.text || '').trim();
            if (text) return text.slice(0, 400);
        }
        return '';
    }, [isMessageFromViewer, messages]);

    const requestAiReplySuggestions = useCallback(async ({ force = false } = {}) => {
        const baseMessage = String(latestIncomingMessageText || '').trim();
        if (!canChat || !baseMessage || !applicationId) {
            if (!baseMessage && (aiReplySuggestions.length || aiReplyError || aiReplyLoading)) {
                setAiReplySuggestions([]);
                setAiReplyError('');
                setAiReplyLoading(false);
                lastAiReplySeedRef.current = '';
            }
            return;
        }

        const requestSeed = `${applicationId}:${String(chatMeta?.jobTitle || '').trim()}:${baseMessage}`;
        if (!force && lastAiReplySeedRef.current === requestSeed && aiReplySuggestions.length > 0) {
            return;
        }

        setAiReplyLoading(true);
        setAiReplyError('');
        try {
            const { data } = await client.post('/api/features/ai/suggest-replies', {
                message: baseMessage,
                context: String(chatMeta?.jobTitle || '').trim(),
            }, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
            });
            const suggestions = Array.isArray(data?.suggestions)
                ? data.suggestions
                : String(data?.suggestions || '')
                    .split('\n')
                    .map((entry) => entry.replace(/^[\-\d.)\s]+/, '').trim())
                    .filter(Boolean);

            const cleaned = [...new Set(suggestions.map((entry) => String(entry || '').trim()).filter(Boolean))]
                .slice(0, MAX_AI_REPLY_SUGGESTIONS);
            setAiReplySuggestions(cleaned);
            lastAiReplySeedRef.current = requestSeed;

            if (!cleaned.length) {
                setAiReplyError('No quick replies available right now.');
            }
        } catch (_error) {
            if (!aiReplySuggestions.length) {
                setAiReplyError('Could not load AI quick replies.');
            }
        } finally {
            setAiReplyLoading(false);
        }
    }, [aiReplyError, aiReplyLoading, aiReplySuggestions.length, applicationId, canChat, chatMeta?.jobTitle, latestIncomingMessageText]);

    const applyAiSuggestion = useCallback((value = '') => {
        const suggestion = String(value || '').trim();
        if (!suggestion || !canChat) return;
        setInput(suggestion);
        triggerHaptic.light();
    }, [canChat]);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const handleKeyboardShow = (event) => {
            const keyboardHeight = Number(event?.endCoordinates?.height || 0);
            const resolvedInset = Math.max(0, keyboardHeight - (Platform.OS === 'ios' ? 0 : insets.bottom));
            setKeyboardInset(resolvedInset);
        };
        const handleKeyboardHide = () => {
            setKeyboardInset(0);
        };

        const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
        const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, [insets.bottom]);

    useEffect(() => {
        setAiReplySuggestions([]);
        setAiReplyError('');
        setAiReplyLoading(false);
        lastAiReplySeedRef.current = '';
    }, [applicationId]);

    useEffect(() => {
        if (isSendingMessage || uploadingFile || isVoiceRecording) {
            return;
        }

        if (!canChat || !latestIncomingMessageText) {
            if (!latestIncomingMessageText && (aiReplySuggestions.length || aiReplyError || aiReplyLoading)) {
                setAiReplySuggestions([]);
                setAiReplyError('');
                lastAiReplySeedRef.current = '';
            }
            return;
        }

        const timer = setTimeout(() => {
            void requestAiReplySuggestions({ force: false });
        }, 900);
        return () => clearTimeout(timer);
    }, [aiReplyError, aiReplyLoading, aiReplySuggestions.length, canChat, isSendingMessage, isVoiceRecording, latestIncomingMessageText, requestAiReplySuggestions, uploadingFile]);

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(micWaveAnim, {
                    toValue: 1,
                    duration: MOTION.successPulseMs,
                    useNativeDriver: true,
                }),
                Animated.timing(micWaveAnim, {
                    toValue: 0.45,
                    duration: MOTION.successPulseMs,
                    useNativeDriver: true,
                }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [micWaveAnim]);

    useEffect(() => {
        if (!isVoiceRecording || !voiceRecordingStartedAt) {
            setVoiceRecordingSeconds(0);
            return undefined;
        }

        const timer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - voiceRecordingStartedAt) / 1000);
            setVoiceRecordingSeconds(Math.max(0, elapsed));
        }, 500);

        return () => clearInterval(timer);
    }, [isVoiceRecording, voiceRecordingStartedAt]);

    useEffect(() => {
        if (!applicationId) return;
        setActiveChatId(applicationId);
        return () => {
            clearActiveChatId(applicationId);
        };
    }, [applicationId, clearActiveChatId, setActiveChatId]);

    useEffect(() => {
        locallySentMessageIdsRef.current = new Set();
        audioUrlCacheRef.current = new Map();
    }, [applicationId]);

    useEffect(() => {
        if (!applicationId) return;
        let isActive = true;
        joinedRoomRef.current = false;

        const getReadableError = (error, fallback) => {
            if (error?.response?.data?.message) return error.response.data.message;
            if (error?.message === 'No internet connection') return 'No internet connection. Please check your network and try again.';
            if (error?.message === 'Network Error') return 'Unable to reach the server. Please try again.';
            if (error?.code === 'ECONNABORTED') return 'Request timed out. Please retry.';
            return fallback;
        };

        const fetchHistory = async () => {
            setHistoryError('');
            setIsLoading(true);
            const cacheKey = `@chat_history_${CHAT_HISTORY_CACHE_VERSION}_${applicationId}`;
            const requestNonce = Date.now();
            try {
                // 1. Try cache
                const cached = await AsyncStorage.getItem(cacheKey);
                if (cached && isActive) {
                    const cachedMessages = trimChatMessagesForMemory(JSON.parse(cached));
                    if (hasOwnMessageInList(cachedMessages)) {
                        hasTrackedChatStartRef.current = true;
                    }
                    setMessages(cachedMessages);
                    setIsLoading(false);
                }
            } catch (e) {
                logger.error("Chat cache error", e);
            }

            try {
                // 2. Fetch fresh history
                const { data } = await client.get(`/api/chat/${applicationId}`, {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    params: { _ts: requestNonce },
                    headers: {
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        Pragma: 'no-cache',
                        Expires: '0',
                    },
                });
                const validatedMessages = validateChatMessagesResponse(data, applicationId);
                if (isActive) {
                    const chronological = trimChatMessagesForMemory(
                        [...validatedMessages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
                    );
                    if (hasOwnMessageInList(chronological)) {
                        hasTrackedChatStartRef.current = true;
                    }
                    setMessages(chronological);
                    // 3. Update cache (max 100 messages to prevent unbounded bloat)
                    saveLimitedCache(cacheKey, chronological, 100);
                    setIsLoading(false);
                }
            } catch (err) {
                const statusCode = Number(err?.response?.status || err?.originalError?.response?.status || 0);
                if (err?.name === 'ApiValidationError') {
                    logValidationError(err, `/api/chat/${applicationId}`);
                }
                if (statusCode === 304) {
                    if (isActive) {
                        setIsLoading(false);
                    }
                    return;
                }
                if (isChatLockedByStatusError(err)) {
                    if (isActive) {
                        setHistoryError('');
                        setApplicationStatus('applied');
                    }
                } else {
                    logger.warn('Failed to fetch chat history', err?.message || err);
                }
                if (isActive) {
                    if (!isChatLockedByStatusError(err)) {
                        setHistoryError(getReadableError(err, 'Could not load chat history.'));
                    }
                    setIsLoading(false);
                }
            }

            try {
                // Keep chat lock state and header metadata synced with latest application
                const { data: applicationData } = await client.get(`/api/applications/${applicationId}`, {
                    __skipApiErrorHandler: true,
                    __allowWhenCircuitOpen: true,
                    params: { _ts: requestNonce + 1 },
                    headers: {
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        Pragma: 'no-cache',
                        Expires: '0',
                    },
                });
                const application = applicationData?.application || applicationData;
                const job = application?.job || {};
                const employer = application?.employer || {};
                const worker = application?.worker || {};
                const chatProfile = application?.chatProfile || {};
                const candidatePanel = chatProfile?.candidate || {};
                const employerPanel = chatProfile?.employer || {};

                const workerName = [worker?.firstName, worker?.lastName].filter(Boolean).join(' ').trim() || worker?.name || 'Job Seeker';
                const employerName = employer?.companyName || employer?.name || job?.companyName || 'Employer';
                const currentRole = getPrimaryRoleFromUser(userInfo);
                const fallbackViewerSide = normalizeRoleForChatSide(currentRole || userInfo?.activeRole || userInfo?.primaryRole || userInfo?.role);
                const companyIdValue = employer?._id || employer?.id || null;
                const employerUserIdValue = String(
                    employer?.user?._id
                    || employer?.user
                    || employer?._id
                    || employer?.id
                    || application?.employer?._id
                    || application?.employer
                    || ''
                ).trim();
                const employerProfileIdValue = String(
                    employer?.profileId
                    || employer?.employerProfileId
                    || application?.employerProfile?._id
                    || application?.employerProfile
                    || ''
                ).trim();
                const workerUserIdValue = String(
                    worker?.user?._id
                    || worker?.user
                    || application?.worker?.user?._id
                    || application?.worker?.user
                    || ''
                ).trim();
                const workerProfileIdValue = String(
                    worker?._id
                    || worker?.workerProfileId
                    || application?.worker?._id
                    || application?.worker
                    || ''
                ).trim();
                const currentUserIdValue = normalizeIdForCompare(currentUserId);
                const employerUserIdNormalized = normalizeIdForCompare(employerUserIdValue);
                const workerUserIdNormalized = normalizeIdForCompare(workerUserIdValue);
                const viewerIsEmployerById = Boolean(
                    currentUserIdValue
                    && employerUserIdNormalized
                    && currentUserIdValue === employerUserIdNormalized
                );
                const viewerIsWorkerById = Boolean(
                    currentUserIdValue
                    && workerUserIdNormalized
                    && currentUserIdValue === workerUserIdNormalized
                );
                const resolvedViewerSide = (
                    viewerIsEmployerById && !viewerIsWorkerById
                        ? 'employer'
                        : (viewerIsWorkerById && !viewerIsEmployerById ? 'worker' : (fallbackViewerSide || 'worker'))
                );

                const workerSkills = Array.isArray(candidatePanel?.skills)
                    ? candidatePanel.skills
                    : ((Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : []).flatMap((roleProfile) => (
                        Array.isArray(roleProfile?.skills) ? roleProfile.skills : []
                    )));
                const fallbackExpectedSalary = (Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : [])
                    .map((roleProfile) => Number(roleProfile?.expectedSalary))
                    .find((value) => Number.isFinite(value) && value > 0);
                const candidateHighlights = [
                    { label: 'Match %', value: formatPercent(candidatePanel?.matchPercentage) },
                    { label: 'Trust Score', value: formatPercent(candidatePanel?.trustScore, '') },
                    { label: 'Badges', value: Array.isArray(candidatePanel?.badges) && candidatePanel.badges.length ? candidatePanel.badges.join(', ') : 'None' },
                    { label: 'Profile Completeness', value: formatPercent(candidatePanel?.profileCompleteness) },
                    { label: 'Availability', value: candidatePanel?.availability || (worker?.isAvailable ? 'Available' : 'Unavailable') },
                    { label: 'Salary Expectation', value: candidatePanel?.salaryExpectation || fallbackExpectedSalary ? `₹${Number(candidatePanel?.salaryExpectation || fallbackExpectedSalary).toLocaleString()}` : 'N/A' },
                ];
                const employerHighlights = [
                    { label: 'Salary', value: employerPanel?.jobDetails?.salary || job?.salaryRange || 'N/A' },
                    { label: 'Location', value: employerPanel?.jobDetails?.location || job?.location || 'N/A' },
                    { label: 'Shift', value: employerPanel?.jobDetails?.shift || job?.shift || 'N/A' },
                    { label: 'Posted Date', value: toDateLabel(employerPanel?.jobDetails?.postedDate || job?.createdAt) },
                    { label: 'Response Time', value: toHoursLabel(employerPanel?.responseTimeHours) },
                    { label: 'Trust Level', value: formatPercent(employerPanel?.trustLevel || employer?.trustScore, '') },
                    { label: 'Employer Rating', value: formatPercent(employerPanel?.employerRating || employer?.responseScore, '') },
                ];
                const candidateTrustTag = `Trust ${formatPercent(candidatePanel?.trustScore, '')}`;
                const candidateResponseTag = candidatePanel?.availability || (worker?.isAvailable ? 'Available now' : 'Availability pending');
                const employerTrustTag = employerPanel?.verificationBadge
                    ? `Verified • ${formatPercent(employerPanel?.trustLevel || employer?.trustScore, '')} trust`
                    : `${formatPercent(employerPanel?.trustLevel || employer?.trustScore, '')} trust`;
                const employerResponseTag = `${toHoursLabel(employerPanel?.responseTimeHours)} avg response`;

                const candidateData = mergeChatProfileData(
                    buildChatFallbackProfile({
                        profileMode: 'candidate',
                        otherPartyName: workerName,
                        jobTitle: job?.title || 'Job Seeker Profile',
                        application,
                    }),
                    {
                        name: candidatePanel?.name || workerName,
                        headline: job?.title || 'Job Seeker Profile',
                        industryTag: 'JOB SEEKER PROFILE',
                        summary: candidatePanel?.smartInterviewSummary || worker?.videoIntroduction?.transcript || 'No interview summary available yet.',
                        experienceYears: Number(worker?.totalExperience || 0),
                        skills: workerSkills.length ? workerSkills : ['Profile incomplete'],
                        highlights: candidateHighlights,
                        workHistory: Array.isArray(candidatePanel?.workHistory) ? candidatePanel.workHistory : [],
                        avatar: firstNonEmptyText(worker?.avatar, worker?.profilePicture, worker?.profileImage),
                    }
                );

                const employerData = mergeChatProfileData(
                    buildChatFallbackProfile({
                        profileMode: 'employer',
                        otherPartyName: employerName,
                        jobTitle: job?.title || 'Opportunity',
                        application,
                    }),
                    {
                        name: employerPanel?.companyName || employerName,
                        headline: `${job?.title || 'Opportunity'} · ${job?.location || 'Remote'}`,
                        industryTag: employerPanel?.verificationBadge ? 'VERIFIED EMPLOYER' : 'EMPLOYER',
                        mission: `Role: ${job?.title || 'N/A'}. ${String(job?.requirements || []).slice(0, 200)}`,
                        industry: employerPanel?.industry || employer?.industry || 'Not specified',
                        hq: employerPanel?.jobDetails?.location || employer?.location || 'Not specified',
                        contactInfo: {
                            partnership: employer?.email || 'N/A',
                            support: employer?.phone || 'N/A',
                            website: employerPanel?.website || employer?.website || 'N/A',
                        },
                        highlights: employerHighlights,
                        avatar: firstNonEmptyText(employer?.logo, employer?.avatar, employer?.profilePicture),
                    }
                );

                if (isActive) {
                    setApplicationStatus(normalizeApplicationStatus(application?.status));
                    setChatParticipants({
                        employerId: employerUserIdValue,
                        workerUserId: workerUserIdValue,
                        employerProfileId: employerProfileIdValue,
                        workerProfileId: workerProfileIdValue,
                    });
                    setChatMeta((prev) => ({
                        ...prev,
                        otherPartyName: resolvedViewerSide === 'employer' ? workerName : employerName,
                        jobTitle: job?.title || 'Opportunity',
                        companyId: companyIdValue,
                        profileMode: resolvedViewerSide === 'employer' ? 'candidate' : 'employer',
                        profileData: resolvedViewerSide === 'employer' ? candidateData : employerData,
                        trustTag: resolvedViewerSide === 'employer' ? candidateTrustTag : employerTrustTag,
                        responseTag: resolvedViewerSide === 'employer' ? candidateResponseTag : employerResponseTag,
                    }));
                }
            } catch (err) {
                logger.warn('Could not load application metadata for chat:', err?.message || err);
                if (isActive) {
                    setChatMeta((prev) => ({
                        ...prev,
                        profileData: mergeChatProfileData(
                            buildChatFallbackProfile({
                                profileMode: prev.profileMode,
                                otherPartyName: prev.otherPartyName,
                                jobTitle: prev.jobTitle,
                                application: routeApplication,
                            }),
                            prev.profileData
                        ),
                    }));
                }
            }
        };
        fetchHistory();

        // Setup Socket
        const handleNewMessage = (msg) => {
            const normalizedMessage = normalizeIncomingMessagePayload(msg);
            const incomingId = normalizedMessage?._id ? String(normalizedMessage._id) : null;
            setApplicationStatus((prev) => (isChatEnabledStatus(prev) ? prev : 'shortlisted'));
            setMessages((prev) => {
                if (incomingId && prev.some((item) => String(item?._id || '') === incomingId)) {
                    return prev;
                }
                return trimChatMessagesForMemory([...prev, normalizedMessage]);
            });
        };
        const setSocketConnectionState = (nextStatus) => {
            setConnectionStatus((prev) => (prev === nextStatus ? prev : nextStatus));
            setSocketStatus(nextStatus);
        };
        const handleSocketDisconnect = () => {
            joinedRoomRef.current = false;
            if (reconnectBannerDelayRef.current) return;
            reconnectBannerDelayRef.current = setTimeout(() => {
                reconnectBannerDelayRef.current = null;
                setSocketConnectionState('reconnecting');
            }, 300);
        };
        const emitJoinChat = () => {
            SocketService.emit('join_chat', { applicationId }, (ack) => {
                if (ack?.ok) {
                    joinedRoomRef.current = true;
                }
            });
        };
        const handleSocketConnect = () => {
            if (reconnectBannerDelayRef.current) {
                clearTimeout(reconnectBannerDelayRef.current);
                reconnectBannerDelayRef.current = null;
            }
            setSocketConnectionState('connected');
            emitJoinChat(); // SOCKET_VERIFIED
        };
        const handleJoinedRoom = ({ applicationId: joinedApplicationId }) => {
            if (String(joinedApplicationId || '') === String(applicationId || '')) {
                joinedRoomRef.current = true;
            }
        };
        const handleApplicationStatusUpdated = ({ applicationId: updatedApplicationId, status }) => {
            if (String(updatedApplicationId || '') !== String(applicationId || '')) return;
            if (status) {
                setApplicationStatus(normalizeApplicationStatus(status));
            }
        };

        SocketService.on('receiveMessage', handleNewMessage);
        SocketService.on('new_message', handleNewMessage);

        // Typing indicators — Feature 4
        const handleUserTyping = ({ userId }) => {
            if (userId !== userInfo?._id) setIsOtherTyping(true);
        };
        const handleUserStopTyping = ({ userId }) => {
            if (userId !== userInfo?._id) setIsOtherTyping(false);
        };

        // Read receipts — Feature 5
        const handleMessagesReadAck = ({ userId, readAt }) => {
            if (userId !== userInfo?._id) setLastReadByOther(readAt);
        };
        SocketService.on('user_typing', handleUserTyping);
        SocketService.on('user_stop_typing', handleUserStopTyping);
        SocketService.on('messages_read_ack', handleMessagesReadAck);
        SocketService.on('disconnect', handleSocketDisconnect);
        SocketService.on('connect', handleSocketConnect);
        SocketService.on('joined_room', handleJoinedRoom);
        SocketService.on('application_status_updated', handleApplicationStatusUpdated);

        // Ensure we join the room if connected
        emitJoinChat(); // SOCKET_VERIFIED
        const joinRetryInterval = setInterval(() => {
            if (!joinedRoomRef.current) {
                emitJoinChat();
            }
        }, 4000);

        return () => {
            isActive = false;
            SocketService.off('receiveMessage', handleNewMessage);
            SocketService.off('new_message', handleNewMessage);
            SocketService.off('user_typing', handleUserTyping);
            SocketService.off('user_stop_typing', handleUserStopTyping);
            SocketService.off('messages_read_ack', handleMessagesReadAck);
            SocketService.off('disconnect', handleSocketDisconnect);
            SocketService.off('connect', handleSocketConnect);
            SocketService.off('joined_room', handleJoinedRoom);
            SocketService.off('application_status_updated', handleApplicationStatusUpdated);
            if (typingTimeout.current) clearTimeout(typingTimeout.current);
            if (reconnectBannerDelayRef.current) {
                clearTimeout(reconnectBannerDelayRef.current);
                reconnectBannerDelayRef.current = null;
            }
            clearInterval(joinRetryInterval);
        };
    }, [applicationId, userInfo?.activeRole, userInfo?.primaryRole, userInfo?.role, reloadKey, setSocketStatus, hasOwnMessageInList, routeApplication]);

    // Emit read receipts when messages load or change — Feature 5
    useEffect(() => {
        if (!applicationId || !userInfo) return;
        SocketService.emit('messages_read', { roomId: applicationId, userId: userInfo._id });
    }, [applicationId, userInfo, messages.length]);

    useEffect(() => {
        previousRowCountRef.current = 0;
        hasInitialScrollRef.current = false;
    }, [applicationId]);

    const getMessageStatus = useCallback((message) => {
        if (!isMessageFromViewer(message)) return null;
        if (lastReadByOther && new Date(lastReadByOther) >= new Date(message.createdAt || message.timestamp)) return 'seen';
        return 'sent';
    }, [isMessageFromViewer, lastReadByOther]);

    const sendMessageViaRest = useCallback(async (payloadObject = {}) => {
        const text = String(payloadObject?.text || '').trim();
        const clientMessageId = String(payloadObject?.clientMessageId || '').trim();
        if (!text || !applicationId) {
            throw new Error('Message payload is invalid.');
        }

        const { data } = await client.post('/api/chat', {
            applicationId,
            text,
            clientMessageId: clientMessageId || undefined,
        }, {
            __skipApiErrorHandler: true,
            __allowWhenCircuitOpen: true,
            timeout: 12000,
        });

        const createdMessage = (data && typeof data === 'object') ? data : null;
        const createdMessageId = String(createdMessage?._id || createdMessage?.id || '').trim();
        if (createdMessage && createdMessageId) {
            locallySentMessageIdsRef.current.add(createdMessageId);
            setMessages((prev) => {
                if (prev.some((item) => String(item?._id || item?.id || '') === createdMessageId)) {
                    return prev;
                }
                return trimChatMessagesForMemory([...prev, createdMessage]);
            });
        }
    }, [applicationId]);

    const sendMessage = async (payload = input) => {
        if (!userInfo || !currentUserId) return;
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Chat unlocks once this application is shortlisted.');
            return;
        }
        const isTextPayload = typeof payload === 'string';
        const trimmedText = isTextPayload ? payload.trim() : '';
        if (isTextPayload && !trimmedText) return;
        if (!applicationId) {
            Alert.alert('Chat unavailable', 'Missing conversation reference. Please refresh and retry.');
            return;
        }

        // Stop typing on send
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        SocketService.emit('stop_typing', { roomId: applicationId, userId: currentUserId });

        if (!hasTrackedChatStartRef.current) {
            const chatStartedPayload = {
                applicationId: String(applicationId || ''),
                source: 'chat_screen',
                messageType: isTextPayload ? 'text' : (payload?.type || 'unknown'),
            };
            trackEvent('CHAT_STARTED', chatStartedPayload);
            hasTrackedChatStartRef.current = true;
        }

        const generatedClientMessageId = `chat-${String(applicationId || '')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const payloadObject = isTextPayload
            ? { text: trimmedText, clientMessageId: generatedClientMessageId }
            : {
                ...(payload && typeof payload === 'object' ? payload : {}),
                clientMessageId: String(payload?.clientMessageId || generatedClientMessageId),
            };
        setSendError('');

        if (!SocketService.isConnected()) {
            if (isTextPayload) {
                setIsSendingMessage(true);
                try {
                    await sendMessageViaRest(payloadObject);
                    setPendingRetryPayload(null);
                    setSendError('');
                    triggerHaptic.light();
                    Animated.sequence([
                        Animated.timing(sendScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
                        Animated.spring(sendScale, { toValue: 1, stiffness: 220, damping: 14, mass: 0.6, useNativeDriver: true }),
                    ]).start();
                    setInput('');
                    return;
                } catch (_error) {
                    // Fall through to existing retry UX.
                } finally {
                    setIsSendingMessage(false);
                }
            }
            setPendingRetryPayload(payloadObject);
            setSendError('Connection lost. Retry once network is stable.');
            Alert.alert('Send failed', 'No live socket connection. Please retry.');
            return;
        }

        setIsSendingMessage(true);
        try {
            const ackPayload = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('No server confirmation received.'));
                }, 2800);

                SocketService.emit('sendMessage', {
                    applicationId,
                    senderId: currentUserId,
                    senderRole: resolvedViewerRoleSide || undefined,
                    ...payloadObject,
                }, (ack) => {
                    clearTimeout(timeout);
                    if (ack?.ok === false || ack?.success === false) {
                        reject(new Error(String(ack?.message || 'Message was not accepted by server.')));
                        return;
                    }
                    resolve(ack || { ok: true });
                });
            });
            const acknowledgedMessageId = String(ackPayload?.messageId || '').trim();
            if (acknowledgedMessageId) {
                locallySentMessageIdsRef.current.add(acknowledgedMessageId);
            }

            setPendingRetryPayload(null);
            triggerHaptic.light();
            Animated.sequence([
                Animated.timing(sendScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
                Animated.spring(sendScale, { toValue: 1, stiffness: 220, damping: 14, mass: 0.6, useNativeDriver: true }),
            ]).start();
            if (isTextPayload) setInput('');
        } catch (error) {
            if (isTextPayload) {
                try {
                    await sendMessageViaRest(payloadObject);
                    setPendingRetryPayload(null);
                    setSendError('');
                    triggerHaptic.light();
                    Animated.sequence([
                        Animated.timing(sendScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
                        Animated.spring(sendScale, { toValue: 1, stiffness: 220, damping: 14, mass: 0.6, useNativeDriver: true }),
                    ]).start();
                    setInput('');
                    return;
                } catch (_restError) {
                    // Keep existing retry UX when both socket and REST fail.
                }
            }
            setPendingRetryPayload(payloadObject);
            setSendError(error?.message || 'Message send failed. Please retry.');
            Alert.alert('Send failed', error?.message || 'Could not send this message.');
        } finally {
            setIsSendingMessage(false);
        }
    };

    const getPlayableAudioUrl = useCallback(async (message = {}) => {
        const messageId = normalizeObjectId(message?._id || message?.id)
            || String(message?._id || message?.id || '').trim();
        const rawAudioUrl = String(message?.audioUrl || message?.fileUrl || message?.attachmentUrl || '').trim();
        const resolvedAudioUrl = resolveMediaUrl(rawAudioUrl);
        if (!resolvedAudioUrl && !rawAudioUrl) return '';
        if (!applicationId || !messageId) return resolvedAudioUrl || rawAudioUrl;

        const cacheKey = `${String(applicationId)}:${messageId}`;
        const cached = audioUrlCacheRef.current.get(cacheKey);
        if (cached) return cached;

        try {
            const { data } = await client.post('/api/chat/voice-url', {
                applicationId,
                messageId,
            }, {
                __skipApiErrorHandler: true,
                __allowWhenCircuitOpen: true,
                timeout: 6000,
            });
            const refreshedUrl = resolveMediaUrl(data?.url || '');
            if (refreshedUrl) {
                audioUrlCacheRef.current.set(cacheKey, refreshedUrl);
                return refreshedUrl;
            }
        } catch (_error) {
            // Ignore and fall back to stored URL.
        }
        return resolvedAudioUrl || rawAudioUrl;
    }, [applicationId]);

    const stopAudioPlayback = useCallback(async () => {
        const activeSound = audioPlaybackRef.current;
        if (activeSound) {
            try {
                activeSound.setOnPlaybackStatusUpdate(null);
            } catch (_error) {
                // Ignore cleanup callback errors.
            }
            try {
                await activeSound.stopAsync();
            } catch (_error) {
                // Ignore stop errors when already stopped.
            }
            try {
                await activeSound.unloadAsync();
            } catch (_error) {
                // Ignore unload errors during teardown.
            }
        }
        audioPlaybackRef.current = null;
        setPlayingAudioMessageId('');
        setPlayingAudioPositionMs(0);
        setPlayingAudioDurationMs(0);
    }, []);

    const toggleAudioPlayback = useCallback(async (message = {}) => {
        const messageId = String(message?._id || message?.id || '').trim();
        const rawAudioUrl = String(message?.audioUrl || message?.fileUrl || message?.attachmentUrl || '').trim();
        const directAudioUrl = resolveMediaUrl(rawAudioUrl) || rawAudioUrl;
        let refreshedAudioUrl = '';
        try {
            refreshedAudioUrl = await withPromiseTimeout(
                getPlayableAudioUrl(message),
                3200,
                'Voice URL refresh timed out'
            );
        } catch (_error) {
            refreshedAudioUrl = '';
        }
        const primaryAudioUrl = String(refreshedAudioUrl || directAudioUrl || '').trim();
        const playbackMessageKey = messageId || directAudioUrl;

        if (!playbackMessageKey || (!primaryAudioUrl && !applicationId)) {
            Alert.alert('Audio unavailable', 'Voice note is not available for playback.');
            return;
        }

        if (playingAudioMessageId === playbackMessageKey && audioPlaybackRef.current) {
            try {
                const status = await audioPlaybackRef.current.getStatusAsync();
                if (status?.isLoaded && status?.isPlaying) {
                    await audioPlaybackRef.current.pauseAsync();
                    return;
                }
                if (status?.isLoaded) {
                    await audioPlaybackRef.current.playAsync();
                    return;
                }
            } catch (_error) {
                await stopAudioPlayback();
            }
        }

        await stopAudioPlayback();

        const startPlayback = async (sourceUrl) => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    playsInSilentModeIOS: true,
                    interruptionModeIOS: 1,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: false,
                    staysActiveInBackground: false,
                });
            } catch (_error) {
                // Keep playback attempt alive even if audio mode update fails.
            }
            const playbackSource = Platform.OS === 'android'
                ? {
                    uri: sourceUrl,
                    overrideFileExtensionAndroid: resolveAudioExtensionForAndroid(sourceUrl, message?.mimeType || ''),
                }
                : { uri: sourceUrl };
            const { sound, status } = await Audio.Sound.createAsync(
                playbackSource,
                { shouldPlay: true, progressUpdateIntervalMillis: 250 },
                undefined,
                true
            );

            audioPlaybackRef.current = sound;
            setPlayingAudioMessageId(playbackMessageKey);
            setPlayingAudioPositionMs(Number(status?.positionMillis || 0));
            setPlayingAudioDurationMs(Number(status?.durationMillis || 0));

            sound.setOnPlaybackStatusUpdate((playbackStatus) => {
                if (!playbackStatus?.isLoaded) {
                    if (playbackStatus?.error) {
                        void stopAudioPlayback();
                    }
                    return;
                }
                setPlayingAudioPositionMs(Number(playbackStatus.positionMillis || 0));
                setPlayingAudioDurationMs(Number(playbackStatus.durationMillis || 0));
                if (playbackStatus.didJustFinish) {
                    void stopAudioPlayback();
                }
            });
        };

        const attemptedUrls = new Set();
        const tryStartPlayback = async (candidateUrl) => {
            const normalizedCandidate = String(candidateUrl || '').trim();
            if (!normalizedCandidate || attemptedUrls.has(normalizedCandidate)) {
                return false;
            }
            attemptedUrls.add(normalizedCandidate);
            try {
                await stopAudioPlayback();
                await startPlayback(normalizedCandidate);
                return true;
            } catch (_error) {
                return false;
            }
        };

        if (await tryStartPlayback(primaryAudioUrl)) return;
        if (await tryStartPlayback(directAudioUrl)) return;

        if (applicationId && messageId) {
            const cacheKey = `${String(applicationId)}:${messageId}`;
            audioUrlCacheRef.current.delete(cacheKey);
            try {
                const retryRefreshedUrl = await withPromiseTimeout(
                    getPlayableAudioUrl(message),
                    3600,
                    'Voice URL refresh timed out'
                );
                if (await tryStartPlayback(retryRefreshedUrl)) return;
            } catch (_error) {
                // Fall through to final raw-url playback attempts.
            }
        }

        if (await tryStartPlayback(resolveMediaUrl(rawAudioUrl))) return;
        if (await tryStartPlayback(rawAudioUrl)) return;

        await stopAudioPlayback();
        Alert.alert('Playback failed', 'Could not play this voice note right now.');
    }, [applicationId, getPlayableAudioUrl, playingAudioMessageId, stopAudioPlayback]);

    const handleRetrySend = async () => {
        if (isSendingMessage || uploadingFile || isVoiceStopping) return;
        if (pendingVoiceRetryFile) {
            await uploadVoiceMessage(pendingVoiceRetryFile);
            return;
        }
        if (!pendingRetryPayload) return;
        await sendMessage(pendingRetryPayload);
    };

    const handleInputChange = (text) => {
        if (!canChat) return;
        setInput(text);
        if (!currentUserId || !applicationId) return;
        // Emit typing
        SocketService.emit('typing', { roomId: applicationId, userId: currentUserId });
        // Debounce stop_typing
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => {
            SocketService.emit('stop_typing', { roomId: applicationId, userId: currentUserId });
        }, 1500);
    };

    const handleStartVideoCall = () => {
        if (!applicationId) return;
        initiateCall(SocketService, applicationId, { callerId: currentUserId });
        navigation.navigate('VideoCall', {
            roomId: applicationId,
            applicationId,
            otherPartyName: chatMeta.otherPartyName,
            isCaller: true,
            callType: 'video',
        });
    };

    const handleStartAudioCall = () => {
        if (!applicationId) return;
        initiateCall(SocketService, applicationId, { callerId: currentUserId, callType: 'audio' });
        navigation.navigate('VideoCall', {
            roomId: applicationId,
            applicationId,
            otherPartyName: chatMeta.otherPartyName,
            isCaller: true,
            callType: 'audio',
        });
    };

    const uploadAttachment = async (file) => {
        if (!file || !applicationId) return;

        const fileSize = Number(file?.size || 0);
        if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
            Alert.alert('File too large', 'Attachments must be 10MB or smaller.');
            return;
        }

        const mimeType = String(file?.mimeType || file?.type || '').toLowerCase();
        if (mimeType && !ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
            Alert.alert('Unsupported file', 'Only PDF, DOC, DOCX, JPG, PNG, and WEBP are allowed.');
            return;
        }

        setUploadingFile(true);
        try {
            const formData = new FormData();
            formData.append('file', {
                uri: file.uri,
                name: file.name || 'attachment',
                type: mimeType || 'application/octet-stream',
            });
            formData.append('applicationId', applicationId);

            const { data } = await client.post('/api/chat/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const uploadedUrl = String(data?.url || '').trim();
            if (!uploadedUrl) {
                throw new Error('Upload did not return a valid file URL.');
            }

            await sendMessage({
                type: 'file',
                fileUrl: uploadedUrl,
                fileName: file.name || 'Attachment',
                fileSize,
            });
        } catch (e) {
            Alert.alert('Upload Failed', 'Could not upload file. Please try again.');
        } finally {
            setUploadingFile(false);
        }
    };

    const resetVoiceRecordingState = useCallback(() => {
        voiceRecordingRef.current = null;
        setIsVoiceRecording(false);
        setIsVoiceStopping(false);
        setVoiceRecordingStartedAt(0);
        setVoiceRecordingSeconds(0);
    }, []);

    const setRecordingAudioMode = useCallback(async (enabled) => {
        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: Boolean(enabled),
                playsInSilentModeIOS: true,
                interruptionModeIOS: 1,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                staysActiveInBackground: false,
            });
        } catch (_error) {
            // Ignore audio mode failures to avoid trapping UI in a recording state.
        }
    }, []);

    const uploadVoiceMessage = async (file) => {
        if (!file || !applicationId) return;
        const fileSize = Number(file?.size || 0);
        if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
            Alert.alert('File too large', 'Voice note must be 10MB or smaller.');
            return;
        }

        setUploadingFile(true);
        setIsUploadingVoiceNote(true);
        setPendingVoiceRetryFile(null);
        try {
            const resolvedMimeType = normalizeVoiceMimeType(
                file?.mimeType || file?.type,
                file?.uri || file?.name
            );
            const formData = new FormData();
            formData.append('audio', {
                uri: file.uri,
                name: file.name || `voice-${Date.now()}.m4a`,
                type: resolvedMimeType,
            });
            formData.append('applicationId', applicationId);

            const { data } = await client.post('/api/chat/voice-message', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                __skipApiErrorHandler: true,
                timeout: 60000,
            });
            const createdMessage = data?.message || null;
            const createdMessageId = String(createdMessage?._id || createdMessage?.id || '').trim();
            if (createdMessage && createdMessageId) {
                locallySentMessageIdsRef.current.add(createdMessageId);
                setMessages((prev) => {
                    if (prev.some((item) => String(item?._id || item?.id || '') === createdMessageId)) {
                        return prev;
                    }
                    return trimChatMessagesForMemory([...prev, createdMessage]);
                });
            }
            setSendError('');
            setPendingVoiceRetryFile(null);
        } catch (error) {
            const message = resolveApiErrorMessage(error, 'Could not send voice note right now.');
            setPendingVoiceRetryFile(file);
            setSendError(message);
            Alert.alert('Voice upload failed', message);
        } finally {
            setIsUploadingVoiceNote(false);
            setUploadingFile(false);
        }
    };

    const stopActiveVoiceRecording = useCallback(async ({ discard = false, silent = false } = {}) => {
        if (isVoiceStopping) return null;
        const activeRecording = voiceRecordingRef.current;
        if (!activeRecording) {
            resetVoiceRecordingState();
            await setRecordingAudioMode(false);
            return null;
        }

        setIsVoiceStopping(true);
        try {
            await withPromiseTimeout(
                activeRecording.stopAndUnloadAsync(),
                VOICE_STOP_TIMEOUT_MS,
                'Recording stop timed out'
            );
            await setRecordingAudioMode(false);
            const uri = activeRecording.getURI();
            resetVoiceRecordingState();

            if (discard || !uri) return null;

            return {
                uri,
                name: `voice-${Date.now()}.m4a`,
                mimeType: resolveVoiceMimeType(uri),
                size: 0,
            };
        } catch (_error) {
            try {
                await activeRecording.stopAndUnloadAsync();
            } catch (_ignoredError) {
                // Ignore secondary stop errors.
            }
            await setRecordingAudioMode(false);
            resetVoiceRecordingState();
            if (!discard && !silent) {
                Alert.alert('Recording failed', 'Could not stop voice note cleanly. Please try again.');
            }
            return null;
        }
    }, [isVoiceStopping, resetVoiceRecordingState, setRecordingAudioMode]);

    const startVoiceRecording = useCallback(async () => {
        if (isVoiceStopping || uploadingFile || isSendingMessage) return false;
        try {
            const permission = await Audio.requestPermissionsAsync();
            if (permission?.status !== 'granted') {
                Alert.alert('Microphone required', 'Please allow microphone access to record voice notes.');
                return false;
            }

            await setRecordingAudioMode(true);

            const recording = new Audio.Recording();
            await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
            await recording.startAsync();
            voiceRecordingRef.current = recording;
            setIsVoiceRecording(true);
            setIsVoiceStopping(false);
            setVoiceRecordingStartedAt(Date.now());
            setVoiceRecordingSeconds(0);
            return true;
        } catch (_error) {
            await setRecordingAudioMode(false);
            resetVoiceRecordingState();
            Alert.alert('Recording unavailable', 'Could not start microphone recording right now.');
            return false;
        }
    }, [isSendingMessage, isVoiceStopping, resetVoiceRecordingState, setRecordingAudioMode, uploadingFile]);

    const handlePickDocument = async () => {
        setShowAttachments(false);
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Document sharing unlocks once chat is approved.');
            return;
        }
        const result = await DocumentPicker.getDocumentAsync({
            type: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ],
            copyToCacheDirectory: true,
        });

        if (result.canceled) return;
        const file = result.assets?.[0];
        if (file) await uploadAttachment(file);
    };

    const handlePickVoiceNote = async () => {
        setShowAttachments(false);
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Voice sharing unlocks once chat is approved.');
            return;
        }
        if (isVoiceRecording) {
            const recordedFile = await stopActiveVoiceRecording();
            if (recordedFile) {
                await uploadVoiceMessage(recordedFile);
            }
            return;
        }
        if (uploadingFile || isSendingMessage || isVoiceStopping) return;

        setSendError('');
        setPendingVoiceRetryFile(null);
        await startVoiceRecording();
    };

    const handleDiscardVoiceNote = useCallback(async () => {
        if (!isVoiceRecording && !isVoiceStopping) return;
        await stopActiveVoiceRecording({ discard: true, silent: true });
    }, [isVoiceRecording, isVoiceStopping, stopActiveVoiceRecording]);

    const handleSendVoiceNote = useCallback(async () => {
        if (!isVoiceRecording || isVoiceStopping || uploadingFile || isSendingMessage) return;
        const recordedFile = await stopActiveVoiceRecording();
        if (recordedFile) {
            await uploadVoiceMessage(recordedFile);
        }
    }, [isSendingMessage, isVoiceRecording, isVoiceStopping, stopActiveVoiceRecording, uploadingFile]);

    useEffect(() => {
        if (!isVoiceRecording) return;
        if (voiceRecordingSeconds < VOICE_MAX_DURATION_SECONDS) return;
        void handleSendVoiceNote();
    }, [handleSendVoiceNote, isVoiceRecording, voiceRecordingSeconds]);

    const handlePickImage = async () => {
        setShowAttachments(false);
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Media sharing unlocks once chat is approved.');
            return;
        }
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.status !== 'granted') {
            Alert.alert('Permission needed', 'Please allow photo library access to share images.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.9,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset) return;
        await uploadAttachment({
            uri: asset.uri,
            name: asset.fileName || `gallery-${Date.now()}.jpg`,
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.fileSize,
        });
    };

    const handleTakePhoto = async () => {
        setShowAttachments(false);
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Camera sharing unlocks once chat is approved.');
            return;
        }
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (permission.status !== 'granted') {
            Alert.alert('Permission needed', 'Please allow camera access to take a photo.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.9,
        });
        if (result.canceled) return;
        const asset = result.assets?.[0];
        if (!asset) return;
        await uploadAttachment({
            uri: asset.uri,
            name: asset.fileName || `camera-${Date.now()}.jpg`,
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.fileSize,
        });
    };

    const openHubPanel = (panelId) => {
        setShowAttachments(false);
        setActiveHubPanel(panelId);
    };

    const loadHubPanelData = useCallback(async (panelId) => {
        if (!applicationId || !panelId) return;

        setHubError('');
        setHubLoading(true);
        try {
            if (panelId === 'timeline') {
                const { data } = await client.get(`/api/chat/enterprise/${applicationId}/timeline`, {
                    __skipApiErrorHandler: true,
                });
                setHiringTimeline(Array.isArray(data?.timeline) ? data.timeline : []);
                return;
            }
            if (panelId === 'profile') {
                if (isEmployer) {
                    const { data } = await client.get(`/api/chat/enterprise/${applicationId}/notes`, {
                        __skipApiErrorHandler: true,
                    });
                    setPrivateNotes(Array.isArray(data?.notes) ? data.notes : []);
                }
                return;
            }
            if (panelId === 'documents') {
                const { data } = await client.get(`/api/chat/enterprise/${applicationId}/documents`, {
                    __skipApiErrorHandler: true,
                });
                setChatDocuments(Array.isArray(data?.documents) ? data.documents : []);
                return;
            }
            if (panelId === 'escrow') {
                const { data } = await client.get(`/api/chat/enterprise/${applicationId}/escrow`, {
                    __skipApiErrorHandler: true,
                });
                setEscrowPanel(data?.escrow || null);
            }
        } catch (error) {
            setHubError(error?.response?.data?.message || 'Could not load this panel right now.');
        } finally {
            setHubLoading(false);
        }
    }, [applicationId, isEmployer]);

    const handleUploadHubDocument = useCallback(async () => {
        if (!applicationId) return;
        const picked = await DocumentPicker.getDocumentAsync({
            type: [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'image/jpeg',
                'image/png',
                'image/webp',
            ],
            copyToCacheDirectory: true,
        });
        if (picked.canceled) return;
        const file = picked.assets?.[0];
        if (!file?.uri) return;
        const fileSize = Number(file?.size || 0);
        if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
            Alert.alert('File too large', 'Document must be 10MB or smaller.');
            return;
        }

        setHubUploadingDocument(true);
        try {
            const formData = new FormData();
            formData.append('document', {
                uri: file.uri,
                name: file.name || 'document',
                type: String(file?.mimeType || file?.type || 'application/octet-stream'),
            });
            formData.append('documentType', 'general');

            await client.post(`/api/chat/enterprise/${applicationId}/documents`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                __skipApiErrorHandler: true,
            });
            await loadHubPanelData('documents');
        } catch (error) {
            Alert.alert('Upload failed', error?.response?.data?.message || 'Could not upload document right now.');
        } finally {
            setHubUploadingDocument(false);
        }
    }, [applicationId, loadHubPanelData]);

    useEffect(() => {
        if (!activeHubPanel) return;
        void loadHubPanelData(activeHubPanel);
    }, [activeHubPanel, loadHubPanelData]);

    const handleAttachmentPress = () => {
        if (uploadingFile || isVoiceRecording || isVoiceStopping) return;
        setShowAttachments((prev) => !prev);
    };

    useEffect(() => {
        void stopAudioPlayback();
    }, [applicationId, stopAudioPlayback]);

    useEffect(() => {
        return () => {
            void stopActiveVoiceRecording({ discard: true, silent: true });
            void stopAudioPlayback();
        };
    }, [stopActiveVoiceRecording, stopAudioPlayback]);

    const attachmentActions = [
        { key: 'gallery', label: 'Gallery', icon: '🖼️', tint: '#16a34a', onPress: handlePickImage },
        { key: 'camera', label: 'Camera', icon: '📷', tint: '#2563eb', onPress: handleTakePhoto },
        { key: 'document', label: 'Document', icon: '📄', tint: '#f59e0b', onPress: handlePickDocument },
        { key: 'voice', label: 'Voice', icon: '🎙️', tint: '#7c3aed', onPress: handlePickVoiceNote },
        { key: 'timeline', label: 'Timeline', icon: '📅', tint: '#475569', onPress: () => openHubPanel('timeline') },
        { key: 'profile', label: 'Profile', icon: '👤', tint: '#1d4ed8', onPress: () => openHubPanel('profile') },
        { key: 'info', label: 'Info', icon: 'ℹ️', tint: '#0891b2', onPress: () => setShowProfileModal(true) },
        { key: 'docs', label: 'Docs', icon: '🗂️', tint: '#ea580c', onPress: () => openHubPanel('documents') },
        { key: 'escrow', label: 'Escrow', icon: '🔐', tint: '#059669', onPress: () => openHubPanel('escrow') },
    ];
    const quickAttachmentActions = attachmentActions.slice(0, 4);
    const hubAttachmentActions = attachmentActions.slice(4);

    const closeHubPanel = () => {
        setActiveHubPanel(null);
    };

    const getHubPanelTitle = () => {
        if (activeHubPanel === 'timeline') return 'Timeline';
        if (activeHubPanel === 'profile') return 'Profile';
        if (activeHubPanel === 'documents') return 'Docs';
        if (activeHubPanel === 'escrow') return 'Escrow';
        return 'Details';
    };

    const renderReadReceipt = useCallback((status) => {
        if (!status) return null;
        const isSeen = status === 'seen';
        return (
            <View style={styles.readReceiptRow}>
                <Text style={[styles.readReceiptTicks, isSeen && styles.readReceiptTicksSeen]}>✓✓</Text>
                <Text style={[styles.readReceiptText, isSeen && styles.readReceiptSeen]}>
                    {isSeen ? 'Seen' : 'Delivered'}
                </Text>
            </View>
        );
    }, []);

    const renderTimelinePanel = () => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
            <Text style={styles.hubPanelTitle}>📅 Hiring Timeline</Text>
            <Text style={styles.hubPanelSubtitle}>Immutable record of hiring milestones for this application.</Text>

            <View style={styles.timelineTrack}>
                {APPLICATION_TIMELINE_MILESTONES.map((milestone, idx) => {
                    const event = findTimelineEventForMilestone(hiringTimeline, milestone);
                    const isComplete = Boolean(event);
                    return (
                        <View key={milestone.key} style={styles.tlRow}>
                            <View style={[styles.tlDotColumn, { alignItems: 'center' }]}>
                                <View style={[styles.tlDot, isComplete ? styles.tlDotComplete : styles.tlDotPending]}>
                                    <Text style={styles.tlDotIcon}>{isComplete ? '✓' : milestone.icon}</Text>
                                </View>
                                {idx < APPLICATION_TIMELINE_MILESTONES.length - 1 && (
                                    <View style={[styles.tlConnector, isComplete && styles.tlConnectorComplete]} />
                                )}
                            </View>
                            <View style={styles.tlContent}>
                                <Text style={[styles.tlLabel, isComplete && styles.tlLabelComplete]}>{milestone.label}</Text>
                                {isComplete && event?.occurredAt ? (
                                    <Text style={styles.tlTimestamp}>{new Date(event.occurredAt).toLocaleString()}</Text>
                                ) : (
                                    <Text style={styles.tlPendingLabel}>{isComplete ? 'Completed' : 'Pending'}</Text>
                                )}
                            </View>
                        </View>
                    );
                })}
            </View>

            {isEmployer && (
                <View style={[styles.hubCard, { marginTop: 16 }]}>
                    <Text style={styles.hubCardTitle}>🔔 Activity Log</Text>
                    {messages.filter((m) => m.type === 'system').length === 0 ? (
                        <Text style={styles.hubEmptyText}>No system events yet.</Text>
                    ) : messages.filter((m) => m.type === 'system').slice(-5).map((m, i) => (
                        <View key={i} style={styles.activityRow}>
                            <Text style={styles.activityIcon}>📋</Text>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.activityText}>{m.text}</Text>
                                <Text style={styles.activityTime}>{m.createdAt ? new Date(m.createdAt).toLocaleString() : ''}</Text>
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    );

    const renderProfilePanel = () => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
            <Text style={styles.hubPanelTitle}>
                {chatMeta.profileMode === 'candidate' ? '👤 Job Seeker Intelligence' : '🏢 Employer Intelligence'}
            </Text>
            <View style={styles.hubCard}>
                <Text style={styles.hubCardTitle}>{resolvedProfileData.name || chatMeta.otherPartyName}</Text>
                <Text style={styles.hubCardSubtitle}>{resolvedProfileData.headline}</Text>
                {Array.isArray(resolvedProfileData.highlights) && resolvedProfileData.highlights.length > 0 ? (
                    <View style={styles.hubHighlightGrid}>
                        {(resolvedProfileData.highlights || []).map((h, i) => (
                            <View key={i} style={styles.hubHighlightBox}>
                                <Text style={styles.hubHighlightLabel}>{h.label}</Text>
                                <Text style={styles.hubHighlightValue}>{h.value}</Text>
                            </View>
                        ))}
                    </View>
                ) : (
                    <Text style={styles.hubEmptyText}>Profile highlights will appear here.</Text>
                )}
            </View>
            {chatMeta.profileMode === 'candidate' && Array.isArray(resolvedProfileData.skills) && resolvedProfileData.skills.length > 0 && (
                <View style={styles.hubCard}>
                    <Text style={styles.hubCardTitle}>⚡ Skills</Text>
                    <View style={styles.skillPillRow}>
                        {resolvedProfileData.skills.map((s, i) => (
                            <View key={i} style={styles.skillPill}>
                                <Text style={styles.skillPillText}>{s}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}
            {resolvedProfileData.summary ? (
                <View style={styles.hubCard}>
                    <Text style={styles.hubCardTitle}>💬 Summary</Text>
                    <Text style={styles.hubCardBody}>{resolvedProfileData.summary}</Text>
                </View>
            ) : null}

            {isEmployer && (
                <View style={[styles.hubCard, { borderColor: '#fef3c7', borderWidth: 1.5 }]}>
                    <Text style={styles.hubCardTitle}>🔒 Private Notes (Employer Only)</Text>
                    <Text style={styles.hubCardSubtitle}>Not visible to candidate. Securely stored.</Text>
                    {privateNotes.length === 0 && <Text style={styles.hubEmptyText}>No notes yet.</Text>}
                    {privateNotes.map((note, i) => (
                        <View key={note._id || i} style={styles.noteRow}>
                            <Text style={styles.noteContent}>{note.content}</Text>
                            <Text style={styles.noteTime}>{note.createdAt ? new Date(note.createdAt).toLocaleDateString() : ''}</Text>
                        </View>
                    ))}
                    <View style={styles.noteInputRow}>
                        <TextInput
                            style={styles.noteInput}
                            placeholder="Add private note..."
                            placeholderTextColor="#94a3b8"
                            value={newNote}
                            onChangeText={setNewNote}
                            multiline
                            maxLength={5000}
                        />
                        <TouchableOpacity
                            style={styles.noteSubmitBtn}
                            disabled={!newNote.trim()}
                            onPress={async () => {
                                if (!newNote.trim() || !applicationId) return;
                                try {
                                    const { data } = await client.post(`/api/chat/enterprise/${applicationId}/notes`, {
                                        content: newNote.trim(),
                                    }, {
                                        __skipApiErrorHandler: true,
                                    });
                                    setPrivateNotes((prev) => [data.note, ...prev]);
                                    setNewNote('');
                                } catch (e) {
                                    Alert.alert('Note Error', 'Could not save note.');
                                }
                            }}
                        >
                            <Text style={styles.noteSubmitText}>Save</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </ScrollView>
    );

    const renderDocumentsPanel = () => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
            <Text style={styles.hubPanelTitle}>📄 Document Center</Text>
            <Text style={styles.hubPanelSubtitle}>Secure documents for this hiring. Max 10MB per file.</Text>

            {chatDocuments.length === 0 ? (
                <View style={styles.hubCard}>
                    <Text style={styles.hubEmptyText}>No documents uploaded yet.</Text>
                    <Text style={[styles.hubEmptyText, { marginTop: 8, color: '#64748b' }]}>
                        Upload resume, offer letter, contract, ID, or work agreement.
                    </Text>
                </View>
            ) : (
                chatDocuments.map((doc, i) => (
                    <View key={i} style={[styles.hubCard, styles.docRow]}>
                        <Text style={styles.docIcon}>📎</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.docName}>{doc.originalName || doc.s3Key?.split('/').pop()}</Text>
                            <Text style={styles.docMeta}>{doc.documentType} · {doc.size ? `${Math.round(doc.size / 1024)} KB` : ''}</Text>
                            <Text style={styles.docMeta}>{doc.lastModified ? new Date(doc.lastModified).toLocaleDateString() : ''}</Text>
                        </View>
                        <TouchableOpacity
                            style={styles.docDownloadBtn}
                            onPress={async () => {
                                try {
                                    const { data } = await client.post(`/api/chat/enterprise/${applicationId}/documents/download`, {
                                        documentKey: doc.s3Key,
                                    }, {
                                        __skipApiErrorHandler: true,
                                    });
                                    if (data.signedUrl) Linking.openURL(data.signedUrl);
                                } catch (e) {
                                    Alert.alert('Error', 'Could not generate download link.');
                                }
                            }}
                        >
                            <Text style={styles.docDownloadText}>⬇ Open</Text>
                        </TouchableOpacity>
                    </View>
                ))
            )}

            <TouchableOpacity
                style={styles.uploadDocBtn}
                onPress={handleUploadHubDocument}
                disabled={hubUploadingDocument}
            >
                <Text style={styles.uploadDocBtnText}>
                    {hubUploadingDocument ? 'Uploading...' : '+ Upload Document'}
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );

    const renderEscrowPanel = () => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
            <Text style={styles.hubPanelTitle}>🔐 Escrow Status</Text>
            <Text style={styles.hubPanelSubtitle}>Read-only. Pulled from payment state machine.</Text>

            {escrowPanel ? (
                <>
                    <View style={[styles.hubCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
                        <Text style={styles.escrowStatusLabel}>Status</Text>
                        <Text style={styles.escrowStatusValue}>
                            {escrowPanel.status === 'funded' ? '🔐 Funded & Locked' :
                                escrowPanel.status === 'release_pending' ? '⏳ Release Pending' :
                                    escrowPanel.status === 'released' ? '💸 Payment Released' :
                                        escrowPanel.status === 'disputed' ? '⚠️ Dispute Active' :
                                            escrowPanel.status === 'refunded' ? '↩️ Refunded' :
                                                '⬜ Not Funded'}
                        </Text>
                        <Text style={styles.escrowAmount}>₹{Number(escrowPanel.amountLocked || 0).toLocaleString()}</Text>
                        <Text style={styles.escrowCurrency}>{escrowPanel.currency || 'INR'}</Text>
                    </View>
                    {escrowPanel.fundedAt && (
                        <View style={styles.hubCard}>
                            <Text style={styles.hubHighlightLabel}>FUNDED AT</Text>
                            <Text style={styles.hubHighlightValue}>{new Date(escrowPanel.fundedAt).toLocaleString()}</Text>
                        </View>
                    )}
                    {escrowPanel.releasedAt && (
                        <View style={styles.hubCard}>
                            <Text style={styles.hubHighlightLabel}>RELEASED AT</Text>
                            <Text style={styles.hubHighlightValue}>{new Date(escrowPanel.releasedAt).toLocaleString()}</Text>
                        </View>
                    )}
                    <View style={styles.hubCard}>
                        <Text style={styles.hubCardBody}>
                            🔒 This panel is read-only. All escrow actions must be initiated through the official payment flow.
                        </Text>
                    </View>
                </>
            ) : (
                <View style={styles.hubCard}>
                    <Text style={styles.hubEmptyText}>No escrow record found for this application.</Text>
                    <Text style={[styles.hubEmptyText, { color: '#64748b', marginTop: 8 }]}>
                        Escrow is created when an offer is accepted and payment is initiated.
                    </Text>
                </View>
            )}
        </ScrollView>
    );

    const renderHubPanelBody = () => {
        if (hubLoading) {
            return (
                <View style={styles.hubStateWrap}>
                    <View style={styles.hubStateCard}>
                        <ActivityIndicator size="small" color={CHAT_ACCENT} />
                        <Text style={styles.hubStateText}>Loading panel...</Text>
                    </View>
                </View>
            );
        }

        if (hubError) {
            return (
                <View style={styles.hubStateWrap}>
                    <View style={styles.hubStateCard}>
                        <Text style={styles.hubStateErrorText}>{hubError}</Text>
                        <TouchableOpacity
                            style={styles.hubStateRetryBtn}
                            onPress={() => {
                                if (activeHubPanel) {
                                    void loadHubPanelData(activeHubPanel);
                                }
                            }}
                        >
                            <Text style={styles.hubStateRetryText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        if (activeHubPanel === 'timeline') return renderTimelinePanel();
        if (activeHubPanel === 'profile') return renderProfilePanel();
        if (activeHubPanel === 'documents') return renderDocumentsPanel();
        if (activeHubPanel === 'escrow') return renderEscrowPanel();
        return null;
    };

    const submitUserReport = async (userId) => {
        try {
            await client.post('/api/reports', { targetId: userId, targetType: 'user', reason: 'reported_from_chat' });
        } catch (e) { /* ignore */ }
        Alert.alert('User Reported', 'User reported. You can block them too.', [
            { text: 'Block User', style: 'destructive', onPress: safeGoBack },
            { text: 'OK', style: 'cancel' }
        ]);
    };

    const handleReportUser = () => {
        Alert.alert('Report User', 'Why are you reporting this user?', [
            { text: 'Spam', onPress: () => submitUserReport(applicationId) },
            { text: 'Harassment', onPress: () => submitUserReport(applicationId) },
            { text: 'Fake Profile', onPress: () => submitUserReport(applicationId) },
            { text: 'Cancel', style: 'cancel' }
        ]);
    };

    const formatTime = useCallback((iso) => {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }, []);

    const lastMyMessageId = useMemo(() => {
        if (messages.length === 0) return null;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const msg = messages[i];
            if (isMessageFromViewer(msg)) return msg._id;
        }
        return null;
    }, [isMessageFromViewer, messages]);

    const headerStatusText = [chatMeta.jobTitle, getApplicationStatusLabel(applicationStatus), chatMeta.responseTag, chatMeta.trustTag]
        .filter(Boolean)
        .join(' • ');
    const resolvedProfileData = useMemo(() => {
        const fallbackProfile = buildChatFallbackProfile({
            profileMode: chatMeta.profileMode,
            otherPartyName: chatMeta.otherPartyName,
            jobTitle: chatMeta.jobTitle,
            application: routeApplication,
        });
        return mergeChatProfileData(fallbackProfile, chatMeta.profileData);
    }, [chatMeta.jobTitle, chatMeta.otherPartyName, chatMeta.profileData, chatMeta.profileMode, routeApplication]);
    const showInitialChatSkeleton = isLoading && messages.length === 0;
    const showInlineHistorySync = isLoading && messages.length > 0;
    const showInlineHistoryError = Boolean(historyError) && messages.length > 0;
    const showAiRepliesBar = canChat
        && !showAttachments
        && !input.trim()
        && (aiReplyLoading || aiReplySuggestions.length > 0 || Boolean(aiReplyError));
    const messageRows = useMemo(() => {
        const rows = [];
        let previousDayKey = null;

        const isGrouped = (left, right) => {
            if (!left || !right) return false;
            const leftSender = typeof left.sender === 'object' ? left.sender?._id : left.sender;
            const rightSender = typeof right.sender === 'object' ? right.sender?._id : right.sender;
            if (!leftSender || !rightSender || leftSender !== rightSender) return false;

            const leftTs = Date.parse(left.createdAt || left.timestamp || '');
            const rightTs = Date.parse(right.createdAt || right.timestamp || '');
            if (!Number.isFinite(leftTs) || !Number.isFinite(rightTs)) return false;
            return Math.abs(rightTs - leftTs) <= (6 * 60 * 1000);
        };

        messages.forEach((message, index) => {
            const timestamp = Date.parse(message?.createdAt || message?.timestamp || '');
            const dateKey = Number.isFinite(timestamp)
                ? new Date(timestamp).toDateString()
                : 'Unknown Date';

            if (dateKey !== previousDayKey) {
                const label = Number.isFinite(timestamp)
                    ? new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Conversation';
                rows.push({
                    _rowType: 'date',
                    _rowId: `date-${dateKey}-${index}`,
                    label,
                });
                previousDayKey = dateKey;
            }

            const isMe = isMessageFromViewer(message);
            const prevMessage = messages[index - 1];
            const nextMessage = messages[index + 1];
            rows.push({
                _rowType: 'message',
                _rowId: String(message?._id || message?.id || `msg-${index}`),
                message,
                isMe,
                isGroupStart: !isGrouped(prevMessage, message),
                isGroupEnd: !isGrouped(message, nextMessage),
            });
        });

        return rows;
    }, [isMessageFromViewer, messages]);

    const scrollToLatest = useCallback((animated = false) => {
        if (!flatListRef.current) return;
        requestAnimationFrame(() => {
            flatListRef.current?.scrollToEnd({ animated });
        });
    }, []);

    useEffect(() => {
        const currentRowCount = messageRows.length + (isOtherTyping ? 1 : 0);
        if (currentRowCount <= 0) return;
        const previousRowCount = previousRowCountRef.current;
        const hasNewRows = currentRowCount > previousRowCount;

        if (!hasInitialScrollRef.current) {
            scrollToLatest(false);
            hasInitialScrollRef.current = true;
        } else if (hasNewRows || isOtherTyping) {
            scrollToLatest(true);
        }

        previousRowCountRef.current = currentRowCount;
    }, [isOtherTyping, messageRows.length, scrollToLatest]);

    const keyExtractor = useCallback((item, index) => String(item?._rowId || `row-${index}`), []);
    const typingFooter = useMemo(() => isOtherTyping ? (
        <View style={styles.typingWrapper}>
            <View style={styles.typingBubble}>
                <TypingIndicator />
            </View>
        </View>
    ) : null, [isOtherTyping]);

    const renderMessage = useCallback(({ item }) => {
        if (item?._rowType === 'date') {
            return (
                <View style={styles.dateDividerWrap}>
                    <View style={styles.dateDividerLine} />
                    <Text style={styles.dateDividerText}>{item.label}</Text>
                    <View style={styles.dateDividerLine} />
                </View>
            );
        }

        const message = item?.message || {};
        const isSystem = message.type === 'system';
        const isMe = Boolean(item?.isMe);
        const isLastMyMsg = lastMyMessageId && lastMyMessageId === message._id;
        const status = isLastMyMsg ? getMessageStatus(message) : null;

        if (isSystem) {
            const lowerText = String(message.text || '').toLowerCase();
            const isCallEvent = lowerText.includes('call');
            const callDuration = Number(message?.durationSeconds || message?.duration || 0);
            const durationLabel = callDuration > 0
                ? ` (${Math.floor(callDuration / 60)}m ${callDuration % 60}s)`
                : '';
            return (
                <View style={styles.sysMsgWrapper}>
                    <Text style={styles.sysMsgText}>
                        {isCallEvent ? `Call update: ${message.text}${durationLabel}` : message.text}
                    </Text>
                </View>
            );
        }

        const bubbleRadiusStyle = isMe
            ? {
                borderTopRightRadius: item?.isGroupStart ? 18 : 8,
                borderBottomRightRadius: item?.isGroupEnd ? 18 : 8,
            }
            : {
                borderTopLeftRadius: item?.isGroupStart ? 18 : 8,
                borderBottomLeftRadius: item?.isGroupEnd ? 18 : 8,
            };

        const messageType = resolveMessageType(message);

        if (messageType === 'file') {
            return (
                <View
                    style={[
                        styles.msgWrapper,
                        isMe ? styles.msgWrapperMe : styles.msgWrapperThem,
                        { marginTop: item?.isGroupStart ? 12 : 3 },
                    ]}
                >
                    <TouchableOpacity
                        style={[styles.bubble, styles.fileBubble, isMe ? styles.fileBubbleMe : styles.fileBubbleThem, bubbleRadiusStyle]}
                        onPress={() => message.fileUrl && Linking.openURL(message.fileUrl)}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.fileEmoji}>📄</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.fileName} numberOfLines={1}>{message.fileName || 'Document'}</Text>
                            <Text style={styles.fileMeta}>
                                {message.fileSize ? `${Math.round(message.fileSize / 1024)} KB · Tap to open` : 'Tap to open'}
                            </Text>
                        </View>
                    </TouchableOpacity>
                    {renderReadReceipt(status)}
                </View>
            );
        }

        if (messageType === 'audio') {
            const messageId = String(message?._id || message?.id || '');
            const hasAudioUrl = Boolean(resolveMediaUrl(message?.audioUrl || message?.fileUrl || message?.attachmentUrl || ''));
            const isPlayingThisMessage = Boolean(
                messageId
                && playingAudioMessageId === messageId
                && playingAudioDurationMs > 0
            );
            const audioProgressRatio = isPlayingThisMessage && playingAudioDurationMs > 0
                ? Math.min(1, Math.max(0, playingAudioPositionMs / playingAudioDurationMs))
                : 0;
            const progressWidth = `${Math.max(8, Math.round(audioProgressRatio * 100))}%`;
            const durationLabel = isPlayingThisMessage
                ? formatDurationFromMillis(playingAudioPositionMs)
                : '00:00';

            return (
                <View
                    style={[
                        styles.msgWrapper,
                        isMe ? styles.msgWrapperMe : styles.msgWrapperThem,
                        { marginTop: item?.isGroupStart ? 12 : 3 },
                    ]}
                >
                    <View style={[styles.bubble, styles.audioBubble, isMe ? styles.bubbleMe : styles.bubbleThem, bubbleRadiusStyle]}>
                        <TouchableOpacity
                            style={[styles.audioPlayButton, !hasAudioUrl && styles.actionBtnDisabled]}
                            activeOpacity={0.8}
                            onPress={() => {
                                if (!hasAudioUrl) return;
                                void toggleAudioPlayback(message);
                            }}
                            disabled={!hasAudioUrl}
                        >
                            <Text style={styles.audioPlayButtonText}>
                                {isPlayingThisMessage ? '❚❚' : '▶'}
                            </Text>
                        </TouchableOpacity>

                        <View style={styles.audioMetaColumn}>
                            <View style={styles.audioProgressTrack}>
                                <View style={[styles.audioProgressFill, { width: progressWidth }]} />
                            </View>
                            <View style={styles.audioMetaRow}>
                                <Text style={styles.audioMetaText} numberOfLines={1}>
                                    {isPlayingThisMessage ? 'Playing voice note' : 'Voice message'}
                                </Text>
                                <Text style={styles.audioDurationText}>{durationLabel}</Text>
                            </View>
                        </View>
                    </View>
                    <Text style={[styles.timeText, isMe ? styles.timeTextMe : styles.timeTextThem]}>
                        {formatTime(message.createdAt)}
                    </Text>
                    {renderReadReceipt(status)}
                </View>
            );
        }

        return (
            <View
                style={[
                    styles.msgWrapper,
                    isMe ? styles.msgWrapperMe : styles.msgWrapperThem,
                    { marginTop: item?.isGroupStart ? 12 : 3 },
                ]}
            >
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, bubbleRadiusStyle]}>
                    <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
                        {message.text}
                    </Text>
                    <Text style={[styles.timeText, isMe ? styles.timeTextMe : styles.timeTextThem]}>
                        {formatTime(message.createdAt)}
                    </Text>
                </View>
                {renderReadReceipt(status)}
            </View>
        );
    }, [formatTime, getMessageStatus, lastMyMessageId, playingAudioDurationMs, playingAudioMessageId, playingAudioPositionMs, renderReadReceipt, toggleAudioPlayback]);

    const renderHeader = () => (
        <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
            <TouchableOpacity style={styles.backBtn} onPress={safeGoBack}>
                <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.headerInfoContainer}
                activeOpacity={0.82}
                onPress={() => setShowProfileModal(true)}
            >
                <View style={styles.headerInfoText}>
                    <Text style={styles.headerName} numberOfLines={1}>{chatMeta.otherPartyName}</Text>
                    <Text style={styles.headerSub} numberOfLines={1}>{headerStatusText}</Text>
                </View>
            </TouchableOpacity>

            <View style={styles.headerActions}>
                <TouchableOpacity style={styles.headerActionBtn} onPress={handleStartVideoCall}>
                    <View style={styles.headerActionIconWrap}>
                        <IconVideo size={18} color="#fff" style={styles.headerActionIcon} />
                    </View>
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerActionBtn} onPress={handleStartAudioCall}>
                    <View style={styles.headerActionIconWrap}>
                        <IconPhone size={18} color="#fff" style={styles.headerActionIcon} />
                    </View>
                </TouchableOpacity>
            </View>
        </View>
    );

    if (!applicationId) {
        return (
            <View style={styles.container}>
                <EmptyState
                    icon={<Text style={{ fontSize: 40 }}>⚠️</Text>}
                    title="Chat Unavailable"
                    message="Missing application reference for this chat."
                    actionLabel="Go Back"
                    onAction={safeGoBack}
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {renderHeader()}
            {connectionStatus === 'reconnecting' && (
                <View style={styles.connectionBanner}>
                    <Text style={styles.connectionBannerText}>Reconnecting...</Text>
                </View>
            )}
            {!canChat && (
                <View style={styles.lockedBanner}>
                    <Text style={styles.lockedBannerText}>Chat unlocks once this application is shortlisted.</Text>
                </View>
            )}
            {showInlineHistorySync ? (
                <View style={styles.inlineSyncBanner}>
                    <ActivityIndicator size="small" color={CHAT_ACCENT} />
                    <Text style={styles.inlineSyncBannerText}>Syncing latest messages...</Text>
                </View>
            ) : null}
            {showInlineHistoryError ? (
                <View style={styles.inlineHistoryErrorBanner}>
                    <Text style={styles.inlineHistoryErrorText}>{historyError}</Text>
                    <TouchableOpacity
                        style={styles.inlineHistoryRetryBtn}
                        onPress={() => setReloadKey((prev) => prev + 1)}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.inlineHistoryRetryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            ) : null}
            {showInitialChatSkeleton ? (
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                    <SkeletonLoader height={60} style={{ borderRadius: 16, marginBottom: 12, width: '70%', alignSelf: 'flex-start' }} />
                    <SkeletonLoader height={60} style={{ borderRadius: 16, marginBottom: 12, width: '60%', alignSelf: 'flex-end' }} tone="tint" />
                    <SkeletonLoader height={60} style={{ borderRadius: 16, marginBottom: 12, width: '75%', alignSelf: 'flex-start' }} />
                </View>
            ) : historyError && messages.length === 0 ? (
                <EmptyState
                    icon={<Text style={{ fontSize: 40 }}>⚠️</Text>}
                    title="Could Not Load Chat"
                    message={historyError}
                    actionLabel="Retry"
                    onAction={() => setReloadKey((prev) => prev + 1)}
                />
            ) : (
                <FlatList
                    ref={flatListRef}
                    data={messageRows}
                    keyExtractor={keyExtractor}
                    renderItem={renderMessage}
                    style={styles.messagesSurface}
                    contentContainerStyle={[
                        styles.messagesList,
                        {
                            paddingBottom: SPACING.lg
                                + 72
                                + (sendError ? 44 : 0)
                                + (showAiRepliesBar ? 64 : 0)
                                + ((isVoiceRecording || isUploadingVoiceNote) ? 60 : 0),
                        },
                    ]}
                    showsVerticalScrollIndicator={false}
                    maxToRenderPerBatch={10}
                    windowSize={10}
                    removeClippedSubviews={true}
                    initialNumToRender={15}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                    automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                    ListFooterComponent={typingFooter}
                    extraData={lastReadByOther}
                />
            )}
            {sendError ? (
                <View style={styles.sendErrorBar}>
                    <Text style={styles.sendErrorText}>{sendError}</Text>
                    {(pendingRetryPayload || pendingVoiceRetryFile) ? (
                        <TouchableOpacity style={styles.sendRetryButton} onPress={handleRetrySend} disabled={isSendingMessage || uploadingFile}>
                            <Text style={styles.sendRetryText}>
                                {(isSendingMessage || uploadingFile) ? 'Retrying...' : 'Retry'}
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}
            {showAiRepliesBar ? (
                <View style={styles.aiRepliesBar}>
                    <View style={styles.aiRepliesHeader}>
                        <Text style={styles.aiRepliesTitle}>Gemini quick replies</Text>
                        <TouchableOpacity
                            style={styles.aiRepliesRefreshButton}
                            activeOpacity={0.85}
                            onPress={() => {
                                void requestAiReplySuggestions({ force: true });
                            }}
                            disabled={aiReplyLoading || !latestIncomingMessageText}
                        >
                            <Text style={styles.aiRepliesRefreshText}>
                                {aiReplyLoading ? 'Thinking...' : 'Refresh'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    {aiReplyError && !aiReplySuggestions.length ? (
                        <Text style={styles.aiRepliesErrorText}>{aiReplyError}</Text>
                    ) : (
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.aiRepliesScrollContent}
                        >
                            {aiReplySuggestions.map((suggestion, index) => (
                                <TouchableOpacity
                                    key={`ai-reply-${index}`}
                                    style={styles.aiReplyChip}
                                    activeOpacity={0.82}
                                    onPress={() => applyAiSuggestion(suggestion)}
                                >
                                    <Text style={styles.aiReplyChipText} numberOfLines={1}>
                                        {suggestion}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                            {aiReplyLoading && !aiReplySuggestions.length ? (
                                <View style={styles.aiReplyLoadingChip}>
                                    <ActivityIndicator size="small" color={CHAT_ACCENT} />
                                </View>
                            ) : null}
                        </ScrollView>
                    )}
                </View>
            ) : null}
            {isVoiceRecording ? (
                <View style={styles.voiceRecordingBanner}>
                    <View style={styles.voiceRecordingDot} />
                    <Text style={styles.voiceRecordingText}>
                        Recording voice note... tap Send or tap mic to stop.
                    </Text>
                    <Text style={styles.voiceRecordingTimer}>{formatDurationLabel(voiceRecordingSeconds)}</Text>
                    <View style={styles.voiceRecordingActions}>
                        <TouchableOpacity
                            style={styles.voiceSecondaryAction}
                            onPress={handleDiscardVoiceNote}
                            activeOpacity={0.85}
                            disabled={isVoiceStopping}
                        >
                            <Text style={styles.voiceSecondaryActionText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.voicePrimaryAction, isVoiceStopping && styles.voicePrimaryActionDisabled]}
                            onPress={handleSendVoiceNote}
                            activeOpacity={0.85}
                            disabled={isVoiceStopping}
                        >
                            <Text style={styles.voicePrimaryActionText}>{isVoiceStopping ? 'Stopping…' : 'Send'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ) : isUploadingVoiceNote ? (
                <View style={styles.voiceUploadingBanner}>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={styles.voiceUploadingText}>Sending voice note...</Text>
                </View>
            ) : null}

            <KeyboardAvoidingView
                enabled={Platform.OS === 'ios'}
                behavior="padding"
                keyboardVerticalOffset={insets.top + 6}
            >
                <View
                    style={[
                        styles.composerWrap,
                        Platform.OS === 'android' && keyboardInset > 0 ? { marginBottom: keyboardInset } : null,
                    ]}
                >
                <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
                    <TouchableOpacity
                        style={[styles.attachBtn, showAttachments && styles.attachBtnActive]}
                        onPress={handleAttachmentPress}
                        disabled={uploadingFile || isSendingMessage || isVoiceRecording || isVoiceStopping}
                    >
                        <View style={{ transform: [{ rotate: showAttachments ? '45deg' : '0deg' }] }}>
                            <IconPlus size={24} color={showAttachments ? CHAT_ACCENT_DARK : CHAT_ACCENT} />
                        </View>
                    </TouchableOpacity>

                    <View style={styles.inputWrap}>
                        <TextInput
                            style={styles.inputField}
                            placeholder="Type a message..."
                            placeholderTextColor="#94a3b8"
                            value={input}
                            onChangeText={handleInputChange}
                            multiline
                            editable={!uploadingFile && !isSendingMessage && canChat}
                        />
                    </View>

                    {(uploadingFile || isSendingMessage) ? (
                        <View style={styles.uploadingIndicator}>
                            <ActivityIndicator size="small" color={CHAT_ACCENT} />
                        </View>
                    ) : input.trim() ? (
                        <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                            <TouchableOpacity style={[styles.sendBtn, !canChat && styles.actionBtnDisabled]} onPress={() => sendMessage()} disabled={!canChat || isSendingMessage}>
                                <IconSend size={18} color="#fff" />
                            </TouchableOpacity>
                        </Animated.View>
                    ) : (
                        <TouchableOpacity
                            style={[
                                styles.micBtn,
                                isVoiceRecording && styles.micBtnRecording,
                                isVoiceStopping && styles.micBtnStopping,
                                !canChat && styles.actionBtnDisabled,
                            ]}
                            activeOpacity={0.75}
                            onPress={handlePickVoiceNote}
                            disabled={!canChat || uploadingFile || isSendingMessage || isVoiceStopping}
                        >
                            {isVoiceRecording ? (
                                <View style={styles.voiceStopSquare} />
                            ) : (
                                <>
                                    <Animated.View style={[styles.micWaveWrap, { opacity: micWaveAnim }]}>
                                        <View style={[styles.micWaveBar, { height: 8 }]} />
                                        <View style={[styles.micWaveBar, { height: 13 }]} />
                                        <View style={[styles.micWaveBar, { height: 9 }]} />
                                    </Animated.View>
                                    <IconMic size={24} color={CHAT_ACCENT} />
                                </>
                            )}
                        </TouchableOpacity>
                    )}
                </View>
                </View>
            </KeyboardAvoidingView>

            <Modal
                visible={showAttachments}
                transparent
                animationType="fade"
                onRequestClose={() => setShowAttachments(false)}
            >
                <Pressable style={styles.attachmentsOverlay} onPress={() => setShowAttachments(false)}>
                    <Pressable style={styles.attachmentsSheet} onPress={() => { }}>
                        <View style={styles.attachmentsHandle} />
                        <Text style={styles.attachmentsTitle}>Share from +</Text>
                        <Text style={styles.attachmentsSubtitle}>WhatsApp-style quick actions for chat, media, and workflow tools.</Text>

                        <Text style={styles.attachmentsSectionTitle}>Share</Text>
                        <View style={styles.attachmentsGrid}>
                            {quickAttachmentActions.map((action) => (
                                <TouchableOpacity key={action.key} style={styles.attachActionItem} onPress={action.onPress} activeOpacity={0.85}>
                                    <View style={[styles.attachActionBubble, { borderColor: action.tint }]}>
                                        <Text style={[styles.attachActionIcon, { color: action.tint }]}>{action.icon}</Text>
                                    </View>
                                    <Text style={styles.attachActionLabel}>{action.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.attachmentsSectionTitle}>Chat Tools</Text>
                        <View style={styles.attachmentsGrid}>
                            {hubAttachmentActions.map((action) => (
                                <TouchableOpacity key={action.key} style={styles.attachActionItem} onPress={action.onPress} activeOpacity={0.85}>
                                    <View style={[styles.attachActionBubble, { borderColor: action.tint }]}>
                                        <Text style={[styles.attachActionIcon, { color: action.tint }]}>{action.icon}</Text>
                                    </View>
                                    <Text style={styles.attachActionLabel}>{action.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </Pressable>
                </Pressable>
            </Modal>

            <Modal
                visible={Boolean(activeHubPanel)}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={closeHubPanel}
            >
                <View style={styles.hubOverlayShell}>
                    <View style={[styles.hubOverlayHeader, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.hubOverlayBackBtn} onPress={closeHubPanel}>
                            <Text style={styles.hubOverlayBackIcon}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.hubOverlayTitle}>{getHubPanelTitle()}</Text>
                    </View>
                    {renderHubPanelBody()}
                </View>
            </Modal>

            {/* Profile Detail Modal fully mapped to ContactInfoView */}
            <Modal
                visible={showProfileModal}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={() => setShowProfileModal(false)}
            >
                <View style={styles.hubOverlayShell}>
                    <View style={[styles.hubOverlayHeader, { paddingTop: insets.top + 10 }]}>
                        <TouchableOpacity style={styles.hubOverlayBackBtn} onPress={() => setShowProfileModal(false)}>
                            <Text style={styles.hubOverlayBackIcon}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.hubOverlayTitle}>
                            {chatMeta.profileMode === 'candidate' ? getProfileTitleForRole('worker') : getProfileTitleForRole('employer')}
                        </Text>
                    </View>
                    <ContactInfoView
                        hideHeader
                        presentation="modal"
                        mode={chatMeta.profileMode}
                        title={chatMeta.profileMode === 'candidate' ? getProfileTitleForRole('worker') : getProfileTitleForRole('employer')}
                        data={resolvedProfileData}
                        onBack={() => setShowProfileModal(false)}
                        onVideoPress={handleStartVideoCall}
                        onCallPress={handleStartAudioCall}
                    />
                </View>
            </Modal>
        </View>
    );
}
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    connectionBanner: {
        backgroundColor: '#fff7ed',
        borderBottomWidth: 1,
        borderBottomColor: '#fed7aa',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    connectionBannerText: {
        color: '#9a3412',
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
    },
    sendErrorBar: {
        marginHorizontal: 12,
        marginBottom: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: '#fee2e2',
        borderWidth: 1,
        borderColor: '#fecaca',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    sendErrorText: {
        color: '#b91c1c',
        fontSize: 12,
        fontWeight: '700',
        flex: 1,
    },
    sendRetryButton: {
        borderRadius: 8,
        backgroundColor: '#dc2626',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    sendRetryText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
    },
    lockedBanner: {
        backgroundColor: CHAT_ACCENT_SOFT,
        borderBottomWidth: 1,
        borderBottomColor: CHAT_ACCENT_BORDER,
        paddingVertical: 7,
        paddingHorizontal: 12,
    },
    lockedBannerText: {
        color: CHAT_ACCENT_DARK,
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
    },

    // Plus Sheet (WhatsApp-inspired)
    attachmentsOverlay: {
        flex: 1,
        backgroundColor: 'rgba(2, 6, 23, 0.48)',
        justifyContent: 'flex-end',
    },
    attachmentsSheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 20,
        maxHeight: '74%',
    },
    attachmentsHandle: {
        width: 42,
        height: 4,
        borderRadius: 999,
        backgroundColor: '#d1d5db',
        alignSelf: 'center',
        marginBottom: 12,
    },
    attachmentsTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
    },
    attachmentsSubtitle: {
        marginTop: 4,
        fontSize: 12,
        color: '#64748b',
        fontWeight: '500',
        marginBottom: 12,
    },
    attachmentsSectionTitle: {
        fontSize: 11,
        color: '#94a3b8',
        textTransform: 'uppercase',
        letterSpacing: 1,
        fontWeight: '800',
        marginTop: 8,
        marginBottom: 10,
    },
    attachmentsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        rowGap: 14,
        columnGap: 12,
        marginBottom: 8,
    },
    attachActionItem: {
        width: '22%',
        alignItems: 'center',
    },
    attachActionBubble: {
        width: 56,
        height: 56,
        borderRadius: 18,
        borderWidth: 1.5,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
    },
    attachActionIcon: {
        fontSize: 24,
        fontWeight: '700',
    },
    attachActionLabel: {
        marginTop: 6,
        fontSize: 11,
        fontWeight: '700',
        color: '#334155',
        textAlign: 'center',
    },

    // Hub Overlay Panels (opened from +)
    hubOverlayShell: {
        flex: 1,
        backgroundColor: theme.background,
    },
    hubOverlayHeader: {
        backgroundColor: CHAT_ACCENT,
        paddingHorizontal: 14,
        paddingBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    hubOverlayBackBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: 'rgba(255,255,255,0.18)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    hubOverlayBackIcon: {
        color: '#ffffff',
        fontSize: 24,
        fontWeight: '300',
        marginBottom: 2,
    },
    hubOverlayTitle: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },
    hubStateWrap: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    hubStateCard: {
        width: '100%',
        maxWidth: 340,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: CHAT_ACCENT_BORDER,
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 20,
        alignItems: 'center',
        gap: 10,
    },
    hubStateText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
        textAlign: 'center',
    },
    hubStateErrorText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#b91c1c',
        textAlign: 'center',
        lineHeight: 19,
    },
    hubStateRetryBtn: {
        marginTop: 4,
        borderRadius: 10,
        backgroundColor: CHAT_ACCENT,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    hubStateRetryText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#ffffff',
    },

    // ── Hub Panel Layout ──
    hubPanelContainer: { padding: 16, paddingBottom: 40 },
    hubPanelTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 4 },
    hubPanelSubtitle: { fontSize: 12, color: '#64748b', fontWeight: '500', marginBottom: 16 },
    hubCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: CHAT_ACCENT_BORDER,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 2,
        elevation: 1,
    },
    hubCardTitle: { fontSize: 15, fontWeight: '800', color: '#1e293b', marginBottom: 4 },
    hubCardSubtitle: { fontSize: 12, color: '#64748b', fontWeight: '500', marginBottom: 8 },
    hubCardBody: { fontSize: 13, color: '#475569', lineHeight: 20 },
    hubEmptyText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', paddingVertical: 8 },
    hubHighlightGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
    hubHighlightBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, flex: 1, minWidth: 100, borderWidth: 1, borderColor: '#e2e8f0' },
    hubHighlightLabel: { fontSize: 9, fontWeight: '900', color: '#94a3b8', letterSpacing: 1, marginBottom: 3 },
    hubHighlightValue: { fontSize: 12, fontWeight: '800', color: '#1e293b' },

    // ── Timeline specific ──
    timelineTrack: { marginTop: 8 },
    tlRow: { flexDirection: 'row', marginBottom: 0, alignItems: 'flex-start' },
    tlDotColumn: { width: 32, alignItems: 'center', paddingTop: 2 },
    tlDot: {
        width: 28,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1,
    },
    tlDotComplete: { backgroundColor: CHAT_ACCENT },
    tlDotPending: { backgroundColor: '#e2e8f0', borderWidth: 1, borderColor: '#cbd5e1' },
    tlDotIcon: { fontSize: 12, color: '#fff' },
    tlConnector: { width: 2, flex: 1, minHeight: 32, backgroundColor: '#e2e8f0', marginVertical: 2 },
    tlConnectorComplete: { backgroundColor: CHAT_ACCENT },
    tlContent: { flex: 1, paddingLeft: 12, paddingBottom: 20, paddingTop: 4 },
    tlLabel: { fontSize: 13, fontWeight: '600', color: '#94a3b8' },
    tlLabelComplete: { color: '#1e293b', fontWeight: '800' },
    tlTimestamp: { fontSize: 11, color: '#64748b', marginTop: 2 },
    tlPendingLabel: { fontSize: 11, color: '#cbd5e1', fontStyle: 'italic', marginTop: 2 },
    activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
    activityIcon: { fontSize: 16 },
    activityText: { fontSize: 13, color: '#334155', fontWeight: '500' },
    activityTime: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

    // ── Skills ──
    skillPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    skillPill: { backgroundColor: CHAT_ACCENT_SOFT, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER },
    skillPillText: { fontSize: 12, fontWeight: '700', color: CHAT_ACCENT_TEXT },

    // ── Private Notes ──
    noteRow: { backgroundColor: '#fefce8', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#fde68a' },
    noteContent: { fontSize: 13, color: '#78350f', lineHeight: 19 },
    noteTime: { fontSize: 10, color: '#a16207', marginTop: 4, fontWeight: '600' },
    noteInputRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' },
    noteInput: { flex: 1, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', padding: 10, fontSize: 13, color: '#1e293b', minHeight: 44, maxHeight: 90 },
    noteSubmitBtn: { backgroundColor: CHAT_ACCENT, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    noteSubmitText: { color: '#fff', fontSize: 12, fontWeight: '800' },

    // ── Documents ──
    docRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    docIcon: { fontSize: 24 },
    docName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
    docMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
    docDownloadBtn: { backgroundColor: CHAT_ACCENT_SOFT, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER },
    docDownloadText: { fontSize: 12, fontWeight: '700', color: CHAT_ACCENT_TEXT },
    uploadDocBtn: { backgroundColor: CHAT_ACCENT, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    uploadDocBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

    // ── Escrow ──
    escrowStatusLabel: { fontSize: 10, fontWeight: '900', color: '#166534', letterSpacing: 1, marginBottom: 4 },
    escrowStatusValue: { fontSize: 18, fontWeight: '800', color: '#15803d', marginBottom: 8 },
    escrowAmount: { fontSize: 32, fontWeight: '900', color: '#0f172a', marginTop: 8 },
    escrowCurrency: { fontSize: 12, color: '#94a3b8', fontWeight: '700', marginBottom: 4 },

    // Header
    header: {
        backgroundColor: CHAT_ACCENT,
        paddingHorizontal: 16,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 4,
        zIndex: 10,
    },
    backBtn: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderRadius: 18,
    },
    backArrow: { color: '#fff', fontSize: 24, lineHeight: 24, fontWeight: '300', textAlign: 'center' },
    headerInfoContainer: {
        flex: 1,
        justifyContent: 'center',
        paddingVertical: 4,
        paddingHorizontal: 2,
    },
    headerInfoText: { flex: 1 },
    headerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
    headerSub: { color: CHAT_ACCENT_TEXT_LIGHT, fontSize: 11, fontWeight: '500', marginTop: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
    headerActionBtn: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.18)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
    },
    headerActionIconWrap: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerActionIcon: { alignSelf: 'center' },
    headerActionInfo: { color: '#fff', fontSize: 18, fontWeight: '800' },
    inlineSyncBanner: {
        marginHorizontal: 12,
        marginTop: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inlineSyncBannerText: {
        color: '#5b21b6',
        fontSize: 12,
        fontWeight: '700',
    },
    inlineHistoryErrorBanner: {
        marginHorizontal: 12,
        marginTop: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fff1f2',
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    inlineHistoryErrorText: {
        color: '#9f1239',
        fontSize: 12,
        fontWeight: '700',
        flex: 1,
    },
    inlineHistoryRetryBtn: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#fda4af',
        backgroundColor: '#ffe4e6',
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    inlineHistoryRetryText: {
        color: '#9f1239',
        fontSize: 11,
        fontWeight: '800',
    },

    // Messages
    messagesSurface: { flex: 1 },
    messagesList: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.lg, paddingTop: SPACING.md },
    dateDividerWrap: { marginTop: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
    dateDividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
    dateDividerText: { fontSize: 11, color: '#64748b', fontWeight: '700' },
    sysMsgWrapper: { alignItems: 'center', marginVertical: 16 },
    sysMsgText: {
        backgroundColor: '#fef3c7',
        color: '#92400e',
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 1,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#fde68a',
    },

    msgWrapper: { maxWidth: '82%', marginBottom: 10 },
    msgWrapperMe: { alignSelf: 'flex-end' },
    msgWrapperThem: { alignSelf: 'flex-start' },
    bubble: { paddingHorizontal: SPACING.smd + 2, paddingVertical: SPACING.sm + 1, borderRadius: RADIUS.lg, ...SHADOWS.sm },
    bubbleMe: { backgroundColor: CHAT_ACCENT_SOFT, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER },
    bubbleThem: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#f0ebf6' },
    bubbleText: { fontSize: 14, lineHeight: 21 },
    bubbleTextMe: { color: '#312e81' },
    bubbleTextThem: { color: '#0f172a' },
    timeText: { fontSize: 10, marginTop: 5, alignSelf: 'flex-end' },
    timeTextMe: { color: '#7c3aed' },
    timeTextThem: { color: '#94a3b8' },
    readReceiptRow: { marginTop: 4, marginRight: 4, alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 2 },
    readReceiptTicks: { fontSize: 10, color: '#94a3b8', fontWeight: '800' },
    readReceiptTicksSeen: { color: '#2563eb' },
    readReceiptText: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
    readReceiptSeen: { color: '#2563eb' },

    // Typing
    typingWrapper: { alignSelf: 'flex-start', marginBottom: 10, marginLeft: 2 },
    typingBubble: { backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.lg, borderTopLeftRadius: 8, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER, ...SHADOWS.sm },
    typingContainer: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 16, paddingHorizontal: 4 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CHAT_ACCENT },

    aiRepliesBar: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#ede9fe',
        paddingTop: 8,
        paddingBottom: 6,
        paddingHorizontal: 10,
        gap: 8,
    },
    aiRepliesHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    aiRepliesTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: '#5b21b6',
    },
    aiRepliesRefreshButton: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    aiRepliesRefreshText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6d28d9',
    },
    aiRepliesErrorText: {
        fontSize: 12,
        color: '#b91c1c',
        fontWeight: '600',
    },
    aiRepliesScrollContent: {
        alignItems: 'center',
        gap: 8,
        paddingRight: 6,
    },
    aiReplyChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxWidth: 260,
    },
    aiReplyChipText: {
        fontSize: 12,
        color: '#5b21b6',
        fontWeight: '700',
    },
    aiReplyLoadingChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#ffffff',
        width: 40,
        height: 34,
        justifyContent: 'center',
        alignItems: 'center',
    },
    voiceRecordingBanner: {
        backgroundColor: '#fff1f2',
        borderTopWidth: 1,
        borderTopColor: '#fecdd3',
        borderBottomWidth: 1,
        borderBottomColor: '#fecdd3',
        paddingHorizontal: 14,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voiceRecordingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#ef4444',
    },
    voiceRecordingText: {
        flex: 1,
        fontSize: 12,
        color: '#9f1239',
        fontWeight: '700',
    },
    voiceRecordingTimer: {
        fontSize: 12,
        color: '#9f1239',
        fontWeight: '800',
        letterSpacing: 0.3,
    },
    voiceRecordingActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    voiceSecondaryAction: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#fda4af',
        backgroundColor: '#ffe4e6',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    voiceSecondaryActionText: {
        color: '#9f1239',
        fontSize: 11,
        fontWeight: '700',
    },
    voicePrimaryAction: {
        borderRadius: 999,
        backgroundColor: '#be123c',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    voicePrimaryActionDisabled: {
        opacity: 0.7,
    },
    voicePrimaryActionText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
    },
    voiceUploadingBanner: {
        backgroundColor: '#7c3aed',
        borderTopWidth: 1,
        borderTopColor: '#a78bfa',
        borderBottomWidth: 1,
        borderBottomColor: '#a78bfa',
        paddingHorizontal: 14,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voiceUploadingText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '700',
    },

    // Input Bar
    composerWrap: {
        backgroundColor: '#ffffff',
    },
    inputBar: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e9d5ff',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingTop: 8,
    },
    attachBtn: { padding: 10, borderRadius: 20 },
    attachBtnActive: { backgroundColor: '#f5f3ff' },
    inputWrap: { flex: 1, backgroundColor: CHAT_ACCENT_SOFTER, borderRadius: RADIUS.full, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER, minHeight: 42, maxHeight: 100, justifyContent: 'center' },
    inputField: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 14, color: '#0f172a' },
    sendBtn: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: CHAT_ACCENT, justifyContent: 'center', alignItems: 'center', marginLeft: 8, shadowColor: CHAT_ACCENT_DARK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 3 },
    micBtn: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        marginLeft: 4,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        backgroundColor: '#ede9fe',
        borderWidth: 1,
        borderColor: '#d8b4fe',
    },
    micBtnRecording: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
    micBtnStopping: { backgroundColor: '#f5f3ff', borderColor: '#c4b5fd' },
    micWaveWrap: { position: 'absolute', bottom: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
    micWaveBar: { width: 2, borderRadius: 2, backgroundColor: CHAT_ACCENT_WAVE },
    voiceStopSquare: { width: 14, height: 14, borderRadius: 3, backgroundColor: '#dc2626' },
    actionBtnDisabled: { opacity: 0.45 },
    uploadingIndicator: { width: 40, height: 40, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', marginLeft: 8, backgroundColor: CHAT_ACCENT_SOFTER, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER },

    // File message
    fileBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: SPACING.smd },
    fileBubbleMe: { backgroundColor: CHAT_ACCENT_SOFT, borderWidth: 1, borderColor: CHAT_ACCENT_BORDER_STRONG },
    fileBubbleThem: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
    fileEmoji: { fontSize: 18 },
    fileName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
    fileMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
    audioBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, minWidth: 185 },
    audioPlayButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#ede9fe',
        borderWidth: 1,
        borderColor: '#c4b5fd',
        alignItems: 'center',
        justifyContent: 'center',
    },
    audioPlayButtonText: {
        color: '#6d28d9',
        fontSize: 12,
        fontWeight: '900',
    },
    audioMetaColumn: {
        flex: 1,
        minWidth: 120,
        gap: 6,
    },
    audioProgressTrack: {
        width: '100%',
        height: 6,
        borderRadius: 3,
        backgroundColor: '#e9d5ff',
        overflow: 'hidden',
    },
    audioProgressFill: {
        height: '100%',
        borderRadius: 3,
        backgroundColor: '#7c3aed',
    },
    audioMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
    },
    audioMetaText: {
        flex: 1,
        color: '#5b21b6',
        fontSize: 11,
        fontWeight: '700',
    },
    audioDurationText: {
        color: '#6b7280',
        fontSize: 10,
        fontWeight: '700',
    },

    // Profile Modal Styles
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: CHAT_ACCENT_DARK, paddingVertical: 16, paddingHorizontal: 20 },
    modalBackBtnModal: { marginRight: 16, backgroundColor: 'rgba(255,255,255,0.1)', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    modalBackIconModal: { color: '#ffffff', fontSize: 24, fontWeight: '300', marginBottom: 2 },
    modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
    bannerContainer: { height: 160, position: 'relative', backgroundColor: '#581c87' },
    bannerImage: { width: '100%', height: '100%', opacity: 0.4 },
    bannerPillContainer: { position: 'absolute', bottom: 16, left: 16 },
    bannerPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    bannerPillText: { color: '#fff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
    profileSection: { paddingHorizontal: 16, marginTop: -48, alignItems: 'center' },
    contactAvatarLg: { width: 96, height: 96, borderRadius: 24, borderWidth: 4, borderColor: '#ffffff', backgroundColor: '#ffffff', marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16 },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
    contactName: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
    verifiedBadge: { backgroundColor: '#eef2ff', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    contactRole: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 32, textAlign: 'center', paddingHorizontal: 16 },
    actionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 24, width: '100%', paddingHorizontal: 16 },
    actionBtnModal: { flex: 1, backgroundColor: '#ffffff', borderRadius: 24, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#f1f5f9' },
    actionIconWrap: { width: 40, height: 40, borderRadius: 16, backgroundColor: '#faf5ff', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    actionBtnText: { fontSize: 10, fontWeight: '900', color: '#94a3b8', letterSpacing: 0.5 },
    detailsCard: { backgroundColor: '#ffffff', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, width: '100%' },
    sectionTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', marginBottom: 16, flex: 1 },
    sectionText: { fontSize: 14, color: '#475569', lineHeight: 22, fontWeight: '500', marginBottom: 24 },
    gridRow: { flexDirection: 'row', gap: 12 },
    gridBox: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    gridBoxLabel: { fontSize: 9, fontWeight: '900', color: '#94a3b8', letterSpacing: 1, marginBottom: 4 },
    gridBoxValue: { fontSize: 12, fontWeight: '900', color: '#334155' },
    productRow: { flexDirection: 'row', gap: 16, padding: 16, backgroundColor: '#f8fafc', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 12 },
    productIconBox: { width: 48, height: 48, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    productIconEmoji: { fontSize: 24 },
    productName: { fontSize: 14, fontWeight: '900', color: '#1e293b', marginBottom: 4 },
    productDesc: { fontSize: 12, fontWeight: '500', color: '#64748b', lineHeight: 18 },
    timelineContainer: { paddingLeft: 24, position: 'relative' },
    timelineLine: { position: 'absolute', left: 4, top: 8, bottom: 8, width: 2, backgroundColor: '#f3e8ff' },
    timelineItem: { marginBottom: 24, position: 'relative' },
    timelineDot: { position: 'absolute', left: -25, top: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#a855f7', borderWidth: 4, borderColor: '#faf5ff' },
    timelineYearBadge: { backgroundColor: '#faf5ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#f3e8ff', alignSelf: 'flex-start', marginBottom: 8 },
    timelineYearText: { fontSize: 10, fontWeight: '900', color: '#9333ea' },
    timelineEventText: { fontSize: 14, fontWeight: '700', color: '#334155' },
    darkCard: { backgroundColor: '#0f172a', borderRadius: 32, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 10, width: '100%', overflow: 'hidden', position: 'relative' },
    darkCardIconBg: { position: 'absolute', top: 16, right: 16, transform: [{ rotate: '12deg' }] },
    sectionTitleDark: { fontSize: 16, fontWeight: '900', color: '#fff', marginBottom: 16, zIndex: 10 },
    darkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, zIndex: 10 },
    darkLabel: { fontSize: 10, fontWeight: '900', color: '#94a3b8', letterSpacing: 1 },
    darkValue: { fontSize: 14, fontWeight: '900', color: '#c084fc' },
});
