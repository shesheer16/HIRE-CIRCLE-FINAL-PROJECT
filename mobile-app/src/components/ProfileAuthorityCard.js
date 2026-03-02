import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const VerificationPill = ({ label, active }) => (
    <View style={[styles.verificationPill, active ? styles.verificationPillActive : styles.verificationPillMuted]}>
        <Text style={[styles.verificationPillText, active ? styles.verificationPillTextActive : styles.verificationPillTextMuted]}>
            {label}
        </Text>
    </View>
);

const StatChip = ({ label, value, accent }) => (
    <View style={styles.statChip}>
        <Text style={styles.statChipLabel}>{label}</Text>
        <Text style={[styles.statChipValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
);

const ScoreBar = ({ label, value, fillColor = '#1d4ed8' }) => (
    <View style={styles.scoreRow}>
        <View style={styles.scoreHeaderRow}>
            <Text style={styles.scoreLabel}>{label}</Text>
            <Text style={styles.scoreValue}>{Math.round(value)}%</Text>
        </View>
        <View style={styles.scoreTrack}>
            <View style={[styles.scoreFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: fillColor }]} />
        </View>
    </View>
);

export default function ProfileAuthorityCard({ metrics }) {
    if (!metrics) return null;

    const {
        profileScore,
        trustScore,
        completionRate,
        completionWeight,
        interviewConfidence,
        activityWeight,
        activityScore,
        endorsements,
        verifiedHires,
        authorityRank,
        communityInfluence,
        hireSuccessScore,
        responseScore,
        interviewBadge,
        verificationState,
        skillStrengths,
        trustExplanation,
        badges,
    } = metrics;

    return (
        <View style={styles.card}>
            <View style={styles.topRow}>
                <View>
                    <Text style={styles.title}>Authority Layer</Text>
                    <Text style={styles.subtitle}>Deterministic trust, reputation, and network capital</Text>
                </View>
                <View style={styles.scoreBadge}>
                    <Text style={styles.scoreBadgeLabel}>TRUST SCORE</Text>
                    <Text style={styles.scoreBadgeValue}>{Math.round(trustScore)}</Text>
                </View>
            </View>

            <View style={styles.statsRow}>
                <StatChip label="Completion" value={`${Math.round(completionRate || 0)}%`} accent="#0f9d67" />
                <StatChip label="Endorsements" value={`${endorsements || 0}`} accent="#1d4ed8" />
                <StatChip label="Verified Hires" value={`${verifiedHires || 0}`} accent="#7c3aed" />
            </View>

            <View style={styles.statsRow}>
                <StatChip
                    label="Authority Rank"
                    value={authorityRank?.rank ? `#${authorityRank.rank}` : 'N/A'}
                    accent="#0f172a"
                />
                <StatChip label="Community" value={`${Math.round(communityInfluence || 0)}%`} accent="#0f9d67" />
                <StatChip label="Response" value={`${Math.round(responseScore || 0)}%`} accent="#1d4ed8" />
            </View>

            <Text style={styles.formulaText}>
                Trust = weighted reliability model. Profile score ({profileScore}) and hire success ({Math.round(hireSuccessScore || 0)}%) contribute, then penalties are applied.
            </Text>

            {trustExplanation?.title ? (
                <View style={styles.explainCard}>
                    <Text style={styles.explainTitle}>{trustExplanation.title}</Text>
                    {Array.isArray(trustExplanation?.topFactors)
                        ? trustExplanation.topFactors.slice(0, 3).map((factor) => (
                            <Text key={factor} style={styles.explainItem}>• {factor}</Text>
                        ))
                        : null}
                </View>
            ) : null}

            <View style={styles.verificationRow}>
                <VerificationPill label="Email Verified" active={verificationState?.emailVerified} />
                <VerificationPill label="Phone Verified" active={verificationState?.phoneVerified} />
                <VerificationPill label="Interview Verified" active={verificationState?.interviewVerified} />
                <VerificationPill label="Identity Verified" active={verificationState?.identityVerified} />
            </View>

            {Array.isArray(badges) && badges.length ? (
                <View style={styles.badgesWrap}>
                    {badges.slice(0, 4).map((badge) => (
                        <View key={`${badge.badgeKey}-${badge.awardedAt || ''}`} style={styles.badgePill}>
                            <Text style={styles.badgeText}>{badge.badgeName || badge.badgeKey}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {Array.isArray(skillStrengths) && skillStrengths.length ? (
                <View style={styles.skillBlock}>
                    <Text style={styles.skillBlockTitle}>Skill Strength</Text>
                    {skillStrengths.map((skill) => (
                        <ScoreBar
                            key={skill.label}
                            label={skill.label}
                            value={skill.value}
                            fillColor={skill.value >= 80 ? '#0f9d67' : (skill.value >= 60 ? '#1d4ed8' : '#f59e0b')}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#dbe7ff',
        backgroundColor: '#f8fbff',
        padding: 16,
        marginBottom: 14,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 10,
    },
    title: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0f172a',
    },
    subtitle: {
        marginTop: 3,
        fontSize: 12,
        color: '#64748b',
        fontWeight: '500',
    },
    scoreBadge: {
        minWidth: 88,
        borderRadius: 12,
        backgroundColor: '#e0edff',
        paddingHorizontal: 10,
        paddingVertical: 8,
        alignItems: 'flex-end',
    },
    scoreBadgeLabel: {
        fontSize: 9,
        fontWeight: '700',
        color: '#1d4ed8',
        letterSpacing: 0.4,
    },
    scoreBadgeValue: {
        marginTop: 2,
        fontSize: 20,
        fontWeight: '900',
        color: '#1d4ed8',
    },
    statsRow: {
        marginTop: 12,
        flexDirection: 'row',
        gap: 8,
    },
    statChip: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    statChipLabel: {
        fontSize: 10,
        fontWeight: '700',
        letterSpacing: 0.3,
        color: '#64748b',
        textTransform: 'uppercase',
    },
    statChipValue: {
        marginTop: 4,
        fontSize: 13,
        fontWeight: '800',
        color: '#0f172a',
    },
    formulaText: {
        marginTop: 12,
        fontSize: 12,
        color: '#475569',
        lineHeight: 18,
    },
    explainCard: {
        marginTop: 10,
        borderRadius: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 10,
    },
    explainTitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 4,
    },
    explainItem: {
        fontSize: 11,
        color: '#475569',
        lineHeight: 16,
    },
    verificationRow: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgesWrap: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    badgePill: {
        borderRadius: 999,
        backgroundColor: '#eef4ff',
        borderWidth: 1,
        borderColor: '#bfdbfe',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    badgeText: {
        fontSize: 11,
        color: '#1e3a8a',
        fontWeight: '700',
    },
    verificationPill: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderWidth: 1,
    },
    verificationPillActive: {
        backgroundColor: '#e7f9ef',
        borderColor: '#95e0b3',
    },
    verificationPillMuted: {
        backgroundColor: '#f8fafc',
        borderColor: '#e2e8f0',
    },
    verificationPillText: {
        fontSize: 11,
        fontWeight: '700',
    },
    verificationPillTextActive: {
        color: '#0f9d67',
    },
    verificationPillTextMuted: {
        color: '#64748b',
    },
    skillBlock: {
        marginTop: 14,
    },
    skillBlockTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 10,
    },
    scoreRow: {
        marginBottom: 10,
    },
    scoreHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 5,
    },
    scoreLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#334155',
    },
    scoreValue: {
        fontSize: 12,
        fontWeight: '700',
        color: '#0f172a',
    },
    scoreTrack: {
        height: 8,
        borderRadius: 8,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
    },
    scoreFill: {
        height: '100%',
        borderRadius: 8,
    },
});
