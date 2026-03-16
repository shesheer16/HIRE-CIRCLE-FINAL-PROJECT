import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { RADIUS } from '../../../theme/theme';
import { connectPalette } from '../connectPalette';

const OPEN_STATUSES = new Set(['open', 'reviewing']);

function getStatusTheme(status, expiresInDays) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (normalizedStatus === 'completed') {
        return {
            badge: styles.statusCompleted,
            text: styles.statusCompletedText,
            label: 'COMPLETED',
        };
    }
    if (normalizedStatus === 'expired') {
        return {
            badge: styles.statusExpired,
            text: styles.statusExpiredText,
            label: 'EXPIRED',
        };
    }
    if (normalizedStatus === 'reviewing') {
        return {
            badge: styles.statusReviewing,
            text: styles.statusReviewingText,
            label: 'REVIEWING',
        };
    }
    if (Number(expiresInDays || 0) <= 2) {
        return {
            badge: styles.statusUrgent,
            text: styles.statusUrgentText,
            label: 'EXPIRES SOON',
        };
    }
    return {
        badge: styles.statusOpen,
        text: styles.statusOpenText,
        label: `OPEN · ${Math.max(0, Number(expiresInDays || 0))}d left`,
    };
}

function BountyCardComponent({
    bounty,
    isReferred,
    isEmployerRole,
    isPrimaryLoading,
    onReferPress,
    onPrimaryAction,
}) {
    const safeBounty = (bounty && typeof bounty === 'object') ? bounty : {};
    const statusTheme = useMemo(
        () => getStatusTheme(safeBounty.status, safeBounty.expiresInDays),
        [safeBounty.status, safeBounty.expiresInDays]
    );
    const status = String(safeBounty.status || 'open').toLowerCase();
    const acceptsEntries = OPEN_STATUSES.has(status);
    const isCreator = Boolean(safeBounty.isCreator);
    const hasSubmitted = Boolean(safeBounty.hasSubmitted);

    const primaryState = useMemo(() => {
        if (isEmployerRole) {
            if (!isCreator) {
                return { label: 'VIEW', disabled: true };
            }
            if (status === 'open') {
                return { label: 'LIVE', disabled: true };
            }
            if (status === 'reviewing') {
                return { label: 'REVIEWING', disabled: true };
            }
            if (status === 'completed') {
                return { label: 'COMPLETED', disabled: true };
            }
            return { label: 'CLOSED', disabled: true };
        }

        if (!acceptsEntries) {
            return { label: 'CLOSED', disabled: true };
        }
        if (hasSubmitted) {
            return { label: 'ENTRY SUBMITTED', disabled: true };
        }
        return { label: 'SUBMIT ENTRY', disabled: false };
    }, [acceptsEntries, hasSubmitted, isCreator, isEmployerRole, status]);

    const secondaryState = useMemo(() => {
        if (!acceptsEntries) {
            return { label: 'REFERRAL CLOSED', disabled: true };
        }
        if (isReferred) {
            return { label: 'REFERRED ✓', disabled: true };
        }
        return { label: 'REFER', disabled: false };
    }, [acceptsEntries, isReferred]);

    const primaryButtonStyle = useMemo(() => [
        styles.primaryButton,
        primaryState.disabled && styles.primaryButtonDisabled,
    ], [primaryState.disabled]);

    const secondaryButtonStyle = useMemo(() => [
        styles.secondaryButton,
        secondaryState.disabled && styles.secondaryButtonDisabled,
    ], [secondaryState.disabled]);

    const handlePrimaryPress = useCallback(() => {
        if (primaryState.disabled || typeof onPrimaryAction !== 'function') return;
        onPrimaryAction(safeBounty);
    }, [onPrimaryAction, primaryState.disabled, safeBounty]);

    const handleReferPress = useCallback(() => {
        if (secondaryState.disabled || typeof onReferPress !== 'function') return;
        onReferPress(safeBounty);
    }, [onReferPress, safeBounty, secondaryState.disabled]);

    return (
        <View style={styles.card}>
            <View style={styles.topRow}>
                <View style={styles.leftTopRow}>
                    <View style={[styles.logo, { backgroundColor: safeBounty.logoBg || connectPalette.accent }]}>
                        <Text style={styles.logoText}>{safeBounty.logoLetter || 'H'}</Text>
                    </View>
                    <View style={styles.companyWrap}>
                        <Text style={styles.companyText}>{safeBounty.company || 'HireCircle'}</Text>
                        <Text style={styles.categoryText}>{safeBounty.category || 'OPEN'}</Text>
                    </View>
                </View>
                <View style={[styles.statusBadge, statusTheme.badge]}>
                    <Text style={[styles.statusText, statusTheme.text]}>{statusTheme.label}</Text>
                </View>
            </View>

            <Text style={styles.roleText}>{safeBounty.role || 'Open Bounty'}</Text>
            {safeBounty.description ? (
                <Text style={styles.descriptionText}>{safeBounty.description}</Text>
            ) : null}

            <View style={styles.metaRow}>
                <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Reward</Text>
                    <Text style={styles.metaValue}>{safeBounty.bonus || '₹0'}</Text>
                </View>
                <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Submissions</Text>
                    <Text style={styles.metaValue}>{Number(safeBounty.referrals || 0)}</Text>
                </View>
                <View style={styles.metaCol}>
                    <Text style={styles.metaLabel}>Total Pot</Text>
                    <Text style={styles.metaValue}>{safeBounty.totalPot || '₹0'}</Text>
                </View>
            </View>

            <View style={styles.actionRow}>
                <TouchableOpacity
                    style={primaryButtonStyle}
                    onPress={handlePrimaryPress}
                    activeOpacity={0.85}
                    disabled={primaryState.disabled || isPrimaryLoading}
                >
                    {isPrimaryLoading ? (
                        <ActivityIndicator size="small" color={connectPalette.surface} />
                    ) : (
                        <Text style={styles.primaryButtonText}>{primaryState.label}</Text>
                    )}
                </TouchableOpacity>
                <TouchableOpacity
                    style={secondaryButtonStyle}
                    onPress={handleReferPress}
                    activeOpacity={0.85}
                    disabled={secondaryState.disabled}
                >
                    <Text style={styles.secondaryButtonText}>{secondaryState.label}</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

export default memo(BountyCardComponent);

const styles = StyleSheet.create({
    card: {
        backgroundColor: connectPalette.surface,
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#efe9f8',
        shadowColor: '#24113f',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.04,
        shadowRadius: 18,
        elevation: 2,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    leftTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    companyWrap: {
        marginLeft: 10,
        flex: 1,
    },
    logo: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logoText: {
        fontSize: 18,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    companyText: {
        fontSize: 13,
        fontWeight: '800',
        color: connectPalette.text,
    },
    categoryText: {
        marginTop: 2,
        fontSize: 10,
        fontWeight: '700',
        color: connectPalette.muted,
    },
    statusBadge: {
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    statusText: {
        fontSize: 10,
        fontWeight: '900',
    },
    statusUrgent: {
        backgroundColor: '#ffe4e6',
        borderWidth: 1,
        borderColor: '#fecdd3',
    },
    statusUrgentText: {
        color: '#b91c1c',
    },
    statusOpen: {
        backgroundColor: '#f7f3fc',
        borderWidth: 1,
        borderColor: '#ebe2f8',
    },
    statusOpenText: {
        color: '#6a41d8',
    },
    statusReviewing: {
        backgroundColor: '#eef6ff',
        borderWidth: 1,
        borderColor: '#dbeafe',
    },
    statusReviewingText: {
        color: '#2563eb',
    },
    statusCompleted: {
        backgroundColor: '#dcfce7',
    },
    statusCompletedText: {
        color: '#15803d',
    },
    statusExpired: {
        backgroundColor: '#fee2e2',
    },
    statusExpiredText: {
        color: '#b91c1c',
    },
    roleText: {
        fontSize: 15,
        fontWeight: '800',
        color: connectPalette.text,
        marginBottom: 6,
    },
    descriptionText: {
        fontSize: 12,
        lineHeight: 18,
        color: '#7c8398',
        marginBottom: 12,
    },
    metaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    metaCol: {
        flex: 1,
    },
    metaLabel: {
        fontSize: 10,
        color: '#8a91a3',
        fontWeight: '700',
        marginBottom: 2,
    },
    metaValue: {
        fontSize: 13,
        color: connectPalette.text,
        fontWeight: '800',
    },
    actionRow: {
        flexDirection: 'row',
    },
    primaryButton: {
        flex: 1,
        backgroundColor: '#6f4cf6',
        borderRadius: 14,
        paddingVertical: 11,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
        elevation: 2,
    },
    primaryButtonDisabled: {
        backgroundColor: '#e4ddf9',
        opacity: 0.8,
    },
    primaryButtonText: {
        color: connectPalette.surface,
        fontSize: 11,
        fontWeight: '800',
    },
    secondaryButton: {
        minWidth: 92,
        borderWidth: 1,
        borderColor: '#ebe2f8',
        borderRadius: 14,
        paddingHorizontal: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: connectPalette.surface,
    },
    secondaryButtonDisabled: {
        backgroundColor: '#f7f3fc',
        borderColor: '#ece4f8',
    },
    secondaryButtonText: {
        color: connectPalette.text,
        fontSize: 10,
        fontWeight: '800',
    },
});
