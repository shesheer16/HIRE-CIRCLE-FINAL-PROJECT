#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const logger = require('../utils/logger');

const main = async () => {
    const mongoUri = String(process.env.MONGO_URI || '').trim();
    if (!mongoUri) {
        logger.error('MONGO_URI is required');
        process.exit(1);
    }

    const outputRoot = String(process.env.MONGO_BACKUP_DIR || path.join(__dirname, '..', 'backups', 'mongo')).trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(outputRoot, `mongo-backup-${timestamp}.archive.gz`);
    const metadataPath = path.join(outputRoot, `mongo-backup-${timestamp}.json`);

    fs.mkdirSync(outputRoot, { recursive: true });

    logger.info({ event: 'mongo_backup_started', archivePath });

    const dump = spawnSync('mongodump', [
        `--uri=${mongoUri}`,
        `--archive=${archivePath}`,
        '--gzip',
    ], {
        stdio: 'inherit',
    });

    if (dump.status !== 0) {
        logger.error({ event: 'mongo_backup_failed', code: dump.status });
        process.exit(dump.status || 1);
    }

    const fileBuffer = fs.readFileSync(archivePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const fileSizeBytes = fileBuffer.length;
    const s3Path = String(process.env.BACKUP_S3_PATH || 's3://<backup-bucket>/hirecircle/mongo').trim();

    const metadata = {
        createdAt: new Date().toISOString(),
        archivePath,
        fileSizeBytes,
        checksum,
        mongoUriRedacted: mongoUri.replace(/:\/\/[^@]+@/, '://***@'),
        suggestedS3Path: `${s3Path}/${path.basename(archivePath)}`,
    };

    const backupBucket = String(process.env.BACKUP_S3_BUCKET || process.env.AWS_BACKUP_BUCKET || '').trim();
    const backupRegion = String(process.env.BACKUP_AWS_REGION || process.env.AWS_REGION || '').trim();
    const backupPrefix = String(process.env.BACKUP_S3_PREFIX || 'hirecircle/backups/mongo').trim().replace(/^\/+|\/+$/g, '');
    const kmsKeyId = String(process.env.BACKUP_KMS_KEY_ID || '').trim();
    let uploadedToS3 = null;

    if (backupBucket && backupRegion) {
        try {
            const s3 = new S3Client({
                region: backupRegion,
                credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
                    ? {
                        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                    }
                    : undefined,
            });
            const key = `${backupPrefix}/${path.basename(archivePath)}`;
            const encryption = kmsKeyId ? 'aws:kms' : 'AES256';

            await s3.send(new PutObjectCommand({
                Bucket: backupBucket,
                Key: key,
                Body: fs.createReadStream(archivePath),
                ServerSideEncryption: encryption,
                ...(kmsKeyId ? { SSEKMSKeyId: kmsKeyId } : {}),
                Metadata: {
                    checksum,
                    createdAt: metadata.createdAt,
                },
            }));

            uploadedToS3 = {
                bucket: backupBucket,
                key,
                region: backupRegion,
                encryption,
                kmsKeyId: kmsKeyId || null,
            };
            metadata.uploadedToS3 = uploadedToS3;
        } catch (error) {
            metadata.uploadedToS3 = null;
            metadata.s3UploadError = error.message;
            logger.warn({
                event: 'mongo_backup_s3_upload_failed',
                message: error.message,
                backupBucket,
            });
        }
    }

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    logger.info({
        event: 'mongo_backup_completed',
        archivePath,
        metadataPath,
        fileSizeBytes,
        checksum,
        suggestedS3Path: metadata.suggestedS3Path,
        uploadedToS3,
    });
};

main().catch((error) => {
    logger.error({
        event: 'mongo_backup_unhandled_error',
        message: error.message,
    });
    process.exit(1);
});
