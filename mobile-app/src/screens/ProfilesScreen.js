import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image, Animated
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    IconMic, IconUsers, IconMapPin, IconBriefcase, IconCheck, IconVideo, IconGlobe, IconFile, IconX, IconMessageSquare, IconPlus
} from '../components/Icons';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { getPrimaryRoleFromUser } from '../utils/roleMode';
import { useFocusEffect } from '@react-navigation/native';

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

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function ProfilesScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { userInfo } = useContext(AuthContext);
    const role = getPrimaryRoleFromUser(userInfo) === 'employer' ? 'employer' : 'employee';
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

    const mapProfilesFromApi = useCallback((profile) => {
        if (!profile) return [];
        const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || userInfo?.name || 'Profile';
        const roleProfiles = Array.isArray(profile.roleProfiles) ? profile.roleProfiles : [];
        if (roleProfiles.length === 0) {
            return [
                {
                    _id: profile._id || 'profile-default',
                    name: fullName,
                    roleTitle: 'General Profile',
                    experienceYears: profile.totalExperience || 0,
                    summary: 'Add your role summary to improve profile matching.',
                    skills: [],
                    location: profile.city || 'Remote',
                    qualifications: [],
                    avatar: null,
                    isDefault: true,
                }
            ];
        }
        return roleProfiles.map((rp, index) => ({
            _id: `${profile._id || 'profile'}-${index}`,
            name: fullName,
            roleTitle: rp.roleName || 'Role Profile',
            experienceYears: rp.experienceInRole || 0,
            summary: 'AI-ready profile extracted from your role data.',
            skills: rp.skills || [],
            location: profile.city || 'Remote',
            qualifications: [],
            avatar: null,
            isDefault: index === 0,
        }));
    }, [userInfo?.name]);

    const fetchProfileData = useCallback(async () => {
        try {
            setErrorMsg('');
            const { data } = await client.get('/api/users/profile');
            const mappedProfiles = mapProfilesFromApi(data?.profile);
            setProfiles(mappedProfiles);
        } catch (e) {
            setErrorMsg('Could not load profile');
        }
    }, [mapProfilesFromApi]);

    const fetchPools = useCallback(async () => {
        try {
            setErrorMsg('');
            const { data } = await client.get('/api/jobs/my-jobs');
            const jobs = Array.isArray(data) ? data : (data?.data || []);
            const mappedPools = jobs.map((job) => ({
                id: job._id,
                name: job.title || 'Job Pool',
                count: job.applicantCount || 0,
            }));
            setPools(mappedPools);
        } catch (e) {
            setErrorMsg('Could not load people nearby');
        }
    }, []);

    const fetchPoolCandidates = useCallback(async (jobId) => {
        try {
            setErrorMsg('');
            const { data } = await client.get(`/api/matches/employer/${jobId}`);
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
                };
            });
            setPoolProfiles(mappedCandidates);
            setSelectedCandidate(null);
        } catch (e) {
            setErrorMsg('Could not load candidates');
            setPoolProfiles([]);
        }
    }, []);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            if (role === 'employee') {
                await fetchProfileData();
            } else {
                await fetchPools();
            }
            setIsLoading(false);
        };
        loadData();
    }, [role, fetchProfileData, fetchPools]);

    useEffect(() => {
        const loadCandidates = async () => {
            if (!selectedPool?.id || role !== 'employer') return;
            setIsLoading(true);
            await fetchPoolCandidates(selectedPool.id);
            setIsLoading(false);
        };
        loadCandidates();
    }, [selectedPool, role, fetchPoolCandidates]);

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

        // If avatarUri exists and it's a local file uri, upload it (placeholder — expo-image-picker not installed)
        // TODO: wire up avatar upload when expo-image-picker is available

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
        } catch (e) {
            // Non-blocking — save locally anyway
            logger.error('API save error', e);
        }

        setProfiles(updatedProfiles);
        setEditingProfile(null);
        setIsModalVisible(false);
        Alert.alert('Saved', 'Profile updated successfully');
    };

    const goBackFromPool = () => setSelectedPool(null);
    const goBackFromCandidate = () => setSelectedCandidate(null);

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
                        </View>

                        <View style={styles.candyWrapper}>
                            <View style={styles.candyCard}>
                                <View style={styles.candyCardTop}>
                                    <Text style={styles.candyCardTitle}>Professional Summary</Text>
                                    <TouchableOpacity style={styles.candyResumeBtn}>
                                        <Text style={styles.candyResumeText}>VIEW RESUME</Text>
                                    </TouchableOpacity>
                                </View>
                                <Text style={styles.candySummaryText}>{selectedCandidate.summary}</Text>
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
                    <Text style={styles.employerTitle}>People Nearby</Text>
                    <Text style={styles.employerSub}>Organize and track your candidate pipelines</Text>
                </View>
                {isLoading ? (
                    <View style={styles.pad16}>
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                        <SkeletonLoader height={120} style={{ borderRadius: 16, marginBottom: 16 }} />
                    </View>
                ) : errorMsg ? (
                    <EmptyState
                        title="Could Not Load People Nearby"
                        message={errorMsg}
                        icon={<IconUsers size={56} color="#94a3b8" />}
                        actionLabel="Retry"
                        onAction={fetchPools}
                    />
                ) : pools.length === 0 ? (
                    <EmptyState
                        title="No People Nearby Yet"
                        message="Create your first post to see matching people nearby."
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

    const renderEmployeeView = () => (
        <View style={styles.flex1}>
            <View style={[styles.employeeHeader, { paddingTop: insets.top + 16 }]}>
                <View style={styles.employeeHeaderTopRow}>
                    <Text style={styles.employeeTitle}>My Profiles</Text>
                    <TouchableOpacity style={styles.createNewBtn} onPress={() => { /* trig interview */ }}>
                        <IconMic size={14} color="#fff" />
                        <Text style={styles.createNewBtnText}>Create New</Text>
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
                    actionLabel="Create Profile"
                    onAction={() => { /* trig interview */ }}
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

                    {profiles.map((prof) => (
                        <View key={prof._id} style={[styles.empProfileCard, prof.isDefault && styles.empProfileCardDefault]}>
                            <View style={styles.empProfTopRow}>
                                <Text style={styles.empProfTitle}>{prof.roleTitle}</Text>
                                {prof.isDefault && (
                                    <View style={styles.empProfDefaultBadge}>
                                        <Text style={styles.empProfDefaultText}>DEFAULT</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.empProfSummary} numberOfLines={2}>{prof.summary}</Text>

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
                                <TouchableOpacity style={styles.empProfEditBtn} onPress={() => openEdit(prof)}>
                                    <Text style={styles.empProfEditText}>EDIT</Text>
                                </TouchableOpacity>
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
                                    <Image
                                        source={{ uri: editingProfile.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(editingProfile.name || editingProfile.roleTitle)}&background=9333ea&color=fff&size=128` }}
                                        style={styles.avatarPreview}
                                    />
                                    <TouchableOpacity
                                        style={styles.changePhotoBtn}
                                        onPress={() => Alert.alert('Photo Upload', 'Photo upload coming soon (expo-image-picker not installed)')}
                                    >
                                        <Text style={styles.changePhotoText}>Change Photo</Text>
                                        {/* TODO: wire up when expo-image-picker available */}
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

    employerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
    employerSub: { fontSize: 14, color: '#e9d5ff' },

    candidateHero: { alignItems: 'center', paddingTop: 32, paddingBottom: 24, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
    candidateHeroImage: { width: 96, height: 96, borderRadius: 48, marginBottom: 12, borderWidth: 4, borderColor: '#faf5ff' },
    candidateHeroTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
    candidateHeroLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    candidateHeroLocation: { fontSize: 14, color: '#64748b', fontWeight: '500' },

    candyWrapper: { padding: 16 },
    candyCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
    candyCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    candyCardTitle: { fontWeight: 'bold', color: '#0f172a', fontSize: 16 },
    candyResumeBtn: { backgroundColor: '#faf5ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#f3e8ff' },
    candyResumeText: { fontSize: 10, fontWeight: 'bold', color: '#9333ea', letterSpacing: 0.5 },
    candySummaryText: { fontSize: 14, color: '#475569', lineHeight: 22 },

    poolCandCard: { backgroundColor: '#fff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1, flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    poolCandImg: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: '#f1f5f9', marginRight: 16 },
    poolCandTitle: { fontWeight: 'bold', color: '#0f172a', fontSize: 16, marginBottom: 4 },
    poolCandMeta: { fontSize: 12, color: '#64748b', fontWeight: '500' },

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

    // Employee Views
    employeeHeader: { backgroundColor: '#fff', paddingHorizontal: 24, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', zIndex: 10 },
    employeeHeaderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
    employeeTitle: { fontSize: 24, fontWeight: 'bold', color: '#0f172a' },
    createNewBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#9333ea', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 30, shadowColor: '#e9d5ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
    createNewBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
    employeeSub: { fontSize: 14, color: '#64748b' },

    empProfileCard: { backgroundColor: '#fff', padding: 20, borderRadius: 24, borderWidth: 2, borderColor: 'transparent', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1, marginBottom: 16 },
    empProfileCardDefault: { borderColor: '#a855f7', shadowColor: '#a855f7', shadowOpacity: 0.1, shadowRadius: 12, elevation: 4 },
    empProfTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    empProfTitle: { fontSize: 18, fontWeight: 'bold', color: '#1e293b', flex: 1 },
    empProfDefaultBadge: { backgroundColor: '#faf5ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#f3e8ff', marginLeft: 8 },
    empProfDefaultText: { fontSize: 10, fontWeight: '900', color: '#9333ea', letterSpacing: 1 },
    empProfSummary: { fontSize: 14, color: '#475569', lineHeight: 20, marginBottom: 16 },

    empProfSkillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    empProfSkillPill: { backgroundColor: '#f8fafc', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#f1f5f9' },
    empProfSkillText: { fontSize: 10, fontWeight: 'bold', color: '#475569', textTransform: 'uppercase' },

    empProfFooter: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    empProfLocRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    empProfLocText: { fontSize: 11, fontWeight: '500', color: '#94a3b8' },
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
    addSkillBtn: { backgroundColor: '#9333ea', width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    addSkillBtnText: { color: '#fff', fontSize: 22, fontWeight: '300' },

    modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    cancelBtn: { flex: 1, paddingVertical: 16, backgroundColor: '#f1f5f9', borderRadius: 12, alignItems: 'center' },
    cancelBtnText: { color: '#64748b', fontSize: 14, fontWeight: 'bold' },
    saveBtn: { flex: 2, paddingVertical: 16, backgroundColor: '#9333ea', borderRadius: 12, alignItems: 'center', shadowColor: '#e9d5ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
    saveBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
