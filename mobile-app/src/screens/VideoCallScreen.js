import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconMic, IconCamera, IconPhone } from '../components/Icons';
import SocketService from '../services/socket';
import { Audio } from 'expo-av';
import { Camera } from 'expo-camera';
import {
    endCall,
    getCallSession,
    handleIncomingAnswer,
    handleIncomingIceCandidate,
    handleIncomingOffer,
    markCallConnected,
    resetCallSession,
    startOutgoingCall,
    toggleLocalAudio,
    toggleLocalVideo,
} from '../services/WebRTCService';
import { trackEvent } from '../services/analytics';
import { logger } from '../utils/logger';

const formatDuration = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
};

const statusLabel = (status) => {
    if (status === 'calling') return 'Ringing...';
    if (status === 'incoming') return 'Incoming call';
    if (status === 'connecting') return 'Connecting...';
    if (status === 'connected') return 'Live';
    if (status === 'timeout') return 'Call timed out';
    if (status === 'rejected') return 'Call rejected';
    if (status === 'ended') return 'Call ended';
    return 'Connecting...';
};

export default function VideoCallScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const {
        roomId,
        applicationId: appIdFromRoute,
        otherPartyName = 'Candidate',
        isCaller: isCallerParam,
        callType = 'video',
    } = route.params || {};
    const applicationId = String(appIdFromRoute || roomId || '').trim();
    const isCaller = isCallerParam !== false;
    const isAudioOnly = String(callType || '').toLowerCase() === 'audio';
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(!isAudioOnly);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [duration, setDuration] = useState(0);
    const [callStatus, setCallStatus] = useState(isCaller ? 'calling' : 'incoming');
    const [permissionError, setPermissionError] = useState('');
    const trackedStartRef = useRef(false);
    const intervalRef = useRef(null);
    const callStatusRef = useRef(callStatus);

    useEffect(() => {
        callStatusRef.current = callStatus;
    }, [callStatus]);

    useEffect(() => {
        if (!applicationId) {
            setCallStatus('ended');
            return undefined;
        }

        let active = true;

        const configureAudioRoute = async (speakerEnabled) => {
            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: false,
                    staysActiveInBackground: false,
                    interruptionModeIOS: 1,
                    playsInSilentModeIOS: true,
                    shouldDuckAndroid: true,
                    playThroughEarpieceAndroid: !speakerEnabled,
                });
            } catch (error) {
                logger.warn('Audio route setup failed:', error?.message || error);
            }
        };

        const requestCallPermissions = async () => {
            try {
                const mic = await Camera.requestMicrophonePermissionsAsync();
                if (mic?.status !== 'granted') {
                    setPermissionError('Microphone permission is required for calls.');
                    setCallStatus('ended');
                    return false;
                }
                if (!isAudioOnly) {
                    const cam = await Camera.requestCameraPermissionsAsync();
                    if (cam?.status !== 'granted') {
                        setPermissionError('Camera permission is required for video calls.');
                        setCallStatus('ended');
                        return false;
                    }
                }
                return true;
            } catch (error) {
                setPermissionError('Unable to request call permissions.');
                setCallStatus('ended');
                return false;
            }
        };

        const onCallOffer = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            if (isCaller) return;
            setCallStatus('connecting');
            handleIncomingOffer(SocketService, applicationId, payload, {
                audioOnly: isAudioOnly,
                onConnectionState: (state) => {
                    if (state === 'connected') {
                        setCallStatus('connected');
                        markCallConnected(applicationId);
                    }
                },
                onTimeout: () => {
                    setCallStatus('timeout');
                },
                onConnectionIssue: () => {
                    setCallStatus('ended');
                },
                onError: () => {
                    setCallStatus('ended');
                },
            });
        };

        const onCallAnswer = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            void handleIncomingAnswer(applicationId, payload, {
                onConnected: () => setCallStatus('connected'),
                onError: () => setCallStatus('ended'),
            });
            setCallStatus('connected');
            markCallConnected(applicationId);
        };

        const onCallIce = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            void handleIncomingIceCandidate(applicationId, payload);
        };

        const onCallEnded = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            resetCallSession(applicationId);
            setCallStatus('ended');
        };

        const onCallRejected = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            resetCallSession(applicationId);
            setCallStatus('rejected');
        };

        const onCallTimeout = (payload = {}) => {
            if (String(payload.applicationId || payload.roomId || '') !== applicationId) return;
            resetCallSession(applicationId);
            setCallStatus('timeout');
        };

        const onAppStateChange = (nextState) => {
            if (!active) return;
            if (nextState === 'active' && ['connecting', 'connected'].includes(callStatusRef.current)) {
                SocketService.emit('join_chat', { applicationId });
            }
        };

        SocketService.on('call_offer', onCallOffer);
        SocketService.on('call_answer', onCallAnswer);
        SocketService.on('call_ice_candidate', onCallIce);
        SocketService.on('call_ended', onCallEnded);
        SocketService.on('call_rejected', onCallRejected);
        SocketService.on('call_timeout', onCallTimeout);
        const appStateSub = AppState.addEventListener('change', onAppStateChange);

        const bootstrap = async () => {
            const granted = await requestCallPermissions();
            if (!active || !granted) return;
            await configureAudioRoute(true);
            if (isCaller) {
                setCallStatus('connecting');
                try {
                    await startOutgoingCall(SocketService, applicationId, {
                        audioOnly: isAudioOnly,
                        source: 'video_call_screen',
                        onConnectionState: (state) => {
                            if (state === 'connected') {
                                setCallStatus('connected');
                            }
                        },
                        onTimeout: () => setCallStatus('timeout'),
                        onConnectionIssue: () => setCallStatus('ended'),
                        onError: () => setCallStatus('ended'),
                    });
                } catch (error) {
                    setCallStatus('ended');
                }
            }
        };

        void bootstrap();

        return () => {
            active = false;
            SocketService.off('call_offer', onCallOffer);
            SocketService.off('call_answer', onCallAnswer);
            SocketService.off('call_ice_candidate', onCallIce);
            SocketService.off('call_ended', onCallEnded);
            SocketService.off('call_rejected', onCallRejected);
            SocketService.off('call_timeout', onCallTimeout);
            appStateSub?.remove?.();
            resetCallSession(applicationId);
        };
    }, [applicationId, isAudioOnly, isCaller]);

    useEffect(() => {
        if (callStatus !== 'connected') {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            return undefined;
        }

        if (!trackedStartRef.current) {
            trackEvent(isAudioOnly ? 'AUDIO_CALL_STARTED' : 'VIDEO_CALL_STARTED', {
                roomId: applicationId,
                applicationId,
                source: route?.params?.source || 'video_call_screen',
            });
            trackedStartRef.current = true;
        }

        intervalRef.current = setInterval(() => setDuration((current) => current + 1), 1000);
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [applicationId, callStatus, isAudioOnly, route?.params?.source]);

    useEffect(() => {
        if (!['timeout', 'rejected', 'ended'].includes(callStatus)) return undefined;
        const timeout = setTimeout(() => {
            if (navigation.canGoBack()) {
                navigation.goBack();
                return;
            }
            navigation.navigate('MainTab');
        }, 1200);
        return () => clearTimeout(timeout);
    }, [callStatus, navigation]);

    const handleEndCall = () => {
        if (applicationId) {
            endCall(SocketService, applicationId);
        }
        setCallStatus('ended');
    };

    const controlsDisabled = callStatus !== 'connected';
    const hasWebRtcSession = Boolean(getCallSession(applicationId));

    const handleToggleMute = () => {
        const next = !isMuted;
        setIsMuted(next);
        toggleLocalAudio(applicationId, !next);
    };

    const handleToggleCamera = () => {
        const next = !isCameraOn;
        setIsCameraOn(next);
        toggleLocalVideo(applicationId, next);
    };

    const handleToggleSpeaker = async () => {
        const next = !isSpeakerOn;
        setIsSpeakerOn(next);
        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                staysActiveInBackground: false,
                interruptionModeIOS: 1,
                playsInSilentModeIOS: true,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: !next,
            });
        } catch (error) {
            logger.warn('Speaker toggle failed:', error?.message || error);
        }
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.remoteVideo}>
                <Text style={styles.remoteLabel}>{otherPartyName}</Text>
                <Text style={styles.statusText}>{statusLabel(callStatus)}</Text>
                {permissionError ? <Text style={styles.errorText}>{permissionError}</Text> : null}
                {!hasWebRtcSession ? <Text style={styles.statusHint}>Limited runtime WebRTC support.</Text> : null}
            </View>

            {!isAudioOnly ? (
                <View style={styles.localVideo}>
                    <Text style={styles.localLabel}>You</Text>
                </View>
            ) : null}

            <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <View style={styles.controlRow}>
                    <TouchableOpacity
                        style={[styles.controlButton, isMuted && styles.controlButtonActive, controlsDisabled && styles.controlButtonDisabled]}
                        onPress={handleToggleMute}
                        disabled={controlsDisabled}
                    >
                        <IconMic size={20} color={isMuted ? '#fff' : '#1e293b'} />
                        <Text style={[styles.controlText, isMuted && styles.controlTextActive]}>{isMuted ? 'Unmute' : 'Mute'}</Text>
                    </TouchableOpacity>
                    {isAudioOnly ? (
                        <TouchableOpacity
                            style={[styles.controlButton, isSpeakerOn && styles.controlButtonActive, controlsDisabled && styles.controlButtonDisabled]}
                            onPress={handleToggleSpeaker}
                            disabled={controlsDisabled}
                        >
                            <IconPhone size={20} color={isSpeakerOn ? '#fff' : '#1e293b'} />
                            <Text style={[styles.controlText, isSpeakerOn && styles.controlTextActive]}>{isSpeakerOn ? 'Speaker' : 'Earpiece'}</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={[styles.controlButton, !isCameraOn && styles.controlButtonActive, controlsDisabled && styles.controlButtonDisabled]}
                            onPress={handleToggleCamera}
                            disabled={controlsDisabled}
                        >
                            <IconCamera size={20} color={!isCameraOn ? '#fff' : '#1e293b'} />
                            <Text style={[styles.controlText, !isCameraOn && styles.controlTextActive]}>{isCameraOn ? 'Cam' : 'Off'}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={[styles.controlButton, styles.endButton]}
                        onPress={handleEndCall}
                    >
                        <IconPhone size={20} color="#fff" />
                        <Text style={[styles.controlText, styles.endText]}>End</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.durationText}>Duration: {formatDuration(duration)}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0f172a',
    },
    remoteVideo: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0f172a',
    },
    remoteLabel: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '700',
    },
    statusText: {
        color: '#94a3b8',
        marginTop: 8,
    },
    statusHint: {
        color: '#fbbf24',
        marginTop: 6,
        fontSize: 12,
    },
    errorText: {
        color: '#fca5a5',
        marginTop: 8,
        fontSize: 12,
    },
    localVideo: {
        position: 'absolute',
        right: 16,
        top: 16,
        width: 120,
        height: 160,
        borderRadius: 12,
        backgroundColor: '#1e293b',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#334155',
    },
    localLabel: {
        color: '#e2e8f0',
        fontSize: 12,
    },
    controls: {
        backgroundColor: '#0b1220',
        paddingTop: 16,
        paddingHorizontal: 16,
        borderTopWidth: 1,
        borderTopColor: '#1e293b',
    },
    controlRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    controlButton: {
        flex: 1,
        backgroundColor: '#e2e8f0',
        borderRadius: 14,
        paddingVertical: 12,
        alignItems: 'center',
        gap: 4,
    },
    controlButtonActive: {
        backgroundColor: '#7c3aed',
    },
    controlButtonDisabled: {
        opacity: 0.5,
    },
    controlText: {
        fontSize: 12,
        color: '#1e293b',
        fontWeight: '700',
    },
    controlTextActive: {
        color: '#ffffff',
    },
    endButton: {
        backgroundColor: '#dc2626',
    },
    endText: {
        color: '#fff',
    },
    durationText: {
        marginTop: 12,
        color: '#94a3b8',
        textAlign: 'center',
        fontSize: 12,
    },
});
