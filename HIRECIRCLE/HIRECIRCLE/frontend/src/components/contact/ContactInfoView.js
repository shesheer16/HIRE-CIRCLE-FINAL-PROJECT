import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

const DEFAULT_BANNER = '';
const DEFAULT_PRODUCTS = [];
const DEFAULT_TIMELINE = [];

export default function ContactInfoView({
    mode = 'employer',
    presentation = 'modal',
    title = 'Profile',
    data = {},
    hideHeader = false,
    onBack,
    onCallPress,
    onVideoPress,
    onSitePress,
    primaryActionLabel,
    onPrimaryAction,
}) {
    const insets = useSafeAreaInsets();

    const {
        name = '',
        avatar,
        headline = '',
        industryTag = mode === 'employer' ? 'EMPLOYER PROFILE' : 'JOB SEEKER PROFILE',
        bannerImage = '',
        mission = '',
        industry = '',
        hq = '',
        products = DEFAULT_PRODUCTS,
        timeline = DEFAULT_TIMELINE,
        contactInfo = {
            partnership: '',
            support: '',
            website: '',
        },
        summary = '',
        experienceYears = null,
        skills = [],
        highlights = [],
        workHistory = [],
    } = data;

    const resolvedName = String(name || 'Profile');
    const resolvedBanner = String(bannerImage || DEFAULT_BANNER || '').trim()
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=7c3aed&color=fff&size=768`;

    return (
        <View style={styles.container}>
            {!hideHeader ? (
                <View style={[styles.header, { paddingTop: insets.top + (presentation === 'screen' ? 8 : 0) }]}>
                    <TouchableOpacity onPress={onBack} style={styles.backButton}>
                        <Text style={styles.backText}>✕</Text>
                    </TouchableOpacity>
                    <Text style={styles.title}>{title}</Text>
                    <View style={{ width: 40 }} />
                </View>
            ) : null}

            <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.scrollContent}>
                <View style={styles.bannerContainer}>
                    <Image source={{ uri: resolvedBanner }} style={styles.bannerImage} />
                    <View style={styles.bannerOverlay} />
                    <View style={styles.industryTagWrap}>
                        <Text style={styles.industryTagText}>{industryTag}</Text>
                    </View>
                </View>

                <View style={styles.profileSection}>
                    <Image
                        source={{ uri: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(resolvedName)}&background=7c3aed&color=fff` }}
                        style={styles.avatar}
                    />
                    <View style={styles.nameRow}>
                        <Text style={styles.name}>{resolvedName}</Text>
                        <View style={styles.verifiedBadge}>
                            <Text style={styles.verifiedIcon}>✓</Text>
                        </View>
                    </View>
                    <Text style={styles.headline}>{headline || 'No profile headline available.'}</Text>
                </View>

                <View style={styles.actionBtnRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={onCallPress}>
                        <View style={styles.actionIconWrap}>
                            <Ionicons name="call-outline" size={20} color="#7c3aed" />
                        </View>
                        <Text style={styles.actionBtnLabel}>CALL</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={onVideoPress}>
                        <View style={styles.actionIconWrap}>
                            <Ionicons name="videocam-outline" size={20} color="#7c3aed" />
                        </View>
                        <Text style={styles.actionBtnLabel}>VIDEO</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={onSitePress}>
                        <View style={styles.actionIconWrap}>
                            <Ionicons name="globe-outline" size={20} color="#7c3aed" />
                        </View>
                        <Text style={styles.actionBtnLabel}>SITE</Text>
                    </TouchableOpacity>
                </View>

                {mode === 'employer' ? (
                    <View style={styles.detailsSection}>
                        <View style={styles.card}>
                            <View style={styles.sectionHeaderRow}>
                                <Text style={styles.sectionIcon}>✨</Text>
                                <Text style={styles.sectionTitle}>MISSION & VISION</Text>
                            </View>
                            <Text style={styles.missionText}>{mission}</Text>
                            <View style={styles.statsGrid}>
                                <View style={styles.statBox}>
                                    <Text style={styles.statLabel}>INDUSTRY</Text>
                                    <Text style={styles.statValue}>{industry}</Text>
                                </View>
                                <View style={styles.statBox}>
                                    <Text style={styles.statLabel}>GLOBAL HQ</Text>
                                    <Text style={styles.statValue}>{hq}</Text>
                                </View>
                            </View>
                        </View>

                        {Array.isArray(highlights) && highlights.length ? (
                            <View style={styles.card}>
                                <View style={styles.sectionHeaderRow}>
                                    <Ionicons name="stats-chart-outline" size={18} color="#9333ea" style={{ marginRight: 6 }} />
                                    <Text style={styles.sectionTitle}>ROLE SNAPSHOT</Text>
                                </View>
                                {highlights.map((row, idx) => (
                                    <View key={`${row?.label || 'row'}-${idx}`} style={styles.snapshotRow}>
                                        <Text style={styles.snapshotLabel}>{row?.label || 'Metric'}</Text>
                                        <Text style={styles.snapshotValue}>{row?.value || 'N/A'}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}

                        <View style={styles.card}>
                            <View style={styles.sectionHeaderRow}>
                                <Ionicons name="briefcase-outline" size={18} color="#9333ea" style={{ marginRight: 6 }} />
                                <Text style={styles.sectionTitle}>PRODUCTS & SERVICES</Text>
                            </View>
                            {(products || []).length > 0 ? (
                                (products || []).map((product, index) => (
                                    <View key={`${product.name}-${index}`} style={styles.productRow}>
                                        <View style={styles.productIconBox}>
                                            <Text style={styles.productIconExt}>{product.icon || '📦'}</Text>
                                        </View>
                                        <View style={styles.productInfo}>
                                            <Text style={styles.productName}>{product.name}</Text>
                                            <Text style={styles.productDesc}>{product.desc}</Text>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.emptyDataText}>No product overview shared yet.</Text>
                            )}
                        </View>

                        <View style={styles.card}>
                            <View style={styles.sectionHeaderRow}>
                                <Ionicons name="globe-outline" size={18} color="#9333ea" style={{ marginRight: 6 }} />
                                <Text style={styles.sectionTitle}>TIMELINE</Text>
                            </View>
                            {(timeline || []).length > 0 ? (
                                (timeline || []).map((item) => (
                                    <View key={`${item.year}-${item.event}`} style={styles.timelineItem}>
                                        <View style={styles.timelineDot} />
                                        <View style={styles.timelineInfo}>
                                            <View style={styles.timelineYearBadge}>
                                                <Text style={styles.timelineYearText}>{item.year}</Text>
                                            </View>
                                            <Text style={styles.timelineEventText}>{item.event}</Text>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <Text style={styles.emptyDataText}>No company timeline shared yet.</Text>
                            )}
                        </View>

                        <View style={styles.darkContactCard}>
                            <Text style={styles.darkContactTitle}>CONTACT INFORMATION</Text>
                            <View style={styles.darkContactRow}>
                                <Text style={styles.darkContactLabel}>PARTNERSHIP</Text>
                                <Text style={styles.darkContactValue}>{contactInfo?.partnership || 'Not shared'}</Text>
                            </View>
                            <View style={styles.darkContactRow}>
                                <Text style={styles.darkContactLabel}>SUPPORT</Text>
                                <Text style={styles.darkContactValue}>{contactInfo?.support || 'Not shared'}</Text>
                            </View>
                            <View style={styles.darkContactRow}>
                                <Text style={styles.darkContactLabel}>OFFICIAL WEB</Text>
                                <Text style={styles.darkContactValue}>{contactInfo?.website || 'Not shared'}</Text>
                            </View>
                        </View>
                    </View>
                ) : (
                    <View style={styles.detailsSection}>
                        <View style={styles.card}>
                            <View style={styles.summaryHeader}>
                                <Text style={styles.summaryTitle}>⚡ Smart Summary</Text>
                                <View style={styles.resumeBtn}>
                                    <Text style={styles.resumeBtnText}>VIEW RESUME</Text>
                                </View>
                            </View>
                            <Text style={styles.summaryText}>{summary}</Text>
                        </View>
                        {Array.isArray(highlights) && highlights.length ? (
                            <View style={styles.card}>
                                <Text style={styles.sectionTitle}>PROFILE METRICS</Text>
                                {highlights.map((row, idx) => (
                                    <View key={`${row?.label || 'row'}-${idx}`} style={styles.snapshotRow}>
                                        <Text style={styles.snapshotLabel}>{row?.label || 'Metric'}</Text>
                                        <Text style={styles.snapshotValue}>{row?.value || 'N/A'}</Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        <View style={styles.card}>
                            <Text style={styles.sectionTitle}>EXPERIENCE & SKILLS</Text>
                            <View style={styles.expSkillRow}>
                                <View style={styles.expBox}>
                                    <Text style={styles.expValue}>{experienceYears}</Text>
                                    <Text style={styles.expLabel}>YEARS EXP</Text>
                                </View>
                                <View style={styles.skillWrap}>
                                    {(skills || []).map((skill) => (
                                        <View key={skill} style={styles.skillPill}>
                                            <Text style={styles.skillPillText}>{skill}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        </View>
                        {Array.isArray(workHistory) && workHistory.length ? (
                            <View style={styles.card}>
                                <Text style={styles.sectionTitle}>WORK HISTORY</Text>
                                {workHistory.map((row, idx) => (
                                    <View key={`${row?.roleName || 'work'}-${idx}`} style={styles.snapshotRow}>
                                        <Text style={styles.snapshotLabel}>{row?.roleName || 'Role'}</Text>
                                        <Text style={styles.snapshotValue}>
                                            {Number(row?.experienceInRole || 0)} yrs
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                    </View>
                )}

                {primaryActionLabel ? (
                    <TouchableOpacity style={styles.primaryActionButton} onPress={onPrimaryAction} activeOpacity={0.8}>
                        <Text style={styles.primaryActionText}>{primaryActionLabel}</Text>
                    </TouchableOpacity>
                ) : null}

                <View style={{ height: 24 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#7c3aed' },
    backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    backText: { color: '#fff', fontSize: 20, fontWeight: '700' },
    title: { color: '#fff', fontSize: 18, fontWeight: '700' },
    scrollContent: { paddingBottom: 16 },
    bannerContainer: { height: 180, position: 'relative' },
    bannerImage: { width: '100%', height: '100%' },
    bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
    industryTagWrap: { position: 'absolute', left: 16, bottom: 16 },
    industryTagText: { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 10, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
    profileSection: { alignItems: 'center', marginTop: -40, paddingHorizontal: 16 },
    avatar: { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#fff', marginBottom: 10 },
    nameRow: { flexDirection: 'row', alignItems: 'center' },
    name: { fontSize: 22, fontWeight: '900', color: '#0f172a' },
    verifiedBadge: { marginLeft: 8, width: 22, height: 22, borderRadius: 11, backgroundColor: '#eef2ff', alignItems: 'center', justifyContent: 'center' },
    verifiedIcon: { color: '#4f46e5', fontSize: 13, fontWeight: '900' },
    headline: { marginTop: 4, textAlign: 'center', color: '#64748b', fontWeight: '600', fontSize: 13 },
    actionBtnRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 16, marginBottom: 12 },
    actionBtn: { flex: 1, backgroundColor: '#fff', borderRadius: 24, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
    actionIconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#faf5ff', justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
    actionBtnLabel: { fontSize: 10, fontWeight: '900', color: '#475569', letterSpacing: 0.8 },
    detailsSection: { paddingHorizontal: 16, gap: 12 },
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    sectionIcon: { fontSize: 16, marginRight: 6 },
    sectionTitle: { fontSize: 13, fontWeight: '900', color: '#0f172a', letterSpacing: 0.8 },
    missionText: { fontSize: 13, lineHeight: 20, color: '#475569', fontWeight: '500', marginBottom: 12 },
    statsGrid: { flexDirection: 'row', gap: 10 },
    statBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', padding: 10 },
    statLabel: { fontSize: 9, fontWeight: '900', color: '#94a3b8', letterSpacing: 1, marginBottom: 4 },
    statValue: { fontSize: 12, fontWeight: '700', color: '#334155' },
    productRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8 },
    productIconBox: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#fff7ed', alignItems: 'center', justifyContent: 'center' },
    productIconExt: { fontSize: 20 },
    productInfo: { flex: 1 },
    productName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
    productDesc: { fontSize: 12, color: '#64748b', marginTop: 2 },
    emptyDataText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
    timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#7c3aed', marginTop: 10, marginRight: 8 },
    timelineInfo: { flex: 1 },
    timelineYearBadge: { alignSelf: 'flex-start', backgroundColor: '#ede9fe', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 4 },
    timelineYearText: { color: '#6d28d9', fontSize: 10, fontWeight: '900' },
    timelineEventText: { color: '#475569', fontSize: 12, lineHeight: 18, fontWeight: '500' },
    darkContactCard: { backgroundColor: '#0f172a', borderRadius: 20, padding: 16 },
    darkContactTitle: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
    darkContactRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
    darkContactLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    darkContactValue: { color: '#a78bfa', fontSize: 13, fontWeight: '900' },
    summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    summaryTitle: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
    resumeBtn: { backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
    resumeBtnText: { color: '#7c3aed', fontSize: 10, fontWeight: '900' },
    summaryText: { fontSize: 13, color: '#475569', lineHeight: 20, fontWeight: '500' },
    expSkillRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
    expBox: { width: 90, backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 12, alignItems: 'center', paddingVertical: 10, marginRight: 10 },
    expValue: { fontSize: 28, fontWeight: '900', color: '#7c3aed', lineHeight: 30 },
    expLabel: { fontSize: 9, color: '#7c3aed', fontWeight: '900', letterSpacing: 1 },
    skillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
    skillPill: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6 },
    skillPillText: { fontSize: 10, fontWeight: '900', color: '#475569', textTransform: 'uppercase' },
    snapshotRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#eef2ff',
    },
    snapshotLabel: {
        color: '#64748b',
        fontSize: 11,
        fontWeight: '700',
    },
    snapshotValue: {
        color: '#0f172a',
        fontSize: 12,
        fontWeight: '800',
        maxWidth: '55%',
        textAlign: 'right',
    },
    primaryActionButton: { marginHorizontal: 16, marginTop: 8, borderWidth: 1, borderColor: '#dc2626', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    primaryActionText: { color: '#dc2626', fontWeight: '900', fontSize: 13 },
});
