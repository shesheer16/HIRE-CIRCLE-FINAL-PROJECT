import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';

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
                    >
                        <Ionicons name="arrow-back" size={24} color="#374151" />
                    </TouchableOpacity>
                )}
                <View>
                    <Text style={styles.headerTitle}>{title}</Text>
                    {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
                </View>
            </View>
            <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                <Ionicons name="log-out-outline" size={24} color="#EF4444" />
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    leftContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        marginRight: 16,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#111827',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#6B7280'
    },
    logoutButton: {
        padding: 8,
    },
});
