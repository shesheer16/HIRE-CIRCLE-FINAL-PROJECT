import React, { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedCard } from './AnimatedCard';
import { buildFreshnessSignals, getDisplayScorePercent, getMatchScoreSourceMeta } from '../utils/matchUi';
import { resolveStructuredLocation } from '../utils/locationPresentation';
import { RADIUS, SCREEN_CHROME, SHADOWS, SPACING, theme } from '../theme/theme';

const JOB_ACCENT_DARK = '#6d28d9';
const JOB_ACCENT_BORDER = '#ddd6fe';
const JOB_ACCENT_TEXT = '#6d28d9';

const JobCard = ({
    item,
    onPress,
    onReport,
    isReported,
    showMatchInsights = false,
    contextNote,
    contextTone = 'info',
}) => {
    const scorePercent = getDisplayScorePercent(item);
    const resolvedScorePercent = scorePercent > 0 ? scorePercent : 0;
    const shouldShowMatchBadge = Number.isFinite(resolvedScorePercent) && resolvedScorePercent > 0;
    const salaryLabel = String(item?.salaryRange || 'Salary not shared');
    const postedMeta = String(item?.postedTime || 'Just now');
    const postedLabel = postedMeta.toLowerCase().startsWith('posted') ? postedMeta : `Posted ${postedMeta}`;
    const structuredLocation = resolveStructuredLocation(item);
    const locationLabel = String(
        structuredLocation.locationLabel
        || item?.location
        || item?.distanceLabel
        || 'Location not shared'
    );
    const scoreSourceMeta = getMatchScoreSourceMeta(item);
    const freshnessSignals = buildFreshnessSignals(item);
    const footerSignals = freshnessSignals.length
        ? freshnessSignals.slice(0, 2)
        : [
            { id: 'response', label: String(item?.responseTimeLabel || 'Responds fast').trim() || 'Responds fast' },
            { id: 'activity', label: Number(item?.hiredCount || 0) > 0 ? `${Number(item?.hiredCount || 0)} hired` : 'New opening' },
        ];
    const skillTags = Array.isArray(item?.requirements)
        ? item.requirements
            .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry) => entry.trim())
            .slice(0, 3)
        : [];
    const contextIsWarning = contextTone === 'warning';

    return (
        <AnimatedCard
            style={[
                styles.card,
                isReported && styles.cardReported,
            ]}
            onPress={() => onPress?.(item)}
            onLongPress={() => onReport?.(item)}
        >
            {isReported ? (
                <View style={styles.reportedBadge}>
                    <Text style={styles.reportedBadgeText}>Reported</Text>
                </View>
            ) : null}

            <View style={styles.topRow}>
                <View style={styles.jobIdentityWrap}>
                    <View style={styles.jobGlyphWrap}>
                        <Ionicons name="briefcase-outline" size={18} color="#6d28d9" />
                    </View>
                    <View style={styles.contentWrap}>
                        <Text style={styles.jobTitle} numberOfLines={1}>{item?.title || 'Untitled Job'}</Text>
                        <Text style={styles.companyName} numberOfLines={1}>{item?.companyName || 'Unknown Company'}</Text>
                    </View>
                </View>
                {shouldShowMatchBadge ? (
                    <LinearGradient
                        colors={['#ede9fe', '#f5f3ff']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.matchCornerBadge}
                    >
                        <Text style={styles.matchCornerText}>{resolvedScorePercent}%</Text>
                    </LinearGradient>
                ) : null}
            </View>

            <View style={styles.metaRow}>
                <View style={styles.metaPill}>
                    <Ionicons name="location-outline" size={12} color="#64748b" />
                    <Text style={styles.metaPillText}>{locationLabel}</Text>
                </View>
                <View style={[styles.metaPill, styles.metaPillAccent]}>
                    <Ionicons name="wallet-outline" size={12} color="#6d28d9" />
                    <Text style={styles.metaPillText}>{salaryLabel}</Text>
                </View>
                <View style={styles.metaPillMuted}>
                    <Ionicons name="time-outline" size={12} color="#64748b" />
                    <Text style={styles.metaPillTextMuted}>{postedLabel}</Text>
                </View>
            </View>

            {skillTags.length ? (
                <View style={styles.skillsWrap}>
                    {skillTags.map((skill, index) => (
                        <View key={`${item?._id || item?.title || 'job'}-skill-${index}`} style={styles.skillChip}>
                            <Text style={styles.skillChipText} numberOfLines={1}>{skill}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {showMatchInsights && shouldShowMatchBadge ? (
                <View style={styles.scoreSourceChip}>
                    <Ionicons name="sparkles-outline" size={12} color="#6d28d9" />
                    <Text style={styles.scoreSourceChipText} numberOfLines={1}>{scoreSourceMeta.label}</Text>
                </View>
            ) : null}

            {contextNote ? (
                <View style={[styles.contextNoteWrap, contextIsWarning && styles.contextNoteWrapWarning]}>
                    <Text style={[styles.contextNoteText, contextIsWarning && styles.contextNoteTextWarning]} numberOfLines={2}>
                        {contextNote}
                    </Text>
                </View>
            ) : null}

            <View style={styles.bottomRow}>
                <View style={styles.footerSignalRow}>
                    {footerSignals.map((signal, index) => (
                        <View key={`${item?._id || item?.title || 'job'}-fresh-${signal.id}-${index}`} style={styles.hiredWrap}>
                            <Ionicons
                                name={index === 0 ? 'time-outline' : 'flash-outline'}
                                size={12}
                                color="#64748b"
                            />
                            <Text style={styles.hiredText} numberOfLines={1}>{signal.label}</Text>
                        </View>
                    ))}
                </View>
            </View>
        </AnimatedCard>
    );
};

export default memo(JobCard);

const styles = StyleSheet.create({
    card: {
        ...SCREEN_CHROME.contentCard,
        paddingHorizontal: 16,
        paddingVertical: 16,
        marginBottom: 12,
        position: 'relative',
        overflow: 'hidden',
    },
    cardReported: { opacity: 0.6 },
    topRow: {
        flexDirection: 'row',
        gap: 10,
        alignItems: 'flex-start',
        justifyContent: 'space-between',
    },
    jobIdentityWrap: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    jobGlyphWrap: {
        width: 42,
        height: 42,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5f3ff',
        borderWidth: 1,
        borderColor: '#e9ddff',
    },
    matchCornerBadge: {
        borderRadius: 14,
        borderWidth: 1,
        borderColor: JOB_ACCENT_BORDER,
        paddingHorizontal: 10,
        paddingVertical: 7,
        shadowColor: JOB_ACCENT_DARK,
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 3,
    },
    matchCornerText: {
        fontSize: 12,
        fontWeight: '800',
        color: JOB_ACCENT_TEXT,
        letterSpacing: 0.2,
    },
    reportedBadge: {
        position: 'absolute',
        top: 10,
        left: 0,
        backgroundColor: '#fde7e9',
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderBottomRightRadius: 8,
        zIndex: 2,
    },
    reportedBadgeText: { fontSize: 10, fontWeight: '600', color: '#b45359' },
    contentWrap: {
        flex: 1,
        minWidth: 0,
    },
    jobTitle: {
        fontSize: 18,
        color: theme.textPrimary,
        fontWeight: '800',
        letterSpacing: -0.3,
    },
    companyName: {
        marginTop: 4,
        fontSize: 12,
        fontWeight: '700',
        color: '#586983',
    },
    metaRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
    },
    metaPill: {
        ...SCREEN_CHROME.signalChip,
        gap: 6,
    },
    metaPillAccent: {
        backgroundColor: '#f5f3ff',
        borderColor: '#ddd6fe',
    },
    metaPillMuted: {
        ...SCREEN_CHROME.signalChip,
        borderColor: '#edf1f7',
        backgroundColor: '#fbfcfe',
        gap: 6,
    },
    metaPillText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#334155',
    },
    metaPillTextMuted: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
    },
    skillsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 12,
        marginBottom: 2,
    },
    skillChip: {
        ...SCREEN_CHROME.signalChip,
        ...SCREEN_CHROME.signalChipAccent,
        borderRadius: 12,
        marginRight: 7,
        marginBottom: 7,
    },
    skillChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#4c1d95',
    },
    contextNoteWrap: {
        marginTop: 6,
        backgroundColor: '#eef4ff',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    contextNoteWrapWarning: {
        backgroundColor: '#fff7ed',
    },
    scoreSourceChip: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    scoreSourceChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#5b21b6',
    },
    contextNoteText: {
        fontSize: 11.5,
        lineHeight: 17,
        fontWeight: '600',
        color: '#36507a',
    },
    contextNoteTextWarning: {
        color: '#9a3412',
    },
    bottomRow: {
        marginTop: 10,
    },
    footerSignalRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    hiredWrap: {
        ...SCREEN_CHROME.signalChip,
        gap: 6,
    },
    hiredText: {
        fontSize: 11.5,
        fontWeight: '700',
        color: '#64748b',
    },
});
