const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const redisClient = require('../config/redis');
const logger = require('./logger');

const localTokenBlacklist = new Map();
const localRefreshConsumed = new Map();

const nowSeconds = () => Math.floor(Date.now() / 1000);

const requireSecret = (envName) => {
    const secret = String(process.env[envName] || '').trim();
    if (!secret) {
        throw new Error(`${envName} is required`);
    }
    return secret;
};

const parseDurationToSeconds = (input, fallbackSeconds) => {
    const raw = String(input || '').trim();
    if (!raw) return fallbackSeconds;

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric);
    }

    const match = raw.match(/^(\d+)([smhd])$/i);
    if (!match) return fallbackSeconds;

    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value) || value <= 0) return fallbackSeconds;

    if (unit === 's') return value;
    if (unit === 'm') return value * 60;
    if (unit === 'h') return value * 60 * 60;
    if (unit === 'd') return value * 24 * 60 * 60;
    return fallbackSeconds;
};

const accessTokenTtl = () => String(process.env.JWT_ACCESS_EXPIRES_IN || '15m').trim();
const refreshTokenTtl = () => String(process.env.JWT_REFRESH_EXPIRES_IN || '30d').trim();

const blacklistKey = (jti) => `token:blacklist:${String(jti || '').trim()}`;
const refreshConsumedKey = (jti) => `token:refresh:consumed:${String(jti || '').trim()}`;

const pruneLocalBlacklist = () => {
    const now = nowSeconds();
    for (const [jti, exp] of localTokenBlacklist.entries()) {
        if (!Number.isFinite(exp) || exp <= now) {
            localTokenBlacklist.delete(jti);
        }
    }
};

const pruneLocalRefreshConsumed = () => {
    const now = nowSeconds();
    for (const [jti, exp] of localRefreshConsumed.entries()) {
        if (!Number.isFinite(exp) || exp <= now) {
            localRefreshConsumed.delete(jti);
        }
    }
};

const addLocalBlacklist = (jti, exp) => {
    if (!jti || !Number.isFinite(exp)) return;
    pruneLocalBlacklist();
    localTokenBlacklist.set(jti, exp);
};

const addLocalRefreshConsumed = (jti, exp) => {
    if (!jti || !Number.isFinite(exp)) return;
    pruneLocalRefreshConsumed();
    localRefreshConsumed.set(jti, exp);
};

const isLocalBlacklisted = (jti) => {
    if (!jti) return false;
    pruneLocalBlacklist();
    const exp = localTokenBlacklist.get(jti);
    if (!Number.isFinite(exp)) return false;
    return exp > nowSeconds();
};

const isLocalRefreshConsumed = (jti) => {
    if (!jti) return false;
    pruneLocalRefreshConsumed();
    const exp = localRefreshConsumed.get(jti);
    if (!Number.isFinite(exp)) return false;
    return exp > nowSeconds();
};

const isRedisAvailable = () => Boolean(redisClient && redisClient.isOpen);

const normalizeTokenVersion = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
};

const signAccessToken = (userId, { tokenVersion = 0 } = {}) => jwt.sign({
    id: String(userId),
    typ: 'access',
    jti: crypto.randomUUID(),
    tv: normalizeTokenVersion(tokenVersion),
}, requireSecret('JWT_SECRET'), {
    expiresIn: accessTokenTtl(),
});

const signRefreshToken = (userId, { tokenVersion = 0 } = {}) => jwt.sign({
    id: String(userId),
    typ: 'refresh',
    jti: crypto.randomUUID(),
    tv: normalizeTokenVersion(tokenVersion),
}, requireSecret('JWT_REFRESH_SECRET'), {
    expiresIn: refreshTokenTtl(),
});

const getJti = (decoded) => String(decoded?.jti || '').trim();

const isBlacklisted = async (jti) => {
    if (!jti) return false;

    if (isRedisAvailable()) {
        try {
            const blocked = await redisClient.get(blacklistKey(jti));
            if (blocked) return true;
        } catch (error) {
            logger.warn({ event: 'blacklist_read_failed', message: error.message });
        }
    }

    return isLocalBlacklisted(jti);
};

const verifyToken = async (token, { secretEnvName, expectedType }) => {
    const decoded = jwt.verify(String(token || '').trim(), requireSecret(secretEnvName), {
        algorithms: ['HS256'],
    });
    if (!decoded || decoded.typ !== expectedType) {
        throw new Error('Invalid token type');
    }

    const jti = getJti(decoded);
    if (await isBlacklisted(jti)) {
        throw new Error('Token has been revoked');
    }

    return decoded;
};

const claimRefreshTokenUse = async ({ jti, exp, reason = 'rotated_refresh_token' }) => {
    if (!jti || !Number.isFinite(exp) || exp <= nowSeconds()) {
        return false;
    }

    const ttlSeconds = Math.max(1, exp - nowSeconds());

    if (isRedisAvailable()) {
        try {
            const result = await redisClient.set(refreshConsumedKey(jti), reason, {
                NX: true,
                EX: ttlSeconds,
            });
            if (result === 'OK') {
                addLocalRefreshConsumed(jti, exp);
                return true;
            }
            return false;
        } catch (error) {
            logger.warn({ event: 'refresh_consume_write_failed', message: error.message });
        }
    }

    if (isLocalRefreshConsumed(jti)) {
        return false;
    }
    addLocalRefreshConsumed(jti, exp);
    return true;
};

const verifyAccessToken = async (token) => verifyToken(token, {
    secretEnvName: 'JWT_SECRET',
    expectedType: 'access',
});

const verifyRefreshToken = async (token) => verifyToken(token, {
    secretEnvName: 'JWT_REFRESH_SECRET',
    expectedType: 'refresh',
});

const consumeRefreshToken = async (token, reason = 'rotated_refresh_token') => {
    const decoded = await verifyRefreshToken(token);
    const jti = getJti(decoded);
    const exp = Number(decoded?.exp || 0);
    const claimed = await claimRefreshTokenUse({ jti, exp, reason });

    if (!claimed) {
        const error = new Error('Refresh token already used');
        error.statusCode = 401;
        throw error;
    }

    await blacklistToken(token, reason);
    return decoded;
};

const blacklistToken = async (token, reason = 'revoked') => {
    const rawToken = String(token || '').trim();
    if (!rawToken) return false;

    let decoded;
    try {
        decoded = jwt.decode(rawToken);
    } catch (_error) {
        return false;
    }

    const jti = getJti(decoded);
    const exp = Number(decoded?.exp || 0);
    if (!jti || !Number.isFinite(exp) || exp <= nowSeconds()) {
        return false;
    }

    const ttlSeconds = Math.max(1, exp - nowSeconds());

    addLocalBlacklist(jti, exp);

    if (isRedisAvailable()) {
        try {
            await redisClient.setEx(blacklistKey(jti), ttlSeconds, reason);
        } catch (error) {
            logger.warn({ event: 'blacklist_write_failed', message: error.message });
        }
    }

    return true;
};

const revokeSession = async ({ accessToken, refreshToken } = {}) => {
    const operations = [];
    if (accessToken) operations.push(blacklistToken(accessToken, 'logout_access'));
    if (refreshToken) operations.push(blacklistToken(refreshToken, 'logout_refresh'));

    if (!operations.length) return { revoked: 0 };

    const results = await Promise.allSettled(operations);
    const revoked = results.filter((entry) => entry.status === 'fulfilled' && entry.value).length;
    return { revoked };
};

module.exports = {
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    consumeRefreshToken,
    blacklistToken,
    revokeSession,
    parseDurationToSeconds,
};
