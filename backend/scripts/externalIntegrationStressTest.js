#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = String(process.env.EXTERNAL_STRESS_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = String(process.env.EXTERNAL_STRESS_API_KEY || '');
const DASHBOARD_BEARER = String(process.env.EXTERNAL_STRESS_DASHBOARD_TOKEN || '');

if (!API_KEY) {
    console.error('Missing EXTERNAL_STRESS_API_KEY');
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const apiClient = axios.create({
    baseURL: BASE_URL,
    timeout: 10000,
    validateStatus: () => true,
});

const callExternalJobs = async (headers = {}) => {
    return apiClient.get('/api/v1/external/jobs?limit=1', {
        headers: {
            'x-api-key': API_KEY,
            ...headers,
        },
    });
};

const runBurstScenario = async () => {
    const rounds = 10;
    const perRound = 50;
    const waitPerRoundMs = 6000;

    const statusCounts = {};

    for (let round = 0; round < rounds; round += 1) {
        const requests = Array.from({ length: perRound }).map(() => callExternalJobs());
        const responses = await Promise.all(requests);
        for (const res of responses) {
            statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
        }

        if (round < rounds - 1) {
            await sleep(waitPerRoundMs);
        }
    }

    return {
        scenario: '500-api-calls-per-minute',
        totalCalls: rounds * perRound,
        statusCounts,
        passed: Boolean(statusCounts[200] || statusCounts[429] || statusCounts[403]),
    };
};

const runWebhookFailureSimulation = async () => {
    if (!DASHBOARD_BEARER) {
        return {
            scenario: 'webhook-failure-simulation',
            skipped: true,
            reason: 'EXTERNAL_STRESS_DASHBOARD_TOKEN not set',
        };
    }

    const authHeaders = {
        Authorization: `Bearer ${DASHBOARD_BEARER}`,
    };

    const createWebhook = await apiClient.post('/api/v1/external/dashboard/webhooks', {
        eventType: 'job.created',
        targetUrl: 'https://127.0.0.1:1/fail-me',
    }, { headers: authHeaders });

    if (createWebhook.status < 200 || createWebhook.status >= 300) {
        return {
            scenario: 'webhook-failure-simulation',
            passed: false,
            status: createWebhook.status,
            details: createWebhook.data,
        };
    }

    const webhookId = createWebhook.data?.data?.id;
    const testResponse = await apiClient.post(`/api/v1/external/dashboard/webhooks/${webhookId}/test`, {}, {
        headers: authHeaders,
    });

    await sleep(4000);

    const logsResponse = await apiClient.get('/api/v1/external/dashboard/webhook-logs?limit=5', {
        headers: authHeaders,
    });

    const logs = logsResponse.data?.data || [];
    const failedLog = logs.find((log) => String(log.webhookId) === String(webhookId));

    return {
        scenario: 'webhook-failure-simulation',
        passed: Boolean(testResponse.status >= 200 && testResponse.status < 300 && failedLog),
        webhookId,
        testStatus: testResponse.status,
        observedStatus: failedLog?.status || null,
        observedError: failedLog?.lastError || null,
    };
};

const runReplayAttackAttempt = async () => {
    const idempotencyKey = `replay-${Date.now()}`;

    const first = await apiClient.post('/api/v1/external/jobs', {}, {
        headers: {
            'x-api-key': API_KEY,
            'x-idempotency-key': idempotencyKey,
        },
    });

    const second = await apiClient.post('/api/v1/external/jobs', {}, {
        headers: {
            'x-api-key': API_KEY,
            'x-idempotency-key': idempotencyKey,
        },
    });

    return {
        scenario: 'replay-attack-attempt',
        firstStatus: first.status,
        secondStatus: second.status,
        passed: second.status === 409,
    };
};

const runApiKeyBruteAttempt = async () => {
    const attempts = 60;
    let blockedStatus = null;

    for (let index = 0; index < attempts; index += 1) {
        const response = await apiClient.get('/api/v1/external/jobs?limit=1', {
            headers: {
                'x-api-key': `invalid_${index}_${Date.now()}`,
            },
        });

        if (response.status === 429) {
            blockedStatus = response.status;
            break;
        }
    }

    return {
        scenario: 'api-key-brute-attempt',
        passed: blockedStatus === 429,
        blockedStatus,
    };
};

const runRateLimitBypassAttempt = async () => {
    const attempts = 180;
    const statuses = {};

    const requests = Array.from({ length: attempts }).map((_, index) => callExternalJobs({
        'x-forwarded-for': `1.1.1.${index % 200}`,
    }));

    const responses = await Promise.all(requests);
    for (const response of responses) {
        statuses[response.status] = (statuses[response.status] || 0) + 1;
    }

    return {
        scenario: 'rate-limit-bypass-attempt',
        statusCounts: statuses,
        passed: Boolean(statuses[429]),
    };
};

const main = async () => {
    const startedAt = Date.now();

    const results = [];
    results.push(await runBurstScenario());
    results.push(await runWebhookFailureSimulation());
    results.push(await runReplayAttackAttempt());
    results.push(await runApiKeyBruteAttempt());
    results.push(await runRateLimitBypassAttempt());

    const passed = results.every((item) => item.passed === true || item.skipped === true);

    const summary = {
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        passed,
        results,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!passed) {
        process.exit(2);
    }
};

main().catch((error) => {
    console.error(JSON.stringify({
        passed: false,
        error: error.message,
    }, null, 2));
    process.exit(1);
});
