import React, { memo, useMemo } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSettings } from '../../components/Icons';
import { theme, RADIUS, SHADOWS } from '../../theme/theme';

const toDisplayNumber = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'N/A';
    if (numeric >= 1000) return `${(numeric / 1000).toFixed(1)}k`;
    return `${Math.round(numeric)}`;
};

const toDisplayPercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 'N/A';
    return `${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
};

const calculateProfileHealth = (user = {}, skills = []) => {
    const checkpoints = [
        Boolean(String(user?.name || '').trim()),
        Boolean(String(user?.city || user?.acquisitionCity || '').trim()),
        Boolean(String(user?.bio || user?.summary || '').trim()),
        skills.length > 0,
        Boolean(String(user?.availabilityStatus || '').trim() || user?.isAvailable),
    ];
    const completed = checkpoints.filter(Boolean).length;
    return Math.round((completed / checkpoints.length) * 100);
};

function MyProfileModalComponent({
    visible,
    insetsTop,
    userInfo,
    avatar,
    onClose,
    onEditProfile,
    onOpenSettings,
}) {
    const safeUserInfo = useMemo(
        () => ((userInfo && typeof userInfo === 'object') ? userInfo : {}),
        [userInfo]
    );
    const resolvedSkills = useMemo(() => {
        if (!Array.isArray(safeUserInfo?.roleProfiles)) return [];
        const merged = safeUserInfo.roleProfiles.flatMap((roleProfile) => (
            Array.isArray(roleProfile?.skills) ? roleProfile.skills : []
        ));
        return Array.from(new Set(merged.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 8);
    }, [safeUserInfo?.roleProfiles]);

    const roleLabel = safeUserInfo?.primaryRole === 'employer' ? 'Employer' : 'Job Seeker';
    const cityLabel = String(safeUserInfo?.city || safeUserInfo?.acquisitionCity || '').trim() || 'Location not set';
    const availabilityLabel = String(safeUserInfo?.availabilityStatus || '').trim()
        || (safeUserInfo?.isAvailable ? 'Available for opportunities' : 'Availability not set');
    const tierLabel = String(safeUserInfo?.tier || '').trim();
    const aboutText = String(safeUserInfo?.bio || safeUserInfo?.summary || '').trim() || 'No profile summary available yet.';
    const ratingValue = Number.isFinite(Number(safeUserInfo?.rating)) ? Number(safeUserInfo.rating).toFixed(1) : 'N/A';
    const displayName = String(safeUserInfo?.name || 'User').trim() || 'User';
    const profileHealth = useMemo(
        () => calculateProfileHealth(safeUserInfo, resolvedSkills),
        [safeUserInfo, resolvedSkills]
    );
    const safeAvatar = String(avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=8b3dff&color=fff&rounded=true`);

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.container, { paddingTop: insetsTop }]}>
                <LinearGradient
                    colors={['#4c1d95', '#7c3aed', '#6d28d9']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.headerGradient}
                >
                    <View style={styles.headerRow}>
                        <TouchableOpacity onPress={onClose} style={styles.headerButton} activeOpacity={0.8}>
                            <Text style={styles.headerBackIcon}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>My Profile</Text>
                        <TouchableOpacity
                            onPress={onOpenSettings || onEditProfile}
                            style={styles.headerButton}
                            activeOpacity={0.8}
                        >
                            <IconSettings size={18} color={theme.surface} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.heroCard}>
                        <View style={styles.heroTopRow}>
                            <Image source={{ uri: safeAvatar }} style={styles.avatar} />
                            <View style={styles.heroIdentity}>
                                <Text style={styles.nameText}>{displayName}</Text>
                                <Text style={styles.metaText}>{roleLabel}</Text>
                                <Text style={styles.locationText}>{cityLabel}</Text>
                            </View>
                            <View style={styles.ratingCard}>
                                <Text style={styles.ratingValue}>{ratingValue}</Text>
                                <Text style={styles.ratingLabel}>Rating</Text>
                            </View>
                        </View>

                        <View style={styles.heroBadgeRow}>
                            <View style={styles.coverBadgeGlass}>
                                <Text style={styles.coverBadgeText}>{availabilityLabel}</Text>
                            </View>
                            {tierLabel ? (
                                <View style={styles.coverBadgeAmber}>
                                    <Text style={styles.coverBadgeAmberText}>{tierLabel}</Text>
                                </View>
                            ) : null}
                        </View>

                        <View style={styles.profileHealthWrap}>
                            <View style={styles.profileHealthTrack}>
                                <View style={[styles.profileHealthFill, { width: `${profileHealth}%` }]} />
                            </View>
                            <Text style={styles.profileHealthText}>Profile Health {profileHealth}%</Text>
                        </View>
                    </View>
                </LinearGradient>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                    <View style={styles.body}>
                        <View style={styles.statsRow}>
                            <View style={styles.statCard}>
                                <Text style={styles.statValue}>{toDisplayNumber(safeUserInfo?.karmaScore)}</Text>
                                <Text style={styles.statLabel}>KARMA</Text>
                            </View>
                            <View style={styles.statCard}>
                                <Text style={styles.statValue}>{toDisplayNumber(safeUserInfo?.jobsCompleted)}</Text>
                                <Text style={styles.statLabel}>JOBS</Text>
                            </View>
                            <View style={styles.statCard}>
                                <Text style={styles.statValue}>{toDisplayPercent(safeUserInfo?.responseRate)}</Text>
                                <Text style={styles.statLabel}>RESPONSE</Text>
                            </View>
                        </View>

                        <View style={styles.contentCard}>
                            <Text style={styles.sectionTitle}>About</Text>
                            <Text style={styles.sectionText}>{aboutText}</Text>
                        </View>

                        <View style={styles.contentCard}>
                            <Text style={styles.sectionTitle}>Verified Skills</Text>
                            {resolvedSkills.length > 0 ? (
                                <View style={styles.skillsRow}>
                                    {resolvedSkills.map((skill) => (
                                        <View key={skill} style={styles.skillChip}>
                                            <Text style={styles.skillText}>{skill}</Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <Text style={styles.sectionText}>No verified skills available yet.</Text>
                            )}
                        </View>

                        <View style={styles.actionsRow}>
                            <TouchableOpacity style={styles.secondaryButton} onPress={onOpenSettings || onEditProfile} activeOpacity={0.86}>
                                <Text style={styles.secondaryButtonText}>Settings</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.editButton} onPress={onEditProfile} activeOpacity={0.86}>
                                <Text style={styles.editButtonText}>Edit Profile</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

export default memo(MyProfileModalComponent);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    headerGradient: {
        paddingBottom: 14,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    headerButton: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerBackIcon: {
        color: theme.surface,
        fontSize: 32,
        lineHeight: 32,
        fontWeight: '300',
    },
    headerTitle: {
        color: theme.surface,
        fontSize: 17,
        fontWeight: '800',
    },
    heroCard: {
        marginTop: 10,
        marginHorizontal: 14,
        borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.24)',
        padding: 14,
    },
    heroTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    heroIdentity: {
        flex: 1,
    },
    heroBadgeRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 12,
    },
    coverBadgeGlass: {
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderRadius: RADIUS.full,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.28)',
        flex: 1,
    },
    coverBadgeText: {
        color: '#ffffff',
        fontSize: 10,
        fontWeight: '800',
    },
    coverBadgeAmber: {
        backgroundColor: '#fde68a',
        borderRadius: RADIUS.full,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    coverBadgeAmberText: {
        color: '#7c2d12',
        fontSize: 10,
        fontWeight: '800',
    },
    profileHealthWrap: {
        marginTop: 12,
    },
    profileHealthTrack: {
        height: 8,
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.25)',
        overflow: 'hidden',
    },
    profileHealthFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#a7f3d0',
    },
    profileHealthText: {
        marginTop: 5,
        color: '#ede9fe',
        fontSize: 11,
        fontWeight: '700',
    },
    scrollContent: {
        paddingBottom: 24,
    },
    body: {
        marginTop: 12,
        paddingHorizontal: 16,
        paddingBottom: 14,
    },
    avatar: {
        width: 74,
        height: 74,
        borderRadius: RADIUS.full,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.5)',
        backgroundColor: '#ddd6fe',
    },
    ratingCard: {
        minWidth: 72,
        borderRadius: 12,
        backgroundColor: 'rgba(15,23,42,0.3)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        paddingVertical: 8,
        paddingHorizontal: 10,
        alignItems: 'center',
    },
    ratingValue: {
        fontSize: 18,
        fontWeight: '900',
        color: '#ffffff',
    },
    ratingLabel: {
        fontSize: 10,
        fontWeight: '800',
        color: '#ddd6fe',
        textTransform: 'uppercase',
    },
    nameText: {
        fontSize: 18,
        fontWeight: '900',
        color: '#ffffff',
    },
    metaText: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: '700',
        color: '#ede9fe',
    },
    locationText: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '600',
        color: '#d8b4fe',
    },
    statsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    statCard: {
        flex: 1,
        borderRadius: 14,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingVertical: 12,
        alignItems: 'center',
        ...SHADOWS.sm,
    },
    statValue: {
        fontSize: 18,
        fontWeight: '900',
        color: '#1e293b',
    },
    statLabel: {
        marginTop: 3,
        fontSize: 10,
        fontWeight: '700',
        color: '#94a3b8',
        letterSpacing: 1,
    },
    contentCard: {
        marginTop: 14,
        borderRadius: 16,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '900',
        color: '#0f172a',
        marginBottom: 8,
    },
    sectionText: {
        fontSize: 13,
        color: '#475569',
        lineHeight: 20,
        fontWeight: '500',
    },
    skillsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    skillChip: {
        borderRadius: RADIUS.full,
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    skillText: {
        color: '#5b21b6',
        fontSize: 12,
        fontWeight: '700',
    },
    actionsRow: {
        marginTop: 16,
        flexDirection: 'row',
        gap: 10,
    },
    secondaryButton: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        paddingVertical: 13,
        alignItems: 'center',
    },
    secondaryButtonText: {
        color: '#5b21b6',
        fontSize: 14,
        fontWeight: '800',
    },
    editButton: {
        flex: 1.4,
        borderRadius: 14,
        backgroundColor: '#7c3aed',
        paddingVertical: 13,
        alignItems: 'center',
    },
    editButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },
});
