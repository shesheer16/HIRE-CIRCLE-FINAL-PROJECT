import React, { memo } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconSettings } from '../../components/Icons';
import { theme, RADIUS } from '../../theme/theme';

const PROFILE_SKILLS = ['Logistics', 'Operations', 'React', 'Node'];

function MyProfileModalComponent({ visible, insetsTop, userInfo, avatar, onClose, onEditProfile }) {
    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.container, { paddingTop: insetsTop }]}> 
                <View style={styles.headerBackground}>
                    <View style={styles.headerRow}>
                        <TouchableOpacity onPress={onClose} style={styles.headerButton}>
                            <Text style={styles.headerBackIcon}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>My Profile</Text>
                        <View style={styles.headerButton}>
                            <IconSettings size={18} color={theme.surface} />
                        </View>
                    </View>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={styles.coverWrap}>
                        <LinearGradient
                            colors={['rgba(124,58,237,0.6)', 'rgba(15,23,42,0.9)']}
                            start={{ x: 1, y: 0 }}
                            end={{ x: 0, y: 1 }}
                            style={StyleSheet.absoluteFillObject}
                        />
                        <Image
                            source={{ uri: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?q=80&w=1200&auto=format&fit=crop' }}
                            style={styles.coverImage}
                        />
                        <View style={styles.coverBadgeRow}>
                            <View style={styles.coverBadgeGlass}>
                                <Text style={styles.coverBadgeText}>Ready to Work</Text>
                            </View>
                            <View style={styles.coverBadgeAmber}>
                                <Text style={styles.coverBadgeAmberText}>⭐ Gold Tier</Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.body}>
                        <View style={styles.topRow}>
                            <Image source={{ uri: avatar }} style={styles.avatar} />
                            <View style={styles.ratingCard}>
                                <Text style={styles.ratingValue}>4.8</Text>
                                <Text style={styles.ratingLabel}>RATING</Text>
                            </View>
                        </View>

                        <Text style={styles.nameText}>{userInfo?.name || 'Lokesh'}</Text>
                        <Text style={styles.metaText}>{userInfo?.primaryRole === 'employer' ? 'Hiring Actively' : 'Professional Member'} • Hyderabad</Text>

                        <View style={styles.statsRow}>
                            <View style={styles.statCard}><Text style={styles.statValue}>1.2k</Text><Text style={styles.statLabel}>KARMA</Text></View>
                            <View style={styles.statCard}><Text style={styles.statValue}>24</Text><Text style={styles.statLabel}>JOBS</Text></View>
                            <View style={styles.statCard}><Text style={styles.statValue}>98%</Text><Text style={styles.statLabel}>RESPONSE</Text></View>
                        </View>

                        <View style={styles.contentCard}>
                            <Text style={styles.sectionTitle}>About Me</Text>
                            <Text style={styles.sectionText}>Dedicated professional focused on high-trust work opportunities and fast response times.</Text>
                        </View>

                        <View style={styles.contentCard}>
                            <Text style={styles.sectionTitle}>Skills</Text>
                            <View style={styles.skillsRow}>
                                {PROFILE_SKILLS.map((skill) => (
                                    <View key={skill} style={styles.skillChip}>
                                        <Text style={styles.skillText}>{skill}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                        <TouchableOpacity style={styles.editButton} onPress={onEditProfile}>
                            <Text style={styles.editButtonText}>Edit Profile Details</Text>
                        </TouchableOpacity>
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
    headerBackground: {
        backgroundColor: theme.primary,
        paddingBottom: 14,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 16,
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
        fontSize: 16,
        fontWeight: '900',
        color: theme.surface,
    },
    coverWrap: {
        height: 176,
        backgroundColor: theme.darkCard,
        overflow: 'hidden',
        position: 'relative',
    },
    coverImage: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.35,
    },
    coverBadgeRow: {
        position: 'absolute',
        top: 14,
        left: 16,
        right: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    coverBadgeGlass: {
        backgroundColor: 'rgba(255,255,255,0.22)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    coverBadgeText: {
        color: theme.surface,
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.7,
    },
    coverBadgeAmber: {
        backgroundColor: '#fcd34d',
        borderRadius: RADIUS.full,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    coverBadgeAmberText: {
        color: '#78350f',
        fontSize: 10,
        fontWeight: '900',
        textTransform: 'uppercase',
        letterSpacing: 0.7,
    },
    body: {
        paddingHorizontal: 16,
        paddingBottom: 24,
    },
    topRow: {
        marginTop: -48,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
    },
    avatar: {
        width: 96,
        height: 96,
        borderRadius: RADIUS.xl,
        borderWidth: 4,
        borderColor: theme.surface,
        backgroundColor: theme.surface,
    },
    ratingCard: {
        backgroundColor: theme.surface,
        borderRadius: RADIUS.lg,
        paddingHorizontal: 14,
        paddingVertical: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: theme.borderMedium,
    },
    ratingValue: {
        fontSize: 32,
        fontWeight: '900',
        color: theme.textPrimary,
        lineHeight: 34,
    },
    ratingLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: theme.textMuted,
        letterSpacing: 1,
    },
    nameText: {
        fontSize: 26,
        fontWeight: '900',
        color: theme.textPrimary,
        marginTop: 12,
    },
    metaText: {
        fontSize: 12,
        color: theme.textSecondary,
        fontWeight: '700',
        marginTop: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 10,
        marginVertical: 16,
    },
    statCard: {
        flex: 1,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.borderMedium,
        borderRadius: RADIUS.lg,
        paddingVertical: 14,
        alignItems: 'center',
        shadowColor: theme.textPrimary,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    statValue: {
        fontSize: 20,
        fontWeight: '900',
        color: theme.textPrimary,
    },
    statLabel: {
        fontSize: 9,
        fontWeight: '900',
        color: theme.textMuted,
        marginTop: 2,
        letterSpacing: 1,
    },
    contentCard: {
        backgroundColor: theme.surface,
        borderRadius: 32,
        borderWidth: 1,
        borderColor: theme.borderMedium,
        padding: 20,
        marginBottom: 12,
        shadowColor: theme.textPrimary,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '900',
        color: theme.textPrimary,
        letterSpacing: 1,
        marginBottom: 10,
        textTransform: 'uppercase',
    },
    sectionText: {
        fontSize: 14,
        color: theme.textSecondary,
        lineHeight: 20,
        fontWeight: '500',
    },
    skillsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    skillChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: RADIUS.sm,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderMedium,
    },
    skillText: {
        fontSize: 11,
        fontWeight: '800',
        color: theme.textSecondary,
        textTransform: 'uppercase',
    },
    editButton: {
        backgroundColor: theme.darkCard,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 15,
        marginTop: 10,
    },
    editButtonText: {
        color: theme.surface,
        fontSize: 14,
        fontWeight: '900',
    },
});
