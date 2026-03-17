/**
 * useFeedData.js
 * Domain hook: Feed tab — post list, composer, likes, comments, profile preview, job preview.
 * Shared deps passed as params: showPulseToast, currentUserId, currentUserName, isEmployerRole, userInfo
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import {
    CONNECT_READ_TIMEOUT_MS,
    FEED_PAGE_SIZE,
    FEED_VISIBILITY_OPTIONS,
    isDemoRecord,
    hasBlockedDemoIdentity,
    timeAgo,
    getApiErrorMessage,
    getSavedPostsStorageKey,
    parseSavedPostIds,
    mapCommentEntries,
    extractCommentEntriesFromPayload,
    normalizePickedAssets,
    extractFeedRowsFromPayload,
    extractFeedHasMoreFromPayload,
} from './connectUtils';
import {
    SCREENSHOT_MOCKS_ENABLED,
    SCREENSHOT_FEED_LIKE_MAP,
    SCREENSHOT_FEED_LIKED_IDS,
    SCREENSHOT_FEED_POSTS,
    SCREENSHOT_FEED_SAVED_IDS,
} from '../../config/screenshotMocks';

const CONNECT_PENDING_POST_REPORTS_KEY = '@connect_pending_post_reports';
const INITIAL_FEED_POSTS = [];
const FEED_CACHE_PREFIX = '@connect_feed_cache_';
const FEED_CACHE_LIMIT = 50;
const FEED_LOAD_CAP_MS = 5000;
const NEW_POSTS_TOAST_THRESHOLD = 1;

/**
 * @param {object} params
 * @param {string} params.currentUserId
 * @param {string} params.currentUserName
 * @param {boolean} params.isEmployerRole
 * @param {object} params.userInfo
 * @param {function} params.showPulseToast
 */
export function useFeedData({
    currentUserId,
    currentUserName,
    isEmployerRole,
    userInfo,
    showPulseToast,
}) {
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMediaType, setComposerMediaType] = useState(null);
    const [composerText, setComposerText] = useState('');
    const [composerVisibility, setComposerVisibility] = useState('community');
    const [composerMediaAssets, setComposerMediaAssets] = useState([]);
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [postingFeed, setPostingFeed] = useState(false);
    const [feedPosts, setFeedPosts] = useState(INITIAL_FEED_POSTS);
    const [jobPreview, setJobPreview] = useState(null);
    const [jobPreviewVisible, setJobPreviewVisible] = useState(false);
    const [jobPreviewLoading, setJobPreviewLoading] = useState(false);
    const [jobPreviewApplying, setJobPreviewApplying] = useState(false);
    const [appliedJobPreviewIds, setAppliedJobPreviewIds] = useState(new Set());
    const [feedPage, setFeedPage] = useState(1);
    const [hasMoreFeed, setHasMoreFeed] = useState(true);
    const [loadingFeed, setLoadingFeed] = useState(false);
    const [feedPullRefreshing, setFeedPullRefreshing] = useState(false);
    const [loadingMoreFeed, setLoadingMoreFeed] = useState(false);
    const [feedError, setFeedError] = useState('');
    const [likedPostIds, setLikedPostIds] = useState(new Set());
    const [savedPostIds, setSavedPostIds] = useState(new Set());
    const [likeCountMap, setLikeCountMap] = useState({});
    const [commentsByPostId, setCommentsByPostId] = useState({});
    const [activeCommentPostId, setActiveCommentPostId] = useState(null);
    const [commentInputMap, setCommentInputMap] = useState({});
    const [feedProfileVisible, setFeedProfileVisible] = useState(false);
    const [feedProfileLoading, setFeedProfileLoading] = useState(false);
    const [feedProfileData, setFeedProfileData] = useState(null);
    const voiceRecordingRef = useRef(null);
    const feedProfileRequestIdRef = useRef(0);
    const feedFetchRequestIdRef = useRef(0);
    const feedRefreshingInFlightRef = useRef(false);
    const feedPagingInFlightRef = useRef(false);
    const feedLastLoadMoreAtRef = useRef(0);
    const feedPostsLengthRef = useRef(0);

    const savedPostsStorageKey = useMemo(
        () => getSavedPostsStorageKey(currentUserId || 'guest'),
        [currentUserId]
    );
    const feedCacheKey = useMemo(
        () => `${FEED_CACHE_PREFIX}${currentUserId || 'guest'}`,
        [currentUserId]
    );
    const [feedVisibility, setFeedVisibility] = useState('community');
    const [showSavedOnly, setShowSavedOnly] = useState(false);
    const lastLoadedAtRef = useRef(0);
    const [showNewPostsToast, setShowNewPostsToast] = useState('');
    const isRetryingRef = useRef(false);

    const applyScreenshotMocks = useCallback(() => {
        if (!SCREENSHOT_MOCKS_ENABLED) return;
        setFeedPosts(SCREENSHOT_FEED_POSTS);
        setHasMoreFeed(false);
        setLoadingFeed(false);
        setFeedPullRefreshing(false);
        setLoadingMoreFeed(false);
        setFeedError('');
        setFeedPage(1);
        setLikedPostIds(new Set(SCREENSHOT_FEED_LIKED_IDS));
        setSavedPostIds(new Set(SCREENSHOT_FEED_SAVED_IDS));
        setLikeCountMap(SCREENSHOT_FEED_LIKE_MAP);
    }, []);

    // Keep a ref-based length to avoid stale closures in fetchFeedPosts
    useEffect(() => { feedPostsLengthRef.current = feedPosts.length; }, [feedPosts.length]);

    // Hydrate saved post IDs from AsyncStorage on mount / user change
    useEffect(() => {
        let mounted = true;
        const loadFeedCache = async () => {
            try {
                const cachedRaw = await AsyncStorage.getItem(feedCacheKey);
                if (!mounted || !cachedRaw) return;
                const cached = JSON.parse(cachedRaw);
                if (Array.isArray(cached) && cached.length) {
                    setFeedPosts(cached);
                }
            } catch (_e) {
                if (!mounted) return;
            }
        };
        const loadSavedPostIds = async () => {
            try {
                const savedPostIdsRaw = await AsyncStorage.getItem(savedPostsStorageKey);
                if (!mounted) return;
                setSavedPostIds(parseSavedPostIds(savedPostIdsRaw));
            } catch (_error) {
                if (!mounted) return;
                setSavedPostIds(new Set());
            }
        };
        loadFeedCache();
        loadSavedPostIds();
        return () => { mounted = false; };
    }, [feedCacheKey, savedPostsStorageKey]);

    useEffect(() => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
        }
    }, [applyScreenshotMocks]);

    const mapApiPost = useCallback((post) => {
        const authorName = post?.user?.name || 'Member';
        const authorId = String(post?.authorId?._id || post?.authorId || post?.user?._id || post?.user || '').trim();
        const authorPrimaryRole = String(post?.user?.primaryRole || post?.user?.activeRole || '').trim().toLowerCase();
        const normalizedPostType = String(post?.postType || post?.type || 'status').toLowerCase();
        const mappedType = post?.type === 'photo' ? 'gallery' : (post?.type || normalizedPostType || 'text');
        const jobId = String(post?.meta?.jobId || post?.jobId || '').trim();
        const vouchCount = Array.isArray(post?.vouches) ? post.vouches.length : 0;
        const vouched = Array.isArray(post?.vouches)
            ? post.vouches.some((id) => String(id) === currentUserId)
            : false;
        const liked = Array.isArray(post?.likes)
            ? post.likes.some((id) => String(id?._id || id || '').trim() === currentUserId)
            : Boolean(post?.isLiked || post?.liked);
        const commentEntries = mapCommentEntries(post?.comments, String(post?._id || 'post'));
        return {
            _id: String(post?._id || `post-${Date.now()}`),
            type: mappedType,
            author: authorName,
            authorId,
            authorPrimaryRole: authorPrimaryRole === 'employer' ? 'employer' : 'worker',
            role: post?.user?.primaryRole === 'employer' ? 'Employer' : 'Job Seeker',
            time: timeAgo(post?.createdAt),
            karma: 0,
            text: post?.content || '',
            likes: Array.isArray(post?.likes) ? post.likes.length : 0,
            liked,
            comments: commentEntries.length,
            commentEntries,
            vouched,
            vouchCount,
            avatar: String(
                post?.user?.avatar
                || post?.authorId?.avatar
                || post?.avatar
                || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=d1d5db&color=111111&rounded=true`
            ),
            duration: mappedType === 'voice' ? '0:15' : undefined,
            mediaUrl: post?.mediaUrl || '',
            media: Array.isArray(post?.media) ? post.media : [],
            images: Array.isArray(post?.media)
                ? post.media.map((item) => String(item?.url || '').trim()).filter(Boolean)
                : [],
            visibility: String(post?.visibility || 'community').toLowerCase(),
            postType: normalizedPostType || 'status',
            jobId: jobId || '',
            isJobPost: normalizedPostType === 'job' && Boolean(jobId),
            meta: post?.meta && typeof post.meta === 'object' ? post.meta : {},
        };
    }, [currentUserId]);

    const fetchFeedPosts = useCallback(async (pageToLoad = 1, replace = false, options = {}) => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
            return;
        }
        const safePage = Math.max(1, Number(pageToLoad || 1));
        const showRefreshIndicator = Boolean(options?.showRefreshIndicator);
        const forceReplace = Boolean(options?.forceReplace);
        if (replace) setFeedError('');
        if (replace) {
            if (feedRefreshingInFlightRef.current) return;
            feedRefreshingInFlightRef.current = true;
            setLoadingFeed(true);
            if (showRefreshIndicator) {
                setFeedPullRefreshing(true);
            }
            // Cancel any load-more in flight
            feedPagingInFlightRef.current = false;
            setLoadingMoreFeed(false);
        } else {
            if (feedRefreshingInFlightRef.current) return;
            if (!hasMoreFeed && !forceReplace) return;
            if (feedPagingInFlightRef.current) return;
            const nowMs = Date.now();
            if ((nowMs - feedLastLoadMoreAtRef.current) < 600) return;
            feedLastLoadMoreAtRef.current = nowMs;
            feedPagingInFlightRef.current = true;
            setLoadingMoreFeed(true);
        }

        const requestId = feedFetchRequestIdRef.current + 1;
        feedFetchRequestIdRef.current = requestId;
        let loadCap = null;

        try {
            loadCap = setTimeout(() => {
                if (replace) {
                    feedRefreshingInFlightRef.current = false;
                    setLoadingFeed(false);
                    if (showRefreshIndicator) setFeedPullRefreshing(false);
                } else {
                    feedPagingInFlightRef.current = false;
                    setLoadingMoreFeed(false);
                }
                if (!feedPostsLengthRef.current) {
                    setFeedError('We could not load your feed right now. Showing cached posts if available.');
                }
            }, FEED_LOAD_CAP_MS);
            const { data } = await client.get('/api/feed/posts', {
                params: {
                    page: safePage,
                    limit: FEED_PAGE_SIZE,
                    visibility: feedVisibility || 'community',
                    location: userInfo?.city || userInfo?.district || '',
                },
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 2,
                __skipApiErrorHandler: true,
                headers: { 'If-None-Match': lastLoadedAtRef.current ? String(lastLoadedAtRef.current) : undefined },
            });
            if (requestId !== feedFetchRequestIdRef.current) return;

            const feedRows = extractFeedRowsFromPayload(data);
            const apiPosts = Array.isArray(feedRows)
                ? feedRows.filter((post) => post && typeof post === 'object' && !isDemoRecord(post))
                : [];
            const mappedPosts = apiPosts
                .map(mapApiPost)
                .filter((post) => !hasBlockedDemoIdentity(post?.author));

            let appendedCount = 0;
            setFeedPosts((prev) => {
                if (replace) {
                    appendedCount = mappedPosts.length;
                    return mappedPosts;
                }
                const seen = new Set(prev.map((post) => String(post._id)));
                const dedupedAppend = mappedPosts.filter((post) => !seen.has(String(post._id)));
                appendedCount = dedupedAppend.length;
                return [...prev, ...dedupedAppend];
            });

            setFeedPage(safePage);
            const hasMoreFromApi = extractFeedHasMoreFromPayload(data, apiPosts.length);
            const shouldKeepPaging = replace
                ? hasMoreFromApi
                : (hasMoreFromApi && appendedCount > 0);
            setHasMoreFeed(shouldKeepPaging);
            lastLoadedAtRef.current = Date.now();

            if (replace) {
                const newCount = Math.max(0, mappedPosts.length - feedPostsLengthRef.current);
                if (newCount >= NEW_POSTS_TOAST_THRESHOLD && mappedPosts.length > 0) {
                    setShowNewPostsToast(`${newCount} new post${newCount > 1 ? 's' : ''}`);
                    setTimeout(() => setShowNewPostsToast(''), 1800);
                }
            }

            const incomingLikeCounts = {};
            const incomingLikedPostIds = [];
            mappedPosts.forEach((post) => {
                const postId = String(post?._id || '').trim();
                if (!postId) return;
                incomingLikeCounts[postId] = Math.max(0, Number(post?.likes || 0));
                if (Boolean(post?.liked)) {
                    incomingLikedPostIds.push(postId);
                }
            });

            setLikeCountMap((prev) => {
                if (replace) return incomingLikeCounts;
                const next = { ...(prev && typeof prev === 'object' ? prev : {}) };
                Object.entries(incomingLikeCounts).forEach(([postId, count]) => {
                    if (!Object.prototype.hasOwnProperty.call(next, postId)) {
                        next[postId] = count;
                    }
                });
                return next;
            });

                setLikedPostIds((prev) => {
                    const next = replace ? new Set() : new Set(prev);
                    incomingLikedPostIds.forEach((postId) => next.add(postId));
                    return next;
                });

            // Persist cache (mapped posts) bounded
            setFeedPosts((prev) => {
                const nextList = replace ? mappedPosts : [...prev, ...mappedPosts.filter((p) => !prev.some((q) => q._id === p._id))];
                AsyncStorage.setItem(feedCacheKey, JSON.stringify(nextList.slice(0, FEED_CACHE_LIMIT))).catch(() => {});
                return nextList;
            });
        } catch (_error) {
            const hasVisiblePosts = feedPostsLengthRef.current > 0;
            if (replace) {
                if (hasVisiblePosts) {
                    setFeedError('');
                } else {
                    setFeedError('We could not load your feed right now. Pull down or tap retry to try again.');
                    setHasMoreFeed(true);
                }
            } else {
                setFeedError('Could not load more posts right now. Pull down to refresh and try again.');
                setHasMoreFeed(true);
            }
        } finally {
            if (replace) {
                feedRefreshingInFlightRef.current = false;
                setLoadingFeed(false);
                if (showRefreshIndicator) setFeedPullRefreshing(false);
            } else {
                feedPagingInFlightRef.current = false;
                setLoadingMoreFeed(false);
            }
            if (loadCap) clearTimeout(loadCap);
        }
    }, [feedCacheKey, hasMoreFeed, mapApiPost]);

    const fetchPostComments = useCallback(async (postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return [];
        const endpoints = [
            `/api/feed/posts/${encodeURIComponent(normalizedPostId)}/comments`,
            `/api/feed/posts/${encodeURIComponent(normalizedPostId)}`,
        ];
        for (const endpoint of endpoints) {
            try {
                const { data } = await client.get(endpoint, { __skipApiErrorHandler: true, timeout: 4000 });
                const parsedEntries = extractCommentEntriesFromPayload(data, normalizedPostId);
                if (!Array.isArray(parsedEntries)) continue;
                setCommentsByPostId((prev) => ({ ...prev, [normalizedPostId]: parsedEntries }));
                setFeedPosts((prev) => prev.map((post) => (
                    String(post?._id || '') === normalizedPostId
                        ? { ...post, comments: parsedEntries.length, commentEntries: parsedEntries }
                        : post
                )));
                return parsedEntries;
            } catch (_error) {
                // Try fallback endpoint; if both fail, surface a light error.
                setFeedError((prev) => prev || 'Could not load comments right now.');
            }
        }
        return [];
    }, []);

    const toggleSavedFilter = useCallback(() => {
        setShowSavedOnly((prev) => !prev);
    }, []);

    const setVisibility = useCallback((visibility) => {
        const next = String(visibility || '').toLowerCase();
        setFeedVisibility(next || 'community');
    }, []);

    const stopVoiceRecording = useCallback(async ({ discard = false } = {}) => {
        const activeRecording = voiceRecordingRef.current;
        if (!activeRecording) {
            setIsVoiceRecording(false);
            return null;
        }
        try {
            await activeRecording.stopAndUnloadAsync();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
                interruptionModeIOS: 1,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                staysActiveInBackground: false,
            });
            const recordingUri = activeRecording.getURI();
            voiceRecordingRef.current = null;
            setIsVoiceRecording(false);
            if (discard || !recordingUri) {
                if (discard) setComposerMediaAssets([]);
                return null;
            }
            const voiceAsset = {
                id: `voice-${Date.now()}`,
                uri: recordingUri,
                type: 'audio',
                width: 0, height: 0, durationMs: 0, fileSize: 0, mimeType: 'audio/m4a',
            };
            setComposerMediaAssets([voiceAsset]);
            return voiceAsset;
        } catch (_error) {
            voiceRecordingRef.current = null;
            setIsVoiceRecording(false);
            if (!discard) Alert.alert('Recording failed', 'Could not stop voice recording cleanly. Please try again.');
            return null;
        }
    }, []);

    const startVoiceRecording = useCallback(async () => {
        try {
            const permission = await Audio.requestPermissionsAsync();
            if (permission?.status !== 'granted') {
                Alert.alert('Microphone required', 'Please allow microphone access to post voice updates.');
                return;
            }
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
                interruptionModeIOS: 1,
                shouldDuckAndroid: true,
                playThroughEarpieceAndroid: false,
                staysActiveInBackground: false,
            });
            const recording = new Audio.Recording();
            await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
            await recording.startAsync();
            voiceRecordingRef.current = recording;
            setComposerOpen(true);
            setComposerMediaType('VOICE');
            setComposerMediaAssets([]);
            setIsVoiceRecording(true);
        } catch (_error) {
            setIsVoiceRecording(false);
            voiceRecordingRef.current = null;
            Alert.alert('Recording unavailable', 'Could not start voice recording right now.');
        }
    }, []);

    const pickPhotoMedia = useCallback(async () => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission?.status !== 'granted') {
            Alert.alert('Photos permission required', 'Allow access to your photos to attach images.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: 5,
            quality: 0.85,
        });
        if (result?.canceled) return;
        const normalized = normalizePickedAssets(result?.assets || []);
        if (!normalized.length) {
            Alert.alert('No photo selected', 'Select at least one photo to continue.');
            return;
        }
        setComposerOpen(true);
        setComposerMediaType('PHOTOS');
        setComposerMediaAssets(normalized.slice(0, 5));
    }, []);

    const pickVideoMedia = useCallback(async () => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission?.status !== 'granted') {
            Alert.alert('Video permission required', 'Allow access to your videos to attach one.');
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['videos'],
            allowsMultipleSelection: false,
            quality: 0.85,
        });
        if (result?.canceled) return;
        const normalized = normalizePickedAssets(result?.assets || []);
        if (!normalized.length) {
            Alert.alert('No video selected', 'Select one video to continue.');
            return;
        }
        setComposerOpen(true);
        setComposerMediaType('VIDEO');
        setComposerMediaAssets([normalized[0]]);
    }, []);

    const handleMediaButtonClick = useCallback(async (type) => {
        const normalizedType = String(type || '').toUpperCase();
        if (isVoiceRecording && normalizedType !== 'VOICE') {
            await stopVoiceRecording({ discard: true });
        }
        if (normalizedType === 'VOICE') {
            if (isVoiceRecording) { await stopVoiceRecording(); return; }
            await startVoiceRecording();
            return;
        }
        if (normalizedType === 'PHOTOS') { await pickPhotoMedia(); return; }
        if (normalizedType === 'VIDEO') { await pickVideoMedia(); return; }
        setComposerOpen(true);
        setComposerMediaType('TEXT');
    }, [isVoiceRecording, pickPhotoMedia, pickVideoMedia, startVoiceRecording, stopVoiceRecording]);

    const handleInputAreaClick = useCallback(() => {
        setComposerOpen(true);
        setComposerMediaType('TEXT');
    }, []);

    const handleCancelComposer = useCallback(async () => {
        await stopVoiceRecording({ discard: true });
        setComposerOpen(false);
        setComposerMediaType(null);
        setComposerText('');
        setComposerVisibility('community');
        setComposerMediaAssets([]);
    }, [stopVoiceRecording]);

    const handleRemoveComposerMedia = useCallback(() => setComposerMediaAssets([]), []);

    const handleToggleComposerVisibility = useCallback(() => {
        setComposerVisibility((prev) => {
            const current = String(prev || 'community').toLowerCase();
            const currentIndex = FEED_VISIBILITY_OPTIONS.indexOf(current);
            const nextIndex = currentIndex < 0 ? 0 : ((currentIndex + 1) % FEED_VISIBILITY_OPTIONS.length);
            return FEED_VISIBILITY_OPTIONS[nextIndex];
        });
    }, []);

    const handleSetComposerVisibility = useCallback((nextVisibility) => {
        const normalizedVisibility = String(nextVisibility || '').toLowerCase().trim();
        if (!FEED_VISIBILITY_OPTIONS.includes(normalizedVisibility)) return;
        setComposerVisibility(normalizedVisibility);
    }, []);

    const handleStopVoiceRecording = useCallback(async () => {
        await stopVoiceRecording();
    }, [stopVoiceRecording]);

    const handlePost = useCallback(async () => {
        if (postingFeed) return;
        if (isVoiceRecording) {
            try {
                await stopVoiceRecording();
            } catch (_err) {
                Alert.alert('Recording issue', 'Could not stop the recording. Please try again.');
                return;
            }
        }
        if (composerMediaType === 'VOICE' && !composerMediaAssets.length) {
            Alert.alert('Voice note missing', 'Record a voice note, then publish.'); return;
        }
        if (composerMediaType === 'PHOTOS' && !composerMediaAssets.length) {
            Alert.alert('Photo missing', 'Select at least one photo before publishing.'); return;
        }
        if (composerMediaType === 'VIDEO' && !composerMediaAssets.length) {
            Alert.alert('Video missing', 'Select one video before publishing.'); return;
        }
        const feedType = composerMediaType === 'VOICE' ? 'voice'
            : composerMediaType === 'PHOTOS' ? 'photo'
            : composerMediaType === 'VIDEO' ? 'video' : 'text';
        const mappedLocalType = feedType === 'photo' ? 'gallery' : feedType;
        const safeContent = String(composerText || '').trim();
        const resolvedContent = safeContent || (
            feedType === 'voice' ? 'Shared a voice update.'
            : feedType === 'photo' ? 'Shared a photo update.'
            : feedType === 'video' ? 'Shared a video update.' : ''
        );
        if (!resolvedContent) {
            Alert.alert('Add your message', 'Please write a short message before publishing.'); return;
        }
        const mediaPayload = composerMediaAssets
            .map((asset) => ({
                url: String(asset?.uri || '').trim(),
                mimeType: String(asset?.mimeType || '').trim(),
                ...(Number.isFinite(Number(asset?.fileSize)) && Number(asset.fileSize) > 0
                    ? { sizeBytes: Number(asset.fileSize) } : {}),
            }))
            .filter((entry) => entry.url);
        const optimisticPostId = `local-${Date.now()}`;
        const optimisticPost = {
            _id: optimisticPostId,
            type: mappedLocalType,
            author: currentUserName,
            authorId: currentUserId,
            authorPrimaryRole: isEmployerRole ? 'employer' : 'worker',
            role: isEmployerRole ? 'Employer' : 'Job Seeker',
            time: 'Just now',
            karma: 0,
            text: resolvedContent,
            likes: 0, comments: 0, commentEntries: [], vouched: false, vouchCount: 0,
            avatar: String(
                userInfo?.avatar || userInfo?.profilePicture
                || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserName)}&background=d1d5db&color=111111&rounded=true`
            ),
            duration: mappedLocalType === 'voice'
                ? (() => {
                    const seconds = Math.floor(Number(composerMediaAssets?.[0]?.durationMs || 0) / 1000);
                    const mins = Math.floor(Math.max(0, seconds) / 60);
                    const secs = Math.max(0, seconds) % 60;
                    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
                })()
                : undefined,
            mediaUrl: mediaPayload[0]?.url || '',
            media: mediaPayload,
            images: mappedLocalType === 'gallery'
                ? mediaPayload.map((item) => String(item?.url || '')).filter(Boolean) : [],
            visibility: FEED_VISIBILITY_OPTIONS.includes(String(composerVisibility || '').toLowerCase())
                ? String(composerVisibility || '').toLowerCase() : 'community',
            postType: mappedLocalType === 'voice' ? 'voice' : 'status',
            isJobPost: false,
            meta: { optimistic: true },
        };
        setFeedPosts((prev) => [optimisticPost, ...prev]);
        setLikeCountMap((prev) => ({ ...prev, [optimisticPostId]: 0 }));
        setComposerText('');
        setComposerOpen(false);
        setComposerMediaType(null);
        setComposerVisibility('community');
        setComposerMediaAssets([]);
        setPostingFeed(true);
        try {
            const { data } = await client.post('/api/feed/posts', {
                type: feedType,
                content: resolvedContent,
                visibility: FEED_VISIBILITY_OPTIONS.includes(String(composerVisibility || '').toLowerCase())
                    ? String(composerVisibility || '').toLowerCase() : 'community',
                mediaUrl: mediaPayload[0]?.url || '',
                media: mediaPayload,
            }, { __skipApiErrorHandler: true });
            if (!data?.post) throw new Error('Post creation response is invalid.');
            const createdPost = mapApiPost(data.post);
            setFeedPosts((prev) => prev.map((post) => (
                String(post?._id || '') === optimisticPostId ? createdPost : post
            )));
            setLikeCountMap((prev) => {
                const next = { ...prev };
                delete next[optimisticPostId];
                next[createdPost._id] = Number(createdPost?.likes || 0);
                return next;
            });
        } catch (error) {
            removeFeedPostLocally(optimisticPostId);
            Alert.alert('Post failed', 'We could not publish your post. Please try again.');
        } finally {
            setPostingFeed(false);
        }
    }, [
        composerMediaAssets, composerMediaType, composerText, composerVisibility,
        currentUserId, currentUserName, isVoiceRecording, isEmployerRole,
        mapApiPost, postingFeed, stopVoiceRecording, userInfo?.avatar, userInfo?.profilePicture,
    ]);

    const handleToggleLike = useCallback(async (postId, options = {}) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;
        const forceLike = Boolean(options?.forceLike);
        const fallbackLikeCount = Math.max(0, Number(
            likeCountMap?.[normalizedPostId]
            ?? feedPosts.find((post) => String(post?._id || '').trim() === normalizedPostId)?.likes
            ?? 0
        ));
        const previousLiked = likedPostIds.has(normalizedPostId);
        if (forceLike && previousLiked) return;
        const optimisticLiked = !previousLiked;
        const optimisticCount = Math.max(0, fallbackLikeCount + (optimisticLiked ? 1 : -1));
        setLikedPostIds((prev) => {
            const next = new Set(prev);
            if (optimisticLiked) next.add(normalizedPostId); else next.delete(normalizedPostId);
            return next;
        });
        setLikeCountMap((prev) => ({ ...prev, [normalizedPostId]: optimisticCount }));
        const requestVariants = [
            () => client.post(`/api/feed/posts/${normalizedPostId}/like`, {}, { __skipApiErrorHandler: true }),
            () => client.post(`/api/feed/posts/${normalizedPostId}/likes`, {}, { __skipApiErrorHandler: true }),
        ];
        for (const request of requestVariants) {
            try {
                const response = await request();
                const data = (response?.data && typeof response.data === 'object') ? response.data : {};
                const nested = (data?.data && typeof data.data === 'object') ? data.data
                    : ((data?.result && typeof data.result === 'object') ? data.result
                    : ((data?.payload && typeof data.payload === 'object') ? data.payload : data));
                const postPayload = (nested?.post && typeof nested.post === 'object') ? nested.post : {};
                const resolvedLikedCandidate = [nested?.liked, nested?.isLiked, postPayload?.liked, postPayload?.isLiked]
                    .find((value) => typeof value === 'boolean');
                const resolvedLikesCountCandidate = [
                    nested?.likesCount, nested?.likeCount, nested?.likes,
                    postPayload?.likesCount, postPayload?.likeCount, postPayload?.likes,
                ].find((value) => Number.isFinite(Number(value)));
                const resolvedLiked = typeof resolvedLikedCandidate === 'boolean' ? Boolean(resolvedLikedCandidate) : optimisticLiked;
                const resolvedLikeCount = Number.isFinite(Number(resolvedLikesCountCandidate))
                    ? Math.max(0, Number(resolvedLikesCountCandidate)) : optimisticCount;
                setLikedPostIds((prev) => {
                    const next = new Set(prev);
                    if (resolvedLiked) next.add(normalizedPostId); else next.delete(normalizedPostId);
                    return next;
                });
                setLikeCountMap((prev) => ({ ...prev, [normalizedPostId]: resolvedLikeCount }));
                return;
            } catch (_error) { /* Try fallback */ }
        }
    }, [feedPosts, likeCountMap, likedPostIds]);

    const handleToggleSavePost = useCallback((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;
        setSavedPostIds((prev) => {
            const next = new Set(prev);
            if (next.has(normalizedPostId)) next.delete(normalizedPostId); else next.add(normalizedPostId);
            AsyncStorage.setItem(savedPostsStorageKey, JSON.stringify(Array.from(next)))
                .catch(() => Alert.alert('Save Failed', 'Could not update saved posts right now.'));
            return next;
        });
    }, [savedPostsStorageKey]);

    const handleSubmitComment = useCallback(async (postId) => {
        const normalizedPostId = String(postId || '').trim();
        const text = (commentInputMap[normalizedPostId] || '').trim();
        if (!text || !normalizedPostId) return;
        const optimisticCommentId = `optimistic-comment-${Date.now()}`;
        const optimisticComment = { id: optimisticCommentId, text, author: currentUserName, time: 'Just now' };
        setCommentInputMap((prev) => ({ ...prev, [normalizedPostId]: '' }));
        setCommentsByPostId((prev) => {
            const existing = Array.isArray(prev?.[normalizedPostId]) ? prev[normalizedPostId] : [];
            return { ...prev, [normalizedPostId]: [...existing, optimisticComment] };
        });
        setFeedPosts((prev) => prev.map((post) => {
            if (String(post?._id || '') !== normalizedPostId) return post;
            const existing = Array.isArray(post?.commentEntries) ? post.commentEntries : [];
            return { ...post, commentEntries: [...existing, optimisticComment], comments: Math.max(Number(post?.comments || 0) + 1, existing.length + 1) };
        }));
        try {
            await client.post(`/api/feed/posts/${normalizedPostId}/comments`, { text }, { __skipApiErrorHandler: true });
            await fetchPostComments(normalizedPostId);
        } catch (error) {
            setCommentsByPostId((prev) => {
                const existing = Array.isArray(prev?.[normalizedPostId]) ? prev[normalizedPostId] : [];
                return { ...prev, [normalizedPostId]: existing.filter((item) => String(item?.id || '') !== optimisticCommentId) };
            });
            setFeedPosts((prev) => prev.map((post) => {
                if (String(post?._id || '') !== normalizedPostId) return post;
                const existing = Array.isArray(post?.commentEntries) ? post.commentEntries : [];
                const filtered = existing.filter((item) => String(item?.id || '') !== optimisticCommentId);
                return { ...post, commentEntries: filtered, comments: filtered.length };
            }));
            Alert.alert('Comment Failed', 'Could not add comment right now.');
        }
    }, [commentInputMap, currentUserName, fetchPostComments]);

    const handleToggleComment = useCallback((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;
        setActiveCommentPostId((prev) => (prev === normalizedPostId ? null : normalizedPostId));
        fetchPostComments(normalizedPostId);
    }, [fetchPostComments]);

    const handleCommentInputChange = useCallback((postId, text) => {
        setCommentInputMap((prev) => ({ ...prev, [postId]: text }));
    }, []);

    const handleLoadMoreFeed = useCallback(() => {
        if (hasMoreFeed && !loadingMoreFeed && !loadingFeed) {
            fetchFeedPosts(feedPage + 1, false);
        }
    }, [hasMoreFeed, loadingMoreFeed, loadingFeed, fetchFeedPosts, feedPage]);

    const handleRefreshFeed = useCallback(() => {
        if (feedRefreshingInFlightRef.current) return;
        fetchFeedPosts(1, true, { showRefreshIndicator: true });
    }, [fetchFeedPosts]);

    const handleRetryFeed = useCallback(() => {
        fetchFeedPosts(1, true, { showRefreshIndicator: true, forceReplace: true });
    }, [fetchFeedPosts]);

    const closeJobPreview = useCallback(() => {
        setJobPreviewVisible(false);
        setJobPreview(null);
        setJobPreviewLoading(false);
        setJobPreviewApplying(false);
    }, []);

    const closeFeedProfile = useCallback(() => {
        feedProfileRequestIdRef.current += 1;
        setFeedProfileVisible(false);
        setFeedProfileLoading(false);
        setFeedProfileData(null);
    }, []);

    const openJobPreviewFromPost = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const jobId = String(safePost?.jobId || safePost?.meta?.jobId || '').trim();
        if (!jobId) return;
        setJobPreviewVisible(true);
        setJobPreviewLoading(true);
        try {
            const { data } = await client.get(`/api/jobs/${jobId}`, {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
            });
            const job = data?.job || data?.data || data;
            if (job && typeof job === 'object') {
                setJobPreview({
                    _id: String(job?._id || jobId),
                    title: String(job?.title || 'Job Opportunity'),
                    company: String(job?.companyName || job?.employer || 'Employer'),
                    location: String(job?.location || 'Location not specified'),
                    salary: String(job?.salary || job?.salaryRange || job?.pay || 'Negotiable'),
                    description: String(job?.description || ''),
                    requirements: Array.isArray(job?.requirements) ? job.requirements : [],
                    type: String(job?.jobType || job?.type || 'Full-time'),
                    postedAt: timeAgo(job?.createdAt),
                });
            } else {
                setJobPreview(null);
            }
        } catch (_error) {
            setJobPreview(null);
        } finally {
            setJobPreviewLoading(false);
        }
    }, []);

    const handleOpenFeedProfile = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const authorId = String(safePost?.authorId || safePost?.user?._id || '').trim();
        if (!authorId) return;
        const requestId = feedProfileRequestIdRef.current + 1;
        feedProfileRequestIdRef.current = requestId;
        setFeedProfileVisible(true);
        setFeedProfileLoading(true);
        setFeedProfileData(null);
        try {
            const { data } = await client.get(`/api/users/${authorId}/profile`, {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
            });
            if (requestId !== feedProfileRequestIdRef.current) return;
            setFeedProfileData(data?.profile || data || null);
        } catch (_error) {
            if (requestId !== feedProfileRequestIdRef.current) return;
            setFeedProfileData(null);
        } finally {
            if (requestId === feedProfileRequestIdRef.current) setFeedProfileLoading(false);
        }
    }, []);

    const handleVouch = useCallback(async (postId, post = null) => {
        try {
            const { data } = await client.post(`/api/feed/posts/${postId}/vouch`, {}, { __skipApiErrorHandler: true });
            setFeedPosts((prev) => prev.map((p) => (
                p._id === postId
                    ? { ...p, vouched: Boolean(data?.vouched), vouchCount: Number(data?.vouchCount || 0) }
                    : p
            )));
            const safePost = (post && typeof post === 'object') ? post : {};
            const isJobPost = Boolean(safePost?.isJobPost) || String(safePost?.postType || '').toLowerCase() === 'job';
            const hasJobId = Boolean(String(safePost?.jobId || safePost?.meta?.jobId || '').trim());
            if (isJobPost && hasJobId) await openJobPreviewFromPost(safePost);
        } catch (error) {
            Alert.alert('Vouch Failed', 'Could not update vouch right now.');
        }
    }, [openJobPreviewFromPost]);

    const removeFeedPostLocally = useCallback((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;
        setFeedPosts((prev) => prev.filter((post) => String(post?._id || '').trim() !== normalizedPostId));
        setLikeCountMap((prev) => { const next = { ...prev }; delete next[normalizedPostId]; return next; });
        setLikedPostIds((prev) => { const next = new Set(prev); next.delete(normalizedPostId); return next; });
        setSavedPostIds((prev) => {
            const next = new Set(prev);
            next.delete(normalizedPostId);
            AsyncStorage.setItem(savedPostsStorageKey, JSON.stringify(Array.from(next))).catch(() => {});
            return next;
        });
        setCommentsByPostId((prev) => { const next = { ...prev }; delete next[normalizedPostId]; return next; });
        setCommentInputMap((prev) => { const next = { ...prev }; delete next[normalizedPostId]; return next; });
        setActiveCommentPostId((prev) => (prev === normalizedPostId ? null : prev));
    }, [savedPostsStorageKey]);

    const handleDeletePost = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const postId = String(safePost?._id || '').trim();
        if (!postId) return { ok: false, message: 'Post not found.' };
        const ownerId = String(safePost?.authorId?._id || safePost?.authorId || safePost?.user?._id || '').trim();
        const canDelete = Boolean(postId.startsWith('local-') || (ownerId && ownerId === currentUserId));
        if (!canDelete) return { ok: false, message: 'You can only delete your own post.' };
        removeFeedPostLocally(postId);
        if (postId.startsWith('local-')) return { ok: true };
        for (const request of [
            () => client.delete(`/api/feed/posts/${postId}`, { __skipApiErrorHandler: true }),
            () => client.delete(`/api/posts/${postId}`, { __skipApiErrorHandler: true }),
        ]) {
            try { await request(); return { ok: true }; } catch (_error) { /* Try fallback */ }
        }
        return { ok: true, localOnly: true };
    }, [currentUserId, removeFeedPostLocally]);

    const handleReportPost = useCallback(async (post, reason = 'spam') => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const postId = String(safePost?._id || '').trim();
        if (!postId) return { ok: false, message: 'Post not found.' };
        const normalizedReason = ['spam', 'harassment', 'misleading'].includes(String(reason || '').toLowerCase())
            ? String(reason || '').toLowerCase() : 'spam';
        const requestOptions = { __skipApiErrorHandler: true };
        for (const request of [
            () => client.post('/api/reports', { targetId: postId, targetType: 'post', reason: normalizedReason }, requestOptions),
            () => client.post(`/api/feed/posts/${postId}/report`, { reason: normalizedReason }, requestOptions),
        ]) {
            try { await request(); return { ok: true }; } catch (_error) { /* Try fallback */ }
        }
        try {
            const rawQueue = await AsyncStorage.getItem(CONNECT_PENDING_POST_REPORTS_KEY);
            const parsedQueue = JSON.parse(String(rawQueue || '[]'));
            const queue = Array.isArray(parsedQueue) ? parsedQueue : [];
            queue.push({ postId, reason: normalizedReason, queuedAt: new Date().toISOString() });
            await AsyncStorage.setItem(CONNECT_PENDING_POST_REPORTS_KEY, JSON.stringify(queue.slice(-50)));
            return { ok: true, queued: true };
        } catch (_error) {
            return { ok: false, message: 'Could not submit report right now.' };
        }
    }, []);

    const resetFeedState = useCallback(() => {
        setComposerOpen(false);
        setComposerMediaType(null);
        setComposerText('');
        setComposerVisibility('community');
        setComposerMediaAssets([]);
        setIsVoiceRecording(false);
        setFeedPosts([]);
        setJobPreview(null);
        setJobPreviewVisible(false);
        setJobPreviewLoading(false);
        setJobPreviewApplying(false);
        setAppliedJobPreviewIds(new Set());
        setFeedPage(1);
        setHasMoreFeed(false);
        setLoadingFeed(false);
        setFeedPullRefreshing(false);
        setLoadingMoreFeed(false);
        setFeedError('');
        setLikedPostIds(new Set());
        setSavedPostIds(new Set());
        setLikeCountMap({});
        setCommentsByPostId({});
        setActiveCommentPostId(null);
        setCommentInputMap({});
        setPostingFeed(false);
        setFeedProfileVisible(false);
        setFeedProfileLoading(false);
        setFeedProfileData(null);
        feedRefreshingInFlightRef.current = false;
        feedPagingInFlightRef.current = false;
        feedLastLoadMoreAtRef.current = 0;
    }, []);

    return {
        // State
        composerOpen, composerMediaType, composerText, composerVisibility,
        composerMediaAssets, isVoiceRecording, postingFeed, feedPosts,
        jobPreview, jobPreviewVisible, jobPreviewLoading, jobPreviewApplying,
        appliedJobPreviewIds, feedPage, hasMoreFeed, loadingFeed,
        feedPullRefreshing, loadingMoreFeed, feedError, likedPostIds, savedPostIds,
        likeCountMap, commentsByPostId, activeCommentPostId, commentInputMap,
        feedProfileVisible, feedProfileLoading, feedProfileData,
        voiceRecordingRef,
        // Setters (for shared use by orchestrator)
        setComposerText, setSavedPostIds, setIsVoiceRecording,
        setJobPreviewApplying, setAppliedJobPreviewIds,
        // Handlers
        fetchFeedPosts, fetchPostComments, mapApiPost,
        handleMediaButtonClick, handleInputAreaClick, handleCancelComposer,
        handleRemoveComposerMedia, handleToggleComposerVisibility,
        handleSetComposerVisibility, handleStopVoiceRecording, handlePost,
        handleToggleLike, handleToggleSavePost, handleSubmitComment,
        handleToggleComment, handleCommentInputChange, handleLoadMoreFeed,
        handleRefreshFeed, handleRetryFeed, closeJobPreview, closeFeedProfile,
        openJobPreviewFromPost, handleOpenFeedProfile, handleVouch,
        handleDeletePost, handleReportPost, resetFeedState,
        // Filters
        feedVisibility, setFeedVisibility, showSavedOnly, setShowSavedOnly,
        toggleSavedFilter, setVisibility,
        showNewPostsToast,
    };
}
