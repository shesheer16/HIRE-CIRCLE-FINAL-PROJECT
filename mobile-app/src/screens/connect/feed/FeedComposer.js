import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { IconMic, IconImage, IconVideo } from '../../../components/Icons';
import { RADIUS, SPACING } from '../../../theme/theme';

const VISIBILITY_LABELS = {
    community: 'Community',
    public: 'Public',
    connections: 'Connections',
    private: 'Private',
};

const AUDIENCE_OPTIONS = [
    { key: 'community', label: 'Community', helper: 'Visible to Hire Connect members' },
    { key: 'connections', label: 'Connections', helper: 'Only your accepted network' },
    { key: 'public', label: 'Public', helper: 'Anyone on the platform can view' },
    { key: 'private', label: 'Only me', helper: 'Saved as a private draft post' },
];

const QUICK_CAPTION_PROMPTS = [
    'Open to opportunities this week.',
    'Sharing a quick update from my work today.',
    'Looking for feedback from the community.',
    'Happy to collaborate on similar projects.',
    'Available for interviews this week.',
];

const POST_ACTION_OPTIONS = [
    {
        key: 'share_update',
        label: 'Share update',
        helper: 'Progress, wins, or community insights',
        kicker: 'UPDATE',
        valueProp: 'Best for product progress, launches, and milestones.',
        icon: 'sparkles-outline',
        starter: 'Quick update from my side for the HireCircle community.',
        placeholder: 'Share a meaningful update for your network...',
        prompts: QUICK_CAPTION_PROMPTS,
    },
    {
        key: 'hiring_need',
        label: 'Hiring need',
        helper: 'Role highlights, requirements, and interview slots',
        kicker: 'HIRING',
        valueProp: 'Best for active hiring, screening, and interview timelines.',
        icon: 'briefcase-outline',
        starter: 'We are hiring now. Sharing role details and interview timelines below.',
        placeholder: 'Share hiring context, role details, and next steps...',
        prompts: [
            'Hiring urgently for this week. Please share relevant profiles.',
            'Role open with quick interview slots and fast feedback.',
            'Need candidates with strong communication and ownership.',
            'Shortlisting profile links today. Comment or DM to apply.',
            'Posting clear requirements so candidates can self-screen.',
        ],
    },
    {
        key: 'open_to_work',
        label: 'Open to work',
        helper: 'Availability, skill proof, and referral asks',
        kicker: 'OPEN',
        valueProp: 'Best for referrals, opportunities, and availability signals.',
        icon: 'person-outline',
        starter: 'Open to opportunities this week. Happy to discuss relevant roles.',
        placeholder: 'Share your goal, skills, and preferred roles...',
        prompts: [
            'Open to work in customer support and operations.',
            'Available for interviews this week. Referrals welcome.',
            'Sharing my latest project outcome for recruiter review.',
            'Looking for a role in Bengaluru or remote.',
            'Can start immediately and open to shift flexibility.',
        ],
    },
];

const TAG_PEOPLE_SUGGESTIONS = [
    'Hiring Team',
    'Design Lead',
    'Product Mentor',
    'Frontend Recruiter',
    'Backend Recruiter',
    'Talent Partner',
    'Community Admin',
];

const LOCATION_SUGGESTIONS = [
    'Bengaluru, India',
    'Hyderabad, India',
    'Chennai, India',
    'Mumbai, India',
    'Pune, India',
    'Delhi, India',
    'Kolkata, India',
    'Remote',
];

const ACCENT = '#5b48f2';
const ACCENT_DARK = '#4c1d95';
const LILAC_BG = '#f5f3ff';

const normalizeToken = (value) => String(value || '').toLowerCase().trim();

function FeedComposerComponent({
    composerOpen,
    composerMediaType,
    composerText,
    composerVisibility,
    composerMediaAssets,
    isVoiceRecording,
    isPosting = false,
    currentUserAvatar,
    onInputAreaClick,
    onMediaButtonClick,
    onCancelComposer,
    onStopVoiceRecording,
    onRemoveComposerMedia,
    onPost,
    onComposerTextChange,
    onComposerVisibilityToggle,
    onComposerVisibilitySelect,
    isEmployerRole = false,
    onOpenPostJobForm,
    showInline = true,
}) {
    const onVoicePress = useCallback(() => onMediaButtonClick('VOICE'), [onMediaButtonClick]);
    const onPhotosPress = useCallback(() => onMediaButtonClick('PHOTOS'), [onMediaButtonClick]);
    const onVideoPress = useCallback(() => onMediaButtonClick('VIDEO'), [onMediaButtonClick]);

    const normalizedMediaType = String(composerMediaType || 'TEXT').toUpperCase();
    const safeMediaAssets = Array.isArray(composerMediaAssets) ? composerMediaAssets : [];
    const normalizedVisibility = String(composerVisibility || 'community').toLowerCase();
    const visibilityLabel = VISIBILITY_LABELS[normalizedVisibility] || 'Community';
    const avatarUri = String(currentUserAvatar || '').trim()
        || 'https://ui-avatars.com/api/?name=You&background=d1d5db&color=111111&rounded=true';

    const hasVisualMedia = (normalizedMediaType === 'PHOTOS' || normalizedMediaType === 'VIDEO') && safeMediaAssets.length > 0;
    const hasVoiceAsset = normalizedMediaType === 'VOICE' && safeMediaAssets.length > 0;
    const hasRequiredMedia = normalizedMediaType === 'VOICE'
        ? hasVoiceAsset
        : (normalizedMediaType === 'PHOTOS' || normalizedMediaType === 'VIDEO')
            ? safeMediaAssets.length > 0
            : true;

    const hasCaption = Boolean(String(composerText || '').trim());
    const canShare = (
        normalizedMediaType === 'TEXT'
            ? hasCaption
            : hasRequiredMedia
    ) && !isVoiceRecording && !isPosting;
    const defaultPostAction = isEmployerRole ? 'hiring_need' : 'open_to_work';

    const [flowStep, setFlowStep] = useState('CAPTION');
    const [showAudiencePanel, setShowAudiencePanel] = useState(false);
    const [tagQuery, setTagQuery] = useState('');
    const [selectedTags, setSelectedTags] = useState([]);
    const [locationQuery, setLocationQuery] = useState('');
    const [selectedLocation, setSelectedLocation] = useState('');
    const [postActionMode, setPostActionMode] = useState(defaultPostAction);

    const previousMediaTypeRef = useRef(normalizedMediaType);
    const captionInputRef = useRef(null);

    useEffect(() => {
        const previousType = previousMediaTypeRef.current;
        if (!composerOpen) {
            setFlowStep('CAPTION');
            setShowAudiencePanel(false);
            setTagQuery('');
            setSelectedTags([]);
            setLocationQuery('');
            setSelectedLocation('');
            setPostActionMode(defaultPostAction);
            previousMediaTypeRef.current = normalizedMediaType;
            return;
        }

        if (previousType !== normalizedMediaType) {
            if (normalizedMediaType === 'PHOTOS' || normalizedMediaType === 'VIDEO') {
                setFlowStep('MEDIA');
            } else {
                setFlowStep('CAPTION');
            }
        }

        previousMediaTypeRef.current = normalizedMediaType;
    }, [composerOpen, defaultPostAction, normalizedMediaType]);

    const activePostAction = useMemo(() => (
        POST_ACTION_OPTIONS.find((item) => item.key === postActionMode)
        || POST_ACTION_OPTIONS.find((item) => item.key === defaultPostAction)
        || POST_ACTION_OPTIONS[0]
    ), [defaultPostAction, postActionMode]);

    const promptPool = useMemo(() => (
        Array.isArray(activePostAction?.prompts) && activePostAction.prompts.length
            ? activePostAction.prompts
            : QUICK_CAPTION_PROMPTS
    ), [activePostAction]);

    const placeholder = normalizedMediaType === 'VOICE'
        ? 'Add a caption for your voice note...'
        : (activePostAction?.placeholder || 'Write a caption...');

    const availableTagSuggestions = useMemo(() => {
        const normalizedQuery = normalizeToken(tagQuery);
        const selectedSet = new Set(selectedTags.map((item) => normalizeToken(item)));
        return TAG_PEOPLE_SUGGESTIONS
            .filter((name) => !selectedSet.has(normalizeToken(name)))
            .filter((name) => !normalizedQuery || normalizeToken(name).includes(normalizedQuery))
            .slice(0, 6);
    }, [selectedTags, tagQuery]);

    const availableLocationSuggestions = useMemo(() => {
        const normalizedQuery = normalizeToken(locationQuery);
        return LOCATION_SUGGESTIONS
            .filter((name) => !normalizedQuery || normalizeToken(name).includes(normalizedQuery))
            .slice(0, 5);
    }, [locationQuery]);

    const mediaPreviewUri = String(safeMediaAssets?.[0]?.uri || '').trim();
    const mediaCountText = normalizedMediaType === 'PHOTOS'
        ? `${safeMediaAssets.length} photo${safeMediaAssets.length > 1 ? 's' : ''}`
        : '1 video';
    const locationValue = String(selectedLocation || locationQuery || '').trim();

    const handleHeaderLeftPress = useCallback(() => {
        if (flowStep === 'CAPTION' && hasVisualMedia) {
            setFlowStep('MEDIA');
            return;
        }
        onCancelComposer?.();
    }, [flowStep, hasVisualMedia, onCancelComposer]);

    const handleHeaderPrimaryPress = useCallback(() => {
        if (flowStep === 'MEDIA') {
            setFlowStep('CAPTION');
            return;
        }
        onPost?.();
    }, [flowStep, onPost]);

    const handleApplyPrompt = useCallback((prompt) => {
        const existing = String(composerText || '');
        const trimmed = existing.trim();
        const spacer = trimmed.length > 0 && !/\s$/.test(existing) ? ' ' : '';
        onComposerTextChange(`${existing}${spacer}${prompt}`);
        captionInputRef.current?.focus?.();
    }, [composerText, onComposerTextChange]);

    const handleSelectPostAction = useCallback((nextMode) => {
        const safeMode = String(nextMode || '').trim().toLowerCase();
        if (!POST_ACTION_OPTIONS.some((item) => item.key === safeMode)) return;
        setPostActionMode(safeMode);
    }, []);

    const handleApplyStarter = useCallback(() => {
        const starterLine = String(activePostAction?.starter || '').trim();
        if (!starterLine) return;
        handleApplyPrompt(starterLine);
    }, [activePostAction?.starter, handleApplyPrompt]);

    const handleSelectAudience = useCallback((value) => {
        if (typeof onComposerVisibilitySelect === 'function') {
            onComposerVisibilitySelect(value);
        } else {
            onComposerVisibilityToggle?.();
        }
        setShowAudiencePanel(false);
    }, [onComposerVisibilitySelect, onComposerVisibilityToggle]);

    const handleAddTag = useCallback((name) => {
        const safeName = String(name || '').trim();
        if (!safeName) return;
        setSelectedTags((prev) => {
            if (prev.some((item) => normalizeToken(item) === normalizeToken(safeName))) {
                return prev;
            }
            return [...prev, safeName];
        });
        setTagQuery('');
    }, []);

    const handleRemoveTag = useCallback((name) => {
        const safeName = String(name || '').trim();
        if (!safeName) return;
        setSelectedTags((prev) => prev.filter((item) => normalizeToken(item) !== normalizeToken(safeName)));
    }, []);

    const handleSelectLocation = useCallback((name) => {
        const safeName = String(name || '').trim();
        setSelectedLocation(safeName);
        setLocationQuery(safeName);
    }, []);

    const handleLocationInputChange = useCallback((value) => {
        setSelectedLocation('');
        setLocationQuery(value);
    }, []);

    const headerPrimaryDisabled = flowStep === 'MEDIA' ? !hasVisualMedia : !canShare;
    const headerPrimaryLabel = flowStep === 'MEDIA' ? 'Next' : (isPosting ? 'Sharing...' : 'Share');
    const leftHeaderIcon = flowStep === 'CAPTION' && hasVisualMedia ? 'chevron-back' : 'close';

    return (
        <View style={[styles.wrapper, !showInline && styles.wrapperHidden]}>
            {showInline ? (
                <View style={styles.inlineComposer}>
                    <View style={styles.inlineTopRow}>
                        <Image source={{ uri: avatarUri }} style={styles.avatar} />
                        <View style={styles.inlineTextWrap}>
                            <Text style={styles.inlineTitle}>Create a post</Text>
                            <Text style={styles.inlineSubtitle}>Share updates, wins, or hiring needs.</Text>
                        </View>
                        <TouchableOpacity style={styles.inlinePlusButton} onPress={onInputAreaClick} activeOpacity={0.85}>
                            <Ionicons name="add" size={18} color="#ffffff" />
                        </TouchableOpacity>
                    </View>

                    {isEmployerRole && typeof onOpenPostJobForm === 'function' ? (
                        <TouchableOpacity style={styles.inlineJobLink} onPress={onOpenPostJobForm} activeOpacity={0.82}>
                            <Ionicons name="briefcase-outline" size={13} color="#6a41d8" />
                            <Text style={styles.inlineJobLinkText}>Post a job instead</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            ) : null}

            <Modal
                visible={Boolean(composerOpen)}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={handleHeaderLeftPress}
            >
                <View style={styles.modalShell}>
                    <View style={styles.modalHandle} />
                    <View style={styles.modalHeader}>
                        <TouchableOpacity style={styles.headerIconBtn} onPress={handleHeaderLeftPress} activeOpacity={0.8}>
                            <Ionicons name={leftHeaderIcon} size={22} color="#0f172a" />
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>Create Post</Text>
                        <TouchableOpacity
                            style={[styles.headerPrimaryBtn, headerPrimaryDisabled && styles.headerPrimaryBtnDisabled]}
                            onPress={handleHeaderPrimaryPress}
                            activeOpacity={0.85}
                            disabled={headerPrimaryDisabled}
                        >
                            <LinearGradient
                                colors={['#9f5cff', '#7c3aed', '#5b48f2']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={styles.headerPrimaryGradient}
                            >
                                <Text style={styles.headerPrimaryText}>{headerPrimaryLabel}</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </View>

                    {flowStep === 'MEDIA' && hasVisualMedia ? (
                        <View style={styles.mediaStepWrap}>
                            <View style={styles.mainMediaPreview}>
                                {normalizedMediaType === 'PHOTOS' ? (
                                    <Image source={{ uri: mediaPreviewUri }} style={styles.mainMediaImage} resizeMode="cover" />
                                ) : (
                                    <View style={styles.mainVideoPreview}>
                                        <Ionicons name="videocam" size={30} color="#ffffff" />
                                        <Text style={styles.mainVideoText}>Video selected</Text>
                                    </View>
                                )}
                            </View>

                            {normalizedMediaType === 'PHOTOS' && safeMediaAssets.length > 1 ? (
                                <ScrollView
                                    horizontal
                                    showsHorizontalScrollIndicator={false}
                                    contentContainerStyle={styles.thumbnailRow}
                                >
                                    {safeMediaAssets.map((asset, index) => (
                                        <Image
                                            key={String(asset?.id || `${String(asset?.uri || '')}-${index}`)}
                                            source={{ uri: asset?.uri }}
                                            style={styles.thumbnailImage}
                                        />
                                    ))}
                                </ScrollView>
                            ) : null}

                            <Text style={styles.mediaHintText}>Tap Next to continue with details.</Text>
                        </View>
                    ) : (
                        <View style={styles.captionAreaWrapper}>
                            <ScrollView style={styles.captionScroll} contentContainerStyle={styles.captionScrollContent}>
                                <View style={styles.captionSectionCard}>
                                    <View style={styles.captionRow}>
                                        <View style={styles.captionMetaWrap}>
                                            <Image source={{ uri: avatarUri }} style={styles.captionAvatar} />
                                            <View style={styles.captionAuthorWrap}>
                                                <Text style={styles.captionAuthorName}>Author Name</Text>
                                                <TouchableOpacity style={styles.audiencePill} activeOpacity={0.8} onPress={() => setShowAudiencePanel(!showAudiencePanel)}>
                                                    <Ionicons name="earth" size={11} color="#64748b" />
                                                    <Text style={styles.audiencePillText}>{visibilityLabel.split(' ')[0]}</Text>
                                                    <Ionicons name="chevron-down" size={10} color="#64748b" />
                                                </TouchableOpacity>
                                            </View>
                                        </View>
                                        <TextInput
                                            ref={captionInputRef}
                                            style={styles.captionInput}
                                            value={composerText}
                                            onChangeText={onComposerTextChange}
                                            placeholder={placeholder}
                                            placeholderTextColor="#94a3b8"
                                            multiline
                                            autoFocus
                                            textAlignVertical="top"
                                        />
                                    </View>
                                </View>
                            </ScrollView>

                            {showAudiencePanel ? (
                                <View style={styles.audiencePanelAbsolute}>
                                    {AUDIENCE_OPTIONS.map((item) => {
                                        const active = normalizeToken(item.key) === normalizeToken(normalizedVisibility);
                                        return (
                                            <TouchableOpacity
                                                key={item.key}
                                                style={[styles.audienceOptionRow, active && styles.audienceOptionRowActive]}
                                                activeOpacity={0.86}
                                                onPress={() => {
                                                    onComposerVisibilitySelect?.(item.key);
                                                    setShowAudiencePanel(false);
                                                }}
                                            >
                                                <View style={styles.audienceOptionTextWrap}>
                                                    <Text style={[styles.audienceOptionTitle, active && styles.audienceOptionTitleActive]}>{item.label}</Text>
                                                </View>
                                                {active ? <Ionicons name="checkmark-circle" size={18} color="#7c3aed" /> : null}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            ) : null}
                        </View>
                    )}

                    <View style={styles.bottomBar}>
                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'PHOTOS' && styles.bottomActionBtnActive]}
                            onPress={onPhotosPress}
                            activeOpacity={0.85}
                        >
                            <IconImage size={18} color={normalizedMediaType === 'PHOTOS' ? '#ffffff' : '#475569'} />
                            <Text style={[styles.bottomActionText, normalizedMediaType === 'PHOTOS' && styles.bottomActionTextActive]}>Photo</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'VIDEO' && styles.bottomActionBtnActive]}
                            onPress={onVideoPress}
                            activeOpacity={0.85}
                        >
                            <IconVideo size={18} color={normalizedMediaType === 'VIDEO' ? '#ffffff' : '#475569'} />
                            <Text style={[styles.bottomActionText, normalizedMediaType === 'VIDEO' && styles.bottomActionTextActive]}>Video</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'VOICE' && styles.bottomActionBtnActive]}
                            onPress={onVoicePress}
                            activeOpacity={0.85}
                        >
                            <IconMic size={18} color={normalizedMediaType === 'VOICE' ? '#ffffff' : '#475569'} />
                            <Text style={[styles.bottomActionText, normalizedMediaType === 'VOICE' && styles.bottomActionTextActive]}>
                                {isVoiceRecording ? 'Stop' : 'Voice'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

export default memo(FeedComposerComponent);

const styles = StyleSheet.create({
    wrapper: {
        marginBottom: 14,
    },
    wrapperHidden: {
        marginBottom: 0,
        height: 0,
    },
    inlineComposer: {
        borderWidth: 1,
        borderColor: '#e9e1fb',
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderRadius: 22,
        marginHorizontal: 10,
        marginTop: 10,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 10,
        shadowColor: '#261249',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.06,
        shadowRadius: 18,
        elevation: 3,
    },
    inlineTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        borderWidth: 1.5,
        borderColor: '#dfd5f6',
    },
    inlineTextWrap: {
        flex: 1,
        minWidth: 0,
    },
    inlineTitle: {
        color: '#1f2436',
        fontSize: 14,
        fontWeight: '800',
    },
    inlineSubtitle: {
        marginTop: 2,
        color: '#7f879b',
        fontSize: 11.5,
        fontWeight: '600',
    },
    inlinePlusButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#6f4cf6',
        shadowColor: '#6f4cf6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 3,
    },
    inlineJobLink: {
        marginTop: 9,
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: '#f3edff',
        borderWidth: 1,
        borderColor: '#e2d7ff',
    },
    inlineJobLinkText: {
        color: '#6a41d8',
        fontSize: 11,
        fontWeight: '800',
    },
    modalShell: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    modalHandle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#cbd5e1',
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 8,
    },
    modalHeader: {
        paddingHorizontal: 16,
        paddingBottom: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#ffffff',
    },
    headerIconBtn: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f8fafc',
    },
    modalTitle: {
        color: '#0f172a',
        fontSize: 18,
        fontWeight: '800',
    },
    headerPrimaryBtn: {
        borderRadius: RADIUS.full,
        overflow: 'hidden',
    },
    headerPrimaryBtnDisabled: {
        opacity: 0.45,
    },
    headerPrimaryGradient: {
        borderRadius: RADIUS.full,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    headerPrimaryText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '800',
    },
    mediaStepWrap: {
        flex: 1,
        paddingHorizontal: 14,
        paddingTop: 14,
    },
    mainMediaPreview: {
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: '#111111',
        borderWidth: 1,
        borderColor: '#ddd6fe',
        minHeight: 380,
        justifyContent: 'center',
        alignItems: 'center',
    },
    mainMediaImage: {
        width: '100%',
        height: '100%',
        minHeight: 380,
    },
    mainVideoPreview: {
        flex: 1,
        width: '100%',
        minHeight: 380,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#111111',
    },
    mainVideoText: {
        color: '#ffffff',
        fontSize: 13,
        fontWeight: '700',
    },
    thumbnailRow: {
        paddingTop: 12,
        paddingBottom: 4,
        gap: 8,
    },
    thumbnailImage: {
        width: 70,
        height: 70,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#ddd6fe',
    },
    mediaHintText: {
        marginTop: 12,
        color: '#111111',
        fontSize: 12,
        fontWeight: '600',
    },
    captionAreaWrapper: {
        flex: 1,
        position: 'relative',
    },
    captionScroll: {
        flex: 1,
    },
    captionScrollContent: {
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 24,
    },
    captionSectionCard: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    captionMetaWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingBottom: 14,
        gap: 12,
    },
    captionAuthorWrap: {
        flex: 1,
        justifyContent: 'center',
        gap: 3,
    },
    captionAuthorName: {
        color: '#0f172a',
        fontSize: 16,
        fontWeight: '800',
    },
    audiencePill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        gap: 4,
    },
    audiencePillText: {
        color: '#64748b',
        fontSize: 12,
        fontWeight: '700',
    },
    audiencePanelAbsolute: {
        position: 'absolute',
        top: 60,
        left: 64,
        width: 180,
        zIndex: 100,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#e2e8f0',
        borderRadius: 12,
        padding: 4,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 10,
    },
    captionRow: {
        flex: 1,
        flexDirection: 'column',
    },
    captionAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
    },
    captionInput: {
        flex: 1,
        minHeight: 280,
        backgroundColor: 'transparent',
        paddingHorizontal: 6,
        paddingVertical: 14,
        color: '#0f172a',
        fontSize: 19,
        lineHeight: 28,
    },
    audienceOptionRow: {
        paddingHorizontal: 12,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 12,
    },
    audienceOptionRowActive: {
        backgroundColor: '#f8fafc',
    },
    audienceOptionTextWrap: {
        flex: 1,
        paddingRight: 8,
    },
    audienceOptionTitle: {
        color: '#475569',
        fontSize: 14,
        fontWeight: '700',
    },
    audienceOptionTitleActive: {
        color: '#0f172a',
    },
    bottomBar: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingTop: 10,
        paddingBottom: 24,
        flexDirection: 'row',
        gap: 12,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.03,
        shadowRadius: 12,
        elevation: 10,
    },
    bottomActionBtn: {
        flex: 1,
        borderRadius: 16,
        backgroundColor: '#f8fafc',
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
    },
    bottomActionBtnActive: {
        backgroundColor: '#9333ea',
        shadowColor: '#9333ea',
        shadowOpacity: 0.2,
        shadowRadius: 8,
    },
    bottomActionText: {
        color: '#475569',
        fontSize: 13,
        fontWeight: '700',
    },
    bottomActionTextActive: {
        color: '#ffffff',
    },
});
