import React, { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAppState } from '../context/AppStateContext';

export function useRefreshOnFocus(refetchFunction, dependencyKey) {
    const { state, dispatch } = useAppState();

    useFocusEffect(
        useCallback(() => {
            let isActive = true;

            const fetchIfNeeded = async () => {
                if (state.refreshNeeded[dependencyKey]) {
                    await refetchFunction();
                    if (isActive) {
                        // Dispatch an action to clear the refresh flag if needed, 
                        // but usually letting it be is fine until next component unmount/remount
                        dispatch({ type: 'CLEAR_REFRESH', payload: { screen: dependencyKey } });
                    }
                }
            };

            fetchIfNeeded();

            return () => {
                isActive = false;
            };
        }, [state.refreshNeeded[dependencyKey], refetchFunction, dispatch, dependencyKey])
    );
}
