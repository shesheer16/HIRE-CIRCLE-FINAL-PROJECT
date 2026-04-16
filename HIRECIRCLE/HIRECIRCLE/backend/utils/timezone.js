const DEFAULT_TIMEZONE = String(process.env.DEFAULT_TIMEZONE || 'UTC').trim() || 'UTC';

const normalizeTimeZone = (value, fallback = DEFAULT_TIMEZONE) => {
    const candidate = String(value || '').trim();
    if (!candidate) return fallback;

    try {
        Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
        return candidate;
    } catch (_error) {
        return fallback;
    }
};

const toDateSafe = (value) => {
    const resolved = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(resolved.getTime())) {
        return new Date();
    }
    return resolved;
};

const startOfUtcDay = (value = new Date()) => {
    const date = toDateSafe(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
};

const endOfUtcDay = (value = new Date()) => {
    const start = startOfUtcDay(value);
    return new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);
};

const addUtcDays = (value = new Date(), days = 0) => {
    const date = toDateSafe(value);
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
};

const utcDateKey = (value = new Date()) => toDateSafe(value).toISOString().slice(0, 10);

const formatInTimeZone = (value, timezone = DEFAULT_TIMEZONE, options = {}) => {
    const date = toDateSafe(value);
    const safeTimezone = normalizeTimeZone(timezone, DEFAULT_TIMEZONE);
    return new Intl.DateTimeFormat('en-US', {
        timeZone: safeTimezone,
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        ...(options || {}),
    }).format(date);
};

module.exports = {
    DEFAULT_TIMEZONE,
    normalizeTimeZone,
    startOfUtcDay,
    endOfUtcDay,
    addUtcDays,
    utcDateKey,
    formatInTimeZone,
    toDateSafe,
};
