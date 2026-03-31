const COUNTRY_LOCALE_MAP = {
    IN: { currencyCode: 'INR', languageCode: 'en-IN', defaultRegion: 'IN-GENERAL' },
    US: { currencyCode: 'USD', languageCode: 'en-US', defaultRegion: 'US-GENERAL' },
    GB: { currencyCode: 'GBP', languageCode: 'en-GB', defaultRegion: 'GB-GENERAL' },
    CA: { currencyCode: 'CAD', languageCode: 'en-CA', defaultRegion: 'CA-GENERAL' },
    SG: { currencyCode: 'SGD', languageCode: 'en-SG', defaultRegion: 'SG-GENERAL' },
    AE: { currencyCode: 'AED', languageCode: 'en-AE', defaultRegion: 'AE-GENERAL' },
};

const REGION_KEYWORD_MAP = {
    bengaluru: 'IN-KA',
    bangalore: 'IN-KA',
    hyderabad: 'IN-TG',
    mumbai: 'IN-MH',
    pune: 'IN-MH',
    chennai: 'IN-TN',
    delhi: 'IN-DL',
    gurgaon: 'IN-HR',
    gurugram: 'IN-HR',
    noida: 'IN-UP',
    kolkata: 'IN-WB',
    sanfrancisco: 'US-CA',
    "san francisco": 'US-CA',
    newyork: 'US-NY',
    "new york": 'US-NY',
    austin: 'US-TX',
    seattle: 'US-WA',
    london: 'GB-LON',
    toronto: 'CA-ON',
    dubai: 'AE-DU',
    singapore: 'SG-SG',
};

const normalizeCountryCode = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized.length === 2) return normalized;
    if (normalized.length === 3 && normalized === 'IND') return 'IN';
    if (normalized.length === 3 && normalized === 'USA') return 'US';
    return 'IN';
};

const resolveLocaleBundle = (countryCode) => {
    const code = normalizeCountryCode(countryCode);
    return {
        countryCode: code,
        ...(COUNTRY_LOCALE_MAP[code] || COUNTRY_LOCALE_MAP.IN),
    };
};

const normalizeLocationToken = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ');

const mapLocationToRegion = ({ location = '', countryCode = 'IN' } = {}) => {
    const normalizedCountry = normalizeCountryCode(countryCode);
    const fallback = resolveLocaleBundle(normalizedCountry).defaultRegion;
    const token = normalizeLocationToken(location);
    if (!token) return fallback;

    if (REGION_KEYWORD_MAP[token]) {
        return REGION_KEYWORD_MAP[token];
    }

    const compact = token.replace(/\s+/g, '');
    if (REGION_KEYWORD_MAP[compact]) {
        return REGION_KEYWORD_MAP[compact];
    }

    return fallback;
};

const resolveJobGeo = ({ location = '', countryCode = 'IN' } = {}) => {
    const locale = resolveLocaleBundle(countryCode);
    return {
        countryCode: locale.countryCode,
        regionCode: mapLocationToRegion({ location, countryCode: locale.countryCode }),
        currencyCode: locale.currencyCode,
        languageCode: locale.languageCode,
    };
};

module.exports = {
    normalizeCountryCode,
    resolveLocaleBundle,
    mapLocationToRegion,
    resolveJobGeo,
};
