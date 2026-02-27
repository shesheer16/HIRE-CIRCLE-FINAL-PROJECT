export const COLORS = {
    primary: '#7c3aed',
    primaryLight: '#ede9fe',
    primaryDark: '#5b21b6',
    secondary: '#6366f1',
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#0f172a',
    textMuted: '#94a3b8',
    border: '#f1f5f9',
    error: '#ef4444',
    success: '#10b981',
    warning: '#f59e0b',
};

export const theme = {
    primary: '#7c3aed',
    primaryLight: '#ede9fe',
    primaryDark: '#5b21b6',
    background: '#f8fafc',
    surface: '#ffffff',
    border: '#f1f5f9',
    borderMedium: '#e2e8f0',
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    indigo: '#6366f1',
    chatBackground: '#f3e8ff',
    darkCard: '#0f172a',
};

export const TYPOGRAPHY = {
    h1: { fontSize: 32, fontWeight: '900', color: COLORS.text, letterSpacing: -0.5 },
    h2: { fontSize: 24, fontWeight: '900', color: COLORS.text, letterSpacing: -0.5 },
    h3: { fontSize: 18, fontWeight: '700', color: COLORS.text },
    body: { fontSize: 16, color: COLORS.text, lineHeight: 24 },
    bodySmall: { fontSize: 14, color: COLORS.textMuted, lineHeight: 20 },
    caption: { fontSize: 12, color: COLORS.textMuted, fontWeight: '500' },
};

export const SPACING = {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
};

export const RADIUS = {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
};

export const SHADOWS = {
    sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
    md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 4 },
    lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 10 },
};
