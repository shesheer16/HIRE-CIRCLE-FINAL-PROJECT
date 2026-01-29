import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator, Alert, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';

export default function EmployerDashboardScreen({ navigation }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Edit Modal State
    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editingJob, setEditingJob] = useState(null);
    const [editForm, setEditForm] = useState({
        title: '',
        companyName: '',
        location: '',
        salaryRange: '',
        requirements: ''
    });

    const fetchJobs = async () => {
        try {
            const { data } = await client.get('/api/jobs/my-jobs');
            setJobs(data.data || []);
        } catch (error) {
            console.error('Error fetching jobs:', error);
            if (error.response?.status === 401 || error.response?.status === 403) {
                // Token invalid, go to login
                // The interceptor clears storage, we just navigate
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Login', params: { selectedRole: 'employer' } }],
                });
                return;
            }
            Alert.alert('Error', 'Failed to load your jobs');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchJobs();
    }, []);

    const handleDelete = (jobId) => {
        Alert.alert(
            "Delete Job",
            "Are you sure you want to delete this job? This action cannot be undone.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            await client.delete(`/api/jobs/${jobId}`);
                            fetchJobs(); // Refresh list immediately
                        } catch (error) {
                            Alert.alert("Error", "Failed to delete job.");
                        }
                    }
                }
            ]
        );
    };

    const openEditModal = (job) => {
        setEditingJob(job);
        setEditForm({
            title: job.title,
            companyName: job.companyName,
            location: job.location,
            salaryRange: job.salaryRange,
            requirements: job.requirements ? job.requirements.join(', ') : ''
        });
        setIsEditModalVisible(true);
    };

    const handleUpdateJob = async () => {
        try {
            const updatedData = {
                title: editForm.title,
                companyName: editForm.companyName,
                location: editForm.location,
                salaryRange: editForm.salaryRange,
                requirements: editForm.requirements.split(',').map(r => r.trim()).filter(r => r.length > 0)
            };

            await client.put(`/api/jobs/${editingJob._id}`, updatedData);
            setIsEditModalVisible(false);
            fetchJobs(); // Refresh immediately
            Alert.alert('Success', 'Job updated successfully!');
        } catch (error) {
            Alert.alert('Error', 'Failed to update job.');
        }
    };

    const renderJobCard = ({ item }) => (
        <View style={styles.jobCard}>
            <View style={styles.jobHeader}>
                <View style={styles.jobTitleContainer}>
                    <Text style={styles.jobTitle}>{item.title}</Text>
                    <View style={[styles.statusBadge, item.isOpen ? styles.openBadge : styles.closedBadge]}>
                        <Text style={styles.statusText}>{item.isOpen ? 'Open' : 'Closed'}</Text>
                    </View>
                </View>
                <Text style={styles.companyName}>{item.companyName}</Text>
            </View>

            <View style={styles.jobDetails}>
                <View style={styles.detailRow}>
                    <Ionicons name="location-outline" size={16} color="#7C3AED" />
                    <Text style={styles.detailText}>{item.location}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Ionicons name="cash-outline" size={16} color="#7C3AED" />
                    <Text style={styles.detailText}>{item.salaryRange}</Text>
                </View>
            </View>

            {item.requirements && item.requirements.length > 0 && (
                <View style={styles.requirementsContainer}>
                    <Text style={styles.requirementsLabel}>Requirements:</Text>
                    <View style={styles.tagsContainer}>
                        {item.requirements.slice(0, 3).map((req, index) => (
                            <View key={index} style={styles.tag}>
                                <Text style={styles.tagText}>{req}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}

            <View style={styles.jobFooter}>
                <Text style={styles.dateText}>
                    Posted {new Date(item.createdAt).toLocaleDateString()}
                </Text>
                <View style={styles.actionButtons}>
                    <TouchableOpacity onPress={() => openEditModal(item)} style={styles.iconButton}>
                        <Ionicons name="pencil" size={20} color="#7C3AED" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(item._id)} style={styles.iconButton}>
                        <Ionicons name="trash" size={20} color="#EF4444" />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );

    const renderEmptyState = () => (
        <View style={styles.emptyState}>
            <Ionicons name="briefcase-outline" size={80} color="#C4B5FD" />
            <Text style={styles.emptyTitle}>No Jobs Posted Yet</Text>
            <Text style={styles.emptySubtitle}>Tap the + button below to create your first job posting</Text>
        </View>
    );

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#7C3AED" />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>My Job Postings</Text>
                    <Text style={styles.headerSubtitle}>{jobs.length} active posting{jobs.length !== 1 ? 's' : ''}</Text>
                </View>
                <TouchableOpacity style={styles.menuButton}>
                    <Ionicons name="settings-outline" size={24} color="#7C3AED" />
                </TouchableOpacity>
            </View>

            {/* Job List */}
            <FlatList
                data={jobs}
                renderItem={renderJobCard}
                keyExtractor={(item) => item._id}
                contentContainerStyle={styles.listContent}
                ListEmptyComponent={renderEmptyState}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#7C3AED"
                        colors={['#7C3AED']}
                    />
                }
            />

            {/* Floating Action Button */}
            <TouchableOpacity
                style={styles.fab}
                onPress={() => navigation.navigate('VideoRecord', { nextScreen: 'PostJob' })}
                activeOpacity={0.8}
            >
                <Ionicons name="add" size={32} color="#fff" />
            </TouchableOpacity>

            {/* Edit Modal */}
            <Modal
                visible={isEditModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setIsEditModalVisible(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={styles.modalOverlay}
                >
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Edit Job</Text>
                            <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Job Title</Text>
                                <TextInput
                                    style={styles.input}
                                    value={editForm.title}
                                    onChangeText={(t) => setEditForm({ ...editForm, title: t })}
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Company/Shop Name</Text>
                                <TextInput
                                    style={styles.input}
                                    value={editForm.companyName}
                                    onChangeText={(t) => setEditForm({ ...editForm, companyName: t })}
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Location</Text>
                                <TextInput
                                    style={styles.input}
                                    value={editForm.location}
                                    onChangeText={(t) => setEditForm({ ...editForm, location: t })}
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Salary Range</Text>
                                <TextInput
                                    style={styles.input}
                                    value={editForm.salaryRange}
                                    onChangeText={(t) => setEditForm({ ...editForm, salaryRange: t })}
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Requirements (Comma separated)</Text>
                                <TextInput
                                    style={[styles.input, styles.textArea]}
                                    value={editForm.requirements}
                                    multiline
                                    onChangeText={(t) => setEditForm({ ...editForm, requirements: t })}
                                />
                            </View>

                            <TouchableOpacity style={styles.saveButton} onPress={handleUpdateJob}>
                                <Text style={styles.saveButtonText}>Save Changes</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F3FF',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        paddingBottom: 16,
        backgroundColor: '#F5F3FF',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#5B21B6',
        marginBottom: 4,
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#7C3AED',
        fontWeight: '500',
    },
    menuButton: {
        padding: 8,
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    jobCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#7C3AED',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#E9D5FF',
    },
    jobHeader: {
        marginBottom: 12,
    },
    jobTitleContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 6,
    },
    jobTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#5B21B6',
        flex: 1,
        marginRight: 8,
    },
    companyName: {
        fontSize: 14,
        color: '#9333EA',
        fontWeight: '500',
    },
    statusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    openBadge: {
        backgroundColor: '#DCFCE7',
    },
    closedBadge: {
        backgroundColor: '#FEE2E2',
    },
    statusText: {
        fontSize: 11,
        fontWeight: 'bold',
        color: '#16A34A',
    },
    jobDetails: {
        gap: 8,
        marginBottom: 12,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    detailText: {
        fontSize: 14,
        color: '#6B7280',
    },
    requirementsContainer: {
        marginTop: 8,
        marginBottom: 12,
    },
    requirementsLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#7C3AED',
        marginBottom: 6,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    tag: {
        backgroundColor: '#EDE9FE',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#DDD6FE',
    },
    tagText: {
        fontSize: 11,
        color: '#7C3AED',
        fontWeight: '500',
    },
    jobFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F3E8FF',
    },
    dateText: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 16,
    },
    iconButton: {
        padding: 4,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
        paddingHorizontal: 40,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#5B21B6',
        marginTop: 20,
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 14,
        color: '#9333EA',
        textAlign: 'center',
        lineHeight: 20,
    },
    fab: {
        position: 'absolute',
        right: 20,
        bottom: 20,
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#7C3AED',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#7C3AED',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        zIndex: 999,
        elevation: 8,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        maxHeight: '80%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 10,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: '#D1D5DB',
        borderRadius: 12,
        padding: 12,
        fontSize: 16,
        backgroundColor: '#fff',
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    saveButton: {
        backgroundColor: '#7C3AED',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 20,
    },
    saveButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
});
