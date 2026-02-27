import React, { useState } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity,
    Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    IconMic, IconUsers, IconMapPin, IconBriefcase, IconCheck, IconVideo, IconGlobe, IconFile, IconX, IconMessageSquare, IconPlus
} from '../components/Icons';
import SkeletonLoader from '../components/SkeletonLoader';
import EmptyState from '../components/EmptyState';
import client from '../api/client';

// ─── MOCK DATA ───────────────────────────────────────────────────────────────
const MOCK_ROLE = 'employee'; // toggle to 'employer' to see employer view

const MOCK_PROFILES = [
    {
        _id: '1',
        roleTitle: 'Heavy Truck Driver',
        experienceYears: 8,
        summary: 'Experienced long-haul driver with a spotless record over 500,000 km. Specialized in hazardous materials and refrigerated transport across multi-state routes. Adept at vehicle maintenance and logbook management.',
        skills: ['HAZMAT', 'Refrigerated', 'Logbook Logging', 'Basic Mechanics'],
        location: 'Hyderabad, TS',
        isDefault: true,
    },
    {
        _id: '2',
        roleTitle: 'Forklift Operator',
        experienceYears: 3,
        summary: 'Certified forklift operator with experience in high-volume warehouse environments. Efficient in loading/unloading, inventory management, and strict adherence to safety protocols.',
        skills: ['OSHA Certified', 'Inventory Mapping', 'Pallet Jack', 'Safety Prot.'],
        location: 'Secunderabad, TS',
        isDefault: false,
    },
];

const MOCK_POOLS = [
    { id: '1', name: 'Logistics Drivers - Hyderabad', count: 142 },
    { id: '2', name: 'Warehouse Staff - Night Shift', count: 56 },
    { id: '3', name: 'Certified Electricians', count: 28 },
];

const MOCK_POOL_PROFILES = [
    { id: 'p1', roleTitle: 'Heavy Truck', experienceYears: 5, location: 'Hyderabad, TS', summary: 'Diligent driver for 5 years.' },
    { id: 'p2', roleTitle: 'Delivery Partner', experienceYears: 2, location: 'Secunderabad, TS', summary: 'Local delivery expert.' },
    { id: 'p3', roleTitle: 'Forklift Operator', experienceYears: 4, location: 'Remote', summary: 'Warehouse specialist.' },
];

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function ProfilesScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const [role] = useState(MOCK_ROLE);
    const [profiles, setProfiles] = useState(MOCK_PROFILES);
    const [isModalVisible, setIsModalVisible] = useState(false);

    // Employer State
    const [selectedPool, setSelectedPool] = useState(null);
    const [selectedCandidate, setSelectedCandidate] = useState(null);

    // Employee State
    const [editingProfile, setEditingProfile] = useState(null);

    const [isLoading, setIsLoading] = useState(true);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 800);
        return () => clearTimeout(timer);
    }, []);

    const openEdit = (prof) => {
        setEditingProfile({ ...prof });
        setIsModalVisible(true);
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

        try {
            await client.put('/api/users/profile', {
                name: editingProfile.name || '',
                roleTitle: editingProfile.roleTitle,
                location: editingProfile.location,
                summary: editingProfile.summary,
                skills: editingProfile.skills || []
                // avatar handle if it existed
            });
            Alert.alert('Saved', 'Profile updated successfully');
            setProfiles(prev => prev.map(p => p._id === editingProfile._id ? editingProfile : p));
            setEditingProfile(null);
            setIsModalVisible(false);
        } catch (error) {
            console.error('Save profile error:', error);
            Alert.alert('Error', 'Could not save profile. Please try again.');
        }
    };

    const calculateCompletion = (prof) => {
        const fields = [prof.name, prof.roleTitle, prof.location, prof.summary, prof.skills && prof.skills.length > 0, prof.avatar];
        const filled = fields.filter(Boolean).length;
        return Math.round((filled / fields.length) * 100);
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
                    ) : (
                        <ScrollView style={styles.flex1} contentContainerStyle={styles.pad16}>
                            {MOCK_POOL_PROFILES && MOCK_POOL_PROFILES.map((prof, i) => (
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
                    <Text style={styles.employerTitle}>Talent Pools</Text>
                    <Text style={styles.employerSub}>Organize and track your candidate pipelines</Text>
                </View>
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    {MOCK_POOLS.map(pool => (
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
            </View>
        );
    };

    // ── EMPLOYEE VIEW ──────────────────────────────────────────────────────
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
                    <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                    <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                    <SkeletonLoader height={160} style={{ borderRadius: 24, marginBottom: 16 }} />
                </View>
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

                            {/* Completion Bar */}
                            <View style={styles.completionContainer}>
                                <View style={styles.completionHeaderRow}>
                                    <Text style={styles.completionText}>Profile {calculateCompletion(prof)}% complete</Text>
                                </View>
                                <View style={styles.progressBarTrack}>
                                    <View style={[styles.progressBarFill, { width: `${calculateCompletion(prof)}%` }]} />
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
                                <View style={styles.modalAvatarContainer}>
                                    <Image
                                        source={{ uri: editingProfile.avatar || `https://ui-avatars.com/api/?name=${editingProfile.roleTitle || 'User'}&background=7c3aed&color=fff&size=200` }}
                                        style={styles.modalAvatar}
                                    />
                                    <TouchableOpacity style={styles.changePhotoBtn} onPress={() => Alert.alert('Coming Soon', 'Photo upload coming soon')}>
                                        <Text style={styles.changePhotoText}>Change Photo</Text>
                                    </TouchableOpacity>
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

    completionContainer: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
    completionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    completionText: { fontSize: 11, fontWeight: '700', color: '#64748b' },
    progressBarTrack: { height: 6, backgroundColor: '#f1f5f9', borderRadius: 3, overflow: 'hidden' },
    progressBarFill: { height: '100%', backgroundColor: '#9333ea', borderRadius: 3 },

    // Edit Modal
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
    modalCloseBtn: { padding: 8 },
    modalScroll: { paddingBottom: 40 },

    modalAvatarContainer: { alignItems: 'center', marginBottom: 24, marginTop: 8 },
    modalAvatar: { width: 80, height: 80, borderRadius: 40, marginBottom: 16, borderWidth: 2, borderColor: '#f1f5f9' },
    changePhotoBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#f3e8ff' },
    changePhotoText: { color: '#9333ea', fontSize: 12, fontWeight: 'bold' },

    inputGroup: { marginBottom: 16 },
    inputLabel: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
    inputField: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, fontWeight: '500', color: '#0f172a' },
    textArea: { height: 100, textAlignVertical: 'top' },
    rowInputs: { flexDirection: 'row', alignItems: 'center' },

    modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    cancelBtn: { flex: 1, paddingVertical: 16, backgroundColor: '#f1f5f9', borderRadius: 12, alignItems: 'center' },
    cancelBtnText: { color: '#64748b', fontSize: 14, fontWeight: 'bold' },
    saveBtn: { flex: 2, paddingVertical: 16, backgroundColor: '#9333ea', borderRadius: 12, alignItems: 'center', shadowColor: '#e9d5ff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
    saveBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
});
