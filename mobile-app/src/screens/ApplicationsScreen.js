import React, { useState, useRef } from 'react';
import {
    View, Text, FlatList, StyleSheet, TouchableOpacity, Modal, ScrollView, Image,
    Animated, PanResponder, Dimensions, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import EmptyState from '../components/EmptyState';
import SkeletonLoader from '../components/SkeletonLoader';

const { width } = Dimensions.get('window');

const MOCK_APPLICATIONS = [
    { _id: '65f02bc0fe1234a56bcc7891', companyName: 'TechCorp India', jobTitle: 'Senior React Native Developer', status: 'Shortlisted', lastMessage: "We'd love to schedule a call. Are you available Friday?", time: '10:32 AM', logo: 'https://ui-avatars.com/api/?name=TechCorp&background=7c3aed&color=fff' },
    { _id: '65f02bc0fe1234a56bcc7892', companyName: 'StartupX', jobTitle: 'Full Stack Engineer', status: 'Interview', lastMessage: 'Your interview is confirmed for Tuesday at 3 PM IST.', time: 'Yesterday', logo: 'https://ui-avatars.com/api/?name=StartupX&background=0f172a&color=fff' },
    { _id: '65f02bc0fe1234a56bcc7893', companyName: 'DesignHub', jobTitle: 'UI/UX Designer', status: 'Applied', lastMessage: 'Thank you for applying! We will review your profile.', time: 'Mon', logo: 'https://ui-avatars.com/api/?name=DesignHub&background=f43f5e&color=fff' },
];

const FILTERS = ['All', 'Applied', 'Shortlisted', 'Interview'];

const PRODUCTS = [
    { name: 'Express Last-Mile', icon: '🚚', desc: 'Tech-enabled delivery for e-commerce and retail.' },
    { name: 'Cold Chain Pros', icon: '❄️', desc: 'Temperature-sensitive food and vaccine transport.' },
    { name: 'Heavy Hauling', icon: '🏗️', desc: 'Industrial equipment and raw material infrastructure.' },
    { name: 'Warehouse Smart', icon: '🏢', desc: 'AI-driven inventory and storage management.' }
];

const SwipeableRow = ({ children, onArchive }) => {
    const pan = useRef(new Animated.ValueXY()).current;
    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (evt, gestureState) => Math.abs(gestureState.dx) > 10,
            onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
            onPanResponderRelease: (evt, gestureState) => {
                if (gestureState.dx < -80) {
                    Animated.timing(pan, { toValue: { x: -width, y: 0 }, duration: 250, useNativeDriver: false }).start(() => onArchive());
                } else {
                    Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
                }
            }
        })
    ).current;

    return (
        <View style={styles.swipeContainer}>
            <View style={styles.swipeBackground}>
                <Text style={styles.swipeText}>Archive</Text>
            </View>
            <Animated.View style={[styles.swipeForeground, { transform: [{ translateX: pan.x }] }]} {...panResponder.panHandlers}>
                {children}
            </Animated.View>
        </View>
    );
};

export default function ApplicationsScreen({ navigation }) {
    const insets = useSafeAreaInsets();
    const [applications, setApplications] = useState(MOCK_APPLICATIONS);
    const [selectedFilter, setSelectedFilter] = useState('All');
    const [selectedContact, setSelectedContact] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsLoading(false);
        }, 1000);
        return () => clearTimeout(timer);
    }, []);

    const filteredApps = applications.filter(app => selectedFilter === 'All' || app.status === selectedFilter);

    const openContactInfo = (contact) => setSelectedContact(contact);
    const handleArchive = (id) => setApplications(prev => prev.filter(a => a._id !== id));

    const handleWithdraw = () => {
        Alert.alert(
            'Withdraw Application',
            'Are you sure? This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Withdraw', style: 'destructive', onPress: () => {
                        setApplications(prev => prev.filter(a => a._id !== selectedContact._id));
                        setSelectedContact(null);
                    }
                }
            ]
        );
    };

    const renderItem = ({ item }) => (
        <SwipeableRow onArchive={() => handleArchive(item._id)}>
            <View style={styles.row}>
                <TouchableOpacity style={styles.avatarWrap} onPress={() => openContactInfo(item)} activeOpacity={0.7}>
                    <Image source={{ uri: item.logo }} style={styles.avatarImage} />
                    <View style={styles.purpleDot} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.rowContent} activeOpacity={0.7} onPress={() => navigation.navigate('Chat', { applicationId: item._id, otherPartyName: item.companyName, jobTitle: item.jobTitle, status: item.status })}>
                    <View style={styles.rowTop}>
                        <TouchableOpacity onPress={() => openContactInfo(item)} activeOpacity={0.7}>
                            <Text style={styles.companyName} numberOfLines={1}>{item.companyName}</Text>
                        </TouchableOpacity>
                        <Text style={styles.timeText}>{item.time}</Text>
                    </View>
                    <View style={styles.titleRow}>
                        <Text style={styles.jobTitle} numberOfLines={1}>{item.jobTitle}</Text>
                        <View style={styles.statusBadge}>
                            <Text style={styles.statusBadgeText}>{item.status}</Text>
                        </View>
                    </View>
                    <Text style={styles.lastMessage} numberOfLines={1}>{item.lastMessage}</Text>
                </TouchableOpacity>
            </View>
        </SwipeableRow>
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
                <Text style={styles.headerTitle}>Applications</Text>
                <Text style={styles.headerSubtitle}>Active conversations with employers</Text>

                {/* Horizontal Filters */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                    {FILTERS.map(f => (
                        <TouchableOpacity key={f} onPress={() => setSelectedFilter(f)} style={[styles.filterPill, selectedFilter === f && styles.filterPillActive]}>
                            <Text style={[styles.filterText, selectedFilter === f && styles.filterTextActive]}>{f}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {isLoading ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
                    <SkeletonLoader height={72} style={{ borderRadius: 12, marginBottom: 12 }} />
                    <SkeletonLoader height={72} style={{ borderRadius: 12, marginBottom: 12 }} />
                    <SkeletonLoader height={72} style={{ borderRadius: 12, marginBottom: 12 }} />
                    <SkeletonLoader height={72} style={{ borderRadius: 12, marginBottom: 12 }} />
                </View>
            ) : (
                <FlatList
                    data={filteredApps}
                    keyExtractor={item => item._id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    ListEmptyComponent={
                        <EmptyState
                            icon={<View style={styles.emptyIconCircle}><Text style={styles.emptyEmoji}>📬</Text></View>}
                            title="No Applications Found"
                            message="Try changing your filter or apply to new jobs."
                            actionLabel={selectedFilter !== 'All' ? "Clear Filters" : "Find Jobs"}
                            onAction={() => {
                                if (selectedFilter !== 'All') {
                                    setSelectedFilter('All');
                                } else {
                                    navigation.navigate('Jobs'); // Route to global Jobs Screen
                                }
                            }}
                        />
                    }
                />
            )}

            {/* Contact Info Modal */}
            <Modal visible={!!selectedContact} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedContact(null)}>
                {selectedContact && (
                    <View style={styles.modalContainer}>
                        <View style={styles.modalHeader}>
                            <TouchableOpacity onPress={() => setSelectedContact(null)} style={styles.modalCloseBtn}>
                                <Text style={styles.modalCloseText}>✕</Text>
                            </TouchableOpacity>
                            <Text style={styles.modalTitle}>Company Profile</Text>
                            <View style={{ width: 40 }} />
                        </View>
                        <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={styles.modalScrollContent}>
                            <View style={styles.bannerContainer}>
                                <Image source={{ uri: 'https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=800&auto=format&fit=crop' }} style={styles.bannerImage} />
                                <View style={styles.bannerOverlay} />
                                <View style={styles.industryTagWrap}>
                                    <Text style={styles.industryTagText}>LOGISTICS & SUPPLY CHAIN</Text>
                                </View>
                            </View>
                            <View style={styles.profileSection}>
                                <Image source={{ uri: selectedContact.logo }} style={styles.contactAvatarLg} />
                                <View style={styles.nameRow}>
                                    <Text style={styles.contactName}>{selectedContact.companyName}</Text>
                                    <View style={styles.verifiedBadge}><Text style={styles.verifiedIcon}>✓</Text></View>
                                </View>
                                <Text style={styles.contactRole}>Moving the world, one delivery at a time.</Text>
                            </View>

                            {/* Company Details */}
                            <View style={styles.detailsSection}>
                                <View style={styles.missionCard}>
                                    <View style={styles.sectionHeaderRow}>
                                        <Text style={styles.sectionIcon}>✨</Text>
                                        <Text style={styles.sectionTitle}>MISSION & VISION</Text>
                                    </View>
                                    <Text style={styles.missionText}>
                                        We are building the backbone of modern commerce. By integrating AI with a massive fleet network, we ensure fair pay for partners and lightning-fast logistics for businesses.
                                    </Text>
                                    <View style={styles.statsGrid}>
                                        <View style={styles.statBox}>
                                            <Text style={styles.statLabel}>INDUSTRY</Text>
                                            <Text style={styles.statValue}>Logistics & Supply Chain</Text>
                                        </View>
                                        <View style={styles.statBox}>
                                            <Text style={styles.statLabel}>GLOBAL HQ</Text>
                                            <Text style={styles.statValue}>Hyderabad, IN</Text>
                                        </View>
                                    </View>
                                </View>

                                {/* Products & Services */}
                                <View style={styles.productsCard}>
                                    <View style={styles.sectionHeaderRow}>
                                        <Ionicons name="briefcase-outline" size={18} color="#9333ea" style={{ marginRight: 6 }} />
                                        <Text style={styles.sectionTitle}>PRODUCTS & SERVICES</Text>
                                    </View>
                                    {PRODUCTS.map((p, i) => (
                                        <View key={i} style={styles.productRow}>
                                            <View style={styles.productIconBox}>
                                                <Text style={styles.productIconExt}>{p.icon}</Text>
                                            </View>
                                            <View style={styles.productInfo}>
                                                <Text style={styles.productName}>{p.name}</Text>
                                                <Text style={styles.productDesc}>{p.desc}</Text>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            {/* Withdraw Application */}
                            <TouchableOpacity style={styles.withdrawBtn} onPress={handleWithdraw} activeOpacity={0.8}>
                                <Text style={styles.withdrawText}>Withdraw Application</Text>
                            </TouchableOpacity>
                        </ScrollView>

                        {/* Floating Video Call Button */}
                        <TouchableOpacity style={styles.fabVideoBtn}>
                            <Ionicons name="videocam-outline" size={28} color="#fff" />
                        </TouchableOpacity>
                    </View>
                )}
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: { backgroundColor: '#7c3aed', paddingHorizontal: 20, paddingBottom: 16, zIndex: 10 },
    headerTitle: { fontSize: 24, fontWeight: '900', color: '#fff', marginBottom: 4 },
    headerSubtitle: { fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: '500', marginBottom: 16 },

    filterScroll: { paddingRight: 20, gap: 8 },
    filterPill: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
    filterPillActive: { backgroundColor: '#fff', borderColor: '#fff' },
    filterText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
    filterTextActive: { color: '#7c3aed' },

    listContent: { paddingBottom: 40, paddingTop: 8 },
    swipeContainer: { backgroundColor: '#fee2e2' },
    swipeBackground: { position: 'absolute', right: 24, top: 0, bottom: 0, justifyContent: 'center' },
    swipeText: { color: '#ef4444', fontWeight: '900', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 },
    swipeForeground: { backgroundColor: '#fff' },

    row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 20, paddingVertical: 16 },
    avatarWrap: { position: 'relative', marginRight: 16 },
    avatarImage: { width: 56, height: 56, borderRadius: 28, borderWidth: 1, borderColor: '#f1f5f9' },
    purpleDot: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, backgroundColor: '#22c55e', borderRadius: 7, borderWidth: 2, borderColor: '#fff' },

    rowContent: { flex: 1, justifyContent: 'center' },
    rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
    companyName: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
    timeText: { fontSize: 11, color: '#94a3b8', fontWeight: 'bold' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    jobTitle: { fontSize: 13, fontWeight: '700', color: '#7c3aed', flexShrink: 1 },
    statusBadge: { backgroundColor: '#f1f5f9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
    statusBadgeText: { fontSize: 9, fontWeight: '900', color: '#64748b', textTransform: 'uppercase' },
    lastMessage: { fontSize: 13, color: '#64748b', fontWeight: '500' },

    emptyState: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
    emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
    emptyEmoji: { fontSize: 40 },
    emptyTitle: { fontSize: 18, fontWeight: '900', color: '#0f172a', marginBottom: 8 },
    emptySubtitle: { fontSize: 14, color: '#64748b', textAlign: 'center', lineHeight: 20 },

    // Modal
    modalContainer: { flex: 1, backgroundColor: '#f8fafc' },
    modalScrollContent: { paddingBottom: 100 }, // Space for FAB
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#7c3aed', paddingTop: 20, paddingBottom: 16, paddingHorizontal: 16 },
    modalCloseBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    modalCloseText: { color: '#fff', fontSize: 24, fontWeight: '300' },
    modalTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
    bannerContainer: { height: 140, position: 'relative', backgroundColor: '#4c1d95' }, // Deeper purple base
    bannerImage: { width: '100%', height: '100%', opacity: 0.4 },
    bannerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(124, 58, 237, 0.2)' },
    industryTagWrap: { position: 'absolute', bottom: 16, left: 16, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', backdropFilter: 'blur(10px)' },
    industryTagText: { color: '#fff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },

    profileSection: { paddingHorizontal: 24, paddingBottom: 20, marginTop: -40, alignItems: 'center', zIndex: 10 },
    contactAvatarLg: { width: 96, height: 96, borderRadius: 32, borderWidth: 4, borderColor: '#fff', backgroundColor: '#fff', marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 10 },
    nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
    contactName: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
    verifiedBadge: { backgroundColor: '#e0e7ff', width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
    verifiedIcon: { color: '#4f46e5', fontSize: 12, fontWeight: '900' },
    contactRole: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 20 },

    // Details Section
    detailsSection: { paddingHorizontal: 20, gap: 20 },

    missionCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 2 },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
    sectionIcon: { fontSize: 16, marginRight: 8 },
    sectionTitle: { fontSize: 13, fontWeight: '900', color: '#0f172a', letterSpacing: 0.5 },
    missionText: { fontSize: 14, color: '#475569', lineHeight: 22, fontWeight: '500', marginBottom: 20 },

    statsGrid: { flexDirection: 'row', gap: 12 },
    statBox: { flex: 1, backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9' },
    statLabel: { fontSize: 10, fontWeight: '900', color: '#94a3b8', marginBottom: 4, letterSpacing: 1 },
    statValue: { fontSize: 14, fontWeight: '900', color: '#334155' },

    productsCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: '#f1f5f9', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 10, elevation: 2 },
    productRow: { flexDirection: 'row', gap: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
    productIconBox: { width: 48, height: 48, backgroundColor: '#fff', borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 1, borderWidth: 1, borderColor: '#f1f5f9' },
    productIconExt: { fontSize: 24 },
    productInfo: { flex: 1, justifyContent: 'center' },
    productName: { fontSize: 15, fontWeight: '900', color: '#1e293b', marginBottom: 2 },
    productDesc: { fontSize: 12, color: '#64748b', fontWeight: '500', lineHeight: 16 },

    withdrawBtn: { marginHorizontal: 20, marginTop: 24, paddingVertical: 16, backgroundColor: '#fee2e2', borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#fef2f2' },
    withdrawText: { color: '#ef4444', fontSize: 15, fontWeight: 'bold' },

    // FAB Video Call Button
    fabVideoBtn: { position: 'absolute', bottom: 30, right: 24, width: 64, height: 64, borderRadius: 32, backgroundColor: '#8b5cf6', justifyContent: 'center', alignItems: 'center', shadowColor: '#7c3aed', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 }
});
