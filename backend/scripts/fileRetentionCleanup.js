#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const RETENTION_DAYS = Math.max(1, Number.parseInt(process.env.FILE_RETENTION_DAYS || '30', 10));
const cutoffMs = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

const targets = [
    path.resolve(__dirname, '..', 'exports'),
    path.resolve(__dirname, '..', 'backups'),
    path.resolve(__dirname, '..', '..', 'logs'),
];

const report = {
    startedAt: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    scannedFiles: 0,
    deletedFiles: 0,
    bytesFreed: 0,
    errors: [],
};

const shouldDelete = (stats) => Number(stats.mtimeMs || 0) < cutoffMs;

const walk = (directory) => {
    if (!fs.existsSync(directory)) return;

    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        try {
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }

            const stats = fs.statSync(fullPath);
            report.scannedFiles += 1;
            if (!shouldDelete(stats)) continue;

            fs.unlinkSync(fullPath);
            report.deletedFiles += 1;
            report.bytesFreed += Number(stats.size || 0);
        } catch (error) {
            report.errors.push({ path: fullPath, message: error.message });
        }
    }
};

targets.forEach((target) => walk(target));
report.completedAt = new Date().toISOString();
report.success = report.errors.length === 0;

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.success ? 0 : 1);
