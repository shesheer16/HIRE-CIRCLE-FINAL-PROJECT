import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';
import * as SecureStore from 'expo-secure-store';
import { logger } from '../utils/logger';
import SkeletonLoader from '../components/SkeletonLoader';

const FUNNEL_KEYS = [
    { key: 'applied', label: 'Applied' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'interviewed', label: 'Interview' },
    { key: 'hired', label: 'Hired' },
];

const clamp = (value, min = 0, max = 1) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.max(min, Math.min(max, numeric));
};

export default function EmployerAnalyticsScreen({ navigation }) {
    useContext(AuthContext);
    const [loading, setLoading] = useState(true);
    const [funnelData, setFunnelData] = useState(null);
    const [performanceData, setPerformanceData] = useState([]);
    const [fillRateMetrics, setFillRateMetrics] = useState(null);

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const handleBack = () => {
        if (navigation.canGoBack()) {
            navigation.goBack();
            return;
        }
        navigation.navigate('MainTab');
    };

    const fetchAnalytics = async () => {
        try {
            setLoading(true);
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            const userInfoStrParsed = JSON.parse(userInfoStr || '{}');
            const employerId = userInfoStrParsed._id;

            if (!employerId) {
                setFunnelData({});
                setPerformanceData([]);
                return;
            }

            const [funnelRes, perfRes, fillRateRes] = await Promise.all([
                client.get(`/api/analytics/employer/${employerId}/hiring-funnel`),
                client.get(`/api/analytics/employer/${employerId}/job-performance`),
                client.get(`/api/analytics/employer/${employerId}/fill-rate-meter`).catch(() => ({ data: null })),
            ]);

            const safeFunnel = funnelRes?.data && typeof funnelRes.data === 'object' ? funnelRes.data : {};
            const perfPayload = perfRes?.data;
            const safePerformance = Array.isArray(perfPayload)
                ? perfPayload
                : (Array.isArray(perfPayload?.data) ? perfPayload.data : (Array.isArray(perfPayload?.jobs) ? perfPayload.jobs : []));

            setFunnelData(safeFunnel);
            setPerformanceData(safePerformance);
            setFillRateMetrics(fillRateRes?.data?.metrics || null);

        } catch (error) {
            logger.error('Failed to fetch analytics', error);
            setFunnelData({});
            setPerformanceData([]);
            setFillRateMetrics(null);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <View style={styles.loadingCard}>
                    <SkeletonLoader height={18} style={{ borderRadius: 8, width: '46%', marginBottom: 10 }} />
                    <SkeletonLoader height={12} style={{ borderRadius: 8, width: '32%', marginBottom: 18 }} />
                    <SkeletonLoader height={120} style={{ borderRadius: 12, width: '100%', marginBottom: 14 }} />
                    <SkeletonLoader height={80} style={{ borderRadius: 12, width: '100%' }} />
                </View>
            </View>
        );
    }

    const funnelCounts = FUNNEL_KEYS.map((step) => ({
        ...step,
        value: Number(funnelData?.funnel?.[step.key] || 0),
    }));
    const maxFunnelValue = Math.max(...funnelCounts.map((step) => step.value), 1);
    const appliedCount = Number(funnelData?.funnel?.applied || 0);
    const hiredCount = Number(funnelData?.funnel?.hired || 0);
    const acceptanceRate = appliedCount > 0 ? Math.round((hiredCount / appliedCount) * 100) : 0;
    const acceptanceProgress = clamp(acceptanceRate / 100);

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#0f172a" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Analytics Dashboard</Text>
                <View style={{ width: 24 }} />
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.fillRateCard}>
                    <View style={styles.fillRateHeader}>
                        <Text style={styles.fillRateTitle}>Fill Rate Meter</Text>
                        <Text style={styles.fillRateSubtitle}>Snapshot</Text>
                    </View>
                    <View style={styles.fillRateRow}>
                        <View style={styles.fillRateItem}>
                            <Text style={styles.fillRateLabel}>Applications</Text>
                            <Text style={styles.fillRateValue}>{fillRateMetrics?.applicationsCount ?? '--'}</Text>
                        </View>
                        <View style={styles.fillRateItem}>
                            <Text style={styles.fillRateLabel}>Shortlist</Text>
                            <Text style={styles.fillRateValue}>
                                {fillRateMetrics ? `${Math.round((fillRateMetrics.shortlistRate || 0) * 100)}%` : '--'}
                            </Text>
                        </View>
                        <View style={styles.fillRateItem}>
                            <Text style={styles.fillRateLabel}>ETA</Text>
                            <Text style={styles.fillRateValue}>
                                {fillRateMetrics?.estimatedTimeToFillDays != null ? `${fillRateMetrics.estimatedTimeToFillDays}d` : '--'}
                            </Text>
                        </View>
                        <View style={styles.fillRateItem}>
                            <Text style={styles.fillRateLabel}>City Avg</Text>
                            <Text style={styles.fillRateValue}>
                                {fillRateMetrics ? `${Math.round((fillRateMetrics.cityAverageFillRate || 0) * 100)}%` : '--'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Aggregate Stats */}
                <View style={styles.statsRow}>
                    <View style={styles.statCard}>
                        <Text style={styles.statLabel}>Total Jobs</Text>
                        <Text style={styles.statValue}>{funnelData?.totalJobs || 0}</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statLabel}>Total Apps</Text>
                        <Text style={styles.statValue}>{funnelData?.totalApplications || 0}</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statLabel}>Acceptance</Text>
                        <Text style={styles.statValue}>{acceptanceRate}%</Text>
                    </View>
                </View>

                {/* Acceptance + Funnel visuals */}
                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Acceptance Rate</Text>
                    <View style={styles.acceptanceTrack}>
                        <View style={[styles.acceptanceFill, { width: `${acceptanceProgress * 100}%` }]} />
                    </View>
                    <Text style={styles.acceptanceCaption}>{hiredCount} hires from {appliedCount} applications</Text>
                </View>

                <View style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>Hiring Funnel</Text>
                    <View style={styles.funnelWrap}>
                        {funnelCounts.map((step) => {
                            const heightPct = Math.max(0.08, step.value / maxFunnelValue);
                            return (
                                <View key={step.key} style={styles.funnelBarCol}>
                                    <View style={styles.funnelBarTrack}>
                                        <View style={[styles.funnelBarFill, { height: `${heightPct * 100}%` }]} />
                                    </View>
                                    <Text style={styles.funnelCount}>{step.value}</Text>
                                    <Text style={styles.funnelLabel}>{step.label}</Text>
                                </View>
                            );
                        })}
                    </View>
                </View>

                {/* Performance by Job */}
                <Text style={[styles.sectionTitle, { marginLeft: 4, marginBottom: 12, marginTop: 8 }]}>Job Performance</Text>
                {performanceData.map((job, index) => (
                    <View key={String(job?.jobId || job?._id || index)} style={styles.jobPerfCard}>
                        <View style={styles.jobPerfHeader}>
                            <Text style={styles.jobPerfTitle}>{job?.title || 'Untitled Job'}</Text>
                            <View style={[styles.statusBadge, { backgroundColor: job?.status === 'Active' ? '#dcfce7' : '#f1f5f9' }]}>
                                <Text style={[styles.statusText, { color: job?.status === 'Active' ? '#166534' : '#475569' }]}>{job?.status || 'Unknown'}</Text>
                            </View>
                        </View>

                        <View style={styles.perfMetricsRow}>
                            <View style={styles.perfMetric}>
                                <Text style={styles.perfMetricVal}>{job?.views ?? 0}</Text>
                                <Text style={styles.perfMetricLbl}>Views</Text>
                            </View>
                            <View style={styles.perfMetric}>
                                <Text style={styles.perfMetricVal}>{job?.applications ?? 0}</Text>
                                <Text style={styles.perfMetricLbl}>Apps</Text>
                            </View>
                            <View style={styles.perfMetric}>
                                <Text style={styles.perfMetricVal}>{job?.avgMatchScore ?? 0}%</Text>
                                <Text style={styles.perfMetricLbl}>Avg Match</Text>
                            </View>
                            <View style={styles.perfMetric}>
                                <Text style={styles.perfMetricVal}>{job?.daysOpen ?? 0}</Text>
                                <Text style={styles.perfMetricLbl}>Days</Text>
                            </View>
                        </View>

                        <View style={styles.sparklineRow}>
                            <View style={[styles.sparklineBar, { width: `${Math.max(8, Math.min(100, Number(job?.views || 0) / 2))}%` }]} />
                            <View style={[styles.sparklineBar, styles.sparklineBarSecondary, { width: `${Math.max(8, Math.min(100, Number(job?.applications || 0) * 5))}%` }]} />
                            <View style={[styles.sparklineBar, styles.sparklineBarAccent, { width: `${Math.max(8, Math.min(100, Number(job?.avgMatchScore || 0)))}%` }]} />
                        </View>
                    </View>
                ))}

                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'stretch',
        backgroundColor: '#f8fafc',
        padding: 16,
    },
    loadingCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 14,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
    },
    backButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    scrollContent: {
        padding: 16,
    },
    fillRateCard: {
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 14,
        marginBottom: 16,
    },
    fillRateHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    fillRateTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0f172a',
    },
    fillRateSubtitle: {
        fontSize: 11,
        fontWeight: '600',
        color: '#64748b',
    },
    fillRateRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    fillRateItem: {
        width: '48%',
        backgroundColor: '#f8fafc',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        padding: 10,
    },
    fillRateLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#64748b',
    },
    fillRateValue: {
        marginTop: 2,
        fontSize: 15,
        fontWeight: '700',
        color: '#111827',
    },
    statsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 20,
    },
    statCard: {
        flex: 1,
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    statLabel: {
        fontSize: 12,
        color: '#64748b',
        fontWeight: '600',
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    statValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#7c3aed',
    },
    sectionCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        marginBottom: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    acceptanceTrack: {
        marginTop: 12,
        width: '100%',
        height: 10,
        borderRadius: 999,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
    },
    acceptanceFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: '#1d4ed8',
    },
    acceptanceCaption: {
        marginTop: 8,
        alignSelf: 'flex-start',
        fontSize: 12,
        color: '#475569',
        fontWeight: '600',
    },
    funnelWrap: {
        width: '100%',
        marginTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 10,
    },
    funnelBarCol: {
        flex: 1,
        alignItems: 'center',
    },
    funnelBarTrack: {
        width: '100%',
        height: 140,
        borderRadius: 10,
        backgroundColor: '#f1f5f9',
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    funnelBarFill: {
        width: '100%',
        borderRadius: 10,
        backgroundColor: '#6366f1',
    },
    funnelCount: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '800',
        color: '#0f172a',
    },
    funnelLabel: {
        marginTop: 2,
        fontSize: 11,
        fontWeight: '600',
        color: '#64748b',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1e293b',
        alignSelf: 'flex-start',
    },
    jobPerfCard: {
        backgroundColor: '#fff',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    jobPerfHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    jobPerfTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        fontSize: 10,
        fontWeight: 'bold',
    },
    perfMetricsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        backgroundColor: '#f8fafc',
        padding: 12,
        borderRadius: 8,
    },
    sparklineRow: {
        marginTop: 10,
        gap: 6,
    },
    sparklineBar: {
        height: 6,
        borderRadius: 6,
        backgroundColor: '#94a3b8',
    },
    sparklineBarSecondary: {
        backgroundColor: '#3b82f6',
    },
    sparklineBarAccent: {
        backgroundColor: '#7c3aed',
    },
    perfMetric: {
        alignItems: 'center',
    },
    perfMetricVal: {
        fontSize: 16,
        fontWeight: '800',
        color: '#334155',
    },
    perfMetricLbl: {
        fontSize: 10,
        color: '#64748b',
        marginTop: 2,
    }
});
