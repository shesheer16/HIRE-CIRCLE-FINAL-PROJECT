import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    TextInput,
    Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconCheck } from '../components/Icons';
import client from '../api/client';

const STAGES = ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Decision'];

const resolveStageIndex = (status) => {
    if (!status) return 0;
    const normalized = String(status).toLowerCase();
    if (normalized === 'offer' || normalized === 'rejected') return STAGES.indexOf('Decision');
    const found = STAGES.findIndex(s => s.toLowerCase() === normalized);
    return found === -1 ? 0 : found;
};

export default function ApplicantTimelineScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const { applicationId, applicantName = 'Applicant', jobTitle = 'Role', status = 'Applied', matchScore = 0 } = route.params || {};
    const [currentStatus, setCurrentStatus] = useState(status);
    const [notesByStage, setNotesByStage] = useState({});

    const currentIndex = useMemo(() => resolveStageIndex(currentStatus), [currentStatus]);

    const handleAdvanceStage = async () => {
        if (currentIndex >= STAGES.length - 1) return;
        const nextStage = STAGES[currentIndex + 1];
        try {
            const normalizedNext = String(nextStage).toLowerCase();
            // Backend supports accepted/rejected; keep early funnel stages local-only.
            const backendStatus = normalizedNext === 'interview' || normalizedNext === 'decision'
                ? 'accepted'
                : null;
            if (applicationId && backendStatus) {
                await client.put(`/api/applications/${applicationId}/status`, { status: backendStatus });
            }
            setCurrentStatus(nextStage);
        } catch (e) {
            Alert.alert('Update Failed', 'Could not update status. Please try again.');
        }
    };

    const handleReject = async () => {
        Alert.alert('Reject Applicant', 'Are you sure you want to reject this applicant?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Reject',
                style: 'destructive',
                onPress: async () => {
                    try {
                        if (applicationId) {
                            await client.put(`/api/applications/${applicationId}/status`, { status: 'rejected' });
                        }
                        setCurrentStatus('Rejected');
                    } catch (e) {
                        Alert.alert('Update Failed', 'Could not update status. Please try again.');
                    }
                }
            }
        ]);
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => {
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                            return;
                        }
                        navigation.navigate('MainTab', { screen: 'My Jobs' });
                    }}
                    style={styles.backButton}
                >
                    <Text style={styles.backText}>‹</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={styles.headerTitle}>{applicantName}</Text>
                    <Text style={styles.headerSubtitle}>{jobTitle} · {matchScore}% match</Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.timelineCard}>
                    <Text style={styles.sectionTitle}>Applicant Timeline</Text>
                    {STAGES.map((stage, index) => {
                        const isCompleted = index <= currentIndex;
                        const isCurrent = index === currentIndex;
                        return (
                            <View key={stage} style={styles.timelineRow}>
                                {index > 0 && (
                                    <View style={[styles.connector, isCompleted && styles.connectorActive]} />
                                )}
                                <View style={[styles.dot, isCompleted && styles.dotActive, isCurrent && styles.dotCurrent]}>
                                    {isCompleted && <IconCheck size={12} color="#fff" />}
                                </View>
                                <View style={styles.stageInfo}>
                                    <Text style={[styles.stageLabel, isCurrent && styles.stageLabelActive]}>{stage}</Text>
                                    {isCompleted && (
                                        <Text style={styles.stageTime}>Mar 15, 2:30 PM</Text>
                                    )}
                                </View>
                            </View>
                        );
                    })}
                </View>

                <View style={styles.notesCard}>
                    <Text style={styles.sectionTitle}>Stage Notes</Text>
                    {STAGES.map(stage => (
                        <View key={stage} style={styles.noteRow}>
                            <Text style={styles.noteLabel}>{stage}</Text>
                            <TextInput
                                style={styles.noteInput}
                                placeholder={`Add note for ${stage}`}
                                placeholderTextColor="#94a3b8"
                                value={notesByStage[stage] || ''}
                                onChangeText={(text) => setNotesByStage(prev => ({ ...prev, [stage]: text }))}
                                multiline
                            />
                        </View>
                    ))}
                </View>
            </ScrollView>

            <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <TouchableOpacity
                    style={[styles.primaryButton, currentIndex >= STAGES.length - 1 && styles.primaryButtonDisabled]}
                    onPress={handleAdvanceStage}
                    disabled={currentIndex >= STAGES.length - 1}
                >
                    <Text style={styles.primaryButtonText}>Move to Next Stage</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.rejectButton} onPress={handleReject}>
                    <Text style={styles.rejectButtonText}>Reject</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    backButton: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f1f5f9',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    backText: {
        fontSize: 24,
        color: '#0f172a',
        marginBottom: 2,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#0f172a',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748b',
        marginTop: 2,
    },
    content: {
        paddingHorizontal: 16,
        paddingBottom: 24,
        gap: 16,
    },
    timelineCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    timelineRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 16,
        paddingLeft: 8,
    },
    connector: {
        position: 'absolute',
        left: 18,
        top: -16,
        width: 2,
        height: 32,
        backgroundColor: '#e2e8f0',
    },
    connectorActive: {
        backgroundColor: '#7c3aed',
    },
    dot: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#e2e8f0',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    dotActive: {
        backgroundColor: '#7c3aed',
    },
    dotCurrent: {
        borderWidth: 2,
        borderColor: '#c4b5fd',
    },
    stageInfo: {
        flex: 1,
    },
    stageLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#334155',
    },
    stageLabelActive: {
        color: '#5b21b6',
    },
    stageTime: {
        fontSize: 12,
        color: '#94a3b8',
        marginTop: 4,
    },
    notesCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0f172a',
        marginBottom: 12,
    },
    noteRow: {
        marginBottom: 12,
    },
    noteLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#475569',
        marginBottom: 6,
    },
    noteInput: {
        minHeight: 44,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: '#0f172a',
        backgroundColor: '#f8fafc',
    },
    actionBar: {
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#e2e8f0',
        backgroundColor: '#ffffff',
        gap: 10,
    },
    primaryButton: {
        backgroundColor: '#7c3aed',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    primaryButtonDisabled: {
        backgroundColor: '#c4b5fd',
    },
    primaryButtonText: {
        color: '#ffffff',
        fontWeight: '700',
    },
    rejectButton: {
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fff1f2',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    rejectButtonText: {
        color: '#b91c1c',
        fontWeight: '700',
    },
});
