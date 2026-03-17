// ─────────────────────────────────────────────
// HireCircle Glass Layer — Instagram-Style Light
// White surfaces · Purple accents · Black text
// ─────────────────────────────────────────────
import { PALETTE } from './theme';

export const GLASS_PALETTE = {
    // Backgrounds
    bgTop:    '#FFFFFF',
    bgMid:    '#FAFAFA',
    bgBottom: '#F5F5F5',

    // Glow — purple only
    glowPurple:   'rgba(168,85,247,0.12)',
    glowDeep:     'rgba(124,58,237,0.08)',
    // Legacy names kept for backward compat
    glowLavender: 'rgba(168,85,247,0.12)',
    glowBlue:     'rgba(168,85,247,0.07)',
    glowRose:     'rgba(124,58,237,0.07)',

    // Surfaces — white glass
    surface:       'rgba(255,255,255,0.95)',
    surfaceStrong: 'rgba(255,255,255,0.99)',
    surfaceMuted:  'rgba(250,250,250,0.90)',
    surfaceLine:   '#DBDBDB',

    // Borders — Instagram gray
    border:       '#DBDBDB',
    borderStrong: '#C0C0C0',

    // Accent — purple
    accent:       '#A855F7',
    accentStrong: '#7C3AED',
    accentText:   '#7C3AED',
    accentSoft:   'rgba(168,85,247,0.10)',
    accentTint:   'rgba(168,85,247,0.06)',

    // Text — Instagram black
    text:       '#000000',
    textStrong: '#000000',
    textMuted:  '#737373',
    textSoft:   '#AAAAAA',

    // Semantic
    success: '#22c55e',
    danger:  '#ED4956',
};

export const GLASS_GRADIENTS = {
    screen:      [GLASS_PALETTE.bgTop, GLASS_PALETTE.bgMid, GLASS_PALETTE.bgBottom],
    accent:      ['#C084FC', GLASS_PALETTE.accent, GLASS_PALETTE.accentStrong],
    subtlePanel: ['rgba(255,255,255,1)', 'rgba(250,250,250,0.95)'],
    cardSurface: ['rgba(255,255,255,1)', 'rgba(245,245,245,0.95)'],
};

export const GLASS_SHADOWS = {
    card: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 4,
    },
    soft: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    accent: {
        shadowColor: '#A855F7',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
        elevation: 5,
    },
};

export const GLASS_SURFACES = {
    panel: {
        backgroundColor: GLASS_PALETTE.surfaceStrong,
        borderWidth: 0.5,
        borderColor: GLASS_PALETTE.border,
    },
    softPanel: {
        backgroundColor: GLASS_PALETTE.surface,
        borderWidth: 0.5,
        borderColor: GLASS_PALETTE.border,
    },
    input: {
        backgroundColor: '#FAFAFA',
        borderWidth: 1,
        borderColor: GLASS_PALETTE.border,
    },
    pill: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: GLASS_PALETTE.border,
    },
};
