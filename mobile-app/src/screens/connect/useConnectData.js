import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Share } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import { AuthContext } from '../../context/AuthContext';

const INITIAL_FEED_POSTS = [];
const FEED_PAGE_SIZE = 20;
const CONNECT_READ_TIMEOUT_MS = 6500;
const CONNECT_SAVED_POST_IDS_KEY_PREFIX = '@connect_saved_post_ids_';
const CONNECT_PENDING_POST_REPORTS_KEY = '@connect_pending_post_reports';

const getSavedPostsStorageKey = (userId = 'guest') => (
    `${CONNECT_SAVED_POST_IDS_KEY_PREFIX}${String(userId || 'guest').trim() || 'guest'}`
);
const parseSavedPostIds = (rawValue) => {
    try {
        const parsed = JSON.parse(String(rawValue || '[]'));
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(
            parsed
                .map((id) => String(id || '').trim())
                .filter(Boolean)
        );
    } catch (_error) {
        return new Set();
    }
};

export const CONNECT_TABS = ['Feed', 'Pulse', 'Academy', 'Circles', 'Bounties'];
const FEED_VISIBILITY_OPTIONS = ['community', 'public', 'connections', 'private'];
const BLOCKED_DEMO_IDENTITIES = new Set([
    'qa user',
    'lokesh user',
    'demo user',
    'test user',
    'sample user',
    'dummy user',
    'mock user',
]);
const BLOCKED_DEMO_PATTERN = /\b(qa user|lokesh user|demo user|test user|sample user|dummy user|mock user)\b/i;
const getApiErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => {
    const message = String(error?.response?.data?.message || error?.message || '').trim();
    return message || fallback;
};
const normalizeMatchText = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9@.\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const hasBlockedDemoIdentity = (value) => {
    const normalized = normalizeMatchText(value);
    if (!normalized) return false;
    if (BLOCKED_DEMO_IDENTITIES.has(normalized)) return true;
    return BLOCKED_DEMO_PATTERN.test(normalized);
};
const isDemoRecord = (record) => {
    if (!record || typeof record !== 'object') return false;
    if (Boolean(record?.isDemo || record?.isMock || record?.mock || record?.seed || record?.sampleData || record?.testData)) {
        return true;
    }

    const candidates = [
        record?.name,
        record?.title,
        record?.author,
        record?.authorName,
        record?.content,
        record?.description,
        record?.company,
        record?.companyName,
        record?.creatorName,
        record?.email,
        record?.phone,
        record?.user?.name,
        record?.user?.email,
        record?.authorId?.name,
        record?.authorId?.email,
    ];

    return candidates.some(hasBlockedDemoIdentity);
};

const timeAgo = (dateString) => {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
};

const mapCommentEntry = (comment, index = 0, postId = 'post') => {
    if (typeof comment === 'string') {
        const text = String(comment).trim();
        if (!text) return null;
        return {
            id: `comment-${String(postId)}-${index}`,
            text,
            author: 'Member',
            time: '',
        };
    }
    if (!comment || typeof comment !== 'object') return null;
    const text = String(comment?.text || '').trim();
    if (!text) return null;
    const author = String(
        comment?.user?.name
        || comment?.author?.name
        || comment?.authorName
        || comment?.author
        || 'Member'
    ).trim() || 'Member';
    if (hasBlockedDemoIdentity(author)) return null;
    const createdAt = String(comment?.createdAt || comment?.time || '').trim();
    return {
        id: String(comment?._id || comment?.id || `comment-${String(postId)}-${index}`),
        text,
        author,
        time: createdAt ? timeAgo(createdAt) : '',
    };
};

const mapCommentEntries = (comments = [], postId = 'post') => (
    Array.isArray(comments)
        ? comments.map((comment, index) => mapCommentEntry(comment, index, postId)).filter(Boolean)
        : []
);

const findCommentsArrayInPayload = (payload = {}) => {
    const candidates = [
        payload?.comments,
        payload?.data?.comments,
        payload?.post?.comments,
        payload?.data?.post?.comments,
        payload?.item?.comments,
        payload?.data?.item?.comments,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return null;
};

const extractCommentEntriesFromPayload = (payload = {}, postId = 'post') => {
    const commentsArray = findCommentsArrayInPayload(payload);
    if (!Array.isArray(commentsArray)) {
        return null;
    }
    return mapCommentEntries(commentsArray, postId);
};

const inferMediaMimeType = (asset = {}) => {
    if (asset?.mimeType) {
        return String(asset.mimeType);
    }
    const mediaType = String(asset?.type || '').toLowerCase();
    if (mediaType === 'video') return 'video/mp4';
    if (mediaType === 'audio') return 'audio/m4a';
    if (mediaType === 'image') return 'image/jpeg';
    return 'application/octet-stream';
};

const extractFeedRowsFromPayload = (payload = {}) => {
    const candidates = [
        payload?.posts,
        payload?.data?.posts,
        payload?.data?.data?.posts,
        payload?.items,
        payload?.data?.items,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
};

const extractFeedHasMoreFromPayload = (payload = {}, rowsLength = 0) => {
    const candidates = [
        payload?.hasMore,
        payload?.data?.hasMore,
        payload?.data?.data?.hasMore,
        payload?.pagination?.hasMore,
        payload?.data?.pagination?.hasMore,
        payload?.meta?.hasMore,
        payload?.data?.meta?.hasMore,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'boolean') {
            return candidate;
        }
    }
    if (rowsLength <= 0) return false;
    return rowsLength >= FEED_PAGE_SIZE;
};

const normalizePickedAssets = (assets = []) => (
    Array.isArray(assets)
        ? assets
            .map((asset, index) => {
                const uri = String(asset?.uri || '').trim();
                if (!uri) return null;
                return {
                    id: String(asset?.assetId || `${Date.now()}-${index}`),
                    uri,
                    type: String(asset?.type || '').toLowerCase(),
                    width: Number(asset?.width || 0),
                    height: Number(asset?.height || 0),
                    durationMs: Number(asset?.duration || 0),
                    fileSize: Number(asset?.fileSize || 0),
                    mimeType: inferMediaMimeType(asset),
                };
            })
            .filter(Boolean)
        : []
);

export function useConnectData() {
    const { userInfo } = useContext(AuthContext);
    const currentUserId = String(userInfo?._id || '');
    const currentUserName = String(userInfo?.name || 'You').trim() || 'You';
    const normalizedActiveRole = String(userInfo?.activeRole || userInfo?.primaryRole || userInfo?.role || 'worker').toLowerCase();
    const isEmployerRole = normalizedActiveRole === 'employer';

    const [activeTab, setActiveTab] = useState('Feed');
    const [showMyProfile, setShowMyProfile] = useState(false);
    const [resettingConnectData, setResettingConnectData] = useState(false);

    const [joinedCircles, setJoinedCircles] = useState(new Set());
    const [selectedCircle, setSelectedCircle] = useState(null);
    const [circleDetailTab, setCircleDetailTab] = useState('DISCUSSION');
    const [chatText, setChatText] = useState('');
    const [circlesData, setCirclesData] = useState([]);
    const [circleMessages, setCircleMessages] = useState([]);
    const [circleMembers, setCircleMembers] = useState([]);
    const [circlesLoading, setCirclesLoading] = useState(true);
    const [circlesRefreshing, setCirclesRefreshing] = useState(false);
    const [circlesError, setCirclesError] = useState('');
    const [pendingJoinCircleIds, setPendingJoinCircleIds] = useState(new Set());
    const [circleDetailLoading, setCircleDetailLoading] = useState(false);
    const [circleCustomRates, setCircleCustomRates] = useState([]);
    const [showCircleRateForm, setShowCircleRateForm] = useState(false);
    const [circleRateService, setCircleRateService] = useState('');
    const [circleRatePrice, setCircleRatePrice] = useState('');
    const circleChatRef = useRef(null);
    const circleScrollTimeoutRef = useRef(null);

    const [academyCourses, setAcademyCourses] = useState([]);
    const [enrolledCourses, setEnrolledCourses] = useState([]);
    const [enrolledCourseIds, setEnrolledCourseIds] = useState(new Set());
    const [academyMentors, setAcademyMentors] = useState([]);
    const [connectedMentorIds, setConnectedMentorIds] = useState(new Set());
    const [academyLoading, setAcademyLoading] = useState(true);
    const [academyRefreshingMentors, setAcademyRefreshingMentors] = useState(false);
    const [academyError, setAcademyError] = useState('');

    const [pulseItems, setPulseItems] = useState([]);
    const [nearbyPros, setNearbyPros] = useState([]);
    const [appliedGigIds, setAppliedGigIds] = useState(new Set());
    const [hiredProIds, setHiredProIds] = useState(new Set());
    const [radarRefreshing, setRadarRefreshing] = useState(false);
    const [pulseLoading, setPulseLoading] = useState(true);
    const [pulseError, setPulseError] = useState('');
    const [nearbyProsError, setNearbyProsError] = useState('');
    const [pulseToast, setPulseToast] = useState(null);
    const pulseAnim = useRef(new Animated.Value(0.3)).current;
    const pulseLoopRef = useRef(null);
    const pulseFetchRequestIdRef = useRef(0);
    const pulseToastTimeoutRef = useRef(null);

    const [bountyItems, setBountyItems] = useState([]);
    const [referralStats, setReferralStats] = useState(null);
    const [referredBountyIds, setReferredBountyIds] = useState(new Set());
    const [bountiesLoading, setBountiesLoading] = useState(true);
    const [bountiesRefreshing, setBountiesRefreshing] = useState(false);
    const [bountiesError, setBountiesError] = useState('');
    const [bountyActionInFlightId, setBountyActionInFlightId] = useState('');
    const [bountyCreating, setBountyCreating] = useState(false);
    const [referringBounty, setReferringBounty] = useState(null);
    const [referPhoneInput, setReferPhoneInput] = useState('');
    const [referPhoneError, setReferPhoneError] = useState('');
    const [referSending, setReferSending] = useState(false);
    const [bountyToast, setBountyToast] = useState(null);
    const bountyToastTimeoutRef = useRef(null);

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
    const bootstrapLoadKeyRef = useRef('');
    const academyMentorsAutoLoadedRef = useRef(false);
    const nearbyProsAutoLoadedRef = useRef(false);
    const safeCircleMessageCount = Array.isArray(circleMessages) ? circleMessages.length : 0;
    const savedPostsStorageKey = useMemo(
        () => getSavedPostsStorageKey(currentUserId || 'guest'),
        [currentUserId]
    );

    useEffect(() => {
        if (!circleChatRef.current) {
            return;
        }

        if (circleScrollTimeoutRef.current) {
            clearTimeout(circleScrollTimeoutRef.current);
        }

        const timeout = setTimeout(() => {
            circleChatRef.current?.scrollToEnd({ animated: true });
        }, 80);
        circleScrollTimeoutRef.current = timeout;

        return () => {
            clearTimeout(timeout);
            circleScrollTimeoutRef.current = null;
        };
    }, [safeCircleMessageCount]);

    useEffect(() => {
        let mounted = true;
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

        loadSavedPostIds();
        return () => {
            mounted = false;
        };
    }, [savedPostsStorageKey]);

    const mapCirclePostToMessage = useCallback((post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const authorName = safePost?.user?.name || 'Member';
        const role = safePost?.user?.activeRole || safePost?.user?.primaryRole || 'member';
        return {
            id: String(safePost?._id || Date.now()),
            user: authorName,
            role: role === 'employer' ? 'Employer' : role === 'worker' ? 'Job Seeker' : String(role),
            text: String(safePost?.text || ''),
            time: timeAgo(safePost?.createdAt),
            type: 'text',
            isAdmin: Boolean(safePost?.user?.isAdmin),
        };
    }, []);

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
        const safePage = Math.max(1, Number(pageToLoad || 1));
        const showRefreshIndicator = Boolean(options?.showRefreshIndicator);
        setFeedError('');
        if (replace) {
            if (feedRefreshingInFlightRef.current) return;
            feedRefreshingInFlightRef.current = true;
            setLoadingFeed(true);
            if (showRefreshIndicator) {
                setFeedPullRefreshing(true);
            }
        } else {
            if (feedRefreshingInFlightRef.current) return;
            if (!hasMoreFeed) return;
            if (feedPagingInFlightRef.current) return;
            const nowMs = Date.now();
            if ((nowMs - feedLastLoadMoreAtRef.current) < 600) return;
            feedLastLoadMoreAtRef.current = nowMs;
            feedPagingInFlightRef.current = true;
            setLoadingMoreFeed(true);
        }

        const requestId = feedFetchRequestIdRef.current + 1;
        feedFetchRequestIdRef.current = requestId;

        try {
            const { data } = await client.get('/api/feed/posts', {
                params: { page: safePage, limit: 20, visibility: 'community' },
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 1,
                __skipApiErrorHandler: true,
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
                if (replace) {
                    return incomingLikeCounts;
                }
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
                incomingLikedPostIds.forEach((postId) => {
                    next.add(postId);
                });
                return next;
            });
        } catch (_error) {
            const hasVisiblePosts = feedPosts.length > 0;
            if (replace) {
                if (hasVisiblePosts) {
                    setFeedError(
                        showRefreshIndicator
                            ? 'Could not refresh right now. Showing your last loaded posts.'
                            : 'Could not reload your feed right now. Showing your last loaded posts.'
                    );
                } else {
                    setFeedError('We could not load your feed right now. Pull down or tap retry to try again.');
                    setHasMoreFeed(false);
                }
            } else {
                setFeedError('Could not load more posts right now. Pull down to refresh and try again.');
                setHasMoreFeed(false);
            }
        } finally {
            if (replace) {
                feedRefreshingInFlightRef.current = false;
                setLoadingFeed(false);
                if (showRefreshIndicator) {
                    setFeedPullRefreshing(false);
                }
            } else {
                feedPagingInFlightRef.current = false;
                setLoadingMoreFeed(false);
            }
        }
    }, [feedPosts.length, hasMoreFeed, mapApiPost]);

    const fetchPostComments = useCallback(async (postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return [];

        const endpoints = [
            `/api/feed/posts/${encodeURIComponent(normalizedPostId)}/comments`,
            `/api/feed/posts/${encodeURIComponent(normalizedPostId)}`,
        ];

        for (const endpoint of endpoints) {
            try {
                const { data } = await client.get(endpoint, {
                    __skipApiErrorHandler: true,
                });
                const parsedEntries = extractCommentEntriesFromPayload(data, normalizedPostId);
                if (!Array.isArray(parsedEntries)) continue;

                setCommentsByPostId((prev) => ({ ...prev, [normalizedPostId]: parsedEntries }));
                setFeedPosts((prev) => prev.map((post) => (
                    String(post?._id || '') === normalizedPostId
                        ? {
                            ...post,
                            comments: parsedEntries.length,
                            commentEntries: parsedEntries,
                        }
                        : post
                )));

                return parsedEntries;
            } catch (_error) {
                // Try fallback endpoint.
            }
        }
        return [];
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
                if (discard) {
                    setComposerMediaAssets([]);
                }
                return null;
            }

            const voiceAsset = {
                id: `voice-${Date.now()}`,
                uri: recordingUri,
                type: 'audio',
                width: 0,
                height: 0,
                durationMs: 0,
                fileSize: 0,
                mimeType: 'audio/m4a',
            };
            setComposerMediaAssets([voiceAsset]);
            return voiceAsset;
        } catch (_error) {
            voiceRecordingRef.current = null;
            setIsVoiceRecording(false);
            if (!discard) {
                Alert.alert('Recording failed', 'Could not stop voice recording cleanly. Please try again.');
            }
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
            if (isVoiceRecording) {
                await stopVoiceRecording();
                return;
            }
            await startVoiceRecording();
            return;
        }
        if (normalizedType === 'PHOTOS') {
            await pickPhotoMedia();
            return;
        }
        if (normalizedType === 'VIDEO') {
            await pickVideoMedia();
            return;
        }

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

    const handleRemoveComposerMedia = useCallback(() => {
        setComposerMediaAssets([]);
    }, []);

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
            await stopVoiceRecording();
        }

        if (composerMediaType === 'VOICE' && !composerMediaAssets.length) {
            Alert.alert('Voice note missing', 'Record a voice note, then publish.');
            return;
        }
        if (composerMediaType === 'PHOTOS' && !composerMediaAssets.length) {
            Alert.alert('Photo missing', 'Select at least one photo before publishing.');
            return;
        }
        if (composerMediaType === 'VIDEO' && !composerMediaAssets.length) {
            Alert.alert('Video missing', 'Select one video before publishing.');
            return;
        }

        const feedType = composerMediaType === 'VOICE'
            ? 'voice'
            : composerMediaType === 'PHOTOS'
                ? 'photo'
                : composerMediaType === 'VIDEO'
                    ? 'video'
                    : 'text';
        const mappedLocalType = feedType === 'photo' ? 'gallery' : feedType;
        const safeContent = String(composerText || '').trim();
        const resolvedContent = safeContent || (
            feedType === 'voice'
                ? 'Shared a voice update.'
                : feedType === 'photo'
                    ? 'Shared a photo update.'
                    : feedType === 'video'
                        ? 'Shared a video update.'
                        : ''
        );
        if (!resolvedContent) {
            Alert.alert('Add your message', 'Please write a short message before publishing.');
            return;
        }

        const mediaPayload = composerMediaAssets
            .map((asset) => ({
                url: String(asset?.uri || '').trim(),
                mimeType: String(asset?.mimeType || '').trim(),
                ...(Number.isFinite(Number(asset?.fileSize)) && Number(asset.fileSize) > 0
                    ? { sizeBytes: Number(asset.fileSize) }
                    : {}),
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
            likes: 0,
            comments: 0,
            commentEntries: [],
            vouched: false,
            vouchCount: 0,
            avatar: String(
                userInfo?.avatar
                || userInfo?.profilePicture
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
                ? mediaPayload.map((item) => String(item?.url || '')).filter(Boolean)
                : [],
            visibility: FEED_VISIBILITY_OPTIONS.includes(String(composerVisibility || '').toLowerCase())
                ? String(composerVisibility || '').toLowerCase()
                : 'community',
            postType: mappedLocalType === 'voice' ? 'voice' : 'status',
            isJobPost: false,
            meta: {
                optimistic: true,
            },
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
                    ? String(composerVisibility || '').toLowerCase()
                    : 'community',
                mediaUrl: mediaPayload[0]?.url || '',
                media: mediaPayload,
            }, {
                __skipApiErrorHandler: true,
            });

            if (!data?.post) {
                throw new Error('Post creation response is invalid.');
            }

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
            Alert.alert('Posted locally', 'Post is visible in your feed. Server sync will happen on refresh.');
        } finally {
            setPostingFeed(false);
        }
    }, [
        composerMediaAssets,
        composerMediaType,
        composerText,
        composerVisibility,
        currentUserId,
        currentUserName,
        isVoiceRecording,
        isEmployerRole,
        mapApiPost,
        postingFeed,
        stopVoiceRecording,
        userInfo?.avatar,
        userInfo?.profilePicture,
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
            if (optimisticLiked) {
                next.add(normalizedPostId);
            } else {
                next.delete(normalizedPostId);
            }
            return next;
        });
        setLikeCountMap((prev) => ({ ...prev, [normalizedPostId]: optimisticCount }));

        const requestVariants = [
            () => client.post(`/api/feed/posts/${normalizedPostId}/like`, {}, {
                __skipApiErrorHandler: true,
            }),
            () => client.post(`/api/feed/posts/${normalizedPostId}/likes`, {}, {
                __skipApiErrorHandler: true,
            }),
        ];

        for (const request of requestVariants) {
            try {
                const response = await request();
                const data = (response?.data && typeof response.data === 'object') ? response.data : {};
                const nested = (data?.data && typeof data.data === 'object')
                    ? data.data
                    : ((data?.result && typeof data.result === 'object')
                        ? data.result
                        : ((data?.payload && typeof data.payload === 'object') ? data.payload : data));
                const postPayload = (nested?.post && typeof nested.post === 'object') ? nested.post : {};

                const resolvedLikedCandidate = [nested?.liked, nested?.isLiked, postPayload?.liked, postPayload?.isLiked]
                    .find((value) => typeof value === 'boolean');
                const resolvedLikesCountCandidate = [
                    nested?.likesCount,
                    nested?.likeCount,
                    nested?.likes,
                    postPayload?.likesCount,
                    postPayload?.likeCount,
                    postPayload?.likes,
                ].find((value) => Number.isFinite(Number(value)));

                const resolvedLiked = typeof resolvedLikedCandidate === 'boolean'
                    ? Boolean(resolvedLikedCandidate)
                    : optimisticLiked;
                const resolvedLikeCount = Number.isFinite(Number(resolvedLikesCountCandidate))
                    ? Math.max(0, Number(resolvedLikesCountCandidate))
                    : optimisticCount;

                setLikedPostIds((prev) => {
                    const next = new Set(prev);
                    if (resolvedLiked) {
                        next.add(normalizedPostId);
                    } else {
                        next.delete(normalizedPostId);
                    }
                    return next;
                });
                setLikeCountMap((prev) => ({ ...prev, [normalizedPostId]: resolvedLikeCount }));
                return;
            } catch (_error) {
                // Try fallback endpoint.
            }
        }

        // Keep optimistic state when backend sync fails; this avoids "tap did nothing" UX.
    }, [feedPosts, likeCountMap, likedPostIds]);

    const handleToggleSavePost = useCallback((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;

        setSavedPostIds((prev) => {
            const next = new Set(prev);
            if (next.has(normalizedPostId)) {
                next.delete(normalizedPostId);
            } else {
                next.add(normalizedPostId);
            }
            AsyncStorage.setItem(
                savedPostsStorageKey,
                JSON.stringify(Array.from(next))
            ).catch(() => {
                Alert.alert('Save Failed', 'Could not update saved posts right now.');
            });
            return next;
        });
    }, [savedPostsStorageKey]);

    const handleSubmitComment = useCallback(async (postId) => {
        const normalizedPostId = String(postId || '').trim();
        const text = (commentInputMap[normalizedPostId] || '').trim();
        if (!text) return;
        if (!normalizedPostId) return;

        const optimisticCommentId = `optimistic-comment-${Date.now()}`;
        const optimisticComment = {
            id: optimisticCommentId,
            text,
            author: currentUserName,
            time: 'Just now',
        };

        setCommentInputMap((prev) => ({ ...prev, [normalizedPostId]: '' }));
        setCommentsByPostId((prev) => {
            const existing = Array.isArray(prev?.[normalizedPostId]) ? prev[normalizedPostId] : [];
            return {
                ...prev,
                [normalizedPostId]: [...existing, optimisticComment],
            };
        });
        setFeedPosts((prev) => prev.map((post) => {
            if (String(post?._id || '') !== normalizedPostId) return post;
            const existing = Array.isArray(post?.commentEntries) ? post.commentEntries : [];
            return {
                ...post,
                commentEntries: [...existing, optimisticComment],
                comments: Math.max(Number(post?.comments || 0) + 1, existing.length + 1),
            };
        }));

        try {
            await client.post(`/api/feed/posts/${normalizedPostId}/comments`, { text }, {
                __skipApiErrorHandler: true,
            });
            await fetchPostComments(normalizedPostId);
        } catch (error) {
            setCommentsByPostId((prev) => {
                const existing = Array.isArray(prev?.[normalizedPostId]) ? prev[normalizedPostId] : [];
                return {
                    ...prev,
                    [normalizedPostId]: existing.filter((item) => String(item?.id || '') !== optimisticCommentId),
                };
            });
            setFeedPosts((prev) => prev.map((post) => {
                if (String(post?._id || '') !== normalizedPostId) return post;
                const existing = Array.isArray(post?.commentEntries) ? post.commentEntries : [];
                const filtered = existing.filter((item) => String(item?.id || '') !== optimisticCommentId);
                return {
                    ...post,
                    commentEntries: filtered,
                    comments: filtered.length,
                };
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
        if (loadingFeed) return;
        fetchFeedPosts(1, true, { showRefreshIndicator: true });
    }, [fetchFeedPosts, loadingFeed]);

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

    const mapPostToFeedProfileFallback = useCallback((post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const inferredRole = String(
            safePost?.authorPrimaryRole
            || safePost?.user?.primaryRole
            || safePost?.role
            || ''
        ).trim().toLowerCase();
        const mode = inferredRole === 'employer' ? 'employer' : 'candidate';
        const displayName = String(safePost?.author || safePost?.user?.name || 'Profile').trim() || 'Profile';
        const avatar = String(safePost?.avatar || '').trim();
        const headline = String(safePost?.text || '').trim().slice(0, 120);

        if (mode === 'employer') {
            return {
                mode: 'employer',
                name: displayName,
                avatar,
                headline: headline || 'Hiring Team',
                industryTag: 'EMPLOYER PROFILE',
                mission: headline || 'Sharing updates with the community.',
                industry: 'Not specified',
                hq: 'Not specified',
                contactInfo: {
                    partnership: 'Not shared',
                    support: 'Not shared',
                    website: 'Not shared',
                },
                highlights: [
                    { label: 'Role', value: String(safePost?.role || 'Employer') },
                    { label: 'Joined', value: String(safePost?.time || 'Recently') },
                ],
            };
        }

        return {
            mode: 'candidate',
            name: displayName,
            avatar,
            headline: String(safePost?.role || 'Job Seeker'),
            industryTag: 'JOB SEEKER PROFILE',
            summary: headline || 'Active in community conversations.',
            experienceYears: 0,
            skills: [],
            highlights: [
                { label: 'Role', value: String(safePost?.role || 'Job Seeker') },
                { label: 'Last Active', value: String(safePost?.time || 'Recently') },
            ],
            workHistory: [],
        };
    }, []);

    const handleOpenFeedProfile = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const profileFallback = mapPostToFeedProfileFallback(safePost);
        const authorId = String(safePost?.authorId?._id || safePost?.authorId || safePost?.user?._id || '').trim();

        setFeedProfileData(profileFallback);
        setFeedProfileVisible(true);

        if (!authorId) {
            setFeedProfileLoading(false);
            return;
        }

        const requestId = feedProfileRequestIdRef.current + 1;
        feedProfileRequestIdRef.current = requestId;
        setFeedProfileLoading(true);

        try {
            const { data } = await client.get(`/api/feed/profiles/${encodeURIComponent(authorId)}`, {
                __skipApiErrorHandler: true,
            });
            if (requestId !== feedProfileRequestIdRef.current) return;
            const resolvedProfile = data?.profile && typeof data.profile === 'object'
                ? data.profile
                : null;
            if (!resolvedProfile) return;
            setFeedProfileData({
                ...profileFallback,
                ...resolvedProfile,
                mode: String(resolvedProfile?.mode || profileFallback.mode || 'candidate').toLowerCase() === 'employer'
                    ? 'employer'
                    : 'candidate',
            });
        } catch (_error) {
            // Keep fallback profile visible when detail fetch fails.
        } finally {
            if (requestId === feedProfileRequestIdRef.current) {
                setFeedProfileLoading(false);
            }
        }
    }, [mapPostToFeedProfileFallback]);

    const openJobPreviewFromPost = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const jobId = String(
            safePost?.jobId
            || safePost?.meta?.jobId
            || ''
        ).trim();
        if (!jobId) return;

        setJobPreviewVisible(true);
        setJobPreviewLoading(true);
        try {
            const { data } = await client.get(`/api/jobs/${jobId}`, {
                __skipApiErrorHandler: true,
            });
            const resolvedJob = (data?.data && typeof data.data === 'object')
                ? data.data
                : ((data?.job && typeof data.job === 'object') ? data.job : null);
            if (!resolvedJob) {
                throw new Error('Job details not found');
            }

            setJobPreview({
                _id: String(resolvedJob?._id || jobId),
                title: String(resolvedJob?.title || safePost?.text || 'Open Role'),
                companyName: String(resolvedJob?.companyName || 'Employer'),
                location: String(resolvedJob?.location || 'Not specified'),
                salaryRange: String(resolvedJob?.salaryRange || 'Negotiable'),
                shift: String(resolvedJob?.shift || 'Flexible'),
                requirements: Array.isArray(resolvedJob?.requirements)
                    ? resolvedJob.requirements.filter((item) => typeof item === 'string' && item.trim())
                    : [],
                remoteAllowed: Boolean(resolvedJob?.remoteAllowed),
                status: String(resolvedJob?.status || ''),
                isOpen: Boolean(resolvedJob?.isOpen),
                createdAt: resolvedJob?.createdAt || null,
            });
        } catch (_error) {
            Alert.alert('Job details unavailable', 'Could not load this job right now.');
            setJobPreviewVisible(false);
            setJobPreview(null);
        } finally {
            setJobPreviewLoading(false);
        }
    }, []);

    const applyFromJobPreview = useCallback(async () => {
        const jobId = String(jobPreview?._id || '').trim();
        if (!jobId || !userInfo?._id) return;
        if (isEmployerRole) return;
        if (appliedJobPreviewIds.has(jobId)) {
            showPulseToast('You already applied to this job.');
            return;
        }

        setJobPreviewApplying(true);
        try {
            const workerId = await resolveWorkerApplicationIdentity();
            if (!workerId) {
                Alert.alert('Apply failed', 'Complete your worker profile before applying.');
                return;
            }
            await client.post('/api/applications', {
                jobId,
                workerId,
                initiatedBy: 'worker',
            }, {
                __skipApiErrorHandler: true,
            });
            setAppliedJobPreviewIds((prev) => new Set(prev).add(jobId));
            showPulseToast('Application sent successfully.');
            closeJobPreview();
        } catch (error) {
            const message = getApiErrorMessage(error, 'Could not apply right now.');
            Alert.alert('Apply failed', message);
        } finally {
            setJobPreviewApplying(false);
        }
    }, [appliedJobPreviewIds, closeJobPreview, isEmployerRole, jobPreview?._id, resolveWorkerApplicationIdentity, showPulseToast, userInfo?._id]);

    const handleVouch = useCallback(async (postId, post = null) => {
        try {
            const { data } = await client.post(`/api/feed/posts/${postId}/vouch`, {}, {
                __skipApiErrorHandler: true,
            });
            setFeedPosts((prev) => prev.map((post) => (
                post._id === postId
                    ? {
                        ...post,
                        vouched: Boolean(data?.vouched),
                        vouchCount: Number(data?.vouchCount || 0),
                    }
                    : post
            )));
            const safePost = (post && typeof post === 'object') ? post : {};
            const isJobPost = Boolean(safePost?.isJobPost) || String(safePost?.postType || '').toLowerCase() === 'job';
            const hasJobId = Boolean(String(safePost?.jobId || safePost?.meta?.jobId || '').trim());
            if (isJobPost && hasJobId) {
                await openJobPreviewFromPost(safePost);
            }
        } catch (error) {
            Alert.alert('Vouch Failed', 'Could not update vouch right now.');
        }
    }, [openJobPreviewFromPost]);

    const removeFeedPostLocally = useCallback((postId) => {
        const normalizedPostId = String(postId || '').trim();
        if (!normalizedPostId) return;

        setFeedPosts((prev) => prev.filter((post) => String(post?._id || '').trim() !== normalizedPostId));
        setLikeCountMap((prev) => {
            const next = { ...prev };
            delete next[normalizedPostId];
            return next;
        });
        setLikedPostIds((prev) => {
            const next = new Set(prev);
            next.delete(normalizedPostId);
            return next;
        });
        setSavedPostIds((prev) => {
            const next = new Set(prev);
            next.delete(normalizedPostId);
            AsyncStorage.setItem(
                savedPostsStorageKey,
                JSON.stringify(Array.from(next))
            ).catch(() => { });
            return next;
        });
        setCommentsByPostId((prev) => {
            const next = { ...prev };
            delete next[normalizedPostId];
            return next;
        });
        setCommentInputMap((prev) => {
            const next = { ...prev };
            delete next[normalizedPostId];
            return next;
        });
        setActiveCommentPostId((prev) => (prev === normalizedPostId ? null : prev));
    }, [savedPostsStorageKey]);

    const handleDeletePost = useCallback(async (post) => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const postId = String(safePost?._id || '').trim();
        if (!postId) {
            return { ok: false, message: 'Post not found.' };
        }

        const ownerId = String(
            safePost?.authorId?._id
            || safePost?.authorId
            || safePost?.user?._id
            || ''
        ).trim();
        const canDelete = Boolean(postId.startsWith('local-') || (ownerId && ownerId === currentUserId));
        if (!canDelete) {
            return { ok: false, message: 'You can only delete your own post.' };
        }

        removeFeedPostLocally(postId);
        if (postId.startsWith('local-')) {
            return { ok: true };
        }

        const requestVariants = [
            () => client.delete(`/api/feed/posts/${postId}`, {
                __skipApiErrorHandler: true,
            }),
            () => client.delete(`/api/posts/${postId}`, {
                __skipApiErrorHandler: true,
            }),
        ];
        for (const request of requestVariants) {
            try {
                await request();
                return { ok: true };
            } catch (_error) {
                // Try fallback endpoint.
            }
        }

        return { ok: true, localOnly: true };
    }, [currentUserId, removeFeedPostLocally]);

    const handleReportPost = useCallback(async (post, reason = 'spam') => {
        const safePost = (post && typeof post === 'object') ? post : {};
        const postId = String(safePost?._id || '').trim();
        if (!postId) {
            return { ok: false, message: 'Post not found.' };
        }

        const normalizedReason = ['spam', 'harassment', 'misleading'].includes(String(reason || '').toLowerCase())
            ? String(reason || '').toLowerCase()
            : 'spam';
        const requestOptions = { __skipApiErrorHandler: true };
        const requestVariants = [
            () => client.post('/api/reports', {
                targetId: postId,
                targetType: 'post',
                reason: normalizedReason,
            }, requestOptions),
            () => client.post(`/api/feed/posts/${postId}/report`, { reason: normalizedReason }, requestOptions),
        ];

        for (const request of requestVariants) {
            try {
                await request();
                return { ok: true };
            } catch (_error) {
                // Try fallback endpoint.
            }
        }

        try {
            const rawQueue = await AsyncStorage.getItem(CONNECT_PENDING_POST_REPORTS_KEY);
            const parsedQueue = JSON.parse(String(rawQueue || '[]'));
            const queue = Array.isArray(parsedQueue) ? parsedQueue : [];
            queue.push({
                postId,
                reason: normalizedReason,
                queuedAt: new Date().toISOString(),
            });
            await AsyncStorage.setItem(CONNECT_PENDING_POST_REPORTS_KEY, JSON.stringify(queue.slice(-50)));
            return { ok: true, queued: true };
        } catch (_error) {
            return { ok: false, message: 'Could not submit report right now.' };
        }
    }, []);

    const showPulseToast = useCallback((message) => {
        setPulseToast(message);
        if (pulseToastTimeoutRef.current) {
            clearTimeout(pulseToastTimeoutRef.current);
        }
        pulseToastTimeoutRef.current = setTimeout(() => setPulseToast(null), 2500);
    }, []);

    const resolveWorkerApplicationIdentity = useCallback(async () => {
        const safeStoredWorkerProfileId = String(
            userInfo?.workerProfileId
            || await AsyncStorage.getItem('@worker_profile_id')
            || ''
        ).trim();
        if (safeStoredWorkerProfileId) {
            return safeStoredWorkerProfileId;
        }

        try {
            const { data } = await client.get('/api/users/profile', {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
                params: { role: 'worker' },
            });
            const workerProfileId = String(data?.profile?._id || '').trim();
            if (workerProfileId) {
                await AsyncStorage.setItem('@worker_profile_id', workerProfileId);
                return workerProfileId;
            }
        } catch (_error) {
            // Fall back to user id if worker profile lookup is not available.
        }

        return String(userInfo?._id || '').trim();
    }, [userInfo?._id, userInfo?.workerProfileId]);

    const fetchPulseItems = useCallback(async () => {
        const shouldShowLoading = pulseItems.length === 0;
        if (shouldShowLoading) {
            setPulseLoading(true);
        }
        setPulseError('');
        const requestId = pulseFetchRequestIdRef.current + 1;
        pulseFetchRequestIdRef.current = requestId;
        try {
            const { data } = await client.get('/api/pulse', {
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 1,
                __skipApiErrorHandler: true,
            });
            if (requestId !== pulseFetchRequestIdRef.current) {
                return;
            }
            const items = Array.isArray(data?.items)
                ? data.items.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const seen = new Set();
            const hasServerPulseRanking = items.some((item) => Number.isFinite(Number(item?.pulseRank)));
            const mapped = items
                .map((item) => ({
                    id: item.id || item._id,
                    rawJobId: item.jobId,
                    rawPostType: item.postType,
                    rawCanApply: item.canApply,
                    createdAt: item.createdAt || item.timePosted || null,
                    interactionCount: Number(item.interactionCount || 0),
                    engagementScore: Number(item.engagementScore || 0),
                    pulseRank: Number(item.pulseRank || 0),
                    localityTier: Number(item.localityTier || 0),
                    rawTimePosted: item.timePosted,
                    rawCategory: item.category,
                    rawEmployer: item.employer,
                    rawCompanyName: item.companyName,
                    rawTitle: item.title,
                    rawContent: item.content,
                    rawDistance: item.distance,
                    rawLocation: item.location,
                    rawDistrict: item.district,
                    rawMandal: item.mandal,
                    rawLocationLabel: item.locationLabel,
                    rawPay: item.pay,
                    rawSalaryRange: item.salaryRange,
                    rawUrgent: item.urgent,
                    rawIsPulse: item.isPulse,
                    rawRequirements: item.requirements,
                }))
                .filter((item) => {
                    const id = String(item.id || '').trim();
                    if (!id || seen.has(id)) return false;
                    seen.add(id);
                    return true;
                })
                .sort((left, right) => {
                    if (hasServerPulseRanking) {
                        if (right.pulseRank !== left.pulseRank) return right.pulseRank - left.pulseRank;
                        if (right.localityTier !== left.localityTier) return right.localityTier - left.localityTier;
                    }
                    const leftScore = Number(left.engagementScore || 0);
                    const rightScore = Number(right.engagementScore || 0);
                    if (rightScore !== leftScore) return rightScore - leftScore;
                    const leftTs = new Date(left.createdAt || 0).getTime();
                    const rightTs = new Date(right.createdAt || 0).getTime();
                    if (rightTs !== leftTs) return rightTs - leftTs;
                    if (right.interactionCount !== left.interactionCount) {
                        return right.interactionCount - left.interactionCount;
                    }
                    return String(left.id).localeCompare(String(right.id));
                })
                .map((item) => ({
                    id: item.id,
                    jobId: String(item.rawJobId || (String(item.rawPostType || '').toLowerCase() === 'job' ? item.id : '') || '').trim(),
                    title: item.rawTitle || item.rawContent || 'Urgent Requirement',
                    employer: item.rawEmployer || item.rawCompanyName || 'Employer',
                    companyName: item.rawCompanyName || item.rawEmployer || 'Employer',
                    distance: item.rawDistance || item.rawLocationLabel || item.rawLocation || 'Nearby',
                    location: item.rawLocationLabel || item.rawLocation || item.rawDistance || 'Nearby',
                    district: String(item.rawDistrict || '').trim(),
                    mandal: String(item.rawMandal || '').trim(),
                    pay: item.rawPay || item.rawSalaryRange || 'Negotiable',
                    urgent: Boolean(item.rawUrgent || item.rawIsPulse),
                    timePosted: timeAgo(item.createdAt || item.rawTimePosted),
                    category: item.rawCategory || item.rawRequirements?.[0] || 'Pulse',
                    categoryBg: '#fef3c7',
                    categoryColor: '#b45309',
                    postType: String(item.rawPostType || 'status').toLowerCase(),
                    canApply: Boolean(item.rawCanApply) || String(item.rawPostType || '').toLowerCase() === 'job',
                    pulseRank: item.pulseRank,
                    localityTier: item.localityTier,
                    requirements: Array.isArray(item.rawRequirements)
                        ? item.rawRequirements.filter((entry) => typeof entry === 'string' && entry.trim())
                        : [],
                    description: String(item.rawContent || item.rawTitle || '').trim(),
                    createdAt: item.createdAt || null,
                }));
            setPulseItems(mapped);
            setPulseError('');
            if (shouldShowLoading) {
                setPulseLoading(false);
            }
        } catch (_error) {
            if (requestId !== pulseFetchRequestIdRef.current) {
                return;
            }
            if (pulseItems.length > 0) {
                setPulseError('Could not refresh Pulse right now. Showing your last live radar.');
            } else {
                setPulseError('Pulse is unavailable right now. Pull down or tap retry to try again.');
            }
            if (shouldShowLoading) {
                setPulseLoading(false);
            }
        }
    }, [pulseItems.length]);

    const fetchNearbyPros = useCallback(async () => {
        if (!isEmployerRole) {
            setNearbyPros([]);
            setNearbyProsError('');
            return;
        }

        setNearbyProsError('');
        try {
            const jobsResponse = await client.get('/api/jobs/my-jobs', {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 1,
            });
            const jobs = Array.isArray(jobsResponse?.data)
                ? jobsResponse.data
                : (Array.isArray(jobsResponse?.data?.data) ? jobsResponse.data.data : []);
            const safeJobs = jobs
                .filter((job) => (
                    job
                    && typeof job === 'object'
                    && String(job?._id || '').trim()
                    && !isDemoRecord(job)
                ))
                .slice(0, 3);

            if (!safeJobs.length) {
                setNearbyPros([]);
                setNearbyProsError('');
                return;
            }

            const matchResponses = await Promise.all(
                safeJobs.map(async (job) => {
                    try {
                        const response = await client.get(`/api/matches/employer/${String(job._id).trim()}`, {
                            __skipApiErrorHandler: true,
                            timeout: CONNECT_READ_TIMEOUT_MS,
                            __maxRetries: 1,
                        });
                        return { job, response };
                    } catch (_error) {
                        return { job, response: null };
                    }
                })
            );

            const candidateRows = [];
            matchResponses.forEach(({ job, response }) => {
                const matches = Array.isArray(response?.data?.matches) ? response.data.matches : [];
                matches.forEach((item) => {
                    const worker = item?.worker || {};
                    const workerId = String(worker?._id || '').trim();
                    if (!workerId) return;
                    if (isDemoRecord(worker)) return;

                    const firstRole = Array.isArray(worker?.roleProfiles) && worker.roleProfiles.length > 0
                        ? worker.roleProfiles[0]
                        : {};
                    const workerName = String(
                        worker?.user?.name
                        || worker?.firstName
                        || [worker?.firstName, worker?.lastName].filter(Boolean).join(' ')
                        || 'Professional'
                    ).trim();

                    candidateRows.push({
                        id: `${String(job?._id || '')}:${workerId}`,
                        workerId,
                        jobId: String(job?._id || '').trim(),
                        name: workerName || 'Professional',
                        role: String(firstRole?.roleName || item?.tier || 'Job Seeker').trim() || 'Job Seeker',
                        distance: String(worker?.city || job?.location || 'Nearby').trim() || 'Nearby',
                        karma: String(Math.round(Number(item?.trustScore || item?.matchScore || 0))),
                        available: worker?.isAvailable !== false,
                        avatar: String(worker?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(workerName || 'Professional')}&background=8b3dff&color=fff&rounded=true`),
                        predictedHireProbability: Number(item?.predictedHireProbability || 0),
                        matchScore: Number(item?.matchScore || 0),
                        jobTitle: String(job?.title || 'Open role'),
                    });
                });
            });

            const byWorker = new Map();
            candidateRows.forEach((row) => {
                const key = String(row.workerId || '').trim();
                if (!key) return;
                if (!byWorker.has(key)) {
                    byWorker.set(key, row);
                    return;
                }
                const existing = byWorker.get(key);
                const nextScore = Number(row?.predictedHireProbability || 0) + Number(row?.matchScore || 0) / 100;
                const existingScore = Number(existing?.predictedHireProbability || 0) + Number(existing?.matchScore || 0) / 100;
                if (nextScore > existingScore) {
                    byWorker.set(key, row);
                }
            });

            const ranked = Array.from(byWorker.values())
                .sort((left, right) => {
                    const probDiff = Number(right?.predictedHireProbability || 0) - Number(left?.predictedHireProbability || 0);
                    if (probDiff !== 0) return probDiff;
                    const matchDiff = Number(right?.matchScore || 0) - Number(left?.matchScore || 0);
                    if (matchDiff !== 0) return matchDiff;
                    return String(left?.workerId || '').localeCompare(String(right?.workerId || ''));
                })
                .slice(0, 20);

            setNearbyPros(ranked);
            setNearbyProsError('');
        } catch (_error) {
            setNearbyPros([]);
            setNearbyProsError('Nearby job seeker matches could not load right now.');
        }
    }, [isEmployerRole]);

    const handleRefreshRadar = useCallback(async () => {
        setRadarRefreshing(true);
        await Promise.all([
            fetchPulseItems(),
            fetchNearbyPros(),
        ]);
        setRadarRefreshing(false);
    }, [fetchNearbyPros, fetchPulseItems]);

    const handleApplyGig = useCallback(async (gig) => {
        const jobId = String(gig?.jobId || gig?.id || '').trim();
        const employerName = String(gig?.employer || 'Employer').trim() || 'Employer';
        if (!jobId) {
            showPulseToast('This post cannot be applied from Pulse.');
            return;
        }
        if (isEmployerRole) {
            showPulseToast('Switch to Job Seeker role to apply for gigs.');
            return;
        }
        try {
            const workerId = await resolveWorkerApplicationIdentity();
            if (!workerId) {
                showPulseToast('Complete your worker profile before applying.');
                return;
            }
            await client.post('/api/applications', {
                jobId,
                workerId,
                initiatedBy: 'worker',
            }, {
                __skipApiErrorHandler: true,
            });
            setAppliedGigIds((prev) => new Set(prev).add(jobId));
            showPulseToast(`Request sent to ${employerName}!`);
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            if (message) {
                showPulseToast(message);
                return;
            }
            showPulseToast('Could not apply right now. Please retry.');
        }
    }, [isEmployerRole, resolveWorkerApplicationIdentity, showPulseToast]);

    const handleHirePro = useCallback(async (pro) => {
        if (!isEmployerRole) {
            showPulseToast('Switch to Employer role to invite professionals.');
            return;
        }

        const workerId = String(pro?.workerId || pro?.id || '').trim();
        const jobId = String(pro?.jobId || '').trim();
        const candidateName = String(pro?.name || 'Professional').trim() || 'Professional';
        if (!workerId || !jobId) {
            showPulseToast('Job seeker invite requires a valid worker and job.');
            return;
        }

        try {
            await client.post('/api/applications', {
                jobId,
                workerId,
                initiatedBy: 'employer',
            }, {
                __skipApiErrorHandler: true,
            });
            setHiredProIds((prev) => new Set(prev).add(String(pro?.id || workerId)));
            showPulseToast(`Invite sent to ${candidateName}.`);
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            if (message) {
                showPulseToast(message);
                return;
            }
            showPulseToast('Could not send hire request right now.');
        }
    }, [isEmployerRole, showPulseToast]);

    const mapMentorMatchRows = useCallback((rows) => (
        Array.isArray(rows)
            ? rows
                .filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                .map((item, index) => {
                    const name = String(item.name || 'Mentor').trim() || 'Mentor';
                    return {
                        id: String(item.id || item._id || `mentor-${index + 1}`),
                        name,
                        exp: String(item.exp || item.experience || '5y'),
                        skill: String(item.skill || 'Career Growth'),
                        rating: String(item.rating || '4.6'),
                        sessions: String(item.sessions || '120'),
                        reason: String(item.reason || '').trim(),
                        avatar: String(item.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=8b3dff&color=fff&rounded=true`),
                    };
                })
            : []
    ), []);

    const fetchAcademyData = useCallback(async (options = {}) => {
        const refreshMentorsOnly = Boolean(options?.refreshMentorsOnly);
        const includeMentorMatch = options?.includeMentorMatch !== false;

        if (refreshMentorsOnly) {
            setAcademyRefreshingMentors(true);
        } else {
            setAcademyLoading(true);
        }
        setAcademyError('');

        try {
            const requests = [];
            if (!refreshMentorsOnly) {
                requests.push(client.get('/api/academy/courses', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }));
                requests.push(client.get('/api/academy/enrolled', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }));
            }
            if (includeMentorMatch) {
                requests.push(client.get('/api/academy/mentor-match', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }));
            }
            requests.push(client.get('/api/academy/mentor-requests', {
                __skipApiErrorHandler: true,
                timeout: CONNECT_READ_TIMEOUT_MS,
                __maxRetries: 1,
            }));

            const settled = await Promise.allSettled(requests);
            let cursor = 0;

            let coursesResult = null;
            let enrolledResult = null;
            if (!refreshMentorsOnly) {
                coursesResult = settled[cursor++];
                enrolledResult = settled[cursor++];
            }
            const mentorsResult = includeMentorMatch ? settled[cursor++] : null;
            const mentorRequestsResult = settled[cursor];

            if (!refreshMentorsOnly) {
                if (coursesResult?.status === 'fulfilled') {
                    const courses = Array.isArray(coursesResult.value?.data?.courses)
                        ? coursesResult.value.data.courses.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                        : [];
                    setAcademyCourses(courses);
                }

                if (enrolledResult?.status === 'fulfilled') {
                    const enrolled = Array.isArray(enrolledResult.value?.data?.enrolled)
                        ? enrolledResult.value.data.enrolled.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                        : [];
                    setEnrolledCourses(enrolled);
                    setEnrolledCourseIds(new Set(enrolled.map((item) => String(item?.courseId || '')).filter(Boolean)));
                }
            }

            if (mentorsResult?.status === 'fulfilled') {
                const mentors = mapMentorMatchRows(mentorsResult.value?.data?.mentors);
                setAcademyMentors(mentors);
            } else if (includeMentorMatch && refreshMentorsOnly) {
                showPulseToast('AI Mentor Match is temporarily unavailable.');
            }

            if (mentorRequestsResult?.status === 'fulfilled') {
                const requestsList = Array.isArray(mentorRequestsResult.value?.data?.requests)
                    ? mentorRequestsResult.value.data.requests.filter((item) => item && typeof item === 'object')
                    : [];
                const requestIds = new Set(
                    requestsList
                        .filter((item) => ['requested', 'connected'].includes(String(item?.status || '').toLowerCase()))
                        .map((item) => String(item?.mentorId || '').trim())
                        .filter(Boolean)
                );
                setConnectedMentorIds(requestIds);
            }

            const allFailed = settled.every((result) => result.status === 'rejected');
            if (allFailed) {
                setAcademyError('Academy is temporarily unavailable. Please try again.');
            }
        } catch (_error) {
            setAcademyError('Academy is temporarily unavailable. Please try again.');
        } finally {
            if (refreshMentorsOnly) {
                setAcademyRefreshingMentors(false);
            } else {
                setAcademyLoading(false);
            }
        }
    }, [mapMentorMatchRows, showPulseToast]);

    const handleEnrollCourse = useCallback(async (id) => {
        try {
            await client.post(`/api/academy/courses/${id}/enroll`, {}, {
                __skipApiErrorHandler: true,
            });
            setEnrolledCourseIds((prev) => new Set(prev).add(id));
            setEnrolledCourses((prev) => {
                const safePrev = Array.isArray(prev) ? prev : [];
                if (safePrev.some((item) => String(item?.courseId || '').trim() === String(id))) {
                    return safePrev;
                }
                const matchedCourse = Array.isArray(academyCourses)
                    ? academyCourses.find((course) => String(course?.id || course?._id || '').trim() === String(id))
                    : null;
                return [
                    {
                        courseId: String(id),
                        startedAt: new Date().toISOString(),
                        progressPercent: 0,
                        course: matchedCourse || null,
                    },
                    ...safePrev,
                ];
            });
        } catch (error) {
            Alert.alert('Enrollment Failed', 'Could not enroll right now.');
        }
    }, [academyCourses]);

    const handleConnectMentor = useCallback(async (id) => {
        const mentorId = String(id || '').trim();
        if (!mentorId) return;
        if (connectedMentorIds.has(mentorId)) {
            showPulseToast('Mentor request already sent.');
            return;
        }

        const mentor = Array.isArray(academyMentors)
            ? academyMentors.find((item) => String(item?.id || '').trim() === mentorId)
            : null;

        try {
            await client.post('/api/academy/mentor-requests', {
                mentorId,
                mentorName: String(mentor?.name || 'Mentor').trim() || 'Mentor',
                mentorSkill: String(mentor?.skill || 'Career Growth').trim() || 'Career Growth',
                source: 'academy_ai_match',
            }, {
                __skipApiErrorHandler: true,
            });
            setConnectedMentorIds((prev) => new Set(prev).add(mentorId));
            showPulseToast('Mentor request sent successfully.');
        } catch (error) {
            const message = String(error?.response?.data?.message || '').trim();
            if (message) {
                showPulseToast(message);
                return;
            }
            showPulseToast('Could not send mentor request right now.');
        }
    }, [academyMentors, connectedMentorIds, showPulseToast]);

    const handleBecomeMentor = useCallback(() => {
        setShowMyProfile(true);
        showPulseToast('Open My Profile and complete your details to become a mentor.');
    }, [setShowMyProfile, showPulseToast]);

    const handleRefreshMentors = useCallback(() => {
        return fetchAcademyData({ refreshMentorsOnly: true });
    }, [fetchAcademyData]);

    const handleRetryAcademy = useCallback(() => {
        return fetchAcademyData({ refreshMentorsOnly: false });
    }, [fetchAcademyData]);

    const showBountyToast = useCallback((message) => {
        setBountyToast(message);
        if (bountyToastTimeoutRef.current) {
            clearTimeout(bountyToastTimeoutRef.current);
        }
        bountyToastTimeoutRef.current = setTimeout(() => setBountyToast(null), 3000);
    }, []);

    const fetchBounties = useCallback(async (options = {}) => {
        const refreshing = Boolean(options?.refreshing);
        if (refreshing) {
            setBountiesRefreshing(true);
        } else {
            setBountiesLoading(true);
        }
        setBountiesError('');

        try {
            const settled = await Promise.allSettled([
                client.get('/api/bounties', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
                client.get('/api/bounties/mine', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
                client.get('/api/growth/referrals', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
            ]);
            const [bountyResult, mineResult, referralResult] = settled;
            const allFailed = settled.every((result) => result.status === 'rejected');

            if (allFailed) {
                setBountyItems([]);
                setReferralStats({ totalEarnings: 0 });
                setBountiesError('Could not load bounties right now. Pull down to retry.');
                return;
            }

            const rows = bountyResult.status === 'fulfilled' && Array.isArray(bountyResult.value?.data?.bounties)
                ? bountyResult.value.data.bounties.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const mine = mineResult.status === 'fulfilled' && Array.isArray(mineResult.value?.data?.bounties)
                ? mineResult.value.data.bounties.filter((item) => item && typeof item === 'object' && !isDemoRecord(item))
                : [];
            const mineMap = new Map(
                mine
                    .map((row) => [String(row?._id || '').trim(), row])
                    .filter(([id]) => Boolean(id))
            );

            const mapped = rows.map((bounty, index) => {
                const bountyId = String(bounty?._id || '').trim();
                const status = String(bounty?.status || 'open').trim().toLowerCase() || 'open';
                const reward = Math.max(0, Number(bounty?.reward || 0));
                const deadlineMs = new Date(bounty?.deadline || Date.now()).getTime();
                const expiresInDays = Number.isFinite(deadlineMs)
                    ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / (24 * 60 * 60 * 1000)))
                    : 0;
                const submissions = Array.isArray(bounty?.submissions)
                    ? bounty.submissions.filter((item) => item && typeof item === 'object')
                    : [];
                const submissionCount = submissions.length;
                const mineRow = mineMap.get(bountyId) || null;
                const hasSubmitted = submissions.some(
                    (item) => String(item?.userId || '').trim() === currentUserId
                ) || Boolean(
                    Array.isArray(mineRow?.submissions) && mineRow.submissions.some(
                        (item) => String(item?.userId || '').trim() === currentUserId
                    )
                );
                const isCreator = Boolean(mineRow?.isCreator)
                    || String(bounty?.creatorId || '').trim() === currentUserId;
                const isWinner = Boolean(mineRow?.isWinner)
                    || String(bounty?.winnerId || '').trim() === currentUserId;
                const company = String(bounty?.creatorName || '').trim() || `Creator ${index + 1}`;

                return {
                    id: bountyId,
                    company,
                    logoLetter: String(company || 'H')[0].toUpperCase(),
                    logoBg: '#7c3aed',
                    role: String(bounty?.title || '').trim() || 'Open Bounty',
                    description: String(bounty?.description || '').trim(),
                    bonus: `₹${reward.toLocaleString()}`,
                    bonusValue: reward,
                    status,
                    expiresInDays,
                    totalPot: `₹${(reward * Math.max(1, submissionCount || 1)).toLocaleString()}`,
                    referrals: submissionCount,
                    category: status.toUpperCase(),
                    hasSubmitted,
                    isCreator,
                    isWinner,
                    deadline: bounty?.deadline || null,
                };
            });

            setBountyItems(mapped);
            setReferralStats({
                totalEarnings: mapped.reduce((sum, row) => (
                    row?.isWinner ? sum + Number(row?.bonusValue || 0) : sum
                ), 0),
            });

            if (referralResult.status === 'fulfilled') {
                const referrals = Array.isArray(referralResult.value?.data?.referrals)
                    ? referralResult.value.data.referrals
                    : [];
                const hydratedReferredIds = new Set(
                    referrals
                        .map((row) => String(row?.bounty?._id || row?.bounty || '').trim())
                        .filter(Boolean)
                );
                setReferredBountyIds(hydratedReferredIds);
            }

            if (bountyResult.status === 'rejected') {
                setBountiesError('Could not load bounties right now. Pull down to retry.');
            }
        } catch (_error) {
            setBountyItems([]);
            setReferralStats({ totalEarnings: 0 });
            setBountiesError('Could not load bounties right now. Pull down to retry.');
        } finally {
            setBountiesLoading(false);
            setBountiesRefreshing(false);
        }
    }, [currentUserId]);

    const handleRefreshBounties = useCallback(async () => {
        await fetchBounties({ refreshing: true });
    }, [fetchBounties]);

    const handleCreateBounty = useCallback(async ({
        title,
        description,
        reward,
        deadline,
    } = {}) => {
        const normalizedTitle = String(title || '').trim();
        const normalizedDescription = String(description || '').trim();
        const normalizedReward = Number(reward || 0);
        const deadlineDate = new Date(deadline || '');

        if (normalizedTitle.length < 2) {
            return { ok: false, message: 'Title must be at least 2 characters.' };
        }
        if (!Number.isFinite(normalizedReward) || normalizedReward <= 0) {
            return { ok: false, message: 'Reward must be greater than 0.' };
        }
        if (!Number.isFinite(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
            return { ok: false, message: 'Deadline must be a future date.' };
        }

        setBountyCreating(true);
        try {
            await client.post('/api/bounties', {
                title: normalizedTitle,
                description: normalizedDescription || undefined,
                reward: normalizedReward,
                deadline: deadlineDate.toISOString(),
            }, {
                __skipApiErrorHandler: true,
            });
            await fetchBounties({ refreshing: false });
            showBountyToast('Bounty published successfully.');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: getApiErrorMessage(error, 'Could not create bounty right now.') };
        } finally {
            setBountyCreating(false);
        }
    }, [fetchBounties, showBountyToast]);

    const handleSubmitBountyEntry = useCallback(async ({
        bountyId,
        message,
        attachmentUrl,
    } = {}) => {
        const normalizedBountyId = String(bountyId || '').trim();
        if (!normalizedBountyId) {
            return { ok: false, message: 'Invalid bounty selected.' };
        }

        const normalizedMessage = String(message || '').trim();
        const normalizedAttachmentUrl = String(attachmentUrl || '').trim();
        setBountyActionInFlightId(normalizedBountyId);

        try {
            await client.post(`/api/bounties/${normalizedBountyId}/submit`, {
                message: normalizedMessage || undefined,
                attachmentUrl: normalizedAttachmentUrl || undefined,
            }, {
                __skipApiErrorHandler: true,
            });

            await fetchBounties({ refreshing: false });
            showBountyToast('Bounty entry submitted.');
            return { ok: true };
        } catch (error) {
            return { ok: false, message: getApiErrorMessage(error, 'Could not submit bounty entry right now.') };
        } finally {
            setBountyActionInFlightId('');
        }
    }, [fetchBounties, showBountyToast]);

    const handleOpenReferModal = useCallback((bounty) => {
        const safeBounty = (bounty && typeof bounty === 'object') ? bounty : null;
        const status = String(safeBounty?.status || 'open').trim().toLowerCase();
        if (!safeBounty?.id) return;
        if (!['open', 'reviewing'].includes(status)) {
            showBountyToast('This bounty is closed for referrals.');
            return;
        }
        setReferringBounty(safeBounty);
        setReferPhoneInput('');
        setReferPhoneError('');
    }, [showBountyToast]);

    const handleStartReferralAction = useCallback(async () => {
        const firstBounty = Array.isArray(bountyItems)
            ? bountyItems.find((item) => ['open', 'reviewing'].includes(String(item?.status || '').toLowerCase()))
            : null;
        if (firstBounty?.id) {
            handleOpenReferModal(firstBounty);
            return;
        }

        try {
            const { data } = await client.get('/api/growth/referrals/invite-link', {
                __skipApiErrorHandler: true,
            });
            const inviteLink = String(data?.inviteLink || '').trim();
            if (!inviteLink) {
                throw new Error('Invite link unavailable');
            }
            await Share.share({
                message: `Join HireCircle with my referral link: ${inviteLink}`,
            });
            showBountyToast('Referral flow started. Share your invite link to earn rewards.');
        } catch (_error) {
            Alert.alert('Referral unavailable', 'Could not start referral flow right now.');
        }
    }, [bountyItems, handleOpenReferModal, showBountyToast]);

    const handleCloseReferModal = useCallback(() => {
        setReferringBounty(null);
        setReferPhoneInput('');
        setReferPhoneError('');
    }, []);

    const handleReferPhoneChange = useCallback((value) => {
        setReferPhoneInput(value);
        setReferPhoneError('');
    }, []);

    const handleSendReferral = useCallback(async () => {
        if (referSending) return;
        if (!referPhoneInput.trim() || referPhoneInput.replace(/\D/g, '').length < 10) {
            setReferPhoneError('Please enter a valid 10-digit phone number');
            return;
        }
        if (!referringBounty) return;

        setReferSending(true);
        try {
            await client.post('/api/growth/referrals', {
                bountyId: referringBounty.id,
                candidateContact: referPhoneInput,
            }, {
                __skipApiErrorHandler: true,
            });

            const linkRes = await client.get(`/api/growth/share-link/bounty/${referringBounty.id}`, {
                __skipApiErrorHandler: true,
            });
            const shareLink = linkRes?.data?.shareLink;
            if (shareLink) {
                await Share.share({
                    message: `Check this opportunity on HireCircle: ${shareLink}`,
                });
            }

            setReferredBountyIds((prev) => new Set(prev).add(referringBounty.id));
            await fetchBounties({ refreshing: false });
            const earned = referringBounty.bonus;
            handleCloseReferModal();
            showBountyToast(`Referral sent! You'll earn ${earned} when they join.`);
        } catch (error) {
            setReferPhoneError(getApiErrorMessage(error, 'Could not send referral. Please try again.'));
        } finally {
            setReferSending(false);
        }
    }, [referPhoneInput, referringBounty, handleCloseReferModal, showBountyToast, referSending, fetchBounties]);

    const fetchCircles = useCallback(async (options = {}) => {
        const refreshing = Boolean(options?.refreshing);
        if (refreshing) {
            setCirclesRefreshing(true);
        } else {
            setCirclesLoading(true);
        }
        setCirclesError('');

        try {
            const [allResult, myResult] = await Promise.allSettled([
                client.get('/api/circles', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
                client.get('/api/circles/my', {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
            ]);

            const allCircles = allResult.status === 'fulfilled' && Array.isArray(allResult.value?.data?.circles)
                ? allResult.value.data.circles.filter((circle) => circle && typeof circle === 'object' && !isDemoRecord(circle))
                : [];
            const myCircles = myResult.status === 'fulfilled' && Array.isArray(myResult.value?.data?.circles)
                ? myResult.value.data.circles.filter((circle) => circle && typeof circle === 'object' && !isDemoRecord(circle))
                : [];

            const mergedCircleMap = new Map();
            allCircles.forEach((circle) => {
                const circleId = String(circle?._id || '').trim();
                if (!circleId) return;
                mergedCircleMap.set(circleId, circle);
            });
            myCircles.forEach((circle) => {
                const circleId = String(circle?._id || '').trim();
                if (!circleId) return;
                const existing = mergedCircleMap.get(circleId) || {};
                mergedCircleMap.set(circleId, {
                    ...existing,
                    ...circle,
                    isJoined: true,
                });
            });

            const mergedCircles = Array.from(mergedCircleMap.values());
            const joinedCircleIds = new Set(
                (myCircles.length > 0 ? myCircles : mergedCircles.filter((circle) => Boolean(circle?.isJoined)))
                    .map((circle) => String(circle?._id || '').trim())
                    .filter(Boolean)
            );
            const pendingJoinIds = new Set(
                mergedCircles
                    .filter((circle) => Boolean(circle?.joinRequestPending))
                    .map((circle) => String(circle?._id || '').trim())
                    .filter(Boolean)
            );

            setCirclesData(mergedCircles);
            setJoinedCircles(joinedCircleIds);
            setPendingJoinCircleIds(pendingJoinIds);

            if (allResult.status !== 'fulfilled' && myResult.status === 'fulfilled') {
                setCirclesError('Could not load explore communities right now. Showing your communities.');
            } else if (allResult.status !== 'fulfilled' && myResult.status !== 'fulfilled') {
                setCirclesError('Could not load communities right now.');
            }
        } catch (_error) {
            setCirclesData([]);
            setJoinedCircles(new Set());
            setPendingJoinCircleIds(new Set());
            setCirclesError('Could not load communities right now.');
        } finally {
            setCirclesLoading(false);
            setCirclesRefreshing(false);
        }
    }, []);

    const toggleJoinCircle = useCallback(async (id) => {
        const alreadyJoined = joinedCircles.has(id);
        if (alreadyJoined) return;
        if (pendingJoinCircleIds.has(id)) return;

        try {
            const { data } = await client.post(`/api/circles/${id}/join`, {}, {
                __skipApiErrorHandler: true,
            });
            if (data?.joined) {
                setJoinedCircles((prev) => new Set(prev).add(id));
                setPendingJoinCircleIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
                void fetchCircles({ refreshing: false });
                return;
            }
            if (data?.pendingApproval) {
                setPendingJoinCircleIds((prev) => new Set(prev).add(id));
                Alert.alert('Request sent', 'Your join request is pending admin approval.');
                return;
            }
        } catch (error) {
            Alert.alert('Join Failed', 'Could not join this circle right now.');
        }
    }, [fetchCircles, joinedCircles, pendingJoinCircleIds]);

    const handleRefreshCircles = useCallback(async () => {
        await fetchCircles({ refreshing: true });
    }, [fetchCircles]);

    const circlesList = useMemo(() => (
        Array.isArray(circlesData) && circlesData.length > 0
            ? circlesData
                .filter((circle) => circle && typeof circle === 'object')
                .map((circle, index) => {
                    const circleName = String(circle.name || '').trim() || `Community ${index + 1}`;
                    return ({
                        _id: String(circle._id || `circle-${index}`),
                        name: circleName,
                        category: circle.category || circle.skill || 'Community',
                        members: `${Number(circle.memberCount || (Array.isArray(circle.memberIds) ? circle.memberIds.length : (Array.isArray(circle.members) ? circle.members.length : 0)))}`,
                        online: 0,
                        desc: circle.description || 'Join this circle to connect with professionals nearby.',
                        topics: [circle.category || circle.skill || 'Updates', Number(circle.communityTrustScore || 0) >= 65 ? 'High Trust' : 'Active'],
                        rates: Array.isArray(circle.rates) ? circle.rates : [],
                        privacy: String(circle.privacy || 'public'),
                        trustScore: Number(circle.communityTrustScore || 50),
                        isAdmin: Boolean(circle.isAdmin),
                        isCreator: Boolean(circle.isCreator),
                        canDelete: Boolean(circle.canDelete || circle.isAdmin || circle.isCreator),
                    });
                })
            : []
    ), [circlesData]);

    const handleOpenCircle = useCallback(async (circle) => {
        setSelectedCircle(circle);
        setCircleDetailTab('DISCUSSION');
        setCircleMessages([]);
        setCircleMembers([]);
        setCircleDetailLoading(true);
        const circleId = String(circle?._id || '').trim();
        if (!circleId) {
            setCircleDetailLoading(false);
            return;
        }

        try {
            const [communityRes, postsRes, membersRes] = await Promise.all([
                client.get(`/api/circles/${circleId}`, {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
                client.get(`/api/circles/${circleId}/posts`, {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
                client.get(`/api/circles/${circleId}/members`, {
                    __skipApiErrorHandler: true,
                    timeout: CONNECT_READ_TIMEOUT_MS,
                    __maxRetries: 1,
                }),
            ]);
            const community = (communityRes?.data?.community && typeof communityRes.data.community === 'object')
                ? communityRes.data.community
                : null;
            const posts = Array.isArray(postsRes?.data?.posts)
                ? postsRes.data.posts.filter((post) => post && typeof post === 'object' && !isDemoRecord(post))
                : [];
            const members = Array.isArray(membersRes?.data?.members)
                ? membersRes.data.members.filter((member) => member && typeof member === 'object' && !isDemoRecord(member))
                : [];

            if (community) {
                setSelectedCircle((prev) => ({
                    ...(prev && typeof prev === 'object' ? prev : {}),
                    _id: String(community._id || circleId),
                    name: String(community.name || circle?.name || 'Community'),
                    category: String(community.category || circle?.category || 'Community'),
                    members: String(community.memberCount || community.memberIds?.length || members.length || 0),
                    online: String(prev?.online || 0),
                    desc: String(community.description || circle?.desc || ''),
                    topics: [
                        String(community.category || circle?.category || 'Updates'),
                        Number(community.communityTrustScore || 0) >= 65 ? 'High Trust' : 'Active',
                    ],
                    rates: Array.isArray(community.rates) ? community.rates : [],
                    privacy: String(community.privacy || 'public'),
                    trustScore: Number(community.communityTrustScore || 50),
                    isAdmin: Boolean(community.isAdmin),
                    isCreator: Boolean(community.isCreator),
                    canDelete: Boolean(community.canDelete || community.isAdmin || community.isCreator),
                }));
            }

            setCircleMessages(posts.map(mapCirclePostToMessage).reverse());
            setCircleMembers(members.map((member) => ({
                id: String(member?._id || ''),
                name: member?.name || 'Member',
                role: member?.role || 'member',
                joined: '',
                avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(member?.name || 'Member')}&background=8b3dff&color=fff&rounded=true`,
                isAdmin: Boolean(member?.isAdmin),
            })));
        } catch (error) {
            setCircleMessages([]);
            setCircleMembers([]);
            Alert.alert('Community Unavailable', 'Could not load community details right now.');
        } finally {
            setCircleDetailLoading(false);
        }
    }, [mapCirclePostToMessage]);

    const handleCloseCircleDetail = useCallback(() => {
        setSelectedCircle(null);
    }, []);

    const handleCircleDetailTabChange = useCallback((nextTab) => {
        setCircleDetailTab(nextTab);
    }, []);

    const handleShareCircle = useCallback(async () => {
        const circleId = String(selectedCircle?._id || '').trim();
        if (!circleId) return;

        try {
            const { data } = await client.get(`/api/growth/share-link/community/${circleId}`, {
                __skipApiErrorHandler: true,
            });
            const shareLink = String(data?.shareLink || '').trim();
            if (!shareLink) {
                throw new Error('Share link unavailable');
            }
            await Share.share({
                message: `Join my community on HireCircle: ${shareLink}`,
            });
        } catch (_error) {
            Alert.alert('Share unavailable', 'Could not generate community invite link right now.');
        }
    }, [selectedCircle?._id]);

    const handleLeaveCircle = useCallback(async () => {
        const circleId = String(selectedCircle?._id || '').trim();
        if (!circleId) return;

        try {
            await client.post(`/api/circles/${circleId}/leave`, {}, {
                __skipApiErrorHandler: true,
            });
            setJoinedCircles((prev) => {
                const next = new Set(prev);
                next.delete(circleId);
                return next;
            });
            setPendingJoinCircleIds((prev) => {
                const next = new Set(prev);
                next.delete(circleId);
                return next;
            });
            setSelectedCircle(null);
            await fetchCircles({ refreshing: false });
            showPulseToast('Left community successfully.');
        } catch (_error) {
            Alert.alert('Leave failed', 'Could not leave this community right now.');
        }
    }, [fetchCircles, selectedCircle?._id, showPulseToast]);

    const handleDeleteCircle = useCallback(async () => {
        const circleId = String(selectedCircle?._id || '').trim();
        if (!circleId) return;

        Alert.alert(
            'Delete community?',
            'This will permanently remove the community, posts, and related data for everyone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await client.delete(`/api/circles/${circleId}`, {
                                __skipApiErrorHandler: true,
                            });
                            setCirclesData((prev) => (
                                Array.isArray(prev)
                                    ? prev.filter((circle) => String(circle?._id || '') !== circleId)
                                    : []
                            ));
                            setJoinedCircles((prev) => {
                                const next = new Set(prev);
                                next.delete(circleId);
                                return next;
                            });
                            setPendingJoinCircleIds((prev) => {
                                const next = new Set(prev);
                                next.delete(circleId);
                                return next;
                            });
                            setSelectedCircle(null);
                            await fetchCircles({ refreshing: false });
                            showPulseToast('Community deleted successfully.');
                        } catch (error) {
                            Alert.alert('Delete failed', getApiErrorMessage(error, 'Could not delete this community right now.'));
                        }
                    },
                },
            ]
        );
    }, [fetchCircles, selectedCircle?._id, showPulseToast]);

    const handleCircleSendMessage = useCallback(async () => {
        const text = String(chatText || '').trim();
        const circleId = String(selectedCircle?._id || '').trim();
        if (!text || !circleId) return;

        try {
            const { data } = await client.post(`/api/circles/${circleId}/posts`, { text }, {
                __skipApiErrorHandler: true,
            });
            if (!data?.post) {
                throw new Error('Message response invalid');
            }
            const message = mapCirclePostToMessage(data.post);
            setCircleMessages((prev) => [...prev, message]);
            setChatText('');
            if (circleScrollTimeoutRef.current) {
                clearTimeout(circleScrollTimeoutRef.current);
            }
            circleScrollTimeoutRef.current = setTimeout(() => {
                circleChatRef.current?.scrollToEnd({ animated: true });
            }, 50);
        } catch (error) {
            Alert.alert('Message Failed', 'Could not send message right now.');
        }
    }, [chatText, mapCirclePostToMessage, selectedCircle?._id]);

    const handleShowCircleRateForm = useCallback(() => {
        setShowCircleRateForm(true);
    }, []);

    const handleCancelCircleRateForm = useCallback(() => {
        setShowCircleRateForm(false);
        setCircleRateService('');
        setCircleRatePrice('');
    }, []);

    const handleSubmitCircleRate = useCallback(async () => {
        const service = String(circleRateService || '').trim();
        const price = String(circleRatePrice || '').trim();
        const circleId = String(selectedCircle?._id || '').trim();
        if (!service || !price || !circleId) return;

        try {
            const { data } = await client.post(`/api/circles/${circleId}/rates`, {
                service,
                price,
            }, {
                __skipApiErrorHandler: true,
            });

            const serverRates = Array.isArray(data?.rates)
                ? data.rates.filter((rate) => rate && typeof rate === 'object')
                : [];
            if (serverRates.length > 0) {
                setSelectedCircle((prev) => ({
                    ...(prev && typeof prev === 'object' ? prev : {}),
                    rates: serverRates,
                }));
            } else {
                setCircleCustomRates((prev) => [...prev, { service, price }]);
            }

            setCircleRateService('');
            setCircleRatePrice('');
            setShowCircleRateForm(false);
            showPulseToast('Rate suggestion submitted.');
        } catch (_error) {
            Alert.alert('Submit failed', 'Could not submit rate suggestion right now.');
        }
    }, [circleRatePrice, circleRateService, selectedCircle?._id, showPulseToast]);

    const clearConnectLocalState = useCallback(() => {
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
        setLikeCountMap({});
        setCommentsByPostId({});
        setActiveCommentPostId(null);
        setCommentInputMap({});
        setPostingFeed(false);
        setFeedProfileVisible(false);
        setFeedProfileLoading(false);
        setFeedProfileData(null);

        setPulseItems([]);
        setNearbyPros([]);
        setAppliedGigIds(new Set());
        setHiredProIds(new Set());
        setRadarRefreshing(false);
        setPulseLoading(true);
        setPulseError('');
        setNearbyProsError('');

        setCirclesData([]);
        setJoinedCircles(new Set());
        setSelectedCircle(null);
        setCircleMessages([]);
        setCircleMembers([]);
        setCirclesLoading(false);
        setCirclesRefreshing(false);
        setCirclesError('');
        setCircleDetailLoading(false);
        setCircleCustomRates([]);
        setShowCircleRateForm(false);
        setCircleRateService('');
        setCircleRatePrice('');

        setBountyItems([]);
        setReferralStats({ totalEarnings: 0 });
        setReferredBountyIds(new Set());
        setBountiesLoading(false);
        setBountiesRefreshing(false);
        setBountiesError('');
        setBountyActionInFlightId('');
        setBountyCreating(false);
        setReferringBounty(null);
        setReferPhoneInput('');
        setReferPhoneError('');
        setReferSending(false);

        setAcademyCourses([]);
        setEnrolledCourses([]);
        setEnrolledCourseIds(new Set());
        setAcademyMentors([]);
        setConnectedMentorIds(new Set());
        setAcademyLoading(false);
        setAcademyRefreshingMentors(false);
        setAcademyError('');

        setPulseToast(null);
        setBountyToast(null);

        feedRefreshingInFlightRef.current = false;
        feedPagingInFlightRef.current = false;
        feedLastLoadMoreAtRef.current = 0;
    }, []);

    const clearConnectHistory = useCallback(async () => {
        if (resettingConnectData) {
            return { ok: false, message: 'Connect cleanup is already running.' };
        }

        setResettingConnectData(true);
        try {
            try {
                await client.delete('/api/feed/reset-connect', {
                    params: { scope: 'all' },
                    __skipApiErrorHandler: true,
                });
            } catch (error) {
                const statusCode = Number(error?.response?.status || 0);
                if (statusCode === 403) {
                    await client.delete('/api/feed/reset-connect', {
                        params: { scope: 'self' },
                        __skipApiErrorHandler: true,
                    });
                } else {
                    throw error;
                }
            }

            clearConnectLocalState();
            await Promise.allSettled([
                fetchFeedPosts(1, true),
                fetchPulseItems(),
                fetchNearbyPros(),
                fetchAcademyData({ refreshMentorsOnly: false }),
                fetchCircles({ refreshing: false }),
                fetchBounties({ refreshing: false }),
            ]);

            showBountyToast('Connect history cleared.');
            return { ok: true };
        } catch (error) {
            return {
                ok: false,
                message: getApiErrorMessage(error, 'Could not clear Connect history right now.'),
            };
        } finally {
            setResettingConnectData(false);
        }
    }, [
        resettingConnectData,
        clearConnectLocalState,
        fetchFeedPosts,
        fetchPulseItems,
        fetchNearbyPros,
        fetchAcademyData,
        fetchCircles,
        fetchBounties,
        showBountyToast,
    ]);

    useEffect(() => {
        const nextKey = `${String(currentUserId || '')}:${isEmployerRole ? 'employer' : 'worker'}`;
        if (!currentUserId) return;
        if (bootstrapLoadKeyRef.current === nextKey) return;
        bootstrapLoadKeyRef.current = nextKey;
        academyMentorsAutoLoadedRef.current = false;
        nearbyProsAutoLoadedRef.current = false;

        fetchFeedPosts(1, true);
        const backgroundBootstrapTimer = setTimeout(() => {
            fetchPulseItems();
            fetchAcademyData({ refreshMentorsOnly: false, includeMentorMatch: false });
            fetchCircles();
            fetchBounties();
        }, 180);

        return () => {
            clearTimeout(backgroundBootstrapTimer);
        };
    }, [
        currentUserId,
        isEmployerRole,
        fetchFeedPosts,
        fetchPulseItems,
        fetchAcademyData,
        fetchCircles,
        fetchBounties,
    ]);

    useEffect(() => {
        if (String(activeTab || '').toLowerCase() !== 'pulse') return;
        if (!isEmployerRole) return;
        if (nearbyProsAutoLoadedRef.current) return;
        nearbyProsAutoLoadedRef.current = true;
        fetchNearbyPros();
    }, [activeTab, fetchNearbyPros, isEmployerRole]);

    useEffect(() => {
        if (String(activeTab || '').toLowerCase() !== 'academy') return;
        if (academyMentorsAutoLoadedRef.current) return;
        academyMentorsAutoLoadedRef.current = true;
        const hasOverviewData = academyCourses.length > 0 || enrolledCourses.length > 0;
        fetchAcademyData({
            refreshMentorsOnly: hasOverviewData,
            includeMentorMatch: true,
        });
    }, [activeTab, academyCourses.length, enrolledCourses.length, fetchAcademyData]);

    useEffect(() => {
        if (pulseLoopRef.current) {
            return undefined;
        }

        pulseLoopRef.current = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
                Animated.timing(pulseAnim, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
            ])
        );
        pulseLoopRef.current.start();

        return () => {
            if (pulseLoopRef.current) {
                pulseLoopRef.current.stop();
                pulseLoopRef.current = null;
            }
            if (pulseToastTimeoutRef.current) {
                clearTimeout(pulseToastTimeoutRef.current);
                pulseToastTimeoutRef.current = null;
            }
            if (bountyToastTimeoutRef.current) {
                clearTimeout(bountyToastTimeoutRef.current);
                bountyToastTimeoutRef.current = null;
            }
            if (circleScrollTimeoutRef.current) {
                clearTimeout(circleScrollTimeoutRef.current);
                circleScrollTimeoutRef.current = null;
            }
            const activeVoiceRecording = voiceRecordingRef.current;
            if (activeVoiceRecording) {
                voiceRecordingRef.current = null;
                activeVoiceRecording.stopAndUnloadAsync().catch(() => { });
            }
        };
    }, [pulseAnim]);

    const bountiesList = useMemo(() => (Array.isArray(bountyItems) ? bountyItems : []), [bountyItems]);

    const bountyEarningsTotal = useMemo(() => {
        return Number(referralStats?.totalEarnings || 0);
    }, [referralStats?.totalEarnings]);

    const currentUserAvatar = useMemo(() => {
        const displayName = String(userInfo?.name || 'User').trim() || 'User';
        return String(
            userInfo?.avatar
            || userInfo?.profilePicture
            || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=d1d5db&color=111111&rounded=true`
        );
    }, [userInfo?.avatar, userInfo?.name, userInfo?.profilePicture]);

    const feedTabProps = useMemo(() => ({
        feedPosts,
        isEmployerRole,
        loadingFeed,
        feedPullRefreshing,
        loadingMoreFeed,
        feedError,
        composerOpen,
        composerMediaType,
        composerText,
        composerVisibility,
        composerMediaAssets,
        isVoiceRecording,
        postingFeed,
        likedPostIds,
        savedPostIds,
        likeCountMap,
        commentsByPostId,
        activeCommentPostId,
        commentInputMap,
        currentUserId,
        currentUserAvatar,
        jobPreview,
        jobPreviewVisible,
        jobPreviewLoading,
        jobPreviewApplying,
        hasAppliedToPreviewJob: jobPreview?._id ? appliedJobPreviewIds.has(String(jobPreview._id)) : false,
        onRefreshFeed: handleRefreshFeed,
        onRetryFeed: () => fetchFeedPosts(1, true),
        onLoadMoreFeed: handleLoadMoreFeed,
        onMediaButtonClick: handleMediaButtonClick,
        onInputAreaClick: handleInputAreaClick,
        onCancelComposer: handleCancelComposer,
        onStopVoiceRecording: handleStopVoiceRecording,
        onRemoveComposerMedia: handleRemoveComposerMedia,
        onPost: handlePost,
        onComposerTextChange: setComposerText,
        onComposerVisibilityToggle: handleToggleComposerVisibility,
        onComposerVisibilitySelect: handleSetComposerVisibility,
        onToggleLike: handleToggleLike,
        onToggleSavePost: handleToggleSavePost,
        onToggleComment: handleToggleComment,
        onOpenComments: fetchPostComments,
        onToggleVouch: handleVouch,
        onCommentInputChange: handleCommentInputChange,
        onSubmitComment: handleSubmitComment,
        onReportPost: handleReportPost,
        onDeletePost: handleDeletePost,
        onOpenAuthorProfile: handleOpenFeedProfile,
        onCloseJobPreview: closeJobPreview,
        onApplyJobPreview: applyFromJobPreview,
    }), [
        feedPosts,
        isEmployerRole,
        loadingFeed,
        feedPullRefreshing,
        loadingMoreFeed,
        feedError,
        composerOpen,
        composerMediaType,
        composerText,
        composerVisibility,
        composerMediaAssets,
        isVoiceRecording,
        postingFeed,
        likedPostIds,
        savedPostIds,
        likeCountMap,
        commentsByPostId,
        activeCommentPostId,
        commentInputMap,
        currentUserId,
        handleRefreshFeed,
        fetchFeedPosts,
        handleLoadMoreFeed,
        handleMediaButtonClick,
        handleInputAreaClick,
        handleCancelComposer,
        handleStopVoiceRecording,
        handleRemoveComposerMedia,
        handlePost,
        handleToggleComposerVisibility,
        handleSetComposerVisibility,
        handleToggleLike,
        handleToggleSavePost,
        handleToggleComment,
        fetchPostComments,
        handleVouch,
        handleCommentInputChange,
        handleSubmitComment,
        handleReportPost,
        handleDeletePost,
        handleOpenFeedProfile,
        currentUserAvatar,
        jobPreview,
        jobPreviewVisible,
        jobPreviewLoading,
        jobPreviewApplying,
        appliedJobPreviewIds,
        closeJobPreview,
        applyFromJobPreview,
    ]);

    const pulseTabProps = useMemo(() => ({
        pulseItems,
        nearbyPros,
        isEmployerRole,
        appliedGigIds,
        hiredProIds,
        radarRefreshing,
        pulseLoading,
        pulseError,
        nearbyProsError,
        pulseAnim,
        onRefreshRadar: handleRefreshRadar,
        onRetryPulse: handleRefreshRadar,
        onApplyGig: handleApplyGig,
        onHirePro: handleHirePro,
    }), [
        pulseItems,
        nearbyPros,
        isEmployerRole,
        appliedGigIds,
        hiredProIds,
        radarRefreshing,
        pulseLoading,
        pulseError,
        nearbyProsError,
        pulseAnim,
        handleRefreshRadar,
        handleApplyGig,
        handleHirePro,
    ]);

    const circlesTabProps = useMemo(() => ({
        circles: circlesList,
        joinedCircles,
        loading: circlesLoading,
        refreshing: circlesRefreshing,
        errorMessage: circlesError,
        pendingJoinCircleIds,
        onOpenCircle: handleOpenCircle,
        onJoinCircle: toggleJoinCircle,
        onRefreshCircles: handleRefreshCircles,
    }), [
        circlesList,
        joinedCircles,
        circlesLoading,
        circlesRefreshing,
        circlesError,
        pendingJoinCircleIds,
        handleOpenCircle,
        toggleJoinCircle,
        handleRefreshCircles,
    ]);

    const academyTabProps = useMemo(() => ({
        academyCourses,
        enrolledCourses,
        enrolledCourseIds,
        mentors: academyMentors,
        connectedMentorIds,
        isLoading: academyLoading,
        isMentorRefreshing: academyRefreshingMentors,
        academyError,
        onEnrollCourse: handleEnrollCourse,
        onConnectMentor: handleConnectMentor,
        onRefreshMentors: handleRefreshMentors,
        onRetryAcademy: handleRetryAcademy,
        onBecomeMentor: handleBecomeMentor,
        onStartReferralAction: handleStartReferralAction,
    }), [
        academyCourses,
        enrolledCourses,
        enrolledCourseIds,
        academyMentors,
        connectedMentorIds,
        academyLoading,
        academyRefreshingMentors,
        academyError,
        handleEnrollCourse,
        handleConnectMentor,
        handleRefreshMentors,
        handleRetryAcademy,
        handleBecomeMentor,
        handleStartReferralAction,
    ]);

    const bountiesTabProps = useMemo(() => ({
        bounties: bountiesList,
        isEmployerRole,
        loading: bountiesLoading,
        refreshing: bountiesRefreshing,
        errorMessage: bountiesError,
        bountyActionInFlightId,
        isCreatingBounty: bountyCreating,
        referredBountyIds,
        totalEarned: bountyEarningsTotal,
        onOpenReferModal: handleOpenReferModal,
        onRefreshBounties: handleRefreshBounties,
        onCreateBounty: handleCreateBounty,
        onSubmitBountyEntry: handleSubmitBountyEntry,
        onStartAction: handleStartReferralAction,
    }), [
        bountiesList,
        isEmployerRole,
        bountiesLoading,
        bountiesRefreshing,
        bountiesError,
        bountyActionInFlightId,
        bountyCreating,
        referredBountyIds,
        bountyEarningsTotal,
        handleOpenReferModal,
        handleRefreshBounties,
        handleCreateBounty,
        handleSubmitBountyEntry,
        handleStartReferralAction,
    ]);

    const circleDetailProps = useMemo(() => ({
        visible: !!selectedCircle,
        selectedCircle,
        circleDetailLoading,
        onClose: handleCloseCircleDetail,
        circleDetailTab,
        onTabChange: handleCircleDetailTabChange,
        onShareCommunity: handleShareCircle,
        onLeaveCommunity: handleLeaveCircle,
        onDeleteCommunity: handleDeleteCircle,
        canDeleteCommunity: Boolean(selectedCircle?.canDelete || selectedCircle?.isAdmin || selectedCircle?.isCreator),
        circleChatRef,
        chatText,
        onChatTextChange: setChatText,
        onSendTextMessage: handleCircleSendMessage,
        circleMembers,
        circleCustomRates,
        showCircleRateForm,
        circleRateService,
        circleRatePrice,
        onCircleRateServiceChange: setCircleRateService,
        onCircleRatePriceChange: setCircleRatePrice,
        onSubmitRate: handleSubmitCircleRate,
        onShowRateForm: handleShowCircleRateForm,
        onCancelRateForm: handleCancelCircleRateForm,
    }), [
        selectedCircle,
        circleDetailLoading,
        handleCloseCircleDetail,
        circleDetailTab,
        handleCircleDetailTabChange,
        handleShareCircle,
        handleLeaveCircle,
        handleDeleteCircle,
        chatText,
        handleCircleSendMessage,
        circleMembers,
        circleCustomRates,
        showCircleRateForm,
        circleRateService,
        circleRatePrice,
        handleSubmitCircleRate,
        handleShowCircleRateForm,
        handleCancelCircleRateForm,
        selectedCircle?.canDelete,
        selectedCircle?.isAdmin,
        selectedCircle?.isCreator,
    ]);

    const referralModalProps = useMemo(() => ({
        visible: !!referringBounty,
        referringBounty,
        referPhoneInput,
        referPhoneError,
        isSending: referSending,
        onClose: handleCloseReferModal,
        onPhoneChange: handleReferPhoneChange,
        onSendReferral: handleSendReferral,
    }), [
        referringBounty,
        referPhoneInput,
        referPhoneError,
        referSending,
        handleCloseReferModal,
        handleReferPhoneChange,
        handleSendReferral,
    ]);

    return {
        userInfo,
        activeTab,
        setActiveTab,
        showMyProfile,
        setShowMyProfile,
        resettingConnectData,
        clearConnectHistory,
        feedProfileVisible,
        feedProfileLoading,
        feedProfileData,
        closeFeedProfile,
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
