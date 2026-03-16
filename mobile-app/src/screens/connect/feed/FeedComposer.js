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
                    <View style={styles.modalHeader}>
                        <TouchableOpacity style={styles.headerIconBtn} onPress={handleHeaderLeftPress} activeOpacity={0.8}>
                            <Ionicons name={leftHeaderIcon} size={22} color="#111111" />
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>New Post</Text>
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

                    <View style={styles.modalDivider} />

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
                        <ScrollView style={styles.captionScroll} contentContainerStyle={styles.captionScrollContent}>
                            <View style={styles.captionSectionCard}>
                                <View style={styles.actionChoiceHeader}>
                                    <Text style={styles.actionChoiceLabel}>Post Action</Text>
                                    <Text style={styles.actionChoiceHelper}>Choose intent first, then write your caption.</Text>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionChoiceRow}>
                                    {POST_ACTION_OPTIONS.map((item) => {
                                        const active = item.key === postActionMode;
                                        return (
                                            <TouchableOpacity
                                                key={item.key}
                                                style={[styles.actionChoicePill, active && styles.actionChoicePillActive]}
                                                activeOpacity={0.85}
                                                onPress={() => handleSelectPostAction(item.key)}
                                            >
                                                <Ionicons
                                                    name={item.icon}
                                                    size={14}
                                                    color={active ? '#ffffff' : ACCENT_DARK}
                                                />
                                                <Text style={[styles.actionChoicePillTitle, active && styles.actionChoicePillTitleActive]}>
                                                    {item.label}
                                                </Text>
                                                {active ? <Ionicons name="checkmark" size={13} color="#ffffff" /> : null}
                                            </TouchableOpacity>
                                        );
                                    })}
                                </ScrollView>

                                <View style={styles.actionChoiceFootnote}>
                                    <Ionicons name="information-circle-outline" size={13} color={ACCENT_DARK} />
                                    <Text style={styles.actionChoiceFootnoteText}>{activePostAction?.valueProp || 'Choose your posting style'}</Text>
                                </View>

                                {postActionMode === 'hiring_need' && typeof onOpenPostJobForm === 'function' ? (
                                    <TouchableOpacity style={styles.fullFormCta} activeOpacity={0.86} onPress={onOpenPostJobForm}>
                                        <Ionicons name="document-text-outline" size={14} color="#5b21b6" />
                                        <Text style={styles.fullFormCtaText}>Need full JD flow? Open Post Job Form</Text>
                                        <Ionicons name="chevron-forward" size={14} color="#5b21b6" />
                                    </TouchableOpacity>
                                ) : null}

                                <View style={styles.captionSectionHeader}>
                                    <View style={styles.captionTitleWrap}>
                                        <Ionicons name="sparkles-outline" size={15} color="#111111" />
                                        <Text style={styles.captionSectionTitle}>Caption</Text>
                                    </View>
                                    <Text style={styles.captionCounter}>{String(composerText || '').length}/2200</Text>
                                </View>

                                <View style={styles.captionRow}>
                                    <Image source={{ uri: avatarUri }} style={styles.captionAvatar} />
                                    <TextInput
                                        ref={captionInputRef}
                                        style={styles.captionInput}
                                        value={composerText}
                                        onChangeText={onComposerTextChange}
                                        placeholder={placeholder}
                                        placeholderTextColor="#6b7280"
                                        multiline
                                        autoFocus
                                        textAlignVertical="top"
                                    />
                                </View>

                                <View style={styles.quickPromptHeader}>
                                    <Text style={styles.quickPromptLabel}>Smart suggestions</Text>
                                    <TouchableOpacity style={styles.starterButton} activeOpacity={0.82} onPress={handleApplyStarter}>
                                        <Text style={styles.starterButtonText}>Use starter</Text>
                                    </TouchableOpacity>
                                </View>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptRow}>
                                    {promptPool.map((prompt) => (
                                        <TouchableOpacity
                                            key={prompt}
                                            style={styles.promptChip}
                                            activeOpacity={0.85}
                                            onPress={() => handleApplyPrompt(prompt)}
                                        >
                                            <Text style={styles.promptChipText}>{prompt}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </ScrollView>
                            </View>

                            {hasVisualMedia ? (
                                <View style={styles.selectedMediaCard}>
                                    {normalizedMediaType === 'PHOTOS' ? (
                                        <Image source={{ uri: mediaPreviewUri }} style={styles.selectedMediaThumb} />
                                    ) : (
                                        <View style={styles.selectedVideoThumb}>
                                            <Ionicons name="videocam" size={18} color="#ffffff" />
                                        </View>
                                    )}
                                    <View style={styles.selectedMediaMeta}>
                                        <Text style={styles.selectedMediaTitle}>{mediaCountText}</Text>
                                        <Text style={styles.selectedMediaSubtitle}>Attached to this post</Text>
                                    </View>
                                    <TouchableOpacity style={styles.removeMediaBtn} onPress={onRemoveComposerMedia} activeOpacity={0.85}>
                                        <Ionicons name="close" size={16} color="#111111" />
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            {normalizedMediaType === 'VOICE' ? (
                                <View style={styles.voiceCard}>
                                    <View style={styles.voiceMeta}>
                                        <Text style={styles.voiceTitle}>
                                            {isVoiceRecording ? 'Recording voice note...' : (hasVoiceAsset ? 'Voice note attached' : 'No voice note attached')}
                                        </Text>
                                        <Text style={styles.voiceSubtitle}>Add a caption and share.</Text>
                                    </View>
                                    {isVoiceRecording ? (
                                        <TouchableOpacity style={styles.voiceActionBtn} onPress={onStopVoiceRecording} activeOpacity={0.85}>
                                            <Text style={styles.voiceActionText}>Stop</Text>
                                        </TouchableOpacity>
                                    ) : hasVoiceAsset ? (
                                        <TouchableOpacity style={styles.voiceActionBtnMuted} onPress={onRemoveComposerMedia} activeOpacity={0.85}>
                                            <Text style={styles.voiceActionTextMuted}>Remove</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <TouchableOpacity style={styles.voiceActionBtn} onPress={onVoicePress} activeOpacity={0.85}>
                                            <Text style={styles.voiceActionText}>Record</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            ) : null}

                            <View style={styles.optionsCard}>
                                <TouchableOpacity
                                    style={styles.optionRow}
                                    onPress={() => {
                                        setShowAudiencePanel((prev) => !prev);
                                    }}
                                    activeOpacity={0.85}
                                >
                                    <View style={styles.optionLeftWrap}>
                                        <View style={styles.optionIconBubble}>
                                            <Ionicons name="earth-outline" size={14} color="#111111" />
                                        </View>
                                        <Text style={styles.optionLabel}>Audience</Text>
                                    </View>
                                    <View style={styles.optionValueWrap}>
                                        <Text style={styles.optionValue}>{visibilityLabel}</Text>
                                        <Ionicons name={showAudiencePanel ? 'chevron-up' : 'chevron-down'} size={16} color="#111111" />
                                    </View>
                                </TouchableOpacity>

                                {showAudiencePanel ? (
                                    <View style={styles.audiencePanel}>
                                        {AUDIENCE_OPTIONS.map((item) => {
                                            const active = normalizeToken(item.key) === normalizeToken(normalizedVisibility);
                                            return (
                                                <TouchableOpacity
                                                    key={item.key}
                                                    style={[styles.audienceOptionRow, active && styles.audienceOptionRowActive]}
                                                    activeOpacity={0.86}
                                                    onPress={() => handleSelectAudience(item.key)}
                                                >
                                                    <View style={styles.audienceOptionTextWrap}>
                                                        <Text style={[styles.audienceOptionTitle, active && styles.audienceOptionTitleActive]}>{item.label}</Text>
                                                        <Text style={styles.audienceOptionHelper}>{item.helper}</Text>
                                                    </View>
                                                    {active ? <Ionicons name="checkmark-circle" size={18} color={ACCENT} /> : <Ionicons name="chevron-forward" size={15} color="#9ca3af" />}
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                ) : null}

                                <View style={styles.optionDivider} />

                                <View style={styles.smartFieldBlock}>
                                    <View style={styles.optionLeftWrap}>
                                        <View style={styles.optionIconBubble}>
                                            <Ionicons name="person-add-outline" size={14} color="#111111" />
                                        </View>
                                        <Text style={styles.optionLabel}>Tag people</Text>
                                    </View>

                                    {selectedTags.length > 0 ? (
                                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagChipRow}>
                                            {selectedTags.map((name) => (
                                                <View key={name} style={styles.tagChip}>
                                                    <Text style={styles.tagChipText}>{name}</Text>
                                                    <TouchableOpacity onPress={() => handleRemoveTag(name)} style={styles.tagChipRemove} activeOpacity={0.8}>
                                                        <Ionicons name="close" size={12} color="#111111" />
                                                    </TouchableOpacity>
                                                </View>
                                            ))}
                                        </ScrollView>
                                    ) : null}

                                    <View style={styles.smartInputWrap}>
                                        <TextInput
                                            style={styles.smartInput}
                                            value={tagQuery}
                                            onChangeText={setTagQuery}
                                            placeholder="Type a name to tag..."
                                            placeholderTextColor="#9ca3af"
                                        />
                                    </View>

                                    {availableTagSuggestions.length > 0 ? (
                                        <View style={styles.suggestionList}>
                                            {availableTagSuggestions.map((name) => (
                                                <TouchableOpacity key={name} style={styles.suggestionRow} activeOpacity={0.85} onPress={() => handleAddTag(name)}>
                                                    <Text style={styles.suggestionText}>{name}</Text>
                                                    <Ionicons name="arrow-up-circle-outline" size={16} color={ACCENT_DARK} />
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    ) : null}
                                </View>

                                <View style={styles.optionDivider} />

                                <View style={styles.smartFieldBlock}>
                                    <View style={styles.optionLeftWrap}>
                                        <View style={styles.optionIconBubble}>
                                            <Ionicons name="location-outline" size={14} color="#111111" />
                                        </View>
                                        <Text style={styles.optionLabel}>Location</Text>
                                    </View>

                                    <View style={styles.smartInputWrap}>
                                        <TextInput
                                            style={styles.smartInput}
                                            value={locationQuery}
                                            onChangeText={handleLocationInputChange}
                                            placeholder="Add a city or choose Remote..."
                                            placeholderTextColor="#9ca3af"
                                        />
                                    </View>

                                    {locationValue ? (
                                        <View style={styles.locationBadge}>
                                            <Ionicons name="pin" size={13} color={ACCENT_DARK} />
                                            <Text style={styles.locationBadgeText}>{locationValue}</Text>
                                        </View>
                                    ) : null}

                                    {availableLocationSuggestions.length > 0 ? (
                                        <View style={styles.suggestionList}>
                                            {availableLocationSuggestions.map((name) => (
                                                <TouchableOpacity key={name} style={styles.suggestionRow} activeOpacity={0.85} onPress={() => handleSelectLocation(name)}>
                                                    <Text style={styles.suggestionText}>{name}</Text>
                                                    <Ionicons name="arrow-forward-circle-outline" size={16} color={ACCENT_DARK} />
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    ) : null}
                                </View>
                            </View>
                        </ScrollView>
                    )}

                    <View style={styles.bottomBar}>
                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'PHOTOS' && styles.bottomActionBtnActive]}
                            onPress={onPhotosPress}
                            activeOpacity={0.85}
                        >
                            <IconImage size={14} color={normalizedMediaType === 'PHOTOS' ? '#ffffff' : '#111111'} />
                            <Text style={[styles.bottomActionText, normalizedMediaType === 'PHOTOS' && styles.bottomActionTextActive]}>Photo</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'VIDEO' && styles.bottomActionBtnActive]}
                            onPress={onVideoPress}
                            activeOpacity={0.85}
                        >
                            <IconVideo size={14} color={normalizedMediaType === 'VIDEO' ? '#ffffff' : '#111111'} />
                            <Text style={[styles.bottomActionText, normalizedMediaType === 'VIDEO' && styles.bottomActionTextActive]}>Video</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.bottomActionBtn, normalizedMediaType === 'VOICE' && styles.bottomActionBtnActive]}
                            onPress={onVoicePress}
                            activeOpacity={0.85}
                        >
                            <IconMic size={14} color={normalizedMediaType === 'VOICE' ? '#ffffff' : '#111111'} />
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
        backgroundColor: '#f8f4ff',
    },
    modalHeader: {
        paddingHorizontal: 14,
        paddingTop: SPACING.md,
        paddingBottom: SPACING.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(255,255,255,0.94)',
    },
    headerIconBtn: {
        width: 36,
        height: 36,
        borderRadius: RADIUS.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f4efff',
        borderWidth: 1,
        borderColor: '#e3d7ff',
    },
    modalTitle: {
        color: '#17182b',
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
        paddingHorizontal: 15,
        paddingVertical: 8,
    },
    headerPrimaryText: {
        color: '#ffffff',
        fontSize: 12,
        fontWeight: '800',
    },
    modalDivider: {
        height: 1,
        backgroundColor: '#ece2ff',
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
    captionScroll: {
        flex: 1,
    },
    captionScrollContent: {
        paddingHorizontal: 14,
        paddingTop: 14,
        paddingBottom: 24,
        gap: 12,
    },
    captionSectionCard: {
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#e7dcff',
        backgroundColor: 'rgba(255,255,255,0.96)',
        paddingHorizontal: 12,
        paddingVertical: 12,
        shadowColor: '#7c3aed',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.05,
        shadowRadius: 12,
        elevation: 2,
    },
    actionChoiceHeader: {
        marginBottom: 8,
    },
    actionChoiceLabel: {
        color: '#4c1d95',
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    actionChoiceHelper: {
        color: '#6b7280',
        fontSize: 11,
        fontWeight: '600',
    },
    actionChoiceRow: {
        gap: 8,
        paddingBottom: 6,
    },
    actionChoicePill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#d8b4fe',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 11,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    actionChoicePillActive: {
        backgroundColor: '#6d28d9',
        borderColor: '#6d28d9',
    },
    actionChoicePillTitle: {
        color: '#4c1d95',
        fontSize: 11.5,
        fontWeight: '700',
    },
    actionChoicePillTitleActive: {
        color: '#ffffff',
    },
    actionChoiceIconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#c4b5fd',
    },
    actionChoiceIconWrapActive: {
        borderColor: '#7c3aed',
        backgroundColor: 'rgba(255,255,255,0.22)',
    },
    actionChoiceTextWrap: {
        flex: 1,
    },
    actionChoiceKickerPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#faf9ff',
        paddingHorizontal: 8,
        paddingVertical: 4,
    },
    actionChoiceKickerPillActive: {
        borderColor: 'rgba(255,255,255,0.35)',
        backgroundColor: 'rgba(255,255,255,0.14)',
    },
    actionChoiceKickerText: {
        color: '#6d28d9',
        fontSize: 9.5,
        fontWeight: '800',
        letterSpacing: 0.6,
    },
    actionChoiceKickerTextActive: {
        color: '#ffffff',
    },
    actionChoiceCheckBadge: {
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#d9ccfb',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
    },
    actionChoiceCheckBadgeActive: {
        borderColor: 'rgba(255,255,255,0.35)',
        backgroundColor: 'rgba(255,255,255,0.2)',
    },
    actionChoiceValueText: {
        flex: 1,
        color: '#5b21b6',
        fontSize: 11,
        fontWeight: '700',
    },
    actionChoiceValueTextActive: {
        color: 'rgba(255,255,255,0.95)',
    },
    actionChoiceTitle: {
        color: '#1f123f',
        fontSize: 12.5,
        fontWeight: '800',
        marginBottom: 1,
    },
    actionChoiceTitleActive: {
        color: '#ffffff',
    },
    actionChoiceHint: {
        color: '#6b7280',
        fontSize: 10.5,
        fontWeight: '600',
    },
    actionChoiceHintActive: {
        color: 'rgba(255,255,255,0.88)',
    },
    actionChoiceFootnote: {
        marginBottom: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e9d5ff',
        backgroundColor: '#faf8ff',
        paddingHorizontal: 10,
        paddingVertical: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    actionChoiceFootnoteText: {
        flex: 1,
        color: '#5b21b6',
        fontSize: 11,
        fontWeight: '600',
    },
    fullFormCta: {
        marginBottom: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#faf8ff',
        paddingHorizontal: 10,
        paddingVertical: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    fullFormCtaText: {
        flex: 1,
        color: '#5b21b6',
        fontSize: 11.5,
        fontWeight: '700',
    },
    captionSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    captionTitleWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    captionSectionTitle: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '700',
    },
    captionCounter: {
        color: '#6b7280',
        fontSize: 11,
        fontWeight: '600',
    },
    captionRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    captionAvatar: {
        width: 34,
        height: 34,
        borderRadius: RADIUS.full,
        marginTop: 4,
        borderWidth: 1,
        borderColor: '#ddd6fe',
    },
    captionInput: {
        flex: 1,
        minHeight: 150,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#ddd6fe',
        backgroundColor: '#ffffff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: '#111111',
        fontSize: 13.5,
        lineHeight: 20,
    },
    quickPromptLabel: {
        marginTop: 8,
        marginBottom: 6,
        color: '#374151',
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
    quickPromptHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 4,
    },
    starterButton: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#d8b4fe',
        backgroundColor: '#ffffff',
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    starterButtonText: {
        color: '#6d28d9',
        fontSize: 10.5,
        fontWeight: '700',
    },
    promptRow: {
        gap: 8,
        paddingBottom: 4,
    },
    promptChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#faf5ff',
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    promptChipText: {
        color: '#111111',
        fontSize: 11,
        fontWeight: '700',
    },
    selectedMediaCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e7dcff',
        backgroundColor: '#fbf7ff',
        paddingHorizontal: 10,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    selectedMediaThumb: {
        width: 58,
        height: 58,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#c4b5fd',
    },
    selectedVideoThumb: {
        width: 58,
        height: 58,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#111111',
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectedMediaMeta: {
        flex: 1,
    },
    selectedMediaTitle: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 2,
    },
    selectedMediaSubtitle: {
        color: '#4b5563',
        fontSize: 11,
        fontWeight: '600',
    },
    removeMediaBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d1d5db',
    },
    voiceCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e7dcff',
        backgroundColor: '#fbf7ff',
        paddingHorizontal: 10,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    voiceMeta: {
        flex: 1,
    },
    voiceTitle: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 2,
    },
    voiceSubtitle: {
        color: '#4b5563',
        fontSize: 11,
        fontWeight: '600',
    },
    voiceActionBtn: {
        borderRadius: 999,
        backgroundColor: ACCENT,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    voiceActionText: {
        color: '#ffffff',
        fontSize: 11,
        fontWeight: '800',
    },
    voiceActionBtnMuted: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#ffffff',
        paddingHorizontal: 11,
        paddingVertical: 7,
    },
    voiceActionTextMuted: {
        color: '#111111',
        fontSize: 11,
        fontWeight: '700',
    },
    optionsCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e7dcff',
        backgroundColor: 'rgba(255,255,255,0.97)',
        overflow: 'hidden',
    },
    optionRow: {
        paddingHorizontal: 12,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionDivider: {
        height: 1,
        backgroundColor: '#ede9fe',
        marginLeft: 12,
    },
    optionLeftWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
    },
    optionIconBubble: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#d1d5db',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb',
    },
    optionLabel: {
        color: '#111111',
        fontSize: 13,
        fontWeight: '700',
    },
    optionValueWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    optionValue: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '700',
    },
    audiencePanel: {
        backgroundColor: '#faf8ff',
        borderTopWidth: 1,
        borderTopColor: '#ede9fe',
    },
    audienceOptionRow: {
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: '#ede9fe',
    },
    audienceOptionRowActive: {
        backgroundColor: '#f3e8ff',
    },
    audienceOptionTextWrap: {
        flex: 1,
        paddingRight: 8,
    },
    audienceOptionTitle: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '700',
        marginBottom: 2,
    },
    audienceOptionTitleActive: {
        color: ACCENT_DARK,
    },
    audienceOptionHelper: {
        color: '#6b7280',
        fontSize: 10.5,
        fontWeight: '600',
    },
    smartFieldBlock: {
        paddingHorizontal: 12,
        paddingVertical: 11,
        gap: 8,
    },
    smartInputWrap: {
        borderWidth: 1,
        borderColor: '#ddd6fe',
        borderRadius: 10,
        backgroundColor: '#ffffff',
    },
    smartInput: {
        minHeight: 40,
        color: '#111111',
        fontSize: 13,
        fontWeight: '600',
        paddingHorizontal: 11,
        paddingVertical: 8,
    },
    tagChipRow: {
        gap: 6,
    },
    tagChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#f3e8ff',
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    tagChipText: {
        color: '#111111',
        fontSize: 11,
        fontWeight: '700',
    },
    tagChipRemove: {
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
    },
    locationBadge: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#c4b5fd',
        backgroundColor: '#f3e8ff',
        paddingHorizontal: 9,
        paddingVertical: 5,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    locationBadgeText: {
        color: '#111111',
        fontSize: 11,
        fontWeight: '700',
    },
    suggestionList: {
        borderWidth: 1,
        borderColor: '#ede9fe',
        borderRadius: 10,
        backgroundColor: '#faf8ff',
        overflow: 'hidden',
    },
    suggestionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 11,
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: '#ede9fe',
    },
    suggestionText: {
        color: '#111111',
        fontSize: 12,
        fontWeight: '600',
    },
    bottomBar: {
        borderTopWidth: 1,
        borderTopColor: '#e5dbff',
        backgroundColor: 'rgba(255,255,255,0.95)',
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 14,
        flexDirection: 'row',
        gap: 8,
    },
    bottomActionBtn: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e6dbff',
        backgroundColor: '#faf8ff',
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    bottomActionBtnActive: {
        borderColor: ACCENT,
        backgroundColor: ACCENT,
    },
    bottomActionText: {
        color: '#111111',
        fontSize: 11,
        fontWeight: '700',
    },
    bottomActionTextActive: {
        color: '#ffffff',
    },
});
