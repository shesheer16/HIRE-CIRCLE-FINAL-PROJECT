import React, { useState, useEffect, memo, useCallback } from 'react';
import {
    View, Text, FlatList, StyleSheet, TouchableOpacity,
    ScrollView, Share
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import client from '../api/client';
import { ActivityIndicator } from 'react-native';
import { AnimatedCard } from '../components/AnimatedCard';
import { useRefreshOnFocus } from '../hooks/useRefreshOnFocus';
import SkeletonLoader from '../components/SkeletonLoader';
import { IconBookmark, IconBookmarkFilled, IconShare } from '../components/Icons';

const FILTERS = ['All', 'Saved', 'High Match', 'Nearby', 'New'];

export default function JobsScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const [activeFilter, setActiveFilter] = useState('All');
    const [userRole, setUserRole] = useState('candidate');
    const [jobs, setJobs] = useState([]);
    const [savedJobIds, setSavedJobIds] = useState(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');

    useRefreshOnFocus(fetchJobs, 'jobs');

    useEffect(() => {
        SecureStore.getItemAsync('userInfo').then(res => {
            if (res) {
                const user = JSON.parse(res);
                setUserRole(user.role ? user.role.toLowerCase() : 'candidate');
            }
        });
        fetchJobs();
    }, []);

    const fetchJobs = async () => {
        setIsLoading(true);
        setErrorMsg('');
        try {
            // 1. Try to load cached jobs first
            try {
                const cachedJobs = await AsyncStorage.getItem('@cached_jobs');
                if (cachedJobs !== null) {
                    setJobs(JSON.parse(cachedJobs));
                }
            } catch (e) {
                console.error('Error loading cached jobs', e);
            }

            // 2. Fetch fresh jobs
            const { data } = await client.get('/api/matches/candidate');

            const formattedJobs = data.map(item => {
                const job = item.job || item; // Compatibility based on API shape
                return {
                    _id: job._id || Math.random().toString(),
                    title: job.title || 'Untitled Job',
                    companyName: job.companyName || 'Employer',
                    location: job.location || 'Remote',
                    salaryRange: job.salaryRange || 'Unspecified',
                    matchScore: item.matchScore || Math.floor(Math.random() * 20) + 60, // Fallback
                    postedTime: job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'Just now',
                    requirements: job.requirements || ['Requirements not specified'],
                    fitReason: item.whyYouFit || ''
                };
            });

            setJobs(formattedJobs);

            // 3. Update Cache
            try {
                await AsyncStorage.setItem('@cached_jobs', JSON.stringify(formattedJobs));
            } catch (e) {
                console.error('Error saving cached jobs', e);
            }

        } catch (error) {
            console.error('Failed to fetch matched jobs:', error);
            // If offline and have cache, don't show error to disrupt UX
            if (jobs.length === 0) {
                setErrorMsg('Failed to fetch jobs. Please try again later.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const filteredJobs = jobs.filter(job => {
        if (activeFilter === 'Saved') return savedJobIds.has(job._id);
        if (activeFilter === 'High Match') return job.matchScore > 80;
        if (activeFilter === 'Nearby') return !job.location.toLowerCase().includes('remote');
        if (activeFilter === 'New') return job.postedTime.includes('h');
        return true;
    });

    const toggleSaveJob = useCallback((id) => {
        setSavedJobIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleShareJob = async (job) => {
        try {
            await Share.share({
                message: `${job.title} at ${job.companyName} — ${job.location}\nSalary: ${job.salaryRange}\n\nApply on HireApp`,
                title: job.title,
            });
        } catch (error) {
            console.error('Error sharing job:', error);
        }
    };

    const JobCard = memo(({ item, onPress }) => (
        <AnimatedCard
            style={styles.card}
            onPress={() => onPress(item)}
        >
            <View style={styles.actionButtonsContainerAbsolute}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleShareJob(item)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                    <IconShare size={20} color="#94a3b8" />
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => toggleSaveJob(item._id)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                    {savedJobIds.has(item._id) ? (
                        <IconBookmarkFilled size={20} color="#9333ea" />
                    ) : (
                        <IconBookmark size={20} color="#94a3b8" />
                    )}
                </TouchableOpacity>
            </View>

            {userRole !== 'employer' && item.matchScore > 80 && (
                <View style={styles.matchBadgeAbsolute}>
                    <Text style={styles.matchBadgeTextAbsolute}>{item.matchScore}% MATCH</Text>
                </View>
            )}

            <View style={styles.cardHeader}>
                <Text style={styles.jobTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.companyName}>{item.companyName}</Text>
            </View>

            <View style={styles.tagsContainer}>
                {item.requirements.slice(0, 3).map((req, i) => (
                    <View key={i} style={styles.skillTag}>
                        <Text style={styles.skillTagText}>{req}</Text>
                    </View>
                ))}
            </View>

            <View style={styles.cardFooter}>
                <Text style={styles.locationText}>📍 {item.location}</Text>
                <Text style={styles.salaryText}>{item.salaryRange}</Text>
            </View>

            <Text style={styles.postedTimeText}>Posted {item.postedTime}</Text>
        </AnimatedCard>
    ));

    const handleJobPress = useCallback((item) => {
        navigation.navigate('JobDetails', {
            job: item,
            matchScore: item.matchScore,
            fitReason: `Your skills closely match the requirements for ${item.title}. You have strong expertise in ${item.requirements[0]} and ${item.requirements[1] || 'related areas'}.`
        });
    }, [navigation]);

    const renderJobCard = ({ item }) => (
        <JobCard item={item} onPress={handleJobPress} />
    );

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header matches React JS exactly */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>
                    {userRole === 'employer' ? 'Your Job Postings' : 'Jobs for You'}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersRow} contentContainerStyle={{ paddingRight: 16 }}>
                    {FILTERS.map(filter => (
                        <TouchableOpacity
                            key={filter}
                            style={[
                                styles.filterChip,
                                activeFilter === filter && styles.filterChipActive
                            ]}
                            onPress={() => setActiveFilter(filter)}
                            activeOpacity={0.8}
                        >
                            <Text style={[
                                styles.filterChipText,
                                activeFilter === filter && styles.filterChipTextActive
                            ]}>
                                {filter}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Jobs List */}
            {isLoading && jobs.length === 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                    <SkeletonLoader height={140} style={{ borderRadius: 12, marginBottom: 16 }} />
                </View>
            )}
            {errorMsg ? <Text style={{ color: 'red', margin: 16 }}>{errorMsg}</Text> : null}

            <FlatList
                data={filteredJobs}
                keyExtractor={(item) => item._id}
                renderItem={renderJobCard}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                getItemLayout={(data, index) => ({
                    length: 160,
                    offset: 160 * index,
                    index,
                })}
                maxToRenderPerBatch={5}
                windowSize={5}
                removeClippedSubviews={true}
                initialNumToRender={10}
                ListEmptyComponent={
                    <EmptyState
                        icon={<Text style={styles.emptyEmoji}>🔍</Text>}
                        title={activeFilter === 'Saved' ? "No Saved Jobs" : "No Jobs Found"}
                        message={activeFilter === 'Saved' ? "Tap the bookmark icon on any job to save it for later." : "Try adjusting your search or filter."}
                        actionLabel={activeFilter !== 'All' ? "Clear Filters" : null}
                        onAction={activeFilter !== 'All' ? () => setActiveFilter('All') : null}
                    />
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc', // slate-50
    },
    header: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        zIndex: 10,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1e293b', // slate-800
        marginBottom: 12,
    },
    filtersRow: {
        flexDirection: 'row',
    },
    filterChip: {
        backgroundColor: '#f1f5f9', // slate-100
        borderRadius: 9999, // rounded-full
        paddingHorizontal: 16,
        paddingVertical: 6,
        marginRight: 8,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    filterChipActive: {
        backgroundColor: '#faf5ff', // purple-50
        borderColor: '#e9d5ff', // purple-200
    },
    filterChipText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#475569', // slate-600
    },
    filterChipTextActive: {
        color: '#7e22ce', // purple-700
    },
    listContent: {
        padding: 16,
        paddingBottom: 32,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 12, // rounded-xl
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#f1f5f9', // slate-100
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        position: 'relative',
        overflow: 'hidden',
    },
    matchBadgeAbsolute: {
        position: 'absolute',
        top: 0,
        right: 0,
        backgroundColor: '#fae8ff', // fuchsia-100 or purple-100 matching text-purple-800
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderBottomLeftRadius: 8, // rounded-bl-lg
    },
    matchBadgeTextAbsolute: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#6b21a8', // purple-800
    },
    actionButtonsContainerAbsolute: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
        flexDirection: 'row',
        gap: 8,
    },
    actionButton: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 4,
    },
    cardHeader: {
        marginBottom: 8,
        paddingRight: 64, // make room for bookmark and share
    },
    jobTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1e293b', // slate-800
    },
    companyName: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748b', // slate-500
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginVertical: 12,
    },
    skillTag: {
        backgroundColor: '#f1f5f9', // slate-100
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6, // rounded-md
    },
    skillTagText: {
        fontSize: 12,
        color: '#475569', // slate-600
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f8fafc', // slate-50
        paddingTop: 12,
        marginTop: 4,
    },
    locationText: {
        fontSize: 14,
        color: '#64748b', // slate-500
    },
    salaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155', // slate-700
    },
    postedTimeText: {
        fontSize: 12,
        color: '#94a3b8', // slate-400
        textAlign: 'right',
        marginTop: 8,
    },
    emptyState: {
        alignItems: 'center',
        paddingTop: 80,
    },
    emptyEmoji: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 6,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#64748b',
    },
});
