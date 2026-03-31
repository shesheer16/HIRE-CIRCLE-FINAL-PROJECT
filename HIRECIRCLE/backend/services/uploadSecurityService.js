const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const isProductionRuntime = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const startsWithBytes = (buffer, signature) => {
    if (!Buffer.isBuffer(buffer) || !Array.isArray(signature) || !signature.length) return false;
    if (buffer.length < signature.length) return false;
    return signature.every((value, index) => buffer[index] === value);
};

const ensureExtensionMatchesMime = (originalName, mimeType, allowedMap) => {
    const extension = path.extname(String(originalName || '')).toLowerCase();
    const allowedExtensions = allowedMap.get(String(mimeType || '').toLowerCase()) || [];
    if (!allowedExtensions.length) return false;
    return allowedExtensions.includes(extension);
};

const readFileHeader = (filePath, bytes = 32) => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const header = Buffer.alloc(bytes);
        fs.readSync(fd, header, 0, bytes, 0);
        return header;
    } finally {
        fs.closeSync(fd);
    }
};

const isValidMp4Signature = (filePath) => {
    try {
        const header = readFileHeader(filePath, 64);
        return header.includes(Buffer.from('ftyp'));
    } catch (_error) {
        return false;
    }
};

const runVirusScanHook = async ({ filePath, mimeType, originalName, correlationId } = {}) => {
    const provider = String(process.env.VIRUS_SCAN_PROVIDER || 'placeholder').trim().toLowerCase();

    if (provider === 'placeholder' || !provider) {
        if (isProductionRuntime()) {
            const error = new Error('Virus scanner provider is not configured');
            error.statusCode = 503;
            throw error;
        }
        logger.info({
            event: 'virus_scan_placeholder',
            correlationId,
            mimeType,
            originalName,
            filePath,
        });

        return {
            passed: true,
            provider: 'placeholder',
            details: 'No scanner configured. Placeholder hook executed.',
        };
    }

    // Reserved for future scanner integrations.
    logger.warn({
        event: 'virus_scan_provider_not_implemented',
        provider,
        correlationId,
    });

    if (isProductionRuntime()) {
        const error = new Error(`Virus scanner provider "${provider}" is not implemented`);
        error.statusCode = 503;
        throw error;
    }

    return {
        passed: true,
        provider,
        details: 'Scanner provider not implemented; allowed by policy placeholder.',
    };
};

const isValidAttachmentSignature = (filePath, mimeType) => {
    const normalizedMimeType = String(mimeType || '').toLowerCase();

    try {
        const header = readFileHeader(filePath, 32);

        if (normalizedMimeType === 'application/pdf') {
            return startsWithBytes(header, [0x25, 0x50, 0x44, 0x46, 0x2d]);
        }
        if (normalizedMimeType === 'application/msword') {
            return startsWithBytes(header, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        }
        if (normalizedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            return startsWithBytes(header, [0x50, 0x4b, 0x03, 0x04]);
        }
        if (normalizedMimeType === 'image/jpeg') {
            return startsWithBytes(header, [0xff, 0xd8, 0xff]);
        }
        if (normalizedMimeType === 'image/png') {
            return startsWithBytes(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        }
        if (normalizedMimeType === 'image/webp') {
            return startsWithBytes(header, [0x52, 0x49, 0x46, 0x46])
                && startsWithBytes(header.subarray(8, 12), [0x57, 0x45, 0x42, 0x50]);
        }

        return false;
    } catch (_error) {
        return false;
    }
};

module.exports = {
    ensureExtensionMatchesMime,
    isValidMp4Signature,
    runVirusScanHook,
    isValidAttachmentSignature,
};
