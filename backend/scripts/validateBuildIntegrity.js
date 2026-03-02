#!/usr/bin/env node
const dotenv = require('dotenv');

dotenv.config();

const { validateEnvironment } = require('../config/env');
const { startupIntegrityCheck } = require('../services/startupIntegrityService');

try {
    const env = validateEnvironment();
    const integrity = startupIntegrityCheck({ strict: true });

    process.stdout.write(JSON.stringify({
        success: true,
        runtime: env.runtime,
        startupIntegrity: integrity,
    }, null, 2));
    process.stdout.write('\n');
    process.exit(0);
} catch (error) {
    process.stderr.write(`Build integrity validation failed: ${error.message}\n`);
    process.exit(1);
}
