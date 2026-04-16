const redis = require('redis');
const logger = require('../utils/logger');
const { resolveRegionConfig } = require('./region');

const runtime = String(process.env.NODE_ENV || '').toLowerCase();
const isTestRuntime = runtime === 'test' || Boolean(process.env.JEST_WORKER_ID);
const redisEnabled = String(process.env.REDIS_ENABLED || 'true').toLowerCase() !== 'false';
const regionConfig = resolveRegionConfig();
const redisUrl = String(regionConfig.redisUrl || process.env.REDIS_URL || '').trim();

const maxReconnectAttempts = Number.parseInt(process.env.REDIS_MAX_RECONNECT_ATTEMPTS || '5', 10);
const reconnectDelayMs = Number.parseInt(process.env.REDIS_RECONNECT_DELAY_MS || '1000', 10);
const circuitFailureThreshold = Number.parseInt(process.env.REDIS_CIRCUIT_FAILURE_THRESHOLD || '5', 10);
const circuitCooldownMs = Number.parseInt(process.env.REDIS_CIRCUIT_COOLDOWN_MS || '30000', 10);

const memoryStore = new Map();

const state = {
    enabled: redisEnabled,
    configured: Boolean(redisUrl),
    available: false,
    degraded: false,
    mode: 'memory_fallback',
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
    lastError: null,
    lastConnectedAt: null,
};

const cleanupMemoryStore = () => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
        if (record.expiresAt && record.expiresAt <= now) {
            memoryStore.delete(key);
        }
    }
};

const wildcardToRegex = (pattern) => {
    const escaped = String(pattern || '')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
};

const fallbackClient = {
    isOpen: false,
    async get(key) {
        cleanupMemoryStore();
        const record = memoryStore.get(String(key));
        if (!record) return null;
        return record.value;
    },
    async set(key, value, options = {}) {
        const ttlMs = Number(options?.PX || 0);
        const ttlSec = Number(options?.EX || 0);
        const expiresAt = ttlMs > 0
            ? Date.now() + ttlMs
            : ttlSec > 0
                ? Date.now() + (ttlSec * 1000)
                : null;

        if (options?.NX === true && memoryStore.has(String(key))) {
            cleanupMemoryStore();
            if (memoryStore.has(String(key))) {
                return null;
            }
        }

        memoryStore.set(String(key), { value: String(value), expiresAt });
        return 'OK';
    },
    async setEx(key, ttlSeconds, value) {
        const ttlMs = Math.max(1, Number(ttlSeconds || 0)) * 1000;
        memoryStore.set(String(key), { value: String(value), expiresAt: Date.now() + ttlMs });
        return 'OK';
    },
    async del(...keys) {
        cleanupMemoryStore();
        const flatKeys = keys.flat().map((item) => String(item));
        let removed = 0;
        for (const key of flatKeys) {
            if (memoryStore.delete(key)) {
                removed += 1;
            }
        }
        return removed;
    },
    async keys(pattern) {
        cleanupMemoryStore();
        const regex = wildcardToRegex(pattern || '*');
        return Array.from(memoryStore.keys()).filter((key) => regex.test(key));
    },
    async incr(key) {
        const current = Number.parseInt(await this.get(key) || '0', 10) || 0;
        const next = current + 1;
        await this.set(key, String(next));
        return next;
    },
    async decr(key) {
        const current = Number.parseInt(await this.get(key) || '0', 10) || 0;
        const next = current - 1;
        await this.set(key, String(next));
        return next;
    },
    async pExpire(key, ttlMs) {
        cleanupMemoryStore();
        const record = memoryStore.get(String(key));
        if (!record) return 0;
        record.expiresAt = Date.now() + Math.max(1, Number(ttlMs || 0));
        memoryStore.set(String(key), record);
        return 1;
    },
    async expire(key, ttlSeconds) {
        return this.pExpire(key, Math.max(1, Number(ttlSeconds || 0)) * 1000);
    },
    async pTTL(key) {
        cleanupMemoryStore();
        const record = memoryStore.get(String(key));
        if (!record) return -2;
        if (!record.expiresAt) return -1;
        return Math.max(-2, record.expiresAt - Date.now());
    },
    async sAdd(key, ...values) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const set = new Set(raw ? JSON.parse(raw) : []);
        const before = set.size;
        values.flat().forEach((value) => set.add(String(value)));
        await this.set(key, JSON.stringify(Array.from(set)));
        return set.size - before;
    },
    async sRem(key, ...values) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const set = new Set(raw ? JSON.parse(raw) : []);
        let removed = 0;
        values.flat().forEach((value) => {
            if (set.delete(String(value))) {
                removed += 1;
            }
        });
        await this.set(key, JSON.stringify(Array.from(set)));
        return removed;
    },
    async sCard(key) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const set = raw ? JSON.parse(raw) : [];
        return Array.isArray(set) ? set.length : 0;
    },
    async lPush(key, ...values) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        values.flat().forEach((value) => list.unshift(String(value)));
        await this.set(key, JSON.stringify(list));
        return list.length;
    },
    async rPush(key, ...values) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        values.flat().forEach((value) => list.push(String(value)));
        await this.set(key, JSON.stringify(list));
        return list.length;
    },
    async lLen(key) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.length : 0;
    },
    async lRange(key, start, end) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) return [];
        const safeStart = Number(start || 0);
        const safeEnd = Number(end || -1);
        const normalizedEnd = safeEnd < 0 ? list.length + safeEnd + 1 : safeEnd + 1;
        return list.slice(safeStart, normalizedEnd);
    },
    async lRem(key, count, value) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list) || !list.length) return 0;
        const target = String(value);
        let removed = 0;
        const safeCount = Number(count || 0);
        const filtered = [];
        for (const item of list) {
            if (item === target && (safeCount === 0 || removed < Math.abs(safeCount))) {
                removed += 1;
                continue;
            }
            filtered.push(item);
        }
        await this.set(key, JSON.stringify(filtered));
        return removed;
    },
    async brPopLPush(source, destination) {
        cleanupMemoryStore();
        const sourceRaw = await this.get(source);
        const sourceList = sourceRaw ? JSON.parse(sourceRaw) : [];
        if (!Array.isArray(sourceList) || !sourceList.length) return null;
        const value = sourceList.pop();
        await this.set(source, JSON.stringify(sourceList));

        const destRaw = await this.get(destination);
        const destList = destRaw ? JSON.parse(destRaw) : [];
        destList.unshift(value);
        await this.set(destination, JSON.stringify(destList));
        return value;
    },
    async blPop(key) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list) || !list.length) return null;
        const value = list.shift();
        await this.set(key, JSON.stringify(list));
        return {
            key: String(key),
            element: value,
        };
    },
    async hSet(key, value) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        const hash = raw ? JSON.parse(raw) : {};
        Object.assign(hash, value || {});
        await this.set(key, JSON.stringify(hash));
        return 1;
    },
    async hGetAll(key) {
        cleanupMemoryStore();
        const raw = await this.get(key);
        return raw ? JSON.parse(raw) : {};
    },
    async *scanIterator({ MATCH: pattern = '*' } = {}) {
        const keys = await this.keys(pattern);
        for (const key of keys) {
            yield key;
        }
    },
    async quit() {
        return null;
    },
    async disconnect() {
        return null;
    },
    on() {
        return null;
    },
};

let redisClient = null;

const isCircuitOpen = () => {
    if (!state.circuitOpenUntil) return false;
    if (Date.now() >= state.circuitOpenUntil) {
        state.circuitOpenUntil = 0;
        return false;
    }
    return true;
};

const markFailure = (error, operation) => {
    state.consecutiveFailures += 1;
    state.lastError = String(error?.message || error || 'unknown');
    state.degraded = true;

    logger.warn({
        event: 'redis_operation_failed',
        operation,
        consecutiveFailures: state.consecutiveFailures,
        message: state.lastError,
    });

    if (state.consecutiveFailures >= circuitFailureThreshold) {
        state.circuitOpenUntil = Date.now() + circuitCooldownMs;
        logger.security({
            event: 'redis_circuit_opened',
            cooldownMs: circuitCooldownMs,
            consecutiveFailures: state.consecutiveFailures,
        });
    }
};

const markSuccess = () => {
    state.consecutiveFailures = 0;
    state.lastError = null;
    state.circuitOpenUntil = 0;
    state.available = true;
    state.degraded = false;
};

const runWithFallback = async (operation, fallbackValue, executor) => {
    if (!redisEnabled || !redisClient || !redisClient.isOpen || isCircuitOpen()) {
        state.available = false;
        state.degraded = true;
        return (typeof fallbackValue === 'function') ? fallbackValue() : fallbackValue;
    }

    try {
        const result = await executor();
        markSuccess();
        return result;
    } catch (error) {
        markFailure(error, operation);
        return (typeof fallbackValue === 'function') ? fallbackValue() : fallbackValue;
    }
};

const createRedisClient = () => {
    const client = redis.createClient({
        url: redisUrl,
        socket: {
            reconnectStrategy(retries) {
                if (retries >= maxReconnectAttempts) {
                    return false;
                }
                return reconnectDelayMs;
            },
        },
    });

    client.on('connect', () => {
        logger.info({ event: 'redis_connecting' });
    });

    client.on('ready', () => {
        state.available = true;
        state.degraded = false;
        state.mode = 'redis';
        state.lastConnectedAt = new Date().toISOString();
        logger.info({ event: 'redis_ready' });
    });

    client.on('error', (error) => {
        state.available = false;
        state.degraded = true;
        state.lastError = String(error?.message || error || 'unknown');
        logger.warn({ event: 'redis_error', message: state.lastError });
    });

    client.on('reconnecting', () => {
        state.available = false;
        state.degraded = true;
        logger.warn({ event: 'redis_reconnecting' });
    });

    client.on('end', () => {
        state.available = false;
        state.degraded = true;
        logger.warn({ event: 'redis_connection_ended' });
    });

    return client;
};

if (!redisEnabled || !redisUrl || isTestRuntime) {
    state.mode = 'memory_fallback';
    state.degraded = true;
} else {
    redisClient = createRedisClient();

    (async () => {
        try {
            await redisClient.connect();
            state.mode = 'redis';
            markSuccess();
        } catch (error) {
            state.mode = 'memory_fallback';
            state.available = false;
            state.degraded = true;
            state.lastError = String(error?.message || error || 'unknown');
            logger.security({
                event: 'redis_bootstrap_failed',
                message: state.lastError,
                degradedMode: true,
            });
        }
    })();
}

const client = {
    get isOpen() {
        return Boolean(redisEnabled && redisClient && redisClient.isOpen && !isCircuitOpen());
    },
    async get(key) {
        return runWithFallback('get', () => fallbackClient.get(key), () => redisClient.get(key));
    },
    async set(key, value, options = undefined) {
        return runWithFallback(
            'set',
            () => fallbackClient.set(key, value, options),
            () => (options ? redisClient.set(key, value, options) : redisClient.set(key, value))
        );
    },
    async setEx(key, ttlSeconds, value) {
        return runWithFallback(
            'setEx',
            () => fallbackClient.setEx(key, ttlSeconds, value),
            () => redisClient.setEx(key, ttlSeconds, value)
        );
    },
    async del(...keys) {
        const flattened = keys.flat();
        return runWithFallback(
            'del',
            () => fallbackClient.del(...flattened),
            () => redisClient.del(flattened)
        );
    },
    async keys(pattern) {
        return runWithFallback('keys', () => fallbackClient.keys(pattern), () => redisClient.keys(pattern));
    },
    async incr(key) {
        return runWithFallback('incr', () => fallbackClient.incr(key), () => redisClient.incr(key));
    },
    async decr(key) {
        return runWithFallback('decr', () => fallbackClient.decr(key), () => redisClient.decr(key));
    },
    async pExpire(key, ttlMs) {
        return runWithFallback('pExpire', () => fallbackClient.pExpire(key, ttlMs), () => redisClient.pExpire(key, ttlMs));
    },
    async expire(key, ttlSeconds) {
        return runWithFallback('expire', () => fallbackClient.expire(key, ttlSeconds), () => redisClient.expire(key, ttlSeconds));
    },
    async pTTL(key) {
        return runWithFallback('pTTL', () => fallbackClient.pTTL(key), () => redisClient.pTTL(key));
    },
    async sAdd(key, ...values) {
        return runWithFallback('sAdd', () => fallbackClient.sAdd(key, ...values), () => redisClient.sAdd(key, values.flat()));
    },
    async sRem(key, ...values) {
        return runWithFallback('sRem', () => fallbackClient.sRem(key, ...values), () => redisClient.sRem(key, values.flat()));
    },
    async sCard(key) {
        return runWithFallback('sCard', () => fallbackClient.sCard(key), () => redisClient.sCard(key));
    },
    async lPush(key, ...values) {
        return runWithFallback('lPush', () => fallbackClient.lPush(key, ...values), () => redisClient.lPush(key, values.flat()));
    },
    async rPush(key, ...values) {
        return runWithFallback('rPush', () => fallbackClient.rPush(key, ...values), () => redisClient.rPush(key, values.flat()));
    },
    async lLen(key) {
        return runWithFallback('lLen', () => fallbackClient.lLen(key), () => redisClient.lLen(key));
    },
    async lRange(key, start, end) {
        return runWithFallback('lRange', () => fallbackClient.lRange(key, start, end), () => redisClient.lRange(key, start, end));
    },
    async lRem(key, count, value) {
        return runWithFallback('lRem', () => fallbackClient.lRem(key, count, value), () => redisClient.lRem(key, count, value));
    },
    async brPopLPush(source, destination, timeoutSeconds = 1) {
        return runWithFallback(
            'brPopLPush',
            () => fallbackClient.brPopLPush(source, destination),
            () => redisClient.brPopLPush(source, destination, timeoutSeconds)
        );
    },
    async blPop(key, timeoutSeconds = 1) {
        return runWithFallback(
            'blPop',
            () => fallbackClient.blPop(key),
            () => redisClient.blPop(key, timeoutSeconds)
        );
    },
    async hSet(key, value) {
        return runWithFallback('hSet', () => fallbackClient.hSet(key, value), () => redisClient.hSet(key, value));
    },
    async hGetAll(key) {
        return runWithFallback('hGetAll', () => fallbackClient.hGetAll(key), () => redisClient.hGetAll(key));
    },
    async *scanIterator(options = {}) {
        if (!redisEnabled || !redisClient || !redisClient.isOpen || isCircuitOpen() || typeof redisClient.scanIterator !== 'function') {
            yield* fallbackClient.scanIterator(options);
            return;
        }
        try {
            for await (const key of redisClient.scanIterator(options)) {
                yield key;
            }
            markSuccess();
        } catch (error) {
            markFailure(error, 'scanIterator');
            yield* fallbackClient.scanIterator(options);
        }
    },
    async quit() {
        if (redisClient?.isOpen) {
            try {
                await redisClient.quit();
            } catch (_error) {
                // no-op
            }
        }
    },
    async disconnect() {
        if (redisClient) {
            try {
                await redisClient.disconnect();
            } catch (_error) {
                // no-op
            }
        }
    },
    on(eventName, handler) {
        if (redisClient) {
            redisClient.on(eventName, handler);
        }
    },
    getHealth() {
        return {
            status: (client.isOpen && !state.degraded) ? 'ok' : 'degraded',
            enabled: redisEnabled,
            configured: Boolean(redisUrl),
            mode: state.mode,
            available: state.available,
            degraded: state.degraded || !client.isOpen,
            circuitOpen: isCircuitOpen(),
            circuitOpenUntil: state.circuitOpenUntil ? new Date(state.circuitOpenUntil).toISOString() : null,
            consecutiveFailures: state.consecutiveFailures,
            lastError: state.lastError,
            lastConnectedAt: state.lastConnectedAt,
            memoryFallbackEntries: memoryStore.size,
        };
    },
};

module.exports = client;
