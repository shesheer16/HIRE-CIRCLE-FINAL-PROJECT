import React, { useState, useRef, useEffect } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, FlatList,
    StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated, Image, Modal
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconVideo, IconPhone, IconPlus, IconSend, IconMic, IconGlobe, IconSparkles, IconBriefcase, IconCheck } from '../components/Icons';

const MOCK_ME_ID = 'me';

const generateMockMessages = (companyName) => [
    {
        _id: 'sys1',
        sender: 'system',
        text: 'Application received. Reviewing your profile.',
        type: 'system',
        createdAt: new Date(Date.now() - 10000000).toISOString(),
    },
    {
        _id: 'm1',
        sender: 'them',
        name: companyName,
        text: 'Hi! We reviewed your profile and are very impressed. Would you be available for a quick call this week?',
        type: 'text',
        createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    },
    {
        _id: 'm2',
        sender: MOCK_ME_ID,
        text: 'Thank you! Yes, I would love to connect. I\'m available Thursday or Friday afternoon.',
        type: 'text',
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
        _id: 'm3',
        sender: 'them',
        name: companyName,
        text: 'Perfect! Let\'s schedule Friday at 3 PM IST. I\'ll send a calendar invite shortly.',
        type: 'text',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
];

const AI_SUGGESTIONS = [
    "Sounds great, thanks!",
    "Can we do tomorrow?",
    "What's the salary range?"
];

// Typing Indicator Component
const TypingIndicator = () => {
    const dot1 = useRef(new Animated.Value(0)).current;
    const dot2 = useRef(new Animated.Value(0)).current;
    const dot3 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const createAnimation = (anim, delay) => {
            return Animated.loop(
                Animated.sequence([
                    Animated.timing(anim, { toValue: -6, duration: 300, delay, useNativeDriver: true }),
                    Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
                    Animated.delay(400)
                ])
            );
        };
        createAnimation(dot1, 0).start();
        createAnimation(dot2, 150).start();
        createAnimation(dot3, 300).start();
    }, []);

    return (
        <View style={styles.typingContainer}>
            <Animated.View style={[styles.typingDot, { transform: [{ translateY: dot1 }] }]} />
            <Animated.View style={[styles.typingDot, { transform: [{ translateY: dot2 }] }]} />
            <Animated.View style={[styles.typingDot, { transform: [{ translateY: dot3 }] }]} />
        </View>
    );
};

export default function ChatScreen({ route, navigation }) {
    const insets = useSafeAreaInsets();
    const { applicationId, otherPartyName = 'Logitech', jobTitle = 'Moving the world, one delivery at a time.', status = 'Applied' } = route.params || {};

    const [messages, setMessages] = useState(generateMockMessages(otherPartyName));
    const [input, setInput] = useState('');
    const [showAttachments, setShowAttachments] = useState(false);
    const [isTyping, setIsTyping] = useState(true);
    const [showProfileModal, setShowProfileModal] = useState(false); // New State for Profile Modal

    const flatListRef = useRef(null);

    useEffect(() => {
        const t = setTimeout(() => setIsTyping(false), 5000);
        return () => clearTimeout(t);
    }, []);

    const sendMessage = (text = input) => {
        if (!text.trim()) return;
        const newMsg = {
            _id: `m${Date.now()}`,
            sender: MOCK_ME_ID,
            text: text.trim(),
            type: 'text',
            createdAt: new Date().toISOString(),
        };
        setMessages(prev => [...prev, newMsg]);
        setInput('');

        setIsTyping(true);
        setTimeout(() => setIsTyping(false), 3000);
    };

    const formatTime = (iso) => {
        try {
            return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    };

    const renderMessage = ({ item }) => {
        const isSystem = item.type === 'system';
        const isMe = item.sender === MOCK_ME_ID;

        if (isSystem) {
            return (
                <View style={styles.sysMsgWrapper}>
                    <Text style={styles.sysMsgText}>{item.text}</Text>
                </View>
            );
        }

        return (
            <View style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperThem]}>
                <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
                        {item.text}
                    </Text>
                    <Text style={styles.timeText}>
                        {formatTime(item.createdAt)}
                    </Text>
                </View>
            </View>
        );
    };

    const renderHeader = () => (
        <View style={[styles.header, { paddingTop: insets.top }]}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={styles.headerInfoContainer}
                activeOpacity={0.7}
                onPress={() => setShowProfileModal(true)} // NOW OPENS MODAL
            >
                <Image source={{ uri: `https://ui-avatars.com/api/?name=${otherPartyName}&background=7c3aed&color=fff` }} style={styles.headerAvatar} />
                <View style={styles.headerInfoText}>
                    <Text style={styles.headerName} numberOfLines={1}>{otherPartyName}</Text>
                    <Text style={styles.headerSub} numberOfLines={1}>{status}</Text>
                </View>
            </TouchableOpacity>

            <View style={styles.headerActions}>
                <TouchableOpacity style={styles.headerActionBtn}>
                    <IconVideo size={20} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.headerActionBtn}>
                    <IconPhone size={20} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );

    const products = [
        { name: 'Express Last-Mile', icon: '🚚', desc: 'Tech-enabled delivery for e-commerce and retail.' },
        { name: 'Cold Chain Pros', icon: '❄️', desc: 'Temperature-sensitive food and vaccine transport.' },
        { name: 'Heavy Hauling', icon: '🏗️', desc: 'Industrial equipment and raw material infrastructure.' },
        { name: 'Warehouse Smart', icon: '🏢', desc: 'AI-driven inventory and storage management.' }
    ];

    const milestones = [
        { year: '2023', event: 'Reached 10M successful deliveries nationwide' },
        { year: '2021', event: 'Expanded cross-border logistics to SEA regions' },
        { year: '2015', event: 'Founded in Hyderabad as a small bike-fleet' }
    ];

    return (
        <View style={styles.container}>
            {renderHeader()}

            <FlatList
                ref={flatListRef}
                data={messages}
                keyExtractor={item => item._id}
                renderItem={renderMessage}
                style={{ flex: 1 }}
                contentContainerStyle={styles.messagesList}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
                onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
                ListFooterComponent={() => isTyping ? (
                    <View style={styles.typingWrapper}>
                        <View style={styles.typingBubble}>
                            <TypingIndicator />
                        </View>
                    </View>
                ) : null}
            />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
                {/* Suggestions */}
                <View style={styles.suggestionsContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsContent}>
                        {AI_SUGGESTIONS.map((sugg, idx) => (
                            <TouchableOpacity key={idx} style={styles.suggPill} onPress={() => setInput(sugg)}>
                                <Text style={styles.suggText}>✨ Suggest: {sugg}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                {/* Input Bar */}
                <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
                    <TouchableOpacity
                        style={[styles.attachBtn, showAttachments && styles.attachBtnActive]}
                        onPress={() => setShowAttachments(!showAttachments)}
                    >
                        <View style={{ transform: [{ rotate: showAttachments ? '45deg' : '0deg' }] }}>
                            <IconPlus size={24} color={showAttachments ? '#1e293b' : '#64748b'} />
                        </View>
                    </TouchableOpacity>

                    <View style={styles.inputWrap}>
                        <TextInput
                            style={styles.inputField}
                            placeholder="Type a message..."
                            placeholderTextColor="#94a3b8"
                            value={input}
                            onChangeText={setInput}
                            multiline
                        />
                    </View>

                    {input.trim() ? (
                        <TouchableOpacity style={styles.sendBtn} onPress={() => sendMessage()}>
                            <IconSend size={18} color="#fff" />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity style={styles.micBtn}>
                            <IconMic size={24} color="#64748b" />
                        </TouchableOpacity>
                    )}
                </View>
            </KeyboardAvoidingView>

            {/* Profile Detail Modal fully mapped to ContactInfoView */}
            <Modal
                visible={showProfileModal}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={() => setShowProfileModal(false)}
            >
                <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={() => setShowProfileModal(false)} style={styles.modalBackBtnModal}>
                            <Text style={styles.modalBackIconModal}>‹</Text>
                        </TouchableOpacity>
                        <Text style={styles.modalTitle}>Enterprise Hub</Text>
                    </View>
                    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} bounces={false}>
                        <View style={styles.bannerContainer}>
                            {/* Mocking radial gradient and background */}
                            <Image
                                source={{ uri: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=800&auto=format&fit=crop' }}
                                style={styles.bannerImage}
                            />
                            <View style={styles.bannerPillContainer}>
                                <View style={styles.bannerPill}>
                                    <Text style={styles.bannerPillText}>Logistics & Supply Chain</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.profileSection}>
                            <Image source={{ uri: `https://ui-avatars.com/api/?name=${otherPartyName}&background=7c3aed&color=fff&size=512` }} style={styles.contactAvatarLg} />

                            <View style={styles.nameRow}>
                                <Text style={styles.contactName}>{otherPartyName}</Text>
                                <View style={styles.verifiedBadge}>
                                    <IconCheck size={14} color="#6366f1" />
                                </View>
                            </View>
                            <Text style={styles.contactRole}>{jobTitle}</Text>

                            <View style={styles.actionRow}>
                                <TouchableOpacity style={styles.actionBtnModal}>
                                    <View style={styles.actionIconWrap}>
                                        <IconPhone size={20} color="#9333ea" />
                                    </View>
                                    <Text style={styles.actionBtnText}>CALL</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.actionBtnModal}>
                                    <View style={styles.actionIconWrap}>
                                        <IconVideo size={20} color="#9333ea" />
                                    </View>
                                    <Text style={styles.actionBtnText}>VIDEO</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.actionBtnModal}>
                                    <View style={styles.actionIconWrap}>
                                        <IconGlobe size={20} color="#9333ea" />
                                    </View>
                                    <Text style={styles.actionBtnText}>SITE</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Section Cards */}
                            <View style={styles.detailsCard}>
                                <Text style={styles.sectionTitle}><IconSparkles size={14} color="#a855f7" />  MISSION & VISION</Text>
                                <Text style={styles.sectionText}>
                                    We are building the backbone of modern commerce in India. By integrating AI with a massive fleet network, we ensure fair pay for partners and lightning-fast logistics for businesses.
                                </Text>
                                <View style={styles.gridRow}>
                                    <View style={styles.gridBox}>
                                        <Text style={styles.gridBoxLabel}>INDUSTRY</Text>
                                        <Text style={styles.gridBoxValue}>Logistics & Supply Chain</Text>
                                    </View>
                                    <View style={styles.gridBox}>
                                        <Text style={styles.gridBoxLabel}>GLOBAL HQ</Text>
                                        <Text style={styles.gridBoxValue}>Hyderabad, IN</Text>
                                    </View>
                                </View>
                            </View>

                            <View style={styles.detailsCard}>
                                <Text style={styles.sectionTitle}><IconBriefcase size={14} color="#a855f7" />  PRODUCTS & SERVICES</Text>
                                {products.map((p, idx) => (
                                    <View key={idx} style={styles.productRow}>
                                        <View style={styles.productIconBox}>
                                            <Text style={styles.productIconEmoji}>{p.icon}</Text>
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.productName}>{p.name}</Text>
                                            <Text style={styles.productDesc}>{p.desc}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>

                            <View style={styles.detailsCard}>
                                <Text style={styles.sectionTitle}><IconGlobe size={14} color="#a855f7" />  TIMELINE</Text>
                                <View style={styles.timelineContainer}>
                                    <View style={styles.timelineLine} />
                                    {milestones.map((m, idx) => (
                                        <View key={idx} style={styles.timelineItem}>
                                            <View style={styles.timelineDot} />
                                            <View style={styles.timelineYearBadge}>
                                                <Text style={styles.timelineYearText}>{m.year}</Text>
                                            </View>
                                            <Text style={styles.timelineEventText}>{m.event}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            <View style={styles.darkCard}>
                                <View style={styles.darkCardIconBg}>
                                    <IconGlobe size={80} color="rgba(255,255,255,0.05)" />
                                </View>
                                <Text style={styles.sectionTitleDark}>CONTACT INFORMATION</Text>
                                <View style={styles.darkRow}>
                                    <Text style={styles.darkLabel}>PARTNERSHIP</Text>
                                    <Text style={styles.darkValue}>partners@logitech.in</Text>
                                </View>
                                <View style={styles.darkRow}>
                                    <Text style={styles.darkLabel}>SUPPORT</Text>
                                    <Text style={styles.darkValue}>+91 1800 200 1234</Text>
                                </View>
                                <View style={styles.darkRow}>
                                    <Text style={styles.darkLabel}>OFFICIAL WEB</Text>
                                    <Text style={styles.darkValue}>www.logitech.in</Text>
                                </View>
                            </View>
                            <View style={{ height: 40 }} />
                        </View>
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3e8ff' }, // matching ref

    // Header
    header: { backgroundColor: '#9333ea', paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 4, zIndex: 10 },
    backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginRight: 8, backgroundColor: 'rgba(0,0,0,0.1)', borderRadius: 18 },
    backArrow: { color: '#fff', fontSize: 24, fontWeight: '300', marginBottom: 2 },
    headerInfoContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
    headerAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', marginRight: 12 },
    headerInfoText: { flex: 1 },
    headerName: { color: '#fff', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#e9d5ff', fontSize: 11, fontWeight: '500' },
    headerActions: { flexDirection: 'row', gap: 6, marginLeft: 8 },
    headerActionBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', borderRadius: 18 },

    // Messages
    messagesList: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 16 },
    sysMsgWrapper: { alignItems: 'center', marginVertical: 16 },
    sysMsgText: { backgroundColor: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#fde68a' },

    msgWrapper: { maxWidth: '80%', marginBottom: 12 },
    msgWrapperMe: { alignSelf: 'flex-end' },
    msgWrapperThem: { alignSelf: 'flex-start' },
    bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    bubbleMe: { backgroundColor: '#e9d5ff', borderTopRightRadius: 4, borderWidth: 1, borderColor: '#d8b4fe' },
    bubbleThem: { backgroundColor: '#fff', borderTopLeftRadius: 4 },
    bubbleText: { fontSize: 14, lineHeight: 20 },
    bubbleTextMe: { color: '#0f172a' },
    bubbleTextThem: { color: '#0f172a' },
    timeText: { fontSize: 10, color: '#94a3b8', marginTop: 4, alignSelf: 'flex-end' },

    // Typing
    typingWrapper: { alignSelf: 'flex-start', marginBottom: 12, marginLeft: 4 },
    typingBubble: { backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderTopLeftRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    typingContainer: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 16, paddingHorizontal: 4 },
    typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#a855f7' },

    // Suggestions
    suggestionsContainer: { backgroundColor: 'rgba(255,255,255,0.9)', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingVertical: 8 },
    suggestionsContent: { paddingHorizontal: 16, gap: 8 },
    suggPill: { backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#e9d5ff', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1, elevation: 1 },
    suggText: { fontSize: 12, fontWeight: '800', color: '#7e22ce' },

    // Input Bar
    inputBar: { backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingTop: 8 },
    attachBtn: { padding: 10, borderRadius: 20 },
    attachBtnActive: { backgroundColor: '#f1f5f9' },
    inputWrap: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 24, borderWidth: 1, borderColor: '#f1f5f9', minHeight: 40, maxHeight: 100, justifyContent: 'center' },
    inputField: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 14, color: '#0f172a' },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#9333ea', justifyContent: 'center', alignItems: 'center', marginLeft: 8, shadowColor: '#9333ea', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 3 },
    micBtn: { padding: 10, marginLeft: 2 },

    // Profile Modal Styles mapped from ContactInfoView
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#9333ea', paddingVertical: 16, paddingHorizontal: 20 },
    modalBackBtnModal: { marginRight: 16, backgroundColor: 'rgba(255,255,255,0.1)', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    modalBackIconModal: { color: '#ffffff', fontSize: 24, fontWeight: '300', marginBottom: 2 },
    modalTitle: { color: '#ffffff', fontSize: 18, fontWeight: '700' },

    bannerContainer: { height: 160, position: 'relative', backgroundColor: '#581c87' },
    bannerImage: { width: '100%', height: '100%', opacity: 0.4 },
    bannerPillContainer: { position: 'absolute', bottom: 16, left: 16 },
    bannerPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
    bannerPillText: { color: '#fff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },

    profileSection: { paddingHorizontal: 16, marginTop: -48, alignItems: 'center' },
    contactAvatarLg: { width: 96, height: 96, borderRadius: 24, borderWidth: 4, borderColor: '#ffffff', backgroundColor: '#ffffff', marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 16 },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
    contactName: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
    verifiedBadge: { backgroundColor: '#eef2ff', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    contactRole: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 32, textAlign: 'center', paddingHorizontal: 16 },

    actionRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginBottom: 24, width: '100%', paddingHorizontal: 16 },
    actionBtnModal: { flex: 1, backgroundColor: '#ffffff', borderRadius: 24, padding: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#f1f5f9' },
    actionIconWrap: { width: 40, height: 40, borderRadius: 16, backgroundColor: '#faf5ff', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    actionBtnText: { fontSize: 10, fontWeight: '900', color: '#94a3b8', letterSpacing: 0.5 },

    detailsCard: { backgroundColor: '#ffffff', borderRadius: 32, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1, width: '100%' },
    sectionTitle: { fontSize: 16, fontWeight: '900', color: '#0f172a', marginBottom: 16, flex: 1 },
    sectionText: { fontSize: 14, color: '#475569', lineHeight: 22, fontWeight: '500', marginBottom: 24 },

    gridRow: { flexDirection: 'row', gap: 12 },
    gridBox: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    gridBoxLabel: { fontSize: 9, fontWeight: '900', color: '#94a3b8', letterSpacing: 1, marginBottom: 4 },
    gridBoxValue: { fontSize: 12, fontWeight: '900', color: '#334155' },

    productRow: { flexDirection: 'row', gap: 16, padding: 16, backgroundColor: '#f8fafc', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 12 },
    productIconBox: { width: 48, height: 48, backgroundColor: '#fff', borderRadius: 12, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    productIconEmoji: { fontSize: 24 },
    productName: { fontSize: 14, fontWeight: '900', color: '#1e293b', marginBottom: 4 },
    productDesc: { fontSize: 12, fontWeight: '500', color: '#64748b', lineHeight: 18 },

    timelineContainer: { paddingLeft: 24, position: 'relative' },
    timelineLine: { position: 'absolute', left: 4, top: 8, bottom: 8, width: 2, backgroundColor: '#f3e8ff' },
    timelineItem: { marginBottom: 24, position: 'relative' },
    timelineDot: { position: 'absolute', left: -25, top: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: '#a855f7', borderWidth: 4, borderColor: '#faf5ff' },
    timelineYearBadge: { backgroundColor: '#faf5ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#f3e8ff', alignSelf: 'flex-start', marginBottom: 8 },
    timelineYearText: { fontSize: 10, fontWeight: '900', color: '#9333ea' },
    timelineEventText: { fontSize: 14, fontWeight: '700', color: '#334155' },

    darkCard: { backgroundColor: '#0f172a', borderRadius: 32, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 16, elevation: 10, width: '100%', overflow: 'hidden', position: 'relative' },
    darkCardIconBg: { position: 'absolute', top: 16, right: 16, transform: [{ rotate: '12deg' }] },
    sectionTitleDark: { fontSize: 16, fontWeight: '900', color: '#fff', marginBottom: 16, zIndex: 10 },
    darkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, zIndex: 10 },
    darkLabel: { fontSize: 10, fontWeight: '900', color: '#94a3b8', letterSpacing: 1 },
    darkValue: { fontSize: 14, fontWeight: '900', color: '#c084fc' },
});