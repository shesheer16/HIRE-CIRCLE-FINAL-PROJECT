export const GLASS_PALETTE = {
    bgTop: '#fbfcff',
    bgMid: '#f5f7ff',
    bgBottom: '#eef2ff',
    glowLavender: 'rgba(146, 115, 255, 0.20)',
    glowBlue: 'rgba(102, 180, 255, 0.16)',
    glowRose: 'rgba(255, 183, 216, 0.16)',
    surface: 'rgba(255, 255, 255, 0.74)',
    surfaceStrong: 'rgba(255, 255, 255, 0.88)',
    surfaceMuted: 'rgba(248, 250, 255, 0.72)',
    surfaceLine: 'rgba(255, 255, 255, 0.72)',
    border: 'rgba(132, 150, 196, 0.18)',
    borderStrong: 'rgba(146, 165, 211, 0.24)',
    accent: '#6f4ef6',
    accentStrong: '#5a3de8',
    accentText: '#5331cf',
    accentSoft: '#ede8ff',
    accentTint: 'rgba(111, 78, 246, 0.14)',
    text: '#172033',
    textStrong: '#0f172a',
    textMuted: '#66758f',
    textSoft: '#8c98ae',
    success: '#109a70',
    danger: '#d24b68',
};

export const GLASS_GRADIENTS = {
    screen: [GLASS_PALETTE.bgTop, GLASS_PALETTE.bgMid, GLASS_PALETTE.bgBottom],
    accent: ['#8b6cff', GLASS_PALETTE.accent, GLASS_PALETTE.accentStrong],
    subtlePanel: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.74)'],
};

export const GLASS_SHADOWS = {
    card: {
        shadowColor: '#7c8bb6',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.12,
        shadowRadius: 28,
        elevation: 8,
    },
    soft: {
        shadowColor: '#7c8bb6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.09,
        shadowRadius: 18,
        elevation: 4,
    },
    accent: {
        shadowColor: GLASS_PALETTE.accent,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
        elevation: 6,
    },
};

export const GLASS_SURFACES = {
    panel: {
        backgroundColor: GLASS_PALETTE.surfaceStrong,
        borderWidth: 1,
        borderColor: GLASS_PALETTE.surfaceLine,
    },
    softPanel: {
        backgroundColor: GLASS_PALETTE.surface,
        borderWidth: 1,
        borderColor: GLASS_PALETTE.surfaceLine,
    },
    input: {
        backgroundColor: 'rgba(250, 252, 255, 0.82)',
        borderWidth: 1,
        borderColor: GLASS_PALETTE.border,
    },
    pill: {
        backgroundColor: 'rgba(255, 255, 255, 0.72)',
        borderWidth: 1,
        borderColor: GLASS_PALETTE.surfaceLine,
    },
};
