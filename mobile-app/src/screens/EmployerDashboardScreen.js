import React, { useCallback, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Image,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { logger } from '../utils/logger';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import client from '../api/client';
import NudgeToast from '../components/NudgeToast';

export default function EmployerDashboardScreen({ navigation }) {
    const [jobs, setJobs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [selectedJob, setSelectedJob] = useState(null);
    const [activeFilter, setActiveFilter] = useState('All');
    const [showResponseReminder, setShowResponseReminder] = useState(false);
    const [toastVisible, setToastVisible] = useState(false);
    const insets = useSafeAreaInsets();

    React.useEffect(() => {
        fetchMyJobs();
    }, []);

    React.useEffect(() => {
        navigation.setParams({ hideFab: Boolean(selectedJob) });
    }, [navigation, selectedJob]);

    const fetchMyJobs = async () => {
        setIsLoading(true);
        setErrorMsg('');
        try {
            const { data } = await client.get('/api/jobs/my-jobs');

            const jobsArray = Array.isArray(data) ? data : (data.data || []);

            const formattedJobs = jobsArray.map(j => ({
                id: j._id,
                title: j.title,
                company: j.companyName || 'Your Company',
                location: j.location,
                salary: j.salaryRange,
                type: j.shift || 'Full-time',
                postedAt: new Date(j.createdAt).toLocaleDateString(),
                description: j.requirements ? j.requirements.join(', ') : 'No description provided.',
                skills: j.requirements || [],
                applicantCount: Number(j.applicantCount || 0),
                shortlistedCount: Number(j.shortlistedCount || j.stats?.shortlisted || 0),
                hiredCount: Number(j.hiredCount || j.stats?.hired || 0),
                status: String(j.status || 'open'),
            }));
            setJobs(formattedJobs);
            const shouldRemind = jobsArray.some((job) => Number(job?.applicantCount || 0) > 0);
            setShowResponseReminder(shouldRemind);
            if (shouldRemind) {
                setToastVisible(true);
            }
        } catch (error) {
            logger.error('Failed to load jobs:', error);
            setErrorMsg('Failed to load jobs. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const openAnalytics = useCallback(() => {
        const parentNav = navigation?.getParent?.();
        if (parentNav?.navigate) {
            parentNav.navigate('EmployerAnalytics');
            return;
        }
        navigation.navigate('EmployerAnalytics');
    }, [navigation]);

    const handleViewApplicants = useCallback(() => {
        if (!selectedJob?.id) return;
        setSelectedJob(null);
        navigation.navigate('Talent', { jobId: selectedJob.id });
    }, [navigation, selectedJob]);

    const [isEditModalVisible, setIsEditModalVisible] = useState(false);
    const [editForm, setEditForm] = useState({
        title: '',
        company: '',
        location: '',
        salary: '',
        description: '',
        requirements: ''
    });

    const openEditModal = () => {
        setEditForm({
            title: selectedJob.title,
            company: selectedJob.company,
            location: selectedJob.location,
            salary: selectedJob.salary,
            description: selectedJob.description,
            requirements: selectedJob.skills.join(', ')
        });
        setIsEditModalVisible(true);
    };

    const handleSaveEdit = () => {
        const updatedJobs = jobs.map(j => {
            if (j.id === selectedJob.id) {
                return {
                    ...j,
                    title: editForm.title,
                    company: editForm.company,
                    location: editForm.location,
                    salary: editForm.salary,
                    description: editForm.description,
                    skills: editForm.requirements.split(',').map(s => s.trim()).filter(s => s)
                };
            }
            return j;
        });
        setJobs(updatedJobs);
        setSelectedJob(updatedJobs.find(j => j.id === selectedJob.id));
        setIsEditModalVisible(false);
    };

    const handleDuplicateJob = useCallback((jobToDuplicate) => {
        if (!jobToDuplicate) return;
        const duplicated = {
            ...jobToDuplicate,
            id: `${jobToDuplicate.id}-dup-${Date.now()}`,
            title: `${jobToDuplicate.title} (Copy)`,
            postedAt: new Date().toLocaleDateString(),
            applicantCount: 0,
            shortlistedCount: 0,
            hiredCount: 0,
            status: 'draft',
        };
        setJobs((prev) => [duplicated, ...prev]);
        setToastVisible(true);
    }, []);

    if (selectedJob) {
        return (
            <View style={styles.container}>
                <View style={styles.bannerContainer}>
                    <Image
                        source={{ uri: 'https://source.unsplash.com/random/800x400/?office,work' }}
                        style={styles.bannerImage}
                    />
                    <View style={styles.bannerOverlay} />
                    <TouchableOpacity
                        style={[styles.backButton, { top: insets.top + 16 }]}
                        onPress={() => setSelectedJob(null)}
                    >
                        <Ionicons name="arrow-back" size={24} color="#FFF" />
                    </TouchableOpacity>
                </View>

                <View style={styles.contentCard}>
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                        <View style={styles.detailHeader}>
                            <View>
                                <Text style={styles.detailTitle}>{selectedJob.title}</Text>
                                <Text style={styles.detailCompany}>{selectedJob.company}</Text>
                            </View>
                        </View>

                        <View style={styles.statsRow}>
                            <View style={styles.statBox}>
                                <Text style={styles.statLabel}>SALARY</Text>
                                <Text style={styles.statValue}>{selectedJob.salary}</Text>
                            </View>
                            <View style={styles.statBox}>
                                <Text style={styles.statLabel}>TYPE</Text>
                                <Text style={styles.statValue}>{selectedJob.type}</Text>
                            </View>
                        </View>

                        <View style={styles.pipelineRow}>
                            <View style={styles.pipelineCard}>
                                <Text style={styles.pipelineValue}>{selectedJob.applicantCount || 0}</Text>
                                <Text style={styles.pipelineLabel}>Applicants</Text>
                            </View>
                            <View style={styles.pipelineCard}>
                                <Text style={styles.pipelineValue}>{selectedJob.shortlistedCount || 0}</Text>
                                <Text style={styles.pipelineLabel}>Shortlisted</Text>
                            </View>
                            <View style={styles.pipelineCard}>
                                <Text style={styles.pipelineValue}>{selectedJob.hiredCount || 0}</Text>
                                <Text style={styles.pipelineLabel}>Hired</Text>
                            </View>
                        </View>

                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Description</Text>
                            <Text style={styles.descriptionText}>{selectedJob.description}</Text>
                        </View>

                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Requirements</Text>
                            <View style={styles.tagsContainer}>
                                {selectedJob.skills.map(skill => (
                                    <View key={skill} style={styles.requirementTag}>
                                        <Text style={styles.requirementTagText}>{skill}</Text>
                                    </View>
                                ))}
                            </View>
                        </View>

                    </ScrollView>

                    <View style={[styles.bottomActionContainer, { paddingBottom: insets.bottom || 16 }]}>
                        <TouchableOpacity style={styles.viewApplicantsButton} onPress={handleViewApplicants}>
                            <Text style={styles.viewApplicantsButtonText}>View Applicants</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.editButton} onPress={openEditModal}>
                            <Text style={styles.editButtonText}>Edit Job Posting</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.duplicateButton} onPress={() => handleDuplicateJob(selectedJob)}>
                            <Text style={styles.duplicateButtonText}>Duplicate Job</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Edit Modal (Preserving Employer Functionality) */}
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
                                <Text style={styles.modalTitleText}>Edit Job</Text>
                                <TouchableOpacity onPress={() => setIsEditModalVisible(false)}>
                                    <Ionicons name="close" size={24} color="#6B7280" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView showsVerticalScrollIndicator={false}>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Job Title</Text>
                                    <TextInput style={styles.input} value={editForm.title} onChangeText={t => setEditForm({ ...editForm, title: t })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Company/Shop Name</Text>
                                    <TextInput style={styles.input} value={editForm.company} onChangeText={t => setEditForm({ ...editForm, company: t })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Location</Text>
                                    <TextInput style={styles.input} value={editForm.location} onChangeText={t => setEditForm({ ...editForm, location: t })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Salary</Text>
                                    <TextInput style={styles.input} value={editForm.salary} onChangeText={t => setEditForm({ ...editForm, salary: t })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Description</Text>
                                    <TextInput style={[styles.input, styles.textArea]} value={editForm.description} multiline onChangeText={t => setEditForm({ ...editForm, description: t })} />
                                </View>
                                <View style={styles.inputGroup}>
                                    <Text style={styles.label}>Requirements (Comma separated)</Text>
                                    <TextInput style={[styles.input, styles.textArea]} value={editForm.requirements} multiline onChangeText={t => setEditForm({ ...editForm, requirements: t })} />
                                </View>
                                <TouchableOpacity style={styles.saveButton} onPress={handleSaveEdit}>
                                    <Text style={styles.saveButtonText}>Save Changes</Text>
                                </TouchableOpacity>
                            </ScrollView>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.headerTitle}>Your Job Postings</Text>
                    <View style={styles.headerActions}>
                        <TouchableOpacity
                            style={styles.iconActionBtn}
                            onPress={openAnalytics}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="bar-chart-outline" size={18} color="#7c3aed" />
                        </TouchableOpacity>
                    </View>
                </View>

                {isLoading && <Text style={{ color: '#64748b', marginTop: 8 }}>Loading jobs...</Text>}
                {errorMsg ? <Text style={{ color: 'red', marginTop: 8 }}>{errorMsg}</Text> : null}
                {showResponseReminder ? (
                    <View style={styles.responseReminder}>
                        <Text style={styles.responseReminderText}>Respond faster to improve hire rate and candidate trust.</Text>
                    </View>
                ) : null}

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.filtersContainer}
                    contentContainerStyle={styles.filtersContent}
                >
                    {['All', 'High Match', 'Nearby', 'New'].map(filter => (
                        <TouchableOpacity
                            key={filter}
                            style={[styles.filterButton, activeFilter === filter && styles.filterButtonActive]}
                            onPress={() => setActiveFilter(filter)}
                        >
                            <Text style={[styles.filterText, activeFilter === filter && styles.filterTextActive]}>{filter}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {jobs.map((job) => (
                    <TouchableOpacity
                        key={job.id}
                        style={styles.jobCard}
                        onPress={() => setSelectedJob(job)}
                        activeOpacity={0.9}
                    >
                        <View style={styles.jobCardHeaderRow}>
                            <View>
                                <Text style={styles.jobCardTitle}>{job.title}</Text>
                                <Text style={styles.jobCardCompany}>{job.company}</Text>
                            </View>
                        </View>

                        <View style={styles.cardTagsRow}>
                            {job.skills.slice(0, 3).map(skill => (
                                <View key={skill} style={styles.cardTag}>
                                    <Text style={styles.cardTagText}>{skill}</Text>
                                </View>
                            ))}
                        </View>

                        <View style={styles.cardFooter}>
                            <View style={styles.locationWrapper}>
                                <Text style={styles.cardFooterText}>📍 {job.location}</Text>
                            </View>
                            <Text style={styles.cardSalary}>{job.salary}</Text>
                        </View>

                        <View style={styles.pipelineBadgeRow}>
                            <View style={styles.pipelineBadge}>
                                <Text style={styles.pipelineBadgeText}>{job.applicantCount || 0} applicants</Text>
                            </View>
                            <View style={styles.pipelineBadge}>
                                <Text style={styles.pipelineBadgeText}>{job.shortlistedCount || 0} shortlisted</Text>
                            </View>
                            <View style={styles.pipelineBadge}>
                                <Text style={styles.pipelineBadgeText}>{job.hiredCount || 0} hired</Text>
                            </View>
                        </View>

                        <Text style={styles.postedAtText}>Posted {job.postedAt}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            <NudgeToast
                visible={toastVisible}
                text="Respond faster to improve hire rate."
                actionLabel="Review"
                onAction={() => {
                    setToastVisible(false);
                    setActiveFilter('High Match');
                }}
                onDismiss={() => setToastVisible(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        backgroundColor: '#fff',
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
        color: '#1e293b',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    responseReminder: {
        marginTop: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#fde68a',
        backgroundColor: '#fffbeb',
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    responseReminderText: {
        color: '#854d0e',
        fontSize: 12,
        fontWeight: '600',
    },
    iconActionBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: '#e9d5ff',
        backgroundColor: '#faf5ff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    filtersContainer: {
        marginTop: 12,
    },
    filtersContent: {
        gap: 8,
        paddingBottom: 4,
    },
    filterButton: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 20,
        backgroundColor: '#f1f5f9',
        borderWidth: 1,
        borderColor: 'transparent',
    },
    filterButtonActive: {
        backgroundColor: '#faf5ff',
        borderColor: '#e9d5ff',
    },
    filterText: {
        color: '#475569',
        fontSize: 14,
        fontWeight: '500',
    },
    filterTextActive: {
        color: '#7c3aed',
    },
    listContent: {
        padding: 16,
        gap: 16,
    },
    jobCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    jobCardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    jobCardTitle: {
        fontWeight: 'bold',
        fontSize: 18,
        color: '#1e293b',
    },
    jobCardCompany: {
        color: '#64748b',
        fontSize: 14,
        fontWeight: '500',
        marginTop: 2,
    },
    cardTagsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginVertical: 12,
    },
    cardTag: {
        backgroundColor: '#f1f5f9',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    cardTagText: {
        color: '#475569',
        fontSize: 12,
    },
    cardFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#f8fafc',
        paddingTop: 12,
        marginTop: 4,
    },
    locationWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cardFooterText: {
        fontSize: 14,
        color: '#64748b',
    },
    cardSalary: {
        fontSize: 14,
        fontWeight: '600',
        color: '#334155',
    },
    pipelineBadgeRow: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pipelineBadge: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    pipelineBadgeText: {
        color: '#334155',
        fontSize: 10,
        fontWeight: '700',
    },
    postedAtText: {
        fontSize: 12,
        color: '#94a3b8',
        textAlign: 'right',
        marginTop: 8,
    },

    // Detail View Styles
    bannerContainer: {
        height: 160,
        backgroundColor: '#1e293b',
        position: 'relative',
    },
    bannerImage: {
        width: '100%',
        height: '100%',
        opacity: 0.5,
    },
    bannerOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.2)',
    },
    backButton: {
        position: 'absolute',
        left: 16,
        backgroundColor: 'rgba(0,0,0,0.3)',
        padding: 8,
        borderRadius: 20,
        zIndex: 10,
    },
    contentCard: {
        flex: 1,
        backgroundColor: '#fff',
        marginTop: -24,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    scrollContent: {
        padding: 20,
        paddingBottom: 20,
    },
    detailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 24,
    },
    detailTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#0f172a',
    },
    detailCompany: {
        fontSize: 16,
        fontWeight: '500',
        color: '#9333ea',
        marginTop: 4,
    },
    statsRow: {
        flexDirection: 'row',
        gap: 16,
        marginBottom: 24,
    },
    pipelineRow: {
        flexDirection: 'row',
        gap: 10,
        marginBottom: 20,
    },
    pipelineCard: {
        flex: 1,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#ede9fe',
        backgroundColor: '#faf5ff',
        paddingVertical: 10,
        alignItems: 'center',
    },
    pipelineValue: {
        color: '#6d28d9',
        fontSize: 16,
        fontWeight: '900',
    },
    pipelineLabel: {
        marginTop: 2,
        color: '#7c3aed',
        fontSize: 10,
        fontWeight: '700',
    },
    statBox: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderRadius: 8,
        padding: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#f1f5f9',
    },
    statLabel: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#94a3b8',
        marginBottom: 4,
    },
    statValue: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1e293b',
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#0f172a',
        marginBottom: 8,
    },
    descriptionText: {
        fontSize: 14,
        color: '#475569',
        lineHeight: 22,
    },
    tagsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    requirementTag: {
        backgroundColor: '#faf5ff',
        borderWidth: 1,
        borderColor: '#f3e8ff',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
    },
    requirementTagText: {
        color: '#7c3aed',
        fontSize: 12,
        fontWeight: '500',
    },
    bottomActionContainer: {
        padding: 16,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#f1f5f9',
        gap: 10,
    },
    viewApplicantsButton: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d8b4fe',
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
    },
    viewApplicantsButtonText: {
        color: '#7c3aed',
        fontSize: 15,
        fontWeight: '700',
    },
    editButton: {
        backgroundColor: '#0f172a',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    editButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    duplicateButton: {
        backgroundColor: '#eef2ff',
        borderWidth: 1,
        borderColor: '#c7d2fe',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    duplicateButtonText: {
        color: '#3730a3',
        fontSize: 14,
        fontWeight: '700',
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
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitleText: {
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
        backgroundColor: '#7c3aed',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 40,
    },
});
