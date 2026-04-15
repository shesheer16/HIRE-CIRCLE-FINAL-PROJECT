import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const ANIMATION_DURATION_MS = 240;

const InterviewClarificationSheet = ({
    visible,
    fieldName,
    fieldConfig,
    contextText,
    onResolve,
    onSkip,
    submitting = false,
}) => {
    const translateY = useRef(new Animated.Value(420)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    const [selectedValue, setSelectedValue] = useState(null);
    const [searchValue, setSearchValue] = useState('');
    const [inputValue, setInputValue] = useState('');
    const [multiSelection, setMultiSelection] = useState([]);

    useEffect(() => {
        if (!visible) return;
        setSelectedValue(null);
        setSearchValue('');
        setInputValue('');
        setMultiSelection([]);
    }, [visible, fieldName]);

    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, {
                toValue: visible ? 1 : 0,
                duration: ANIMATION_DURATION_MS,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }),
            Animated.timing(translateY, {
                toValue: visible ? 0 : 420,
                duration: ANIMATION_DURATION_MS,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
            }),
        ]).start();
    }, [opacity, translateY, visible]);

    const filteredOptions = useMemo(() => {
        const options = fieldConfig?.options || [];
        const query = String(searchValue || '').trim().toLowerCase();
        if (!query) return options;
        return options.filter((option) =>
            String(option?.label || option?.value || '')
                .toLowerCase()
                .includes(query)
        );
    }, [fieldConfig?.options, searchValue]);

    const toggleMultiSelection = useCallback((value) => {
        setMultiSelection((prev) => {
            const alreadySelected = prev.includes(value);
            if (alreadySelected) {
                return prev.filter((item) => item !== value);
            }
            return [...prev, value];
        });
    }, []);

    const onPressOption = useCallback((value) => {
        setSelectedValue(value);
    }, []);

    const onPressResolve = useCallback(() => {
        if (!fieldConfig || submitting) return;
        let resolvedValue = null;

        switch (fieldConfig.type) {
            case 'numericSelector':
            case 'singleSelect':
            case 'searchableDropdown':
                resolvedValue = selectedValue;
                break;
            case 'currencyInput': {
                const parsed = Number(String(inputValue || '').replace(/[^0-9]/g, ''));
                resolvedValue = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                break;
            }
            case 'multiSelectSearch':
                resolvedValue = multiSelection.length ? multiSelection : null;
                break;
            default:
                resolvedValue = selectedValue;
                break;
        }

        if (resolvedValue === null || resolvedValue === undefined) return;
        onResolve?.(resolvedValue);
    }, [fieldConfig, inputValue, multiSelection, onResolve, selectedValue, submitting]);

    if (!fieldConfig) return null;

    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={() => {}}>
            <Animated.View style={[styles.backdrop, { opacity }]}>
                <View style={styles.backdropBlocker} />
                <Animated.View style={[styles.sheetContainer, { transform: [{ translateY }] }]}>
                    <View style={styles.handle} />
                    <Text style={styles.title}>Just a quick clarification</Text>
                    {Boolean(contextText) && (
                        <Text style={styles.contextText}>{contextText}</Text>
                    )}
                    <Text style={styles.question}>{fieldConfig.question}</Text>

                    {fieldConfig.type === 'currencyInput' && (
                        <View style={styles.currencyRow}>
                            <View style={styles.currencyPrefixWrap}>
                                <Text style={styles.currencyPrefix}>{fieldConfig.currencyPrefix || 'INR'}</Text>
                            </View>
                            <TextInput
                                style={styles.textInput}
                                keyboardType="numeric"
                                value={inputValue}
                                onChangeText={setInputValue}
                                placeholder={fieldConfig.placeholder || 'Enter value'}
                                placeholderTextColor="#94a3b8"
                            />
                        </View>
                    )}

                    {(fieldConfig.type === 'searchableDropdown' || fieldConfig.type === 'multiSelectSearch') && (
                        <TextInput
                            style={styles.searchInput}
                            value={searchValue}
                            onChangeText={setSearchValue}
                            placeholder={fieldConfig.placeholder || 'Search'}
                            placeholderTextColor="#94a3b8"
                        />
                    )}

                    {(fieldConfig.type === 'numericSelector' ||
                        fieldConfig.type === 'singleSelect' ||
                        fieldConfig.type === 'searchableDropdown') && (
                            <View style={styles.optionWrap}>
                                {filteredOptions.map((option) => {
                                    const value = option?.value;
                                    const selected = selectedValue === value;
                                    return (
                                        <TouchableOpacity
                                            key={`${fieldName}-${String(value)}`}
                                            style={[styles.optionButton, selected && styles.optionButtonSelected]}
                                            onPress={() => onPressOption(value)}
                                            activeOpacity={0.86}
                                        >
                                            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                                                {option?.label}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                    {fieldConfig.type === 'multiSelectSearch' && (
                        <View style={styles.optionWrap}>
                            {filteredOptions.map((option) => {
                                const value = option?.value;
                                const selected = multiSelection.includes(value);
                                return (
                                    <TouchableOpacity
                                        key={`${fieldName}-${String(value)}`}
                                        style={[styles.optionButton, selected && styles.optionButtonSelected]}
                                        onPress={() => toggleMultiSelection(value)}
                                        activeOpacity={0.86}
                                    >
                                        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                                            {option?.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}

                    <View style={styles.actionRow}>
                        <TouchableOpacity
                            style={styles.skipButton}
                            onPress={onSkip}
                            disabled={submitting}
                            activeOpacity={0.86}
                        >
                            <Text style={styles.skipButtonText}>Skip for now</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.confirmButton, submitting && styles.confirmButtonDisabled]}
                            onPress={onPressResolve}
                            disabled={submitting}
                            activeOpacity={0.86}
                        >
                            <Text style={styles.confirmButtonText}>{submitting ? 'Saving...' : 'Confirm'}</Text>
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            </Animated.View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(2, 6, 23, 0.35)',
    },
    backdropBlocker: {
        flex: 1,
    },
    sheetContainer: {
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 20,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: '#f8fbff',
    },
    handle: {
        width: 44,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#cbd5e1',
        alignSelf: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 18,
        lineHeight: 24,
        fontWeight: '700',
        color: '#0f172a',
    },
    question: {
        marginTop: 6,
        marginBottom: 14,
        fontSize: 15,
        lineHeight: 22,
        fontWeight: '500',
        color: '#334155',
    },
    contextText: {
        marginTop: 8,
        fontSize: 13,
        lineHeight: 18,
        color: '#64748b',
        fontWeight: '500',
    },
    currencyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    currencyPrefixWrap: {
        minWidth: 58,
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#eef2ff',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    currencyPrefix: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    textInput: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        fontSize: 15,
        color: '#0f172a',
    },
    searchInput: {
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        fontSize: 14,
        color: '#0f172a',
        marginBottom: 12,
    },
    optionWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
        marginBottom: 8,
    },
    optionButton: {
        marginHorizontal: 4,
        marginBottom: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#dbeafe',
        backgroundColor: '#ffffff',
    },
    optionButtonSelected: {
        borderColor: '#7c3aed',
        backgroundColor: '#f5edff',
    },
    optionText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    optionTextSelected: {
        color: '#6d28d9',
    },
    actionRow: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    skipButton: {
        minHeight: 44,
        paddingHorizontal: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    skipButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748b',
    },
    confirmButton: {
        minWidth: 110,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#6d28d9',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    confirmButtonDisabled: {
        opacity: 0.6,
    },
    confirmButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#ffffff',
    },
});

export default memo(InterviewClarificationSheet);
