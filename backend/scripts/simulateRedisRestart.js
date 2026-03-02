#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const redisClient = require('../config/redis');
const { createRedisRateLimiter } = require('../services/redisRateLimiter');
const { consumeSocketRateLimit, rememberSocketMessageId } = require('../services/socketScalingService');
const { buildCacheKey, setJSON, getJSON, isCacheAvailable } = require('../services/cacheService');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'disaster-recovery-redis-restart.json');

const createMockResponse = () => ({
    statusCode: 200,
    sent: false,
    payload: null,
    headers: {},
    setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = String(value);
    },
    status(code) {
        this.statusCode = Number(code);
        return this;
    },
    json(payload) {
        this.sent = true;
        this.payload = payload;
        return this;
    },
});

const run = async () => {
    const report = {
        generatedAt: new Date().toISOString(),
        cacheAvailable: isCacheAvailable(),
        baseline: {},
        outageWindow: {},
        recovery: {},
        passed: false,
    };

    if (report.cacheAvailable) {
        const baselineKey = buildCacheKey('redis-restart-check', { phase: 'baseline' });
        await setJSON(baselineKey, { ok: true, phase: 'baseline' }, 60);
        const baselineRead = await getJSON(baselineKey);
        report.baseline.cacheRead = Boolean(baselineRead?.ok);
    } else {
        report.baseline.cacheRead = true;
        report.baseline.cacheMode = 'degraded_no_cache_backend';
    }

    const original = {
        incr: redisClient.incr,
        pExpire: redisClient.pExpire,
        pTTL: redisClient.pTTL,
        set: redisClient.set,
        setEx: redisClient.setEx,
        get: redisClient.get,
    };

    redisClient.incr = async () => { throw new Error('simulated redis restart'); };
    redisClient.pExpire = async () => { throw new Error('simulated redis restart'); };
    redisClient.pTTL = async () => { throw new Error('simulated redis restart'); };
    redisClient.set = async () => { throw new Error('simulated redis restart'); };
    redisClient.setEx = async () => { throw new Error('simulated redis restart'); };
    redisClient.get = async () => { throw new Error('simulated redis restart'); };

    const limiter = createRedisRateLimiter({
        namespace: 'redis-restart-sim',
        max: 5,
        windowMs: 10000,
        strictRedis: false,
    });

    const req = { ip: '127.0.0.1', headers: {} };
    const res = createMockResponse();
    let nextCalled = false;

    await limiter(req, res, () => {
        nextCalled = true;
    });

    const allowanceA = await consumeSocketRateLimit({
        namespace: 'restart-test',
        key: 'user-1',
        limit: 2,
        windowMs: 2000,
    });
    const allowanceB = await consumeSocketRateLimit({
        namespace: 'restart-test',
        key: 'user-1',
        limit: 2,
        windowMs: 2000,
    });
    const allowanceC = await consumeSocketRateLimit({
        namespace: 'restart-test',
        key: 'user-1',
        limit: 2,
        windowMs: 2000,
    });

    const duplicateA = await rememberSocketMessageId({
        namespace: 'restart-chat',
        key: 'u1:m1',
        dedupeWindowMs: 5000,
    });
    const duplicateB = await rememberSocketMessageId({
        namespace: 'restart-chat',
        key: 'u1:m1',
        dedupeWindowMs: 5000,
    });

    report.outageWindow = {
        limiterFallbackWorked: nextCalled === true,
        socketAllowanceFallback: [allowanceA, allowanceB, allowanceC],
        dedupeFallback: {
            firstWasDuplicate: duplicateA,
            secondWasDuplicate: duplicateB,
        },
    };

    redisClient.incr = original.incr;
    redisClient.pExpire = original.pExpire;
    redisClient.pTTL = original.pTTL;
    redisClient.set = original.set;
    redisClient.setEx = original.setEx;
    redisClient.get = original.get;

    let recoveryWrite = false;
    let recoveryRead = false;

    if (report.cacheAvailable) {
        try {
            const recoveryKey = buildCacheKey('redis-restart-check', { phase: 'recovery' });
            recoveryWrite = await setJSON(recoveryKey, { ok: true, phase: 'recovery' }, 60);
            const payload = await getJSON(recoveryKey);
            recoveryRead = Boolean(payload?.ok);
        } catch (_error) {
            recoveryWrite = false;
            recoveryRead = false;
        }
    } else {
        recoveryWrite = true;
        recoveryRead = true;
    }

    report.recovery = {
        cacheWriteRecovered: recoveryWrite,
        cacheReadRecovered: recoveryRead,
    };

    report.passed = [
        report.baseline.cacheRead,
        report.outageWindow.limiterFallbackWorked,
        report.outageWindow.socketAllowanceFallback[0] === true,
        report.outageWindow.socketAllowanceFallback[1] === true,
        report.outageWindow.socketAllowanceFallback[2] === false,
        report.outageWindow.dedupeFallback.firstWasDuplicate === false,
        report.outageWindow.dedupeFallback.secondWasDuplicate === true,
        report.recovery.cacheWriteRecovered,
    ].every(Boolean);

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.passed ? 0 : 1);
};

run().catch((error) => {
    console.warn('[simulate:dr:redis-restart] failed:', error.message);
    process.exit(1);
});
