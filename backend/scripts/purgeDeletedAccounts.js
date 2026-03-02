#!/usr/bin/env node
const dotenv = require('dotenv');
const mongoose = require('mongoose');

dotenv.config();

const connectDB = require('../config/db');
const User = require('../models/userModel');
const { deleteUserDataCascade } = require('../services/privacyService');

const main = async () => {
    await connectDB();

    const now = new Date();
    const candidates = await User.find({
        isDeleted: true,
        'deletionLifecycle.status': 'scheduled',
        'deletionLifecycle.purgeAfter': { $lte: now },
    }).select('_id email deletionLifecycle').lean();

    const report = {
        scannedAt: now.toISOString(),
        candidates: candidates.length,
        purged: 0,
        failed: 0,
        errors: [],
    };

    for (const user of candidates) {
        try {
            await deleteUserDataCascade({ userId: user._id });
            report.purged += 1;
        } catch (error) {
            report.failed += 1;
            report.errors.push({
                userId: String(user._id),
                message: error.message,
            });
        }
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    await mongoose.disconnect();

    if (report.failed > 0) {
        process.exit(1);
    }
    process.exit(0);
};

main().catch(async (error) => {
    process.stderr.write(`purgeDeletedAccounts failed: ${error.message}\n`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
