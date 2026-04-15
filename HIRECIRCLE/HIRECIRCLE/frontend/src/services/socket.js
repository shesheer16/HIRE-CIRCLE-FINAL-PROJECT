import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { SOCKET_URL } from '../config';
import { logger } from '../utils/logger';

const MAX_PENDING_EMITS = 50;

class SocketService {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
        this.pendingEmits = [];
        this.lastToken = null;
    }

    async getToken() {
        try {
            const userInfoStr = await SecureStore.getItemAsync('userInfo');
            if (!userInfoStr) return null;
            const userInfo = JSON.parse(userInfoStr);
            const token = String(userInfo?.token || '').trim();
            return token || null;
        } catch (error) {
            logger.warn('Socket token read failed:', error?.message || error);
            return null;
        }
    }

    async connect() {
        if (this.socket?.connected) return;

        const token = await this.getToken();
        if (!token) {
            return;
        }

        if (this.socket) {
            this.socket.auth = { token };
            this.socket.connect();
            return;
        }

        try {
            this.lastToken = token;

            this.socket = io(SOCKET_URL, {
                transports: ['websocket', 'polling'],
                auth: { token },
                timeout: 10000,
                autoConnect: false,
                reconnection: true,
                reconnectionAttempts: 8,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
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
                const message = String(error?.message || 'socket connect error');
                // AUTH_REQUIRED should stop retry spam until token refresh/bootstrap updates the session.
                if (message === 'AUTH_REQUIRED') {
                    this.socket?.disconnect();
                    return;
                }
                // Suppress transient transport noise in mobile clients; reconnect strategy remains active.
                const description = String(
                    typeof error?.description === 'string'
                        ? error.description
                        : (error?.description?.message || '')
                ).toLowerCase();
                const normalized = message.toLowerCase();
                const isTransportNoise = (
                    normalized.includes('websocket error')
                    || normalized.includes('transport error')
                    || normalized.includes('xhr poll error')
                    || description.includes('websocket')
                    || description.includes('transport')
                    || description.includes('poll')
                );
                if (isTransportNoise) return;
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

            this.socket.connect();
        } catch (error) {
            logger.warn('Socket setup failed:', error?.message || error);
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

    emit(event, data, ack) {
        if (!event) return;

        if (this.socket?.connected) {
            if (ack) {
                this.socket.emit(event, data, ack);
            } else {
                this.socket.emit(event, data);
            }
            return;
        }

        if (ack) {
            ack({ ok: false, message: 'Socket not connected' });
            return;
        }

        if (this.pendingEmits.length >= MAX_PENDING_EMITS) {
            this.pendingEmits.shift();
        }
        this.pendingEmits.push({ event, data });
        void this.connect();
    }

    isConnected() {
        return Boolean(this.socket?.connected);
    }

    disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.disconnect();
            this.socket = null;
        }
        this.lastToken = null;
        this.pendingEmits = [];
    }
}

export default new SocketService();
