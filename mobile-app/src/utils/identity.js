const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const DEFAULT_PHONE_COUNTRY_CODE = '91';
export const PHONE_IDENTITY_EMAIL_DOMAIN = 'example.com';

const stripSpaces = (value = '') => String(value).replace(/\s+/g, '');
const digitsOnly = (value = '') => String(value).replace(/\D/g, '');

const normalizePhoneDigits = (value, defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE) => {
    const digits = digitsOnly(value);
    if (!digits) return '';

    if (digits.length <= 10) {
        return `${defaultCountryCode}${digits}`.slice(0, 15);
    }

    return digits.slice(0, 15);
};

export const classifyIdentityInput = (
    value,
    {
        defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE,
        phoneIdentityEmailDomain = PHONE_IDENTITY_EMAIL_DOMAIN,
    } = {},
) => {
    const raw = String(value ?? '').trim();

    if (!raw) {
        return {
            type: 'unknown',
            raw: '',
            isValid: false,
            normalizedValue: '',
            backendEmail: '',
            alternateBackendEmail: '',
            phoneE164: '',
        };
    }

    const compact = stripSpaces(raw);
    const likelyEmail = compact.includes('@') || /[A-Za-z]/.test(compact);

    if (likelyEmail) {
        const normalizedEmail = compact.toLowerCase();
        return {
            type: 'email',
            raw,
            isValid: EMAIL_PATTERN.test(normalizedEmail),
            normalizedValue: normalizedEmail,
            backendEmail: normalizedEmail,
            alternateBackendEmail: '',
            phoneE164: '',
        };
    }

    const numericDigits = digitsOnly(compact);
    const normalizedPhoneDigits = normalizePhoneDigits(compact, defaultCountryCode);
    const isValidPhone = numericDigits.length >= 10 && numericDigits.length <= 15;

    const isDefaultCountryWithLocalDigits = normalizedPhoneDigits.startsWith(defaultCountryCode)
        && normalizedPhoneDigits.length === defaultCountryCode.length + 10;

    const compatibilityAliasDigits = isDefaultCountryWithLocalDigits
        ? normalizedPhoneDigits.slice(defaultCountryCode.length)
        : normalizedPhoneDigits;

    return {
        type: 'phone',
        raw,
        isValid: isValidPhone,
        normalizedValue: normalizedPhoneDigits,
        backendEmail: compatibilityAliasDigits
            ? `${compatibilityAliasDigits}@${phoneIdentityEmailDomain}`
            : '',
        alternateBackendEmail: normalizedPhoneDigits && compatibilityAliasDigits !== normalizedPhoneDigits
            ? `${normalizedPhoneDigits}@${phoneIdentityEmailDomain}`
            : '',
        phoneE164: normalizedPhoneDigits ? `+${normalizedPhoneDigits}` : '',
    };
};

export const formatPhoneForDisplay = (value, defaultCountryCode = DEFAULT_PHONE_COUNTRY_CODE) => {
    const normalized = normalizePhoneDigits(value, defaultCountryCode);
    if (!normalized) return '';

    const hasDefaultCountry = normalized.startsWith(defaultCountryCode);
    const countryCodeLength = hasDefaultCountry
        ? defaultCountryCode.length
        : Math.max(1, normalized.length - 10);

    const countryCode = normalized.slice(0, countryCodeLength);
    const local = normalized.slice(countryCodeLength);

    const chunks = [
        local.slice(0, 5),
        local.slice(5, 10),
        local.slice(10),
    ].filter(Boolean);

    return chunks.length ? `+${countryCode} ${chunks.join(' ')}` : `+${countryCode}`;
};

export const normalizeIdentityForSubmit = (value) => classifyIdentityInput(value);
