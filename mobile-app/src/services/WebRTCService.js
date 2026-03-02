import { logger } from '../utils/logger';

const CALL_TIMEOUT_MS = 30_000;

const rawIceConfig = String(process.env.EXPO_PUBLIC_ICE_SERVERS || '').trim();
const rawTurnUsername = String(process.env.EXPO_PUBLIC_TURN_USERNAME || '').trim();
const rawTurnCredential = String(process.env.EXPO_PUBLIC_TURN_CREDENTIAL || '').trim();

const parseIceServers = () => {
    const defaults = [{ urls: ['stun:stun.l.google.com:19302'] }];
    if (!rawIceConfig) return defaults;

    const parsed = rawIceConfig
        .split(',')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    if (!parsed.length) return defaults;

    return parsed.map((urls) => {
        const entry = { urls: [urls] };
        if (String(urls).startsWith('turn:') && rawTurnUsername && rawTurnCredential) {
            entry.username = rawTurnUsername;
            entry.credential = rawTurnCredential;
        }
        return entry;
    });
};

const ICE_SERVERS = parseIceServers();

const withApplicationPayload = (applicationId, extra = {}) => ({
    applicationId: String(applicationId || '').trim(),
    ...extra,
});

const getWebRtcRuntime = () => {
    const rtcp = globalThis?.RTCPeerConnection || global?.RTCPeerConnection;
    const rtcSession = globalThis?.RTCSessionDescription || global?.RTCSessionDescription;
    const rtcIce = globalThis?.RTCIceCandidate || global?.RTCIceCandidate;
    const mediaDevices = globalThis?.navigator?.mediaDevices || null;
    return {
        RTCPeerConnection: rtcp,
        RTCSessionDescription: rtcSession,
        RTCIceCandidate: rtcIce,
        mediaDevices,
        supported: typeof rtcp === 'function',
    };
};

const sessionRegistry = new Map();

const toSessionDescription = (runtime, description) => {
    if (!description) return null;
    if (runtime.RTCSessionDescription) {
        return new runtime.RTCSessionDescription(description);
    }
    return description;
};

const toIceCandidate = (runtime, candidate) => {
    if (!candidate) return null;
    if (runtime.RTCIceCandidate) {
        return new runtime.RTCIceCandidate(candidate);
    }
    return candidate;
};

const stopStreamTracks = (stream) => {
    try {
        if (!stream || typeof stream.getTracks !== 'function') return;
        stream.getTracks().forEach((track) => {
            if (track && typeof track.stop === 'function') {
                track.stop();
            }
        });
    } catch (error) {
        logger.warn('Failed to stop media tracks:', error?.message || error);
    }
};

const clearCallTimeout = (session) => {
    if (!session?.timeoutHandle) return;
    clearTimeout(session.timeoutHandle);
    session.timeoutHandle = null;
};

const armCallTimeout = (session, onTimedOut) => {
    clearCallTimeout(session);
    session.timeoutHandle = setTimeout(() => {
        onTimedOut?.();
    }, CALL_TIMEOUT_MS);
};

const ensureSession = (socketService, applicationId, options = {}) => {
    const key = String(applicationId || '').trim();
    if (!key) {
        throw new Error('applicationId is required');
    }

    const existing = sessionRegistry.get(key);
    if (existing) return existing;

    const runtime = getWebRtcRuntime();
    const session = {
        applicationId: key,
        socketService,
        runtime,
        audioOnly: Boolean(options.audioOnly),
        peerConnection: null,
        localStream: null,
        remoteStream: null,
        timeoutHandle: null,
    };

    if (runtime.supported) {
        const pc = new runtime.RTCPeerConnection({
            iceServers: ICE_SERVERS,
            iceCandidatePoolSize: 4,
        });
        pc.onicecandidate = (event) => {
            if (event?.candidate) {
                emitIceCandidate(socketService, key, event.candidate);
            }
        };
        pc.ontrack = (event) => {
            const [stream] = event?.streams || [];
            session.remoteStream = stream || null;
            options.onRemoteStream?.(stream || null);
        };
        pc.onconnectionstatechange = () => {
            const state = String(pc.connectionState || '');
            options.onConnectionState?.(state);
            if (['connected', 'completed'].includes(state)) {
                clearCallTimeout(session);
            }
            if (['failed', 'closed', 'disconnected'].includes(state)) {
                options.onConnectionIssue?.(state);
            }
        };
        pc.oniceconnectionstatechange = () => {
            const state = String(pc.iceConnectionState || '');
            if (state === 'failed') {
                options.onConnectionIssue?.(state);
            }
        };
        session.peerConnection = pc;
    }

    sessionRegistry.set(key, session);
    return session;
};

const ensureLocalStream = async (session) => {
    if (session.localStream) return session.localStream;
    if (!session.runtime.supported || !session.runtime.mediaDevices?.getUserMedia) {
        return null;
    }

    const constraints = {
        audio: true,
        video: session.audioOnly
            ? false
            : {
                facingMode: 'user',
                width: 640,
                height: 360,
                frameRate: 24,
            },
    };
    const localStream = await session.runtime.mediaDevices.getUserMedia(constraints);
    session.localStream = localStream || null;

    if (localStream && session.peerConnection) {
        localStream.getTracks().forEach((track) => {
            session.peerConnection.addTrack(track, localStream);
        });
    }
    return session.localStream;
};

const cleanupSession = (applicationId) => {
    const key = String(applicationId || '').trim();
    if (!key) return;
    const session = sessionRegistry.get(key);
    if (!session) return;

    clearCallTimeout(session);
    stopStreamTracks(session.localStream);
    stopStreamTracks(session.remoteStream);

    if (session.peerConnection) {
        try {
            session.peerConnection.onicecandidate = null;
            session.peerConnection.ontrack = null;
            session.peerConnection.onconnectionstatechange = null;
            session.peerConnection.oniceconnectionstatechange = null;
            session.peerConnection.close();
        } catch (error) {
            logger.warn('Peer connection cleanup failed:', error?.message || error);
        }
    }

    sessionRegistry.delete(key);
};

export const initiateCall = (socketService, applicationId, extra = {}) => {
    socketService.emit('call_initiate', withApplicationPayload(applicationId, extra));
};

export const emitOffer = (socketService, applicationId, offer) => {
    socketService.emit('call_offer', withApplicationPayload(applicationId, { offer }));
};

export const answerCall = (socketService, applicationId, answer = null) => {
    socketService.emit('call_answer', withApplicationPayload(applicationId, { answer }));
};

export const emitIceCandidate = (socketService, applicationId, candidate) => {
    socketService.emit('call_ice_candidate', withApplicationPayload(applicationId, { candidate }));
};

export const rejectCall = (socketService, applicationId) => {
    socketService.emit('call_reject', withApplicationPayload(applicationId));
    cleanupSession(applicationId);
};

export const endCall = (socketService, applicationId) => {
    socketService.emit('call_end', withApplicationPayload(applicationId));
    cleanupSession(applicationId);
};

export const startOutgoingCall = async (socketService, applicationId, options = {}) => {
    const session = ensureSession(socketService, applicationId, options);
    initiateCall(socketService, applicationId, {
        callType: session.audioOnly ? 'audio' : 'video',
        source: options.source || 'chat',
    });
    armCallTimeout(session, () => options.onTimeout?.());

    if (!session.runtime.supported || !session.peerConnection) {
        emitOffer(socketService, applicationId, {
            type: 'offer',
            unsupported: true,
            callType: session.audioOnly ? 'audio' : 'video',
        });
        return session;
    }

    try {
        await ensureLocalStream(session);
        const offer = await session.peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: !session.audioOnly,
        });
        await session.peerConnection.setLocalDescription(offer);
        emitOffer(socketService, applicationId, session.peerConnection.localDescription || offer);
        return session;
    } catch (error) {
        logger.error('Failed to start outgoing call:', error?.message || error);
        options.onError?.(error);
        throw error;
    }
};

export const handleIncomingOffer = async (socketService, applicationId, payload = {}, options = {}) => {
    const session = ensureSession(socketService, applicationId, options);
    armCallTimeout(session, () => options.onTimeout?.());
    const remoteOffer = payload?.offer || null;

    if (!session.runtime.supported || !session.peerConnection || !remoteOffer) {
        answerCall(socketService, applicationId, {
            type: 'answer',
            unsupported: true,
            callType: session.audioOnly ? 'audio' : 'video',
        });
        return session;
    }

    try {
        await ensureLocalStream(session);
        await session.peerConnection.setRemoteDescription(toSessionDescription(session.runtime, remoteOffer));
        const answer = await session.peerConnection.createAnswer();
        await session.peerConnection.setLocalDescription(answer);
        answerCall(socketService, applicationId, session.peerConnection.localDescription || answer);
        return session;
    } catch (error) {
        logger.error('Failed to handle incoming offer:', error?.message || error);
        options.onError?.(error);
        throw error;
    }
};

export const handleIncomingAnswer = async (applicationId, payload = {}, options = {}) => {
    const key = String(applicationId || '').trim();
    const session = sessionRegistry.get(key);
    if (!session?.runtime?.supported || !session?.peerConnection || !payload?.answer) {
        return;
    }
    try {
        await session.peerConnection.setRemoteDescription(
            toSessionDescription(session.runtime, payload.answer)
        );
        clearCallTimeout(session);
        options.onConnected?.();
    } catch (error) {
        logger.error('Failed to handle incoming answer:', error?.message || error);
        options.onError?.(error);
    }
};

export const handleIncomingIceCandidate = async (applicationId, payload = {}) => {
    const key = String(applicationId || '').trim();
    const session = sessionRegistry.get(key);
    if (!session?.runtime?.supported || !session?.peerConnection || !payload?.candidate) {
        return;
    }
    try {
        await session.peerConnection.addIceCandidate(
            toIceCandidate(session.runtime, payload.candidate)
        );
    } catch (error) {
        logger.warn('Failed to add ICE candidate:', error?.message || error);
    }
};

export const markCallConnected = (applicationId) => {
    const key = String(applicationId || '').trim();
    const session = sessionRegistry.get(key);
    if (!session) return;
    clearCallTimeout(session);
};

export const toggleLocalAudio = (applicationId, enabled) => {
    const session = sessionRegistry.get(String(applicationId || '').trim());
    if (!session?.localStream?.getAudioTracks) return false;
    session.localStream.getAudioTracks().forEach((track) => {
        track.enabled = Boolean(enabled);
    });
    return true;
};

export const toggleLocalVideo = (applicationId, enabled) => {
    const session = sessionRegistry.get(String(applicationId || '').trim());
    if (!session?.localStream?.getVideoTracks) return false;
    session.localStream.getVideoTracks().forEach((track) => {
        track.enabled = Boolean(enabled);
    });
    return true;
};

export const getCallSession = (applicationId) => (
    sessionRegistry.get(String(applicationId || '').trim()) || null
);

export const resetCallSession = (applicationId) => {
    cleanupSession(applicationId);
};
