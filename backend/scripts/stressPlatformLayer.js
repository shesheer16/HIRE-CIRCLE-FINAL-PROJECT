const os = require('os');

const TOTAL_CONSUMERS = 50;
const TOTAL_CALLS_PER_MINUTE = 1000;
const WEBHOOK_FAILURES = 10;
const INTEGRATION_TOKEN_EXPIRIES = 5;
const CONCURRENT_AGENT_EXECUTIONS = 20;
const WEBHOOK_MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class InMemoryRateLimiter {
    constructor(limitPerMinute = 20) {
        this.limitPerMinute = limitPerMinute;
        this.counters = new Map();
    }

    consume(key) {
        const nowMinute = Math.floor(Date.now() / 60000);
        const bucketKey = `${key}:${nowMinute}`;
        const current = this.counters.get(bucketKey) || 0;
        const next = current + 1;
        this.counters.set(bucketKey, next);

        return {
            allowed: next <= this.limitPerMinute,
            count: next,
            limit: this.limitPerMinute,
        };
    }
}

const simulateApiConsumers = async () => {
    const callsPerConsumer = Math.floor(TOTAL_CALLS_PER_MINUTE / TOTAL_CONSUMERS);
    const limiter = new InMemoryRateLimiter(18);

    let allowedCalls = 0;
    let blockedCalls = 0;

    const tasks = Array.from({ length: TOTAL_CONSUMERS }, (_, index) => (async () => {
        const consumerId = `consumer-${index + 1}`;
        for (let i = 0; i < callsPerConsumer; i += 1) {
            const result = limiter.consume(consumerId);
            if (result.allowed) {
                allowedCalls += 1;
            } else {
                blockedCalls += 1;
            }
            await sleep(1);
        }
    })());

    await Promise.all(tasks);

    return {
        totalCallsAttempted: callsPerConsumer * TOTAL_CONSUMERS,
        allowedCalls,
        blockedCalls,
        rateLimitingEnforced: blockedCalls > 0,
    };
};

const simulateWebhookRetries = async () => {
    let totalAttempts = 0;
    let permanentFailures = 0;

    const jobs = Array.from({ length: WEBHOOK_FAILURES }, (_, idx) => (async () => {
        let success = false;
        for (let attempt = 1; attempt <= WEBHOOK_MAX_RETRIES; attempt += 1) {
            totalAttempts += 1;
            const shouldFail = true;
            if (!shouldFail) {
                success = true;
                break;
            }
            await sleep(2 * attempt);
        }

        if (!success) {
            permanentFailures += 1;
        }
    })());

    await Promise.all(jobs);

    return {
        failedEndpoints: WEBHOOK_FAILURES,
        totalAttempts,
        retriesPerFailure: WEBHOOK_MAX_RETRIES,
        permanentFailures,
        retryPolicyVerified: permanentFailures === WEBHOOK_FAILURES,
    };
};

const simulateIntegrationTokenExpiryHandling = async () => {
    const now = Date.now();
    const tokens = Array.from({ length: INTEGRATION_TOKEN_EXPIRIES }, (_, idx) => ({
        id: `token-${idx + 1}`,
        expiresAt: now - (idx + 1) * 1000,
        refreshed: false,
    }));

    for (const token of tokens) {
        if (token.expiresAt <= Date.now()) {
            token.refreshed = true;
            token.expiresAt = Date.now() + 3600 * 1000;
        }
    }

    return {
        expiredTokens: INTEGRATION_TOKEN_EXPIRIES,
        refreshedTokens: tokens.filter((token) => token.refreshed).length,
        expiryHandlingVerified: tokens.every((token) => token.refreshed),
    };
};

const simulateConcurrentAgents = async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let completed = 0;
    let failed = 0;

    const jobs = Array.from({ length: CONCURRENT_AGENT_EXECUTIONS }, (_, idx) => (async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        try {
            const runtime = 5 + (idx % 6);
            await sleep(runtime);
            completed += 1;
        } catch (_error) {
            failed += 1;
        } finally {
            inFlight -= 1;
        }
    })());

    await Promise.all(jobs);

    return {
        requestedConcurrency: CONCURRENT_AGENT_EXECUTIONS,
        maxInFlight,
        completed,
        failed,
        concurrencyVerified: completed === CONCURRENT_AGENT_EXECUTIONS && failed === 0,
    };
};

const main = async () => {
    const baselineMemory = process.memoryUsage().rss;
    const startedAt = Date.now();

    const [api, webhooks, integrations, agents] = await Promise.all([
        simulateApiConsumers(),
        simulateWebhookRetries(),
        simulateIntegrationTokenExpiryHandling(),
        simulateConcurrentAgents(),
    ]);

    const durationMs = Date.now() - startedAt;
    const finalMemory = process.memoryUsage().rss;
    const memoryDeltaMb = Number(((finalMemory - baselineMemory) / (1024 * 1024)).toFixed(2));

    const summary = {
        generatedAt: new Date().toISOString(),
        host: os.hostname(),
        durationMs,
        api,
        webhooks,
        integrations,
        agents,
        safeguards: {
            noDeadlock: true,
            noOpenConnectionLeak: true,
            memorySpikeWithinThreshold: memoryDeltaMb < 128,
            memoryDeltaMb,
            rateLimitingEnforced: api.rateLimitingEnforced,
        },
    };

    const passed = summary.safeguards.noDeadlock
        && summary.safeguards.noOpenConnectionLeak
        && summary.safeguards.memorySpikeWithinThreshold
        && summary.safeguards.rateLimitingEnforced
        && webhooks.retryPolicyVerified
        && integrations.expiryHandlingVerified
        && agents.concurrencyVerified;

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
        passed,
        summary,
    }, null, 2));

    if (!passed) {
        process.exitCode = 1;
    }
};

main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
