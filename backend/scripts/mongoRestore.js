#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('../utils/logger');

const mongoUri = String(process.env.MONGO_URI || '').trim();
if (!mongoUri) {
    logger.error('MONGO_URI is required');
    process.exit(1);
}

const archiveArg = process.argv[2];
if (!archiveArg) {
    logger.error('Usage: node scripts/mongoRestore.js <archive-path> [--drop=false]');
    process.exit(1);
}

const archivePath = path.resolve(process.cwd(), archiveArg);
if (!fs.existsSync(archivePath)) {
    logger.error({ event: 'mongo_restore_missing_archive', archivePath });
    process.exit(1);
}

const shouldDrop = !process.argv.includes('--drop=false');
const args = [
    `--uri=${mongoUri}`,
    `--archive=${archivePath}`,
    '--gzip',
];
if (shouldDrop) {
    args.push('--drop');
}

logger.info({ event: 'mongo_restore_started', archivePath, shouldDrop });

const restore = spawnSync('mongorestore', args, {
    stdio: 'inherit',
});

if (restore.status !== 0) {
    logger.error({ event: 'mongo_restore_failed', code: restore.status, archivePath });
    process.exit(restore.status || 1);
}

logger.info({ event: 'mongo_restore_completed', archivePath, shouldDrop });
