import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';
import { PALETTE, SPACING } from '../theme/theme';

export default function Header({ title, subtitle, showBack = true }) {
    const navigation = useNavigation();
    const { logout } = React.useContext(AuthContext);

    const handleLogout = async () => {
        await logout?.();
        navigation.getParent()?.reset({
            index: 0,
            routes: [{ name: 'RoleSelection' }],
        });
    };

    return (
        <View style={styles.header}>
            <View style={styles.leftContainer}>
                {showBack && (
                    <TouchableOpacity
                        onPress={() => {
                            if (navigation.canGoBack()) {
                                navigation.goBack();
                                return;
                            }
                            navigation.navigate('MainTab');
                        }}
                        style={styles.backButton}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="chevron-back" size={24} color={PALETTE.textPrimary} />
                    </TouchableOpacity>
                )}
                <View>
                    <Text style={styles.headerTitle}>{title}</Text>
                    {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
                </View>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} activeOpacity={0.7}>
                <Ionicons name="log-out-outline" size={22} color={PALETTE.error} />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: SPACING.md,
        paddingVertical: 12,
        backgroundColor: PALETTE.background,
        borderBottomWidth: 0.5,
        borderBottomColor: PALETTE.separator,
    },
    leftContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: PALETTE.textPrimary,
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        fontSize: 13,
        color: PALETTE.textSecondary,
        marginTop: 2,
    },
    logoutButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
