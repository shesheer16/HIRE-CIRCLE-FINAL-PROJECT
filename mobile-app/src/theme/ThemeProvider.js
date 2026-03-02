import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createTheme, designTokens } from './theme';

const THEME_MODE_KEY = '@hc_theme_mode';

const lightPalette = createTheme('light');
const darkPalette = createTheme('dark');

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [mode, setMode] = useState('light');

    useEffect(() => {
        let mounted = true;
        const bootstrap = async () => {
            try {
                const stored = await AsyncStorage.getItem(THEME_MODE_KEY);
                if (mounted && (stored === 'light' || stored === 'dark')) {
                    setMode(stored);
                }
            } catch (error) {
                // Optional personalization only.
            }
        };

        bootstrap();
        return () => { mounted = false; };
    }, []);

    const setThemeMode = useCallback(async (nextMode) => {
        const normalized = nextMode === 'dark' ? 'dark' : 'light';
        setMode(normalized);
        try {
            await AsyncStorage.setItem(THEME_MODE_KEY, normalized);
        } catch (error) {
            // Optional personalization only.
        }
    }, []);

    const toggleTheme = useCallback(() => {
        setThemeMode(mode === 'dark' ? 'light' : 'dark');
    }, [mode, setThemeMode]);

    const value = useMemo(() => ({
        mode,
        palette: mode === 'dark' ? darkPalette : lightPalette,
        setThemeMode,
        toggleTheme,
        tokens: designTokens,
        themes: {
            light: lightPalette,
            dark: darkPalette,
        },
    }), [mode, setThemeMode, toggleTheme]);

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used inside ThemeProvider');
    }
    return context;
}
