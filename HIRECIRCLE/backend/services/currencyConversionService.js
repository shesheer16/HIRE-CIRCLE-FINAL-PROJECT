const { DEFAULT_BASE_CURRENCY, getCurrencyConfig } = require('../config/currencyConfig');

const CACHE_TTL_MS = Number.parseInt(process.env.CURRENCY_RATE_CACHE_TTL_MS || String(10 * 60 * 1000), 10);

const parseJson = (rawValue, fallback) => {
    if (!rawValue) return fallback;
    try {
        return JSON.parse(rawValue);
    } catch (_error) {
        return fallback;
    }
};

const inMemoryRateCache = {
    loadedAt: 0,
    rates: {},
};

const normalizeRates = (rawRates = {}) => {
    const result = {};
    Object.entries(rawRates || {}).forEach(([code, value]) => {
        const normalizedCode = String(code || '').trim().toUpperCase();
        const parsed = Number(value);
        if (!normalizedCode || !Number.isFinite(parsed) || parsed <= 0) return;
        result[normalizedCode] = parsed;
    });

    if (!result[DEFAULT_BASE_CURRENCY]) {
        result[DEFAULT_BASE_CURRENCY] = 1;
    }
    return result;
};

const loadConversionRates = async () => {
    const now = Date.now();
    if (inMemoryRateCache.loadedAt && (now - inMemoryRateCache.loadedAt) < CACHE_TTL_MS) {
        return inMemoryRateCache.rates;
    }

    const configured = parseJson(process.env.CURRENCY_CONVERSION_RATES_JSON, {
        [DEFAULT_BASE_CURRENCY]: 1,
        INR: 83,
        USD: 1,
        EUR: 0.92,
        GBP: 0.78,
        CAD: 1.34,
        SGD: 1.35,
        AED: 3.67,
    });

    const normalized = normalizeRates(configured);
    inMemoryRateCache.loadedAt = now;
    inMemoryRateCache.rates = normalized;
    return normalized;
};

const getConversionRate = async ({
    fromCurrency = DEFAULT_BASE_CURRENCY,
    toCurrency = DEFAULT_BASE_CURRENCY,
}) => {
    const from = String(fromCurrency || DEFAULT_BASE_CURRENCY).trim().toUpperCase();
    const to = String(toCurrency || DEFAULT_BASE_CURRENCY).trim().toUpperCase();

    if (from === to) return 1;

    const rates = await loadConversionRates();
    const fromRate = Number(rates[from]);
    const toRate = Number(rates[to]);

    if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
        return 1;
    }

    return toRate / fromRate;
};

const roundCurrency = (amount, currencyCode = DEFAULT_BASE_CURRENCY) => {
    const config = getCurrencyConfig(currencyCode);
    const precision = Number(config?.decimalPrecision ?? 2);
    const safeAmount = Number(amount || 0);
    if (!Number.isFinite(safeAmount)) return 0;
    return Number(safeAmount.toFixed(precision));
};

const convertAmount = async ({
    amount = 0,
    fromCurrency = DEFAULT_BASE_CURRENCY,
    toCurrency = DEFAULT_BASE_CURRENCY,
}) => {
    const safeAmount = Number(amount || 0);
    const rate = await getConversionRate({ fromCurrency, toCurrency });
    const converted = Number.isFinite(safeAmount) ? safeAmount * rate : 0;

    return {
        amount: roundCurrency(converted, toCurrency),
        rate,
    };
};

const buildMoneyView = async ({
    baseAmount = 0,
    baseCurrency = DEFAULT_BASE_CURRENCY,
    displayCurrency = DEFAULT_BASE_CURRENCY,
}) => {
    const converted = await convertAmount({
        amount: baseAmount,
        fromCurrency: baseCurrency,
        toCurrency: displayCurrency,
    });

    return {
        baseAmount: roundCurrency(baseAmount, baseCurrency),
        baseCurrency: String(baseCurrency || DEFAULT_BASE_CURRENCY).toUpperCase(),
        displayAmount: converted.amount,
        displayCurrency: String(displayCurrency || DEFAULT_BASE_CURRENCY).toUpperCase(),
        exchangeRateUsed: converted.rate,
    };
};

const resolveDisplayCurrency = ({ user = null, fallback = DEFAULT_BASE_CURRENCY }) => {
    const preferred = String(
        user?.globalPreferences?.displayCurrency
        || user?.currencyPreference
        || fallback
        || DEFAULT_BASE_CURRENCY
    ).trim().toUpperCase();

    return getCurrencyConfig(preferred)?.code || DEFAULT_BASE_CURRENCY;
};

module.exports = {
    DEFAULT_BASE_CURRENCY,
    getConversionRate,
    convertAmount,
    buildMoneyView,
    roundCurrency,
    resolveDisplayCurrency,
};
