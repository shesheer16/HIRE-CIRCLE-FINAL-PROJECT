import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AnimatedCard } from './AnimatedCard';
import { getDisplayScorePercent, isMatchTier } from '../utils/matchUi';
import { RADIUS, SHADOWS, SPACING, theme } from '../theme/theme';

const JobCard = ({
    item,
    onPress,
    onShare,
    onToggleSave,
    isSaved,
    onReport,
    isHistory,
    isReported,
    showMatchInsights,
    onReasonPress,
}) => {
    const tier = String(item?.tier || '').toUpperCase();
    const scorePercent = getDisplayScorePercent(item);
    const hasMatchScore = Number.isFinite(scorePercent) && scorePercent > 0;
    const hasMatchSignals = showMatchInsights
        || typeof item?.matchScore === 'number'
        || typeof item?.matchProbability === 'number'
        || typeof item?.finalScore === 'number'
        || isMatchTier(tier);
    const shouldShowMatchBadge = hasMatchScore && hasMatchSignals;
    const trustLabel = item?.trustedCompany || item?.trustBadge || item?.verifiedCompany
        ? 'Verified Employer'
        : 'Verified Listing';
    const salaryLabel = String(item?.salaryRange || 'Salary not shared');
    const hiredCount = Math.max(0, Number(item?.hiredCount || 0));
    const hiringBadge = item?.urgentHiring ? 'Urgent Hiring' : (item?.activelyHiring ? 'Actively Hiring' : '');

    return (
        <AnimatedCard
            style={[
                styles.card,
                isHistory && styles.cardHistory,
                isReported && styles.cardReported,
            ]}
            onPress={() => onPress?.(item)}
            onLongPress={() => onReport?.(item)}
        >
            {shouldShowMatchBadge ? (
                <LinearGradient
                    colors={['#dbeafe', '#eef2ff']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.matchCornerBadge}
                >
                    <Text style={styles.matchCornerText}>{scorePercent}% Match</Text>
                </LinearGradient>
            ) : null}

            <View style={styles.topMetaRow}>
                <View style={styles.trustBadge}>
                    <Text style={styles.trustBadgeText}>{trustLabel}</Text>
                </View>
                <Text style={styles.postedTimeText}>{item?.postedTime || 'Just now'}</Text>
            </View>

            {isReported ? (
                <View style={styles.reportedBadge}>
                    <Text style={styles.reportedBadgeText}>Reported</Text>
                </View>
            ) : null}

            <View style={[styles.heroRow, shouldShowMatchBadge && styles.heroRowWithBadge]}>
                <View style={styles.heroLeft}>
                    <Text style={styles.jobTitle} numberOfLines={1}>{item?.title || 'Untitled Job'}</Text>
                    <Text style={styles.companyName} numberOfLines={1}>{item?.companyName || 'Unknown Company'}</Text>
                    <Text style={styles.locationText} numberOfLines={1}>
                        {item?.distanceLabel || item?.location || 'Location not shared'}
                    </Text>
                </View>

                <View style={styles.salaryWrap}>
                    <Text style={styles.salaryLabel}>Salary</Text>
                    <Text style={styles.salaryText} numberOfLines={1}>{salaryLabel}</Text>
                </View>
            </View>

            <View style={styles.socialProofRow}>
                <Text style={styles.socialProofText}>
                    Hired {hiredCount > 0 ? `${hiredCount}+` : 'new'} candidates
                </Text>
                <Text style={styles.socialProofDot}>•</Text>
                <Text style={styles.socialProofText}>{item?.responseTimeLabel || 'Responds fast'}</Text>
            </View>

            {hiringBadge ? (
                <View style={styles.hiringBadgeWrap}>
                    <View style={[styles.hiringBadge, item?.urgentHiring ? styles.hiringBadgeUrgent : styles.hiringBadgeActive]}>
                        <Text style={[styles.hiringBadgeText, item?.urgentHiring ? styles.hiringBadgeTextUrgent : styles.hiringBadgeTextActive]}>
                            {hiringBadge}
                        </Text>
                    </View>
                </View>
            ) : null}

            <View style={styles.tagsContainer}>
                {(item?.requirements || []).slice(0, 3).map((requirement, index) => (
                    <View key={`${item?._id || 'job'}-req-${index}`} style={styles.skillTag}>
                        <Text style={styles.skillTagText} numberOfLines={1}>{requirement}</Text>
                    </View>
                ))}
            </View>

            {shouldShowMatchBadge ? (
                <TouchableOpacity
                    style={styles.matchExplainRow}
                    activeOpacity={0.85}
                    onPress={() => onReasonPress?.(item, { id: 'match_explain', label: 'Skills, location and recency drive this score.' })}
                >
                    <Text style={styles.matchExplainLabel}>Why this match?</Text>
                    <Text style={styles.matchExplainValue}>{scorePercent}% fit</Text>
                </TouchableOpacity>
            ) : null}

            <View style={styles.cardFooter}>
                <TouchableOpacity style={styles.footerPill} onPress={() => onShare?.(item)} activeOpacity={0.82}>
                    <Text style={styles.footerPillText}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.footerPill, isSaved && styles.footerPillSaved]}
                    onPress={() => onToggleSave?.(item?._id)}
                    activeOpacity={0.82}
                >
                    <Text style={[styles.footerPillText, isSaved && styles.footerPillSavedText]}>
                        {isSaved ? 'Saved' : 'Save'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.quickApplyBtn} onPress={() => onPress?.(item)} activeOpacity={0.9}>
                    <Text style={styles.quickApplyBtnText}>Quick Apply</Text>
                </TouchableOpacity>
            </View>

            {isHistory ? (
                <TouchableOpacity style={styles.reApplyBtn} onPress={() => onPress?.(item)}>
                    <Text style={styles.reApplyBtnText}>Re-Apply</Text>
                </TouchableOpacity>
            ) : null}
        </AnimatedCard>
    );
};

export default memo(JobCard);

const styles = StyleSheet.create({
    card: {
        backgroundColor: 'rgba(255,255,255,0.985)',
        borderRadius: RADIUS.lg,
        padding: SPACING.md,
        marginBottom: SPACING.md,
        borderWidth: 1,
        borderColor: '#e6edf8',
        ...SHADOWS.md,
        position: 'relative',
        overflow: 'visible',
    },
    cardHistory: { opacity: 0.72 },
    cardReported: { opacity: 0.6 },
    matchCornerBadge: {
        position: 'absolute',
        top: -1,
        right: -1,
        borderTopRightRadius: RADIUS.lg,
        borderBottomLeftRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#d4ddff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        zIndex: 3,
        shadowColor: '#93c5fd',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 3,
    },
    matchCornerText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#1d4ed8',
    },
    topMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: SPACING.sm,
        paddingRight: 84,
    },
    trustBadge: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#dbe7ff',
        backgroundColor: '#f7faff',
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xxs + 1,
    },
    trustBadgeText: {
        fontSize: 11,
        fontWeight: '800',
        color: '#1f46cc',
        letterSpacing: 0.2,
    },
    postedTimeText: {
        fontSize: 11,
        color: '#94a3b8',
        fontWeight: '700',
    },
    reportedBadge: {
        position: 'absolute',
        top: 10,
        left: 0,
        backgroundColor: '#fde7e9',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomRightRadius: 8,
    },
    reportedBadgeText: { fontSize: 10, fontWeight: '600', color: '#b45359' },
    heroRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: SPACING.sm,
    },
    heroRowWithBadge: {
        paddingRight: 96,
    },
    heroLeft: {
        flex: 1,
    },
    jobTitle: {
        fontSize: 19,
        color: theme.textPrimary,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    companyName: {
        marginTop: 4,
        fontSize: 14,
        fontWeight: '700',
        color: '#1e293b',
    },
    locationText: {
        marginTop: 2,
        fontSize: 12,
        color: '#64748b',
        fontWeight: '600',
    },
    salaryWrap: {
        alignItems: 'flex-end',
        maxWidth: '46%',
    },
    salaryLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    salaryText: {
        marginTop: 3,
        fontSize: 21,
        fontWeight: '900',
        color: '#0f172a',
        textAlign: 'right',
    },
    socialProofRow: {
        marginTop: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    socialProofText: {
        color: '#334155',
        fontSize: 11,
        fontWeight: '700',
    },
    socialProofDot: {
        color: '#94a3b8',
        fontSize: 10,
        fontWeight: '700',
    },
    hiringBadgeWrap: {
        marginTop: SPACING.xs + 2,
        flexDirection: 'row',
    },
    hiringBadge: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        paddingHorizontal: 9,
        paddingVertical: 4,
    },
    hiringBadgeUrgent: {
        backgroundColor: '#fef3c7',
        borderColor: '#fcd34d',
    },
    hiringBadgeActive: {
        backgroundColor: '#dbeafe',
        borderColor: '#bfdbfe',
    },
    hiringBadgeText: {
        fontSize: 10,
        fontWeight: '900',
        letterSpacing: 0.2,
    },
    hiringBadgeTextUrgent: {
        color: '#92400e',
    },
    hiringBadgeTextActive: {
        color: '#1e3a8a',
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.xs + 2,
        marginTop: SPACING.sm,
        marginBottom: SPACING.xs,
    },
    skillTag: {
        backgroundColor: '#f8fbff',
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs + 1,
        borderRadius: RADIUS.sm,
        borderWidth: 1,
        borderColor: '#e5ecf8',
        maxWidth: '47%',
    },
    skillTagText: {
        fontSize: 12,
        color: '#475569',
        fontWeight: '700',
    },
    matchExplainRow: {
        marginTop: SPACING.xs + 1,
        marginBottom: SPACING.sm,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#f8fbff',
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    matchExplainLabel: {
        color: '#1e3a8a',
        fontSize: 12,
        fontWeight: '700',
    },
    matchExplainValue: {
        color: '#1d4ed8',
        fontSize: 12,
        fontWeight: '800',
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: SPACING.xs,
        marginTop: SPACING.xxs,
    },
    footerPill: {
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: '#dbe6f8',
        backgroundColor: '#f7fbff',
        paddingHorizontal: SPACING.sm + 2,
        paddingVertical: SPACING.xs + 1,
    },
    footerPillSaved: {
        backgroundColor: '#edf6ff',
        borderColor: '#b7d4ff',
    },
    footerPillText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#475569',
        letterSpacing: 0.15,
    },
    footerPillSavedText: {
        color: '#1d4ed8',
    },
    quickApplyBtn: {
        borderRadius: RADIUS.full,
        backgroundColor: '#1d4ed8',
        borderWidth: 1,
        borderColor: '#1d4ed8',
        paddingHorizontal: SPACING.smd,
        paddingVertical: SPACING.xs + 1,
    },
    quickApplyBtnText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.15,
    },
    reApplyBtn: {
        marginTop: SPACING.sm + 2,
        backgroundColor: '#e8f0ff',
        borderRadius: 999,
        paddingVertical: 9,
        paddingHorizontal: 16,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#bfd5ff',
    },
    reApplyBtnText: { fontSize: 12, fontWeight: '600', color: '#1d4ed8' },
});
