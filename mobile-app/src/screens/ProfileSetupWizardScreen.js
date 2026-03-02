import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Localization from 'expo-localization';
import client from '../api/client';
import { AuthContext } from '../context/AuthContext';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const WORKER_SKILL_SUGGESTIONS = [
    'Customer support',
    'Warehouse safety',
    'POS billing',
    'Inventory',
    'Driving',
    'Food handling',
];
const EXPERIENCE_OPTIONS = [0, 1, 2, 3, 5, 8, 10];
const AVAILABILITY_OPTIONS = [
    { label: 'Immediate', value: 0 },
    { label: '15 days', value: 15 },
    { label: '30 days', value: 30 },
];
const SHIFT_OPTIONS = ['Day', 'Night', 'Flexible'];

const splitName = (fullName = '') => {
    const segments = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!segments.length) return { firstName: '', lastName: '' };
    return {
        firstName: segments[0],
        lastName: segments.slice(1).join(' '),
    };
};

const normalizeSkills = (value = '') => (
    String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 25)
);

const readCompletionStep = (completion = {}, stepId = '') => {
    const steps = Array.isArray(completion?.steps) ? completion.steps : [];
    return steps.find((step) => String(step.id || '') === stepId) || null;
};

const Pill = ({ label, active, onPress }) => (
    <TouchableOpacity
        style={[styles.pill, active && styles.pillActive]}
        onPress={onPress}
        activeOpacity={0.85}
    >
        <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>{label}</Text>
    </TouchableOpacity>
);

export default function ProfileSetupWizardScreen({ navigation, onCompleted }) {
    const insets = useSafeAreaInsets();
    const { userInfo, updateUserInfo } = useContext(AuthContext);
    const [bootLoading, setBootLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [errorText, setErrorText] = useState('');
    const [completion, setCompletion] = useState(null);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [form, setForm] = useState({
        avatarUrl: '',
        fullName: '',
        city: '',
        language: 'en',
        skillsText: '',
        experienceInRole: 0,
        expectedSalary: '',
        preferredShift: 'Flexible',
        availabilityWindowDays: 0,
        openToRelocation: false,
        openToNightShift: false,
        roleName: 'General Worker',
        companyName: '',
        companyDescription: '',
        industry: '',
        contactPerson: '',
        companyLocation: '',
    });

    const isEmployer = useMemo(() => {
        const activeRole = String(userInfo?.activeRole || userInfo?.primaryRole || '').toLowerCase();
        return activeRole === 'employer' || activeRole === 'recruiter';
    }, [userInfo?.activeRole, userInfo?.primaryRole]);

    const smartInterviewComplete = Boolean(readCompletionStep(completion, 'smart_interview')?.complete);
    const verificationComplete = Boolean(readCompletionStep(completion, 'verified_contact')?.complete);

    const steps = useMemo(() => {
        if (isEmployer) {
            return [
                { id: 'company_name', title: 'Company name' },
                { id: 'company_logo', title: 'Company logo' },
                { id: 'company_description', title: 'Description' },
                { id: 'industry', title: 'Industry' },
                { id: 'contact_person', title: 'Contact info' },
                { id: 'verified_contact', title: 'Verification' },
            ];
        }

        return [
            { id: 'profile_picture', title: 'Profile picture' },
            { id: 'basic_info', title: 'Basic info' },
            { id: 'work_info', title: 'Work info' },
            { id: 'availability', title: 'Availability' },
            { id: 'smart_interview', title: 'Smart Interview' },
        ];
    }, [isEmployer]);

    const currentStep = steps[currentStepIndex] || steps[0];

    const refreshCompletion = useCallback(async () => {
        const { data } = await client.get('/api/users/profile-completion');
        const nextCompletion = data?.completion || null;
        if (nextCompletion) {
            setCompletion(nextCompletion);
            const nextMissing = Array.isArray(nextCompletion?.missingRequiredFields)
                ? nextCompletion.missingRequiredFields[0]
                : null;
            if (nextMissing) {
                const index = steps.findIndex((step) => step.id === nextMissing || step.id === 'basic_info' && nextMissing === 'full_name');
                if (index >= 0) {
                    setCurrentStepIndex(index);
                }
            }
        }
        return nextCompletion;
    }, [steps]);

    const bootstrap = useCallback(async () => {
        setBootLoading(true);
        setErrorText('');
        try {
            const [profileRes, completionRes] = await Promise.all([
                client.get('/api/users/profile').catch(() => ({ data: {} })),
                client.get('/api/users/profile-completion').catch(() => ({ data: {} })),
            ]);

            const profile = profileRes?.data?.profile || {};
            const roleProfile = Array.isArray(profile?.roleProfiles) ? (profile.roleProfiles[0] || {}) : {};
            const employerName = String(profile?.contactPerson || userInfo?.name || '').trim();
            const localeRegion = String(Localization.region || '').trim();

            setForm({
                avatarUrl: String(profile?.avatar || profile?.logoUrl || '').trim(),
                fullName: String(
                    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')
                    || userInfo?.name
                    || ''
                ).trim(),
                city: String(profile?.city || userInfo?.city || '').trim(),
                language: String(profile?.language || userInfo?.languageCode || 'en').trim() || 'en',
                skillsText: Array.isArray(roleProfile?.skills) ? roleProfile.skills.join(', ') : '',
                experienceInRole: Number(roleProfile?.experienceInRole || profile?.totalExperience || 0) || 0,
                expectedSalary: String(roleProfile?.expectedSalary || ''),
                preferredShift: SHIFT_OPTIONS.includes(String(profile?.preferredShift || ''))
                    ? String(profile.preferredShift)
                    : 'Flexible',
                availabilityWindowDays: [0, 15, 30].includes(Number(profile?.availabilityWindowDays))
                    ? Number(profile.availabilityWindowDays)
                    : 0,
                openToRelocation: Boolean(profile?.openToRelocation),
                openToNightShift: Boolean(profile?.openToNightShift),
                roleName: String(roleProfile?.roleName || 'General Worker').trim() || 'General Worker',
                companyName: String(profile?.companyName || '').trim(),
                companyDescription: String(profile?.description || '').trim(),
                industry: String(profile?.industry || '').trim(),
                contactPerson: employerName,
                companyLocation: String(profile?.location || userInfo?.city || localeRegion || '').trim(),
            });

            const incomingCompletion = completionRes?.data?.completion || profileRes?.data?.profileCompletion || null;
            setCompletion(incomingCompletion);
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Could not load profile setup.');
        } finally {
            setBootLoading(false);
        }
    }, [userInfo?.city, userInfo?.languageCode, userInfo?.name]);

    useEffect(() => {
        bootstrap();
    }, [bootstrap]);

    const uploadAvatar = useCallback(async (uri, mimeType = 'image/jpeg') => {
        const fileName = uri.split('/').pop() || `avatar-${Date.now()}.jpg`;
        const payload = new FormData();
        payload.append('avatar', {
            uri,
            name: fileName,
            type: mimeType,
        });

        setUploadingAvatar(true);
        setUploadProgress(0);
        try {
            const { data } = await client.post('/api/settings/avatar', payload, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (event) => {
                    if (!event?.total) return;
                    const pct = Math.round((event.loaded / event.total) * 100);
                    setUploadProgress(Math.max(0, Math.min(100, pct)));
                },
            });
            const avatarUrl = String(data?.avatarUrl || uri).trim();
            const nextCompletion = data?.profileCompletion || completion;
            setForm((prev) => ({ ...prev, avatarUrl }));
            if (nextCompletion) {
                setCompletion(nextCompletion);
            }
            await updateUserInfo?.({ avatar: avatarUrl });
            return avatarUrl;
        } finally {
            setUploadingAvatar(false);
            setUploadProgress(0);
        }
    }, [completion, updateUserInfo]);

    const pickAvatar = useCallback(async () => {
        setErrorText('');
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission?.granted) {
            setErrorText('Photo permission is required to upload a profile image.');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.7,
        });
        if (result.canceled || !result.assets?.length) return;

        const asset = result.assets[0];
        if (Number(asset?.fileSize || 0) > MAX_AVATAR_BYTES) {
            setErrorText('Image must be 5MB or less.');
            return;
        }

        try {
            await uploadAvatar(asset.uri, asset.mimeType || 'image/jpeg');
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Avatar upload failed.');
        }
    }, [uploadAvatar]);

    const persistProfile = useCallback(async (payload) => {
        const { data } = await client.put('/api/users/profile', payload);
        const nextCompletion = data?.profileCompletion || null;
        if (nextCompletion) setCompletion(nextCompletion);
        return nextCompletion;
    }, []);

    const validateCurrentStep = useCallback(() => {
        if (!currentStep) return 'Invalid step.';
        if (isEmployer) {
            if (currentStep.id === 'company_name' && !String(form.companyName || '').trim()) return 'Company name is required.';
            if (currentStep.id === 'company_logo' && !String(form.avatarUrl || '').trim()) return 'Company logo is required.';
            if (currentStep.id === 'company_description' && !String(form.companyDescription || '').trim()) return 'Company description is required.';
            if (currentStep.id === 'industry' && !String(form.industry || '').trim()) return 'Industry is required.';
            if (currentStep.id === 'contact_person' && !String(form.contactPerson || '').trim()) return 'Contact person is required.';
            if (currentStep.id === 'verified_contact' && !verificationComplete) return 'Verify email/phone before continuing.';
            return '';
        }

        if (currentStep.id === 'profile_picture' && !String(form.avatarUrl || '').trim()) return 'Profile picture is required.';
        if (currentStep.id === 'basic_info') {
            if (!String(form.fullName || '').trim()) return 'Full name is required.';
            if (!String(form.city || '').trim()) return 'City is required.';
        }
        if (currentStep.id === 'work_info') {
            const skills = normalizeSkills(form.skillsText);
            if (!skills.length) return 'At least one skill is required.';
            if (Number(form.experienceInRole || 0) <= 0) return 'Experience level is required.';
            if (Number(form.expectedSalary || 0) <= 0) return 'Expected salary is required.';
        }
        if (currentStep.id === 'smart_interview' && !smartInterviewComplete) {
            return 'Complete Smart Interview to continue.';
        }
        return '';
    }, [currentStep, form, isEmployer, smartInterviewComplete, verificationComplete]);

    const saveStep = useCallback(async () => {
        if (!currentStep) return null;
        if (isEmployer) {
            if (currentStep.id === 'company_name') {
                return persistProfile({
                    companyName: String(form.companyName || '').trim(),
                    location: String(form.companyLocation || '').trim(),
                });
            }
            if (currentStep.id === 'company_description') {
                return persistProfile({ description: String(form.companyDescription || '').trim() });
            }
            if (currentStep.id === 'industry') {
                return persistProfile({ industry: String(form.industry || '').trim() });
            }
            if (currentStep.id === 'contact_person') {
                return persistProfile({
                    contactPerson: String(form.contactPerson || '').trim(),
                    location: String(form.companyLocation || '').trim(),
                });
            }
            return refreshCompletion();
        }

        if (currentStep.id === 'basic_info') {
            const names = splitName(form.fullName);
            return persistProfile({
                firstName: names.firstName,
                lastName: names.lastName,
                city: String(form.city || '').trim(),
                language: String(form.language || 'en').trim(),
            });
        }

        if (currentStep.id === 'work_info') {
            const skills = normalizeSkills(form.skillsText);
            const expectedSalary = Number(form.expectedSalary || 0);
            return persistProfile({
                totalExperience: Number(form.experienceInRole || 0),
                preferredShift: String(form.preferredShift || 'Flexible'),
                roleProfiles: [
                    {
                        roleName: String(form.roleName || 'General Worker').trim() || 'General Worker',
                        experienceInRole: Number(form.experienceInRole || 0),
                        expectedSalary: Number.isFinite(expectedSalary) ? expectedSalary : 0,
                        skills,
                    },
                ],
            });
        }

        if (currentStep.id === 'availability') {
            return persistProfile({
                isAvailable: true,
                availabilityWindowDays: Number(form.availabilityWindowDays || 0),
                openToRelocation: Boolean(form.openToRelocation),
                openToNightShift: Boolean(form.openToNightShift),
            });
        }

        return refreshCompletion();
    }, [currentStep, form, isEmployer, persistProfile, refreshCompletion]);

    const finishIfReady = useCallback(async () => {
        const nextCompletion = await refreshCompletion();
        const canAccessApp = Boolean(nextCompletion?.actions?.canAccessApp);
        if (!canAccessApp) {
            const missing = Array.isArray(nextCompletion?.missingForAccess) ? nextCompletion.missingForAccess.join(', ') : '';
            setErrorText(missing ? `Complete required fields: ${missing.replace(/_/g, ' ')}` : 'Profile setup is incomplete.');
            return false;
        }
        await updateUserInfo?.({
            hasCompletedProfile: Boolean(nextCompletion?.meetsProfileCompleteThreshold),
            profileCompletion: nextCompletion,
        });
        onCompleted?.(nextCompletion);
        return true;
    }, [onCompleted, refreshCompletion, updateUserInfo]);

    const onNext = useCallback(async () => {
        if (saving || uploadingAvatar) return;
        const validationError = validateCurrentStep();
        if (validationError) {
            setErrorText(validationError);
            return;
        }
        setErrorText('');
        setSaving(true);
        try {
            await saveStep();
            const isFinal = currentStepIndex >= (steps.length - 1);
            if (isFinal) {
                await finishIfReady();
                return;
            }
            setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
        } catch (error) {
            setErrorText(error?.response?.data?.message || 'Could not save this step.');
        } finally {
            setSaving(false);
        }
    }, [currentStepIndex, finishIfReady, saveStep, saving, steps.length, uploadingAvatar, validateCurrentStep]);

    const onBack = useCallback(() => {
        if (currentStepIndex <= 0) return;
        setErrorText('');
        setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
    }, [currentStepIndex]);

    const renderWorkerStep = () => {
        if (currentStep.id === 'profile_picture') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Add your profile picture</Text>
                    <Text style={styles.sectionHint}>Required. Cropped square and compressed before upload.</Text>
                    <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
                        {form.avatarUrl ? (
                            <Image source={{ uri: form.avatarUrl }} style={styles.avatarImage} />
                        ) : (
                            <Text style={styles.avatarPlaceholder}>Upload</Text>
                        )}
                    </TouchableOpacity>
                    {uploadingAvatar ? (
                        <View style={styles.uploadState}>
                            <ActivityIndicator color="#4f46e5" />
                            <Text style={styles.uploadStateText}>Uploading {uploadProgress}%</Text>
                        </View>
                    ) : null}
                </View>
            );
        }

        if (currentStep.id === 'basic_info') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Basic information</Text>
                    <TextInput
                        value={form.fullName}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, fullName: value }))}
                        style={styles.input}
                        placeholder="Full name"
                    />
                    <TextInput
                        value={form.city}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, city: value }))}
                        style={styles.input}
                        placeholder="City"
                    />
                    <TextInput
                        value={form.language}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, language: value }))}
                        style={styles.input}
                        placeholder="Language (optional)"
                    />
                </View>
            );
        }

        if (currentStep.id === 'work_info') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Work information</Text>
                    <TextInput
                        value={form.roleName}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, roleName: value }))}
                        style={styles.input}
                        placeholder="Previous role"
                    />
                    <TextInput
                        value={form.skillsText}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, skillsText: value }))}
                        style={styles.input}
                        placeholder="Skills (comma separated)"
                    />
                    <View style={styles.rowWrap}>
                        {WORKER_SKILL_SUGGESTIONS.map((item) => (
                            <Pill
                                key={item}
                                label={item}
                                active={normalizeSkills(form.skillsText).includes(item)}
                                onPress={() => {
                                    const skills = normalizeSkills(form.skillsText);
                                    const exists = skills.includes(item);
                                    const next = exists ? skills.filter((skill) => skill !== item) : [...skills, item];
                                    setForm((prev) => ({ ...prev, skillsText: next.join(', ') }));
                                }}
                            />
                        ))}
                    </View>
                    <Text style={styles.fieldLabel}>Experience (years)</Text>
                    <View style={styles.rowWrap}>
                        {EXPERIENCE_OPTIONS.map((option) => (
                            <Pill
                                key={`exp-${option}`}
                                label={`${option}`}
                                active={Number(form.experienceInRole) === option}
                                onPress={() => setForm((prev) => ({ ...prev, experienceInRole: option }))}
                            />
                        ))}
                    </View>
                    <TextInput
                        value={String(form.expectedSalary)}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, expectedSalary: value.replace(/[^\d]/g, '') }))}
                        style={styles.input}
                        placeholder="Expected salary"
                        keyboardType="number-pad"
                    />
                    <Text style={styles.fieldLabel}>Shift preference</Text>
                    <View style={styles.rowWrap}>
                        {SHIFT_OPTIONS.map((item) => (
                            <Pill
                                key={item}
                                label={item}
                                active={String(form.preferredShift) === item}
                                onPress={() => setForm((prev) => ({ ...prev, preferredShift: item }))}
                            />
                        ))}
                    </View>
                </View>
            );
        }

        if (currentStep.id === 'availability') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Availability</Text>
                    <Text style={styles.fieldLabel}>Joining window</Text>
                    <View style={styles.rowWrap}>
                        {AVAILABILITY_OPTIONS.map((option) => (
                            <Pill
                                key={`availability-${option.value}`}
                                label={option.label}
                                active={Number(form.availabilityWindowDays) === option.value}
                                onPress={() => setForm((prev) => ({ ...prev, availabilityWindowDays: option.value }))}
                            />
                        ))}
                    </View>
                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>Open to relocation</Text>
                        <Switch
                            value={Boolean(form.openToRelocation)}
                            onValueChange={(value) => setForm((prev) => ({ ...prev, openToRelocation: value }))}
                        />
                    </View>
                    <View style={styles.switchRow}>
                        <Text style={styles.switchLabel}>Open to night shift</Text>
                        <Switch
                            value={Boolean(form.openToNightShift)}
                            onValueChange={(value) => setForm((prev) => ({ ...prev, openToNightShift: value }))}
                        />
                    </View>
                </View>
            );
        }

        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Smart Interview</Text>
                <Text style={styles.sectionHint}>
                    This is required to unlock higher quality matches.
                </Text>
                <View style={styles.interviewStatusBox}>
                    <Text style={styles.interviewStatusText}>
                        {smartInterviewComplete ? 'Completed' : 'Pending'}
                    </Text>
                </View>
                {!smartInterviewComplete ? (
                    <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => navigation.navigate('SmartInterview')}
                    >
                        <Text style={styles.secondaryBtnText}>Start Smart Interview</Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        );
    };

    const renderEmployerStep = () => {
        if (currentStep.id === 'company_name') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Company name</Text>
                    <TextInput
                        value={form.companyName}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, companyName: value }))}
                        style={styles.input}
                        placeholder="Company name"
                    />
                    <TextInput
                        value={form.companyLocation}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, companyLocation: value }))}
                        style={styles.input}
                        placeholder="Location"
                    />
                </View>
            );
        }
        if (currentStep.id === 'company_logo') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Company logo</Text>
                    <TouchableOpacity style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
                        {form.avatarUrl ? (
                            <Image source={{ uri: form.avatarUrl }} style={styles.avatarImage} />
                        ) : (
                            <Text style={styles.avatarPlaceholder}>Upload</Text>
                        )}
                    </TouchableOpacity>
                </View>
            );
        }
        if (currentStep.id === 'company_description') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Company description</Text>
                    <TextInput
                        value={form.companyDescription}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, companyDescription: value }))}
                        style={[styles.input, styles.multilineInput]}
                        placeholder="Describe your company"
                        multiline
                    />
                </View>
            );
        }
        if (currentStep.id === 'industry') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Industry</Text>
                    <TextInput
                        value={form.industry}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, industry: value }))}
                        style={styles.input}
                        placeholder="Industry"
                    />
                </View>
            );
        }
        if (currentStep.id === 'contact_person') {
            return (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Contact person</Text>
                    <TextInput
                        value={form.contactPerson}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, contactPerson: value }))}
                        style={styles.input}
                        placeholder="Hiring contact name"
                    />
                    <TextInput
                        value={form.companyLocation}
                        onChangeText={(value) => setForm((prev) => ({ ...prev, companyLocation: value }))}
                        style={styles.input}
                        placeholder="Company location"
                    />
                </View>
            );
        }

        return (
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Verification</Text>
                <Text style={styles.sectionHint}>
                    Verify email or phone in settings to unlock posting.
                </Text>
                <View style={styles.interviewStatusBox}>
                    <Text style={styles.interviewStatusText}>
                        {verificationComplete ? 'Verified' : 'Verification pending'}
                    </Text>
                </View>
            </View>
        );
    };

    if (bootLoading) {
        return (
            <View style={[styles.loaderContainer, { paddingTop: insets.top + 20 }]}>
                <ActivityIndicator color="#4f46e5" />
                <Text style={styles.loaderText}>Loading profile setup...</Text>
            </View>
        );
    }

    const percent = Number(completion?.percent || 0);
    const stepLabel = `${currentStepIndex + 1} / ${steps.length}`;

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
                contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={styles.headerTitle}>Complete your profile</Text>
                <Text style={styles.headerSubtitle}>Complete profile to get 2x more interviews.</Text>
                <Text style={styles.progressMeta}>Step {stepLabel} • {percent}% complete</Text>
                <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, percent))}%` }]} />
                </View>

                <View style={styles.stepPillRow}>
                    {steps.map((step, index) => (
                        <View key={step.id} style={[styles.stepDot, index <= currentStepIndex && styles.stepDotActive]} />
                    ))}
                </View>

                <Text style={styles.stepTitle}>{currentStep?.title}</Text>
                {isEmployer ? renderEmployerStep() : renderWorkerStep()}

                {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

                <View style={styles.footerRow}>
                    <TouchableOpacity
                        style={[styles.backBtn, currentStepIndex <= 0 && styles.backBtnDisabled]}
                        disabled={currentStepIndex <= 0 || saving}
                        onPress={onBack}
                    >
                        <Text style={styles.backBtnText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.nextBtn, (saving || uploadingAvatar) && styles.nextBtnDisabled]}
                        disabled={saving || uploadingAvatar}
                        onPress={onNext}
                    >
                        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.nextBtnText}>{currentStepIndex >= steps.length - 1 ? 'Finish' : 'Next'}</Text>}
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    content: {
        paddingHorizontal: 18,
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
    },
    loaderText: {
        marginTop: 10,
        color: '#475569',
        fontWeight: '600',
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#0f172a',
    },
    headerSubtitle: {
        marginTop: 6,
        color: '#475569',
        fontWeight: '500',
    },
    progressMeta: {
        marginTop: 18,
        fontSize: 12,
        color: '#475569',
        fontWeight: '700',
    },
    progressTrack: {
        marginTop: 8,
        height: 8,
        borderRadius: 999,
        backgroundColor: '#e2e8f0',
        overflow: 'hidden',
    },
    progressFill: {
        height: 8,
        borderRadius: 999,
        backgroundColor: '#4f46e5',
    },
    stepPillRow: {
        marginTop: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stepDot: {
        width: 10,
        height: 10,
        borderRadius: 10,
        backgroundColor: '#cbd5e1',
    },
    stepDotActive: {
        backgroundColor: '#4f46e5',
    },
    stepTitle: {
        marginTop: 18,
        fontSize: 20,
        fontWeight: '800',
        color: '#111827',
    },
    section: {
        marginTop: 16,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0f172a',
    },
    sectionHint: {
        marginTop: 4,
        color: '#64748b',
        fontWeight: '500',
    },
    input: {
        marginTop: 10,
        backgroundColor: '#f8fafc',
        borderWidth: 1,
        borderColor: '#dbe4f0',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: '#0f172a',
        fontWeight: '600',
    },
    multilineInput: {
        minHeight: 96,
        textAlignVertical: 'top',
    },
    fieldLabel: {
        marginTop: 10,
        color: '#334155',
        fontWeight: '700',
        fontSize: 12,
    },
    rowWrap: {
        marginTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    pill: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: '#eef2ff',
    },
    pillActive: {
        backgroundColor: '#4f46e5',
    },
    pillLabel: {
        color: '#4338ca',
        fontWeight: '700',
        fontSize: 12,
    },
    pillLabelActive: {
        color: '#ffffff',
    },
    avatarWrap: {
        marginTop: 12,
        width: 110,
        height: 110,
        borderRadius: 55,
        borderWidth: 2,
        borderColor: '#4f46e5',
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        backgroundColor: '#eef2ff',
        alignSelf: 'center',
    },
    avatarImage: {
        width: 110,
        height: 110,
        borderRadius: 55,
    },
    avatarPlaceholder: {
        color: '#3730a3',
        fontWeight: '800',
    },
    uploadState: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    uploadStateText: {
        color: '#334155',
        fontWeight: '600',
    },
    switchRow: {
        marginTop: 12,
        paddingVertical: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    switchLabel: {
        color: '#1e293b',
        fontWeight: '700',
    },
    interviewStatusBox: {
        marginTop: 12,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: '#eef2ff',
    },
    interviewStatusText: {
        color: '#312e81',
        fontWeight: '700',
    },
    secondaryBtn: {
        marginTop: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#6366f1',
        paddingVertical: 11,
        alignItems: 'center',
    },
    secondaryBtnText: {
        color: '#4338ca',
        fontWeight: '800',
    },
    errorText: {
        marginTop: 12,
        color: '#dc2626',
        fontWeight: '700',
    },
    footerRow: {
        marginTop: 24,
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
    },
    backBtn: {
        flex: 1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#cbd5e1',
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: '#ffffff',
    },
    backBtnDisabled: {
        opacity: 0.45,
    },
    backBtnText: {
        color: '#334155',
        fontWeight: '700',
    },
    nextBtn: {
        flex: 1.3,
        borderRadius: 12,
        paddingVertical: 12,
        alignItems: 'center',
        backgroundColor: '#4f46e5',
    },
    nextBtnDisabled: {
        opacity: 0.65,
    },
    nextBtnText: {
        color: '#ffffff',
        fontWeight: '800',
    },
});
