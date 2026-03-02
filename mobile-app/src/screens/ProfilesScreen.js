import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, Animated, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    IconUsers, IconMapPin, IconBriefcase, IconCheck, IconVideo, IconGlobe, IconFile, IconX, IconMessageSquare, IconPlus
} from '../components/Icons';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import ProfileAuthorityCard from '../components/ProfileAuthorityCard';
import client from '../api/client';
import { useFocusEffect } from '@react-navigation/native';
import { validateProfileResponse, logValidationError } from '../utils/apiValidator';
import { useAppStore } from '../store/AppStore';
import { trackEvent } from '../services/analytics';
import { buildAuthorityMetrics } from '../utils/profileAuthority';

const REQUEST_TIMEOUT_MS = 12000;
const SUGGESTED_SKILLS = ['Customer handling', 'Inventory', 'Forklift', 'POS billing', 'Last-mile delivery', 'Warehouse safety'];

const withRequestTimeout = (promise, timeoutMessage) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
        reject(new Error(timeoutMessage));
    }, REQUEST_TIMEOUT_MS);

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

// ─── COMPLETION CALCULATOR ────────────────────────────────────────────────────
const calcCompletion = (prof) => {
    const fields = [
        !!prof?.name?.trim(),
        !!prof?.roleTitle?.trim(),
        !!prof?.location?.trim(),
        !!prof?.summary?.trim(),
        prof?.skills?.length > 0,
        prof?.qualifications?.length > 0,
    ];
    const filled = fields.filter(Boolean).length;
    const pct = Math.round((filled / fields.length) * 100);
    const fieldNames = ['name', 'role title', 'location', 'summary', 'skills', 'qualifications'];
    const missingIdx = fields.findIndex(f => !f);
    const nextField = missingIdx >= 0 ? fieldNames[missingIdx] : null;
    return { pct, nextField };
};

// ─── PROFILE COMPLETION CARD ──────────────────────────────────────────────────
const CompletionCard = ({ profile, onEditPress }) => {
    const { pct, nextField } = calcCompletion(profile);
    const progressAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(progressAnim, {
            toValue: pct / 100,
            duration: 900,
            useNativeDriver: false,
        }).start();
    }, [pct]);

    const barWidth = progressAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0%', '100%'],
    });

    const barColor = pct < 50 ? '#ef4444' : pct < 80 ? '#f59e0b' : '#9333ea';

    return (
        <TouchableOpacity style={styles.completionCard} onPress={onEditPress} activeOpacity={0.85}>
            <View style={styles.completionTopRow}>
                <Text style={styles.completionTitle}>Profile Strength</Text>
                <Text style={[styles.completionPct, { color: barColor }]}>{pct}%</Text>
            </View>
            <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, { width: barWidth, backgroundColor: barColor }]} />
            </View>
            {nextField ? (
                <Text style={styles.completionHint}>Add <Text style={styles.completionHintBold}>{nextField}</Text> to reach {Math.min(pct + 17, 100)}% →</Text>
            ) : (
                <Text style={styles.completionHint}>🎉 Profile complete! Great job.</Text>
            )}
        </TouchableOpacity>
    );
};

// ─── IMPACT SCORE PANEL — Feature #78 ───────────────────────────────────────
const TRUST_TIERS = [
    { min: 80, label: 'Verified Pro', color: '#7c3aed', bg: '#ede9fe', emoji: '🏆' },
    { min: 65, label: 'Gold', color: '#d97706', bg: '#fef3c7', emoji: '🥇' },
    { min: 45, label: 'Silver', color: '#6b7280', bg: '#f3f4f6', emoji: '🥈' },
    { min: 0, label: 'Bronze', color: '#92400e', bg: '#fef9ee', emoji: '🥉' },
];

function resolveTrustTier(score) {
    return TRUST_TIERS.find((t) => score >= t.min) || TRUST_TIERS[TRUST_TIERS.length - 1];
}

const ImpactScorePanel = ({ impactScore, trustScore }) => {
    const score = Math.round(Number(impactScore || 0));
    const tScore = Math.round(Number(trustScore || 0));
    const tier = resolveTrustTier(tScore);
    const ringColor = score >= 80 ? '#7c3aed' : score >= 60 ? '#9333ea' : score >= 40 ? '#f59e0b' : '#ef4444';

    return (
        <View style={styles.impactPanel}>
            {/* Impact Score */}
            <View style={styles.impactScoreBlock}>
                <View style={[styles.impactRing, { borderColor: ringColor }]}>
                    <Text style={[styles.impactScoreNumber, { color: ringColor }]}>{score}</Text>
                    <Text style={styles.impactScoreLabel}>score</Text>
                </View>
                <Text style={styles.impactTitle}>Impact Score</Text>
                <Text style={styles.impactSubtitle}>Based on profile, activity & interviews</Text>
            </View>

            {/* Trust Tier Badge */}
            <View style={[styles.trustTierBlock, { backgroundColor: tier.bg }]}>
                <Text style={styles.trustTierEmoji}>{tier.emoji}</Text>
                <Text style={[styles.trustTierLabel, { color: tier.color }]}>{tier.label}</Text>
                <Text style={styles.trustTierDesc}>Trust Level</Text>
            </View>
        </View>
    );
};


export default function ProfilesScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { user, role: appRole } = useAppStore();
    const normalizedAppRole = String(appRole || '').toLowerCase();
    const role = normalizedAppRole === 'employer' || normalizedAppRole === 'recruiter' ? 'employer' : 'employee';
    const [profiles, setProfiles] = useState([]);
    const [pools, setPools] = useState([]);
    const [poolProfiles, setPoolProfiles] = useState([]);
    const [isModalVisible, setIsModalVisible] = useState(false);

    // Employer State
    const [selectedPool, setSelectedPool] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);

    // Employee State
    const [editingProfile, setEditingProfile] = useState(null);
    const [skillInput, setSkillInput] = useState('');

    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [profileSnapshot, setProfileSnapshot] = useState(null);
    const [activityCount, setActivityCount] = useState(0);

    const mapProfilesFromApi = useCallback((profile) => {
        if (!profile) return [];
        const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || user?.name || 'Profile';
        const roleProfiles = Array.isArray(profile.roleProfiles) ? profile.roleProfiles : [];
        if (roleProfiles.length === 0) {
            return [
                {
                    _id: profile._id || 'profile-default',
                    name: fullName,
                    roleTitle: 'Profile',
                    experienceYears: profile.totalExperience || 0,
                    summary: '',
                    skills: [],
                    location: profile.city || '',
                    qualifications: [],
                    avatar: profile.avatar || profile.logoUrl || null,
                    interviewVerified: Boolean(profile.interviewVerified),
                    isDefault: true,
                }
            ];
        }
        return roleProfiles.map((rp, index) => ({
            _id: `${profile._id || 'profile'}-${index}`,
            name: fullName,
            roleTitle: rp.roleName || 'Profile',
            experienceYears: rp.experienceInRole || 0,
            summary: rp.summary || '',
            skills: rp.skills || [],
            location: profile.city || '',
            qualifications: [],
            avatar: profile.avatar || profile.logoUrl || null,
            interviewVerified: Boolean(profile.interviewVerified),
            isDefault: index === 0,
        }));
    }, [user?.name]);

    const fetchProfileData = useCallback(async () => {
        setIsLoading(true);
        try {
            setErrorMsg('');
            const [profileResponse, applicationsResponse] = await Promise.all([
                withRequestTimeout(
                    client.get('/api/users/profile'),
                    'Profile request timed out',
                ),
                withRequestTimeout(
                    client.get('/api/applications'),
                    'Applications request timed out',
                ).catch(() => ({ data: [] })),
            ]);

            const validatedProfile = validateProfileResponse(profileResponse?.data);
            const mappedProfiles = mapProfilesFromApi(validatedProfile);
            const applicationPayload = applicationsResponse?.data;
            const applicationsList = Array.isArray(applicationPayload)
                ? applicationPayload
                : (Array.isArray(applicationPayload?.applications) ? applicationPayload.applications : []);

            setProfileSnapshot(validatedProfile);
            setActivityCount(applicationsList.length);
            setProfiles(mappedProfiles);
        } catch (e) {
            if (e?.name === 'ApiValidationError') {
                logValidationError(e, '/api/users/profile');
            }
            setErrorMsg('Unable to load profiles.');
        } finally {
            setIsLoading(false);
        }
    }, [mapProfilesFromApi]);

    const fetchPools = useCallback(async () => {
        setIsLoading(true);
        try {
            setErrorMsg('');
            const { data } = await withRequestTimeout(
                client.get('/api/jobs/my-jobs'),
                'Talent pools request timed out',
            );
            const jobs = Array.isArray(data) ? data : (data?.data || []);
            const mappedPools = jobs.map((job) => ({
                id: job._id,
                name: job.title || 'Job Pool',
                count: job.applicantCount || 0,
            }));
            setPools(mappedPools);
        } catch (e) {
            setErrorMsg('Unable to load profiles.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const fetchPoolCandidates = useCallback(async (jobId) => {
        setIsLoading(true);
        try {
            setErrorMsg('');
            const { data } = await withRequestTimeout(
                client.get(`/api/matches/employer/${jobId}`),
                'Candidates request timed out',
            );
            const matches = Array.isArray(data) ? data : (Array.isArray(data?.matches) ? data.matches : []);
            const mappedCandidates = matches.map((item, idx) => {
                const worker = item.worker || {};
                const firstRole = worker.roleProfiles && worker.roleProfiles[0] ? worker.roleProfiles[0] : {};
                return {
                    id: worker._id || `${jobId}-${idx}`,
                    roleTitle: firstRole.roleName || 'Candidate',
                    experienceYears: firstRole.experienceInRole || worker.totalExperience || 0,
                    location: worker.city || 'Remote',
                    summary: `Match score ${item.matchScore || 0}%`,
                    skills: firstRole.skills || [],
                };
            });
            setPoolProfiles(mappedCandidates);
            setSelectedCandidate(null);
        } catch (e) {
            setErrorMsg('Unable to load profiles.');
            setPoolProfiles([]);
        } finally {
            setIsLoading(false);
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
                fetchPools();
                if (selectedPool?.id) {
                    fetchPoolCandidates(selectedPool.id);
                }
            }
        }, [role, fetchProfileData, fetchPools, fetchPoolCandidates, selectedPool?.id])
    );

    const openEdit = (prof) => {
        setEditingProfile({ ...prof });
        setSkillInput('');
        setIsModalVisible(true);
    };

    const handleAddSkill = () => {
        const s = skillInput.trim();
        if (!s) return;
        setEditingProfile(prev => ({ ...prev, skills: [...(prev.skills || []), s] }));
        setSkillInput('');
    };

    const handleRemoveSkill = (idx) => {
        setEditingProfile(prev => ({ ...prev, skills: prev.skills.filter((_, i) => i !== idx) }));
    };

    const handleAvatarPress = useCallback(async () => {
        if (!editingProfile) return;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Alert.alert('Permission needed', 'Allow photo access to upload avatar');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.8,
        });

        if (result.canceled || !result.assets?.length) return;

        const asset = result.assets[0];
        const uri = asset.uri;
        if (!uri) return;

        setEditingProfile((prev) => (prev ? { ...prev, avatar: uri } : prev));
        setUploadingAvatar(true);

        try {
            const fileName = uri.split('/').pop() || `avatar-${Date.now()}.jpg`;
            const mimeType = asset.mimeType || 'image/jpeg';
            const formData = new FormData();
            formData.append('avatar', { uri, name: fileName, type: mimeType });

            const response = await client.post('/api/settings/avatar', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const nextAvatar = response?.data?.avatarUrl || uri;
            setEditingProfile((prev) => (prev ? { ...prev, avatar: nextAvatar } : prev));
            setProfiles((prev) => prev.map((profile) => (
                profile._id === editingProfile._id
                    ? { ...profile, avatar: nextAvatar }
                    : profile
            )));
        } catch (error) {
            Alert.alert('Upload failed', 'Please try again');
        } finally {
            setUploadingAvatar(false);
        }
    }, [editingProfile]);

    const handleSave = async () => {
        if (!editingProfile) return;

        if (!editingProfile.roleTitle?.trim()) {
            Alert.alert('Missing Field', 'Role Title is required.');
            return;
        }
        if (!editingProfile.summary?.trim()) {
            Alert.alert('Missing Field', 'Professional Summary is required.');
            return;
        }

        const updatedProfiles = profiles.map(p => p._id === editingProfile._id ? editingProfile : p);
        const nameParts = String(editingProfile.name || '').trim().split(' ').filter(Boolean);
        const firstName = nameParts[0] || 'User';
        const lastName = nameParts.slice(1).join(' ');

        try {
            await client.put('/api/users/profile', {
                firstName,
                lastName,
                city: editingProfile.location,
                totalExperience: editingProfile.experienceYears || 0,
                roleProfiles: updatedProfiles.map((profile) => ({
                    roleName: profile.roleTitle,
                    experienceInRole: profile.experienceYears || 0,
                    skills: profile.skills || [],
                    lastUpdated: new Date(),
                })),
            });
            await fetchProfileData();
        } catch (error) {
            Alert.alert('Save failed', error?.response?.data?.message || 'Unable to save profile right now.');
            return;
        }

        setProfiles(updatedProfiles);
        setEditingProfile(null);
        setIsModalVisible(false);
        Alert.alert('Saved', 'Profile updated successfully');
    };

    const goBackFromPool = () => setSelectedPool(null);
    const goBackFromCandidate = () => setSelectedCandidate(null);
    const handleOpenSmartInterview = useCallback(() => {
        navigation.navigate('SmartInterview');
    }, [navigation]);

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
                        <Text style={styles.headerTitleLight}>Candidate Profile</Text>
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
                            <Text style={styles.headerSubLight}>{selectedPool.count} CANDIDATES FOUND</Text>
                        </View>
                    </View>
                    {isLoading ? (
                        <View style={styles.pad16}>
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                            <SkeletonLoader height={82} style={{ borderRadius: 16, marginBottom: 16 }} />
                        </View>
                    ) : errorMsg ? (
                        <EmptyState
                            title="Could Not Load Candidates"
                            message={errorMsg}
                            icon={<IconUsers size={56} color="#94a3b8" />}
                            actionLabel="Retry"
                            onAction={() => selectedPool?.id && fetchPoolCandidates(selectedPool.id)}
                        />
                    ) : poolProfiles.length === 0 ? (
                        <EmptyState
                            title="No Candidates Yet"
                            message="Candidates will appear here when matching is available for this job."
                            icon={<IconUsers size={56} color="#94a3b8" />}
                        />
                    ) : (
                        <ScrollView style={styles.flex1} contentContainerStyle={styles.pad16}>
                            {poolProfiles && poolProfiles.map((prof, i) => (
                                <TouchableOpacity
                                    key={prof.id}
                                    style={styles.poolCandCard}
                                    activeOpacity={0.8}
                                    onPress={() => setSelectedCandidate(prof)}
                                >
                                    <Image source={{ uri: `https://ui-avatars.com/api/?name=Candidate+${i + 1}&background=7c3aed&color=fff` }} style={styles.poolCandImg} />
                                    <View style={styles.flex1}>
                                        <Text style={styles.poolCandTitle} numberOfLines={1}>{prof?.roleTitle || 'Candidate'} Expert</Text>
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
                    <Text style={styles.employerSub}>Organize and track your candidate pipelines</Text>
                </View>
                {isLoading ? (
                    <View style={styles.pad16}>
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                    </View>
                ) : errorMsg ? (
                    <EmptyState
                        title="Could Not Load Talent Pools"
                        message={errorMsg}
                        icon={<IconUsers size={56} color="#94a3b8" />}
                        actionLabel="Retry"
                        onAction={fetchPools}
                    />
                ) : pools.length === 0 ? (
                    <EmptyState
                        title="No Talent Pools Yet"
                        message="Create your first post to see matching talent."
                        icon={<IconBriefcase size={56} color="#94a3b8" />}
                    />
                ) : (
                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        {pools.map(pool => (
                            <View key={pool.id} style={styles.poolCardBox}>
                                <View style={styles.poolBoxTop}>
                                    <Text style={styles.poolBoxTitle}>{pool.name}</Text>
                                    <View style={styles.poolBoxBadge}>
                                        <Text style={styles.poolBoxBadgeText}>{pool.count} Candidates</Text>
                                    </View>
                                </View>
                                <TouchableOpacity
                                    style={styles.poolBoxBtn}
                                    activeOpacity={0.8}
                                    onPress={() => setSelectedPool(pool)}
                                >
                                    <Text style={styles.poolBoxBtnText}>View Candidates</Text>
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
    const defaultProfile = profiles[0];
    const completionSnapshot = useMemo(() => calcCompletion(defaultProfile || {}), [defaultProfile]);
    const authorityMetrics = useMemo(() => buildAuthorityMetrics({
        profile: defaultProfile || {},
        rawProfile: profileSnapshot || {},
        user: user || {},
        activityCount,
    }), [activityCount, defaultProfile, profileSnapshot, user]);
    const showProfileNudge = completionSnapshot.pct < 80;
    const showInterviewNudge = defaultProfile && !defaultProfile.interviewVerified;

    const renderEmployeeView = () => (
        <View style={styles.flex1}>
            <View style={[styles.employeeHeader, { paddingTop: insets.top + 16 }]}>
                <View style={styles.employeeHeaderTopRow}>
                    <Text style={styles.employeeTitle}>My Profiles</Text>
                    <TouchableOpacity style={styles.createNewBtn} onPress={handleOpenSmartInterview} activeOpacity={0.85}>
                        <IconVideo size={14} color="#fff" />
                        <Text style={styles.createNewBtnText}>Smart Interview</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.employeeSub}>Manage your diverse skillsets and job-specific profiles.</Text>
            </View>

            {isLoading ? (
                <View style={styles.scrollContent}>
                    <SkeletonLoader height={84} style={{ borderRadius: 12, marginBottom: 12 }} />
                    <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                    <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                </View>
            ) : errorMsg ? (
                <EmptyState
                    title="Could Not Load Profile"
                    message={errorMsg}
                    icon={<IconUsers size={64} color="#94a3b8" />}
                    actionLabel="Retry"
                    onAction={fetchProfileData}
                />
            ) : profiles.length === 0 ? (
                <EmptyState
                    title="No Profiles Yet"
                    message="Create your first work profile to start getting matched"
                    icon={<IconUsers size={64} color="#94a3b8" />}
                    actionLabel="Start Smart Interview"
                    onAction={handleOpenSmartInterview}
                />
            ) : (
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {/* Profile Completion Card */}
                    {defaultProfile && (
                        <CompletionCard
                            profile={defaultProfile}
                            onEditPress={() => openEdit(defaultProfile)}
                        />
                    )}

                    {defaultProfile ? <ProfileAuthorityCard metrics={authorityMetrics} /> : null}

                    {/* Impact Score + Trust Tier — Feature #78 */}
                    {defaultProfile && (
                        <ImpactScorePanel
                            impactScore={profileSnapshot?.impactScore || 0}
                            trustScore={profileSnapshot?.trustScore || 0}
                        />
                    )}

                    {showProfileNudge ? (
                        <View style={styles.nudgeCard}>
                            <Text style={styles.nudgeTitle}>Profile {completionSnapshot.pct}% complete</Text>
                            <Text style={styles.nudgeText}>Cross 80% to strengthen trust and improve visibility in match feeds.</Text>
                        </View>
                    ) : null}

                    {showInterviewNudge ? (
                        <TouchableOpacity style={styles.nudgeCardAction} activeOpacity={0.85} onPress={handleOpenSmartInterview}>
                            <Text style={styles.nudgeTitle}>Complete Smart Interview to unlock better matches</Text>
                            <Text style={styles.nudgeText}>A verified interview boosts your confidence badge and ranking quality.</Text>
                        </TouchableOpacity>
                    ) : null}

                    <View style={styles.responseLiftCard}>
                        <Text style={styles.responseLiftTitle}>Get 2x more responses</Text>
                        <Text style={styles.responseLiftText}>
                            Keep your headline, top 5 skills, and availability updated. Employers prioritize complete profiles first.
                        </Text>
                    </View>

                    {profiles.map((prof) => (
                        <View key={prof._id} style={[styles.empProfileCard, prof.isDefault && styles.empProfileCardDefault]}>
                            <View style={styles.empProfTopRow}>
                                <Text style={styles.empProfTitle}>{prof.roleTitle}</Text>
                                <View style={styles.empProfBadgeRow}>
                                    {prof.interviewVerified ? (
                                        <View style={styles.empProfVerifiedBadge}>
                                            <Text style={styles.empProfVerifiedText}>Verified Interview Profile</Text>
                                        </View>
                                    ) : null}
                                    {prof.isDefault && (
                                        <View style={styles.empProfDefaultBadge}>
                                            <Text style={styles.empProfDefaultText}>DEFAULT</Text>
                                        </View>
                                    )}
                                </View>
                            </View>
                            <Text style={styles.empProfSummary} numberOfLines={2}>
                                {String(prof.summary || '').trim() || 'No professional summary added yet.'}
                            </Text>

                            <View style={styles.empProfSkillsRow}>
                                {prof?.skills && prof.skills.slice(0, 4).map((s, idx) => (
                                    <View key={idx} style={styles.empProfSkillPill}>
                                        <Text style={styles.empProfSkillText}>{s}</Text>
                                    </View>
                                ))}
                            </View>

                            <View style={styles.empProfFooter}>
                                <View style={styles.empProfLocRow}>
                                    <IconMapPin size={12} color="#94a3b8" />
                                    <Text style={styles.empProfLocText}>{prof.experienceYears} Years Exp. • {prof.location}</Text>
                                </View>
                                <View style={styles.empProfActions}>
                                    <TouchableOpacity style={styles.empProfGhostBtn} onPress={() => handleReportProfile(prof._id)}>
                                        <Text style={styles.empProfGhostText}>REPORT</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.empProfEditBtn} onPress={() => openEdit(prof)}>
                                        <Text style={styles.empProfEditText}>EDIT</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ))}
                    <View style={{ height: 40 }} />
                </ScrollView>
            )}
        </View>
    );

    return (
        <View style={styles.container}>
            {role === 'employee' ? renderEmployeeView() : renderEmployerFlow()}

            {/* Edit Profile Modal */}
            <Modal visible={isModalVisible} animationType="slide" transparent onRequestClose={() => setIsModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalSheet}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Edit Profile</Text>
                            <TouchableOpacity onPress={() => setIsModalVisible(false)} style={styles.modalCloseBtn}>
                                <IconX size={20} color="#94a3b8" />
                            </TouchableOpacity>
                        </View>

                        {editingProfile && (
                            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScroll}>
                                {/* Avatar Section */}
                                <View style={styles.avatarSection}>
                                    <View>
                                        <Image
                                            source={{ uri: editingProfile.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(editingProfile.name || editingProfile.roleTitle)}&background=9333ea&color=fff&size=128` }}
                                            style={styles.avatarPreview}
                                        />
                                        {uploadingAvatar ? (
                                            <View style={styles.avatarUploadingOverlay}>
                                                <ActivityIndicator color="#ffffff" size="small" />
                                            </View>
                                        ) : null}
                                    </View>
                                    <TouchableOpacity
                                        style={styles.changePhotoBtn}
                                        onPress={handleAvatarPress}
                                    >
                                        <Text style={styles.changePhotoText}>Change Photo</Text>
                                    </TouchableOpacity>
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>FULL NAME</Text>
                                    <TextInput
                                        style={styles.inputField}
                                        value={editingProfile.name || ''}
                                        onChangeText={t => setEditingProfile({ ...editingProfile, name: t })}
                                        placeholder="Your full name"
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>PROFILE ROLE TITLE</Text>
                                    <TextInput
                                        style={styles.inputField}
                                        value={editingProfile.roleTitle}
                                        onChangeText={t => setEditingProfile({ ...editingProfile, roleTitle: t })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>

                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>PROFESSIONAL SUMMARY</Text>
                                    <TextInput
                                        style={[styles.inputField, styles.textArea]}
                                        value={editingProfile.summary}
                                        multiline
                                        onChangeText={t => setEditingProfile({ ...editingProfile, summary: t })}
                                        placeholderTextColor="#94a3b8"
                                    />
                                </View>

                                <View style={styles.rowInputs}>
                                    <View style={[styles.inputGroup, styles.flex1, { marginRight: 12 }]}>
                                        <Text style={styles.inputLabel}>YEARS EXPERIENCE</Text>
                                        <TextInput
                                            style={styles.inputField}
                                            value={String(editingProfile.experienceYears)}
                                            keyboardType="numeric"
                                            onChangeText={t => setEditingProfile({ ...editingProfile, experienceYears: parseInt(t) || 0 })}
                                            placeholderTextColor="#94a3b8"
                                        />
                                    </View>
                                    <View style={[styles.inputGroup, styles.flex1]}>
                                        <Text style={styles.inputLabel}>LOCATION</Text>
                                        <TextInput
                                            style={styles.inputField}
                                            value={editingProfile.location}
                                            onChangeText={t => setEditingProfile({ ...editingProfile, location: t })}
                                            placeholderTextColor="#94a3b8"
                                        />
                                    </View>
                                </View>

                                {/* Skills */}
                                <View style={styles.inputGroup}>
                                    <Text style={styles.inputLabel}>SKILLS</Text>
                                    <View style={styles.skillsRow}>
                                        {(editingProfile.skills || []).map((s, idx) => (
                                            <TouchableOpacity key={idx} style={styles.skillChip} onPress={() => handleRemoveSkill(idx)}>
                                                <Text style={styles.skillChipText}>{s}</Text>
                                                <Text style={styles.skillChipX}> ✕</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <View style={styles.skillInputRow}>
                                        <TextInput
                                            style={[styles.inputField, { flex: 1 }]}
                                            value={skillInput}
                                            onChangeText={setSkillInput}
                                            placeholder="Add a skill..."
                                            placeholderTextColor="#94a3b8"
                                            onSubmitEditing={handleAddSkill}
                                            returnKeyType="done"
                                        />
                                        <TouchableOpacity style={styles.addSkillBtn} onPress={handleAddSkill}>
                                            <Text style={styles.addSkillBtnText}>+</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <View style={styles.suggestedSkillsRow}>
                                        {SUGGESTED_SKILLS.map((skill) => (
                                            <TouchableOpacity
                                                key={skill}
                                                style={styles.suggestedSkillChip}
                                                onPress={() => {
                                                    setEditingProfile((prev) => {
                                                        const existing = Array.isArray(prev?.skills) ? prev.skills : [];
                                                        if (existing.includes(skill)) return prev;
                                                        return { ...prev, skills: [...existing, skill] };
                                                    });
                                                }}
                                            >
                                                <Text style={styles.suggestedSkillText}>{skill}</Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>

                                <View style={styles.modalActions}>
                                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsModalVisible(false)}>
                                        <Text style={styles.cancelBtnText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                                        <Text style={styles.saveBtnText}>Save Changes</Text>
                                    </TouchableOpacity>
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
    container: { flex: 1, backgroundColor: '#f8fafc' },
    containerLight: { flex: 1, backgroundColor: '#f8fafc' },
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

    scrollContent: { padding: 16 },
    poolCardBox: { backgroundColor: '#fff', padding: 20, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 16 },
    poolBoxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    poolBoxTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', flex: 1 },
    poolBoxBadge: { backgroundColor: '#f3e8ff', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff' },
    poolBoxBadgeText: { fontSize: 11, fontWeight: 'bold', color: '#6b21a8' },
    poolBoxBtn: { width: '100%', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e9d5ff', alignItems: 'center', backgroundColor: '#fff' },
    poolBoxBtnText: { fontSize: 14, fontWeight: 'bold', color: '#9333ea' },

    // Profile Completion Card
    completionCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#f3e8ff', shadowColor: '#9333ea', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
    completionTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    completionTitle: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
    completionPct: { fontSize: 18, fontWeight: '900' },
    progressTrack: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
    progressFill: { height: '100%', borderRadius: 3 },
    completionHint: { fontSize: 12, color: '#64748b', fontWeight: '500' },
    completionHintBold: { fontWeight: '900', color: '#9333ea' },
    nudgeCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#fde68a',
        backgroundColor: '#fffbeb',
        padding: 14,
        marginBottom: 12,
    },
    nudgeCardAction: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#bfdbfe',
        backgroundColor: '#eff6ff',
        padding: 14,
        marginBottom: 12,
    },
    nudgeTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 4,
    },
    nudgeText: {
        fontSize: 12,
        color: '#475569',
        lineHeight: 18,
    },
    responseLiftCard: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        padding: 14,
        marginBottom: 12,
    },
    responseLiftTitle: {
        fontSize: 13,
        fontWeight: '900',
        color: '#6d28d9',
        marginBottom: 4,
    },
    responseLiftText: {
        fontSize: 12,
        color: '#5b21b6',
        lineHeight: 18,
        fontWeight: '500',
    },

    // Employee Views
    employeeHeader: { backgroundColor: '#fff', paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', zIndex: 10 },
    employeeHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    employeeTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
    createNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7c3aed', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, shadowColor: '#ddd6fe', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
    createNewBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },
    employeeSub: { fontSize: 14, color: '#64748b' },

    empProfileCard: { backgroundColor: '#fff', padding: 20, borderRadius: 24, borderWidth: 2, borderColor: 'transparent', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1, marginBottom: 16 },
    empProfileCardDefault: { borderColor: '#7c3aed', shadowColor: '#7c3aed', shadowOpacity: 0.1, shadowRadius: 12, elevation: 4 },
    empProfTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    empProfTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', flex: 1 },
    empProfBadgeRow: { flexDirection: 'row', alignItems: 'center', marginLeft: 8, gap: 6 },
    empProfDefaultBadge: { backgroundColor: '#faf5ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#f3e8ff', marginLeft: 8 },
    empProfDefaultText: { fontSize: 10, fontWeight: '900', color: '#9333ea', letterSpacing: 1 },
    empProfVerifiedBadge: { backgroundColor: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.32)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
    empProfVerifiedText: { fontSize: 10, fontWeight: '800', color: '#065f46' },
    empProfSummary: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 16 },

    empProfSkillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    empProfSkillPill: { backgroundColor: '#f8fafc', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#f1f5f9' },
    empProfSkillText: { fontSize: 10, fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' },

    empProfFooter: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    empProfLocRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    empProfLocText: { fontSize: 11, fontWeight: '500', color: '#94a3b8' },
    empProfActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    empProfGhostBtn: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
    },
    empProfGhostText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
    empProfEditBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'transparent' },
    empProfEditText: { fontSize: 12, fontWeight: 'bold', color: '#9333ea' },

    // Edit Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, maxHeight: '92%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
    modalCloseBtn: { padding: 8 },
    modalScroll: { paddingBottom: 40 },

    // Avatar
    avatarSection: { alignItems: 'center', marginBottom: 20 },
    avatarPreview: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#f3e8ff', marginBottom: 10 },
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
    changePhotoBtn: { backgroundColor: '#faf5ff', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff' },
    changePhotoText: { color: '#9333ea', fontSize: 13, fontWeight: '700' },

    inputGroup: { marginBottom: 16 },
    inputLabel: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
    inputField: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '500', color: '#0f172a' },
    textArea: { height: 100, textAlignVertical: 'top' },
    rowInputs: { flexDirection: 'row', alignItems: 'center' },

    // Skills editor
    skillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
    skillChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3e8ff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff' },
    skillChipText: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
    skillChipX: { fontSize: 10, color: '#a855f7' },
    skillInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    suggestedSkillsRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestedSkillChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    suggestedSkillText: { fontSize: 11, color: '#475569', fontWeight: '700' },
    addSkillBtn: { backgroundColor: '#9333ea', width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    addSkillBtnText: { color: '#fff', fontSize: 22, fontWeight: '300' },

    modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    cancelBtn: { flex: 1, paddingVertical: 16, backgroundColor: '#f1f5f9', borderRadius: 12, alignItems: 'center' },
    cancelBtnText: { color: '#64748b', fontSize: 14, fontWeight: 'bold' },
    saveBtn: { flex: 2, paddingVertical: 16, backgroundColor: '#9333ea', borderRadius: 12, alignItems: 'center', shadowColor: '#e9d5ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
    saveBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
