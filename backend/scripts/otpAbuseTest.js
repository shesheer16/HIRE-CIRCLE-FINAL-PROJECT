#!/usr/bin/env node
const axios = require('axios');

const baseUrl = String(process.env.LOADTEST_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const targetEmail = String(process.env.OTP_TEST_EMAIL || 'abuse-test@example.com');
const attempts = Number.parseInt(process.env.OTP_TEST_ATTEMPTS || '6', 10);

(async () => {
    const report = {
        baseUrl,
        targetEmail,
        attempts,
        succeeded: 0,
        rateLimited: 0,
        failed: 0,
        statuses: [],
        startedAt: new Date().toISOString(),
    };

    for (let i = 0; i < attempts; i += 1) {
        try {
            const response = await axios.post(`${baseUrl}/api/auth/send-otp`, {
                email: targetEmail,
            }, {
                timeout: 10000,
                validateStatus: () => true,
            });

            report.statuses.push(response.status);
            if (response.status === 429) {
                report.rateLimited += 1;
            } else if (response.status >= 200 && response.status < 300) {
                report.succeeded += 1;
            } else {
                report.failed += 1;
            }
        } catch (_error) {
            report.failed += 1;
            report.statuses.push('network_error');
        }
    }

    report.finishedAt = new Date().toISOString();
    report.pass = report.rateLimited > 0;

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.pass ? 0 : 1);
})();
