import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Share } from 'react-native';
import client from '../../api/client';
import { AuthContext } from '../../context/AuthContext';
import { DEMO_MODE } from '../../config';

const INITIAL_FEED_POSTS = [];

export const CONNECT_TABS = ['Feed', 'Pulse', 'Academy', 'Circles', 'Bounties'];
export const CURRENT_USER = { avatar: 'https://ui-avatars.com/api/?name=You&background=8b3dff&color=fff&rounded=true', name: 'You' };
export const ACADEMY_MENTORS = [];

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

export function useConnectData() {
    const { userInfo } = useContext(AuthContext);
    const currentUserId = String(userInfo?._id || '');

    const [activeTab, setActiveTab] = useState('Feed');
    const [showMyProfile, setShowMyProfile] = useState(false);

    const [joinedCircles, setJoinedCircles] = useState(new Set());
    const [selectedCircle, setSelectedCircle] = useState(null);
    const [circleDetailTab, setCircleDetailTab] = useState('DISCUSSION');
    const [chatText, setChatText] = useState('');
    const [circlesData, setCirclesData] = useState([]);
    const [circleMessages, setCircleMessages] = useState([]);
    const [circleMembers, setCircleMembers] = useState([]);
    const [isCircleRecording, setIsCircleRecording] = useState(false);
    const [circleCustomRates, setCircleCustomRates] = useState([]);
    const [showCircleRateForm, setShowCircleRateForm] = useState(false);
    const [circleRateService, setCircleRateService] = useState('');
    const [circleRatePrice, setCircleRatePrice] = useState('');
    const circleChatRef = useRef(null);
    const circleScrollTimeoutRef = useRef(null);

    const [academyCourses, setAcademyCourses] = useState([]);
    const [enrolledCourses, setEnrolledCourses] = useState([]);
    const [enrolledCourseIds, setEnrolledCourseIds] = useState(new Set());
    const [connectedMentorIds, setConnectedMentorIds] = useState(new Set());

    const [pulseItems, setPulseItems] = useState([]);
    const [appliedGigIds, setAppliedGigIds] = useState(new Set());
    const [hiredProIds, setHiredProIds] = useState(new Set());
    const [radarRefreshing, setRadarRefreshing] = useState(false);
    const [pulseToast, setPulseToast] = useState(null);
    const pulseAnim = useRef(new Animated.Value(0.3)).current;
    const pulseLoopRef = useRef(null);
    const pulseFetchRequestIdRef = useRef(0);
    const pulseToastTimeoutRef = useRef(null);

    const [bountyItems, setBountyItems] = useState([]);
    const [referralStats, setReferralStats] = useState(null);
    const [referredBountyIds, setReferredBountyIds] = useState(new Set());
    const [referringBounty, setReferringBounty] = useState(null);
    const [referPhoneInput, setReferPhoneInput] = useState('');
    const [referPhoneError, setReferPhoneError] = useState('');
    const [bountyToast, setBountyToast] = useState(null);
    const bountyToastTimeoutRef = useRef(null);

    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMediaType, setComposerMediaType] = useState(null);
    const [composerText, setComposerText] = useState('');
    const [feedPosts, setFeedPosts] = useState(INITIAL_FEED_POSTS);
    const [feedPage, setFeedPage] = useState(1);
    const [hasMoreFeed, setHasMoreFeed] = useState(true);
    const [loadingFeed, setLoadingFeed] = useState(false);
    const [loadingMoreFeed, setLoadingMoreFeed] = useState(false);
    const [likedPostIds, setLikedPostIds] = useState(new Set());
    const [likeCountMap, setLikeCountMap] = useState({});
    const [commentsByPostId, setCommentsByPostId] = useState({});
    const [activeCommentPostId, setActiveCommentPostId] = useState(null);
    const [commentInputMap, setCommentInputMap] = useState({});

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
    }, [circleMessages.length]);

    const mapCirclePostToMessage = useCallback((post) => {
        const authorName = post?.user?.name || 'Member';
        const role = post?.user?.activeRole || post?.user?.primaryRole || 'member';
        return {
            id: String(post?._id || Date.now()),
            user: authorName,
            role: role === 'employer' ? 'Employer' : role === 'worker' ? 'Worker' : String(role),
            text: String(post?.text || ''),
            time: timeAgo(post?.createdAt),
            type: 'text',
            isAdmin: Boolean(post?.user?.isAdmin),
        };
    }, []);

    const mapApiPost = useCallback((post) => {
        const authorName = post?.user?.name || 'Member';
        const mappedType = post?.type === 'photo' ? 'gallery' : (post?.type || 'text');
        const vouchCount = Array.isArray(post?.vouches) ? post.vouches.length : 0;
        const vouched = Array.isArray(post?.vouches)
            ? post.vouches.some((id) => String(id) === currentUserId)
            : false;

        return {
            _id: String(post?._id || `post-${Date.now()}`),
            type: mappedType,
            author: authorName,
            role: post?.user?.primaryRole === 'employer' ? 'Employer' : 'Member',
            time: timeAgo(post?.createdAt),
            karma: 0,
            text: post?.content || '',
            likes: Array.isArray(post?.likes) ? post.likes.length : 0,
            comments: Array.isArray(post?.comments) ? post.comments.length : 0,
            vouched,
            vouchCount,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=9333ea&color=fff`,
            duration: mappedType === 'voice' ? '0:15' : undefined,
            mediaUrl: post?.mediaUrl || '',
        };
    }, [currentUserId]);

    const fetchFeedPosts = useCallback(async (pageToLoad = 1, replace = false) => {
        if (!DEMO_MODE) {
            if (replace) {
                setLoadingFeed(true);
            } else {
                setLoadingMoreFeed(true);
            }
        }

        try {
            const { data } = await client.get('/api/feed/posts', {
                params: { page: pageToLoad, limit: 10 },
            });
            const apiPosts = Array.isArray(data?.posts) ? data.posts : [];
            const mappedPosts = apiPosts.map(mapApiPost);
            setFeedPosts((prev) => {
                if (replace) {
                    return mappedPosts;
                }
                const seen = new Set(prev.map((post) => String(post._id)));
                const dedupedAppend = mappedPosts.filter((post) => !seen.has(String(post._id)));
                return [...prev, ...dedupedAppend];
            });
            setFeedPage(pageToLoad);
            setHasMoreFeed(Boolean(data?.hasMore));

            if (replace) {
                const counts = {};
                mappedPosts.forEach((post) => {
                    counts[post._id] = post.likes || 0;
                });
                setLikeCountMap(counts);
                setLikedPostIds(new Set());
            }
        } catch (error) {
            if (replace) {
                Alert.alert('Feed Unavailable', 'Could not load posts right now.');
            }
        } finally {
            if (!DEMO_MODE) {
                setLoadingFeed(false);
                setLoadingMoreFeed(false);
            }
        }
    }, [mapApiPost]);

    const handleMediaButtonClick = useCallback((type) => {
        setComposerOpen(true);
        setComposerMediaType(type);
    }, []);

    const handleInputAreaClick = useCallback(() => {
        setComposerOpen(true);
        setComposerMediaType('TEXT');
    }, []);

    const handleCancelComposer = useCallback(() => {
        setComposerOpen(false);
        setComposerMediaType(null);
        setComposerText('');
    }, []);

    const handlePost = useCallback(async () => {
        if (!composerText.trim()) return;

        try {
            const feedType = composerMediaType === 'VOICE'
                ? 'voice'
                : composerMediaType === 'PHOTOS'
                    ? 'photo'
                    : composerMediaType === 'VIDEO'
                        ? 'video'
                        : 'text';

            const { data } = await client.post('/api/feed/posts', {
                type: feedType,
                content: composerText.trim(),
            });

            const createdPost = data?.post
                ? mapApiPost(data.post)
                : {
                    _id: `local-${Date.now()}`,
                    type: feedType === 'photo' ? 'gallery' : feedType,
                    author: userInfo?.name || CURRENT_USER.name,
                    role: 'Member',
                    time: 'Just now',
                    karma: 0,
                    text: composerText.trim(),
                    likes: 0,
                    comments: 0,
                    vouched: false,
                    avatar: CURRENT_USER.avatar,
                };

            setFeedPosts((prev) => [createdPost, ...prev]);
            setLikeCountMap((prev) => ({ ...prev, [createdPost._id]: 0 }));
            setComposerText('');
            setComposerOpen(false);
            setComposerMediaType(null);
        } catch (error) {
            Alert.alert('Post Failed', 'Could not publish your post right now.');
        }
    }, [composerMediaType, composerText, mapApiPost, userInfo?.name]);

    const handleToggleLike = useCallback(async (postId) => {
        try {
            const { data } = await client.post(`/api/feed/posts/${postId}/like`);
            const isLiked = Boolean(data?.liked);
            setLikedPostIds((prev) => {
                const next = new Set(prev);
                if (isLiked) {
                    next.add(postId);
                } else {
                    next.delete(postId);
                }
                return next;
            });
            setLikeCountMap((prev) => ({ ...prev, [postId]: Number(data?.likesCount || 0) }));
        } catch (error) {
            setLikedPostIds((prev) => {
                const next = new Set(prev);
                if (next.has(postId)) {
                    next.delete(postId);
                    setLikeCountMap((map) => ({ ...map, [postId]: (map[postId] || 1) - 1 }));
                } else {
                    next.add(postId);
                    setLikeCountMap((map) => ({ ...map, [postId]: (map[postId] || 0) + 1 }));
                }
                return next;
            });
        }
    }, []);

    const handleSubmitComment = useCallback(async (postId) => {
        const text = (commentInputMap[postId] || '').trim();
        if (!text) return;

        try {
            await client.post(`/api/feed/posts/${postId}/comments`, { text });
            setCommentsByPostId((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), text] }));
            setCommentInputMap((prev) => ({ ...prev, [postId]: '' }));
        } catch (error) {
            Alert.alert('Comment Failed', 'Could not add comment right now.');
        }
    }, [commentInputMap]);

    const handleToggleComment = useCallback((postId) => {
        setActiveCommentPostId((prev) => (prev === postId ? null : postId));
    }, []);

    const handleCommentInputChange = useCallback((postId, text) => {
        setCommentInputMap((prev) => ({ ...prev, [postId]: text }));
    }, []);

    const handleLoadMoreFeed = useCallback(() => {
        if (hasMoreFeed && !loadingMoreFeed) {
            fetchFeedPosts(feedPage + 1, false);
        }
    }, [hasMoreFeed, loadingMoreFeed, fetchFeedPosts, feedPage]);

    const handleRefreshFeed = useCallback(() => {
        fetchFeedPosts(1, true);
    }, [fetchFeedPosts]);

    const handleVouch = useCallback(async (postId) => {
        const currentPost = feedPosts.find((post) => post._id === postId);
        if (!currentPost) return;

        const prevVouched = Boolean(currentPost.vouched);
        const prevCount = Number(currentPost.vouchCount || 0);
        const nextCount = Math.max(0, prevCount + (prevVouched ? -1 : 1));

        setFeedPosts((prev) => prev.map((post) => (
            post._id === postId
                ? { ...post, vouched: !prevVouched, vouchCount: nextCount }
                : post
        )));

        try {
            const { data } = await client.post(`/api/feed/posts/${postId}/vouch`);
            setFeedPosts((prev) => prev.map((post) => (
                post._id === postId
                    ? {
                        ...post,
                        vouched: Boolean(data?.vouched),
                        vouchCount: Number(data?.vouchCount || 0),
                    }
                    : post
            )));
        } catch (error) {
            setFeedPosts((prev) => prev.map((post) => (
                post._id === postId
                    ? {
                        ...post,
                        vouched: prevVouched,
                        vouchCount: prevCount,
                    }
                    : post
            )));
            Alert.alert('Vouch Failed', 'Could not update vouch right now.');
        }
    }, [feedPosts]);

    const handleReportPost = useCallback((post) => {
        const postId = post?._id;
        if (!postId) return;

        Alert.alert('Report post', 'Help us keep the community safe.', [
            {
                text: 'Spam',
                onPress: async () => {
                    try {
                        await client.post('/api/reports', { targetId: postId, targetType: 'post', reason: 'spam' });
                        Alert.alert('Thanks', 'Report received.');
                    } catch (error) {
                        Alert.alert('Report Failed', 'Could not submit report right now.');
                    }
                },
            },
            {
                text: 'Harassment',
                onPress: async () => {
                    try {
                        await client.post('/api/reports', { targetId: postId, targetType: 'post', reason: 'harassment' });
                        Alert.alert('Thanks', 'Report received.');
                    } catch (error) {
                        Alert.alert('Report Failed', 'Could not submit report right now.');
                    }
                },
            },
            {
                text: 'Misleading',
                onPress: async () => {
                    try {
                        await client.post('/api/reports', { targetId: postId, targetType: 'post', reason: 'misleading' });
                        Alert.alert('Thanks', 'Report received.');
                    } catch (error) {
                        Alert.alert('Report Failed', 'Could not submit report right now.');
                    }
                },
            },
            { text: 'Cancel', style: 'cancel' },
        ]);
    }, []);

    const showPulseToast = useCallback((message) => {
        setPulseToast(message);
        if (pulseToastTimeoutRef.current) {
            clearTimeout(pulseToastTimeoutRef.current);
        }
        pulseToastTimeoutRef.current = setTimeout(() => setPulseToast(null), 2500);
    }, []);

    const fetchPulseItems = useCallback(async () => {
        const requestId = pulseFetchRequestIdRef.current + 1;
        pulseFetchRequestIdRef.current = requestId;
        try {
            const { data } = await client.get('/api/pulse');
            if (requestId !== pulseFetchRequestIdRef.current) {
                return;
            }
            const items = Array.isArray(data?.items) ? data.items : [];
            const seen = new Set();
            const mapped = items
                .map((item) => ({
                    id: item.id || item._id,
                    createdAt: item.createdAt || item.timePosted || null,
                    interactionCount: Number(item.interactionCount || 0),
                    engagementScore: Number(item.engagementScore || 0),
                    rawTimePosted: item.timePosted,
                    rawCategory: item.category,
                    rawEmployer: item.employer,
                    rawCompanyName: item.companyName,
                    rawTitle: item.title,
                    rawContent: item.content,
                    rawDistance: item.distance,
                    rawLocation: item.location,
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
                    title: item.rawTitle || item.rawContent || 'Urgent Requirement',
                    employer: item.rawEmployer || item.rawCompanyName || 'Employer',
                    distance: item.rawDistance || item.rawLocation || 'Nearby',
                    pay: item.rawPay || item.rawSalaryRange || 'Negotiable',
                    urgent: Boolean(item.rawUrgent || item.rawIsPulse),
                    timePosted: timeAgo(item.createdAt || item.rawTimePosted),
                    category: item.rawCategory || item.rawRequirements?.[0] || 'Pulse',
                    categoryBg: '#fef3c7',
                    categoryColor: '#b45309',
                }));
            setPulseItems(mapped);
        } catch (error) {
            if (requestId !== pulseFetchRequestIdRef.current) {
                return;
            }
            setPulseItems([]);
        }
    }, []);

    const handleRefreshRadar = useCallback(async () => {
        setRadarRefreshing(true);
        await fetchPulseItems();
        setRadarRefreshing(false);
    }, [fetchPulseItems]);

    const handleApplyGig = useCallback(async (gig) => {
        try {
            if (!gig?.id) return;
            await client.post('/api/applications', {
                jobId: gig.id,
                workerId: userInfo?._id,
                initiatedBy: 'worker',
            });
            setAppliedGigIds((prev) => new Set(prev).add(gig.id));
            showPulseToast(`Request sent to ${gig.employer}!`);
        } catch (error) {
            showPulseToast('Could not apply right now. Please retry.');
        }
    }, [showPulseToast, userInfo?._id]);

    const handleHirePro = useCallback((pro) => {
        setHiredProIds((prev) => new Set(prev).add(pro.id));
        showPulseToast(`Hire request sent to ${pro.name}!`);
    }, [showPulseToast]);

    const fetchAcademyData = useCallback(async () => {
        try {
            const [coursesRes, enrolledRes] = await Promise.all([
                client.get('/api/academy/courses'),
                client.get('/api/academy/enrolled'),
            ]);
            const courses = Array.isArray(coursesRes?.data?.courses) ? coursesRes.data.courses : [];
            const enrolled = Array.isArray(enrolledRes?.data?.enrolled) ? enrolledRes.data.enrolled : [];
            setAcademyCourses(courses);
            setEnrolledCourses(enrolled);
            setEnrolledCourseIds(new Set(enrolled.map((item) => item.courseId)));
        } catch (error) {
            setAcademyCourses([]);
            setEnrolledCourses([]);
            setEnrolledCourseIds(new Set());
        }
    }, []);

    const handleEnrollCourse = useCallback(async (id) => {
        try {
            await client.post(`/api/academy/courses/${id}/enroll`);
            setEnrolledCourseIds((prev) => new Set(prev).add(id));
        } catch (error) {
            Alert.alert('Enrollment Failed', 'Could not enroll right now.');
        }
    }, []);

    const handleConnectMentor = useCallback((id) => {
        setConnectedMentorIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const showBountyToast = useCallback((message) => {
        setBountyToast(message);
        if (bountyToastTimeoutRef.current) {
            clearTimeout(bountyToastTimeoutRef.current);
        }
        bountyToastTimeoutRef.current = setTimeout(() => setBountyToast(null), 3000);
    }, []);

    const fetchBounties = useCallback(async () => {
        try {
            const [bountyRes, mineRes] = await Promise.all([
                client.get('/api/bounties'),
                client.get('/api/bounties/mine'),
            ]);
            const rows = Array.isArray(bountyRes?.data?.bounties) ? bountyRes.data.bounties : [];
            const mine = Array.isArray(mineRes?.data?.bounties) ? mineRes.data.bounties : [];
            const mineWinnerIds = new Set(
                mine
                    .filter((row) => row?.winnerId && String(row.winnerId) === String(userInfo?._id || ''))
                    .map((row) => String(row._id))
            );

            const mapped = rows.map((bounty, index) => {
                const reward = Number(bounty.reward || 0);
                const deadlineMs = new Date(bounty.deadline || Date.now()).getTime();
                const expiresInDays = Math.max(0, Math.ceil((deadlineMs - Date.now()) / (24 * 60 * 60 * 1000)));
                const submissionCount = Array.isArray(bounty.submissions) ? bounty.submissions.length : 0;
                const company = bounty.creatorName || `Creator ${index + 1}`;
                return {
                    id: String(bounty._id),
                    company,
                    logoLetter: String(company || 'H')[0].toUpperCase(),
                    logoBg: '#7c3aed',
                    role: bounty.title || 'Open Bounty',
                    bonus: `₹${Math.max(0, reward).toLocaleString()}`,
                    bonusValue: Math.max(0, reward),
                    expiresInDays,
                    totalPot: `₹${(Math.max(0, reward) * Math.max(1, submissionCount || 1)).toLocaleString()}`,
                    referrals: submissionCount,
                    category: String(bounty.status || 'open').toUpperCase(),
                };
            });

            setBountyItems(mapped);
            setReferralStats({
                totalEarnings: Array.from(mineWinnerIds).reduce((sum, bountyId) => {
                    const found = rows.find((row) => String(row._id) === String(bountyId));
                    return sum + Number(found?.reward || 0);
                }, 0),
            });
        } catch (error) {
            setBountyItems([]);
            setReferralStats({ totalEarnings: 0 });
        }
    }, [userInfo?._id]);

    const handleOpenReferModal = useCallback((bounty) => {
        setReferringBounty(bounty);
        setReferPhoneInput('');
        setReferPhoneError('');
    }, []);

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
        if (!referPhoneInput.trim() || referPhoneInput.replace(/\D/g, '').length < 10) {
            setReferPhoneError('Please enter a valid 10-digit phone number');
            return;
        }
        if (!referringBounty) return;

        try {
            await client.post('/api/growth/referrals', {
                bountyId: referringBounty.id,
                candidateContact: referPhoneInput,
            });

            const linkRes = await client.get(`/api/growth/share-link/bounty/${referringBounty.id}`);
            const shareLink = linkRes?.data?.shareLink;
            if (shareLink) {
                await Share.share({
                    message: `Check this opportunity on HireCircle: ${shareLink}`,
                });
            }

            setReferredBountyIds((prev) => new Set(prev).add(referringBounty.id));
            const earned = referringBounty.bonus;
            handleCloseReferModal();
            showBountyToast(`Referral sent! You'll earn ${earned} when they join.`);
        } catch (error) {
            setReferPhoneError('Could not send referral. Please try again.');
        }
    }, [referPhoneInput, referringBounty, handleCloseReferModal, showBountyToast]);

    const fetchCircles = useCallback(async () => {
        try {
            const [allRes, myRes] = await Promise.all([
                client.get('/api/circles'),
                client.get('/api/circles/my'),
            ]);
            const allCircles = Array.isArray(allRes?.data?.circles) ? allRes.data.circles : [];
            const myCircles = Array.isArray(myRes?.data?.circles) ? myRes.data.circles : [];
            setCirclesData(allCircles);
            setJoinedCircles(new Set(myCircles.map((circle) => String(circle._id))));
        } catch (error) {
            setCirclesData([]);
            setJoinedCircles(new Set());
        }
    }, []);

    const toggleJoinCircle = useCallback(async (id) => {
        const alreadyJoined = joinedCircles.has(id);
        if (alreadyJoined) return;

        try {
            const { data } = await client.post(`/api/circles/${id}/join`);
            if (data?.joined) {
                setJoinedCircles((prev) => new Set(prev).add(id));
                return;
            }
            if (data?.pendingApproval) {
                Alert.alert('Request sent', 'Your join request is pending admin approval.');
                return;
            }
        } catch (error) {
            Alert.alert('Join Failed', 'Could not join this circle right now.');
        }
    }, [joinedCircles]);

    const circlesList = useMemo(() => (
        circlesData.length > 0
            ? circlesData.map((circle) => ({
                _id: String(circle._id),
                name: circle.name,
                category: circle.category || circle.skill || 'Community',
                members: `${Array.isArray(circle.memberIds) ? circle.memberIds.length : (Array.isArray(circle.members) ? circle.members.length : 0)}`,
                online: 0,
                desc: circle.description || 'Join this circle to connect with professionals nearby.',
                topics: [circle.category || circle.skill || 'Updates'],
                rates: [],
            }))
            : []
    ), [circlesData]);

    const handleOpenCircle = useCallback(async (circle) => {
        setSelectedCircle(circle);
        setCircleDetailTab('DISCUSSION');
        setCircleMessages([]);
        setCircleMembers([]);
        const circleId = String(circle?._id || '').trim();
        if (!circleId) {
            return;
        }

        try {
            const [postsRes, membersRes] = await Promise.all([
                client.get(`/api/circles/${circleId}/posts`),
                client.get(`/api/circles/${circleId}/members`),
            ]);
            const posts = Array.isArray(postsRes?.data?.posts) ? postsRes.data.posts : [];
            const members = Array.isArray(membersRes?.data?.members) ? membersRes.data.members : [];
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
        }
    }, [mapCirclePostToMessage]);

    const handleCloseCircleDetail = useCallback(() => {
        setSelectedCircle(null);
    }, []);

    const handleCircleDetailTabChange = useCallback((nextTab) => {
        setCircleDetailTab(nextTab);
    }, []);

    const handleCircleSendMessage = useCallback(async () => {
        const text = String(chatText || '').trim();
        const circleId = String(selectedCircle?._id || '').trim();
        if (!text || !circleId) return;

        try {
            const { data } = await client.post(`/api/circles/${circleId}/posts`, { text });
            const message = mapCirclePostToMessage(data?.post || {
                _id: Date.now(),
                text,
                createdAt: new Date().toISOString(),
                user: {
                    name: userInfo?.name || 'You',
                    activeRole: userInfo?.activeRole || userInfo?.primaryRole || 'member',
                },
            });
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
    }, [chatText, mapCirclePostToMessage, selectedCircle?._id, userInfo?.activeRole, userInfo?.name, userInfo?.primaryRole]);

    const handleCircleToggleVoice = useCallback(() => {
        if (isCircleRecording) {
            setIsCircleRecording(false);
            const nextMessages = [...circleMessages, {
                id: Date.now(),
                user: 'You',
                role: 'Member',
                text: '🎤 Voice message (0:08)',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                type: 'text',
            }];
            setCircleMessages(nextMessages);
            if (circleScrollTimeoutRef.current) {
                clearTimeout(circleScrollTimeoutRef.current);
            }
            circleScrollTimeoutRef.current = setTimeout(() => {
                circleChatRef.current?.scrollToEnd({ animated: true });
            }, 50);
            return;
        }
        setIsCircleRecording(true);
    }, [circleMessages, isCircleRecording]);

    const handleShowCircleRateForm = useCallback(() => {
        setShowCircleRateForm(true);
    }, []);

    const handleCancelCircleRateForm = useCallback(() => {
        setShowCircleRateForm(false);
        setCircleRateService('');
        setCircleRatePrice('');
    }, []);

    const handleSubmitCircleRate = useCallback(() => {
        if (!circleRateService.trim() || !circleRatePrice.trim()) return;

        setCircleCustomRates((prev) => [
            ...prev,
            { service: circleRateService.trim(), price: circleRatePrice.trim() },
        ]);
        setCircleRateService('');
        setCircleRatePrice('');
        setShowCircleRateForm(false);
    }, [circleRateService, circleRatePrice]);

    useEffect(() => {
        fetchFeedPosts(1, true);
        fetchPulseItems();
        fetchAcademyData();
        fetchCircles();
        fetchBounties();
    }, [fetchFeedPosts, fetchPulseItems, fetchAcademyData, fetchCircles, fetchBounties]);

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
        };
    }, [pulseAnim]);

    const bountiesList = useMemo(() => bountyItems, [bountyItems]);

    const bountyEarningsTotal = useMemo(() => {
        const localEarnings = [...referredBountyIds].reduce((sum, id) => {
            const matched = bountiesList.find((bounty) => bounty.id === id);
            return sum + (matched ? matched.bonusValue : 0);
        }, 0);

        return Number(referralStats?.totalEarnings || 0) || localEarnings;
    }, [referredBountyIds, bountiesList, referralStats?.totalEarnings]);

    const currentUserAvatar = useMemo(() => {
        const displayName = String(userInfo?.name || CURRENT_USER.name || 'You').trim() || 'You';
        return `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=8b3dff&color=fff&rounded=true`;
    }, [userInfo?.name]);

    const feedTabProps = useMemo(() => ({
        feedPosts,
        loadingFeed,
        loadingMoreFeed,
        composerOpen,
        composerMediaType,
        composerText,
        likedPostIds,
        likeCountMap,
        commentsByPostId,
        activeCommentPostId,
        commentInputMap,
        currentUserAvatar,
        onRefreshFeed: handleRefreshFeed,
        onLoadMoreFeed: handleLoadMoreFeed,
        onMediaButtonClick: handleMediaButtonClick,
        onInputAreaClick: handleInputAreaClick,
        onCancelComposer: handleCancelComposer,
        onPost: handlePost,
        onComposerTextChange: setComposerText,
        onToggleLike: handleToggleLike,
        onToggleComment: handleToggleComment,
        onToggleVouch: handleVouch,
        onCommentInputChange: handleCommentInputChange,
        onSubmitComment: handleSubmitComment,
        onReportPost: handleReportPost,
    }), [
        feedPosts,
        loadingFeed,
        loadingMoreFeed,
        composerOpen,
        composerMediaType,
        composerText,
        likedPostIds,
        likeCountMap,
        commentsByPostId,
        activeCommentPostId,
        commentInputMap,
        handleRefreshFeed,
        handleLoadMoreFeed,
        handleMediaButtonClick,
        handleInputAreaClick,
        handleCancelComposer,
        handlePost,
        handleToggleLike,
        handleToggleComment,
        handleVouch,
        handleCommentInputChange,
        handleSubmitComment,
        handleReportPost,
        currentUserAvatar,
    ]);

    const pulseTabProps = useMemo(() => ({
        pulseItems,
        appliedGigIds,
        hiredProIds,
        radarRefreshing,
        pulseAnim,
        onRefreshRadar: handleRefreshRadar,
        onApplyGig: handleApplyGig,
        onHirePro: handleHirePro,
    }), [pulseItems, appliedGigIds, hiredProIds, radarRefreshing, pulseAnim, handleRefreshRadar, handleApplyGig, handleHirePro]);

    const circlesTabProps = useMemo(() => ({
        circles: circlesList,
        joinedCircles,
        onOpenCircle: handleOpenCircle,
        onJoinCircle: toggleJoinCircle,
    }), [circlesList, joinedCircles, handleOpenCircle, toggleJoinCircle]);

    const academyTabProps = useMemo(() => ({
        academyCourses,
        enrolledCourses,
        enrolledCourseIds,
        mentors: ACADEMY_MENTORS,
        connectedMentorIds,
        onEnrollCourse: handleEnrollCourse,
        onConnectMentor: handleConnectMentor,
    }), [academyCourses, enrolledCourses, enrolledCourseIds, connectedMentorIds, handleEnrollCourse, handleConnectMentor]);

    const bountiesTabProps = useMemo(() => ({
        bounties: bountiesList,
        referredBountyIds,
        totalEarned: bountyEarningsTotal,
        onOpenReferModal: handleOpenReferModal,
    }), [bountiesList, referredBountyIds, bountyEarningsTotal, handleOpenReferModal]);

    const circleDetailProps = useMemo(() => ({
        visible: !!selectedCircle,
        selectedCircle,
        onClose: handleCloseCircleDetail,
        circleDetailTab,
        onTabChange: handleCircleDetailTabChange,
        circleChatRef,
        chatText,
        onChatTextChange: setChatText,
        isCircleRecording,
        onSendTextMessage: handleCircleSendMessage,
        onToggleVoiceRecording: handleCircleToggleVoice,
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
        handleCloseCircleDetail,
        circleDetailTab,
        handleCircleDetailTabChange,
        chatText,
        isCircleRecording,
        handleCircleSendMessage,
        handleCircleToggleVoice,
        circleMembers,
        circleCustomRates,
        showCircleRateForm,
        circleRateService,
        circleRatePrice,
        handleSubmitCircleRate,
        handleShowCircleRateForm,
        handleCancelCircleRateForm,
    ]);

    const referralModalProps = useMemo(() => ({
        visible: !!referringBounty,
        referringBounty,
        referPhoneInput,
        referPhoneError,
        onClose: handleCloseReferModal,
        onPhoneChange: handleReferPhoneChange,
        onSendReferral: handleSendReferral,
    }), [
        referringBounty,
        referPhoneInput,
        referPhoneError,
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
