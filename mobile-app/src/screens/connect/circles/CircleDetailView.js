import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Image, ScrollView, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { IconCheck, IconMessageSquare, IconMic, IconPlus, IconSend, IconSparkles } from '../../../components/Icons';
import { RADIUS } from '../../../theme/theme';
import { connectPalette, connectShadow } from '../connectPalette';

const DETAIL_TABS = ['DISCUSSION', 'RATES', 'MEMBERS'];

function CircleDetailViewComponent({
    visible,
    selectedCircle,
    onClose,
    circleDetailTab,
    onTabChange,
    insetsTop,
    circleChatRef,
    chatText,
    onChatTextChange,
    isCircleRecording,
    circleMessages,
    onSendTextMessage,
    onToggleVoiceRecording,
    circleMembers,
    circleCustomRates,
    showCircleRateForm,
    circleRateService,
    circleRatePrice,
    onCircleRateServiceChange,
    onCircleRatePriceChange,
    onSubmitRate,
    onShowRateForm,
    onCancelRateForm,
}) {
    const rates = useMemo(
        () => ([...(selectedCircle?.rates || []), ...circleCustomRates]),
        [selectedCircle?.rates, circleCustomRates]
    );

    const renderTabButton = useCallback((tabKey) => {
        const isActive = circleDetailTab === tabKey;
        const label = tabKey === 'DISCUSSION' ? 'CHAT ROOM' : tabKey;

        return (
            <TouchableOpacity
                key={tabKey}
                style={[styles.tabButton, isActive && styles.tabButtonActive]}
                onPress={() => onTabChange(tabKey)}
                activeOpacity={0.9}
            >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
        );
    }, [circleDetailTab, onTabChange]);

    const rateRows = useMemo(() => (
        rates.map((item, index) => {
            const isLast = index === rates.length - 1;
            return (
                <View key={`${item.service}-${index}`} style={[styles.rateRow, isLast && styles.rateRowLast]}>
                    <Text style={styles.rateCol1}>{item.service}</Text>
                    <Text style={styles.rateCol2}>{item.price}</Text>
                </View>
            );
        })
    ), [rates]);

    const memberRows = useMemo(() => (
        circleMembers.map((item) => (
            <View key={item.id} style={styles.memberRow}>
                <View style={styles.memberAvatarWrap}>
                    <Image source={{ uri: item.avatar }} style={styles.memberAvatar} />
                    {item.isAdmin ? (
                        <View style={styles.adminBadge}>
                            <Text style={styles.adminBadgeText}>★</Text>
                        </View>
                    ) : null}
                </View>

                <View style={styles.memberMain}>
                    <Text style={styles.memberName}>{item.name}</Text>
                    <Text style={styles.memberSub}>{item.isAdmin ? 'Admin' : item.role}</Text>
                </View>

                <View style={styles.memberMsgBtn}>
                    <IconMessageSquare size={21} color={connectPalette.subtle} />
                </View>
            </View>
        ))
    ), [circleMembers]);

    return (
        <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
            <View style={styles.modalContainer}>
                {insetsTop ? <View style={{ height: insetsTop }} /> : null}

                <LinearGradient
                    colors={[connectPalette.accent, connectPalette.accentDark]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.headerGradient}
                >
                    <View style={styles.headerRow}>
                        <TouchableOpacity onPress={onClose} style={styles.backButton} activeOpacity={0.85}>
                            <Text style={styles.backIcon}>‹</Text>
                        </TouchableOpacity>

                        <Image
                            source={{ uri: `https://ui-avatars.com/api/?name=${selectedCircle?.name || 'HC'}&background=8b3dff&color=fff&rounded=true` }}
                            style={styles.headerAvatar}
                        />

                        <View style={styles.headerTextWrap}>
                            <Text style={styles.headerTitle}>{selectedCircle?.name || 'Community'}</Text>
                            <Text style={styles.headerSub}>{selectedCircle?.members || '0'} Members • {selectedCircle?.online || '0'} Online</Text>
                        </View>
                    </View>

                    <View style={styles.tabStrip}>
                        {DETAIL_TABS.map(renderTabButton)}
                    </View>
                </LinearGradient>

                <View style={styles.contentWrap}>
                    {circleDetailTab === 'DISCUSSION' ? (
                        <View style={styles.flex1}>
                            <ScrollView ref={circleChatRef} contentContainerStyle={styles.chatContent} showsVerticalScrollIndicator={false}>
                                <View style={styles.todayBadge}><Text style={styles.todayText}>TODAY</Text></View>
                                {circleMessages.length > 0 ? circleMessages.map((message) => (
                                    <View key={message.id} style={styles.messageBlock}>
                                        <View style={styles.messageMetaRow}>
                                            <Text style={styles.messageName}>{message.user}</Text>
                                            {message.isAdmin ? <IconCheck size={12} color={connectPalette.accent} /> : null}
                                            <Text style={styles.rolePill}>{message.isAdmin ? 'Admin' : message.role}</Text>
                                        </View>
                                        <View style={styles.messageBubble}>
                                            <Text style={styles.messageText}>{message.text}</Text>
                                        </View>
                                        <Text style={styles.messageTime}>{message.time}</Text>
                                    </View>
                                )) : (
                                    <View style={styles.emptyPanel}>
                                        <Text style={styles.emptyPanelTitle}>No messages yet.</Text>
                                        <Text style={styles.emptyPanelSubtitle}>Start the first conversation in this community.</Text>
                                    </View>
                                )}
                            </ScrollView>

                            <View style={styles.inputBar}>
                                <View style={styles.attachButton}>
                                    <IconPlus size={22} color={connectPalette.muted} />
                                </View>

                                <TextInput
                                    style={[styles.chatInput, isCircleRecording && styles.chatInputRecording]}
                                    placeholder={isCircleRecording ? 'Recording... tap mic to stop' : 'Ask for help or share updates...'}
                                    placeholderTextColor={connectPalette.subtle}
                                    value={chatText}
                                    onChangeText={onChatTextChange}
                                    editable={!isCircleRecording}
                                />

                                {chatText.length > 0 ? (
                                    <TouchableOpacity style={styles.micSendButton} onPress={onSendTextMessage} activeOpacity={0.88}>
                                        <IconSend size={17} color={connectPalette.surface} />
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity
                                        style={[styles.micSendButton, isCircleRecording && styles.micSendButtonRecording]}
                                        onPress={onToggleVoiceRecording}
                                        activeOpacity={0.88}
                                    >
                                        <IconMic size={20} color={connectPalette.surface} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    ) : null}

                    {circleDetailTab === 'RATES' ? (
                        <ScrollView contentContainerStyle={styles.sectionContent} showsVerticalScrollIndicator={false}>
                            <View style={styles.ratesBanner}>
                                <View style={styles.ratesBannerHead}>
                                    <IconSparkles size={15} color={connectPalette.warning} />
                                    <Text style={styles.ratesBannerTitle}>Community Rates</Text>
                                </View>
                                <Text style={styles.ratesBannerSub}>These are standard market rates sourced from community members. Use these to negotiate fair pay.</Text>
                            </View>

                            <View style={styles.ratesTable}>
                                <View style={styles.ratesHeader}>
                                    <Text style={styles.ratesHeaderCol1}>SERVICE / ITEM</Text>
                                    <Text style={styles.ratesHeaderCol2}>AVG. PRICE</Text>
                                </View>
                                {rateRows}
                            </View>

                            {showCircleRateForm ? (
                                <View style={styles.rateFormBox}>
                                    <Text style={styles.rateFormTitle}>SUGGEST A RATE</Text>
                                    <TextInput
                                        style={styles.rateFormInput}
                                        value={circleRateService}
                                        onChangeText={onCircleRateServiceChange}
                                        placeholder="Service name"
                                        placeholderTextColor={connectPalette.subtle}
                                    />
                                    <TextInput
                                        style={styles.rateFormInput}
                                        value={circleRatePrice}
                                        onChangeText={onCircleRatePriceChange}
                                        placeholder="Price (e.g. ₹450)"
                                        placeholderTextColor={connectPalette.subtle}
                                    />
                                    <View style={styles.rateActions}>
                                        <TouchableOpacity style={styles.rateSubmitBtn} onPress={onSubmitRate} activeOpacity={0.9}>
                                            <Text style={styles.rateSubmitBtnText}>SUBMIT</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={styles.rateCancelBtn} onPress={onCancelRateForm} activeOpacity={0.9}>
                                            <Text style={styles.rateCancelBtnText}>CANCEL</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                <TouchableOpacity style={styles.suggestRateBtn} onPress={onShowRateForm} activeOpacity={0.9}>
                                    <Text style={styles.suggestRateBtnText}>+ Suggest a Rate Change</Text>
                                </TouchableOpacity>
                            )}
                        </ScrollView>
                    ) : null}

                    {circleDetailTab === 'MEMBERS' ? (
                        <ScrollView contentContainerStyle={styles.sectionContent} showsVerticalScrollIndicator={false}>
                            <View style={styles.membersHeader}>
                                <Text style={styles.membersTitle}>Community Leaders</Text>
                                <Text style={styles.membersSortBadge}>Sorted by Karma</Text>
                            </View>

                            {memberRows.length > 0 ? memberRows : (
                                <View style={styles.emptyPanel}>
                                    <Text style={styles.emptyPanelTitle}>No members loaded.</Text>
                                </View>
                            )}
                        </ScrollView>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

export default memo(CircleDetailViewComponent);

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
        backgroundColor: connectPalette.page,
    },
    headerGradient: {
        paddingTop: 10,
        paddingBottom: 12,
        ...connectShadow,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    backButton: {
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    backIcon: {
        color: connectPalette.surface,
        fontSize: 34,
        lineHeight: 34,
        fontWeight: '300',
    },
    headerAvatar: {
        width: 50,
        height: 50,
        borderRadius: RADIUS.full,
        borderWidth: 3,
        borderColor: 'rgba(255,255,255,0.32)',
        marginRight: 10,
    },
    headerTextWrap: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: connectPalette.surface,
    },
    headerSub: {
        marginTop: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#e9dcff',
    },
    tabStrip: {
        marginHorizontal: 16,
        padding: 4,
        borderRadius: 16,
        backgroundColor: 'rgba(111,46,214,0.42)',
        flexDirection: 'row',
    },
    tabButton: {
        flex: 1,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
    },
    tabButtonActive: {
        backgroundColor: connectPalette.surface,
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    tabText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#f1e6ff',
        letterSpacing: 0.2,
    },
    tabTextActive: {
        color: connectPalette.accentDark,
    },
    contentWrap: {
        flex: 1,
        backgroundColor: connectPalette.page,
    },
    flex1: {
        flex: 1,
    },
    chatContent: {
        paddingHorizontal: 18,
        paddingTop: 14,
        paddingBottom: 16,
    },
    todayBadge: {
        alignSelf: 'center',
        backgroundColor: '#ced6e4',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 6,
        marginBottom: 16,
    },
    todayText: {
        color: '#4e5d74',
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.4,
    },
    messageBlock: {
        marginBottom: 14,
    },
    messageMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    messageName: {
        color: '#43526a',
        fontSize: 13,
        fontWeight: '800',
    },
    rolePill: {
        backgroundColor: '#e9eef6',
        color: '#8ea0b7',
        fontSize: 11,
        fontWeight: '700',
        borderRadius: 8,
        paddingHorizontal: 8,
        paddingVertical: 2,
        overflow: 'hidden',
    },
    messageBubble: {
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 12,
        ...connectShadow,
    },
    messageText: {
        color: '#253246',
        fontSize: 14,
        lineHeight: 22,
        fontWeight: '500',
    },
    messageTime: {
        marginTop: 6,
        color: '#8293ad',
        fontSize: 11,
        fontWeight: '600',
    },
    emptyPanel: {
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: RADIUS.lg,
        paddingHorizontal: 14,
        paddingVertical: 12,
        ...connectShadow,
    },
    emptyPanelTitle: {
        color: connectPalette.text,
        fontSize: 13,
        fontWeight: '800',
    },
    emptyPanelSubtitle: {
        marginTop: 4,
        color: connectPalette.muted,
        fontSize: 12,
        lineHeight: 18,
    },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: connectPalette.line,
        backgroundColor: connectPalette.surface,
    },
    attachButton: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.full,
        backgroundColor: '#e8edf6',
        justifyContent: 'center',
        alignItems: 'center',
    },
    chatInput: {
        flex: 1,
        backgroundColor: '#f0f3f9',
        borderColor: connectPalette.line,
        borderWidth: 1,
        borderRadius: RADIUS.full,
        paddingHorizontal: 14,
        paddingVertical: 10,
        color: '#364457',
        fontSize: 14,
    },
    chatInputRecording: {
        color: connectPalette.danger,
    },
    micSendButton: {
        width: 46,
        height: 46,
        borderRadius: RADIUS.full,
        backgroundColor: connectPalette.accent,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: connectPalette.accentDark,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 4,
    },
    micSendButtonRecording: {
        backgroundColor: connectPalette.danger,
    },
    sectionContent: {
        padding: 18,
        paddingBottom: 24,
    },
    ratesBanner: {
        backgroundColor: '#f4efdd',
        borderColor: '#ecd89f',
        borderWidth: 1,
        borderRadius: RADIUS.xl,
        padding: 14,
        marginBottom: 14,
    },
    ratesBannerHead: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    ratesBannerTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#90450d',
    },
    ratesBannerSub: {
        fontSize: 13,
        lineHeight: 20,
        color: '#b7520f',
    },
    ratesTable: {
        backgroundColor: connectPalette.surface,
        borderColor: connectPalette.lineStrong,
        borderWidth: 1,
        borderRadius: RADIUS.xl,
        overflow: 'hidden',
        marginBottom: 14,
        ...connectShadow,
    },
    ratesHeader: {
        flexDirection: 'row',
        backgroundColor: '#edf0f6',
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderBottomWidth: 1,
        borderBottomColor: connectPalette.lineStrong,
    },
    ratesHeaderCol1: {
        flex: 1,
        fontSize: 12,
        fontWeight: '800',
        color: '#637289',
    },
    ratesHeaderCol2: {
        fontSize: 12,
        fontWeight: '800',
        color: '#637289',
    },
    rateRow: {
        flexDirection: 'row',
        paddingHorizontal: 14,
        paddingVertical: 15,
        borderBottomWidth: 1,
        borderBottomColor: connectPalette.line,
    },
    rateRowLast: {
        borderBottomWidth: 0,
    },
    rateCol1: {
        flex: 1,
        fontSize: 15,
        fontWeight: '700',
        color: '#1c2538',
    },
    rateCol2: {
        fontSize: 15,
        fontWeight: '800',
        color: connectPalette.accent,
    },
    rateFormBox: {
        backgroundColor: '#f3ebff',
        borderWidth: 1,
        borderColor: '#dcc4ff',
        borderRadius: RADIUS.xl,
        padding: 14,
    },
    rateFormTitle: {
        fontSize: 11,
        fontWeight: '900',
        color: connectPalette.accentDark,
        letterSpacing: 0.8,
        marginBottom: 10,
    },
    rateFormInput: {
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        borderRadius: RADIUS.md,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: connectPalette.text,
        marginBottom: 10,
    },
    rateActions: {
        flexDirection: 'row',
        gap: 8,
    },
    rateSubmitBtn: {
        flex: 1,
        backgroundColor: connectPalette.accent,
        paddingVertical: 11,
        borderRadius: RADIUS.md,
        alignItems: 'center',
    },
    rateSubmitBtnText: {
        fontSize: 12,
        fontWeight: '900',
        color: connectPalette.surface,
    },
    rateCancelBtn: {
        paddingHorizontal: 14,
        paddingVertical: 11,
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.lineStrong,
        borderRadius: RADIUS.md,
        alignItems: 'center',
    },
    rateCancelBtnText: {
        fontSize: 12,
        fontWeight: '800',
        color: connectPalette.muted,
    },
    suggestRateBtn: {
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#d5b5ff',
        borderRadius: RADIUS.xl,
        alignItems: 'center',
        paddingVertical: 14,
    },
    suggestRateBtnText: {
        fontSize: 13,
        fontWeight: '800',
        color: connectPalette.accent,
    },
    membersHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
    },
    membersTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#182338',
    },
    membersSortBadge: {
        fontSize: 12,
        fontWeight: '700',
        color: '#91a1b8',
        backgroundColor: '#ebf0f7',
        borderRadius: RADIUS.md,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    memberRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: connectPalette.surface,
        borderWidth: 1,
        borderColor: connectPalette.line,
        borderRadius: RADIUS.xl,
        padding: 12,
        marginBottom: 10,
        ...connectShadow,
    },
    memberAvatarWrap: {
        position: 'relative',
        marginRight: 10,
    },
    memberAvatar: {
        width: 46,
        height: 46,
        borderRadius: RADIUS.full,
    },
    adminBadge: {
        position: 'absolute',
        right: -3,
        bottom: -3,
        width: 18,
        height: 18,
        borderRadius: RADIUS.full,
        backgroundColor: '#ffd500',
        borderWidth: 2,
        borderColor: connectPalette.surface,
        alignItems: 'center',
        justifyContent: 'center',
    },
    adminBadgeText: {
        fontSize: 9,
    },
    memberMain: {
        flex: 1,
    },
    memberName: {
        fontSize: 15,
        fontWeight: '800',
        color: '#172239',
    },
    memberSub: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: '600',
        color: '#61718c',
    },
    memberMsgBtn: {
        width: 38,
        height: 38,
        borderRadius: RADIUS.md,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f5f7fc',
    },
});
