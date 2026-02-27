import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { BASE_URL } from '../config';
import { logger } from '../utils/logger';

class SocketService {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
    }

    async connect() {
        if (this.socket?.connected) return;

        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            let token = null;
            if (userInfoStr) {
                const userInfo = JSON.parse(userInfoStr);
                token = userInfo.token;
            }

            this.socket = io(BASE_URL, {
                transports: ['websocket'],
                auth: { token },
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
            });

            this.socket.on('connect', () => {
                logger.log('✅ Socket connected:', this.socket.id);
            });

            this.socket.on('connect_error', (error) => {
                logger.error('❌ Socket connection error:', error.message);
            });

            this.socket.on('disconnect', (reason) => {
                logger.log('Socket disconnected:', reason);
                if (reason === 'io server disconnect') {
                    // Reconnect if server disconnected
                    this.socket.connect();
                }
            });

            // Set up event listeners from map
            this.listeners.forEach((callback, event) => {
                this.socket.on(event, callback);
            });
        } catch (e) {
            logger.error('Socket secure store error:', e);
        }
    }

    on(event, callback) {
        this.listeners.set(event, callback);
        if (this.socket) {
            this.socket.on(event, callback);
        }
    }

    off(event) {
        this.listeners.delete(event);
        if (this.socket) {
            this.socket.off(event);
        }
    }

    emit(event, data) {
        if (!this.socket?.connected) {
            logger.warn('Socket not connected, reconnecting...');
            this.connect();
            // Wait a bit then emit
            setTimeout(() => {
                this.socket?.emit(event, data);
            }, 500);
        } else {
            this.socket.emit(event, data);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

export default new SocketService();
