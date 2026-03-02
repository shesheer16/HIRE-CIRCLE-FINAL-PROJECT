#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');

const User = require('../models/userModel');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Message = require('../models/Message');

const REQUIRED_COLLECTIONS = [
    { name: 'users', model: User },
    { name: 'jobs', model: Job },
    { name: 'applications', model: Application },
    { name: 'messages', model: Message },
];

const mongoUri = String(process.env.MONGO_URI || '').trim();
if (!mongoUri) {
    process.stderr.write('MONGO_URI is required\n');
    process.exit(1);
}

const archiveArg = process.argv[2] || null;
const shouldRestore = process.argv.includes('--restore');
const shouldDrop = !process.argv.includes('--drop=false');

if (shouldRestore && !archiveArg) {
    process.stderr.write('Usage: node scripts/mongoRestoreIntegrityTest.js <archive-path> [--restore] [--drop=false]\n');
    process.exit(1);
}

const runRestore = () => {
    const archivePath = path.resolve(process.cwd(), archiveArg);
    if (!fs.existsSync(archivePath)) {
        throw new Error(`Archive not found: ${archivePath}`);
    }

    const args = [
        `--uri=${mongoUri}`,
        `--archive=${archivePath}`,
        '--gzip',
    ];
    if (shouldDrop) {
        args.push('--drop');
    }

    const result = spawnSync('mongorestore', args, { stdio: 'inherit' });
    if (result.status !== 0) {
        throw new Error(`mongorestore failed with exit code ${result.status}`);
    }
};

const runIntegrityChecks = async () => {
    await mongoose.connect(mongoUri);

    const checks = [];
    for (const entry of REQUIRED_COLLECTIONS) {
        const count = await entry.model.countDocuments({});
        checks.push({
            collection: entry.name,
            count,
            ok: count >= 0,
        });
    }

    const user = await User.findOne({}).select('_id email createdAt').lean();
    const job = await Job.findOne({}).select('_id employerId createdAt').lean();
    const app = await Application.findOne({}).select('_id job worker employer status createdAt').lean();

    const relationalChecks = {
        userSamplePresent: Boolean(user),
        jobSamplePresent: Boolean(job),
        applicationSamplePresent: Boolean(app),
        jobHasEmployer: Boolean(job?.employerId),
        applicationHasRefs: Boolean(app?.job && app?.worker && app?.employer),
    };

    const passed = checks.every((row) => row.ok)
        && Object.values(relationalChecks).every(Boolean);

    return {
        checkedAt: new Date().toISOString(),
        restoreRan: shouldRestore,
        checks,
        relationalChecks,
        passed,
    };
};

(async () => {
    try {
        if (shouldRestore) {
            runRestore();
        }

        const report = await runIntegrityChecks();
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        await mongoose.disconnect();

        process.exit(report.passed ? 0 : 1);
    } catch (error) {
        process.stderr.write(`mongoRestoreIntegrityTest failed: ${error.message}\n`);
        await mongoose.disconnect().catch(() => {});
        process.exit(1);
    }
})();
