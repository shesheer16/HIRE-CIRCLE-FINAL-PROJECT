export const COLOR_ROLES = {
    light: {
        primary: '#2f5fff',
        primarySoft: '#eaf0ff',
        primaryStrong: '#1f46cc',
        secondary: '#1e40af',
        accent: '#4f46e5',
        background: '#f4f7fc',
        backgroundElevated: '#fbfcff',
        surface: '#ffffff',
        surfaceMuted: '#f8fafc',
        text: '#0f172a',
        textMuted: '#64748b',
        textSubtle: '#94a3b8',
        border: '#e2e8f0',
        borderStrong: '#cbd5e1',
        success: '#0f9d67',
        warning: '#c68a1c',
        danger: '#b45359',
        overlay: 'rgba(15, 23, 42, 0.46)',
        chatBubbleMe: '#e9edff',
        chatBubbleOther: '#ffffff',
    },
    dark: {
        primary: '#60a5fa',
        primarySoft: '#1e3a8a',
        primaryStrong: '#93c5fd',
        secondary: '#38bdf8',
        accent: '#818cf8',
        background: '#070f1f',
        backgroundElevated: '#0a1224',
        surface: '#0f172a',
        surfaceMuted: '#111d35',
        text: '#f8fafc',
        textMuted: '#cbd5e1',
        textSubtle: '#94a3b8',
        border: '#1e293b',
        borderStrong: '#334155',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#fb7185',
        overlay: 'rgba(2, 6, 23, 0.65)',
        chatBubbleMe: '#1e3a8a',
        chatBubbleOther: '#111827',
    },
};

export const COLORS = {
    primary: COLOR_ROLES.light.primary,
    primaryLight: COLOR_ROLES.light.primarySoft,
    primaryDark: COLOR_ROLES.light.primaryStrong,
    secondary: COLOR_ROLES.light.secondary,
    background: COLOR_ROLES.light.background,
    surface: COLOR_ROLES.light.surface,
    text: COLOR_ROLES.light.text,
    textMuted: COLOR_ROLES.light.textMuted,
    border: COLOR_ROLES.light.border,
    error: COLOR_ROLES.light.danger,
    success: COLOR_ROLES.light.success,
    warning: COLOR_ROLES.light.warning,
    tierStrong: '#0f9d67',
    tierGood: '#2563eb',
    tierPossible: '#c68a1c',
    destructiveMuted: '#b45359',
};

export const SPACING = {
    xxs: 2,
    xs: 4,
    sm: 8,
    smd: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 40,
    xxxl: 52,
};

export const RADIUS = {
    xs: 6,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 28,
    full: 9999,
};

export const SHADOWS = {
    sm: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
    },
    md: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 3,
    },
    lg: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 6,
    },
    xl: {
        shadowColor: '#0f172a',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.1,
        shadowRadius: 26,
        elevation: 10,
    },
};

export const TYPOGRAPHY = {
    display: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, lineHeight: 40, color: COLORS.text },
    h1: { fontSize: 32, fontWeight: '700', color: COLORS.text, letterSpacing: -0.4 },
    h2: { fontSize: 24, fontWeight: '700', color: COLORS.text, letterSpacing: -0.2 },
    h3: { fontSize: 20, fontWeight: '600', color: COLORS.text, letterSpacing: -0.1 },
    title: { fontSize: 18, fontWeight: '600', color: COLORS.text, lineHeight: 24 },
    body: { fontSize: 15, fontWeight: '400', color: COLORS.text, lineHeight: 22 },
    bodySmall: { fontSize: 13, fontWeight: '400', color: COLORS.textMuted, lineHeight: 19 },
    caption: { fontSize: 12, fontWeight: '500', color: COLORS.textMuted, lineHeight: 16 },
    micro: { fontSize: 10, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 0.3 },
};

export const ANIMATION = {
    instant: 80,
    fast: 120,
    normal: 180,
    slow: 260,
    springStiffness: 210,
    springDamping: 18,
};

export const createTheme = (mode = 'light') => {
    const role = mode === 'dark' ? COLOR_ROLES.dark : COLOR_ROLES.light;
    return {
        mode,
        ...role,
        primaryLight: role.primarySoft,
        primaryDark: role.primaryStrong,
        borderMedium: role.borderStrong,
        textPrimary: role.text,
        textSecondary: role.textMuted,
        textMuted: role.textSubtle,
        error: role.danger,
        indigo: role.secondary,
        chatBackground: role.chatBubbleMe,
        darkCard: mode === 'dark' ? '#020817' : '#0f172a',
        tierStrong: COLORS.tierStrong,
        tierGood: COLORS.tierGood,
        tierPossible: COLORS.tierPossible,
    };
};

export const theme = createTheme('light');

export const designTokens = {
    colorRoles: COLOR_ROLES,
    spacing: SPACING,
    radius: RADIUS,
    shadows: SHADOWS,
    typography: TYPOGRAPHY,
    animation: ANIMATION,
};
