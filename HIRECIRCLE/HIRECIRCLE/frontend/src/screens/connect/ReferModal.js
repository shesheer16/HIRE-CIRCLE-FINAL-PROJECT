import React, { memo } from 'react';
import { Modal, TouchableOpacity, View, Text, TextInput, StyleSheet } from 'react-native';
import { IconX } from '../../components/Icons';
import { theme, RADIUS } from '../../theme/theme';

function ReferModalComponent({
    visible,
    referringBounty,
    referPhoneInput,
    referPhoneError,
    isSending,
    onClose,
    onPhoneChange,
    onSendReferral,
}) {
    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.sheet}>
                    <View style={styles.headerRow}>
                        <View>
                            <Text style={styles.headerLabel}>Referral for</Text>
                            <Text style={styles.headerTitle}>{referringBounty?.company}</Text>
                        </View>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <IconX size={20} color={theme.textSecondary} />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.earningsBox}>
                        <View>
                            <Text style={styles.earningsLabel}>YOU EARN</Text>
                            <Text style={styles.earningsAmount}>{referringBounty?.bonus}</Text>
                        </View>
                        <Text style={styles.earningsSubtext}>Paid after 30-day{'\n'}successful onboarding</Text>
                    </View>

                    <Text style={styles.inputLabel}>FRIEND'S PHONE NUMBER</Text>
                    <View style={styles.inputRow}>
                        <View style={styles.phonePrefix}><Text style={styles.phonePrefixText}>+91</Text></View>
                        <TextInput
                            style={styles.phoneInput}
                            value={referPhoneInput}
                            onChangeText={onPhoneChange}
                            placeholder="98765 43210"
                            placeholderTextColor={theme.textMuted}
                            keyboardType="phone-pad"
                            maxLength={10}
                        />
                    </View>

                    {referPhoneError ? <Text style={styles.errorText}>{referPhoneError}</Text> : null}

                    <TouchableOpacity
                        style={[styles.submitButton, isSending && styles.submitButtonDisabled]}
                        onPress={onSendReferral}
                        disabled={isSending}
                    >
                        <Text style={styles.submitButtonText}>{isSending ? 'SENDING...' : 'SEND REFERRAL'}</Text>
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

export default memo(ReferModalComponent);

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.35)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: theme.surface,
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        padding: 24,
        paddingBottom: 36,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    headerLabel: {
        fontSize: 10,
        color: theme.textMuted,
        fontWeight: '700',
        marginBottom: 2,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '900',
        color: theme.textPrimary,
    },
    closeButton: {
        padding: 8,
        backgroundColor: theme.border,
        borderRadius: RADIUS.full,
    },
    earningsBox: {
        backgroundColor: theme.primaryLight,
        borderWidth: 1,
        borderColor: theme.borderMedium,
        borderRadius: RADIUS.lg,
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    earningsLabel: {
        fontSize: 10,
        color: theme.primary,
        fontWeight: '700',
        marginBottom: 4,
    },
    earningsAmount: {
        fontSize: 24,
        fontWeight: '900',
        color: theme.primary,
    },
    earningsSubtext: {
        fontSize: 10,
        color: theme.textMuted,
        textAlign: 'right',
    },
    inputLabel: {
        fontSize: 10,
        fontWeight: '900',
        color: theme.textMuted,
        letterSpacing: 1,
        marginBottom: 8,
        marginTop: 16,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 4,
    },
    phonePrefix: {
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderMedium,
        borderRadius: RADIUS.md,
        paddingHorizontal: 14,
        paddingVertical: 12,
        justifyContent: 'center',
    },
    phonePrefixText: {
        fontWeight: '700',
        color: theme.textSecondary,
    },
    phoneInput: {
        flex: 1,
        backgroundColor: theme.background,
        borderWidth: 1,
        borderColor: theme.borderMedium,
        borderRadius: RADIUS.md,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        color: theme.textPrimary,
    },
    errorText: {
        color: theme.error,
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 8,
    },
    submitButton: {
        backgroundColor: theme.darkCard,
        paddingVertical: 16,
        borderRadius: RADIUS.lg,
        alignItems: 'center',
        marginTop: 16,
    },
    submitButtonDisabled: {
        opacity: 0.7,
    },
    submitButtonText: {
        fontSize: 14,
        fontWeight: '900',
        color: theme.surface,
    },
});
