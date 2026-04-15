const DEFAULT_BASE_CURRENCY = String(process.env.SYSTEM_BASE_CURRENCY || 'USD').trim().toUpperCase() || 'USD';

const FALLBACK_CURRENCY_CONFIGS = [
    { code: 'USD', symbol: '$', decimalPrecision: 2, region: 'GLOBAL' },
    { code: 'INR', symbol: 'Rs', decimalPrecision: 2, region: 'IN' },
    { code: 'EUR', symbol: 'EUR', decimalPrecision: 2, region: 'EU' },
    { code: 'GBP', symbol: 'GBP', decimalPrecision: 2, region: 'GB' },
    { code: 'CAD', symbol: 'CAD', decimalPrecision: 2, region: 'CA' },
    { code: 'SGD', symbol: 'SGD', decimalPrecision: 2, region: 'SG' },
    { code: 'AED', symbol: 'AED', decimalPrecision: 2, region: 'AE' },
];

const parseJson = (rawValue, fallbackValue) => {
    if (!rawValue) return fallbackValue;
    try {
        const parsed = JSON.parse(rawValue);
        return parsed;
    } catch (_error) {
        return fallbackValue;
    }
};

const normalizeCurrencyConfig = (row = {}) => {
    const code = String(row.code || '').trim().toUpperCase();
    if (!code) return null;

    const precision = Number.parseInt(row.decimalPrecision, 10);
    return {
        code,
        symbol: String(row.symbol || code).trim() || code,
        decimalPrecision: Number.isFinite(precision) ? Math.max(0, Math.min(4, precision)) : 2,
        region: String(row.region || 'GLOBAL').trim().toUpperCase() || 'GLOBAL',
    };
};

const configuredRows = parseJson(process.env.CURRENCY_CONFIG_JSON, FALLBACK_CURRENCY_CONFIGS);
const currencyRows = Array.isArray(configuredRows)
    ? configuredRows.map(normalizeCurrencyConfig).filter(Boolean)
    : FALLBACK_CURRENCY_CONFIGS;

const currencyMap = new Map(currencyRows.map((row) => [row.code, row]));

if (!currencyMap.has(DEFAULT_BASE_CURRENCY)) {
    currencyMap.set(DEFAULT_BASE_CURRENCY, {
        code: DEFAULT_BASE_CURRENCY,
        symbol: DEFAULT_BASE_CURRENCY,
        decimalPrecision: 2,
        region: 'GLOBAL',
    });
}

const getCurrencyConfig = (currencyCode = DEFAULT_BASE_CURRENCY) => {
    const normalized = String(currencyCode || '').trim().toUpperCase();
    if (currencyMap.has(normalized)) return currencyMap.get(normalized);
    return currencyMap.get(DEFAULT_BASE_CURRENCY);
};

const listCurrencyConfigs = () => Array.from(currencyMap.values()).sort((left, right) => (
    String(left.code).localeCompare(String(right.code))
));

module.exports = {
    DEFAULT_BASE_CURRENCY,
    getCurrencyConfig,
    listCurrencyConfigs,
};
