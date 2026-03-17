// ─────────────────────────────────────────────
// HireCircle Design System — Instagram-Style
// White background · Black text · Purple accent
// Reference: Instagram, WhatsApp, Threads
// ─────────────────────────────────────────────

export const PALETTE = {
    // Backgrounds — Instagram white
    background:    '#FFFFFF',
    backgroundSoft: '#FAFAFA',
    surface:       '#FFFFFF',
    surface2:      '#F5F5F5',
    surface3:      '#EFEFEF',
    separator:     '#DBDBDB',

    // Text — Instagram black
    textPrimary:   '#000000',
    textSecondary: '#737373',
    textTertiary:  '#AAAAAA',
    textInverted:  '#FFFFFF',

    // Accent — brand purple
    accent:        '#A855F7',
    accentDeep:    '#7C3AED',
    accentMid:     '#9333EA',
    accentSoft:    'rgba(168,85,247,0.10)',
    accentTint:    'rgba(168,85,247,0.06)',
    accentBorder:  'rgba(168,85,247,0.30)',

    // Semantic
    error:         '#ED4956',
    errorSoft:     'rgba(237,73,86,0.10)',
    success:       '#22c55e',
    successSoft:   'rgba(34,197,94,0.10)',
    warning:       '#F59E0B',

    // Borders — Instagram hairline
    border:        '#DBDBDB',
    borderLight:   '#EFEFEF',
    borderMedium:  '#DBDBDB',

    // Overlay (for modals, sheets)
    overlay:       'rgba(0,0,0,0.50)',
    overlayLight:  'rgba(0,0,0,0.25)',

    // Chat
    chatBubbleMe:    'rgba(168,85,247,0.12)',
    chatBubbleOther: '#F5F5F5',
};

// COLOR_ROLES — kept for backward compat, always light
export const COLOR_ROLES = {
    light: {
        primary:            PALETTE.accent,
        primarySoft:        PALETTE.accentSoft,
        primaryStrong:      PALETTE.accentDeep,
        secondary:          PALETTE.accentDeep,
        accent:             PALETTE.accent,
        background:         PALETTE.background,
        backgroundElevated: PALETTE.surface,
        surface:            PALETTE.surface,
        surfaceMuted:       PALETTE.surface2,
        text:               PALETTE.textPrimary,
        textMuted:          PALETTE.textSecondary,
        textSubtle:         PALETTE.textTertiary,
        border:             PALETTE.border,
        borderStrong:       PALETTE.borderMedium,
        success:            PALETTE.success,
        warning:            PALETTE.warning,
        danger:             PALETTE.error,
        overlay:            PALETTE.overlay,
        chatBubbleMe:       PALETTE.chatBubbleMe,
        chatBubbleOther:    PALETTE.chatBubbleOther,
    },
    dark: {
        primary:            PALETTE.accent,
        primarySoft:        PALETTE.accentSoft,
        primaryStrong:      PALETTE.accentDeep,
        secondary:          PALETTE.accentDeep,
        accent:             PALETTE.accent,
        background:         PALETTE.background,
        backgroundElevated: PALETTE.surface,
        surface:            PALETTE.surface,
        surfaceMuted:       PALETTE.surface2,
        text:               PALETTE.textPrimary,
        textMuted:          PALETTE.textSecondary,
        textSubtle:         PALETTE.textTertiary,
        border:             PALETTE.border,
        borderStrong:       PALETTE.borderMedium,
        success:            PALETTE.success,
        warning:            PALETTE.warning,
        danger:             PALETTE.error,
        overlay:            PALETTE.overlay,
        chatBubbleMe:       PALETTE.chatBubbleMe,
        chatBubbleOther:    PALETTE.chatBubbleOther,
    },
};

export const COLORS = {
    primary:          PALETTE.accent,
    primaryLight:     PALETTE.accentSoft,
    primaryDark:      PALETTE.accentDeep,
    secondary:        PALETTE.accentDeep,
    background:       PALETTE.background,
    surface:          PALETTE.surface,
    text:             PALETTE.textPrimary,
    textMuted:        PALETTE.textSecondary,
    border:           PALETTE.border,
    error:            PALETTE.error,
    success:          PALETTE.success,
    warning:          PALETTE.warning,
    tierStrong:       PALETTE.success,
    tierGood:         PALETTE.accent,
    tierPossible:     PALETTE.warning,
    destructiveMuted: PALETTE.error,
};

export const SPACING = {
    xxs:  2,
    xs:   4,
    sm:   8,
    smd:  12,
    md:   16,
    lg:   24,
    xl:   32,
    xxl:  40,
    xxxl: 52,
};

export const RADIUS = {
    xs:   4,
    sm:   8,
    md:   12,
    lg:   16,
    xl:   20,
    xxl:  28,
    full: 9999,
};

export const SHADOWS = {
    sm: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2,
    },
    md: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.10,
        shadowRadius: 10,
        elevation: 4,
    },
    lg: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 18,
        elevation: 7,
    },
    xl: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.14,
        shadowRadius: 26,
        elevation: 10,
    },
    accent: {
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.28,
        shadowRadius: 14,
        elevation: 5,
    },
};

export const SCREEN_CHROME = {
    headerSurface: {
        backgroundColor: PALETTE.background,
        borderBottomWidth: 0.5,
        borderBottomColor: PALETTE.separator,
    },
    actionButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionButtonPrimary: {
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentSoft,
    },
    heroSurface: {
        backgroundColor: PALETTE.surface,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: PALETTE.border,
        ...SHADOWS.md,
    },
    contentCard: {
        backgroundColor: PALETTE.surface,
        borderRadius: 16,
        borderWidth: 0.5,
        borderColor: PALETTE.border,
        ...SHADOWS.sm,
    },
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: PALETTE.border,
        backgroundColor: PALETTE.surface2,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    signalChipAccent: {
        borderColor: PALETTE.accentBorder,
        backgroundColor: PALETTE.accentSoft,
    },
    signalChipSuccess: {
        borderColor: PALETTE.success,
        backgroundColor: PALETTE.successSoft,
    },
    metricTile: {
        flex: 1,
        backgroundColor: PALETTE.surface2,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: PALETTE.border,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
};

export const SCREEN_CHROME = {
    headerSurface: {
        backgroundColor: '#f6f8fc',
        borderBottomWidth: 1,
        borderBottomColor: '#e8edf5',
    },
    actionButton: {
        width: 42,
        height: 42,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: 'rgba(255,255,255,0.97)',
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.sm,
    },
    actionButtonPrimary: {
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
    },
    heroSurface: {
        backgroundColor: 'rgba(255,255,255,0.97)',
        borderRadius: 26,
        borderWidth: 1,
        borderColor: '#e6ebf3',
        ...SHADOWS.md,
    },
    contentCard: {
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#e7ecf4',
        ...SHADOWS.md,
    },
    signalChip: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: '#e5eaf2',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    signalChipAccent: {
        borderColor: '#ddd6fe',
        backgroundColor: '#f5f3ff',
    },
    signalChipSuccess: {
        borderColor: '#bbf7d0',
        backgroundColor: '#f0fdf4',
    },
    metricTile: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#edf1f7',
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
};

export const TYPOGRAPHY = {
    display:   { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, lineHeight: 40, color: PALETTE.textPrimary },
    h1:        { fontSize: 30, fontWeight: '700', color: PALETTE.textPrimary, letterSpacing: -0.5 },
    h2:        { fontSize: 24, fontWeight: '700', color: PALETTE.textPrimary, letterSpacing: -0.3 },
    h3:        { fontSize: 20, fontWeight: '600', color: PALETTE.textPrimary, letterSpacing: -0.2 },
    title:     { fontSize: 17, fontWeight: '600', color: PALETTE.textPrimary, lineHeight: 22 },
    body:      { fontSize: 14, fontWeight: '400', color: PALETTE.textPrimary, lineHeight: 20 },
    bodySmall: { fontSize: 13, fontWeight: '400', color: PALETTE.textSecondary, lineHeight: 18 },
    caption:   { fontSize: 12, fontWeight: '400', color: PALETTE.textSecondary, lineHeight: 16 },
    micro:     { fontSize: 10, fontWeight: '600', color: PALETTE.textTertiary, letterSpacing: 0.3 },
};

export const ANIMATION = {
    instant:         80,
    fast:            120,
    normal:          180,
    slow:            260,
    springStiffness: 210,
    springDamping:   18,
};

export const createTheme = (mode = 'light') => {
    const role = COLOR_ROLES.light; // Always Instagram-style light
    return {
        mode: 'light',
        ...role,
        primaryLight:  role.primarySoft,
        primaryDark:   role.primaryStrong,
        borderMedium:  role.borderStrong,
        textPrimary:   role.text,
        textSecondary: role.textMuted,
        textMuted:     role.textSubtle,
        error:         role.danger,
        indigo:        role.secondary,
        chatBackground: role.chatBubbleMe,
        darkCard:      PALETTE.textPrimary,
        tierStrong:    COLORS.tierStrong,
        tierGood:      COLORS.tierGood,
        tierPossible:  COLORS.tierPossible,
        // Extended tokens
        surface2:      PALETTE.surface2,
        surface3:      PALETTE.surface3,
        separator:     PALETTE.separator,
        accent:        PALETTE.accent,
        accentDeep:    PALETTE.accentDeep,
        accentMid:     PALETTE.accentMid,
        accentSoft:    PALETTE.accentSoft,
        accentTint:    PALETTE.accentTint,
        accentBorder:  PALETTE.accentBorder,
        textInverted:  PALETTE.textInverted,
        overlayLight:  PALETTE.overlayLight,
        backgroundSoft: PALETTE.backgroundSoft,
    };
};

export const theme = createTheme('light');

export const designTokens = {
    colorRoles: COLOR_ROLES,
    spacing:    SPACING,
    radius:     RADIUS,
    shadows:    SHADOWS,
    typography: TYPOGRAPHY,
    animation:  ANIMATION,
    palette:    PALETTE,
};
