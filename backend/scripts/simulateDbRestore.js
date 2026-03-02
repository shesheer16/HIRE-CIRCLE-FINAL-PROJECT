#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPORT_PATH = path.join(__dirname, '..', 'reports', 'disaster-recovery-db-restore.json');
const TMP_DIR = path.join(__dirname, '..', 'reports', 'dr-temp');

const checksum = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const buildDataset = () => {
    const users = Array.from({ length: 250 }, (_, i) => ({
        _id: `u-${i}`,
        role: i % 5 === 0 ? 'employer' : 'worker',
        city: `city-${i % 20}`,
    }));

    const jobs = Array.from({ length: 120 }, (_, i) => ({
        _id: `j-${i}`,
        employerId: `u-${i % 50}`,
        status: 'active',
    }));

    const applications = Array.from({ length: 500 }, (_, i) => ({
        _id: `a-${i}`,
        jobId: `j-${i % 120}`,
        workerId: `u-${(i % 200) + 50}`,
        status: i % 4 === 0 ? 'hired' : 'applied',
    }));

    return { users, jobs, applications };
};

const validateIntegrity = (dataset) => {
    const userSet = new Set(dataset.users.map((row) => row._id));
    const jobSet = new Set(dataset.jobs.map((row) => row._id));

    let brokenApplications = 0;
    for (const app of dataset.applications) {
        if (!jobSet.has(app.jobId) || !userSet.has(app.workerId)) {
            brokenApplications += 1;
        }
    }

    return {
        brokenApplications,
        passed: brokenApplications === 0,
    };
};

const run = async () => {
    fs.mkdirSync(TMP_DIR, { recursive: true });

    const backupPath = path.join(TMP_DIR, 'db-backup.json');
    const livePath = path.join(TMP_DIR, 'db-live.json');

    const sourceDataset = buildDataset();
    const sourceChecksum = checksum(sourceDataset);

    fs.writeFileSync(backupPath, JSON.stringify(sourceDataset, null, 2));
    fs.writeFileSync(livePath, JSON.stringify(sourceDataset, null, 2));

    const corrupted = JSON.parse(JSON.stringify(sourceDataset));
    corrupted.applications.splice(0, 50);
    corrupted.jobs.splice(0, 10);
    fs.writeFileSync(livePath, JSON.stringify(corrupted, null, 2));

    const backupRaw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    fs.writeFileSync(livePath, JSON.stringify(backupRaw, null, 2));

    const restoredDataset = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    const restoredChecksum = checksum(restoredDataset);
    const integrity = validateIntegrity(restoredDataset);

    const passed = restoredChecksum === sourceChecksum && integrity.passed;

    const report = {
        generatedAt: new Date().toISOString(),
        backupPath,
        livePath,
        sourceChecksum,
        restoredChecksum,
        checksumMatched: restoredChecksum === sourceChecksum,
        integrity,
        restoredCollections: {
            users: restoredDataset.users.length,
            jobs: restoredDataset.jobs.length,
            applications: restoredDataset.applications.length,
        },
        passed,
    };

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(passed ? 0 : 1);
};

run().catch((error) => {
    console.warn('[simulate:dr:db-restore] failed:', error.message);
    process.exit(1);
});
