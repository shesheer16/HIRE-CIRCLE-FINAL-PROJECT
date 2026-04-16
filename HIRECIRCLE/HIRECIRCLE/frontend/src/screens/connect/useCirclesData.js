/**
 * useCirclesData.js
 * Domain hook: Circles tab — communities list, circle detail, chat, members, rates.
 * Shared deps: showPulseToast
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../../api/client';
import {
    CONNECT_READ_TIMEOUT_MS,
    isDemoRecord,
    getApiErrorMessage,
    timeAgo,
} from './connectUtils';
import {
    SCREENSHOT_CIRCLE_MEMBERS,
    SCREENSHOT_CIRCLE_MESSAGES,
    SCREENSHOT_CIRCLE_RATES,
    SCREENSHOT_CIRCLES,
    SCREENSHOT_JOINED_CIRCLE_IDS,
    SCREENSHOT_MOCKS_ENABLED,
    SCREENSHOT_PENDING_JOIN_IDS,
} from '../../config/screenshotMocks';

const CIRCLES_CACHE_KEY = '@circles_cache_v1';

/**
 * @param {object} params
 * @param {function} params.showPulseToast
 */
export function useCirclesData({ showPulseToast }) {
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
    const circlesCachePrimedRef = useRef(false);

    const applyScreenshotMocks = useCallback(() => {
        if (!SCREENSHOT_MOCKS_ENABLED) return;
        setCirclesData(SCREENSHOT_CIRCLES);
        setJoinedCircles(new Set(SCREENSHOT_JOINED_CIRCLE_IDS));
        setPendingJoinCircleIds(new Set(SCREENSHOT_PENDING_JOIN_IDS));
        setCirclesLoading(false);
        setCirclesRefreshing(false);
        setCirclesError('');
    }, []);

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

    const primeCirclesFromCache = useCallback(async () => {
        if (circlesCachePrimedRef.current) return false;
        circlesCachePrimedRef.current = true;
        try {
            const cachedRaw = await AsyncStorage.getItem(CIRCLES_CACHE_KEY);
            if (!cachedRaw) return false;
            const parsed = JSON.parse(cachedRaw);
            if (!Array.isArray(parsed) || !parsed.length) return false;
            setCirclesData(parsed.filter((item) => item && typeof item === 'object'));
            setCirclesLoading(false);
            return true;
        } catch (_error) {
            return false;
        }
    }, []);

    const fetchCircles = useCallback(async (options = {}) => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            applyScreenshotMocks();
            return;
        }
        const refreshing = Boolean(options?.refreshing);
        const isColdStart = !refreshing && circlesData.length === 0;
        if (isColdStart) { primeCirclesFromCache(); }
        if (refreshing) {
            setCirclesRefreshing(true);
        } else {
            setCirclesLoading(true);
        }
        setCirclesError('');
        const loadCap = setTimeout(() => {
            setCirclesLoading(false);
            setCirclesRefreshing(false);
            setCirclesError((prev) => prev || 'Communities are taking longer than usual. Pull to refresh.');
        }, 5000);

        try {
            const [allResult, myResult] = await Promise.allSettled([
                client.get('/api/circles', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
                client.get('/api/circles/my', {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
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
                mergedCircleMap.set(circleId, { ...existing, ...circle, isJoined: true });
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
            AsyncStorage.setItem(CIRCLES_CACHE_KEY, JSON.stringify(mergedCircles.slice(0, 60))).catch(() => {});

            if (allResult.status !== 'fulfilled' && myResult.status === 'fulfilled') {
                setCirclesError('Could not load explore communities right now. Showing your communities.');
            } else if (allResult.status !== 'fulfilled' && myResult.status !== 'fulfilled') {
                setCirclesError('Could not load communities right now.');
            }
        } catch (_error) {
            const appliedCache = await primeCirclesFromCache();
            if (!appliedCache) {
                setCirclesData([]);
                setJoinedCircles(new Set());
                setPendingJoinCircleIds(new Set());
                setCirclesError('Could not load communities right now.');
            } else {
                setCirclesError('Showing saved communities — pull to refresh.');
            }
        } finally {
            clearTimeout(loadCap);
            setCirclesLoading(false);
            setCirclesRefreshing(false);
        }
    }, [circlesData.length, primeCirclesFromCache]);

    const toggleJoinCircle = useCallback(async (id) => {
        if (joinedCircles.has(id) || pendingJoinCircleIds.has(id)) return;
        try {
            const { data } = await client.post(`/api/circles/${id}/join`, {}, { __skipApiErrorHandler: true });
            if (data?.joined) {
                setJoinedCircles((prev) => new Set(prev).add(id));
                setPendingJoinCircleIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
                void fetchCircles({ refreshing: false });
                return;
            }
            if (data?.pendingApproval) {
                setPendingJoinCircleIds((prev) => new Set(prev).add(id));
                Alert.alert('Request sent', 'Your join request is pending admin approval.');
            }
        } catch (error) {
            Alert.alert('Join Failed', 'Could not join this circle right now.');
        }
    }, [fetchCircles, joinedCircles, pendingJoinCircleIds]);

    const handleRefreshCircles = useCallback(async () => {
        await fetchCircles({ refreshing: true });
    }, [fetchCircles]);

    const handleCreateCircle = useCallback(async ({ name, category, description, privacy }) => {
        const normalizedName = String(name || '').trim();
        if (normalizedName.length < 2) throw new Error('Community name must be at least 2 characters.');
        try {
            await client.post('/api/circles', {
                name: normalizedName,
                category: String(category || '').trim() || undefined,
                description: String(description || '').trim() || undefined,
                privacy: privacy || 'public',
                isPrivate: (privacy || 'public') === 'private',
            }, { __skipApiErrorHandler: true });
            await fetchCircles({ refreshing: false });
        } catch (error) {
            const message = getApiErrorMessage(error, 'Could not create community right now. Please try again.');
            throw new Error(message);
        }
    }, [fetchCircles]);

    const handleOpenCircle = useCallback(async (circle) => {
        if (SCREENSHOT_MOCKS_ENABLED) {
            setSelectedCircle(circle);
            setCircleDetailTab('DISCUSSION');
            setCircleMessages(SCREENSHOT_CIRCLE_MESSAGES);
            setCircleMembers(SCREENSHOT_CIRCLE_MEMBERS);
            setCircleCustomRates(SCREENSHOT_CIRCLE_RATES);
            setCircleDetailLoading(false);
            return;
        }
        setSelectedCircle(circle);
        setCircleDetailTab('DISCUSSION');
        setCircleMessages([]);
        setCircleMembers([]);
        setCircleDetailLoading(true);
        const circleId = String(circle?._id || '').trim();
        if (!circleId) { setCircleDetailLoading(false); return; }

        try {
            const [communityRes, postsRes, membersRes] = await Promise.all([
                client.get(`/api/circles/${circleId}`, {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
                client.get(`/api/circles/${circleId}/posts`, {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
                client.get(`/api/circles/${circleId}/members`, {
                    __skipApiErrorHandler: true, timeout: CONNECT_READ_TIMEOUT_MS, __maxRetries: 1,
                }),
            ]);

            const community = (communityRes?.data?.community && typeof communityRes.data.community === 'object')
                ? communityRes.data.community : null;
            const posts = Array.isArray(postsRes?.data?.posts)
                ? postsRes.data.posts.filter((post) => post && typeof post === 'object' && !isDemoRecord(post)) : [];
            const members = Array.isArray(membersRes?.data?.members)
                ? membersRes.data.members.filter((member) => member && typeof member === 'object' && !isDemoRecord(member)) : [];

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

    const handleCloseCircleDetail = useCallback(() => setSelectedCircle(null), []);

    const handleCircleDetailTabChange = useCallback((nextTab) => setCircleDetailTab(nextTab), []);

    const handleShareCircle = useCallback(async () => {
        const circleId = String(selectedCircle?._id || '').trim();
        if (!circleId) return;
        try {
            const { data } = await client.get(`/api/growth/share-link/community/${circleId}`, { __skipApiErrorHandler: true });
            const shareLink = String(data?.shareLink || '').trim();
            if (!shareLink) throw new Error('Share link unavailable');
            await Share.share({ message: `Join my community on HireCircle: ${shareLink}` });
        } catch (_error) {
            Alert.alert('Share unavailable', 'Could not generate community invite link right now.');
        }
    }, [selectedCircle?._id]);

    const handleLeaveCircle = useCallback(async () => {
        const circleId = String(selectedCircle?._id || '').trim();
        if (!circleId) return;
        try {
            await client.post(`/api/circles/${circleId}/leave`, {}, { __skipApiErrorHandler: true });
            setJoinedCircles((prev) => { const next = new Set(prev); next.delete(circleId); return next; });
            setPendingJoinCircleIds((prev) => { const next = new Set(prev); next.delete(circleId); return next; });
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
                            await client.delete(`/api/circles/${circleId}`, { __skipApiErrorHandler: true });
                            setCirclesData((prev) => (
                                Array.isArray(prev) ? prev.filter((circle) => String(circle?._id || '') !== circleId) : []
                            ));
                            setJoinedCircles((prev) => { const next = new Set(prev); next.delete(circleId); return next; });
                            setPendingJoinCircleIds((prev) => { const next = new Set(prev); next.delete(circleId); return next; });
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
            const { data } = await client.post(`/api/circles/${circleId}/posts`, { text }, { __skipApiErrorHandler: true });
            if (!data?.post) throw new Error('Message response invalid');
            const message = mapCirclePostToMessage(data.post);
            setCircleMessages((prev) => [...prev, message]);
            setChatText('');
            if (circleScrollTimeoutRef.current) clearTimeout(circleScrollTimeoutRef.current);
            circleScrollTimeoutRef.current = setTimeout(() => {
                circleChatRef.current?.scrollToEnd({ animated: true });
            }, 50);
        } catch (error) {
            Alert.alert('Message Failed', 'Could not send message right now.');
        }
    }, [chatText, mapCirclePostToMessage, selectedCircle?._id]);

    const handleShowCircleRateForm = useCallback(() => setShowCircleRateForm(true), []);

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
            const { data } = await client.post(`/api/circles/${circleId}/rates`, { service, price }, { __skipApiErrorHandler: true });
            const serverRates = Array.isArray(data?.rates) ? data.rates.filter((rate) => rate && typeof rate === 'object') : [];
            if (serverRates.length > 0) {
                setSelectedCircle((prev) => ({ ...(prev && typeof prev === 'object' ? prev : {}), rates: serverRates }));
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

    const resetCirclesState = useCallback(() => {
        setCirclesData([]);
        setJoinedCircles(new Set());
        setSelectedCircle(null);
        setCircleDetailTab('DISCUSSION');
        setChatText('');
        setCircleMessages([]);
        setCircleMembers([]);
        setCirclesLoading(true);
        setCirclesRefreshing(false);
        setCirclesError('');
        setPendingJoinCircleIds(new Set());
        setCircleDetailLoading(false);
        setCircleCustomRates([]);
        setShowCircleRateForm(false);
        setCircleRateService('');
        setCircleRatePrice('');
    }, []);

    return {
        // State
        joinedCircles, selectedCircle, circleDetailTab, chatText,
        circlesData, circleMessages, circleMembers, circlesLoading,
        circlesRefreshing, circlesError, pendingJoinCircleIds,
        circleDetailLoading, circleCustomRates, showCircleRateForm,
        circleRateService, circleRatePrice, circlesList,
        circleChatRef, circleScrollTimeoutRef,
        // Setters (for controlled inputs)
        setChatText, setCircleRateService, setCircleRatePrice,
        // Handlers
        fetchCircles, toggleJoinCircle, handleRefreshCircles, handleCreateCircle,
        handleOpenCircle, handleCloseCircleDetail, handleCircleDetailTabChange,
        handleShareCircle, handleLeaveCircle, handleDeleteCircle,
        handleCircleSendMessage, handleShowCircleRateForm,
        handleCancelCircleRateForm, handleSubmitCircleRate, resetCirclesState,
    };
}
