import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import client from '../api/client';
import { io } from "socket.io-client";
import * as SecureStore from 'expo-secure-store';

// Initialize Socket outside component to prevent re-creation
import { SOCKET_URL } from '../config';

// Initialize Socket outside component to prevent re-creation
// socket URL is now imported from config.js

export default function ChatScreen({ route, navigation }) {
    const { applicationId, otherPartyName } = route.params || {};
    const [applicationData, setApplicationData] = useState(null);
    const [receiverId, setReceiverId] = useState(null);

    // Restored State
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState(null);
    const socketRef = useRef(null);

    useEffect(() => {
        const initChat = async () => {
            try {
                // 1. Get User ID
                const userInfoStr = await SecureStore.getItemAsync('userInfo');
                let currentUserId = null;
                if (userInfoStr) {
                    const user = JSON.parse(userInfoStr);
                    setUserId(user._id);
                    currentUserId = user._id;
                }

                // 2. Fetch Application Details (for Receiver ID & Header Info)
                const appRes = await client.get(`/api/applications/${applicationId}`);
                if (appRes.data) {
                    setApplicationData(appRes.data);

                    // Determine Receiver
                    // If I am the worker, receiver is employer. If I am employer/recruiter, receiver is worker.
                    // Or strictly check IDs
                    if (currentUserId === appRes.data.worker._id) {
                        setReceiverId(appRes.data.employer._id);
                    } else {
                        setReceiverId(appRes.data.worker._id);
                    }
                }

                // 3. Load History
                const res = await client.get(`/api/chat/${applicationId}`);
                setMessages(res.data || []);

                // 4. Connect Socket
                socketRef.current = io(SOCKET_URL);
                socketRef.current.emit('joinRoom', { applicationId });

                socketRef.current.on('receiveMessage', (newMsg) => {
                    setMessages(prev => [newMsg, ...prev]);
                });

                // Handle message send failures
                socketRef.current.on('messageFailed', (data) => {
                    Alert.alert('Error', data.error || 'Failed to send message. Please try again.');
                });

            } catch (error) {
                console.error("Chat Init Error:", error);
            } finally {
                setLoading(false);
            }
        };

        if (applicationId) initChat();

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [applicationId]);

    const sendMessage = () => {
        if (!input.trim() || !userId || !receiverId) {
            console.log("Missing data:", { input, userId, receiverId });
            return;
        }

        // Emit to server
        socketRef.current.emit('sendMessage', {
            applicationId,
            senderId: userId,
            receiverId,
            text: input
        });

        setInput('');
    };

    const renderMessage = ({ item }) => {
        const isMe = item.sender._id === userId || item.sender === userId;

        return (
            <View style={[styles.msgContainer, isMe ? styles.myMsg : styles.otherMsg]}>
                <Text style={[styles.msgText, isMe ? styles.myText : styles.otherText]}>
                    {item.text}
                </Text>
                <Text style={[styles.timeText, isMe ? styles.myTime : styles.otherTime]}>
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
            </View>
        );
    };

    const getDisplayName = () => {
        if (otherPartyName) return otherPartyName;
        if (!applicationData || !userId) return 'Chat';

        // If I am worker, show Employer Name
        if (userId === applicationData.worker?._id) return applicationData.employer?.name;
        // If I am employer, show Worker Name
        return applicationData.worker?.firstName;
    };

    const displayName = getDisplayName();

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header - Purple Theme */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    onPress={() => navigation.navigate('CompanyDetails', { applicationId })}
                >
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{displayName?.[0] || '?'}</Text>
                    </View>
                    <View>
                        <Text style={styles.headerTitle}>{displayName}</Text>
                        <Text style={styles.headerSubtitle}>Tap for info</Text>
                    </View>
                </TouchableOpacity>
                <View style={styles.headerIcons}>
                    <TouchableOpacity style={styles.iconBtn}>
                        <Ionicons name="videocam" size={22} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn}>
                        <Ionicons name="call" size={22} color="#fff" />
                    </TouchableOpacity>
                </View>
            </View>

            {loading ? (
                <ActivityIndicator size="large" color="#7C3AED" style={{ flex: 1 }} />
            ) : (
                <FlatList
                    data={messages}
                    renderItem={renderMessage}
                    keyExtractor={item => item._id || item.id?.toString() || Math.random().toString()}
                    inverted // Latest messages at bottom (visually)
                    contentContainerStyle={{ padding: 16 }}
                />
            )}

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
                <View style={styles.inputBar}>
                    <TouchableOpacity style={styles.attachBtn}>
                        <Ionicons name="add" size={24} color="#7C3AED" />
                    </TouchableOpacity>
                    <TextInput
                        style={styles.input}
                        placeholder="Type a message..."
                        value={input}
                        onChangeText={setInput}
                        placeholderTextColor="#9CA3AF"
                    />
                    <TouchableOpacity onPress={sendMessage} style={styles.sendBtn}>
                        <Ionicons name="send" size={20} color="#fff" />
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F9FAFB' },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#6A0DAD', // Primary Purple
        paddingTop: Platform.OS === 'android' ? 40 : 16
    },
    backBtn: { marginRight: 12 },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12
    },
    avatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
    headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)' },
    headerIcons: { flexDirection: 'row', gap: 16 },
    iconBtn: { padding: 4 },

    // Messages
    msgContainer: { maxWidth: '80%', padding: 12, borderRadius: 16, marginVertical: 4 },
    myMsg: { alignSelf: 'flex-end', backgroundColor: '#6A0DAD', borderBottomRightRadius: 4 },
    otherMsg: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#E5E7EB' },

    msgText: { fontSize: 16 },
    myText: { color: '#fff' },
    otherText: { color: '#1F2937' },

    timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
    myTime: { color: 'rgba(255,255,255,0.7)' },
    otherTime: { color: '#9CA3AF' },

    // Input Bar
    inputBar: {
        flexDirection: 'row',
        padding: 12,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        alignItems: 'center'
    },
    attachBtn: { padding: 8, marginRight: 8 },
    input: {
        flex: 1,
        backgroundColor: '#F3F4F6',
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingVertical: 10,
        fontSize: 16,
        color: '#1F2937',
        marginRight: 12
    },
    sendBtn: {
        backgroundColor: '#6A0DAD',
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center'
    }
});