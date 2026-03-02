import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, FlatList,
    StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated, Image, Modal, Alert, Linking
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
import { initiateCall } from '../services/WebRTCService';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { validateChatMessagesResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { DEMO_MODE } from '../config';
import { MOTION } from '../theme/motion';
import { RADIUS, SHADOWS, SPACING, theme } from '../theme/theme';

const AI_SUGGESTIONS = [
    "Sounds great, thanks!",
    "Can we do tomorrow?",
    "What's the salary range?"
];

const HUB_TABS = [
    { id: 'messages', label: 'Chat', icon: '💬' },
    { id: 'timeline', label: 'Timeline', icon: '📅' },
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'documents', label: 'Docs', icon: '📄' },
    { id: 'escrow', label: 'Escrow', icon: '🔐' },
];

const TIMELINE_MILESTONES = [
    { key: 'applied', label: 'Applied', icon: '📝' },
    { key: 'shortlisted', label: 'Shortlisted', icon: '⭐' },
    { key: 'interview_scheduled', label: 'Interview Scheduled', icon: '📅' },
    { key: 'interview_completed', label: 'Interview Completed', icon: '🎤' },
    { key: 'offer_sent', label: 'Offer Sent', icon: '📬' },
    { key: 'offer_accepted', label: 'Offer Accepted', icon: '✅' },
    { key: 'escrow_funded', label: 'Escrow Funded', icon: '🔐' },
    { key: 'work_started', label: 'Work Started', icon: '🚀' },
    { key: 'work_completed', label: 'Work Completed', icon: '🏁' },
    { key: 'payment_released', label: 'Payment Released', icon: '💸' },
];

const normalizeStatus = (value) => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'interview') return 'accepted';
    if (normalized === 'applied') return 'pending';
    return normalized;
};

const getStatusLabel = (status) => {
    const normalized = normalizeStatus(status);
    if (normalized === 'accepted') return 'Accepted';
    if (normalized === 'rejected') return 'Rejected';
    if (normalized === 'shortlisted') return 'Shortlisted';
    return 'Waiting';
};

const toPercent = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed <= 1) return Math.round(parsed * 100);
    return Math.max(0, Math.min(100, Math.round(parsed)));
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
    const { applicationId } = route.params || {};

    const { userInfo } = React.useContext(AuthContext);
    const { setActiveChatId, clearActiveChatId, setSocketStatus } = useAppStore();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [showAttachments, setShowAttachments] = useState(false);
    const [isOtherTyping, setIsOtherTyping] = useState(false);
    const [lastReadByOther, setLastReadByOther] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [isLoading, setIsLoading] = useState(!DEMO_MODE);
    const [isScreenReady, setIsScreenReady] = useState(false);
    const [uploadingFile, setUploadingFile] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('connected');
    const [historyError, setHistoryError] = useState('');
    const [applicationStatus, setApplicationStatus] = useState('pending');
    const [chatMeta, setChatMeta] = useState({
        otherPartyName: 'Contact',
        jobTitle: 'Opportunity',
        companyId: null,
        profileMode: 'employer',
        profileData: null,
        trustTag: '',
        responseTag: '',
    });
    const [reloadKey, setReloadKey] = useState(0);
    // Enterprise Hub state
    const [activeHubTab, setActiveHubTab] = useState('messages');
    const [hiringTimeline, setHiringTimeline] = useState([]);
    const [escrowPanel, setEscrowPanel] = useState(null);
    const [chatDocuments, setChatDocuments] = useState([]);
    const [privateNotes, setPrivateNotes] = useState([]);
    const [newNote, setNewNote] = useState('');
    const [hubLoading, setHubLoading] = useState(false);
    const isEmployer = getPrimaryRoleFromUser(userInfo) === 'employer';

    const flatListRef = useRef(null);
    const typingTimeout = useRef(null);
    const hasTrackedChatStartRef = useRef(false);
    const sendScale = useRef(new Animated.Value(1)).current;
    const micWaveAnim = useRef(new Animated.Value(0.45)).current;
    const canChat = ['accepted', 'hired', 'offer_accepted', 'interview'].includes(applicationStatus);
    const currentUserId = userInfo?._id;
    const safeGoBack = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate('MainTab', { screen: 'Applications' });
    }, [navigation]);

    const hasOwnMessageInList = useCallback((list = []) => {
        if (!currentUserId || !Array.isArray(list)) return false;
        return list.some((message) => {
            const senderId = typeof message?.sender === 'object' ? message?.sender?._id : message?.sender;
            return senderId === currentUserId;
        });
    }, [currentUserId]);

    useEffect(() => {
        const timeout = setTimeout(() => setIsScreenReady(true), 50);
        return () => clearTimeout(timeout);
    }, []);

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
        if (!applicationId) return;
        setActiveChatId(applicationId);
        return () => {
            clearActiveChatId(applicationId);
        };
    }, [applicationId, clearActiveChatId, setActiveChatId]);

    useEffect(() => {
        if (!applicationId) return;
        let isActive = true;

        const getReadableError = (error, fallback) => {
            if (error?.response?.data?.message) return error.response.data.message;
            if (error?.message === 'No internet connection') return 'No internet connection. Please check your network and try again.';
            if (error?.message === 'Network Error') return 'Unable to reach the server. Please try again.';
            if (error?.code === 'ECONNABORTED') return 'Request timed out. Please retry.';
            return fallback;
        };

        const fetchHistory = async () => {
            setHistoryError('');
            if (!DEMO_MODE) {
                setIsLoading(true);
            }
            try {
                // 1. Try cache
                const cached = await AsyncStorage.getItem(`@chat_history_${applicationId}`);
                if (cached && isActive) {
                    const cachedMessages = JSON.parse(cached);
                    if (hasOwnMessageInList(cachedMessages)) {
                        hasTrackedChatStartRef.current = true;
                    }
                    setMessages(cachedMessages);
                    if (!DEMO_MODE) {
                        setIsLoading(false);
                    }
                }
            } catch (e) {
                logger.error("Chat cache error", e);
            }

            try {
                // 2. Fetch fresh history
                const { data } = await client.get(`/api/chat/${applicationId}`);
                const validatedMessages = validateChatMessagesResponse(data, applicationId);
                if (isActive) {
                    const chronological = [...validatedMessages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
                    if (hasOwnMessageInList(chronological)) {
                        hasTrackedChatStartRef.current = true;
                    }
                    setMessages(chronological);
                    // 3. Update cache (max 100 messages to prevent unbounded bloat)
                    saveLimitedCache(`@chat_history_${applicationId}`, chronological, 100);
                }
            } catch (err) {
                if (err?.name === 'ApiValidationError') {
                    logValidationError(err, `/api/chat/${applicationId}`);
                }
                logger.error('Failed to fetch chat history', err);
                if (isActive) {
                    setHistoryError(getReadableError(err, 'Could not load chat history.'));
                }
            }

            try {
                // Keep chat lock state and header metadata synced with latest application
                const { data: applicationData } = await client.get(`/api/applications/${applicationId}`);
                const application = applicationData?.application || applicationData;
                const job = application?.job || {};
                const employer = application?.employer || {};
                const worker = application?.worker || {};
                const chatProfile = application?.chatProfile || {};
                const candidatePanel = chatProfile?.candidate || {};
                const employerPanel = chatProfile?.employer || {};

                const workerName = [worker?.firstName, worker?.lastName].filter(Boolean).join(' ').trim() || worker?.name || 'Candidate';
                const employerName = employer?.companyName || employer?.name || job?.companyName || 'Employer';
                const currentRole = getPrimaryRoleFromUser(userInfo);
                const companyIdValue = employer?._id || employer?.id || null;

                const workerSkills = Array.isArray(candidatePanel?.skills)
                    ? candidatePanel.skills
                    : ((Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : []).flatMap((roleProfile) => (
                        Array.isArray(roleProfile?.skills) ? roleProfile.skills : []
                    )));
                const fallbackExpectedSalary = (Array.isArray(worker?.roleProfiles) ? worker.roleProfiles : [])
                    .map((roleProfile) => Number(roleProfile?.expectedSalary))
                    .find((value) => Number.isFinite(value) && value > 0);
                const candidateHighlights = [
                    { label: 'Match %', value: `${toPercent(candidatePanel?.matchPercentage, 0)}%` },
                    { label: 'Trust Score', value: `${toPercent(candidatePanel?.trustScore, 0)}` },
                    { label: 'Badges', value: Array.isArray(candidatePanel?.badges) && candidatePanel.badges.length ? candidatePanel.badges.join(', ') : 'None' },
                    { label: 'Profile Completeness', value: `${toPercent(candidatePanel?.profileCompleteness, 0)}%` },
                    { label: 'Availability', value: candidatePanel?.availability || (worker?.isAvailable ? 'Available' : 'Unavailable') },
                    { label: 'Salary Expectation', value: candidatePanel?.salaryExpectation || fallbackExpectedSalary ? `₹${Number(candidatePanel?.salaryExpectation || fallbackExpectedSalary).toLocaleString()}` : 'N/A' },
                ];
                const employerHighlights = [
                    { label: 'Salary', value: employerPanel?.jobDetails?.salary || job?.salaryRange || 'N/A' },
                    { label: 'Location', value: employerPanel?.jobDetails?.location || job?.location || 'N/A' },
                    { label: 'Shift', value: employerPanel?.jobDetails?.shift || job?.shift || 'N/A' },
                    { label: 'Posted Date', value: toDateLabel(employerPanel?.jobDetails?.postedDate || job?.createdAt) },
                    { label: 'Response Time', value: toHoursLabel(employerPanel?.responseTimeHours) },
                    { label: 'Trust Level', value: `${toPercent(employerPanel?.trustLevel || employer?.trustScore, 0)}` },
                    { label: 'Employer Rating', value: `${toPercent(employerPanel?.employerRating || employer?.responseScore, 0)}` },
                ];
                const candidateTrustTag = `Trust ${toPercent(candidatePanel?.trustScore, 0)}`;
                const candidateResponseTag = candidatePanel?.availability || (worker?.isAvailable ? 'Available now' : 'Availability pending');
                const employerTrustTag = employerPanel?.verificationBadge
                    ? `Verified • ${toPercent(employerPanel?.trustLevel || employer?.trustScore, 0)} trust`
                    : `${toPercent(employerPanel?.trustLevel || employer?.trustScore, 0)} trust`;
                const employerResponseTag = `${toHoursLabel(employerPanel?.responseTimeHours)} avg response`;

                const candidateData = {
                    name: candidatePanel?.name || workerName,
                    headline: job?.title || 'Candidate Profile',
                    industryTag: 'CANDIDATE PROFILE',
                    summary: candidatePanel?.smartInterviewSummary || worker?.videoIntroduction?.transcript || 'No interview summary available yet.',
                    experienceYears: Number(worker?.totalExperience || 0),
                    skills: workerSkills.length ? workerSkills : ['Profile incomplete'],
                    highlights: candidateHighlights,
                    workHistory: Array.isArray(candidatePanel?.workHistory) ? candidatePanel.workHistory : [],
                };

                const employerData = {
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
                };

                if (isActive) {
                    setApplicationStatus(normalizeStatus(application?.status));
                    setChatMeta({
                        otherPartyName: currentRole === 'employer' ? workerName : employerName,
                        jobTitle: job?.title || 'Opportunity',
                        companyId: companyIdValue,
                        profileMode: currentRole === 'employer' ? 'candidate' : 'employer',
                        profileData: currentRole === 'employer' ? candidateData : employerData,
                        trustTag: currentRole === 'employer' ? candidateTrustTag : employerTrustTag,
                        responseTag: currentRole === 'employer' ? candidateResponseTag : employerResponseTag,
                    });
                }
            } catch (err) {
                logger.warn('Could not load application metadata for chat:', err?.message || err);
            } finally {
                if (isActive && !DEMO_MODE) setIsLoading(false);
            }
        };
        fetchHistory();

        // Setup Socket
        const handleNewMessage = (msg) => {
            const incomingId = msg?._id ? String(msg._id) : null;
            setMessages((prev) => {
                if (incomingId && prev.some((item) => String(item?._id || '') === incomingId)) {
                    return prev;
                }
                return [...prev, msg];
            });
        };
        const handleSocketDisconnect = () => {
            setConnectionStatus('reconnecting');
            setSocketStatus('reconnecting');
        };
        const handleSocketConnect = () => {
            setConnectionStatus('connected');
            setSocketStatus('connected');
            SocketService.emit('join_chat', { applicationId }); // SOCKET_VERIFIED
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

        // Ensure we join the room if connected
        SocketService.emit('join_chat', { applicationId }); // SOCKET_VERIFIED

        return () => {
            isActive = false;
            SocketService.off('receiveMessage', handleNewMessage);
            SocketService.off('new_message', handleNewMessage);
            SocketService.off('user_typing', handleUserTyping);
            SocketService.off('user_stop_typing', handleUserStopTyping);
            SocketService.off('messages_read_ack', handleMessagesReadAck);
            SocketService.off('disconnect', handleSocketDisconnect);
            SocketService.off('connect', handleSocketConnect);
            if (typingTimeout.current) clearTimeout(typingTimeout.current);
        };
    }, [applicationId, userInfo?.primaryRole, userInfo?.role, reloadKey, setSocketStatus, hasOwnMessageInList]);

    // Emit read receipts when messages load or change — Feature 5
    useEffect(() => {
        if (!applicationId || !userInfo) return;
        SocketService.emit('messages_read', { roomId: applicationId, userId: userInfo._id });
    }, [applicationId, userInfo, messages.length]);

    const getMessageStatus = (message) => {
        if (!userInfo) return null;
        const senderId = typeof message.sender === 'object' ? message.sender?._id : message.sender;
        if (senderId !== userInfo._id) return null;
        if (lastReadByOther && new Date(lastReadByOther) >= new Date(message.createdAt || message.timestamp)) return 'seen';
        return 'sent';
    };

    const sendMessage = async (payload = input) => {
        if (!userInfo || !currentUserId) return;
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Chat will unlock once this application is accepted.');
            return;
        }
        const isTextPayload = typeof payload === 'string';
        const trimmedText = isTextPayload ? payload.trim() : '';
        if (isTextPayload && !trimmedText) return;

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

        // Send via socket
        SocketService.emit('sendMessage', {
            applicationId,
            senderId: currentUserId,
            ...(isTextPayload ? { text: trimmedText } : payload)
        });

        triggerHaptic.light();
        Animated.sequence([
            Animated.timing(sendScale, { toValue: 0.9, duration: 80, useNativeDriver: true }),
            Animated.spring(sendScale, { toValue: 1, stiffness: 220, damping: 14, mass: 0.6, useNativeDriver: true }),
        ]).start();
        if (isTextPayload) setInput('');
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
        setUploadingFile(true);
        try {
            const formData = new FormData();
            formData.append('file', {
                uri: file.uri,
                name: file.name || 'attachment',
                type: file.mimeType || 'application/octet-stream',
            });
            formData.append('applicationId', applicationId);

            const { data } = await client.post('/api/chat/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            sendMessage({
                type: 'file',
                fileUrl: data?.url,
                fileName: file.name || 'Attachment',
                fileSize: file.size
            });
        } catch (e) {
            Alert.alert('Upload Failed', 'Could not upload file. Please try again.');
        } finally {
            setUploadingFile(false);
        }
    };

    const handlePickDocument = async () => {
        setShowAttachments(false);
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

    const handlePickImage = async () => {
        setShowAttachments(false);
        const result = await DocumentPicker.getDocumentAsync({
            type: ['image/*'],
            copyToCacheDirectory: true,
        });

        if (result.canceled) return;
        const file = result.assets?.[0];
        if (file) await uploadAttachment(file);
    };

    const handleAttachmentPress = () => {
        if (!canChat) {
            Alert.alert('Waiting for Response', 'Attachments become available once chat is unlocked.');
            return;
        }
        setShowAttachments(true);
        Alert.alert(
            'Share',
            'What would you like to share?',
            [
                { text: '📄 Resume / Document', onPress: handlePickDocument },
                { text: '📷 Photo', onPress: handlePickImage },
                { text: 'Cancel', style: 'cancel', onPress: () => setShowAttachments(false) },
            ],
            { cancelable: true, onDismiss: () => setShowAttachments(false) }
        );
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

    const formatTime = (iso) => {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    const lastMyMessageId = useMemo(() => {
        if (!userInfo || messages.length === 0) return null;
        for (let i = messages.length - 1; i >= 0; i -= 1) {
            const msg = messages[i];
            const sid = typeof msg.sender === 'object' ? msg.sender?._id : msg.sender;
            if (sid === userInfo._id) return msg._id;
        }
        return null;
    }, [messages, userInfo]);

    const headerStatusText = [chatMeta.jobTitle, getStatusLabel(applicationStatus), chatMeta.trustTag]
        .filter(Boolean)
        .join(' • ');
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

            const senderId = typeof message?.sender === 'object' ? message?.sender?._id : message?.sender;
            const isMe = Boolean(userInfo && senderId === userInfo._id);
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
    }, [messages, userInfo]);

    const renderMessage = ({ item }) => {
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

        if (message.type === 'file') {
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
                    {status === 'seen' && <Text style={[styles.readReceiptText, styles.readReceiptSeen]}>Delivered • Seen</Text>}
                    {status === 'sent' && <Text style={styles.readReceiptText}>Delivered</Text>}
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
                    <Text style={styles.timeText}>
                        {formatTime(message.createdAt)}
                    </Text>
                </View>
                {status === 'seen' && <Text style={[styles.readReceiptText, styles.readReceiptSeen]}>Delivered • Seen</Text>}
                {status === 'sent' && <Text style={styles.readReceiptText}>Delivered</Text>}
            </View>
        );
    };

    const renderHeader = () => (
        <View style={[styles.header, { paddingTop: insets.top }]}>
            <TouchableOpacity style={styles.backBtn} onPress={safeGoBack}>
                <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.headerInfoContainer}
                activeOpacity={0.7}
                onPress={() => {
                    setShowProfileModal(true);
                }}
                onLongPress={handleReportUser}
            >
                <Image source={{ uri: `https://ui-avatars.com/api/?name=${chatMeta.otherPartyName}&background=2f5fff&color=fff` }} style={styles.headerAvatar} />
                <View style={styles.headerInfoText}>
                    <Text style={styles.headerName} numberOfLines={1}>{chatMeta.otherPartyName}</Text>
                    <Text style={styles.headerSub} numberOfLines={1}>
                        {headerStatusText}
                    </Text>
                    {chatMeta.responseTag ? (
                        <Text style={styles.headerSubSecondary} numberOfLines={1}>{chatMeta.responseTag}</Text>
                    ) : null}
                </View>
            </TouchableOpacity>

            <View style={styles.headerActions}>
                <TouchableOpacity style={styles.headerActionBtn} onPress={handleStartVideoCall}>
                    <IconVideo size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerActionBtn} onPress={handleStartAudioCall}>
                    <IconPhone size={20} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );

    if (!isScreenReady) {
        return <View style={styles.container} />;
    }

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
            {!canChat && activeHubTab === 'messages' && (
                <View style={styles.lockedBanner}>
                    <Text style={styles.lockedBannerText}>Waiting for acceptance. Chat will unlock once approved.</Text>
                </View>
            )}

            {/* ── Enterprise Hub Tab Bar ── */}
            <View style={styles.hubTabBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hubTabScroll}>
                    {HUB_TABS.map((tab) => (
                        <TouchableOpacity
                            key={tab.id}
                            style={[styles.hubTab, activeHubTab === tab.id && styles.hubTabActive]}
                            onPress={() => setActiveHubTab(tab.id)}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.hubTabIcon}>{tab.icon}</Text>
                            <Text style={[styles.hubTabLabel, activeHubTab === tab.id && styles.hubTabLabelActive]}>
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* ── Messages Tab ── */}
            {activeHubTab === 'messages' && (
                <>
                    {isLoading ? (
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
                            keyExtractor={(item, index) => String(item?._rowId || `row-${index}`)}
                            renderItem={renderMessage}
                            style={{ flex: 1 }}
                            contentContainerStyle={styles.messagesList}
                            showsVerticalScrollIndicator={false}
                            maxToRenderPerBatch={10}
                            windowSize={10}
                            removeClippedSubviews={Platform.OS === 'android'}
                            initialNumToRender={15}
                            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                            onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
                            ListFooterComponent={() => isOtherTyping ? (
                                <View style={styles.typingWrapper}>
                                    <View style={styles.typingBubble}>
                                        <TypingIndicator />
                                    </View>
                                </View>
                            ) : null}
                        />
                    )}

                    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
                        {/* Suggestions */}
                        <View style={styles.suggestionsContainer}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsContent}>
                                {AI_SUGGESTIONS.map((sugg, idx) => (
                                    <TouchableOpacity key={idx} style={styles.suggPill} onPress={() => setInput(sugg)}>
                                        <Text style={styles.suggText}>✨ Suggest: {sugg}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>

                        {/* Input Bar */}
                        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
                            <TouchableOpacity
                                style={[styles.attachBtn, showAttachments && styles.attachBtnActive]}
                                onPress={handleAttachmentPress}
                                disabled={uploadingFile || !canChat}
                            >
                                <View style={{ transform: [{ rotate: showAttachments ? '45deg' : '0deg' }] }}>
                                    <IconPlus size={24} color={showAttachments ? '#1e293b' : '#64748b'} />
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
                                    editable={!uploadingFile && canChat}
                                />
                            </View>

                            {uploadingFile ? (
                                <View style={styles.uploadingIndicator}>
                                    <SkeletonLoader width={18} height={18} borderRadius={RADIUS.full} tone="tint" />
                                </View>
                            ) : input.trim() ? (
                                <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                                    <TouchableOpacity style={[styles.sendBtn, !canChat && styles.actionBtnDisabled]} onPress={() => sendMessage()} disabled={!canChat}>
                                        <IconSend size={18} color="#fff" />
                                    </TouchableOpacity>
                                </Animated.View>
                            ) : (
                                <View style={[styles.micBtn, !canChat && styles.actionBtnDisabled]}>
                                    <Animated.View style={[styles.micWaveWrap, { opacity: micWaveAnim }]}>
                                        <View style={[styles.micWaveBar, { height: 8 }]} />
                                        <View style={[styles.micWaveBar, { height: 13 }]} />
                                        <View style={[styles.micWaveBar, { height: 9 }]} />
                                    </Animated.View>
                                    <IconMic size={24} color="#64748b" />
                                </View>
                            )}
                        </View>
                    </KeyboardAvoidingView>
                </>
            )}

            {/* ── Timeline Tab ── */}
            {activeHubTab === 'timeline' && (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
                    <Text style={styles.hubPanelTitle}>📅 Hiring Timeline</Text>
                    <Text style={styles.hubPanelSubtitle}>Immutable record of hiring milestones for this application.</Text>

                    <View style={styles.timelineTrack}>
                        {TIMELINE_MILESTONES.map((milestone, idx) => {
                            const event = hiringTimeline.find((e) => e.eventType === milestone.key || e.type === milestone.key);
                            const isComplete = Boolean(event);
                            return (
                                <View key={milestone.key} style={styles.tlRow}>
                                    <View style={[styles.tlDotColumn, { alignItems: 'center' }]}>
                                        <View style={[styles.tlDot, isComplete ? styles.tlDotComplete : styles.tlDotPending]}>
                                            <Text style={styles.tlDotIcon}>{isComplete ? '✓' : milestone.icon}</Text>
                                        </View>
                                        {idx < TIMELINE_MILESTONES.length - 1 && (
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

                    {/* Activity Log */}
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
            )}

            {/* ── Profile Tab ── */}
            {activeHubTab === 'profile' && (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.hubPanelContainer} showsVerticalScrollIndicator={false}>
                    <Text style={styles.hubPanelTitle}>
                        {chatMeta.profileMode === 'candidate' ? '👤 Candidate Intelligence' : '🏢 Employer Intelligence'}
                    </Text>
                    {chatMeta.profileData ? (
                        <>
                            {/* Profile Highlights Grid */}
                            <View style={styles.hubCard}>
                                <Text style={styles.hubCardTitle}>{chatMeta.profileData.name || chatMeta.otherPartyName}</Text>
                                <Text style={styles.hubCardSubtitle}>{chatMeta.profileData.headline}</Text>
                                <View style={styles.hubHighlightGrid}>
                                    {(chatMeta.profileData.highlights || []).map((h, i) => (
                                        <View key={i} style={styles.hubHighlightBox}>
                                            <Text style={styles.hubHighlightLabel}>{h.label}</Text>
                                            <Text style={styles.hubHighlightValue}>{h.value}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                            {/* Skills (worker only) */}
                            {chatMeta.profileMode === 'candidate' && Array.isArray(chatMeta.profileData.skills) && chatMeta.profileData.skills.length > 0 && (
                                <View style={styles.hubCard}>
                                    <Text style={styles.hubCardTitle}>⚡ Skills</Text>
                                    <View style={styles.skillPillRow}>
                                        {chatMeta.profileData.skills.map((s, i) => (
                                            <View key={i} style={styles.skillPill}>
                                                <Text style={styles.skillPillText}>{s}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}
                            {/* Summary */}
                            {chatMeta.profileData.summary && (
                                <View style={styles.hubCard}>
                                    <Text style={styles.hubCardTitle}>💬 Summary</Text>
                                    <Text style={styles.hubCardBody}>{chatMeta.profileData.summary}</Text>
                                </View>
                            )}
                        </>
                    ) : (
                        <Text style={styles.hubEmptyText}>Loading profile data...</Text>
                    )}

                    {/* Employer Private Notes — employer only */}
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
                                            const { data } = await client.post(`/api/chat/${applicationId}/notes`, { content: newNote.trim() });
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
            )}

            {/* ── Documents Tab ── */}
            {activeHubTab === 'documents' && (
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
                                            const { data } = await client.post(`/api/chat/${applicationId}/documents/signed-url`, { s3Key: doc.s3Key });
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
                        onPress={handlePickDocument}
                    >
                        <Text style={styles.uploadDocBtnText}>+ Upload Document</Text>
                    </TouchableOpacity>
                </ScrollView>
            )}

            {/* ── Escrow Tab ── */}
            {activeHubTab === 'escrow' && (
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
            )}

            {/* Profile Detail Modal fully mapped to ContactInfoView */}
            <Modal
                visible={showProfileModal}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={() => setShowProfileModal(false)}
            >
                <ContactInfoView
                    presentation="screen"
                    mode={chatMeta.profileMode}
                    title={chatMeta.profileMode === 'candidate' ? 'Candidate Profile' : 'Employer Profile'}
                    data={chatMeta.profileData || {
                        name: chatMeta.otherPartyName,
                        headline: chatMeta.jobTitle,
                        highlights: [],
                    }}
                    onBack={() => setShowProfileModal(false)}
                    onVideoPress={handleStartVideoCall}
                    onCallPress={handleStartAudioCall}
                />
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
    lockedBanner: {
        backgroundColor: '#eff6ff',
        borderBottomWidth: 1,
        borderBottomColor: '#bfdbfe',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    lockedBannerText: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
    },

    // ── Enterprise Hub Tab Bar ──
    hubTabBar: {
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e4ebf5',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 2,
        elevation: 2,
    },
    hubTabScroll: { paddingHorizontal: 12, paddingVertical: 6, gap: 6 },
    hubTab: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 5,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    hubTabActive: {
        backgroundColor: '#1e40af',
        borderColor: '#1e40af',
    },
    hubTabIcon: { fontSize: 13 },
    hubTabLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
    hubTabLabelActive: { color: '#fff', fontWeight: '800' },

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
        borderColor: '#e4ebf5',
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
    tlDotComplete: { backgroundColor: '#1e40af' },
    tlDotPending: { backgroundColor: '#e2e8f0', borderWidth: 1, borderColor: '#cbd5e1' },
    tlDotIcon: { fontSize: 12, color: '#fff' },
    tlConnector: { width: 2, flex: 1, minHeight: 32, backgroundColor: '#e2e8f0', marginVertical: 2 },
    tlConnectorComplete: { backgroundColor: '#1e40af' },
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
    skillPill: { backgroundColor: '#eff6ff', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#bfdbfe' },
    skillPillText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },

    // ── Private Notes ──
    noteRow: { backgroundColor: '#fefce8', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#fde68a' },
    noteContent: { fontSize: 13, color: '#78350f', lineHeight: 19 },
    noteTime: { fontSize: 10, color: '#a16207', marginTop: 4, fontWeight: '600' },
    noteInputRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' },
    noteInput: { flex: 1, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', padding: 10, fontSize: 13, color: '#1e293b', minHeight: 44, maxHeight: 90 },
    noteSubmitBtn: { backgroundColor: '#1e40af', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    noteSubmitText: { color: '#fff', fontSize: 12, fontWeight: '800' },

    // ── Documents ──
    docRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    docIcon: { fontSize: 24 },
    docName: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
    docMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
    docDownloadBtn: { backgroundColor: '#eff6ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#bfdbfe' },
    docDownloadText: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
    uploadDocBtn: { backgroundColor: '#1e40af', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    uploadDocBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },

    // ── Escrow ──
    escrowStatusLabel: { fontSize: 10, fontWeight: '900', color: '#166534', letterSpacing: 1, marginBottom: 4 },
    escrowStatusValue: { fontSize: 18, fontWeight: '800', color: '#15803d', marginBottom: 8 },
    escrowAmount: { fontSize: 32, fontWeight: '900', color: '#0f172a', marginTop: 8 },
    escrowCurrency: { fontSize: 12, color: '#94a3b8', fontWeight: '700', marginBottom: 4 },

    // Header
    header: { backgroundColor: theme.primary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4, zIndex: 10 },
    backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 18 },
    backArrow: { color: '#fff', fontSize: 24, fontWeight: '300', marginBottom: 2 },
    headerInfoContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)' },
    headerAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', marginRight: 12 },
    headerInfoText: { flex: 1 },
    headerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#dbe7ff', fontSize: 11, fontWeight: '500' },
    headerSubSecondary: { color: 'rgba(219,231,255,0.84)', fontSize: 10, fontWeight: '700', marginTop: 1 },
    headerActions: { flexDirection: 'row', gap: 6, marginLeft: 8 },
    headerActionBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18 },

    // Messages
    messagesList: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.lg, paddingTop: SPACING.md },
    dateDividerWrap: { marginTop: 10, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
    dateDividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
    dateDividerText: { fontSize: 11, color: '#64748b', fontWeight: '700' },
    sysMsgWrapper: { alignItems: 'center', marginVertical: 16 },
    sysMsgText: { backgroundColor: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#fde68a' },

    msgWrapper: { maxWidth: '82%', marginBottom: 10 },
    msgWrapperMe: { alignSelf: 'flex-end' },
    msgWrapperThem: { alignSelf: 'flex-start' },
    bubble: { paddingHorizontal: SPACING.smd + 2, paddingVertical: SPACING.sm + 1, borderRadius: RADIUS.lg, ...SHADOWS.sm },
    bubbleMe: { backgroundColor: theme.chatBackground, borderWidth: 1, borderColor: '#d9e6ff' },
    bubbleThem: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#edf2fb' },
    bubbleText: { fontSize: 14, lineHeight: 21 },
    bubbleTextMe: { color: '#0f172a' },
    bubbleTextThem: { color: '#0f172a' },
    timeText: { fontSize: 10, color: '#94a3b8', marginTop: 5, alignSelf: 'flex-end' },
    readReceiptText: { fontSize: 10, color: '#94a3b8', alignSelf: 'flex-end', marginTop: 3, marginRight: 4, fontWeight: '600' },
    readReceiptSeen: { color: '#1d4ed8' },

    // Typing
    typingWrapper: { alignSelf: 'flex-start', marginBottom: 10, marginLeft: 2 },
    typingBubble: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.lg, borderTopLeftRadius: 8, borderWidth: 1, borderColor: '#edf2fb', ...SHADOWS.sm },
    typingContainer: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 16, paddingHorizontal: 4 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.primary },

    // Suggestions
    suggestionsContainer: { backgroundColor: 'rgba(255,255,255,0.9)', borderTopWidth: 1, borderTopColor: '#ecf1f8', paddingVertical: SPACING.sm },
    suggestionsContent: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
    suggPill: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#dbe7ff', ...SHADOWS.sm },
    suggText: { fontSize: 12, fontWeight: '700', color: '#1f46cc' },

    // Input Bar
    inputBar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#ecf1f8', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
    attachBtn: { padding: 10, borderRadius: 20 },
    attachBtnActive: { backgroundColor: '#f1f5f9' },
    inputWrap: { flex: 1, backgroundColor: '#f8fbff', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#e4ebf5', minHeight: 42, maxHeight: 100, justifyContent: 'center' },
    inputField: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 14, color: '#0f172a' },
    sendBtn: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 8, shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
    micBtn: { width: 40, height: 40, borderRadius: RADIUS.full, marginLeft: 4, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    micWaveWrap: { position: 'absolute', bottom: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
    micWaveBar: { width: 2, borderRadius: 2, backgroundColor: '#c7d8fb' },
    actionBtnDisabled: { opacity: 0.45 },
    uploadingIndicator: { width: 40, height: 40, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', marginLeft: 8, backgroundColor: '#eef3ff', borderWidth: 1, borderColor: '#dbe7ff' },

    // File message
    fileBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: SPACING.smd },
    fileBubbleMe: { backgroundColor: '#e9edff', borderWidth: 1, borderColor: '#d7e4ff' },
    fileBubbleThem: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
    fileEmoji: { fontSize: 18 },
    fileName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
    fileMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },

    // Profile Modal Styles
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.primary, paddingVertical: 16, paddingHorizontal: 20 },
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
        keyExtractor={(item, index) => String(item?._rowId || `row-${index}`)}
        renderItem={renderMessage}
        style={{ flex: 1 }}
        contentContainerStyle={styles.messagesList}
        showsVerticalScrollIndicator={false}
        maxToRenderPerBatch={10}
        windowSize={10}
        removeClippedSubviews={Platform.OS === 'android'}
        initialNumToRender={15}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={() => isOtherTyping ? (
            <View style={styles.typingWrapper}>
                <View style={styles.typingBubble}>
                    <TypingIndicator />
                </View>
            </View>
        ) : null}
    />
)
}

<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
    {/* Suggestions */}
    <View style={styles.suggestionsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsContent}>
            {AI_SUGGESTIONS.map((sugg, idx) => (
                <TouchableOpacity key={idx} style={styles.suggPill} onPress={() => setInput(sugg)}>
                    <Text style={styles.suggText}>✨ Suggest: {sugg}</Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
    </View>

    {/* Input Bar */}
    <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
        <TouchableOpacity
            style={[styles.attachBtn, showAttachments && styles.attachBtnActive]}
            onPress={handleAttachmentPress}
            disabled={uploadingFile || !canChat}
        >
            <View style={{ transform: [{ rotate: showAttachments ? '45deg' : '0deg' }] }}>
                <IconPlus size={24} color={showAttachments ? '#1e293b' : '#64748b'} />
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
                editable={!uploadingFile && canChat}
            />
        </View>

        {uploadingFile ? (
            <View style={styles.uploadingIndicator}>
                <SkeletonLoader width={18} height={18} borderRadius={RADIUS.full} tone="tint" />
            </View>
        ) : input.trim() ? (
            <Animated.View style={{ transform: [{ scale: sendScale }] }}>
                <TouchableOpacity style={[styles.sendBtn, !canChat && styles.actionBtnDisabled]} onPress={() => sendMessage()} disabled={!canChat}>
                    <IconSend size={18} color="#fff" />
                </TouchableOpacity>
            </Animated.View>
        ) : (
            <View style={[styles.micBtn, !canChat && styles.actionBtnDisabled]}>
                <Animated.View style={[styles.micWaveWrap, { opacity: micWaveAnim }]}>
                    <View style={[styles.micWaveBar, { height: 8 }]} />
                    <View style={[styles.micWaveBar, { height: 13 }]} />
                    <View style={[styles.micWaveBar, { height: 9 }]} />
                </Animated.View>
                <IconMic size={24} color="#64748b" />
            </View>
        )}
    </View>
</KeyboardAvoidingView>

{/* Profile Detail Modal fully mapped to ContactInfoView */ }
<Modal
    visible={showProfileModal}
    animationType="slide"
    presentationStyle="fullScreen"
    onRequestClose={() => setShowProfileModal(false)}
>
    <ContactInfoView
        presentation="screen"
        mode={chatMeta.profileMode}
        title={chatMeta.profileMode === 'candidate' ? 'Candidate Profile' : 'Employer Profile'}
        data={chatMeta.profileData || {
            name: chatMeta.otherPartyName,
            headline: chatMeta.jobTitle,
            highlights: [],
        }}
        onBack={() => setShowProfileModal(false)}
        onVideoPress={handleStartVideoCall}
        onCallPress={handleStartAudioCall}
    />
</Modal>
        </View >
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
    lockedBanner: {
        backgroundColor: '#eff6ff',
        borderBottomWidth: 1,
        borderBottomColor: '#bfdbfe',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    lockedBannerText: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '700',
        textAlign: 'center',
    },

    // Header
    header: { backgroundColor: theme.primary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4, zIndex: 10 },
    backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 8, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 18 },
    backArrow: { color: '#fff', fontSize: 24, fontWeight: '300', marginBottom: 2 },
    headerInfoContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.16)' },
    headerAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', marginRight: 12 },
    headerInfoText: { flex: 1 },
    headerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#dbe7ff', fontSize: 11, fontWeight: '500' },
    headerSubSecondary: { color: 'rgba(219,231,255,0.84)', fontSize: 10, fontWeight: '700', marginTop: 1 },
    headerActions: { flexDirection: 'row', gap: 6, marginLeft: 8 },
    headerActionBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18 },

    // Messages
    messagesList: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.lg, paddingTop: SPACING.md },
    dateDividerWrap: {
        marginTop: 10,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    dateDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#e2e8f0',
    },
    dateDividerText: {
        fontSize: 11,
        color: '#64748b',
        fontWeight: '700',
    },
    sysMsgWrapper: { alignItems: 'center', marginVertical: 16 },
    sysMsgText: { backgroundColor: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#fde68a' },

    msgWrapper: { maxWidth: '82%', marginBottom: 10 },
    msgWrapperMe: { alignSelf: 'flex-end' },
    msgWrapperThem: { alignSelf: 'flex-start' },
    bubble: { paddingHorizontal: SPACING.smd + 2, paddingVertical: SPACING.sm + 1, borderRadius: RADIUS.lg, ...SHADOWS.sm },
    bubbleMe: { backgroundColor: theme.chatBackground, borderWidth: 1, borderColor: '#d9e6ff' },
    bubbleThem: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#edf2fb' },
    bubbleText: { fontSize: 14, lineHeight: 21 },
    bubbleTextMe: { color: '#0f172a' },
    bubbleTextThem: { color: '#0f172a' },
    timeText: { fontSize: 10, color: '#94a3b8', marginTop: 5, alignSelf: 'flex-end' },
    readReceiptText: { fontSize: 10, color: '#94a3b8', alignSelf: 'flex-end', marginTop: 3, marginRight: 4, fontWeight: '600' },
    readReceiptSeen: { color: '#1d4ed8' },

    // Typing
    typingWrapper: { alignSelf: 'flex-start', marginBottom: 10, marginLeft: 2 },
    typingBubble: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: RADIUS.lg, borderTopLeftRadius: 8, borderWidth: 1, borderColor: '#edf2fb', ...SHADOWS.sm },
    typingContainer: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 16, paddingHorizontal: 4 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.primary },

    // Suggestions
    suggestionsContainer: { backgroundColor: 'rgba(255,255,255,0.9)', borderTopWidth: 1, borderTopColor: '#ecf1f8', paddingVertical: SPACING.sm },
    suggestionsContent: { paddingHorizontal: SPACING.md, gap: SPACING.sm },
    suggPill: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#dbe7ff', ...SHADOWS.sm },
    suggText: { fontSize: 12, fontWeight: '700', color: '#1f46cc' },

    // Input Bar
    inputBar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#ecf1f8', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
    attachBtn: { padding: 10, borderRadius: 20 },
    attachBtnActive: { backgroundColor: '#f1f5f9' },
    inputWrap: { flex: 1, backgroundColor: '#f8fbff', borderRadius: RADIUS.full, borderWidth: 1, borderColor: '#e4ebf5', minHeight: 42, maxHeight: 100, justifyContent: 'center' },
    inputField: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 14, color: '#0f172a' },
    sendBtn: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 8, shadowColor: theme.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
    micBtn: { width: 40, height: 40, borderRadius: RADIUS.full, marginLeft: 4, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
    micWaveWrap: { position: 'absolute', bottom: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
    micWaveBar: { width: 2, borderRadius: 2, backgroundColor: '#c7d8fb' },
    actionBtnDisabled: { opacity: 0.45 },
    uploadingIndicator: { width: 40, height: 40, borderRadius: RADIUS.full, justifyContent: 'center', alignItems: 'center', marginLeft: 8, backgroundColor: '#eef3ff', borderWidth: 1, borderColor: '#dbe7ff' },

    // File message
    fileBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: SPACING.smd },
    fileBubbleMe: { backgroundColor: '#e9edff', borderWidth: 1, borderColor: '#d7e4ff' },
    fileBubbleThem: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
    fileEmoji: { fontSize: 18 },
    fileName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
    fileMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },

    // Profile Modal Styles mapped from ContactInfoView
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.primary, paddingVertical: 16, paddingHorizontal: 20 },
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
