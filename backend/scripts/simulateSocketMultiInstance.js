#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const {
    attachRedisAdapterToSocketIo,
    consumeSocketRateLimit,
    rememberSocketMessageId,
} = require('../services/socketScalingService');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'socket-multi-instance-simulation.json');

// Avoid sandbox-specific winston exception handler crash path (uv_uptime EPERM).
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
process.on('uncaughtException', (error) => {
    console.warn('[simulate:socket:multi-instance] uncaughtException:', error.message);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const message = reason?.message || String(reason || 'unknown');
    console.warn('[simulate:socket:multi-instance] unhandledRejection:', message);
    process.exit(1);
});

const createInstance = async (label) => {
    const server = http.createServer();
    const io = new Server(server, {
        cors: {
            origin: true,
            credentials: true,
        },
    });

    let adapterState;
    try {
        adapterState = await attachRedisAdapterToSocketIo(io);
    } catch (error) {
        adapterState = {
            enabled: false,
            reason: `init_failed:${error.message}`,
        };
    }

    return {
        label,
        server,
        io,
        adapterState,
    };
};

const closeAdapterClients = async (adapterState) => {
    if (!adapterState?.enabled) return;

    const clients = [adapterState.pubClient, adapterState.subClient].filter(Boolean);
    for (const client of clients) {
        try {
            if (typeof client.quit === 'function') {
                // eslint-disable-next-line no-await-in-loop
                await client.quit();
            } else if (typeof client.disconnect === 'function') {
                // eslint-disable-next-line no-await-in-loop
                await client.disconnect();
            }
        } catch (_error) {
            // best-effort cleanup
        }
    }
};

const run = async () => {
    const instanceA = await createInstance('instance-a');
    const instanceB = await createInstance('instance-b');

    try {
        const duplicateFirstSeen = await rememberSocketMessageId({
            namespace: 'multi-instance-chat',
            key: 'shared-user:shared-message-id',
            dedupeWindowMs: 5000,
        });
        const duplicateSecondSeen = await rememberSocketMessageId({
            namespace: 'multi-instance-chat',
            key: 'shared-user:shared-message-id',
            dedupeWindowMs: 5000,
        });

        const rateAllowance = [];
        rateAllowance.push(await consumeSocketRateLimit({
            namespace: 'multi-instance-burst',
            key: 'shared-user',
            limit: 3,
            windowMs: 5000,
        }));
        rateAllowance.push(await consumeSocketRateLimit({
            namespace: 'multi-instance-burst',
            key: 'shared-user',
            limit: 3,
            windowMs: 5000,
        }));
        rateAllowance.push(await consumeSocketRateLimit({
            namespace: 'multi-instance-burst',
            key: 'shared-user',
            limit: 3,
            windowMs: 5000,
        }));
        rateAllowance.push(await consumeSocketRateLimit({
            namespace: 'multi-instance-burst',
            key: 'shared-user',
            limit: 3,
            windowMs: 5000,
        }));

        const report = {
            generatedAt: new Date().toISOString(),
            instances: 2,
            adapter: {
                instanceA: instanceA.adapterState,
                instanceB: instanceB.adapterState,
            },
            crossInstanceChecks: {
                dedupe: {
                    firstWasDuplicate: duplicateFirstSeen,
                    secondWasDuplicate: duplicateSecondSeen,
                    passed: duplicateFirstSeen === false && duplicateSecondSeen === true,
                },
                rateLimit: {
                    sequence: rateAllowance,
                    passed: rateAllowance[0] === true
                        && rateAllowance[1] === true
                        && rateAllowance[2] === true
                        && rateAllowance[3] === false,
                },
            },
            passed: false,
        };

        report.passed = report.crossInstanceChecks.dedupe.passed
            && report.crossInstanceChecks.rateLimit.passed
            && !String(instanceA.adapterState.reason || '').startsWith('init_failed')
            && !String(instanceB.adapterState.reason || '').startsWith('init_failed');

        fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
        fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        process.exit(report.passed ? 0 : 1);
    } finally {
        await closeAdapterClients(instanceA.adapterState);
        await closeAdapterClients(instanceB.adapterState);
        if (instanceA.server.listening) {
            await new Promise((resolve) => instanceA.server.close(() => resolve()));
        }
        if (instanceB.server.listening) {
            await new Promise((resolve) => instanceB.server.close(() => resolve()));
        }
        instanceA.io.removeAllListeners();
        instanceB.io.removeAllListeners();
    }
};

run().catch((error) => {
    console.warn('[simulate:socket:multi-instance] failed:', error.message);
    process.exit(1);
});
