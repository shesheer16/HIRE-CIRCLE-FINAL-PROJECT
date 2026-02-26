import React, { useState, useRef, useEffect } from 'react';
import {
    View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, Image, ActivityIndicator, FlatList
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    IconUsers, IconMessageSquare, IconPlus, IconCheck,
    IconSparkles, IconSearch, IconBell, IconAward, IconVideo,
    IconX, IconMic, IconImage, IconSend, IconSettings, IconMapPin, IconBookOpen
} from '../components/Icons';

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const MOCK_POSTS = [
    {
        _id: 'p1', type: 'text',
        author: 'Amir Khan', role: 'Construction Lead', time: 'Just now',
        karma: 450, initial: 'A',
        text: 'Any electricians available for a quick site inspection in Banjara Hills? Emergency fix needed.',
        likes: 12, comments: 3, vouched: false, avatar: 'https://i.pravatar.cc/150?u=amir'
    },
    {
        _id: 'p2', type: 'voice',
        author: 'Sunil Driver', role: 'Heavy Vehicle Expert', time: '3h ago',
        karma: 1200, initial: 'S',
        text: 'Completed the 800km run. Truck maintained perfectly. Maintenance is key!',
        likes: 156, comments: 24, vouched: true, duration: '0:15', avatar: 'https://i.pravatar.cc/150?u=sunil'
    },
    {
        _id: 'p3', type: 'bounty',
        author: 'LogiTech Corp', role: 'Verified Employer', time: '5h ago',
        karma: 0, initial: 'L',
        text: 'Refer a Senior Warehouse Manager. Bonus paid upon successful 30-day onboarding.',
        likes: 89, comments: 45, vouched: false, reward: '₹2,000', avatar: 'https://ui-avatars.com/api/?name=LogiTech&background=7c3aed&color=fff'
    }
];

const MOCK_CIRCLES = [
    {
        _id: 'c1', name: 'Heavy Haulers India', category: 'Logistics', members: '12.5k', online: 142, joined: true, initial: 'H',
        desc: 'Discuss routes, tolls, and vehicle maintenance tips for long-haul drivers.', topics: ['Route Advice', 'Toll Updates', 'Mechanic Referrals'],
        rates: [{ service: '10-Ton Truck (Per KM)', price: '₹35 - ₹40' }, { service: 'Waiting Charge (Per Hour)', price: '₹200' }, { service: 'Helper Daily Wage', price: '₹800' }]
    },
    {
        _id: 'c2', name: 'Hyderabad Electricians', category: 'Trades', members: '3.2k', online: 45, joined: false, initial: 'H',
        desc: 'Union news, rate cards, and helper availability for local electricians.', topics: ['Daily Rates', 'Helper Needed', 'License Renewals'],
        rates: [{ service: 'Fan Installation', price: '₹250' }, { service: 'Full House Wiring (2BHK)', price: '₹15,000' }, { service: 'Site Visit / Inspection', price: '₹300' }]
    },
    {
        _id: 'c3', name: 'Last-Mile Delivery', category: 'Logistics', members: '45k', online: 1200, joined: false, initial: 'L',
        desc: 'Community for Swiggy, Zomato, and Amazon delivery partners.', topics: ['Incentive Hacks', 'Bike Repair', 'Traffic Alerts'], rates: []
    }
];

const SUB_TABS = ['Feed', 'Pulse', 'Academy', 'Circles', 'Bounties'];
const CURRENT_USER = { avatar: 'https://i.pravatar.cc/150?img=11', name: 'Lokesh' };

// ─── POST COMPONENTS ──────────────────────────────────────────────────────────
function PostHeader({ post, isBounty = false }) {
    const textColor = isBounty ? '#ffffff' : '#0f172a';
    const subtextColor = isBounty ? 'rgba(255,255,255,0.7)' : '#94a3b8';

    return (
        <View style={styles.postHeader}>
            <Image source={{ uri: post.avatar }} style={styles.postAvatarImg} />
            <View style={{ flex: 1 }}>
                <View style={styles.postNameRow}>
                    <Text style={[styles.postAuthor, { color: textColor }]}>{post.author}</Text>
                    {(post.karma > 1000 || isBounty) && <IconCheck size={14} color={isBounty ? "#fff" : "#6366f1"} />}
                </View>
                <Text style={[styles.postRoleTime, { color: subtextColor }]}>{post.role.toUpperCase()} • {post.time.toUpperCase()}</Text>
            </View>
            <View style={styles.karmaBadgeRight}>
                <Text style={styles.karmaBadgeTextRight}>+{post.karma} KARMA</Text>
            </View>
        </View>
    );
}

function PostActions({ post, onVouch, isBounty = false }) {
    const textColor = isBounty ? 'rgba(255,255,255,0.8)' : '#64748b';
    return (
        <View style={[styles.postActions, { borderTopColor: isBounty ? 'rgba(255,255,255,0.1)' : '#f8fafc' }]}>
            <TouchableOpacity style={styles.actionBtn}>
                <Text style={[styles.actionBtnText, { color: textColor }]}>👍 {post.likes}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn}>
                <Text style={[styles.actionBtnText, { color: textColor }]}>💬 {post.comments}</Text>
            </TouchableOpacity>
            <TouchableOpacity
                style={[
                    styles.vouchBtn,
                    post.vouched && styles.vouchBtnActive,
                    isBounty && !post.vouched && { borderColor: '#fbbf24', backgroundColor: 'transparent' }
                ]}
                onPress={() => onVouch(post._id)}
                activeOpacity={0.8}
            >
                {post.vouched && <IconCheck size={14} color="#fff" />}
                <Text style={[
                    styles.vouchBtnText,
                    post.vouched && styles.vouchBtnTextActive,
                    isBounty && !post.vouched && { color: '#fbbf24' }
                ]}>
                    {isBounty ? 'REFER & EARN' : (post.vouched ? 'VOUCHED' : 'VOUCH')}
                </Text>
            </TouchableOpacity>
        </View>
    );
}

function FeedPost({ post, onVouch }) {
    const isBounty = post.type === 'bounty';
    const postContainerStyle = isBounty ? [styles.postCard, styles.bountyCardGradient] : styles.postCard;
    const textColor = isBounty ? 'rgba(255,255,255,0.9)' : '#334155';

    return (
        <View style={postContainerStyle}>
            {isBounty && (
                <View style={styles.bountyAwardBg}><IconAward size={64} color="rgba(255,255,255,0.1)" /></View>
            )}

            <PostHeader post={post} isBounty={isBounty} />
            <Text style={[styles.postText, { color: textColor }]}>{post.text}</Text>

            {post.type === 'voice' && (
                <View style={styles.voicePlayer}>
                    <TouchableOpacity style={styles.playBtn} activeOpacity={0.8}>
                        <Text style={styles.playBtnText}>▶</Text>
                    </TouchableOpacity>
                    <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: '35%' }]} />
                    </View>
                    <Text style={styles.durationText}>{post.duration}</Text>
                </View>
            )}

            {isBounty && (
                <View style={styles.relativeZ10}>
                    <Text style={styles.bountyLabelText}>REFERRAL BOUNTY</Text>
                    <Text style={styles.bountyRewardText}>{post.reward}</Text>
                    <TouchableOpacity style={styles.bountyReferBtn}>
                        <Text style={styles.bountyReferBtnText}>REFER A PEER</Text>
                    </TouchableOpacity>
                </View>
            )}

            <PostActions post={post} onVouch={onVouch} isBounty={isBounty} />
        </View>
    );
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────
export default function ConnectScreen() {
    const insets = useSafeAreaInsets();
    const [activeTab, setActiveTab] = useState('Feed');
    const [joinedCircles, setJoinedCircles] = useState(new Set(['c1']));
    const [selectedCircle, setSelectedCircle] = useState(null);
    const [circleDetailTab, setCircleDetailTab] = useState('DISCUSSION');
    const [chatText, setChatText] = useState('');

    // ── Agent 4: Circles State ──
    const [isCircleRecording, setIsCircleRecording] = useState(false);
    const [circleMessages, setCircleMessages] = useState([]);
    const [circleCustomRates, setCircleCustomRates] = useState([]);
    const [showCircleRateForm, setShowCircleRateForm] = useState(false);
    const [circleRateService, setCircleRateService] = useState('');
    const [circleRatePrice, setCircleRatePrice] = useState('');
    const circleChatRef = useRef(null);
    useEffect(() => {
        if (circleChatRef.current) {
            setTimeout(() => circleChatRef.current?.scrollToEnd({ animated: true }), 80);
        }
    }, [circleMessages.length]);

    // ── Agent 1: Feed State ──
    const [composerOpen, setComposerOpen] = useState(false);
    const [composerMediaType, setComposerMediaType] = useState(null); // 'VOICE'|'PHOTOS'|'VIDEO'|'TEXT'
    const [composerText, setComposerText] = useState('');
    const [feedPosts, setFeedPosts] = useState(MOCK_POSTS);
    const [likedPostIds, setLikedPostIds] = useState(new Set());
    const [likeCountMap, setLikeCountMap] = useState(
        Object.fromEntries(MOCK_POSTS.map(p => [p._id, p.likes]))
    );
    const [commentsByPostId, setCommentsByPostId] = useState({});
    const [activeCommentPostId, setActiveCommentPostId] = useState(null);
    const [commentInputMap, setCommentInputMap] = useState({});

    const handleMediaButtonClick = (type) => { setComposerOpen(true); setComposerMediaType(type); };
    const handleInputAreaClick = () => { setComposerOpen(true); setComposerMediaType('TEXT'); };
    const handleCancelComposer = () => { setComposerOpen(false); setComposerMediaType(null); setComposerText(''); };
    const handlePost = () => {
        if (!composerText.trim()) return;
        const newPost = {
            _id: 'p' + Date.now(), type: composerMediaType === 'VOICE' ? 'voice' : composerMediaType === 'PHOTOS' ? 'gallery' : 'text',
            author: CURRENT_USER.name, role: 'Member', time: 'Just now', karma: 0,
            text: composerText, likes: 0, comments: 0, vouched: false, avatar: CURRENT_USER.avatar,
            duration: composerMediaType === 'VOICE' ? '0:10' : undefined,
        };
        setFeedPosts(prev => [newPost, ...prev]);
        setLikeCountMap(prev => ({ ...prev, [newPost._id]: 0 }));
        setComposerText(''); setComposerOpen(false); setComposerMediaType(null);
    };
    const handleToggleLike = (postId) => {
        setLikedPostIds(prev => {
            const next = new Set(prev);
            if (next.has(postId)) { next.delete(postId); setLikeCountMap(cm => ({ ...cm, [postId]: (cm[postId] || 1) - 1 })); }
            else { next.add(postId); setLikeCountMap(cm => ({ ...cm, [postId]: (cm[postId] || 0) + 1 })); }
            return next;
        });
    };
    const handleSubmitComment = (postId) => {
        const text = (commentInputMap[postId] || '').trim();
        if (!text) return;
        setCommentsByPostId(prev => ({ ...prev, [postId]: [...(prev[postId] || []), text] }));
        setCommentInputMap(prev => ({ ...prev, [postId]: '' }));
    };

    // ── Agent 2: Pulse State ──
    const [appliedGigIds, setAppliedGigIds] = useState(new Set());
    const [hiredProIds, setHiredProIds] = useState(new Set());
    const [radarRefreshing, setRadarRefreshing] = useState(false);
    const [pulseToast, setPulseToast] = useState(null);
    const showPulseToast = (msg) => { setPulseToast(msg); setTimeout(() => setPulseToast(null), 2500); };
    const handleRefreshRadar = () => { setRadarRefreshing(true); setTimeout(() => setRadarRefreshing(false), 1200); };
    const handleApplyGig = (gig) => { setAppliedGigIds(prev => new Set(prev).add(gig.id)); showPulseToast(`Request sent to ${gig.employer}!`); };
    const handleHirePro = (pro) => { setHiredProIds(prev => new Set(prev).add(pro.id)); showPulseToast(`Hire request sent to ${pro.name}!`); };

    // ── Agent 3: Academy State ──
    const [enrolledCourseIds, setEnrolledCourseIds] = useState(new Set());
    const [connectedMentorIds, setConnectedMentorIds] = useState(new Set());
    const handleEnrollCourse = (id) => setEnrolledCourseIds(prev => new Set(prev).add(id));
    const handleConnectMentor = (id) => setConnectedMentorIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

    // ── Agent 5: Bounties State ──
    const [referredBountyIds, setReferredBountyIds] = useState(new Set());
    const [referringBounty, setReferringBounty] = useState(null);
    const [referPhoneInput, setReferPhoneInput] = useState('');
    const [referPhoneError, setReferPhoneError] = useState('');
    const [bountyToast, setBountyToast] = useState(null);
    const showBountyToast = (msg) => { setBountyToast(msg); setTimeout(() => setBountyToast(null), 3000); };
    const handleOpenReferModal = (bounty) => { setReferringBounty(bounty); setReferPhoneInput(''); setReferPhoneError(''); };
    const handleCloseReferModal = () => { setReferringBounty(null); setReferPhoneInput(''); setReferPhoneError(''); };
    const handleSendReferral = () => {
        if (!referPhoneInput.trim() || referPhoneInput.replace(/\D/g, '').length < 10) {
            setReferPhoneError('Please enter a valid 10-digit phone number'); return;
        }
        if (!referringBounty) return;
        setReferredBountyIds(prev => new Set(prev).add(referringBounty.id));
        const earned = referringBounty.bonus;
        handleCloseReferModal();
        showBountyToast(`Referral sent! You'll earn ${earned} when they join.`);
    };

    const handleVouch = (postId) => {
        setFeedPosts(prev => prev.map(p => p._id === postId ? { ...p, vouched: !p.vouched } : p));
    };

    const toggleJoinCircle = (id) => {
        const next = new Set(joinedCircles);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setJoinedCircles(next);
    };

    const renderFeed = () => (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
            {/* Composer */}
            <View style={styles.createPostBox}>
                <View style={styles.createPostRow}>
                    <Image source={{ uri: CURRENT_USER.avatar }} style={styles.createAvatarImg} />
                    <TouchableOpacity style={styles.createInputBg} onPress={handleInputAreaClick}>
                        <Text style={styles.createInputText}>Share your work today...</Text>
                    </TouchableOpacity>
                </View>
                {composerOpen && (
                    <TextInput
                        style={styles.composerTextarea}
                        value={composerText}
                        onChangeText={setComposerText}
                        placeholder={composerMediaType === 'VOICE' ? 'Describe your voice note...' : composerMediaType === 'PHOTOS' ? 'Caption your photos...' : 'What do you want to share?'}
                        placeholderTextColor="#94a3b8"
                        multiline
                        numberOfLines={3}
                        autoFocus
                    />
                )}
                <View style={styles.createPostToolbar}>
                    <TouchableOpacity style={styles.toolbarBtn} onPress={() => handleMediaButtonClick('VOICE')}>
                        <IconMic size={14} color={composerMediaType === 'VOICE' ? '#9333ea' : '#64748b'} />
                        <Text style={[styles.toolbarBtnText, composerMediaType === 'VOICE' && { color: '#9333ea' }]}>VOICE</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toolbarBtn} onPress={() => handleMediaButtonClick('PHOTOS')}>
                        <IconImage size={14} color={composerMediaType === 'PHOTOS' ? '#2563eb' : '#64748b'} />
                        <Text style={[styles.toolbarBtnText, composerMediaType === 'PHOTOS' && { color: '#2563eb' }]}>PHOTOS</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.toolbarBtn} onPress={() => handleMediaButtonClick('VIDEO')}>
                        <IconVideo size={14} color={composerMediaType === 'VIDEO' ? '#d97706' : '#64748b'} />
                        <Text style={[styles.toolbarBtnText, composerMediaType === 'VIDEO' && { color: '#d97706' }]}>VIDEO</Text>
                    </TouchableOpacity>
                    <View style={styles.toolbarDivider} />
                    {composerOpen ? (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity style={styles.toolbarCancelBtn} onPress={handleCancelComposer}>
                                <Text style={styles.toolbarCancelBtnText}>CANCEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.toolbarPostBtn, !composerText.trim() && { opacity: 0.4 }]} onPress={handlePost} disabled={!composerText.trim()}>
                                <Text style={styles.toolbarPostBtnText}>POST</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <TouchableOpacity style={styles.toolbarPostBtn} onPress={handleInputAreaClick}>
                            <Text style={styles.toolbarPostBtnText}>POST</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {feedPosts.map(post => {
                const isLiked = likedPostIds.has(post._id);
                const isBounty = post.type === 'bounty';
                const postContainerStyle = isBounty ? [styles.postCard, styles.bountyCardGradient] : styles.postCard;
                const textColor = isBounty ? 'rgba(255,255,255,0.9)' : '#334155';
                const commentList = commentsByPostId[post._id] || [];
                return (
                    <View key={post._id} style={postContainerStyle}>
                        {isBounty && <View style={styles.bountyAwardBg}><IconAward size={64} color="rgba(255,255,255,0.1)" /></View>}
                        <PostHeader post={post} isBounty={isBounty} />
                        <Text style={[styles.postText, { color: textColor }]}>{post.text}</Text>
                        {post.type === 'voice' && (
                            <View style={styles.voicePlayer}>
                                <TouchableOpacity style={styles.playBtn}><Text style={styles.playBtnText}>▶</Text></TouchableOpacity>
                                <View style={styles.progressBarBg}><View style={[styles.progressBarFill, { width: '35%' }]} /></View>
                                <Text style={styles.durationText}>{post.duration}</Text>
                            </View>
                        )}
                        {post.type === 'gallery' && post.images && (
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                                {post.images.map((img, i) => (
                                    <Image key={i} source={{ uri: img }} style={styles.galleryImg} />
                                ))}
                            </ScrollView>
                        )}
                        {isBounty && (
                            <View style={styles.relativeZ10}>
                                <Text style={styles.bountyLabelText}>REFERRAL BOUNTY</Text>
                                <Text style={styles.bountyRewardText}>{post.reward}</Text>
                                <TouchableOpacity style={styles.bountyReferBtn}><Text style={styles.bountyReferBtnText}>REFER A PEER</Text></TouchableOpacity>
                            </View>
                        )}
                        <View style={[styles.postActions, { borderTopColor: isBounty ? 'rgba(255,255,255,0.1)' : '#f8fafc' }]}>
                            <TouchableOpacity style={styles.actionBtn} onPress={() => handleToggleLike(post._id)}>
                                <Text style={[styles.actionBtnText, isLiked && { color: '#9333ea' }]}>👍 {likeCountMap[post._id] ?? post.likes}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionBtn} onPress={() => setActiveCommentPostId(prev => prev === post._id ? null : post._id)}>
                                <Text style={[styles.actionBtnText, isBounty ? { color: 'rgba(255,255,255,0.8)' } : { color: '#64748b' }]}>
                                    💬 {(commentsByPostId[post._id]?.length ?? 0) + post.comments}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.vouchBtn, post.vouched && styles.vouchBtnActive, isBounty && !post.vouched && { borderColor: '#fbbf24', backgroundColor: 'transparent' }]} onPress={() => handleVouch(post._id)} activeOpacity={0.8}>
                                {post.vouched && <IconCheck size={14} color="#fff" />}
                                <Text style={[styles.vouchBtnText, post.vouched && styles.vouchBtnTextActive, isBounty && !post.vouched && { color: '#fbbf24' }]}>
                                    {isBounty ? 'REFER & EARN' : (post.vouched ? 'VOUCHED' : 'VOUCH')}
                                </Text>
                            </TouchableOpacity>
                        </View>
                        {activeCommentPostId === post._id && (
                            <View style={styles.commentSection}>
                                {commentList.map((c, i) => (
                                    <View key={i} style={styles.commentRow}>
                                        <Image source={{ uri: CURRENT_USER.avatar }} style={styles.commentAvatar} />
                                        <View style={styles.commentBubble}><Text style={styles.commentBubbleText}>{c}</Text></View>
                                    </View>
                                ))}
                                <View style={styles.commentInputRow}>
                                    <Image source={{ uri: CURRENT_USER.avatar }} style={styles.commentAvatar} />
                                    <TextInput
                                        style={styles.commentInput}
                                        value={commentInputMap[post._id] || ''}
                                        onChangeText={t => setCommentInputMap(prev => ({ ...prev, [post._id]: t }))}
                                        onSubmitEditing={() => handleSubmitComment(post._id)}
                                        placeholder="Add a comment..."
                                        placeholderTextColor="#94a3b8"
                                        returnKeyType="send"
                                    />
                                    <TouchableOpacity style={styles.commentSendBtn} onPress={() => handleSubmitComment(post._id)}>
                                        <IconSend size={14} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                );
            })}
            <View style={{ height: 80 }} />
        </ScrollView>
    );

    const renderCircles = () => (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
            <View style={styles.circlesHeroBg}>
                <View style={styles.circlesHeroBlurRing} />
                <Text style={styles.circlesHeroTitle}>Find Your Tribe</Text>
                <Text style={styles.circlesHeroSub}>Connect with professionals in your category. Share rates, routes, and advice with people who understand your work.</Text>
            </View>

            {joinedCircles.size > 0 && (
                <View style={styles.circlesSection}>
                    <View style={styles.sectionHeaderRow}>
                        <IconCheck size={16} color="#7c3aed" />
                        <Text style={styles.circlesSectionTitle}>MY COMMUNITIES</Text>
                    </View>
                    {MOCK_CIRCLES.filter(c => joinedCircles.has(c._id)).map(circle => (
                        <View key={circle._id} style={styles.joinedCircleCard}>
                            <View style={styles.joinedCircleLeft}>
                                <View style={styles.relativeAvatar}>
                                    <Image source={{ uri: `https://ui-avatars.com/api/?name=${circle.name}&background=7c3aed&color=fff&rounded=true` }} style={styles.joinedCircleImg} />
                                    <View style={styles.onlineDotBordered} />
                                </View>
                                <View>
                                    <Text style={styles.joinedCircleName}>{circle.name}</Text>
                                    <Text style={styles.joinedCircleMembers}>{circle.members} MEMBERS</Text>
                                </View>
                            </View>
                            <TouchableOpacity style={styles.openCircleBtn} onPress={() => { setSelectedCircle(circle); setCircleDetailTab('DISCUSSION'); }}>
                                <Text style={styles.openCircleBtnText}>OPEN</Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                </View>
            )}

            <View style={styles.circlesSection}>
                <View style={styles.sectionHeaderRow}>
                    <IconSearch size={16} color="#94a3b8" />
                    <Text style={styles.circlesSectionTitle}>EXPLORE CATEGORIES</Text>
                </View>
                {MOCK_CIRCLES.filter(c => !joinedCircles.has(c._id)).map(circle => (
                    <View key={circle._id} style={styles.exploreCircleCard}>
                        <IconUsers size={96} color="#0f172a" style={styles.exploreCircleBgIcon} />
                        <View style={styles.exploreCircleTop}>
                            <Image source={{ uri: `https://ui-avatars.com/api/?name=${circle.name}&background=random&rounded=true` }} style={styles.exploreCircleImg} />
                            <View style={{ flex: 1 }}>
                                <View style={styles.exploreCircleHeaderRow}>
                                    <View>
                                        <Text style={styles.exploreCircleName}>{circle.name}</Text>
                                        <Text style={styles.exploreCircleCat}>{circle.category}</Text>
                                    </View>
                                    <TouchableOpacity style={styles.joinCircleBtn} onPress={() => toggleJoinCircle(circle._id)}>
                                        <Text style={styles.joinCircleBtnText}>JOIN</Text>
                                    </TouchableOpacity>
                                </View>
                                <Text style={styles.exploreCircleDesc}>{circle.desc}</Text>
                            </View>
                        </View>
                        <View style={styles.exploreCircleBottom}>
                            <View style={styles.exploreCircleAvatars}>
                                <View style={styles.exploreMiniAvatar}><Text style={styles.exploreMiniAvatarText}>A</Text></View>
                                <View style={[styles.exploreMiniAvatar, { marginLeft: -8, zIndex: -1 }]}><Text style={styles.exploreMiniAvatarText}>B</Text></View>
                                <View style={[styles.exploreMiniAvatar, { marginLeft: -8, zIndex: -2 }]}><Text style={styles.exploreMiniAvatarText}>C</Text></View>
                            </View>
                            <Text style={styles.exploreCircleOnline}>+{circle.online} Online Now</Text>
                            <View style={{ flex: 1, alignItems: 'flex-end' }}>
                                <Text style={styles.exploreCircleTopic}>🔥 {circle.topics[0]}</Text>
                            </View>
                        </View>
                    </View>
                ))}
            </View>
            <View style={{ height: 32 }} />
        </ScrollView>
    );

    const renderPulse = () => {
        const nearbyGigs = [
            { id: 1, title: 'Electrician Needed — Emergency', employer: 'Amir Khan', distance: '0.4 km', pay: '₹800', urgent: true, timePosted: '8 min ago', category: 'Trades', categoryBg: '#fef3c7', categoryColor: '#b45309' },
            { id: 2, title: 'AC Repair Assistant', employer: 'Sharma Cooling Co.', distance: '1.2 km', pay: '₹600', urgent: false, timePosted: '1h ago', category: 'Trades', categoryBg: '#fef3c7', categoryColor: '#b45309' },
            { id: 3, title: 'Delivery Run — Gachibowli Loop', employer: 'QuickMove Logistics', distance: '1.8 km', pay: '₹350', urgent: false, timePosted: '2h ago', category: 'Delivery', categoryBg: '#eff6ff', categoryColor: '#1d4ed8' },
        ];
        const nearbyPros = [
            { id: 1, name: 'Siva Kumar', role: 'Electrician', distance: '0.6 km', karma: 890, available: true, avatar: 'https://i.pravatar.cc/150?u=siva' },
            { id: 2, name: 'Priya R.', role: 'Tailor', distance: '1.1 km', karma: 420, available: true, avatar: 'https://i.pravatar.cc/150?u=priya' },
            { id: 3, name: 'Raju D.', role: 'Auto Driver', distance: '2.0 km', karma: 650, available: false, avatar: 'https://i.pravatar.cc/150?u=raju' },
        ];
        return (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
                {/* Hero Radar */}
                <View style={styles.pulseCard}>
                    <View style={styles.pulseBgEffect} />
                    <View style={styles.pulseContent}>
                        <View style={styles.pulseRadarOuter}><View style={styles.pulseRadarInner} /></View>
                        <Text style={styles.pulseTitle}>Live Radar</Text>
                        <Text style={styles.pulseSub}>{nearbyGigs.length} urgent gigs · {nearbyPros.length} pros within 2km</Text>
                        <TouchableOpacity style={[styles.pulseBtn, radarRefreshing && { opacity: 0.7 }]} onPress={handleRefreshRadar} disabled={radarRefreshing} activeOpacity={0.85}>
                            {radarRefreshing ? <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} /> : null}
                            <Text style={styles.pulseBtnText}>{radarRefreshing ? 'SCANNING...' : 'REFRESH RADAR'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Nearby Gigs */}
                <View style={styles.sectionHeaderRow}>
                    <IconMapPin size={16} color="#7c3aed" />
                    <Text style={styles.circlesSectionTitle}>URGENT GIGS NEAR YOU</Text>
                </View>
                {nearbyGigs.map(gig => (
                    <View key={gig.id} style={styles.gigCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
                                    <Text style={styles.gigTitle}>{gig.title}</Text>
                                    {gig.urgent && <View style={styles.urgentBadge}><Text style={styles.urgentBadgeText}>URGENT</Text></View>}
                                </View>
                                <Text style={styles.gigEmployer}>{gig.employer}</Text>
                            </View>
                            <View style={[styles.categoryBadge, { backgroundColor: gig.categoryBg }]}>
                                <Text style={[styles.categoryBadgeText, { color: gig.categoryColor }]}>{gig.category}</Text>
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={styles.gigMeta}>📍 {gig.distance}  🕐 {gig.timePosted}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <Text style={styles.gigPay}>{gig.pay}</Text>
                                <TouchableOpacity
                                    style={[styles.applyBtn, appliedGigIds.has(gig.id) && styles.applyBtnDone]}
                                    onPress={() => !appliedGigIds.has(gig.id) && handleApplyGig(gig)}
                                    disabled={appliedGigIds.has(gig.id)}
                                >
                                    <Text style={[styles.applyBtnText, appliedGigIds.has(gig.id) && { color: '#9333ea' }]}>
                                        {appliedGigIds.has(gig.id) ? 'SENT ✓' : 'APPLY NOW'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ))}

                {/* Nearby Pros */}
                <View style={[styles.sectionHeaderRow, { marginTop: 8 }]}>
                    <IconUsers size={16} color="#7c3aed" />
                    <Text style={styles.circlesSectionTitle}>PROFESSIONALS ONLINE NEARBY</Text>
                </View>
                {nearbyPros.map(pro => (
                    <View key={pro.id} style={styles.proCard}>
                        <View style={{ position: 'relative', marginRight: 12 }}>
                            <Image source={{ uri: pro.avatar }} style={styles.proAvatar} />
                            <View style={[styles.availabilityDot, { backgroundColor: pro.available ? '#22c55e' : '#94a3b8' }]} />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.proName}>{pro.name}</Text>
                            <Text style={styles.proMeta}>{pro.role} · 📍 {pro.distance}</Text>
                        </View>
                        <View style={styles.karmaBadgeRight}><Text style={styles.karmaBadgeTextRight}>{pro.karma} KARMA</Text></View>
                        {pro.available ? (
                            <TouchableOpacity
                                style={[styles.hireBtn, hiredProIds.has(pro.id) && styles.hireBtnDone]}
                                onPress={() => !hiredProIds.has(pro.id) && handleHirePro(pro)}
                                disabled={hiredProIds.has(pro.id)}
                            >
                                <Text style={[styles.hireBtnText, hiredProIds.has(pro.id) && { color: '#9333ea' }]}>
                                    {hiredProIds.has(pro.id) ? 'SENT ✓' : 'HIRE'}
                                </Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={styles.busyTag}><Text style={styles.busyTagText}>BUSY</Text></View>
                        )}
                    </View>
                ))}
                <View style={{ height: 32 }} />
            </ScrollView>
        );
    };

    const renderAcademy = () => {
        const courses = [
            { id: 1, title: 'Safe Driving on Highways', instructor: 'Rajiv Menon', duration: '3h 20m', level: 'Beginner', enrolled: 1420, rating: 4.8, thumb: 'https://picsum.photos/id/1076/200/120' },
            { id: 2, title: 'Electrical Safety at Work Sites', instructor: 'Kavya Srinivas', duration: '2h 05m', level: 'Intermediate', enrolled: 890, rating: 4.6, thumb: 'https://picsum.photos/id/160/200/120' },
            { id: 3, title: 'Inventory Management Basics', instructor: 'Anand Rao', duration: '1h 45m', level: 'Beginner', enrolled: 2100, rating: 4.7, thumb: 'https://picsum.photos/id/180/200/120' },
        ];
        const mentors = [
            { id: 1, name: 'Suresh V.', exp: '20y', skill: 'Heavy Transport', rating: 4.9, sessions: 340, avatar: 'https://i.pravatar.cc/150?u=suresh' },
            { id: 2, name: 'Kavya S.', exp: '12y', skill: 'Electrical Work', rating: 4.8, sessions: 215, avatar: 'https://i.pravatar.cc/150?u=kavya' },
            { id: 3, name: 'Anand R.', exp: '8y', skill: 'Warehouse Ops', rating: 4.7, sessions: 180, avatar: 'https://i.pravatar.cc/150?u=anandrao' },
            { id: 4, name: 'Meena J.', exp: '15y', skill: 'HR & Placement', rating: 5.0, sessions: 95, avatar: 'https://i.pravatar.cc/150?u=meena' },
        ];
        const totalCourses = courses.length + 5;
        const doneCourses = enrolledCourseIds.size + 2;
        const progressPct = Math.round((doneCourses / totalCourses) * 100);
        const getLevelStyle = (lvl) => lvl === 'Beginner' ? { bg: '#dcfce7', color: '#15803d' } : lvl === 'Intermediate' ? { bg: '#fef3c7', color: '#b45309' } : { bg: '#fee2e2', color: '#b91c1c' };
        return (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
                {/* Progress Card */}
                <View style={styles.academyCard}>
                    <View style={styles.academyHeaderRow}>
                        <IconBookOpen size={16} color="#7c3aed" />
                        <Text style={styles.academyAiText}>MY LEARNING</Text>
                        <View style={[styles.karmaBadgeRight, { marginLeft: 'auto' }]}>
                            <Text style={styles.karmaBadgeTextRight}>+{enrolledCourseIds.size * 120 + 240} KARMA</Text>
                        </View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>{doneCourses} / {totalCourses} Courses</Text>
                        <Text style={{ fontSize: 12, fontWeight: '900', color: '#0f172a' }}>{progressPct}%</Text>
                    </View>
                    <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
                    </View>
                    <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>2 courses in progress · Next: Forklift Certification</Text>
                </View>

                {/* Courses */}
                <View style={styles.sectionHeaderRow}>
                    <IconAward size={16} color="#7c3aed" />
                    <Text style={styles.circlesSectionTitle}>TOP COURSES FOR YOU</Text>
                </View>
                {courses.map(course => {
                    const lvlStyle = getLevelStyle(course.level);
                    return (
                        <View key={course.id} style={styles.courseCard}>
                            <Image source={{ uri: course.thumb }} style={styles.courseThumb} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                                    <Text style={[styles.gigTitle, { flex: 1, marginRight: 4 }]}>{course.title}</Text>
                                    <View style={[styles.categoryBadge, { backgroundColor: lvlStyle.bg }]}>
                                        <Text style={[styles.categoryBadgeText, { color: lvlStyle.color }]}>{course.level.toUpperCase()}</Text>
                                    </View>
                                </View>
                                <Text style={styles.gigEmployer}>{course.instructor} · {course.duration}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                                    <Text style={styles.gigMeta}>⭐ {course.rating} · {course.enrolled.toLocaleString()} enrolled</Text>
                                    <TouchableOpacity
                                        style={[styles.applyBtn, enrolledCourseIds.has(course.id) && styles.applyBtnDone]}
                                        onPress={() => !enrolledCourseIds.has(course.id) && handleEnrollCourse(course.id)}
                                        disabled={enrolledCourseIds.has(course.id)}
                                    >
                                        <Text style={[styles.applyBtnText, enrolledCourseIds.has(course.id) && { color: '#9333ea' }]}>
                                            {enrolledCourseIds.has(course.id) ? 'ENROLLED ✓' : 'START'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    );
                })}

                {/* Mentors */}
                <View style={styles.academyCard}>
                    <View style={styles.academyHeaderRow}>
                        <IconSparkles size={16} color="#7c3aed" />
                        <Text style={styles.academyAiText}>AI MENTOR MATCH</Text>
                    </View>
                    {mentors.map(mentor => (
                        <View key={mentor.id} style={styles.academyMatchBox}>
                            <Image source={{ uri: mentor.avatar }} style={styles.academyAvatar} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.academyMatchLabel}>{mentor.skill.toUpperCase()}</Text>
                                <Text style={styles.academyMatchName}>{mentor.name} ({mentor.exp} Exp)</Text>
                                <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>⭐ {mentor.rating} · {mentor.sessions} sessions</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.academyConnectBtn}
                                onPress={() => handleConnectMentor(mentor.id)}
                            >
                                <Text style={styles.academyConnectBtnText}>
                                    {connectedMentorIds.has(mentor.id) ? 'REQUESTED ✓' : 'CONNECT'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    ))}
                </View>
                <View style={{ height: 32 }} />
            </ScrollView>
        );
    };

    const renderBounties = () => {
        const bounties = [
            { id: 1, company: 'Zomato', logoLetter: 'Z', logoBg: '#ef4444', role: 'Operations Lead', bonus: '₹5,000', bonusValue: 5000, expiresInDays: 2, totalPot: '₹50,000', referrals: 12, category: 'Operations' },
            { id: 2, company: 'Delhivery', logoLetter: 'D', logoBg: '#2563eb', role: 'Senior HMV Driver', bonus: '₹3,500', bonusValue: 3500, expiresInDays: 5, totalPot: '₹35,000', referrals: 8, category: 'Driving' },
            { id: 3, company: 'Amazon', logoLetter: 'A', logoBg: '#f59e0b', role: 'Warehouse Supervisor', bonus: '₹8,000', bonusValue: 8000, expiresInDays: 7, totalPot: '₹80,000', referrals: 22, category: 'Warehouse' },
            { id: 4, company: 'Swiggy', logoLetter: 'S', logoBg: '#f97316', role: 'City Delivery Partner', bonus: '₹2,000', bonusValue: 2000, expiresInDays: 1, totalPot: '₹20,000', referrals: 45, category: 'Delivery' },
            { id: 5, company: 'BigBasket', logoLetter: 'B', logoBg: '#16a34a', role: 'Store Inventory Staff', bonus: '₹4,000', bonusValue: 4000, expiresInDays: 10, totalPot: '₹40,000', referrals: 6, category: 'Operations' },
            { id: 6, company: 'LogiTech Corp', logoLetter: 'L', logoBg: '#7c3aed', role: 'Fleet Coordinator', bonus: '₹6,500', bonusValue: 6500, expiresInDays: 3, totalPot: '₹65,000', referrals: 18, category: 'Logistics' },
        ];
        const totalEarned = [...referredBountyIds].reduce((sum, id) => { const b = bounties.find(x => x.id === id); return sum + (b ? b.bonusValue : 0); }, 0);
        const getExpiryStyle = (d) => d <= 2 ? { bg: '#ef4444', color: '#fff', label: 'EXPIRES SOON' } : d <= 5 ? { bg: '#fef3c7', color: '#92400e', label: `${d}d left` } : { bg: '#dcfce7', color: '#15803d', label: `${d}d left` };
        return (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.tabContent}>
                {/* Hero Banner */}
                <View style={styles.bountyHero}>
                    <Text style={styles.bountyHeroLabel}>REFERRAL ECONOMY</Text>
                    <Text style={styles.bountyHeroTitle}>Earn by Referring</Text>
                    <Text style={styles.bountyHeroSub}>{bounties.length} active bounties available</Text>
                    <View style={styles.earningsBox}>
                        <View>
                            <Text style={styles.earningsLabel}>Your Earnings</Text>
                            <Text style={styles.earningsValue}>₹{totalEarned.toLocaleString()}</Text>
                        </View>
                        <Text style={{ fontSize: 28 }}>💰</Text>
                    </View>
                </View>

                {bounties.map(bounty => {
                    const exp = getExpiryStyle(bounty.expiresInDays);
                    const isReferred = referredBountyIds.has(bounty.id);
                    return (
                        <View key={bounty.id} style={styles.bountyCard}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                    <View style={[styles.bountyLogo, { backgroundColor: bounty.logoBg }]}>
                                        <Text style={styles.bountyLogoText}>{bounty.logoLetter}</Text>
                                    </View>
                                    <View>
                                        <Text style={styles.gigTitle}>{bounty.company}</Text>
                                        <View style={[styles.categoryBadge, { backgroundColor: '#f1f5f9' }]}>
                                            <Text style={[styles.categoryBadgeText, { color: '#64748b' }]}>{bounty.category}</Text>
                                        </View>
                                    </View>
                                </View>
                                <View style={[styles.categoryBadge, { backgroundColor: exp.bg }]}>
                                    <Text style={[styles.categoryBadgeText, { color: exp.color }]}>{exp.label}</Text>
                                </View>
                            </View>
                            <Text style={[styles.gigTitle, { fontSize: 15, marginBottom: 10 }]}>{bounty.role}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View>
                                    <Text style={{ fontSize: 22, fontWeight: '900', color: '#9333ea' }}>{bounty.bonus}</Text>
                                    <Text style={styles.gigMeta}>{bounty.referrals} referred · {bounty.totalPot} pot</Text>
                                </View>
                                <TouchableOpacity
                                    style={[styles.applyBtn, isReferred && styles.applyBtnDone]}
                                    onPress={() => !isReferred && handleOpenReferModal(bounty)}
                                    disabled={isReferred}
                                >
                                    <Text style={[styles.applyBtnText, isReferred && { color: '#9333ea' }]}>
                                        {isReferred ? 'REFERRED ✓' : 'REFER A PEER'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    );
                })}
                <View style={{ height: 32 }} />
            </ScrollView>
        );
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <View style={styles.headerLogoBox}><Text style={styles.headerLogoH}>H</Text></View>
                    <Text style={styles.logoTitle}>HIRE<Text style={styles.logoCircle}>CIRCLE</Text></Text>
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.bellBtn}>
                        <IconBell size={20} color="#64748b" />
                        <View style={styles.bellDot} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.profileAvatarBtn}>
                        <Image source={{ uri: CURRENT_USER.avatar }} style={styles.profileAvatarImg} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Sub-tabs */}
            <View style={styles.subTabsContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subTabsContent}>
                    {SUB_TABS.map(tab => (
                        <TouchableOpacity key={tab} style={styles.subTab} onPress={() => setActiveTab(tab)} activeOpacity={0.7}>
                            <Text style={[styles.subTabText, activeTab === tab && styles.subTabTextActive]}>{tab}</Text>
                            {activeTab === tab && <View style={styles.subTabIndicator} />}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* Tab content */}
            <View style={styles.mainContent}>
                {activeTab === 'Feed' ? renderFeed() :
                    activeTab === 'Circles' ? renderCircles() :
                        activeTab === 'Pulse' ? renderPulse() :
                            activeTab === 'Academy' ? renderAcademy() :
                                renderBounties()}
            </View>

            {/* Add Post FAB (only on Feed) */}
            {activeTab === 'Feed' && (
                <TouchableOpacity style={styles.feedFab} activeOpacity={0.8}>
                    <IconPlus size={24} color="#fff" />
                </TouchableOpacity>
            )}

            {/* Circle Detail Modal */}
            <Modal
                visible={!!selectedCircle}
                animationType="slide"
                transparent={false}
                onRequestClose={() => setSelectedCircle(null)}
            >
                <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
                    {/* Circle Header */}
                    <View style={styles.modalHeaderBg}>
                        <View style={styles.modalHeaderRow}>
                            <TouchableOpacity onPress={() => setSelectedCircle(null)} style={styles.modalBackBtn}>
                                <Text style={styles.modalBackIcon}>‹</Text>
                            </TouchableOpacity>
                            <Image source={{ uri: `https://ui-avatars.com/api/?name=${selectedCircle?.name}&background=7c3aed&color=fff&rounded=true` }} style={styles.modalHeaderAvatar} />
                            <View style={{ flex: 1 }}>
                                <Text style={styles.modalHeaderTitle}>{selectedCircle?.name}</Text>
                                <Text style={styles.modalHeaderSub}>{selectedCircle?.members} Members • {selectedCircle?.online} Online</Text>
                            </View>
                        </View>
                        <View style={styles.modalSubtabsBg}>
                            {['DISCUSSION', 'RATES', 'MEMBERS'].map(t => (
                                <TouchableOpacity
                                    key={t}
                                    style={[styles.modalSubtabItem, circleDetailTab === t && styles.modalSubtabItemActive]}
                                    onPress={() => setCircleDetailTab(t)}
                                >
                                    <Text style={[styles.modalSubtabText, circleDetailTab === t && styles.modalSubtabTextActive]}>
                                        {t === 'DISCUSSION' ? 'CHAT ROOM' : t}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>

                    <View style={styles.modalContent}>
                        {circleDetailTab === 'DISCUSSION' && (
                            <View style={styles.flex1}>
                                <ScrollView ref={circleChatRef} contentContainerStyle={styles.chatScrollContent}>
                                    <View style={styles.chatTimeDiv}><Text style={styles.chatTimeText}>TODAY</Text></View>
                                    <View style={styles.chatBubbleRow}>
                                        <View style={styles.chatBubbleAvatar}><Text style={styles.chatBubbleAvatarText}>R</Text></View>
                                        <View style={styles.chatBubbleContent}>
                                            <View style={styles.chatBubbleMeta}>
                                                <Text style={styles.chatBubbleName}>Ramesh T.</Text>
                                                <Text style={styles.chatBubbleRole}>Driver</Text>
                                            </View>
                                            <View style={styles.chatBubbleTextBg}><Text style={styles.chatBubbleText}>Does anyone know if the NH65 diversions are cleared?</Text></View>
                                            <Text style={styles.chatBubbleTime}>10:05 AM</Text>
                                        </View>
                                    </View>
                                    <View style={styles.chatBubbleRow}>
                                        <View style={styles.chatBubbleAvatar}><Text style={styles.chatBubbleAvatarText}>V</Text></View>
                                        <View style={styles.chatBubbleContent}>
                                            <View style={styles.chatBubbleMeta}>
                                                <Text style={styles.chatBubbleName}>Vijay Kumar</Text>
                                                <IconCheck size={12} color="#3b82f6" />
                                                <Text style={styles.chatBubbleRole}>Admin</Text>
                                            </View>
                                            <View style={styles.chatBubbleTextBg}><Text style={styles.chatBubbleText}>Yes, I passed through an hour ago. Traffic is moving smoothly.</Text></View>
                                            <Text style={styles.chatBubbleTime}>10:08 AM</Text>
                                        </View>
                                    </View>
                                </ScrollView>
                                <View style={styles.chatInputRow}>
                                    <TouchableOpacity style={styles.chatAttachBtn}><IconPlus size={20} color="#64748b" /></TouchableOpacity>
                                    <TextInput
                                        style={[styles.chatInputText, isCircleRecording && { color: '#ef4444' }]}
                                        placeholder={isCircleRecording ? '🔴 Recording... tap mic to stop' : 'Ask for help or share updates...'}
                                        value={chatText}
                                        onChangeText={setChatText}
                                        editable={!isCircleRecording}
                                    />
                                    {chatText.length > 0 ? (
                                        <TouchableOpacity style={styles.chatSendBtn} onPress={() => {
                                            const msgs = [...circleMessages, { id: Date.now(), user: 'You', role: 'Member', text: chatText, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: 'text' }];
                                            setCircleMessages(msgs); setChatText('');
                                            setTimeout(() => circleChatRef.current?.scrollToEnd({ animated: true }), 50);
                                        }}><IconSend size={16} color="#fff" /></TouchableOpacity>
                                    ) : (
                                        <TouchableOpacity
                                            style={[styles.chatSendBtn, isCircleRecording && { backgroundColor: '#ef4444' }]}
                                            onPress={() => {
                                                if (isCircleRecording) {
                                                    setIsCircleRecording(false);
                                                    const msgs = [...circleMessages, { id: Date.now(), user: 'You', role: 'Member', text: '🎤 Voice message (0:08)', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), type: 'text' }];
                                                    setCircleMessages(msgs);
                                                    setTimeout(() => circleChatRef.current?.scrollToEnd({ animated: true }), 50);
                                                } else { setIsCircleRecording(true); }
                                            }}
                                        >
                                            <IconMic size={18} color="#fff" />
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        )}
                        {circleDetailTab === 'RATES' && (
                            <ScrollView contentContainerStyle={styles.ratesBox}>
                                <View style={styles.ratesBanner}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                        <IconSparkles size={16} color="#92400e" />
                                        <Text style={styles.ratesBannerTitle}>Community Rates</Text>
                                    </View>
                                    <Text style={styles.ratesBannerSub}>These are standard market rates sourced from community members. Use these to negotiate fair pay.</Text>
                                </View>
                                <View style={styles.ratesTable}>
                                    <View style={styles.ratesHeader}>
                                        <Text style={styles.ratesHeaderCol1}>SERVICE / ITEM</Text>
                                        <Text style={styles.ratesHeaderCol2}>AVG. PRICE</Text>
                                    </View>
                                    {[...(selectedCircle?.rates || []), ...circleCustomRates].map((r, i) => (
                                        <View key={i} style={styles.rateRow}>
                                            <Text style={styles.rateCol1}>{r.service}</Text>
                                            <Text style={styles.rateCol2}>{r.price}</Text>
                                        </View>
                                    ))}
                                </View>
                                {showCircleRateForm ? (
                                    <View style={styles.rateFormBox}>
                                        <Text style={styles.rateFormTitle}>SUGGEST A RATE</Text>
                                        <TextInput
                                            style={styles.rateFormInput}
                                            value={circleRateService}
                                            onChangeText={setCircleRateService}
                                            placeholder="Service name (e.g. Night Shift Premium)"
                                            placeholderTextColor="#94a3b8"
                                        />
                                        <TextInput
                                            style={styles.rateFormInput}
                                            value={circleRatePrice}
                                            onChangeText={setCircleRatePrice}
                                            placeholder="Your suggested price (e.g. ₹450)"
                                            placeholderTextColor="#94a3b8"
                                        />
                                        <View style={{ flexDirection: 'row', gap: 8 }}>
                                            <TouchableOpacity
                                                style={styles.rateSubmitBtn}
                                                onPress={() => {
                                                    if (!circleRateService.trim() || !circleRatePrice.trim()) return;
                                                    setCircleCustomRates(prev => [...prev, { service: circleRateService.trim(), price: circleRatePrice.trim() }]);
                                                    setCircleRateService(''); setCircleRatePrice(''); setShowCircleRateForm(false);
                                                }}
                                            >
                                                <Text style={styles.rateSubmitBtnText}>SUBMIT</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={styles.rateCancelBtn}
                                                onPress={() => { setShowCircleRateForm(false); setCircleRateService(''); setCircleRatePrice(''); }}
                                            >
                                                <Text style={styles.rateCancelBtnText}>CANCEL</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                ) : (
                                    <TouchableOpacity style={styles.suggestRateBtn} onPress={() => setShowCircleRateForm(true)}>
                                        <Text style={styles.suggestRateBtnText}>+ Suggest a Rate Change</Text>
                                    </TouchableOpacity>
                                )}
                            </ScrollView>
                        )}
                        {circleDetailTab === 'MEMBERS' && (() => {
                            const circleMembers = [
                                { id: 1, name: 'Vijay Kumar', role: 'Admin', joined: '2022', karma: 2100, avatar: 'https://i.pravatar.cc/150?u=vijay', isAdmin: true },
                                { id: 2, name: 'Ramesh T.', role: 'Driver', joined: '2023', karma: 890, avatar: 'https://i.pravatar.cc/150?u=ramesh', isAdmin: false },
                                { id: 3, name: 'Siva M.', role: 'Mechanic', joined: '2023', karma: 650, avatar: 'https://i.pravatar.cc/150?u=sivam', isAdmin: false },
                                { id: 4, name: 'Anita R.', role: 'Driver', joined: '2024', karma: 420, avatar: 'https://i.pravatar.cc/150?u=anita', isAdmin: false },
                                { id: 5, name: 'Deepak S.', role: 'Helper', joined: '2024', karma: 210, avatar: 'https://i.pravatar.cc/150?u=deepak', isAdmin: false },
                            ];
                            return (
                                <ScrollView contentContainerStyle={styles.ratesBox}>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                        <Text style={styles.membersTitle}>Community Leaders</Text>
                                        <Text style={styles.membersSortBadge}>Sorted by Karma</Text>
                                    </View>
                                    {circleMembers.map(member => (
                                        <View key={member.id} style={styles.memberRow}>
                                            <View style={{ position: 'relative', marginRight: 12 }}>
                                                <Image source={{ uri: member.avatar }} style={styles.memberAvatar} />
                                                {member.isAdmin && (
                                                    <View style={styles.adminBadge}><Text style={styles.adminBadgeText}>👑</Text></View>
                                                )}
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                                                    <Text style={styles.memberName}>{member.name}</Text>
                                                    {member.isAdmin && <IconCheck size={12} color="#3b82f6" />}
                                                </View>
                                                <Text style={styles.memberSub}>{member.isAdmin ? 'Admin · ' : ''}{member.role} · Since {member.joined}</Text>
                                            </View>
                                            <View style={[styles.karmaBadgeRight, { marginRight: 8 }]}>
                                                <Text style={styles.karmaBadgeTextRight}>{member.karma.toLocaleString()}</Text>
                                            </View>
                                            <TouchableOpacity style={styles.memberMsgBtn}><IconMessageSquare size={16} color="#94a3b8" /></TouchableOpacity>
                                        </View>
                                    ))}
                                </ScrollView>
                            );
                        })()}
                    </View>
                </View>
            </Modal>

            {/* Bounty Referral Modal */}
            <Modal visible={!!referringBounty} animationType="slide" transparent onRequestClose={handleCloseReferModal}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={handleCloseReferModal}>
                    <TouchableOpacity style={styles.referModalSheet} activeOpacity={1}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                            <View>
                                <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '700', marginBottom: 2 }}>Referral for</Text>
                                <Text style={{ fontSize: 18, fontWeight: '900', color: '#0f172a' }}>{referringBounty?.company}</Text>
                            </View>
                            <TouchableOpacity onPress={handleCloseReferModal} style={{ padding: 8, backgroundColor: '#f1f5f9', borderRadius: 20 }}>
                                <IconX size={20} color="#64748b" />
                            </TouchableOpacity>
                        </View>
                        <View style={styles.earningsPreviewBox}>
                            <View>
                                <Text style={{ fontSize: 10, color: '#7c3aed', fontWeight: '700', marginBottom: 4 }}>YOU EARN</Text>
                                <Text style={{ fontSize: 24, fontWeight: '900', color: '#7c3aed' }}>{referringBounty?.bonus}</Text>
                            </View>
                            <Text style={{ fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>Paid after 30-day{"\n"}successful onboarding</Text>
                        </View>
                        <Text style={{ fontSize: 10, fontWeight: '900', color: '#94a3b8', letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>FRIEND'S PHONE NUMBER</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                            <View style={styles.phonePrefix}><Text style={{ fontWeight: '700', color: '#64748b' }}>+91</Text></View>
                            <TextInput
                                style={styles.phoneInput}
                                value={referPhoneInput}
                                onChangeText={t => { setReferPhoneInput(t); setReferPhoneError(''); }}
                                placeholder="98765 43210"
                                placeholderTextColor="#94a3b8"
                                keyboardType="phone-pad"
                                maxLength={10}
                            />
                        </View>
                        {referPhoneError ? <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700', marginBottom: 8 }}>{referPhoneError}</Text> : null}
                        <TouchableOpacity style={styles.sendReferralBtn} onPress={handleSendReferral}>
                            <Text style={styles.sendReferralBtnText}>SEND REFERRAL</Text>
                        </TouchableOpacity>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            {/* Toasts */}
            {pulseToast && (
                <View style={styles.toastContainer} pointerEvents="none">
                    <Text style={styles.toastText}>{pulseToast}</Text>
                </View>
            )}
            {bountyToast && (
                <View style={styles.toastContainer} pointerEvents="none">
                    <Text style={styles.toastText}>{bountyToast}</Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    flex1: { flex: 1 },
    header: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9'
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    headerLogoBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#9333ea', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
    headerLogoH: { color: '#fff', fontSize: 16, fontWeight: 'bold', fontStyle: 'italic' },
    logoTitle: { fontSize: 20, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 },
    logoCircle: { color: '#9333ea' },
    headerRight: { flexDirection: 'row', alignItems: 'center' },
    bellBtn: { padding: 8, position: 'relative' },
    bellDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444', borderWidth: 2, borderColor: '#fff' },
    profileAvatarBtn: { marginLeft: 8, padding: 2, borderRadius: 20, borderWidth: 2, borderColor: '#a855f7' },
    profileAvatarImg: { width: 32, height: 32, borderRadius: 16 },

    subTabsContainer: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    subTabsContent: { paddingHorizontal: 16 },
    subTab: { paddingHorizontal: 12, paddingVertical: 14, marginRight: 8, position: 'relative' },
    subTabText: { fontSize: 11, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 },
    subTabTextActive: { color: '#9333ea' },
    subTabIndicator: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: '#9333ea', borderRadius: 2 },

    mainContent: { flex: 1 },
    tabContent: { padding: 12 },

    feedFab: { position: 'absolute', right: 20, bottom: 20, width: 56, height: 56, borderRadius: 28, backgroundColor: '#9333ea', justifyContent: 'center', alignItems: 'center', shadowColor: '#9333ea', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },

    // Post Creation Box
    createPostBox: { backgroundColor: '#fff', borderRadius: 24, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
    createPostRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    createAvatarImg: { width: 40, height: 40, borderRadius: 16, marginRight: 12 },
    createInputBg: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    createInputText: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
    createPostToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
    toolbarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    toolbarBtnText: { fontSize: 10, fontWeight: '800', color: '#64748b' },
    toolbarDivider: { width: 1, height: 16, backgroundColor: '#e2e8f0' },
    toolbarPostBtn: { backgroundColor: '#faf5ff', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
    toolbarPostBtnText: { fontSize: 10, fontWeight: '900', color: '#9333ea' },

    // Feed Posts
    postCard: { backgroundColor: '#fff', borderRadius: 24, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2, overflow: 'hidden' },
    bountyCardGradient: { backgroundColor: '#6b21a8', borderColor: '#581c87' },
    bountyAwardBg: { position: 'absolute', top: -10, right: -10, opacity: 0.2 },
    postHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    postAvatarImg: { width: 44, height: 44, borderRadius: 16, marginRight: 12 },
    postNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    postAuthor: { fontSize: 14, fontWeight: '900' },
    postRoleTime: { fontSize: 10, fontWeight: '800', marginTop: 2 },
    karmaBadgeRight: { backgroundColor: '#faf5ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
    karmaBadgeTextRight: { fontSize: 10, fontWeight: '900', color: '#9333ea' },
    postText: { fontSize: 14, fontWeight: '500', lineHeight: 22, marginBottom: 16 },

    postActions: { flexDirection: 'row', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, gap: 16 },
    actionBtn: { flexDirection: 'row', alignItems: 'center' },
    actionBtnText: { fontSize: 12, fontWeight: '800' },
    vouchBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
    vouchBtnActive: { backgroundColor: '#9333ea' },
    vouchBtnText: { fontSize: 11, fontWeight: '900', color: '#64748b' },
    vouchBtnTextActive: { color: '#ffffff' },

    relativeZ10: { position: 'relative', zIndex: 10, marginBottom: 16 },
    bountyLabelText: { fontSize: 10, fontWeight: '900', color: '#e9d5ff', letterSpacing: 1, marginBottom: 4 },
    bountyRewardText: { fontSize: 24, fontWeight: '900', color: '#ffffff', marginBottom: 12 },
    bountyReferBtn: { backgroundColor: '#ffffff', paddingVertical: 10, alignItems: 'center', borderRadius: 12 },
    bountyReferBtnText: { fontSize: 12, fontWeight: '900', color: '#6b21a8' },

    voicePlayer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#faf5ff', borderRadius: 16, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#f3e8ff' },
    playBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#9333ea', justifyContent: 'center', alignItems: 'center', shadowColor: '#9333ea', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4 },
    playBtnText: { color: '#fff', fontSize: 14, marginLeft: 2 },
    progressBarBg: { flex: 1, height: 6, backgroundColor: '#e9d5ff', borderRadius: 3, marginHorizontal: 12, overflow: 'hidden' },
    progressBarFill: { height: '100%', backgroundColor: '#9333ea', borderRadius: 3 },
    durationText: { fontSize: 11, fontWeight: '900', color: '#7e22ce' },

    // Circles List
    circlesHeroBg: { backgroundColor: '#4338ca', borderRadius: 24, padding: 24, marginBottom: 24, overflow: 'hidden' },
    circlesHeroBlurRing: { position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.1)' },
    circlesHeroTitle: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 8 },
    circlesHeroSub: { fontSize: 12, fontWeight: '500', color: '#e0e7ff', lineHeight: 18 },
    circlesSection: { marginBottom: 24 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
    circlesSectionTitle: { fontSize: 12, fontWeight: '900', color: '#0f172a', letterSpacing: 1 },
    joinedCircleCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#e2e8f0' },
    joinedCircleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    relativeAvatar: { position: 'relative' },
    joinedCircleImg: { width: 48, height: 48, borderRadius: 24 },
    onlineDotBordered: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#22c55e', borderWidth: 2, borderColor: '#fff' },
    joinedCircleName: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 2 },
    joinedCircleMembers: { fontSize: 10, fontWeight: '800', color: '#9333ea' },
    openCircleBtn: { backgroundColor: '#faf5ff', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
    openCircleBtnText: { fontSize: 11, fontWeight: '900', color: '#9333ea' },

    exploreCircleCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden' },
    exploreCircleBgIcon: { position: 'absolute', top: 16, right: 16, opacity: 0.03 },
    exploreCircleTop: { flexDirection: 'row', gap: 16, marginBottom: 16 },
    exploreCircleImg: { width: 56, height: 56, borderRadius: 16 },
    exploreCircleHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    exploreCircleName: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
    exploreCircleCat: { fontSize: 10, fontWeight: '800', color: '#64748b', backgroundColor: '#f1f5f9', alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
    joinCircleBtn: { backgroundColor: '#0f172a', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8 },
    joinCircleBtnText: { fontSize: 10, fontWeight: '900', color: '#fff' },
    exploreCircleDesc: { fontSize: 12, color: '#64748b', lineHeight: 18 },
    exploreCircleBottom: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12 },
    exploreCircleAvatars: { flexDirection: 'row', alignItems: 'center', marginRight: 8 },
    exploreMiniAvatar: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#e2e8f0', borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    exploreMiniAvatarText: { fontSize: 10, color: '#64748b', fontWeight: 'bold' },
    exploreCircleOnline: { fontSize: 10, fontWeight: '800', color: '#94a3b8' },
    exploreCircleTopic: { fontSize: 10, fontWeight: '800', color: '#9333ea', backgroundColor: '#faf5ff', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },

    // Pulse
    pulseCardWrapper: { padding: 16 },
    pulseCard: { backgroundColor: '#0f172a', borderRadius: 40, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10, minHeight: 300 },
    pulseBgEffect: { position: 'absolute', top: -50, left: -50, right: -50, bottom: -50, backgroundColor: 'rgba(124, 58, 237, 0.15)', borderRadius: 999 }, // Simplified mock of radial pulse background
    pulseContent: { position: 'relative', zIndex: 10, padding: 32, alignItems: 'center', justifyContent: 'center' },
    pulseRadarOuter: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(168, 85, 247, 0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 24, borderWidth: 4, borderColor: 'rgba(168, 85, 247, 0.1)' },
    pulseRadarInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#c084fc' },
    pulseTitle: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 8 },
    pulseSub: { fontSize: 12, color: '#94a3b8', textAlign: 'center', marginBottom: 24, lineHeight: 18, paddingHorizontal: 16 },
    pulseBtn: { backgroundColor: '#9333ea', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 16, shadowColor: '#3b0764', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.6, shadowRadius: 8, elevation: 6 },
    pulseBtnText: { fontSize: 14, fontWeight: '900', color: '#fff' },

    // Academy
    academyCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#e2e8f0' },
    academyHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    academyAiText: { fontSize: 12, fontWeight: '900', color: '#0f172a' },
    academyMatchBox: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#faf5ff', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f3e8ff' },
    academyAvatar: { width: 48, height: 48, borderRadius: 12 },
    academyMatchLabel: { fontSize: 10, fontWeight: '900', color: '#7e22ce', marginBottom: 4 },
    academyMatchName: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
    academyConnectBtn: { backgroundColor: '#9333ea', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
    academyConnectBtnText: { fontSize: 10, fontWeight: '900', color: '#fff' },

    // Circle Detail Modal
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalHeaderBg: { backgroundColor: '#9333ea', paddingTop: 16 },
    modalHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16 },
    modalBackBtn: { padding: 4, marginRight: 8 },
    modalBackIcon: { color: '#fff', fontSize: 32, lineHeight: 32, fontWeight: '300' },
    modalHeaderAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#c084fc', marginRight: 12 },
    modalHeaderTitle: { fontSize: 16, fontWeight: '900', color: '#fff' },
    modalHeaderSub: { fontSize: 10, fontWeight: '500', color: '#e9d5ff' },
    modalSubtabsBg: { flexDirection: 'row', paddingHorizontal: 8, paddingBottom: 8 },
    modalSubtabItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
    modalSubtabItemActive: { backgroundColor: '#fff' },
    modalSubtabText: { fontSize: 10, fontWeight: '900', color: '#d8b4fe' },
    modalSubtabTextActive: { color: '#7e22ce' },

    modalContent: { flex: 1 },
    chatScrollContent: { padding: 16, paddingBottom: 32 },
    chatTimeDiv: { alignSelf: 'center', backgroundColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, marginBottom: 16 },
    chatTimeText: { fontSize: 10, fontWeight: '900', color: '#64748b' },
    chatBubbleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 },
    chatBubbleAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f3e8ff', justifyContent: 'center', alignItems: 'center' },
    chatBubbleAvatarText: { fontSize: 14, fontWeight: '900', color: '#9333ea' },
    chatBubbleContent: { flex: 1, alignItems: 'flex-start' },
    chatBubbleMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    chatBubbleName: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
    chatBubbleRole: { fontSize: 10, fontWeight: '700', color: '#64748b', backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    chatBubbleTextBg: { backgroundColor: '#fff', padding: 12, borderRadius: 16, borderTopLeftRadius: 0, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
    chatBubbleText: { fontSize: 14, color: '#334155', lineHeight: 20 },
    chatBubbleTime: { fontSize: 10, color: '#94a3b8', fontWeight: '600', marginTop: 4, marginLeft: 4 },

    chatInputRow: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#e2e8f0', gap: 12 },
    chatAttachBtn: { padding: 8, backgroundColor: '#f1f5f9', borderRadius: 20 },
    chatInputText: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
    chatSendBtn: { padding: 12, backgroundColor: '#9333ea', borderRadius: 24 },

    ratesBox: { padding: 16 },
    ratesBanner: { backgroundColor: '#fef3c7', padding: 16, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: '#fde68a' },
    ratesBannerTitle: { fontSize: 14, fontWeight: '900', color: '#92400e' },
    ratesBannerSub: { fontSize: 12, color: '#b45309', lineHeight: 18 },
    ratesTable: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden', marginBottom: 16 },
    ratesHeader: { flexDirection: 'row', backgroundColor: '#f8fafc', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
    ratesHeaderCol1: { flex: 1, fontSize: 10, fontWeight: '900', color: '#64748b' },
    ratesHeaderCol2: { fontSize: 10, fontWeight: '900', color: '#64748b' },
    rateRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
    rateCol1: { flex: 1, fontSize: 14, fontWeight: '600', color: '#0f172a' },
    rateCol2: { fontSize: 14, fontWeight: '900', color: '#9333ea' },
    suggestRateBtn: { paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: '#c084fc', borderStyle: 'dashed', alignItems: 'center' },
    suggestRateBtnText: { fontSize: 12, fontWeight: '900', color: '#9333ea' },

    membersTitle: { fontSize: 14, fontWeight: '900', color: '#0f172a' },
    membersSortBadge: { fontSize: 10, fontWeight: '800', color: '#64748b', backgroundColor: '#f1f5f9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
    memberRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 12, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
    memberAvatar: { width: 40, height: 40, borderRadius: 20 },
    memberName: { fontSize: 14, fontWeight: '800', color: '#0f172a', marginBottom: 2 },
    memberSub: { fontSize: 11, color: '#64748b' },
    memberMsgBtn: { padding: 10, backgroundColor: '#f8fafc', borderRadius: 20 },
    adminBadge: { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, backgroundColor: '#fbbf24', borderRadius: 8, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    adminBadgeText: { fontSize: 8 },

    // Agent 1: Feed extras
    composerTextarea: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: '#0f172a', marginBottom: 12, minHeight: 80, textAlignVertical: 'top' },
    toolbarCancelBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f1f5f9' },
    toolbarCancelBtnText: { fontSize: 10, fontWeight: '900', color: '#64748b' },
    galleryImg: { width: 180, height: 120, borderRadius: 16, marginRight: 8, backgroundColor: '#e2e8f0' },
    commentSection: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12, marginTop: 4 },
    commentRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
    commentAvatar: { width: 24, height: 24, borderRadius: 12 },
    commentBubble: { flex: 1, backgroundColor: '#f8fafc', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
    commentBubbleText: { fontSize: 12, color: '#334155', fontWeight: '500' },
    commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    commentInput: { flex: 1, backgroundColor: '#f1f5f9', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 12, color: '#0f172a' },
    commentSendBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#9333ea', justifyContent: 'center', alignItems: 'center' },

    // Agent 2: Pulse extras
    gigCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
    gigTitle: { fontSize: 13, fontWeight: '900', color: '#0f172a', marginRight: 6 },
    gigEmployer: { fontSize: 10, fontWeight: '700', color: '#94a3b8', marginTop: 2 },
    gigMeta: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
    gigPay: { fontSize: 15, fontWeight: '900', color: '#9333ea' },
    urgentBadge: { backgroundColor: '#ef4444', borderRadius: 20, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 },
    urgentBadgeText: { fontSize: 9, fontWeight: '900', color: '#fff' },
    categoryBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    categoryBadgeText: { fontSize: 9, fontWeight: '800' },
    applyBtn: { backgroundColor: '#0f172a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
    applyBtnDone: { backgroundColor: '#faf5ff' },
    applyBtnText: { fontSize: 10, fontWeight: '900', color: '#fff' },
    proCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', alignItems: 'center' },
    proAvatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#e2e8f0' },
    availabilityDot: { position: 'absolute', bottom: -1, right: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
    proName: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
    proMeta: { fontSize: 10, fontWeight: '600', color: '#94a3b8', marginTop: 2 },
    hireBtn: { backgroundColor: '#0f172a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginLeft: 8 },
    hireBtnDone: { backgroundColor: '#faf5ff' },
    hireBtnText: { fontSize: 10, fontWeight: '900', color: '#fff' },
    busyTag: { backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, marginLeft: 8 },
    busyTagText: { fontSize: 10, fontWeight: '700', color: '#94a3b8' },

    // Agent 3: Academy extras
    courseCard: { backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', flexDirection: 'row', gap: 12, alignItems: 'flex-start', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
    courseThumb: { width: 90, height: 64, borderRadius: 12, backgroundColor: '#e2e8f0' },

    // Agent 4: Circles — rate form
    rateFormBox: { backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 16, padding: 16 },
    rateFormTitle: { fontSize: 10, fontWeight: '900', color: '#7c3aed', letterSpacing: 1, marginBottom: 12 },
    rateFormInput: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13, color: '#0f172a', marginBottom: 10 },
    rateSubmitBtn: { flex: 1, backgroundColor: '#9333ea', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
    rateSubmitBtnText: { fontSize: 12, fontWeight: '900', color: '#fff' },
    rateCancelBtn: { paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, alignItems: 'center' },
    rateCancelBtnText: { fontSize: 12, fontWeight: '700', color: '#64748b' },

    // Agent 5: Bounties extras
    bountyHero: { backgroundColor: '#7c3aed', borderRadius: 24, padding: 24, marginBottom: 16 },
    bountyHeroLabel: { fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.7)', letterSpacing: 2, marginBottom: 4 },
    bountyHeroTitle: { fontSize: 22, fontWeight: '900', color: '#fff', marginBottom: 4 },
    bountyHeroSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 16 },
    earningsBox: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    earningsLabel: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontWeight: '700', marginBottom: 4 },
    earningsValue: { fontSize: 24, fontWeight: '900', color: '#fff' },
    bountyCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
    bountyLogo: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    bountyLogoText: { fontSize: 18, fontWeight: '900', color: '#fff' },

    // Modals + toasts
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    referModalSheet: { backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 36 },
    earningsPreviewBox: { backgroundColor: '#faf5ff', borderWidth: 1, borderColor: '#e9d5ff', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    phonePrefix: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center' },
    phoneInput: { flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#0f172a' },
    sendReferralBtn: { backgroundColor: '#0f172a', paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginTop: 16 },
    sendReferralBtnText: { fontSize: 14, fontWeight: '900', color: '#fff' },
    toastContainer: { position: 'absolute', bottom: 90, alignSelf: 'center', backgroundColor: '#0f172a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20, elevation: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    toastText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

