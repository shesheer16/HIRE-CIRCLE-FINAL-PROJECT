import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Animated,
} from 'react-native';

const FEEDBACK_TYPES = [
    'Bug report',
    'Safety concern',
    'Feature request',
    'General feedback',
];

export default function FeedbackModal({
    visible,
    title = 'Share feedback',
    subtitle = 'Tell us what we can improve.',
    submitLabel = 'Send Feedback',
    onClose,
    onSubmit,
}) {
    const [type, setType] = useState(FEEDBACK_TYPES[0]);
    const [text, setText] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const translateY = useRef(new Animated.Value(360)).current;

    const canSubmit = useMemo(() => String(text || '').trim().length >= 8, [text]);

    const handleClose = () => {
        if (submitting) return;
        setText('');
        setType(FEEDBACK_TYPES[0]);
        onClose?.();
    };

    const handleSubmit = async () => {
        if (!canSubmit || submitting) return;
        setSubmitting(true);

        try {
            await onSubmit?.({ type, message: text.trim() });
            setText('');
            setType(FEEDBACK_TYPES[0]);
            onClose?.();
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (!visible) return;
        translateY.setValue(360);
        Animated.spring(translateY, {
            toValue: 0,
            stiffness: 170,
            damping: 18,
            mass: 0.9,
            useNativeDriver: true,
        }).start();
    }, [translateY, visible]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={handleClose}
        >
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
                    <View style={styles.headerRow}>
                        <View style={styles.headerTextWrap}>
                            <Text style={styles.title}>{title}</Text>
                            <Text style={styles.subtitle}>{subtitle}</Text>
                        </View>
                        <TouchableOpacity onPress={handleClose} style={styles.closeBtn} disabled={submitting}>
                            <Text style={styles.closeBtnText}>X</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.sectionLabel}>Type</Text>
                    <View style={styles.chipsWrap}>
                        {FEEDBACK_TYPES.map((item) => {
                            const active = type === item;
                            return (
                                <TouchableOpacity
                                    key={item}
                                    style={[styles.chip, active && styles.chipActive]}
                                    onPress={() => setType(item)}
                                    activeOpacity={0.85}
                                    disabled={submitting}
                                >
                                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{item}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <Text style={styles.sectionLabel}>Details</Text>
                    <TextInput
                        style={styles.textInput}
                        value={text}
                        onChangeText={setText}
                        placeholder="Please share what happened..."
                        placeholderTextColor="#94a3b8"
                        multiline
                        textAlignVertical="top"
                        editable={!submitting}
                    />

                    <View style={styles.actionsRow}>
                        <TouchableOpacity style={styles.secondaryBtn} onPress={handleClose} disabled={submitting}>
                            <Text style={styles.secondaryBtnText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.primaryBtn, (!canSubmit || submitting) && styles.primaryBtnDisabled]}
                            onPress={handleSubmit}
                            disabled={!canSubmit || submitting}
                        >
                            {submitting
                                ? <ActivityIndicator color="#fff" size="small" />
                                : <Text style={styles.primaryBtnText}>{submitLabel}</Text>}
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15,23,42,0.5)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 18,
        paddingTop: 16,
        paddingBottom: 18,
        maxHeight: '84%',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    headerTextWrap: {
        flex: 1,
        paddingRight: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
    },
    subtitle: {
        marginTop: 3,
        fontSize: 13,
        color: '#64748b',
        lineHeight: 18,
    },
    closeBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f1f5f9',
    },
    closeBtnText: {
        fontSize: 12,
        fontWeight: '900',
        color: '#64748b',
    },
    sectionLabel: {
        marginTop: 10,
        marginBottom: 6,
        fontSize: 11,
        fontWeight: '700',
        color: '#64748b',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    chipsWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    chip: {
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 7,
        backgroundColor: '#fff',
    },
    chipActive: {
        backgroundColor: '#eef2ff',
        borderColor: '#c7d2fe',
    },
    chipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
    },
    chipTextActive: {
        color: '#4338ca',
    },
    textInput: {
        minHeight: 120,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#dbe3ef',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: '#0f172a',
        fontSize: 14,
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 14,
    },
    secondaryBtn: {
        flex: 1,
        minHeight: 44,
        borderRadius: 12,
        backgroundColor: '#f1f5f9',
        alignItems: 'center',
        justifyContent: 'center',
    },
    secondaryBtnText: {
        color: '#64748b',
        fontSize: 13,
        fontWeight: '700',
    },
    primaryBtn: {
        flex: 2,
        minHeight: 44,
        borderRadius: 12,
        backgroundColor: '#1d4ed8',
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryBtnDisabled: {
        opacity: 0.5,
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 13,
        fontWeight: '800',
    },
});
