import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { getPrimaryRoleFromUser } from '../utils/roleMode';

const normalizePrimaryRole = (roleValue) => {
    const normalized = String(roleValue || '').toLowerCase();
    if (normalized === 'employer' || normalized === 'recruiter' || normalized === 'admin') {
        return 'employer';
    }
    if (normalized === 'worker' || normalized === 'candidate') {
        return 'worker';
    }
    return null;
};

export const useAppStore = create((set) => ({
    user: null,
    role: null,
    socketStatus: 'disconnected',
    notificationsCount: 0,
    activeChatId: null,
    isOnline: true,
    featureFlags: {},

    setUser: (nextUser) => set({
        user: nextUser || null,
        role: getPrimaryRoleFromUser(nextUser)
    }),

    setRole: (nextRole) => set({
        role: normalizePrimaryRole(nextRole)
    }),

    setSocketStatus: (nextStatus) => set({
        socketStatus: nextStatus || 'disconnected'
    }),

    setNotificationsCount: (count) => set({
        notificationsCount: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    }),

    incrementNotificationsCount: (delta = 1) => set((state) => ({
        notificationsCount: Math.max(0, state.notificationsCount + (Number.isFinite(delta) ? Math.floor(delta) : 1))
    })),

    setActiveChatId: (chatId) => set({
        activeChatId: chatId || null
    }),

    clearActiveChatId: (chatId = null) => set((state) => {
        if (!chatId) return { activeChatId: null };
        return String(state.activeChatId) === String(chatId) ? { activeChatId: null } : {};
    }),

    setIsOnline: (online) => set({
        isOnline: Boolean(online)
    }),

    setFeatureFlags: (flags = {}) => set({
        featureFlags: (!flags || typeof flags !== 'object' || Array.isArray(flags)) ? {} : { ...flags }
    })
}));

let netInfoUnsubscribe = null;
export const initAppStoreListeners = () => {
    if (!netInfoUnsubscribe) {
        netInfoUnsubscribe = NetInfo.addEventListener((state) => {
            useAppStore.getState().setIsOnline(state.isConnected ?? true);
        });
    }
};
