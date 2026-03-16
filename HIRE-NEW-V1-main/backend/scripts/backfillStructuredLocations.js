#!/usr/bin/env node
const dotenv = require('dotenv');

dotenv.config();

const connectDB = require('../config/db');
const { backfillStructuredLocations } = require('../services/locationBackfillService');

const run = async () => {
    try {
        await connectDB();
        const summary = await backfillStructuredLocations();
        process.stdout.write(`${JSON.stringify({
            ok: true,
            summary,
            ranAt: new Date().toISOString(),
        }, null, 2)}\n`);
        process.exit(0);
    } catch (error) {
        process.stderr.write(`Structured location backfill failed: ${error.message}\n`);
        process.exit(1);
    }
};

run();
