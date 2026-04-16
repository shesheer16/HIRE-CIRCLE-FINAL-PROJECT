import React, { createContext, useContext, useReducer } from 'react';

const AppStateContext = createContext();

const initialState = {
    jobs: [],
    applications: [],
    notifications: [],
    profile: null,
    refreshNeeded: {}
};

function appStateReducer(state, action) {
    switch (action.type) {
        case 'UPDATE_JOB':
            return {
                ...state,
                jobs: state.jobs.map(job =>
                    job._id === action.payload._id ? action.payload : job
                ),
                refreshNeeded: { ...state.refreshNeeded, jobs: Date.now() }
            };
        case 'ADD_APPLICATION':
            return {
                ...state,
                applications: [action.payload, ...state.applications],
                refreshNeeded: { ...state.refreshNeeded, employerApplications: Date.now(), applications: Date.now() }
            };
        case 'UPDATE_NOTIFICATION_READ':
            return {
                ...state,
                notifications: state.notifications.map(n =>
                    n._id === action.payload ? { ...n, read: true } : n
                )
            };
        case 'MARK_REFRESH_NEEDED':
            return {
                ...state,
                refreshNeeded: { ...state.refreshNeeded, [action.payload.screen]: Date.now() }
            };
        case 'CLEAR_REFRESH':
            return {
                ...state,
                refreshNeeded: { ...state.refreshNeeded, [action.payload.screen]: null }
            };
        default:
            return state;
    }
}

export function AppStateProvider({ children }) {
    const [state, dispatch] = useReducer(appStateReducer, initialState);

    return (
        <AppStateContext.Provider value={{ state, dispatch }}>
            {children}
        </AppStateContext.Provider>
    );
}

export function useAppState() {
    const context = useContext(AppStateContext);
    if (!context) {
        throw new Error('useAppState must be used within AppStateProvider');
    }
    return context;
}
