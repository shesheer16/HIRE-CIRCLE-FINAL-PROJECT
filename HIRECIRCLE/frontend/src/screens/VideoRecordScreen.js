import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator
} from 'react-native';
import { logger } from '../utils/logger';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { getPrimaryRoleFromUser } from '../utils/roleMode';

export default function VideoRecordScreen({ navigation, route }) {
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
    const [isRecording, setIsRecording] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [timer, setTimer] = useState(0);
    const [recordedVideoUri, setRecordedVideoUri] = useState(null);
    const [uploadFailed, setUploadFailed] = useState(false);
    const cameraRef = useRef(null);
    const timerRef = useRef(null);

    const { userInfo } = React.useContext(AuthContext);

    useEffect(() => {
        if (!cameraPermission?.granted) requestCameraPermission();
        if (!microphonePermission?.granted) requestMicrophonePermission();
    }, []);

    const startRecording = async () => {
        if (cameraRef.current) {
            try {
                setIsRecording(true);
                // Start Timer
                setTimer(0);
                timerRef.current = setInterval(() => {
                    setTimer((t) => t + 1);
                }, 1000);

                const video = await cameraRef.current.recordAsync({
                    maxDuration: 60,
                });

                // When recording stops (either manually or maxDuration matches)
                // The promise resolves with the video object
                handleUpload(video.uri);
            } catch (error) {
                logger.error("Recording failed", error);
                Alert.alert("Error", "Failed to record video");
                stopRecordingState();
            }
        }
    };

    const stopRecording = () => {
        if (cameraRef.current && isRecording) {
            cameraRef.current.stopRecording();
            // recordAsync promise will resolve in startRecording
        }
    };

    const stopRecordingState = () => {
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const handleUpload = async (uri) => {
        stopRecordingState();
        const videoUri = uri || recordedVideoUri;
        if (uri) setRecordedVideoUri(uri);

        if (route.params?.fromSmartInterview) {
            // DO NOT upload here. Just return the recorded URI to SmartInterview flow.
            navigation.navigate('SmartInterview', { videoCompleted: true, videoUri: videoUri });
            return;
        }

        setUploading(true);
        setUploadFailed(false);

        const formData = new FormData();
        formData.append('video', {
            uri: videoUri,
            type: 'video/mp4',
            name: 'upload.mp4',
        });

        try {
            const { data } = await client.post('/api/v2/upload/video', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                transformRequest: (data) => data,
                timeout: 60000, // Extend timeout to 60s for large video files
            });

            if (data.success) {
                if (getPrimaryRoleFromUser(userInfo) === 'employer') {
                    Alert.alert("Success", "Video processed! Your Job is ready.", [
                        { text: "View Job", onPress: () => navigation.navigate('MainTab', { screen: 'My Jobs' }) }
                    ]);
                } else {
                    Alert.alert("Success", "Profile created from your interview!", [
                        { text: "View Profile", onPress: () => navigation.navigate('MainTab', { screen: 'Profiles' }) }
                    ]);
                }
            } else {
                throw new Error(data.message || "Upload failed");
            }
        } catch (error) {
            logger.error("Upload error:", error);
            setUploadFailed(true);
        } finally {
            setUploading(false);
        }
    };

    const handleRetry = () => {
        if (recordedVideoUri) {
            handleUpload(recordedVideoUri);
        }
    };

    const handleDiscard = () => {
        setRecordedVideoUri(null);
        setUploadFailed(false);
        setTimer(0);
    };

    // Permission Guard
    if (!cameraPermission || !microphonePermission) {
        return <View style={[styles.container, styles.center]}><ActivityIndicator /></View>;
    }

    if (!cameraPermission.granted || !microphonePermission.granted) {
        return (
            <SafeAreaView style={[styles.container, styles.permissionContainer]}>
                <Text style={styles.permissionText}>We need camera and microphone access to record your video interview.</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={() => {
                    requestCameraPermission();
                    requestMicrophonePermission();
                }}>
                    <Text style={styles.permissionButtonText}>Grant Permissions</Text>
                </TouchableOpacity>
            </SafeAreaView>
        )
    }

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    return (
        <View style={styles.container}>
            <CameraView
                style={styles.camera}
                facing="front"
                mode="video"
                ref={cameraRef}
            >
                <SafeAreaView style={styles.overlay}>
                    <View>
                        <View style={styles.header}>
                            <TouchableOpacity
                                onPress={() => {
                                    if (navigation.canGoBack()) {
                                        navigation.goBack();
                                        return;
                                    }
                                    navigation.navigate('MainTab');
                                }}
                                disabled={isRecording}
                            >
                                <Ionicons name="close-circle" size={40} color="white" style={{ opacity: isRecording ? 0.0 : 1 }} />
                            </TouchableOpacity>
                            <View style={styles.timerContainer}>
                                {isRecording && <View style={styles.redDot} />}
                                <Text style={styles.timerText}>{formatTime(timer)}</Text>
                            </View>
                            <View style={{ width: 40 }} />
                        </View>

                        {/* Question Overlay */}
                        <View style={styles.questionOverlay}>
                            <Text style={styles.questionLabel}>Current Question</Text>
                            <Text style={styles.questionText}>"Tell us about yourself and your relevant experience."</Text>
                        </View>
                    </View>

                    {uploading && (
                        <View style={styles.uploadingOverlay}>
                            <ActivityIndicator size="large" color="#fff" />
                            <Text style={styles.uploadingText}>Processing with AI...</Text>
                        </View>
                    )}

                    {uploadFailed && (
                        <View style={styles.uploadingOverlay}>
                            <Ionicons name="alert-circle" size={50} color="#EF4444" />
                            <Text style={styles.uploadingText}>Upload Failed</Text>
                            <Text style={styles.subText}>Check your internet and try again.</Text>

                            <View style={styles.actionButtons}>
                                <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                                    <Text style={styles.buttonText}>Retry Upload</Text>
                                </TouchableOpacity>

                                <TouchableOpacity style={styles.discardButton} onPress={handleDiscard}>
                                    <Text style={styles.discardText}>Discard & Record New</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    <View style={styles.footer}>
                        {!uploading && (
                            <>
                                <TouchableOpacity
                                    style={[styles.recordButton, isRecording && styles.recordingButton]}
                                    onPress={isRecording ? stopRecording : startRecording}
                                >
                                    <View style={[styles.innerRecordButton, isRecording && styles.innerRecordingButton]} />
                                </TouchableOpacity>
                                <Text style={styles.hintText}>{isRecording ? "Tap to Stop" : "Tap to Record"}</Text>
                            </>
                        )}
                    </View>
                </SafeAreaView>
            </CameraView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    center: {
        justifyContent: 'center',
        alignItems: 'center'
    },
    camera: {
        flex: 1,
    },
    overlay: {
        flex: 1,
        justifyContent: 'space-between',
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start'
    },
    timerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20
    },
    timerText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    },
    redDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#EF4444',
        marginRight: 6
    },
    footer: {
        alignItems: 'center',
        marginBottom: 20
    },
    recordButton: {
        width: 80,
        height: 80,
        borderRadius: 40,
        borderWidth: 6,
        borderColor: 'rgba(255,255,255,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10
    },
    recordingButton: {
        borderColor: '#EF4444' // Red border when recording
    },
    innerRecordButton: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'white'
    },
    innerRecordingButton: {
        width: 30,
        height: 30,
        borderRadius: 4, // Square when recording
        backgroundColor: '#EF4444'
    },
    hintText: {
        color: 'white',
        fontWeight: '600'
    },
    permissionContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40
    },
    permissionText: {
        color: '#fff',
        textAlign: 'center',
        marginBottom: 20,
        fontSize: 16
    },
    permissionButton: {
        backgroundColor: '#4F46E5',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8
    },
    permissionButtonText: {
        color: '#fff',
        fontWeight: 'bold'
    },
    uploadingOverlay: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
        zIndex: 10
    },
    uploadingText: {
        color: 'white',
        marginTop: 20,
        fontSize: 18,
        fontWeight: 'bold'
    },
    subText: {
        color: '#D1D5DB',
        marginTop: 8,
        fontSize: 14,
        marginBottom: 24
    },
    actionButtons: {
        width: '100%',
        paddingHorizontal: 40,
        gap: 12
    },
    retryButton: {
        backgroundColor: '#4F46E5',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        width: '100%'
    },
    buttonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    },
    discardButton: {
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        width: '100%',
        borderWidth: 1,
        borderColor: '#EF4444'
    },
    discardText: {
        color: '#EF4444',
        fontWeight: 'bold',
        fontSize: 16
    },
    questionOverlay: {
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: 16,
        borderRadius: 12,
        marginHorizontal: 4,
        marginTop: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)'
    },
    questionLabel: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#D1D5DB', // Gray-300
        textTransform: 'uppercase',
        marginBottom: 4,
        letterSpacing: 1
    },
    questionText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#FFFFFF',
        lineHeight: 24,
        fontStyle: 'italic'
    }
});
