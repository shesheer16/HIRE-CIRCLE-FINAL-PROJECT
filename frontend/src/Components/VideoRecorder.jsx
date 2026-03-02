import React, { useEffect, useRef, useState } from 'react';
import QuestionOverlay from './QuestionOverlay';
import Controls from './Controls';
import { buildApiUrl } from '../config/api';

// Use a standard function declaration with a clear default export at the bottom
function VideoRecorder({ onUploadSuccess }) {
    const videoRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const streamRef = useRef(null);
    const [isRecording, setIsRecording] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [videoBlob, setVideoBlob] = useState(null);
    const [error, setError] = useState(null);
    const [uploadStatus, setUploadStatus] = useState('idle');

    async function requestMedia() {
        try {
            const s = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: true
            });
            streamRef.current = s;
            if (videoRef.current) {
                videoRef.current.srcObject = s;
                try { await videoRef.current.play() } catch (_error) {}
            }
            setError(null);
            return true;
        } catch (err) {
            setError('Camera access denied. Please ensure you are on localhost or HTTPS.');
            return false;
        }
    }

    function startRecording() {
        setPreviewUrl(null);
        setError(null);
        try {
            const options = { mimeType: 'video/webm;codecs=vp8,opus' };
            const mr = new MediaRecorder(streamRef.current, options);
            mediaRecorderRef.current = mr;
            mediaRecorderRef.current._chunks = [];
            mr.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) mediaRecorderRef.current._chunks.push(e.data);
            };
            mr.onstop = () => {
                const recorded = mediaRecorderRef.current?._chunks || [];
                const blob = new Blob(recorded, { type: 'video/webm' });
                const url = URL.createObjectURL(blob);
                setVideoBlob(blob);
                setPreviewUrl(url);
            };
            mr.start();
            setIsRecording(true);
        } catch (err) {
            setError('Recording failed to start');
        }
    }

    async function uploadVideo() {
        if (!videoBlob) return;
        setUploadStatus('uploading');

        const formData = new FormData();
        formData.append('video', videoBlob, 'recording.webm');

        const userInfo = JSON.parse(localStorage.getItem('userInfo'));
        const token = userInfo ? userInfo.token : '';

        try {
            const res = await fetch(buildApiUrl('/api/upload/video'), {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}` // LINKED TO PHASE 1 AUTH
                },
                body: formData,
            });
            const data = await res.json();

            if (data.success) {
                setUploadStatus('success');
                if (onUploadSuccess) onUploadSuccess(data);
            } else {
                // Show detailed error if available (e.g. from Gemini or FFmpeg)
                const errorMsg = data.error ? `${data.message}: ${data.error}` : data.message || 'Upload failed';
                throw new Error(errorMsg);
            }
        } catch (err) {
            setUploadStatus('error');
            setError(err.message || 'Upload failed. See console for details.');
        }
    }

    const toggleRecording = async () => {
        if (!isRecording) {
            if (!streamRef.current) {
                const ok = await requestMedia();
                if (!ok) return;
            }
            startRecording();
        } else {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
            }
            setIsRecording(false);
        }
    };

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
            }
        };
    }, []);

    return (
        <div className="w-full">
            {error && <div className="mb-2 text-xs text-red-500 bg-red-50 p-2 rounded">{error}</div>}

            <div className="relative overflow-hidden rounded-xl bg-black aspect-video">
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />

                {/* FIXING UNUSED-VARS: The overlay is now correctly rendered */}
                <QuestionOverlay />

                {previewUrl && (
                    <div className="absolute inset-0 bg-black flex items-center justify-center">
                        <video src={previewUrl} playsInline controls className="w-full h-full" />
                    </div>
                )}
            </div>

            {/* FIXING UNUSED-VARS: Controls are now correctly rendered */}
            <Controls
                recording={isRecording}
                onStart={toggleRecording}
                onStop={toggleRecording}
            />

            <div className="mt-4 flex justify-between items-center">
                <span className="text-[10px] text-gray-400">Max 60 seconds</span>
                <button
                    onClick={uploadVideo}
                    disabled={!videoBlob || uploadStatus === 'uploading'}
                    className="bg-[#4F46E5] text-white px-6 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
                >
                    {uploadStatus === 'uploading' ? 'Saving...' : 'Upload Video'}
                </button>
            </div>
        </div>
    );
}

// FORCE DEFAULT EXPORT
export default VideoRecorder;
