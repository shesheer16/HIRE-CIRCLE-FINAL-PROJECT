/**
 * useConnectData.js — Thin Orchestrator
 *
 * Composes 5 domain hooks (useFeedData, usePulseData, useAcademyData, useBountiesData, useCirclesData)
 * and wires cross-domain dependencies. Preserves the exact same public API (return shape)
 * that ConnectScreen.js and all sub-tabs consume.
 *
 * Domain hooks live in:
 *   ./useFeedData.js      – Feed tab (posts, composer, likes, comments, profiles, job preview)
 *   ./usePulseData.js     – Pulse tab (radar, gig apply, nearby pros)
 *   ./useAcademyData.js   – Academy tab (courses, enrollment, mentors)
 *   ./useBountiesData.js  – Bounties tab (bounty list, creation, referrals)
 *   ./useCirclesData.js   – Circles tab (communities, chat, members, rates)
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Animated } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import { AuthContext } from '../../context/AuthContext';
import {
    CONNECT_READ_TIMEOUT_MS,
    getApiErrorMessage,
} from './connectUtils';

import { useFeedData } from './useFeedData';
import { usePulseData } from './usePulseData';
import { useAcademyData } from './useAcademyData';
import { useBountiesData } from './useBountiesData';
import { useCirclesData } from './useCirclesData';

export { CONNECT_TABS } from './connectUtils';

const CONNECT_REFRESH_REVISION_KEY = '@connect_content_revision';

export function useConnectData() {
    const { userInfo } = useContext(AuthContext);
    const currentUserId = String(userInfo?._id || '');
    const currentUserName = String(userInfo?.name || 'You').trim() || 'You';
    const normalizedActiveRole = String(userInfo?.activeRole || userInfo?.primaryRole || userInfo?.role || 'worker').toLowerCase();
    const isEmployerRole = normalizedActiveRole === 'employer';

    // ─── Shared / Navigation State ────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState('Feed');
    const [showMyProfile, setShowMyProfile] = useState(false);
    const [resettingConnectData, setResettingConnectData] = useState(false);
    const [pulseToast, setPulseToast] = useState(null);
    const [bountyToast, setBountyToast] = useState(null);
    const pulseToastTimeoutRef = useRef(null);
    const bountyToastTimeoutRef = useRef(null);
    const bootstrapLoadKeyRef = useRef('');
    const connectRefreshRevisionRef = useRef('');

    // ─── Shared Toasts ────────────────────────────────────────────────────────
    const showPulseToast = useCallback((message) => {
        setPulseToast(message);
        if (pulseToastTimeoutRef.current) clearTimeout(pulseToastTimeoutRef.current);
        pulseToastTimeoutRef.current = setTimeout(() => setPulseToast(null), 2500);
    }, []);

    const showBountyToast = useCallback((message) => {
        setBountyToast(message);
        if (bountyToastTimeoutRef.current) clearTimeout(bountyToastTimeoutRef.current);
        bountyToastTimeoutRef.current = setTimeout(() => setBountyToast(null), 3000);
    }, []);

    // ─── Shared Identity Resolver ─────────────────────────────────────────────
    const resolveWorkerApplicationIdentity = useCallback(async () => {
        const safeStoredWorkerProfileId = String(
            userInfo?.workerProfileId || await AsyncStorage.getItem('@worker_profile_id') || ''
        ).trim();
        if (safeStoredWorkerProfileId) return safeStoredWorkerProfileId;
        try {
            const { data } = await client.get('/api/users/profile', {
                __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, params: { role: 'worker' },
            });
            const workerProfileId = String(data?.profile?._id || '').trim();
            if (workerProfileId) {
                await AsyncStorage.setItem('@worker_profile_id', workerProfileId);
                return workerProfileId;
            }
        } catch (_error) { /* Fall back to user id */ }
        return String(userInfo?._id || '').trim();
    }, [userInfo?._id, userInfo?.workerProfileId]);

    // ═══════════════════════════════════════════════════════════════════════════
    // Domain Hooks
    // ═══════════════════════════════════════════════════════════════════════════

    const feed = useFeedData({
        currentUserId,
        currentUserName,
        isEmployerRole,
        userInfo,
        showPulseToast,
    });

    const pulse = usePulseData({
        isEmployerRole,
        showPulseToast,
        resolveWorkerApplicationIdentity,
        openJobPreviewFromPost: feed.openJobPreviewFromPost,
    });

    const academy = useAcademyData({
        showPulseToast,
        setShowMyProfile,
    });

    const bounties = useBountiesData({
        currentUserId,
        showBountyToast,
    });

    const circles = useCirclesData({
        showPulseToast,
    });

    // ─── Cross-domain: applyFromJobPreview (Feed ← Pulse shared identity) ────
    const applyFromJobPreview = useCallback(async () => {
        const jobId = String(feed.jobPreview?._id || '').trim();
        if (!jobId || !userInfo?._id) return;
        if (isEmployerRole) return;
        if (feed.appliedJobPreviewIds.has(jobId)) {
            showPulseToast('You already applied to this job.');
            return;
        }
        feed.setJobPreviewApplying(true);
        try {
            const workerId = await resolveWorkerApplicationIdentity();
            if (!workerId) {
                Alert.alert('Apply failed', 'Complete your worker profile before applying.');
                feed.setJobPreviewApplying(false);
                return;
            }
            await client.post('/api/applications', {
                jobId, workerId, initiatedBy: 'worker',
            }, { __skipApiErrorHandler: true });
            feed.setAppliedJobPreviewIds((prev) => new Set(prev).add(jobId));
            showPulseToast('Application sent successfully.');
            feed.closeJobPreview();
        } catch (error) {
            const message = getApiErrorMessage(error, 'Could not apply right now.');
            Alert.alert('Apply failed', message);
        } finally {
            feed.setJobPreviewApplying(false);
        }
    }, [feed.appliedJobPreviewIds, feed.closeJobPreview, feed.jobPreview?._id, feed.setAppliedJobPreviewIds, feed.setJobPreviewApplying, isEmployerRole, resolveWorkerApplicationIdentity, showPulseToast, userInfo?._id]);

    // ─── Circle Chat Auto-scroll ──────────────────────────────────────────────
    const safeCircleMessageCount = Array.isArray(circles.circleMessages) ? circles.circleMessages.length : 0;
    useEffect(() => {
        if (!circles.circleChatRef.current) return;
        if (circles.circleScrollTimeoutRef.current) clearTimeout(circles.circleScrollTimeoutRef.current);
        const timeout = setTimeout(() => {
            circles.circleChatRef.current?.scrollToEnd({ animated: true });
        }, 80);
        circles.circleScrollTimeoutRef.current = timeout;
        return () => { clearTimeout(timeout); circles.circleScrollTimeoutRef.current = null; };
    }, [safeCircleMessageCount]);

    // ─── Bootstrap Effect (initial data load) ────────────────────────────────
    useEffect(() => {
        const nextKey = `${String(currentUserId || '')}:${isEmployerRole ? 'employer' : 'worker'}`;
        if (!currentUserId) return;
        if (bootstrapLoadKeyRef.current === nextKey) return;
        bootstrapLoadKeyRef.current = nextKey;
        academy.academyMentorsAutoLoadedRef.current = false;
        pulse.nearbyProsAutoLoadedRef.current = false;
        feed.fetchFeedPosts(1, true);
        const backgroundBootstrapTimer = setTimeout(() => {
            pulse.fetchPulseItems();
            academy.fetchAcademyData({ refreshMentorsOnly: false, includeMentorMatch: false });
            circles.fetchCircles();
            bounties.fetchBounties();
        }, 180);
        return () => clearTimeout(backgroundBootstrapTimer);
    }, [currentUserId, isEmployerRole, feed.fetchFeedPosts, pulse.fetchPulseItems, academy.fetchAcademyData, circles.fetchCircles, bounties.fetchBounties]);

    useFocusEffect(
        useCallback(() => {
            if (!currentUserId) return undefined;

            const syncDeletedJobRefresh = async () => {
                try {
                    const nextRevision = String(await AsyncStorage.getItem(CONNECT_REFRESH_REVISION_KEY) || '').trim();
                    if (!nextRevision || nextRevision === connectRefreshRevisionRef.current) {
                        return;
                    }
                    connectRefreshRevisionRef.current = nextRevision;
                    await Promise.allSettled([
                        feed.fetchFeedPosts(1, true),
                        pulse.fetchPulseItems(),
                        isEmployerRole ? pulse.fetchNearbyPros() : Promise.resolve(),
                    ]);
                } catch (_error) {
                    // Ignore refresh token failures and keep the current tab state intact.
                }
            };

            syncDeletedJobRefresh();
            return undefined;
        }, [currentUserId, feed.fetchFeedPosts, isEmployerRole, pulse.fetchNearbyPros, pulse.fetchPulseItems])
    );

    // ─── Lazy-load nearby pros on Pulse tab ──────────────────────────────────
    useEffect(() => {
        if (String(activeTab || '').toLowerCase() !== 'pulse') return;
        if (!isEmployerRole) return;
        if (pulse.nearbyProsAutoLoadedRef.current) return;
        pulse.nearbyProsAutoLoadedRef.current = true;
        pulse.fetchNearbyPros();
    }, [activeTab, pulse.fetchNearbyPros, isEmployerRole]);

    // ─── Lazy-load mentor match on Academy tab ───────────────────────────────
    useEffect(() => {
        if (String(activeTab || '').toLowerCase() !== 'academy') return;
        if (academy.academyMentorsAutoLoadedRef.current) return;
        academy.academyMentorsAutoLoadedRef.current = true;
        const hasOverviewData = academy.academyCourses.length > 0 || academy.enrolledCourses.length > 0;
        academy.fetchAcademyData({ refreshMentorsOnly: hasOverviewData, includeMentorMatch: true });
    }, [activeTab, academy.academyCourses.length, academy.enrolledCourses.length, academy.fetchAcademyData]);

    // ─── Pulse Animation + Cleanup ───────────────────────────────────────────
    useEffect(() => {
        if (pulse.pulseLoopRef.current) return undefined;
        pulse.pulseLoopRef.current = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse.pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
                Animated.timing(pulse.pulseAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
            ])
        );
        pulse.pulseLoopRef.current.start();
        return () => {
            if (pulse.pulseLoopRef.current) { pulse.pulseLoopRef.current.stop(); pulse.pulseLoopRef.current = null; }
            if (pulseToastTimeoutRef.current) { clearTimeout(pulseToastTimeoutRef.current); pulseToastTimeoutRef.current = null; }
            if (bountyToastTimeoutRef.current) { clearTimeout(bountyToastTimeoutRef.current); bountyToastTimeoutRef.current = null; }
            if (circles.circleScrollTimeoutRef.current) { clearTimeout(circles.circleScrollTimeoutRef.current); circles.circleScrollTimeoutRef.current = null; }
            const activeVoiceRecording = feed.voiceRecordingRef.current;
            if (activeVoiceRecording) {
                feed.voiceRecordingRef.current = null;
                feed.setIsVoiceRecording(false);
                activeVoiceRecording.stopAndUnloadAsync().catch(() => {});
            }
        };
    }, [pulse.pulseAnim]);

    // ═══════════════════════════════════════════════════════════════════════════
    // clearConnectLocalState / clearConnectHistory
    // ═══════════════════════════════════════════════════════════════════════════

    const clearConnectLocalState = useCallback(() => {
        feed.resetFeedState();
        pulse.resetPulseState();
        circles.resetCirclesState();
        bounties.resetBountiesState();
        academy.resetAcademyState();
        setPulseToast(null);
        setBountyToast(null);
    }, [feed.resetFeedState, pulse.resetPulseState, circles.resetCirclesState, bounties.resetBountiesState, academy.resetAcademyState]);

    const clearConnectHistory = useCallback(async () => {
        if (resettingConnectData) return { ok: false, message: 'Connect cleanup is already running.' };
        setResettingConnectData(true);
        try {
            try {
                await client.delete('/api/feed/reset-connect', { params: { scope: 'all' }, __skipApiErrorHandler: true });
            } catch (error) {
                const statusCode = Number(error?.response?.status || 0);
                if (statusCode === 403) {
                    await client.delete('/api/feed/reset-connect', { params: { scope: 'self' }, __skipApiErrorHandler: true });
                } else { throw error; }
            }
            clearConnectLocalState();
            await Promise.allSettled([
                feed.fetchFeedPosts(1, true),
                pulse.fetchPulseItems(),
                pulse.fetchNearbyPros(),
                academy.fetchAcademyData({ refreshMentorsOnly: false }),
                circles.fetchCircles({ refreshing: false }),
                bounties.fetchBounties({ refreshing: false }),
            ]);
            showBountyToast('Connect history cleared.');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: getApiErrorMessage(error, 'Could not clear Connect history right now.') };
        } finally {
            setResettingConnectData(false);
        }
    }, [resettingConnectData, clearConnectLocalState, feed.fetchFeedPosts, pulse.fetchPulseItems, pulse.fetchNearbyPros, academy.fetchAcademyData, circles.fetchCircles, bounties.fetchBounties, showBountyToast]);

    // ═══════════════════════════════════════════════════════════════════════════
    // Tab Props (exact same shape as before — consumed by ConnectScreen.js)
    // ═══════════════════════════════════════════════════════════════════════════

    const currentUserAvatar = useMemo(() => {
        const displayName = String(userInfo?.name || 'User').trim() || 'User';
        return String(
            userInfo?.avatar || userInfo?.profilePicture
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=d1d5db&color=111111&rounded=true`
        );
    }, [userInfo?.avatar, userInfo?.name, userInfo?.profilePicture]);

    const feedTabProps = useMemo(() => ({
        feedPosts: feed.feedPosts,
        isEmployerRole,
        loadingFeed: feed.loadingFeed,
        feedPullRefreshing: feed.feedPullRefreshing,
        loadingMoreFeed: feed.loadingMoreFeed,
        feedError: feed.feedError,
        composerOpen: feed.composerOpen,
        composerMediaType: feed.composerMediaType,
        composerText: feed.composerText,
        composerVisibility: feed.composerVisibility,
        composerMediaAssets: feed.composerMediaAssets,
        isVoiceRecording: feed.isVoiceRecording,
        postingFeed: feed.postingFeed,
        likedPostIds: feed.likedPostIds,
        savedPostIds: feed.savedPostIds,
        likeCountMap: feed.likeCountMap,
        commentsByPostId: feed.commentsByPostId,
        activeCommentPostId: feed.activeCommentPostId,
        commentInputMap: feed.commentInputMap,
        currentUserId,
        currentUserAvatar,
        jobPreview: feed.jobPreview,
        jobPreviewVisible: feed.jobPreviewVisible,
        jobPreviewLoading: feed.jobPreviewLoading,
        jobPreviewApplying: feed.jobPreviewApplying,
        hasAppliedToPreviewJob: feed.jobPreview?._id ? feed.appliedJobPreviewIds.has(String(feed.jobPreview._id)) : false,
        onRefreshFeed: feed.handleRefreshFeed,
        onRetryFeed: () => feed.fetchFeedPosts(1, true),
        onLoadMoreFeed: feed.handleLoadMoreFeed,
        onMediaButtonClick: feed.handleMediaButtonClick,
        onInputAreaClick: feed.handleInputAreaClick,
        onCancelComposer: feed.handleCancelComposer,
        onStopVoiceRecording: feed.handleStopVoiceRecording,
        onRemoveComposerMedia: feed.handleRemoveComposerMedia,
        onPost: feed.handlePost,
        onComposerTextChange: feed.setComposerText,
        onComposerVisibilityToggle: feed.handleToggleComposerVisibility,
        onComposerVisibilitySelect: feed.handleSetComposerVisibility,
        onToggleLike: feed.handleToggleLike,
        onToggleSavePost: feed.handleToggleSavePost,
        onToggleComment: feed.handleToggleComment,
        onOpenComments: feed.fetchPostComments,
        onToggleVouch: feed.handleVouch,
        onCommentInputChange: feed.handleCommentInputChange,
        onSubmitComment: feed.handleSubmitComment,
        onReportPost: feed.handleReportPost,
        onDeletePost: feed.handleDeletePost,
        onOpenAuthorProfile: feed.handleOpenFeedProfile,
        onCloseJobPreview: feed.closeJobPreview,
        onApplyJobPreview: applyFromJobPreview,
    }), [
        feed.feedPosts, isEmployerRole, feed.loadingFeed, feed.feedPullRefreshing,
        feed.loadingMoreFeed, feed.feedError, feed.composerOpen, feed.composerMediaType,
        feed.composerText, feed.composerVisibility, feed.composerMediaAssets,
        feed.isVoiceRecording, feed.postingFeed, feed.likedPostIds, feed.savedPostIds,
        feed.likeCountMap, feed.commentsByPostId, feed.activeCommentPostId,
        feed.commentInputMap, currentUserId, currentUserAvatar,
        feed.jobPreview, feed.jobPreviewVisible, feed.jobPreviewLoading,
        feed.jobPreviewApplying, feed.appliedJobPreviewIds,
        feed.handleRefreshFeed, feed.fetchFeedPosts, feed.handleLoadMoreFeed,
        feed.handleMediaButtonClick, feed.handleInputAreaClick, feed.handleCancelComposer,
        feed.handleStopVoiceRecording, feed.handleRemoveComposerMedia, feed.handlePost,
        feed.handleToggleComposerVisibility, feed.handleSetComposerVisibility,
        feed.handleToggleLike, feed.handleToggleSavePost, feed.handleToggleComment,
        feed.fetchPostComments, feed.handleVouch, feed.handleCommentInputChange,
        feed.handleSubmitComment, feed.handleReportPost, feed.handleDeletePost,
        feed.handleOpenFeedProfile, feed.closeJobPreview, applyFromJobPreview,
    ]);

    const pulseTabProps = useMemo(() => ({
        pulseItems: pulse.pulseItems,
        nearbyPros: pulse.nearbyPros,
        isEmployerRole,
        appliedGigIds: pulse.appliedGigIds,
        hiredProIds: pulse.hiredProIds,
        radarRefreshing: pulse.radarRefreshing,
        pulseLoading: pulse.pulseLoading,
        pulseError: pulse.pulseError,
        nearbyProsError: pulse.nearbyProsError,
        pulseAnim: pulse.pulseAnim,
        onRefreshRadar: pulse.handleRefreshRadar,
        onRetryPulse: pulse.handleRefreshRadar,
        onApplyGig: pulse.handleApplyGig,
        onHirePro: pulse.handleHirePro,
    }), [
        pulse.pulseItems, pulse.nearbyPros, isEmployerRole,
        pulse.appliedGigIds, pulse.hiredProIds, pulse.radarRefreshing,
        pulse.pulseLoading, pulse.pulseError, pulse.nearbyProsError,
        pulse.pulseAnim, pulse.handleRefreshRadar, pulse.handleApplyGig, pulse.handleHirePro,
    ]);

    const circlesTabProps = useMemo(() => ({
        circles: circles.circlesList,
        joinedCircles: circles.joinedCircles,
        loading: circles.circlesLoading,
        refreshing: circles.circlesRefreshing,
        errorMessage: circles.circlesError,
        pendingJoinCircleIds: circles.pendingJoinCircleIds,
        onOpenCircle: circles.handleOpenCircle,
        onJoinCircle: circles.toggleJoinCircle,
        onRefreshCircles: circles.handleRefreshCircles,
        onCreateCircle: circles.handleCreateCircle,
    }), [
        circles.circlesList, circles.joinedCircles, circles.circlesLoading,
        circles.circlesRefreshing, circles.circlesError, circles.pendingJoinCircleIds,
        circles.handleOpenCircle, circles.toggleJoinCircle,
        circles.handleRefreshCircles, circles.handleCreateCircle,
    ]);

    const academyTabProps = useMemo(() => ({
        academyCourses: academy.academyCourses,
        enrolledCourses: academy.enrolledCourses,
        enrolledCourseIds: academy.enrolledCourseIds,
        mentors: academy.academyMentors,
        connectedMentorIds: academy.connectedMentorIds,
        isLoading: academy.academyLoading,
        isMentorRefreshing: academy.academyRefreshingMentors,
        isRefreshing: academy.academyPullRefreshing,
        academyError: academy.academyError,
        onEnrollCourse: academy.handleEnrollCourse,
        onConnectMentor: academy.handleConnectMentor,
        onRefreshMentors: academy.handleRefreshMentors,
        onRetryAcademy: academy.handleRetryAcademy,
        onRefreshAcademy: academy.handleRefreshAcademy,
        onBecomeMentor: academy.handleBecomeMentor,
        onStartReferralAction: bounties.handleStartReferralAction,
    }), [
        academy.academyCourses, academy.enrolledCourses, academy.enrolledCourseIds,
        academy.academyMentors, academy.connectedMentorIds, academy.academyLoading,
        academy.academyRefreshingMentors, academy.academyPullRefreshing, academy.academyError,
        academy.handleEnrollCourse, academy.handleConnectMentor, academy.handleRefreshMentors,
        academy.handleRetryAcademy, academy.handleRefreshAcademy, academy.handleBecomeMentor,
        bounties.handleStartReferralAction,
    ]);

    const bountiesList = useMemo(() => (Array.isArray(bounties.bountyItems) ? bounties.bountyItems : []), [bounties.bountyItems]);
    const bountyEarningsTotal = useMemo(() => Number(bounties.referralStats?.totalEarnings || 0), [bounties.referralStats?.totalEarnings]);

    const bountiesTabProps = useMemo(() => ({
        bounties: bountiesList,
        isEmployerRole,
        loading: bounties.bountiesLoading,
        refreshing: bounties.bountiesRefreshing,
        errorMessage: bounties.bountiesError,
        bountyActionInFlightId: bounties.bountyActionInFlightId,
        isCreatingBounty: bounties.bountyCreating,
        referredBountyIds: bounties.referredBountyIds,
        totalEarned: bountyEarningsTotal,
        onOpenReferModal: bounties.handleOpenReferModal,
        onRefreshBounties: bounties.handleRefreshBounties,
        onRetryBounties: bounties.handleRefreshBounties,
        onCreateBounty: bounties.handleCreateBounty,
        onSubmitBountyEntry: bounties.handleSubmitBountyEntry,
        onStartAction: bounties.handleStartReferralAction,
    }), [
        bountiesList, isEmployerRole, bounties.bountiesLoading,
        bounties.bountiesRefreshing, bounties.bountiesError,
        bounties.bountyActionInFlightId, bounties.bountyCreating,
        bounties.referredBountyIds, bountyEarningsTotal,
        bounties.handleOpenReferModal, bounties.handleRefreshBounties,
        bounties.handleCreateBounty, bounties.handleSubmitBountyEntry,
        bounties.handleStartReferralAction,
    ]);

    const circleDetailProps = useMemo(() => ({
        visible: !!circles.selectedCircle,
        selectedCircle: circles.selectedCircle,
        circleDetailLoading: circles.circleDetailLoading,
        onClose: circles.handleCloseCircleDetail,
        circleDetailTab: circles.circleDetailTab,
        onTabChange: circles.handleCircleDetailTabChange,
        onShareCommunity: circles.handleShareCircle,
        onLeaveCommunity: circles.handleLeaveCircle,
        onDeleteCommunity: circles.handleDeleteCircle,
        canDeleteCommunity: Boolean(circles.selectedCircle?.canDelete || circles.selectedCircle?.isAdmin || circles.selectedCircle?.isCreator),
        circleChatRef: circles.circleChatRef,
        chatText: circles.chatText,
        onChatTextChange: circles.setChatText,
        circleMessages: circles.circleMessages,
        onSendTextMessage: circles.handleCircleSendMessage,
        circleMembers: circles.circleMembers,
        circleCustomRates: circles.circleCustomRates,
        showCircleRateForm: circles.showCircleRateForm,
        circleRateService: circles.circleRateService,
        circleRatePrice: circles.circleRatePrice,
        onCircleRateServiceChange: circles.setCircleRateService,
        onCircleRatePriceChange: circles.setCircleRatePrice,
        onSubmitRate: circles.handleSubmitCircleRate,
        onShowRateForm: circles.handleShowCircleRateForm,
        onCancelRateForm: circles.handleCancelCircleRateForm,
    }), [
        circles.selectedCircle, circles.circleDetailLoading,
        circles.handleCloseCircleDetail, circles.circleDetailTab,
        circles.handleCircleDetailTabChange, circles.handleShareCircle,
        circles.handleLeaveCircle, circles.handleDeleteCircle,
        circles.chatText, circles.circleMessages,
        circles.handleCircleSendMessage, circles.circleMembers,
        circles.circleCustomRates, circles.showCircleRateForm,
        circles.circleRateService, circles.circleRatePrice,
        circles.handleSubmitCircleRate, circles.handleShowCircleRateForm,
        circles.handleCancelCircleRateForm,
    ]);

    const referralModalProps = useMemo(() => ({
        visible: !!bounties.referringBounty,
        referringBounty: bounties.referringBounty,
        referPhoneInput: bounties.referPhoneInput,
        referPhoneError: bounties.referPhoneError,
        isSending: bounties.referSending,
        onClose: bounties.handleCloseReferModal,
        onPhoneChange: bounties.handleReferPhoneChange,
        onSendReferral: bounties.handleSendReferral,
    }), [
        bounties.referringBounty, bounties.referPhoneInput,
        bounties.referPhoneError, bounties.referSending,
        bounties.handleCloseReferModal, bounties.handleReferPhoneChange,
        bounties.handleSendReferral,
    ]);

    return {
        userInfo,
        activeTab,
        setActiveTab,
        showMyProfile,
        setShowMyProfile,
        resettingConnectData,
        clearConnectHistory,
        feedProfileVisible: feed.feedProfileVisible,
        feedProfileLoading: feed.feedProfileLoading,
        feedProfileData: feed.feedProfileData,
        closeFeedProfile: feed.closeFeedProfile,
        feedTabProps,
        pulseTabProps,
        circlesTabProps,
        academyTabProps,
        bountiesTabProps,
        circleDetailProps,
        referralModalProps,
        pulseToast,
        bountyToast,
    };
}
