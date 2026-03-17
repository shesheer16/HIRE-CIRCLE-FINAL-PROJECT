import { resolveSelectedRoleSession } from './authRoleSelection';

const PREVIEW_SESSION_TOKEN = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjQxMDI0NDQ4MDAsInN1YiI6InByZXZpZXctdXNlciJ9.preview';
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export const isInstantPreviewAuthEnabled = () => {
    const rawValue = String(
        process.env.EXPO_PUBLIC_PREFER_LOCAL_PREVIEW_AUTH ?? (__DEV__ ? 'true' : 'false')
    ).trim().toLowerCase();

    return !FALSE_VALUES.has(rawValue);
};

const buildPreviewName = ({ selectedRole = 'worker', email = '', phoneNumber = '', name = '' } = {}) => {
    const explicitName = String(name || '').trim();
    if (explicitName) return explicitName;

    const safeEmail = String(email || '').trim().toLowerCase();
    if (safeEmail.includes('@')) {
        const localPart = safeEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
        if (localPart) {
            return localPart
                .split(/\s+/)
                .filter(Boolean)
                .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
                .join(' ');
        }
    }

    const safePhone = String(phoneNumber || '').replace(/\D/g, '');
    if (safePhone.length >= 4) {
        const suffix = safePhone.slice(-4);
        return selectedRole === 'worker' ? `Preview User ${suffix}` : `Preview Team ${suffix}`;
    }

    return selectedRole === 'worker' ? 'Preview User' : 'Preview Recruiter';
};

export const buildPreviewAuthSession = ({
    selectedRole = 'worker',
    email = '',
    phoneNumber = '',
    name = '',
    hasCompletedProfile = true,
    profileComplete = hasCompletedProfile,
    extra = {},
} = {}) => {
    const session = resolveSelectedRoleSession(selectedRole);
    const resolvedName = buildPreviewName({ selectedRole: session.requestedActiveRole, email, phoneNumber, name });

    return {
        _id: `preview-${session.accountMode}`,
        name: resolvedName,
        firstName: resolvedName.split(/\s+/).filter(Boolean)[0] || resolvedName,
        lastName: resolvedName.split(/\s+/).slice(1).join(' '),
        email: String(email || '').trim().toLowerCase(),
        phoneNumber: String(phoneNumber || '').trim(),
        token: PREVIEW_SESSION_TOKEN,
        refreshToken: `preview-refresh-${session.accountMode}`,
        role: session.requestedActiveRole === 'employer' ? 'recruiter' : 'candidate',
        activeRole: session.requestedActiveRole,
        primaryRole: session.requestedActiveRole,
        roles: session.defaultRoles,
        accountMode: session.accountMode,
        hasSelectedRole: true,
        hasCompletedProfile: Boolean(hasCompletedProfile),
        profileComplete: Boolean(profileComplete),
        isVerified: true,
        previewMode: true,
        ...extra,
    };
};
