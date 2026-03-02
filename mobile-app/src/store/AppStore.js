import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { AuthContext } from '../context/AuthContext';
import { getPrimaryRoleFromUser } from '../utils/roleMode';

const AppStoreContext = createContext(null);

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

export function AppStoreProvider({ children }) {
    const { userInfo } = useContext(AuthContext);

    const [user, setUserState] = useState(userInfo || null);
    const [role, setRoleState] = useState(getPrimaryRoleFromUser(userInfo));
    const [socketStatus, setSocketStatusState] = useState('disconnected');
    const [notificationsCount, setNotificationsCountState] = useState(0);
    const [activeChatId, setActiveChatIdState] = useState(null);
    const [isOnline, setIsOnlineState] = useState(true);
    const [featureFlags, setFeatureFlagsState] = useState({});

    useEffect(() => {
        setUserState(userInfo || null);
        setRoleState(getPrimaryRoleFromUser(userInfo));
    }, [userInfo]);

    useEffect(() => {
        const unsubscribe = NetInfo.addEventListener((state) => {
            setIsOnlineState(state.isConnected ?? true);
        });
        return unsubscribe;
    }, []);

    const setUser = useCallback((nextUser) => {
        setUserState(nextUser || null);
        setRoleState(getPrimaryRoleFromUser(nextUser));
    }, []);

    const setRole = useCallback((nextRole) => {
        setRoleState(normalizePrimaryRole(nextRole));
    }, []);

    const setSocketStatus = useCallback((nextStatus) => {
        setSocketStatusState(nextStatus || 'disconnected');
    }, []);

    const setNotificationsCount = useCallback((count) => {
        const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
        setNotificationsCountState(safeCount);
    }, []);

    const incrementNotificationsCount = useCallback((delta = 1) => {
        setNotificationsCountState((prev) => Math.max(0, prev + (Number.isFinite(delta) ? Math.floor(delta) : 1)));
    }, []);

    const setActiveChatId = useCallback((chatId) => {
        setActiveChatIdState(chatId || null);
    }, []);

    const clearActiveChatId = useCallback((chatId = null) => {
        setActiveChatIdState((prev) => {
            if (!chatId) return null;
            return String(prev) === String(chatId) ? null : prev;
        });
    }, []);

    const setIsOnline = useCallback((online) => {
        setIsOnlineState(Boolean(online));
    }, []);

    const setFeatureFlags = useCallback((flags = {}) => {
        if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
            setFeatureFlagsState({});
            return;
        }
        setFeatureFlagsState({ ...flags });
    }, []);

    const storeValue = useMemo(() => ({
        user,
        role,
        socketStatus,
        notificationsCount,
        activeChatId,
        isOnline,
        featureFlags,
        setUser,
        setRole,
        setSocketStatus,
        setNotificationsCount,
        incrementNotificationsCount,
        setActiveChatId,
        clearActiveChatId,
        setIsOnline,
        setFeatureFlags,
    }), [
        user,
        role,
        socketStatus,
        notificationsCount,
        activeChatId,
        isOnline,
        featureFlags,
        setUser,
        setRole,
        setSocketStatus,
        setNotificationsCount,
        incrementNotificationsCount,
        setActiveChatId,
        clearActiveChatId,
        setIsOnline,
        setFeatureFlags,
    ]);

    return (
        <AppStoreContext.Provider value={storeValue}>
            {children}
        </AppStoreContext.Provider>
    );
}

export function useAppStore() {
    const context = useContext(AppStoreContext);
    if (!context) {
        throw new Error('useAppStore must be used within AppStoreProvider');
    }
    return context;
}
