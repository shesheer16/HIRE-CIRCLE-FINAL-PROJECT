import React, {
    forwardRef,
    memo,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { classifyIdentityInput, formatPhoneForDisplay } from '../utils/identity';

const DETECTION_DEBOUNCE_MS = 150;

const UnifiedIdentityInput = forwardRef(function UnifiedIdentityInput({
    label = 'Email or Phone',
    placeholder = 'Enter your email or phone',
    editable = true,
    errorText = '',
    onFocus,
    onBlur,
    onDetectionChange,
    defaultValue = '',
    inputProps = {},
}, ref) {
    const [inputValue, setInputValue] = useState(defaultValue);
    const [focused, setFocused] = useState(false);
    const [detectionType, setDetectionType] = useState('unknown');

    const textInputRef = useRef(null);
    const valueRef = useRef(defaultValue);
    const debounceRef = useRef(null);

    const clearDetectionTimer = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
    }, []);

    const publishDetection = useCallback((value) => {
        const snapshot = classifyIdentityInput(value);
        setDetectionType(snapshot.type);
        onDetectionChange?.(snapshot);
    }, [onDetectionChange]);

    const handleChangeText = useCallback((nextValue) => {
        valueRef.current = nextValue;
        setInputValue(nextValue);

        clearDetectionTimer();
        debounceRef.current = setTimeout(() => {
            publishDetection(nextValue);
        }, DETECTION_DEBOUNCE_MS);
    }, [clearDetectionTimer, publishDetection]);

    const handleFocus = useCallback(() => {
        setFocused(true);
        onFocus?.();
    }, [onFocus]);

    const handleBlur = useCallback(() => {
        setFocused(false);
        const snapshot = classifyIdentityInput(valueRef.current);
        if (snapshot.type === 'phone' && snapshot.raw) {
            const formatted = formatPhoneForDisplay(snapshot.raw);
            valueRef.current = formatted;
            setInputValue(formatted);
            publishDetection(formatted);
        } else {
            publishDetection(valueRef.current);
        }
        onBlur?.();
    }, [onBlur, publishDetection]);

    useEffect(() => () => clearDetectionTimer(), [clearDetectionTimer]);

    useImperativeHandle(ref, () => ({
        getValue: () => valueRef.current,
        getSnapshot: () => classifyIdentityInput(valueRef.current),
        focus: () => textInputRef.current?.focus?.(),
        blur: () => textInputRef.current?.blur?.(),
        setValue: (nextValue = '') => {
            valueRef.current = nextValue;
            setInputValue(nextValue);
            publishDetection(nextValue);
        },
        clear: () => {
            valueRef.current = '';
            setInputValue('');
            setDetectionType('unknown');
        },
    }), [publishDetection]);

    const helperText = useMemo(() => {
        if (errorText) return errorText;
        if (detectionType === 'email') return 'Email detected';
        if (detectionType === 'phone') return 'Phone number detected';
        return '';
    }, [detectionType, errorText]);

    return (
        <View style={styles.wrapper}>
            <Text style={styles.label}>{label}</Text>
            <TextInput
                ref={textInputRef}
                style={[styles.input, focused && styles.inputFocused]}
                placeholder={placeholder}
                placeholderTextColor="rgba(71, 85, 105, 0.6)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={detectionType === 'phone' ? 'phone-pad' : 'email-address'}
                value={inputValue}
                onChangeText={handleChangeText}
                onFocus={handleFocus}
                onBlur={handleBlur}
                editable={editable}
                textContentType="username"
                accessibilityLabel="Email or phone"
                {...inputProps}
            />
            {helperText ? (
                <Text style={[styles.helperText, errorText ? styles.errorText : styles.metaText]}>{helperText}</Text>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create({
    wrapper: {
        gap: 6,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
    },
    input: {
        minHeight: 52,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d1d9e4',
        backgroundColor: '#ffffff',
        paddingHorizontal: 14,
        paddingVertical: 14,
        fontSize: 15,
        fontWeight: '400',
        color: '#0f172a',
    },
    inputFocused: {
        borderColor: '#1d4ed8',
        shadowColor: '#1d4ed8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 1,
    },
    helperText: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: '400',
    },
    metaText: {
        color: '#64748b',
    },
    errorText: {
        color: '#8f4b53',
    },
});

export default memo(UnifiedIdentityInput);
