import React, { memo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AnimatedCard } from './AnimatedCard';
import { getDisplayScorePercent } from '../utils/matchUi';
import { resolveStructuredLocation } from '../utils/locationPresentation';
import { PALETTE } from '../theme/theme';

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
    const structuredLocation = resolveStructuredLocation(item);
    const locationLabel = String(
        structuredLocation.locationLabel
        || item?.location
        || item?.distanceLabel
        || 'Location not shared'
    );
    const companyLogo = String(
        item?.companyLogoUrl || item?.logoUrl || ''
    ).trim();
    const contextIsWarning = contextTone === 'warning';

    return (
        <AnimatedCard
            style={[styles.card, isReported && styles.cardReported]}
            onPress={() => onPress?.(item)}
            onLongPress={() => onReport?.(item)}
        >
            {isReported ? (
                <View style={styles.reportedOverlay}>
                    <Text style={styles.reportedText}>Reported</Text>
                </View>
            ) : null}

            {/* Left accent bar */}
            <View style={styles.accentBar} />

            {/* Company Logo + Job Info */}
            <View style={styles.row}>
                {companyLogo ? (
                    <Image source={{ uri: companyLogo }} style={styles.logo} />
                ) : (
                    <View style={[styles.logo, styles.logoPlaceholder]}>
                        <Ionicons name="business-outline" size={20} color={PALETTE.accent} />
                    </View>
                )}

                <View style={styles.info}>
                    <View style={styles.titleRow}>
                        <Text style={styles.title} numberOfLines={2}>{item?.title || 'Untitled Job'}</Text>
                        {shouldShowMatchBadge ? (
                            <View style={styles.matchBadge}>
                                <Text style={styles.matchBadgeText}>{resolvedScorePercent}%</Text>
                            </View>
                        ) : null}
                    </View>
                    <Text style={styles.company} numberOfLines={1}>{item?.companyName || 'Company'}</Text>

                    {/* Meta row */}
                    <View style={styles.metaRow}>
                        <View style={styles.metaItem}>
                            <Ionicons name="location-outline" size={12} color={PALETTE.textTertiary} />
                            <Text style={styles.metaText} numberOfLines={1}>{locationLabel}</Text>
                        </View>
                        <Text style={styles.metaDot}>·</Text>
                        <View style={styles.metaItem}>
                            <Ionicons name="cash-outline" size={12} color={PALETTE.textTertiary} />
                            <Text style={styles.metaText} numberOfLines={1}>{salaryLabel}</Text>
                        </View>
                    </View>

                    {/* Bottom row */}
                    <View style={styles.bottomRow}>
                        <Text style={styles.posted}>{postedMeta}</Text>
                        <View style={styles.tagsWrap}>
                            {item?.urgentHiring ? (
                                <View style={styles.urgentTag}>
                                    <Ionicons name="flash" size={10} color="#ef4444" />
                                    <Text style={styles.urgentTagText}>Urgent</Text>
                                </View>
                            ) : null}
                            {item?.type ? (
                                <View style={styles.typeTag}>
                                    <Text style={styles.typeTagText}>{item.type}</Text>
                                </View>
                            ) : null}
                        </View>
                    </View>
                </View>
            </View>

            {contextNote ? (
                <View style={[styles.contextWrap, contextIsWarning && styles.contextWrapWarning]}>
                    <Text style={[styles.contextText, contextIsWarning && styles.contextTextWarning]} numberOfLines={2}>
                        {contextNote}
                    </Text>
                </View>
            ) : null}
        </AnimatedCard>
    );
};

export default memo(JobCard);

const styles = StyleSheet.create({
    card: {
        backgroundColor: PALETTE.surface,
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: 16,
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.separator,
    },
    cardReported: { opacity: 0.35 },

    accentBar: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: PALETTE.accent,
        borderTopLeftRadius: 16,
        borderBottomLeftRadius: 16,
    },

    reportedOverlay: {
        position: 'absolute',
        top: 12,
        right: 12,
        backgroundColor: PALETTE.errorSoft,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        zIndex: 2,
    },
    reportedText: { fontSize: 10, fontWeight: '600', color: PALETTE.error },

    row: {
        flexDirection: 'row',
        gap: 14,
    },
    logo: {
        width: 50,
        height: 50,
        borderRadius: 14,
        backgroundColor: PALETTE.backgroundSoft,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: PALETTE.separator,
    },
    logoPlaceholder: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: PALETTE.accentSoft,
        borderColor: PALETTE.accentSoft,
    },

    info: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 8,
    },
    title: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: PALETTE.textPrimary,
        lineHeight: 20,
    },
    matchBadge: {
        backgroundColor: PALETTE.accentSoft,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
        flexShrink: 0,
    },
    matchBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: PALETTE.accent,
    },
    company: {
        fontSize: 13,
        fontWeight: '500',
        color: PALETTE.textSecondary,
        marginTop: 2,
    },

    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 8,
        flexWrap: 'wrap',
    },
    metaItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    metaText: {
        fontSize: 12,
        fontWeight: '400',
        color: PALETTE.textTertiary,
    },
    metaDot: {
        fontSize: 10,
        color: PALETTE.textTertiary,
        marginHorizontal: 2,
    },

    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 10,
    },
    posted: {
        fontSize: 11,
        fontWeight: '400',
        color: PALETTE.textTertiary,
    },
    tagsWrap: {
        flexDirection: 'row',
        gap: 6,
    },
    urgentTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        backgroundColor: '#fef2f2',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    urgentTagText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#ef4444',
    },
    typeTag: {
        backgroundColor: PALETTE.backgroundSoft,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    typeTagText: {
        fontSize: 11,
        fontWeight: '500',
        color: PALETTE.textSecondary,
    },

    contextWrap: {
        marginTop: 12,
        backgroundColor: PALETTE.backgroundSoft,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    contextWrapWarning: {
        backgroundColor: 'rgba(245,158,11,0.08)',
    },
    contextText: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: '400',
        color: PALETTE.textSecondary,
    },
    contextTextWarning: {
        color: '#d97706',
    },
});
