import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { BASE_URL } from '../config';
import { logger } from '../utils/logger';

const MAX_PENDING_EMITS = 50;

class SocketService {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
        this.pendingEmits = [];
    }

    async connect() {
        if (this.socket?.connected) return;

        if (this.socket) {
            this.socket.connect();
            return;
        }

        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            let token = null;
            if (userInfoStr) {
                const userInfo = JSON.parse(userInfoStr);
                token = userInfo?.token || null;
            }

            this.socket = io(BASE_URL, {
                transports: ['websocket'],
                auth: { token },
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
            });

            this.socket.on('connect', () => {
                logger.log('Socket connected:', this.socket?.id);
                while (this.pendingEmits.length > 0 && this.socket?.connected) {
                    const next = this.pendingEmits.shift();
                    if (!next) break;
                    this.socket.emit(next.event, next.data);
                }
            });

            this.socket.on('connect_error', (error) => {
                logger.error('Socket connection error:', error?.message || error);
            });

            this.socket.on('disconnect', (reason) => {
                logger.log('Socket disconnected:', reason);
                if (reason === 'io server disconnect') {
                    this.socket?.connect();
                }
            });

            this.listeners.forEach((callbacks, event) => {
                callbacks.forEach((callback) => {
                    this.socket.on(event, callback);
                });
            });
        } catch (error) {
            logger.error('Socket setup failed:', error);
        }
    }

    on(event, callback) {
        if (!event || typeof callback !== 'function') return;
        const callbacks = this.listeners.get(event) || new Set();
        callbacks.add(callback);
        this.listeners.set(event, callbacks);
        if (this.socket) {
            this.socket.on(event, callback);
        }
    }

    off(event, callback) {
        if (!event) return;
        if (callback && typeof callback === 'function') {
            const callbacks = this.listeners.get(event);
            if (callbacks) {
                callbacks.delete(callback);
                if (callbacks.size === 0) {
                    this.listeners.delete(event);
                } else {
                    this.listeners.set(event, callbacks);
                }
            }
            this.socket?.off(event, callback);
            return;
        }

        this.listeners.delete(event);
        this.socket?.off(event);
    }

    emit(event, data) {
        if (!event) return;

        if (this.socket?.connected) {
            this.socket.emit(event, data);
            return;
        }

        if (this.pendingEmits.length >= MAX_PENDING_EMITS) {
            this.pendingEmits.shift();
        }
        this.pendingEmits.push({ event, data });
        void this.connect();
    }

    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.pendingEmits = [];
    }
}

export default new SocketService();
