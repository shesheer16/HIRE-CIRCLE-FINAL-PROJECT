const LegalConfig = require('../models/LegalConfig');

const FALLBACK_LEGAL_CONFIGS = {
    DEFAULT: {
        country: 'DEFAULT',
        termsURL: 'https://hirecircle.com/legal/terms',
        privacyURL: 'https://hirecircle.com/legal/privacy',
        complianceFlags: ['PRIVACY_BASELINE'],
    },
    IN: {
        country: 'IN',
        termsURL: 'https://hirecircle.com/in/legal/terms',
        privacyURL: 'https://hirecircle.com/in/legal/privacy',
        complianceFlags: ['DPDP_INDIA'],
    },
    US: {
        country: 'US',
        termsURL: 'https://hirecircle.com/us/legal/terms',
        privacyURL: 'https://hirecircle.com/us/legal/privacy',
        complianceFlags: ['CCPA'],
    },
    EU: {
        country: 'EU',
        termsURL: 'https://hirecircle.com/eu/legal/terms',
        privacyURL: 'https://hirecircle.com/eu/legal/privacy',
        complianceFlags: ['GDPR'],
    },
};

const normalizeCountry = (value, fallback = 'DEFAULT') => {
    const normalized = String(value || '').trim().toUpperCase();
    if (!normalized) return fallback;
    return normalized;
};

const getFallbackConfig = (country = 'DEFAULT') => {
    const normalized = normalizeCountry(country);
    return FALLBACK_LEGAL_CONFIGS[normalized] || FALLBACK_LEGAL_CONFIGS.DEFAULT;
};

const getLegalConfigForCountry = async (country) => {
    const normalizedCountry = normalizeCountry(country);

    const row = await LegalConfig.findOne({ country: normalizedCountry }).lean();
    if (row) return row;

    if (normalizedCountry.length === 2) {
        // EU-wide fallback from country code list is intentionally inferred.
        const euCountryCodes = new Set([
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
        ]);
        if (euCountryCodes.has(normalizedCountry)) {
            return getFallbackConfig('EU');
        }
    }

    return getFallbackConfig(normalizedCountry);
};

module.exports = {
    getLegalConfigForCountry,
};
