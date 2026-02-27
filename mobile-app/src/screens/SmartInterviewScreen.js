import React, { useState, useRef, useEffect, useContext } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
    Animated, Dimensions, Alert, ActivityIndicator
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { getPrimaryRoleFromUser } from '../utils/roleMode';

const { width, height } = Dimensions.get('window');

// ─── MOCK DATA ───────────────────────────────────────────────────────────────
const MOCK_QUESTIONS = [
    {
        id: 1,
        category: 'Introduction',
        question: 'Tell us about yourself and what drew you to this role.',
        tip: 'Keep it under 90 seconds. Focus on your recent experience and why this role excites you.',
        timeLimit: 90,
    },
    {
        id: 2,
        category: 'Technical',
        question: 'Describe a challenging technical problem you solved recently. What was your approach?',
        tip: 'Use the STAR method: Situation, Task, Action, Result.',
        timeLimit: 120,
    },
    {
        id: 3,
        category: 'Behavioral',
        question: 'Tell me about a time you had to work with a difficult team member. How did you handle it?',
        tip: 'Show empathy, communication skills, and a positive outcome.',
        timeLimit: 90,
    },
    {
        id: 4,
        category: 'Role-Specific',
        question: 'How would you approach building a scalable mobile architecture from scratch?',
        tip: 'Mention state management, component design, and performance considerations.',
        timeLimit: 120,
    },
    {
        id: 5,
        category: 'Closing',
        question: 'Do you have any questions for us about the role or company culture?',
        tip: 'Prepare 2–3 thoughtful questions. This shows genuine interest.',
        timeLimit: 60,
    },
];

const MOCK_AI_FEEDBACK = [
    { label: 'Confidence', score: 82, color: '#7c3aed' },
    { label: 'Clarity', score: 76, color: '#4f46e5' },
    { label: 'Relevance', score: 91, color: '#22c55e' },
    { label: 'Pace', score: 68, color: '#f59e0b' },
];

const CATEGORY_COLORS = {
    Introduction: '#7c3aed',
    Technical: '#3b82f6',
    Behavioral: '#22c55e',
    'Role-Specific': '#f59e0b',
    Closing: '#ec4899',
};

// ─── STAGES ─────────────────────────────────────────────────────────────────
// 'intro' → 'question' → 'recording' → 'feedback' → 'review' → 'complete'

export default function SmartInterviewScreen({ navigation, route }) {
    const insets = useSafeAreaInsets();
    const { jobTitle = 'Senior React Native Developer', company = 'TechCorp India' } = route?.params || {};

    const [stage, setStage] = useState('intro');
    const [questionIndex, setQuestionIndex] = useState(0);
    const [timer, setTimer] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [completedAnswers, setCompletedAnswers] = useState([]);
    const [showTip, setShowTip] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [finalVideoUri, setFinalVideoUri] = useState(null);
    const [extractedData, setExtractedData] = useState(null);

    const { userInfo, completeOnboarding } = useContext(AuthContext);

    const timerRef = useRef(null);
    const pulseAnim = useRef(new Animated.Value(1)).current;

    const currentQ = MOCK_QUESTIONS[questionIndex];
    // Reduce to 1 question to match backend constraints of processing 1 video
    const totalQ = 1;
    const progress = ((questionIndex) / totalQ) * 100;

    // Pulse animation for recording dot
    useEffect(() => {
        if (isRecording) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
                    Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
                ])
            ).start();
        } else {
            pulseAnim.stopAnimation();
            pulseAnim.setValue(1);
        }
    }, [isRecording]);

    const startTimer = () => {
        setTimer(0);
        timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    };

    const stopTimer = () => {
        if (timerRef.current) clearInterval(timerRef.current);
    };

    const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

    const handleStartRecording = () => {
        // Navigate to actual VideoRecordScreen
        // Pass a callback or use route params if we need to know we returned
        navigation.navigate('VideoRecord', {
            fromSmartInterview: true,
            questionId: currentQ.id
        });
    };

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', () => {
            if (route.params?.videoCompleted) {
                // If we returned from VideoRecordScreen with success
                if (route.params?.videoUri) {
                    setFinalVideoUri(route.params.videoUri);
                }
                handleStopRecording();
                // clear param
                navigation.setParams({ videoCompleted: false, videoUri: undefined });
            }
        });
        return unsubscribe;
    }, [navigation, route.params]);

    const handleStopRecording = () => {
        setIsRecording(false);
        stopTimer();
        setCompletedAnswers(prev => [...prev, { questionId: currentQ.id, duration: 60 }]); // mock getting duration
        setStage('feedback');
    };

    const handleUploadFinish = async () => {
        if (!finalVideoUri) {
            setStage('complete');
            return;
        }

        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('video', {
                uri: finalVideoUri,
                type: 'video/mp4',
                name: 'upload.mp4',
            });

            const { data } = await client.post('/api/upload/video', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                transformRequest: (data) => data,
                timeout: 80000,
            });

            if (data.success) {
                const role = getPrimaryRoleFromUser(userInfo);
                const defaultReviewData = role === 'employer'
                    ? {
                        jobTitle: '',
                        companyName: userInfo?.name || '',
                        requiredSkills: [],
                        experienceRequired: '',
                        salaryRange: '',
                        shift: 'flexible',
                        location: '',
                        description: '',
                    }
                    : {
                        name: userInfo?.name || '',
                        roleTitle: '',
                        skills: [],
                        experienceYears: 0,
                        expectedSalary: '',
                        preferredShift: 'flexible',
                        location: '',
                        summary: '',
                    };

                setExtractedData({
                    ...defaultReviewData,
                    ...(data?.extractedData || {}),
                });
                setStage('review');
            } else {
                throw new Error(data.message || "Upload failed");
            }
        } catch (error) {
            logger.error("Upload error:", error);
            Alert.alert(
                "AI Processing Failed",
                "There was an issue processing your video. Please try again.",
                [{ text: "OK", onPress: () => setStage('intro') }]
            );
        } finally {
            setIsUploading(false);
        }
    };

    const handleConfirmSave = async () => {
        if (!extractedData) return;

        const role = getPrimaryRoleFromUser(userInfo);
        try {
            if (role === 'employer') {
                await client.put('/api/users/profile', {
                    companyName: extractedData.companyName || userInfo?.name || 'My Company',
                    location: extractedData.location || 'Remote',
                    industry: extractedData.jobTitle || '',
                    hasCompletedProfile: true,
                });
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
                        skills: Array.isArray(extractedData.skills) ? extractedData.skills : String(extractedData.skills || '').split(',').map((s) => s.trim()).filter(Boolean),
                        lastUpdated: new Date(),
                    }],
                    hasCompletedProfile: true,
                });
            }

            await completeOnboarding?.();
            setStage('complete');
        } catch (error) {
            logger.error('Profile save after review failed:', error);
            Alert.alert('Save Failed', 'Could not save profile. Please try again.');
        }
    };

    const handleNextQuestion = () => {
        if (questionIndex + 1 >= totalQ) {
            handleUploadFinish();
        } else {
            setQuestionIndex(prev => prev + 1);
            setTimer(0);
            setShowTip(false);
            setStage('question');
        }
    };

    const handleSkip = () => {
        setCompletedAnswers(prev => [...prev, { questionId: currentQ.id, duration: 0, skipped: true }]);
        handleNextQuestion();
    };

    // ── INTRO STAGE ───────────────────────────────────────────────────────
    if (stage === 'intro') {
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <ScrollView contentContainerStyle={styles.scrollCenter} showsVerticalScrollIndicator={false}>
                    <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                        <Text style={styles.backArrow}>‹</Text>
                    </TouchableOpacity>

                    <View style={styles.introBadge}>
                        <Text style={styles.introBadgeText}>✦ AI-POWERED</Text>
                    </View>

                    <Text style={styles.introTitle}>Smart Interview</Text>
                    <Text style={styles.introTitle2}>Mode</Text>

                    <View style={styles.jobTagRow}>
                        <Text style={styles.jobTagText}>💼 {jobTitle}</Text>
                        <Text style={styles.jobTagDot}>·</Text>
                        <Text style={styles.jobTagText}>{company}</Text>
                    </View>

                    <Text style={styles.introDesc}>
                        Answer {totalQ} AI-generated questions at your own pace. Your responses will be analyzed for confidence, clarity, and relevance.
                    </Text>

                    {/* Steps */}
                    <View style={styles.stepsCard}>
                        {[
                            { icon: '🎯', title: 'Read the question', desc: 'Take your time to understand it' },
                            { icon: '💡', title: 'View the AI tip', desc: 'Get hints on how to answer well' },
                            { icon: '🎙', title: 'Record your answer', desc: 'Speak naturally, max 2 minutes' },
                            { icon: '📊', title: 'Get instant feedback', desc: 'See your AI score after each answer' },
                        ].map((step, i) => (
                            <View key={i} style={styles.stepRow}>
                                <View style={styles.stepIconBox}>
                                    <Text style={styles.stepIcon}>{step.icon}</Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.stepTitle}>{step.title}</Text>
                                    <Text style={styles.stepDesc}>{step.desc}</Text>
                                </View>
                            </View>
                        ))}
                    </View>

                    <TouchableOpacity
                        style={styles.startBtn}
                        onPress={() => setStage('question')}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.startBtnText}>Start Interview →</Text>
                    </TouchableOpacity>

                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        );
    }

    if (stage === 'review') {
        const isDemandMode = getPrimaryRoleFromUser(userInfo) === 'employer';
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <ScrollView contentContainerStyle={styles.scrollCenter} showsVerticalScrollIndicator={false}>
                    <Text style={styles.completeTitle}>Here's What We Understood</Text>
                    <Text style={styles.completeSubtitle}>Review and edit before we save your profile.</Text>

                    <View style={styles.reviewCard}>
                        {isDemandMode ? (
                            <>
                                <Text style={styles.reviewLabel}>Job Title</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.jobTitle || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), jobTitle: value }))}
                                    placeholder="Job title"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Company Name</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.companyName || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), companyName: value }))}
                                    placeholder="Company name"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Skills</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={Array.isArray(extractedData?.requiredSkills) ? extractedData.requiredSkills.join(', ') : String(extractedData?.requiredSkills || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), requiredSkills: value.split(',').map((item) => item.trim()).filter(Boolean) }))}
                                    placeholder="Required skills"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Location</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.location || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), location: value }))}
                                    placeholder="Location"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Description</Text>
                                <TextInput
                                    style={[styles.reviewInput, styles.reviewInputMultiline]}
                                    multiline
                                    value={String(extractedData?.description || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), description: value }))}
                                    placeholder="Job description"
                                    placeholderTextColor="#94a3b8"
                                />
                            </>
                        ) : (
                            <>
                                <Text style={styles.reviewLabel}>Name</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.name || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), name: value }))}
                                    placeholder="Your name"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Role</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.roleTitle || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), roleTitle: value }))}
                                    placeholder="Role title"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Skills</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={Array.isArray(extractedData?.skills) ? extractedData.skills.join(', ') : String(extractedData?.skills || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), skills: value.split(',').map((item) => item.trim()).filter(Boolean) }))}
                                    placeholder="Skills"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Experience (Years)</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    keyboardType="numeric"
                                    value={String(extractedData?.experienceYears ?? '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), experienceYears: value }))}
                                    placeholder="Years of experience"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Location</Text>
                                <TextInput
                                    style={styles.reviewInput}
                                    value={String(extractedData?.location || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), location: value }))}
                                    placeholder="Location"
                                    placeholderTextColor="#94a3b8"
                                />
                                <Text style={styles.reviewLabel}>Summary</Text>
                                <TextInput
                                    style={[styles.reviewInput, styles.reviewInputMultiline]}
                                    multiline
                                    value={String(extractedData?.summary || '')}
                                    onChangeText={(value) => setExtractedData((prev) => ({ ...(prev || {}), summary: value }))}
                                    placeholder="Summary"
                                    placeholderTextColor="#94a3b8"
                                />
                            </>
                        )}
                    </View>

                    <TouchableOpacity
                        style={styles.startBtn}
                        onPress={handleConfirmSave}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.startBtnText}>Looks Good →</Text>
                    </TouchableOpacity>
                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        );
    }

    // ── COMPLETE STAGE ────────────────────────────────────────────────────
    if (stage === 'complete') {
        const isDemandMode = getPrimaryRoleFromUser(userInfo) === 'employer';
        return (
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <ScrollView contentContainerStyle={styles.scrollCenter} showsVerticalScrollIndicator={false}>
                    <Text style={styles.completeEmoji}>🎉</Text>
                    <Text style={styles.completeTitle}>Processing Complete!</Text>
                    <Text style={styles.completeSubtitle}>
                        {isDemandMode
                            ? "Great! We've processed your video and automatically posted a job listing with those requirements."
                            : "Excellent! Your AI profile has been created. Let's see your job matches."}
                    </Text>

                    <View style={styles.overallScoreCard}>
                        <Text style={styles.overallScoreLabel}>AI CONFIDENCE SCORE</Text>
                        <Text style={styles.overallScoreValue}>94%</Text>
                        <Text style={styles.overallScoreGrade}>Highly Accurate Profile Generated</Text>
                    </View>

                    <TouchableOpacity
                        style={styles.startBtn}
                        onPress={() => navigation.navigate('MainTab', { screen: isDemandMode ? 'My Jobs' : 'Profiles' })}
                        activeOpacity={0.85}
                    >
                        <Text style={styles.startBtnText}>{isDemandMode ? 'View My Posts →' : 'Go to Profile →'}</Text>
                    </TouchableOpacity>

                    <View style={{ height: 40 }} />
                </ScrollView>
            </View>
        );
    }

    // ── QUESTION / RECORDING / FEEDBACK STAGES ─────────────────────────────
    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {isUploading && (
                <View style={styles.uploadingOverlayAbsolute}>
                    <ActivityIndicator size="large" color="#7c3aed" />
                    <Text style={styles.uploadingOverlayText}>Analyzing Video with AI...</Text>
                    <Text style={styles.uploadingSubText}>Extracting skills, generating profile, matching jobs.</Text>
                </View>
            )}
            {/* Top Bar */}
            <View style={styles.topBar}>
                <TouchableOpacity style={styles.backBtn} onPress={() => {
                    Alert.alert('Exit Interview?', 'Your progress will be lost.', [
                        { text: 'Stay', style: 'cancel' },
                        { text: 'Exit', style: 'destructive', onPress: () => navigation.goBack() },
                    ]);
                }} activeOpacity={0.7}>
                    <Text style={styles.backArrow}>‹</Text>
                </TouchableOpacity>

                <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <View style={styles.progressBar}>
                        <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.progressText}>Question {questionIndex + 1} of {totalQ}</Text>
                </View>

                {/* Timer */}
                <View style={[styles.timerBadge, isRecording && styles.timerBadgeRecording]}>
                    {isRecording && (
                        <Animated.View style={[styles.recDot, { transform: [{ scale: pulseAnim }] }]} />
                    )}
                    <Text style={styles.timerText}>{formatTime(timer)}</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollPadded} showsVerticalScrollIndicator={false}>
                {/* Category Badge */}
                <View style={[styles.categoryBadge, { backgroundColor: (CATEGORY_COLORS[currentQ.category] || '#7c3aed') + '22' }]}>
                    <View style={[styles.categoryDot, { backgroundColor: CATEGORY_COLORS[currentQ.category] || '#7c3aed' }]} />
                    <Text style={[styles.categoryText, { color: CATEGORY_COLORS[currentQ.category] || '#7c3aed' }]}>
                        {currentQ.category}
                    </Text>
                </View>

                {/* Question Card */}
                <View style={styles.questionCard}>
                    <Text style={styles.questionNumber}>Q{questionIndex + 1}</Text>
                    <Text style={styles.questionText}>{currentQ.question}</Text>
                    <View style={styles.timeLimitRow}>
                        <Text style={styles.timeLimitText}>⏱ {currentQ.timeLimit}s recommended</Text>
                    </View>
                </View>

                {/* AI Tip */}
                <TouchableOpacity
                    style={styles.tipToggle}
                    onPress={() => setShowTip(!showTip)}
                    activeOpacity={0.8}
                >
                    <Text style={styles.tipToggleText}>{showTip ? '▲ Hide' : '💡 Show'} AI Tip</Text>
                </TouchableOpacity>
                {showTip && (
                    <View style={styles.tipCard}>
                        <Text style={styles.tipText}>{currentQ.tip}</Text>
                    </View>
                )}

                {/* RECORDING IS DELEGATED TO VideoRecordScreen */}

                {/* FEEDBACK STAGE */}
                {stage === 'feedback' && (
                    <View style={styles.feedbackCard}>
                        <View style={styles.sectionHeader}>
                            <View style={styles.sectionAccent} />
                            <Text style={styles.sectionTitle}>AI FEEDBACK</Text>
                        </View>
                        {MOCK_AI_FEEDBACK.map((item, i) => (
                            <View key={i} style={styles.scoreRow}>
                                <Text style={styles.scoreLabel}>{item.label}</Text>
                                <View style={styles.scoreBarBg}>
                                    <View style={[styles.scoreBarFill, { width: `${item.score}%`, backgroundColor: item.color }]} />
                                </View>
                                <Text style={[styles.scoreValue, { color: item.color }]}>{item.score}%</Text>
                            </View>
                        ))}
                        <View style={styles.feedbackNote}>
                            <Text style={styles.feedbackNoteText}>
                                💬 Good answer! Try to be more specific with metrics and outcomes next time.
                            </Text>
                        </View>
                    </View>
                )}

                <View style={{ height: 120 }} />
            </ScrollView>

            {/* Bottom Action Bar */}
            <View style={[styles.actionBar, { paddingBottom: insets.bottom + 16 }]}>
                {stage === 'question' && (
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
                            <Text style={styles.skipBtnText}>Skip</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.recordBtn} onPress={handleStartRecording} activeOpacity={0.85}>
                            <View style={styles.recordBtnInner} />
                            <Text style={styles.recordBtnText}>Hold to Record</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* STOP RECORDING IS DELEGATED */}

                {stage === 'feedback' && (
                    <TouchableOpacity style={styles.nextBtn} onPress={handleNextQuestion} activeOpacity={0.85}>
                        <Text style={styles.nextBtnText}>
                            {questionIndex + 1 >= totalQ ? 'See Final Results →' : `Next Question →`}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0f172a' },
    scrollCenter: { padding: 24, alignItems: 'center' },
    scrollPadded: { padding: 16 },

    // Back
    backBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center', alignItems: 'center',
        alignSelf: 'flex-start', marginBottom: 20,
    },
    backArrow: { color: '#fff', fontSize: 30, fontWeight: '300', marginBottom: 2 },

    // Intro
    introBadge: {
        backgroundColor: 'rgba(124,58,237,0.2)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 20,
    },
    introBadgeText: { color: '#c4b5fd', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
    introTitle: { color: '#ffffff', fontSize: 36, fontWeight: '900', textAlign: 'center', lineHeight: 42 },
    introTitle2: { color: '#7c3aed', fontSize: 36, fontWeight: '900', textAlign: 'center', marginBottom: 16, lineHeight: 42 },
    jobTagRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 6 },
    jobTagText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
    jobTagDot: { color: '#475569', fontSize: 18 },
    introDesc: {
        color: '#94a3b8', fontSize: 14, fontWeight: '500', textAlign: 'center',
        lineHeight: 22, marginBottom: 28, maxWidth: 320,
    },
    stepsCard: {
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20,
        width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        marginBottom: 28, gap: 16,
    },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stepIconBox: {
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: 'rgba(124,58,237,0.15)', justifyContent: 'center', alignItems: 'center',
    },
    stepIcon: { fontSize: 20 },
    stepTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '700', marginBottom: 2 },
    stepDesc: { color: '#64748b', fontSize: 12, fontWeight: '500' },
    startBtn: {
        backgroundColor: '#7c3aed', borderRadius: 20, paddingVertical: 18,
        alignItems: 'center', width: '100%',
        shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 14, elevation: 8,
    },
    startBtnText: { color: '#fff', fontSize: 16, fontWeight: '900' },

    // Top bar
    topBar: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
        backgroundColor: '#0f172a', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    progressBar: {
        height: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 4,
    },
    progressFill: { height: '100%', backgroundColor: '#7c3aed', borderRadius: 3 },
    progressText: { fontSize: 10, color: '#64748b', fontWeight: '600' },
    timerBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
        paddingHorizontal: 10, paddingVertical: 6,
    },
    timerBadgeRecording: { backgroundColor: 'rgba(220,38,38,0.15)', borderWidth: 1, borderColor: 'rgba(220,38,38,0.3)' },
    recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#dc2626' },
    timerText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },

    // Category badge
    categoryBadge: {
        flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
        borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 12,
    },
    categoryDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
    categoryText: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.8 },

    // Question
    questionCard: {
        backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 20, marginBottom: 14,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    },
    questionNumber: { fontSize: 11, fontWeight: '900', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
    questionText: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', lineHeight: 26, marginBottom: 14 },
    timeLimitRow: { flexDirection: 'row', alignItems: 'center' },
    timeLimitText: { fontSize: 11, color: '#64748b', fontWeight: '600' },

    // Tip
    tipToggle: {
        alignSelf: 'flex-start', backgroundColor: 'rgba(124,58,237,0.15)',
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 10,
    },
    tipToggleText: { color: '#a78bfa', fontSize: 13, fontWeight: '700' },
    tipCard: {
        backgroundColor: 'rgba(124,58,237,0.12)', borderRadius: 16, padding: 16, marginBottom: 14,
        borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)',
    },
    tipText: { color: '#c4b5fd', fontSize: 14, lineHeight: 21, fontWeight: '500' },

    // Recording indicator
    recordingCard: {
        backgroundColor: 'rgba(220,38,38,0.1)', borderRadius: 16, padding: 20, marginBottom: 14,
        borderWidth: 1, borderColor: 'rgba(220,38,38,0.25)', alignItems: 'center',
    },
    recIndicator: { marginBottom: 10 },
    recIndicatorText: { fontSize: 32, color: '#dc2626' },
    recordingLabel: { color: '#fca5a5', fontSize: 16, fontWeight: '800', marginBottom: 4 },
    recordingSubLabel: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },

    // Feedback
    feedbackCard: {
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20, marginBottom: 14,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    sectionAccent: { width: 3, height: 14, backgroundColor: '#7c3aed', borderRadius: 2, marginRight: 8 },
    sectionTitle: { fontSize: 11, fontWeight: '900', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1.2 },
    scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    scoreLabel: { width: 80, color: '#94a3b8', fontSize: 12, fontWeight: '600' },
    scoreBarBg: { flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden', marginHorizontal: 10 },
    scoreBarFill: { height: '100%', borderRadius: 3 },
    scoreValue: { width: 36, textAlign: 'right', fontSize: 12, fontWeight: '900' },
    feedbackNote: {
        backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: 12, padding: 14, marginTop: 6,
        borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)',
    },
    feedbackNoteText: { color: '#c4b5fd', fontSize: 13, lineHeight: 20, fontWeight: '500' },

    // Action bar
    actionBar: {
        backgroundColor: 'rgba(15,23,42,0.97)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
        paddingHorizontal: 20, paddingTop: 16,
    },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    skipBtn: {
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 16,
        paddingVertical: 16, paddingHorizontal: 20,
    },
    skipBtnText: { color: '#64748b', fontWeight: '700', fontSize: 14 },
    recordBtn: {
        flex: 1, backgroundColor: '#7c3aed', borderRadius: 20, paddingVertical: 18,
        flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
        shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
    },
    recordBtnInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
    recordBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
    stopBtn: {
        backgroundColor: '#dc2626', borderRadius: 20, paddingVertical: 18,
        flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
        shadowColor: '#dc2626', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
    },
    stopBtnInner: { width: 14, height: 14, borderRadius: 3, backgroundColor: '#fff' },
    stopBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },
    nextBtn: {
        backgroundColor: '#7c3aed', borderRadius: 20, paddingVertical: 18, alignItems: 'center',
        shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6,
    },
    nextBtnText: { color: '#fff', fontWeight: '900', fontSize: 15 },

    // Complete
    completeEmoji: { fontSize: 64, marginBottom: 16, textAlign: 'center' },
    completeTitle: { color: '#fff', fontSize: 28, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
    completeSubtitle: { color: '#94a3b8', fontSize: 14, fontWeight: '500', textAlign: 'center', marginBottom: 24, maxWidth: 300 },
    overallScoreCard: {
        backgroundColor: '#7c3aed', borderRadius: 24, padding: 28, alignItems: 'center',
        width: '100%', marginBottom: 20,
        shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
    },
    overallScoreLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
    overallScoreValue: { color: '#fff', fontSize: 56, fontWeight: '900', lineHeight: 60 },
    overallScoreGrade: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', marginTop: 4 },
    breakdownCard: {
        backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: 20,
        width: '100%', marginBottom: 16,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    },
    summaryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
    summaryDot: { width: 8, height: 8, borderRadius: 4 },
    summaryQ: { flex: 1, color: '#94a3b8', fontSize: 12, fontWeight: '500' },
    summaryTime: { color: '#64748b', fontSize: 11, fontWeight: '600' },
    retryLink: { paddingVertical: 14, alignItems: 'center' },
    retryLinkText: { color: '#7c3aed', fontSize: 14, fontWeight: '700' },
    reviewCard: {
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        padding: 16,
        width: '100%',
        marginBottom: 20,
    },
    reviewLabel: {
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 6,
        marginTop: 8,
    },
    reviewInput: {
        backgroundColor: 'rgba(15,23,42,0.6)',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.12)',
        color: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
    },
    reviewInputMultiline: {
        minHeight: 90,
        textAlignVertical: 'top',
    },

    uploadingOverlayAbsolute: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(15,23,42,0.95)',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 999,
    },
    uploadingOverlayText: {
        color: '#fff',
        fontSize: 20,
        fontWeight: '900',
        marginTop: 20,
    },
    uploadingSubText: {
        color: '#94a3b8',
        fontSize: 14,
        marginTop: 8,
        textAlign: 'center',
    }
});
