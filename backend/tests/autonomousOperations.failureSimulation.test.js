const buildResponse = () => {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        send(payload) {
            this.body = payload;
            return this;
        },
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
    };
    return res;
};

jest.mock('../services/systemMonitoringService', () => ({
    incrementAiFailureCounter: jest.fn().mockResolvedValue(1),
    incrementPaymentFailureCounter: jest.fn().mockResolvedValue(1),
    incrementRedisFailureCounter: jest.fn().mockResolvedValue(1),
    emitStructuredAlert: jest.fn().mockResolvedValue(null),
    recordMemoryUsage: jest.fn().mockResolvedValue(null),
}));

jest.setTimeout(20000);

describe('Autonomous operations failure simulations', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.dontMock('fs');
    });

    it('simulates DB restart mid-operation by opening circuit and blocking cascade calls', async () => {
        const {
            executeWithCircuitBreaker,
            getCircuitState,
            CircuitOpenError,
        } = require('../services/circuitBreakerService');

        const failDbCall = () => {
            const err = new Error('MongoNetworkError: connection reset by peer');
            err.code = 'MONGO_RESTART';
            return Promise.reject(err);
        };

        await expect(executeWithCircuitBreaker('db_restart_sim', failDbCall, {
            failureThreshold: 2,
            cooldownMs: 2000,
            timeoutMs: 200,
        })).rejects.toThrow('MongoNetworkError');

        await expect(executeWithCircuitBreaker('db_restart_sim', failDbCall, {
            failureThreshold: 2,
            cooldownMs: 2000,
            timeoutMs: 200,
        })).rejects.toThrow('MongoNetworkError');

        const state = getCircuitState('db_restart_sim');
        expect(state.state).toBe('open');

        await expect(executeWithCircuitBreaker('db_restart_sim', failDbCall, {
            failureThreshold: 2,
            cooldownMs: 2000,
            timeoutMs: 200,
        })).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it('simulates Redis restart with local limiter fallback instead of crash', async () => {
        jest.doMock('../config/redis', () => ({
            isOpen: false,
        }));

        const { createRedisRateLimiter } = require('../services/redisRateLimiter');
        const limiter = createRedisRateLimiter({
            namespace: 'redis-restart-sim',
            windowMs: 1000,
            max: 1,
            strictRedis: false,
        });

        const req = { ip: '127.0.0.1', headers: {}, connection: {} };
        const next = jest.fn();

        const res1 = buildResponse();
        await limiter(req, res1, next);
        expect(next).toHaveBeenCalledTimes(1);

        const res2 = buildResponse();
        await limiter(req, res2, () => {});
        expect(res2.statusCode).toBe(429);
        expect(res2.body).toEqual(expect.objectContaining({ success: false }));
    });

    it('simulates AI timeout and falls back to manual profile mode', async () => {
        process.env.GEMINI_API_KEY = 'test-key';

        jest.doMock('axios', () => ({
            post: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')),
        }));
        jest.doMock('fs', () => {
            const actualFs = jest.requireActual('fs');
            return {
                ...actualFs,
                existsSync: actualFs.existsSync,
                mkdirSync: actualFs.mkdirSync,
                createWriteStream: actualFs.createWriteStream,
                readFileSync: jest.fn(() => Buffer.from('fake-audio')),
            };
        });

        const { extractWorkerDataFromAudio } = require('../services/geminiService');
        const result = await extractWorkerDataFromAudio('/tmp/audio.mp3', 'worker');

        expect(result).toEqual(expect.objectContaining({
            manualFallbackRequired: true,
        }));
    });

    it('simulates payment webhook replay and returns duplicate-safe response', async () => {
        jest.doMock('../services/financial/paymentOrchestrationService', () => ({
            processWebhook: jest.fn().mockResolvedValue({ duplicate: true }),
            createPaymentIntentRecord: jest.fn(),
        }));
        jest.doMock('../services/financial/subscriptionBillingService', () => ({
            createSubscriptionCheckoutSession: jest.fn(),
        }));
        jest.doMock('../models/userModel', () => ({
            findById: jest.fn(),
        }));

        const { stripeWebhook } = require('../controllers/paymentController');

        const req = {
            body: Buffer.from('{}'),
            headers: {
                'stripe-signature': 'sig',
            },
        };
        const res = buildResponse();

        await stripeWebhook(req, res);

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ duplicate: true }));
    });

    it('simulates worker crash path and enforces dead-letter transition after retry ceiling', async () => {
        const findByIdAndUpdate = jest.fn().mockResolvedValue({});

        jest.doMock('../models/BackgroundJob', () => ({
            findByIdAndUpdate,
            find: jest.fn().mockResolvedValue([]),
            findOneAndUpdate: jest.fn(),
        }));
        jest.doMock('../config/redis', () => ({
            isOpen: false,
        }));

        const { markBackgroundJobFailed } = require('../services/backgroundQueueService');

        await markBackgroundJobFailed({
            job: { _id: 'job-1', attempts: 3, maxAttempts: 3, type: 'simulate_worker_crash' },
            error: new Error('worker crashed'),
        });

        expect(findByIdAndUpdate).toHaveBeenCalled();
        const updatePayload = findByIdAndUpdate.mock.calls[0][1];
        expect(updatePayload.$set.status).toBe('dead_letter');
    });

    it('simulates high CPU + memory spike and triggers graceful action path', async () => {
        const { setDegradationFlag, isDegradationActive } = require('../services/degradationService');
        const { __test__ } = require('../services/resourceWatchdogService');

        setDegradationFlag('adaptiveRateLimitingEnabled', false, null);
        const shutdownSpy = jest.fn();

        await __test__.evaluateThresholds({
            cpuUsagePercent: 99,
            memoryUsagePercent: 96,
            eventLoopDelayMs: 300,
            requestGracefulShutdown: shutdownSpy,
        });

        expect(isDegradationActive('adaptiveRateLimitingEnabled')).toBe(true);
        expect(shutdownSpy).toHaveBeenCalledWith('memory_threshold_exceeded');
    });
});
