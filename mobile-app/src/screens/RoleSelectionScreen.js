import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { trackEvent } from '../services/analytics';
import { triggerHaptic } from '../utils/haptics';
import { navigateToWelcomeFallback } from '../utils/authNavigation';

const ROLE_ITEMS = [
    {
        key: 'employer',
        title: "I'm Hiring",
        description: 'Find qualified candidates faster with ranked matches.',
        icon: 'briefcase-outline',
    },
    {
        key: 'worker',
        title: "I'm Looking for Work",
        description: 'Get matched to roles built around your real profile.',
        icon: 'person-outline',
    },
];

function RoleCard({
    title,
    description,
    icon,
    selected,
    scale,
    onPress,
    onPressIn,
    onPressOut,
}) {
    return (
        <Animated.View style={{ transform: [{ scale }] }}>
            <TouchableOpacity
                style={[styles.card, selected && styles.cardSelected]}
                activeOpacity={0.95}
                onPress={onPress}
                onPressIn={onPressIn}
                onPressOut={onPressOut}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityHint={description}
            >
                <View style={styles.cardIconWrap}>
                    <Ionicons name={icon} size={20} color={selected ? '#1d4ed8' : '#334155'} />
                </View>
                <View style={styles.cardBody}>
                    <Text style={[styles.cardTitle, selected && styles.cardTitleSelected]}>{title}</Text>
                    <Text style={styles.cardDescription}>{description}</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={selected ? '#1d4ed8' : '#94a3b8'} />
            </TouchableOpacity>
        </Animated.View>
    );
}

export default function RoleSelectionScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const { userToken, userInfo, updateUserInfo } = useContext(AuthContext);
    const initialSelectedRole = useMemo(() => {
        if (userInfo?.hasSelectedRole === false) {
            return null;
        }
        const normalizedPrimary = String(userInfo?.primaryRole || '').toLowerCase();
        if (normalizedPrimary === 'employer' || normalizedPrimary === 'worker') return normalizedPrimary;
        const normalizedRole = String(userInfo?.role || '').toLowerCase();
        return normalizedRole === 'recruiter' ? 'employer' : (normalizedRole === 'candidate' ? 'worker' : null);
    }, [userInfo?.primaryRole, userInfo?.role]);

    const [selectedRole, setSelectedRole] = useState(initialSelectedRole);
    const [savingRole, setSavingRole] = useState(false);
    const scaleValues = useRef({
        employer: new Animated.Value(1),
        worker: new Animated.Value(1),
    }).current;

    const animateScale = useCallback((roleKey, target) => {
        Animated.timing(scaleValues[roleKey], {
            toValue: target,
            duration: 90,
            useNativeDriver: true,
        }).start();
    }, [scaleValues]);

    const handleBackPress = useCallback(() => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigateToWelcomeFallback(navigation);
    }, [navigation]);

    const handleRoleSelect = useCallback(async (roleKey) => {
        if (savingRole) return;
        setSelectedRole(roleKey);
        triggerHaptic.light();
        setSavingRole(true);

        const rolePayload = {
            source: 'role_selection_screen',
            role: roleKey,
        };
        trackEvent('ROLE_SELECTED', rolePayload);

        try {
            if (!userToken) {
                navigation.navigate('Login');
                return;
            }

            await client.put('/api/settings', {
                accountInfo: {
                    role: roleKey,
                },
            });

            await updateUserInfo({
                role: roleKey === 'employer' ? 'recruiter' : 'candidate',
                primaryRole: roleKey,
                hasSelectedRole: true,
            });

            Animated.sequence([
                Animated.timing(scaleValues[roleKey], {
                    toValue: 1.02,
                    duration: 120,
                    useNativeDriver: true,
                }),
                Animated.timing(scaleValues[roleKey], {
                    toValue: 1,
                    duration: 120,
                    useNativeDriver: true,
                }),
            ]).start();
        } catch (error) {
            const message = error?.response?.data?.message || 'Unable to save role selection. Please try again.';
            Alert.alert('Role Selection Failed', message);
        } finally {
            setSavingRole(false);
        }
    }, [navigation, savingRole, scaleValues, updateUserInfo, userToken]);

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={['#f5f7fa', '#eaf0fb']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 24 }]}>
                <TouchableOpacity style={styles.backBtn} onPress={handleBackPress} activeOpacity={0.75}>
                    <Ionicons name="arrow-back" size={18} color="#334155" />
                    <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.header}>
                    <Text style={styles.title}>Choose your role</Text>
                    <Text style={styles.subtitle}>Select how you want to use HIRE before continuing.</Text>
                </View>

                <View style={styles.cardsStack}>
                    {ROLE_ITEMS.map((item) => {
                        const isSelected = selectedRole === item.key;
                        return (
                            <RoleCard
                                key={item.key}
                                title={item.title}
                                description={item.description}
                                icon={item.icon}
                                selected={isSelected}
                                scale={scaleValues[item.key]}
                                onPress={() => handleRoleSelect(item.key)}
                                onPressIn={() => animateScale(item.key, 0.98)}
                                onPressOut={() => animateScale(item.key, isSelected ? 1.02 : 1)}
                            />
                        );
                    })}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f7fa',
    },
    content: {
        flex: 1,
        paddingHorizontal: 24,
    },
    backBtn: {
        minHeight: 44,
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 20,
    },
    backBtnText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#334155',
    },
    header: {
        marginBottom: 32,
    },
    title: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0f172a',
        marginBottom: 8,
        letterSpacing: -0.2,
    },
    subtitle: {
        fontSize: 16,
        fontWeight: '400',
        color: '#475569',
        lineHeight: 24,
    },
    cardsStack: {
        gap: 16,
    },
    card: {
        minHeight: 118,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#d6deea',
        backgroundColor: '#ffffff',
        padding: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.05,
        shadowRadius: 14,
        elevation: 2,
    },
    cardSelected: {
        borderColor: '#1d4ed8',
        shadowColor: '#1d4ed8',
        shadowOpacity: 0.14,
    },
    cardIconWrap: {
        width: 44,
        height: 44,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#d6deea',
        backgroundColor: '#f8fbff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cardBody: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#0f172a',
        marginBottom: 6,
    },
    cardTitleSelected: {
        color: '#1d4ed8',
    },
    cardDescription: {
        fontSize: 14,
        fontWeight: '400',
        color: '#64748b',
        lineHeight: 20,
    },
});
