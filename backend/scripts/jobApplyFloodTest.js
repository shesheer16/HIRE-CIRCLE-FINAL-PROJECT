#!/usr/bin/env node
const axios = require('axios');

const baseUrl = String(process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const token = String(process.env.LOADTEST_TOKEN || '').trim();
const jobId = String(process.env.LOADTEST_JOB_ID || '').trim();
const workerId = String(process.env.LOADTEST_WORKER_ID || '').trim();
const initiatedBy = String(process.env.LOADTEST_INITIATED_BY || 'worker').trim();
const attempts = Number.parseInt(process.env.JOB_APPLY_ATTEMPTS || '40', 10);

if (!token || !jobId || !workerId) {
    process.stderr.write('LOADTEST_TOKEN, LOADTEST_JOB_ID, and LOADTEST_WORKER_ID are required.\n');
    process.exit(1);
}

(async () => {
    const report = {
        baseUrl,
        attempts,
        succeeded: 0,
        rateLimited: 0,
        conflict: 0,
        failed: 0,
        statuses: [],
        startedAt: new Date().toISOString(),
    };

    for (let i = 0; i < attempts; i += 1) {
        const response = await axios.post(`${baseUrl}/api/applications`, {
            jobId,
            workerId,
            initiatedBy,
        }, {
            timeout: 10000,
            validateStatus: () => true,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        report.statuses.push(response.status);
        if (response.status === 429) {
            report.rateLimited += 1;
        } else if (response.status === 409 || response.status === 400) {
            report.conflict += 1;
        } else if (response.status >= 200 && response.status < 300) {
            report.succeeded += 1;
        } else {
            report.failed += 1;
        }
    }

    report.finishedAt = new Date().toISOString();
    report.pass = report.rateLimited > 0;

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.pass ? 0 : 1);
})();
