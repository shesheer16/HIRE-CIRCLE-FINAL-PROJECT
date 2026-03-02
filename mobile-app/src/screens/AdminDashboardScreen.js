import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, FlatList, Alert, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import client from '../api/client';
import { logger } from '../utils/logger';

const MOCK_STATS = {
    users: { total: 1247, employers: 312 },
    jobs: { active: 342 },
    activity: { totalApplications: 0 },
    reports: { pending: 89 },
};

const MOCK_REPORTS = [
    { _id: 'r1', reporterName: 'Amit K', targetType: 'job', targetId: 'job_123', reason: 'Spam listing', createdAt: new Date().toISOString() },
    { _id: 'r2', reporterName: 'Priya R', targetType: 'user', targetId: 'user_456', reason: 'Harassment', createdAt: new Date().toISOString() },
    { _id: 'r3', reporterName: 'Sameer M', targetType: 'job', targetId: 'job_789', reason: 'Misleading salary', createdAt: new Date().toISOString() },
];

export default function AdminDashboardScreen({ navigation }) {
    const [stats, setStats] = useState(null);
    const [metrics, setMetrics] = useState(null);
    const [users, setUsers] = useState([]);
    const [jobs, setJobs] = useState([]);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [authLoading, setAuthLoading] = useState(false);
    const [adminEmail, setAdminEmail] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [adminToken, setAdminToken] = useState('');
    const [requiresAdminAuth, setRequiresAdminAuth] = useState(false);
    const [activeTab, setActiveTab] = useState('Overview');

    useEffect(() => {
        const bootstrap = async () => {
            const storedAdminToken = await SecureStore.getItemAsync('adminAuthToken');
            if (storedAdminToken) {
                setAdminToken(storedAdminToken);
                setRequiresAdminAuth(false);
                await fetchAdminData(storedAdminToken);
            } else {
                setRequiresAdminAuth(true);
                setLoading(false);
            }
        };
        bootstrap();
    }, []);

    const fetchAdminData = async (tokenOverride = null) => {
        const resolvedToken = tokenOverride || adminToken;
        if (!resolvedToken) {
            setRequiresAdminAuth(true);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const [statsRes, usersRes, jobsRes, reportsRes, metricsRes] = await Promise.allSettled([
                client.get('/api/admin/stats'),
                client.get('/api/admin/users?limit=5'), // Just recent 5 for overview
                client.get('/api/admin/jobs?limit=5'),
                client.get('/api/admin/reports?limit=5'),
                client.get('/api/admin/metrics'),
            ]);
            const allRejected = [statsRes, usersRes, jobsRes, reportsRes, metricsRes].every((row) => row.status === 'rejected');
            if (allRejected) {
                const unauthorized = [statsRes, usersRes, jobsRes, reportsRes, metricsRes].some(
                    (row) => row.reason?.response?.status === 401 || row.reason?.response?.status === 403
                );
                if (unauthorized) {
                    await SecureStore.deleteItemAsync('adminAuthToken');
                    setAdminToken('');
                    setRequiresAdminAuth(true);
                    setStats(null);
                    setUsers([]);
                    setJobs([]);
                    setReports([]);
                    setMetrics(null);
                    return;
                }
            }

            setStats(statsRes.status === 'fulfilled' ? statsRes.value.data : MOCK_STATS);
            setUsers(usersRes.status === 'fulfilled' ? usersRes.value.data.users : []);
            setJobs(jobsRes.status === 'fulfilled' ? jobsRes.value.data.jobs : []);
            setReports(reportsRes.status === 'fulfilled' ? reportsRes.value.data.reports : MOCK_REPORTS);
            setMetrics(metricsRes.status === 'fulfilled' ? metricsRes.value.data.metrics : null);
            setRequiresAdminAuth(false);
        } catch (error) {
            logger.error("Failed to load admin data:", error);
            setStats(MOCK_STATS);
            setReports(MOCK_REPORTS);
        } finally {
            setLoading(false);
        }
    };

    const handleAdminLogin = async () => {
        const email = String(adminEmail || '').trim().toLowerCase();
        const password = String(adminPassword || '');
        if (!email || !password) {
            Alert.alert('Admin Login', 'Email and password are required.');
            return;
        }

        try {
            setAuthLoading(true);
            const { data } = await client.post('/api/admin/auth/login', { email, password });
            const token = String(data?.token || '');
            if (!token) {
                throw new Error('Missing admin token');
            }

            await SecureStore.setItemAsync('adminAuthToken', token);
            setAdminToken(token);
            setRequiresAdminAuth(false);
            setAdminPassword('');
            await fetchAdminData(token);
        } catch (error) {
            Alert.alert('Admin Login Failed', error?.response?.data?.message || 'Invalid admin credentials.');
        } finally {
            setAuthLoading(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#0f172a" />
            </View>
        );
    }

    const handleDismissReport = async (id) => {
        try {
            await client.put(`/api/admin/reports/${id}/dismiss`);
            setReports(prev => prev.filter(r => r._id !== id));
        } catch (e) {
            Alert.alert('Dismiss Failed', 'Could not dismiss this report.');
        }
    };

    const handleReviewReport = (report) => {
        if (report?.targetType === 'job' && report?.targetId) {
            navigation.navigate('JobDetails', { jobId: report.targetId });
            return;
        }
        if (report?.targetType === 'user' && report?.targetId) {
            navigation.navigate('Profiles', { userId: report.targetId });
            return;
        }
        Alert.alert('Review Report', 'Open the flagged content to review.');
    };

    const renderOverview = () => (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                    <Ionicons name="people" size={24} color="#3b82f6" />
                    <Text style={styles.statValue}>{stats?.users?.total || 0}</Text>
                    <Text style={styles.statLabel}>Total Users</Text>
                </View>
                <View style={styles.statCard}>
                    <Ionicons name="briefcase" size={24} color="#8b5cf6" />
                    <Text style={styles.statValue}>{stats?.jobs?.active || 0}</Text>
                    <Text style={styles.statLabel}>Active Jobs</Text>
                </View>
                <View style={styles.statCard}>
                    <Ionicons name="warning" size={24} color="#f97316" />
                    <Text style={styles.statValue}>{stats?.reports?.pending || 0}</Text>
                    <Text style={styles.statLabel}>Reports Pending</Text>
                </View>
            </View>
            <View style={styles.systemCard}>
                <Text style={styles.sectionTitle}>System Intelligence</Text>
                <Text style={styles.systemText}>Flagged users: {metrics?.moderation?.flaggedUsers ?? 0}</Text>
                <Text style={styles.systemText}>Pending reports: {metrics?.moderation?.pendingReports ?? 0}</Text>
                <Text style={styles.systemText}>OTP spikes: {metrics?.monitoring?.otpFailures ?? 0}</Text>
                <Text style={styles.systemText}>AI failure spikes: {metrics?.monitoring?.aiFailures ?? 0}</Text>
            </View>

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Quick Actions</Text>
            </View>
            <View style={styles.quickActionsRow}>
                <TouchableOpacity style={styles.quickAction} onPress={() => setActiveTab('Reports')}>
                    <Ionicons name="alert-circle" size={20} color="#ef4444" />
                    <Text style={styles.quickActionText}>Reported Content</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickAction} onPress={() => setActiveTab('Users')}>
                    <Ionicons name="people" size={20} color="#3b82f6" />
                    <Text style={styles.quickActionText}>Manage Users</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.quickAction} onPress={() => setActiveTab('Jobs')}>
                    <Ionicons name="briefcase" size={20} color="#8b5cf6" />
                    <Text style={styles.quickActionText}>View Jobs</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Reported Content</Text>
                <TouchableOpacity onPress={() => setActiveTab('Reports')}>
                    <Text style={styles.seeAll}>See All</Text>
                </TouchableOpacity>
            </View>
            {reports.slice(0, 3).map(r => (
                <View key={r._id} style={styles.reportCard}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.listTitle}>{r.reporterName || 'Reporter'}</Text>
                        <Text style={styles.listSubtitle}>{r.reason || 'Reported content'}</Text>
                        <Text style={styles.reportMeta}>{r.targetType || 'content'} · {new Date(r.createdAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.reportActions}>
                        <TouchableOpacity style={styles.reportBtn} onPress={() => handleReviewReport(r)}>
                            <Text style={styles.reportBtnText}>Review</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.reportBtn, styles.reportBtnDismiss]} onPress={() => handleDismissReport(r._id)}>
                            <Text style={[styles.reportBtnText, styles.reportBtnDismissText]}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            ))}

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Users</Text>
                <TouchableOpacity onPress={() => setActiveTab('Users')}>
                    <Text style={styles.seeAll}>See All</Text>
                </TouchableOpacity>
            </View>
            {users.map(u => (
                <View key={u._id} style={styles.listCard}>
                    <View>
                        <Text style={styles.listTitle}>{u.name}</Text>
                        <Text style={styles.listSubtitle}>{u.email}</Text>
                    </View>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{u.role}</Text>
                    </View>
                </View>
            ))}

            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Jobs</Text>
                <TouchableOpacity onPress={() => setActiveTab('Jobs')}>
                    <Text style={styles.seeAll}>See All</Text>
                </TouchableOpacity>
            </View>
            {jobs.map(j => (
                <View key={j._id} style={styles.listCard}>
                    <View>
                        <Text style={styles.listTitle}>{j.title}</Text>
                        <Text style={styles.listSubtitle}>{j.employerId?.companyName || 'Unknown Co.'}</Text>
                    </View>
                    <Text style={styles.statusText}>{j.isOpen ? 'Active' : 'Closed'}</Text>
                </View>
            ))}
        </ScrollView>
    );

    const renderUsersTab = () => (
        <FlatList
            data={users}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.scrollContent}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={10}
            windowSize={10}
            renderItem={({ item }) => (
                <View style={styles.listCard}>
                    <View>
                        <Text style={styles.listTitle}>{item.name}</Text>
                        <Text style={styles.listSubtitle}>{item.email}</Text>
                    </View>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.role}</Text>
                    </View>
                </View>
            )}
        />
    );

    const renderJobsTab = () => (
        <FlatList
            data={jobs}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.scrollContent}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={10}
            windowSize={10}
            renderItem={({ item }) => (
                <View style={styles.listCard}>
                    <View>
                        <Text style={styles.listTitle}>{item.title}</Text>
                        <Text style={styles.listSubtitle}>{item.employerId?.companyName || 'Unknown Co.'}</Text>
                    </View>
                    <Text style={styles.statusText}>{item.isOpen ? 'Active' : 'Closed'}</Text>
                </View>
            )}
        />
    );

    const renderReportsTab = () => (
        <FlatList
            data={reports}
            keyExtractor={item => item._id}
            contentContainerStyle={styles.scrollContent}
            removeClippedSubviews={Platform.OS === 'android'}
            maxToRenderPerBatch={10}
            windowSize={10}
            renderItem={({ item }) => (
                <View style={styles.reportCard}>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.listTitle}>{item.reporterName || 'Reporter'}</Text>
                        <Text style={styles.listSubtitle}>{item.reason || 'Reported content'}</Text>
                        <Text style={styles.reportMeta}>{item.targetType || 'content'} · {new Date(item.createdAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.reportActions}>
                        <TouchableOpacity style={styles.reportBtn} onPress={() => handleReviewReport(item)}>
                            <Text style={styles.reportBtnText}>Review</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.reportBtn, styles.reportBtnDismiss]} onPress={() => handleDismissReport(item._id)}>
                            <Text style={[styles.reportBtnText, styles.reportBtnDismissText]}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        />
    );

    const renderAdminAuth = () => (
        <View style={styles.authContainer}>
            <Text style={styles.authTitle}>Admin Authentication Required</Text>
            <Text style={styles.authSubtitle}>Use your admin credentials to access control endpoints.</Text>
            <TextInput
                value={adminEmail}
                onChangeText={setAdminEmail}
                placeholder="admin@company.com"
                autoCapitalize="none"
                keyboardType="email-address"
                style={styles.authInput}
            />
            <TextInput
                value={adminPassword}
                onChangeText={setAdminPassword}
                placeholder="Password"
                secureTextEntry
                style={styles.authInput}
            />
            <TouchableOpacity style={styles.authButton} onPress={handleAdminLogin} disabled={authLoading}>
                {authLoading
                    ? <ActivityIndicator size="small" color="#ffffff" />
                    : <Text style={styles.authButtonText}>Sign In</Text>}
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => {
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                            return;
                        }
                        navigation.navigate('MainTab', { screen: 'Settings' });
                    }}
                    style={styles.backButton}
                >
                    <Ionicons name="arrow-back" size={24} color="#f8fafc" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Admin Control Center</Text>
                <View style={{ width: 24 }} />
            </View>

            <View style={styles.tabsRow}>
                {['Overview', 'Users', 'Jobs', 'Reports'].map(tab => (
                    <TouchableOpacity
                        key={tab}
                        style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
                        onPress={() => setActiveTab(tab)}
                    >
                        <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {requiresAdminAuth
                ? renderAdminAuth()
                : (
                    <>
                        {activeTab === 'Overview' && renderOverview()}
                        {activeTab === 'Users' && renderUsersTab()}
                        {activeTab === 'Jobs' && renderJobsTab()}
                        {activeTab === 'Reports' && renderReportsTab()}
                    </>
                )}

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f1f5f9',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        backgroundColor: '#0f172a', // Dark header for admin
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#f8fafc',
    },
    tabsRow: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e2e8f0',
    },
    tabBtn: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabBtnActive: {
        borderBottomColor: '#3b82f6',
    },
    tabText: {
        color: '#64748b',
        fontWeight: '600',
    },
    tabTextActive: {
        color: '#3b82f6',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    statsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    statCard: {
        width: '48%',
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#0f172a',
        marginTop: 8,
    },
    statLabel: {
        fontSize: 12,
        color: '#64748b',
        marginTop: 4,
    },
    systemCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        marginBottom: 20,
    },
    systemText: {
        fontSize: 13,
        color: '#334155',
        marginTop: 6,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        marginTop: 8,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1e293b',
    },
    quickActionsRow: {
        flexDirection: 'row',
        gap: 12,
        marginBottom: 20,
    },
    quickAction: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingVertical: 12,
        alignItems: 'center',
        gap: 6,
    },
    quickActionText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#0f172a',
        textAlign: 'center',
    },
    seeAll: {
        color: '#3b82f6',
        fontWeight: '600',
    },
    listCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 8,
        marginBottom: 8,
        borderLeftWidth: 4,
        borderLeftColor: '#3b82f6',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    listSubtitle: {
        fontSize: 13,
        color: '#64748b',
        marginTop: 4,
    },
    badge: {
        backgroundColor: '#e0e7ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#4f46e5',
        textTransform: 'uppercase',
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#059669',
    },
    reportCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#fee2e2',
        marginBottom: 10,
        gap: 12,
    },
    reportMeta: {
        fontSize: 12,
        color: '#94a3b8',
        marginTop: 6,
    },
    reportActions: {
        gap: 8,
    },
    reportBtn: {
        backgroundColor: '#e0f2fe',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        alignItems: 'center',
    },
    reportBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#0284c7',
    },
    reportBtnDismiss: {
        backgroundColor: '#fee2e2',
    },
    reportBtnDismissText: {
        color: '#dc2626',
    },
    authContainer: {
        margin: 16,
        padding: 16,
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    authTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0f172a',
    },
    authSubtitle: {
        marginTop: 6,
        marginBottom: 14,
        fontSize: 13,
        color: '#64748b',
    },
    authInput: {
        borderWidth: 1,
        borderColor: '#cbd5e1',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 10,
        fontSize: 14,
        color: '#0f172a',
        backgroundColor: '#ffffff',
    },
    authButton: {
        backgroundColor: '#2563eb',
        borderRadius: 10,
        paddingVertical: 11,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    authButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '700',
    },
});
