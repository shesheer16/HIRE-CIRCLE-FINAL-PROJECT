import React, { useMemo, useRef, useState } from 'react';
import {
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme/colors';
import FieldRow from './FieldRow';
import PressableScale from './PressableScale';

export default function FieldPicker({
    label,
    value,
    displayValue,
    placeholder,
    suggestions = [],
    onChangeText,
    onSelect,
    last = false,
    keyboardType = 'default',
    autoCapitalize = 'words',
    title,
    hint,
}) {
    const inputRef = useRef(null);
    const [visible, setVisible] = useState(false);
    const [draft, setDraft] = useState(String(value || ''));
    const safeSuggestions = useMemo(
        () => [...new Set((Array.isArray(suggestions) ? suggestions : []).map((item) => String(item || '').trim()).filter(Boolean))],
        [suggestions]
    );

    const close = () => {
        Keyboard.dismiss();
        setVisible(false);
    };

    return (
        <View>
            <FieldRow
                label={label}
                value={displayValue ?? value}
                placeholder={placeholder}
                last={last}
                onPress={() => {
                    setDraft(String(value || ''));
                    setVisible(true);
                    requestAnimationFrame(() => inputRef.current?.focus?.());
                }}
            />

            <Modal visible={visible} transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={close}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
                    style={styles.overlay}
                >
                    <PressableScale style={styles.backdrop} onPress={close} />
                    <View style={styles.sheet}>
                        <View style={styles.sheetHandle} />
                        <View style={styles.sheetHeader}>
                            <View style={styles.sheetCopy}>
                                <Text style={styles.sheetTitle}>{title || label}</Text>
                                <Text style={styles.sheetHint}>{hint || 'Select or type a value'}</Text>
                            </View>
                            <PressableScale onPress={close} style={styles.closeWrap}>
                                <View style={styles.closeButton}>
                                    <Ionicons name="close" size={18} color={C.textMute} />
                                </View>
                            </PressableScale>
                        </View>

                        <View style={styles.inputShell}>
                            <TextInput
                                ref={inputRef}
                                value={draft}
                                onChangeText={(nextValue) => {
                                    setDraft(nextValue);
                                    onChangeText?.(nextValue);
                                }}
                                style={styles.input}
                                placeholder={placeholder}
                                placeholderTextColor={C.white22}
                                keyboardType={keyboardType}
                                autoCapitalize={autoCapitalize}
                                autoCorrect={false}
                            />
                        </View>

                        <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
                            {safeSuggestions.map((item) => (
                                <PressableScale
                                    key={item}
                                    onPress={() => {
                                        onSelect?.(item);
                                        close();
                                    }}
                                    style={styles.itemWrap}
                                >
                                    <View style={styles.item}>
                                        <Text style={styles.itemText}>{item}</Text>
                                    </View>
                                </PressableScale>
                            ))}
                            {String(draft || '').trim() ? (
                                <PressableScale
                                    onPress={() => {
                                        onSelect?.(String(draft || '').trim());
                                        close();
                                    }}
                                    style={styles.itemWrap}
                                >
                                    <View style={[styles.item, styles.itemPrimary]}>
                                        <Text style={styles.itemPrimaryText}>{`Use "${String(draft || '').trim()}"`}</Text>
                                    </View>
                                </PressableScale>
                            ) : null}
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { flex: 1, backgroundColor: C.overlay },
    sheet: { backgroundColor: C.bg, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    sheetHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 999, backgroundColor: C.borderMid, marginBottom: 12 },
    sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
    sheetCopy: { flex: 1, paddingRight: 12 },
    sheetTitle: { fontSize: 18, fontWeight: '500', color: C.text },
    sheetHint: { marginTop: 4, fontSize: 12, lineHeight: 16, color: C.textMute },
    closeWrap: { minWidth: 44, minHeight: 44 },
    closeButton: { width: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: C.borderMid, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
    inputShell: { minHeight: 52, borderRadius: 14, backgroundColor: C.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.borderMid, paddingHorizontal: 14, marginBottom: 12, justifyContent: 'center' },
    input: { fontSize: 15, fontWeight: '400', color: C.text, paddingVertical: 12 },
    list: { paddingBottom: 16 },
    itemWrap: { marginBottom: 8 },
    item: { minHeight: 52, borderRadius: 14, backgroundColor: C.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: 14, justifyContent: 'center' },
    itemPrimary: { borderColor: C.accent },
    itemText: { fontSize: 15, fontWeight: '400', color: C.text },
    itemPrimaryText: { fontSize: 15, fontWeight: '500', color: C.accentDeep },
});
