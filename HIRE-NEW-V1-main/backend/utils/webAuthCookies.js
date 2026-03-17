const REFRESH_TOKEN_COOKIE = 'hireapp_refresh_token';
const BROWSER_SESSION_MODE = 'browser';
const DEFAULT_REFRESH_COOKIE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const isProductionRuntime = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const parseDurationToMilliseconds = (input, fallbackMs) => {
    const raw = String(input || '').trim();
    if (!raw) return fallbackMs;

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric * 1000);
    }

    const match = raw.match(/^(\d+)([smhd])$/i);
    if (!match) return fallbackMs;

    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value) || value <= 0) return fallbackMs;

    if (unit === 's') return value * 1000;
    if (unit === 'm') return value * 60 * 1000;
    if (unit === 'h') return value * 60 * 60 * 1000;
    if (unit === 'd') return value * 24 * 60 * 60 * 1000;
    return fallbackMs;
};

const parseCookies = (headerValue = '') => String(headerValue || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex <= 0) return accumulator;
        const key = entry.slice(0, separatorIndex).trim();
        const value = entry.slice(separatorIndex + 1).trim();
        if (!key) return accumulator;
        accumulator[key] = decodeURIComponent(value);
        return accumulator;
    }, {});

const isBrowserSessionRequest = (req = {}) => String(req.headers?.['x-session-mode'] || '')
    .trim()
    .toLowerCase() === BROWSER_SESSION_MODE;

const getRefreshCookieOptions = (req = {}) => {
    const secure = isProductionRuntime()
        || req.secure
        || String(req.headers?.['x-forwarded-proto'] || '').trim().toLowerCase() === 'https';

    return {
        httpOnly: true,
        secure,
        sameSite: secure ? 'none' : 'lax',
        path: '/api/users',
        maxAge: parseDurationToMilliseconds(
            process.env.JWT_REFRESH_EXPIRES_IN || '30d',
            DEFAULT_REFRESH_COOKIE_AGE_MS
        ),
    };
};

const setRefreshTokenCookie = (req, res, refreshToken) => {
    if (!res?.cookie || !refreshToken) return;
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, getRefreshCookieOptions(req));
};

const clearRefreshTokenCookie = (req, res) => {
    if (!res?.clearCookie) return;
    res.clearCookie(REFRESH_TOKEN_COOKIE, getRefreshCookieOptions(req));
};

const readRefreshTokenFromRequest = (req = {}) => {
    const fromBody = String(req.body?.refreshToken || '').trim();
    if (fromBody) {
        return fromBody;
    }

    const cookies = parseCookies(req.headers?.cookie || '');
    return String(cookies[REFRESH_TOKEN_COOKIE] || '').trim();
};

module.exports = {
    isBrowserSessionRequest,
    readRefreshTokenFromRequest,
    setRefreshTokenCookie,
    clearRefreshTokenCookie,
};
