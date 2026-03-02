#!/usr/bin/env node
/* eslint-disable no-console */
process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const {
    requestDrainMiddleware,
    registerGracefulShutdown,
    requestGracefulShutdown,
    isShuttingDown,
    getInFlightRequestCount,
} = require('../services/gracefulShutdownService');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'disaster-recovery-server-crash.json');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Avoid sandbox-specific winston exception handler crash path (uv_uptime EPERM).
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
process.on('uncaughtException', (error) => {
    console.warn('[simulate:dr:server-crash] uncaughtException:', error.message);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const message = reason?.message || String(reason || 'unknown');
    console.warn('[simulate:dr:server-crash] unhandledRejection:', message);
    process.exit(1);
});

const createMockReqRes = () => {
    const req = {
        method: 'GET',
        url: '/health',
        headers: {},
    };

    class MockRes extends EventEmitter {
        constructor() {
            super();
            this.statusCode = 200;
            this.headers = {};
            this.payload = null;
        }

        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = String(value);
        }

        status(code) {
            this.statusCode = Number(code);
            return this;
        }

        json(payload) {
            this.payload = payload;
            this.emit('finish');
            return this;
        }
    }

    return { req, res: new MockRes() };
};

const run = async () => {
    const fakeServer = {
        listening: true,
        close(callback) {
            this.listening = false;
            if (typeof callback === 'function') callback();
        },
    };

    registerGracefulShutdown({ server: fakeServer });

    const inflightCount = 35;
    const inflight = Array.from({ length: inflightCount }, async () => {
        const { req, res } = createMockReqRes();
        return new Promise((resolve) => {
            requestDrainMiddleware(req, res, () => {
                setTimeout(() => {
                    res.status(200).json({ ok: true });
                    resolve(res.statusCode);
                }, 120);
            });
        });
    });

    await wait(20);

    const shutdownPromise = requestGracefulShutdown('dr_server_crash_simulation');

    await wait(10);

    const { req: drainReq, res: drainRes } = createMockReqRes();
    requestDrainMiddleware(drainReq, drainRes, () => {
        drainRes.status(200).json({ ok: true });
    });

    const inflightStatuses = await Promise.all(inflight.map((item) => item.catch(() => 0)));
    await shutdownPromise;

    const successfulInflight = inflightStatuses.filter((status) => status === 200).length;
    const failedInflight = inflightStatuses.length - successfulInflight;

    const report = {
        generatedAt: new Date().toISOString(),
        requestedInFlight: inflightStatuses.length,
        successfulInFlight: successfulInflight,
        failedInFlight: failedInflight,
        postShutdownStatus: drainRes.statusCode,
        drainingStateObserved: isShuttingDown(),
        serverClosed: fakeServer.listening === false,
        inFlightAfterShutdown: getInFlightRequestCount(),
        passed: successfulInflight === inflightStatuses.length
            && drainRes.statusCode === 503
            && fakeServer.listening === false
            && getInFlightRequestCount() === 0,
    };

    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.passed ? 0 : 1);
};

run().catch((error) => {
    console.warn('[simulate:dr:server-crash] failed:', error.message);
    process.exit(1);
});
