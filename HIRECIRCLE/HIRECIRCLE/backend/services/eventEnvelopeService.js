const crypto = require('crypto');
const EventEnvelope = require('../models/EventEnvelope');
const ArchivedEventEnvelope = require('../models/ArchivedEventEnvelope');
const logger = require('../utils/logger');
const { getRequestContext } = require('../utils/requestContext');

const MASKED_KEYS = /(email|phone|name|firstName|lastName|address|password|otp|token|secret|authorization|cookie|apiKey|accessKey|refresh|jwt|tax|aadhaar|pan|dob)/i;
const DEFAULT_REGION = String(process.env.APP_REGION || 'GLOBAL').toUpperCase();
const DEFAULT_APP_VERSION = String(process.env.APP_VERSION || 'unknown').trim() || 'unknown';

const normalizeString = (value, max = 256) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.slice(0, max);
};

const normalizeEventType = (eventType) => {
    const normalized = String(eventType || '')
        .trim()
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase();
    return normalized || 'UNKNOWN_EVENT';
};

const maskValue = (key, value, depth = 0) => {
    if (depth > 6) return '[TRUNCATED]';
    if (value === null || value === undefined) return value;

    if (MASKED_KEYS.test(String(key || ''))) {
        return '[REDACTED]';
    }

    if (Array.isArray(value)) {
        return value.map((item) => maskValue(key, item, depth + 1));
    }

    if (typeof value === 'object') {
        return Object.entries(value).reduce((acc, [childKey, childValue]) => {
            acc[childKey] = maskValue(childKey, childValue, depth + 1);
            return acc;
        }, {});
    }

    if (typeof value === 'string') {
        if (value.length > 2000) return `${value.slice(0, 2000)}...`;
        return value;
    }

    return value;
};

const sanitizeMetadata = (metadata = {}) => {
    if (!metadata || typeof metadata !== 'object') return {};
    return maskValue('', metadata, 0);
};

const resolveRegion = (candidateRegion = null) => {
    const context = getRequestContext();
    const raw = normalizeString(candidateRegion || context.region || DEFAULT_REGION, 64);
    return String(raw || DEFAULT_REGION).toUpperCase();
};

const resolveAppVersion = (candidateVersion = null) => {
    const context = getRequestContext();
    return normalizeString(candidateVersion || context.appVersion || DEFAULT_APP_VERSION, 64) || DEFAULT_APP_VERSION;
};

const toDateOrNow = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return new Date();
    return date;
};

const buildEnvelopePayload = ({
    eventId = null,
    eventType,
    actorId = null,
    entityId = null,
    metadata = {},
    timestampUTC = null,
    region = null,
    appVersion = null,
    source = 'service',
}) => ({
    eventId: normalizeString(eventId, 128) || crypto.randomUUID(),
    eventType: normalizeEventType(eventType),
    actorId: normalizeString(actorId, 128),
    entityId: normalizeString(entityId, 128),
    metadata: sanitizeMetadata(metadata),
    timestampUTC: toDateOrNow(timestampUTC),
    region: resolveRegion(region),
    appVersion: resolveAppVersion(appVersion),
    source: normalizeString(source, 128) || 'service',
});

const emitEventEnvelope = async (payload = {}) => {
    const envelope = buildEnvelopePayload(payload);
    try {
        return await EventEnvelope.create(envelope);
    } catch (error) {
        if (error?.code === 11000) {
            return null;
        }
        throw error;
    }
};

const safeEmitEventEnvelope = (payload = {}) => {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
        return;
    }
    setImmediate(async () => {
        try {
            await emitEventEnvelope(payload);
        } catch (error) {
            logger.warn(`event envelope emit failed: ${error.message}`);
        }
    });
};

const archiveRawEventsBefore = async ({
    cutoffDate,
    batchSize = Number.parseInt(process.env.WAREHOUSE_ARCHIVE_BATCH_SIZE || '1000', 10),
} = {}) => {
    const cutoff = toDateOrNow(cutoffDate || new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)));
    const safeBatchSize = Math.max(100, Math.min(5000, Number(batchSize) || 1000));

    let archivedCount = 0;
    let purgedCount = 0;
    let scannedCount = 0;

    while (true) {
        const rows = await EventEnvelope.find({
            timestampUTC: { $lt: cutoff },
        })
            .sort({ timestampUTC: 1, _id: 1 })
            .limit(safeBatchSize)
            .lean();

        if (!rows.length) break;
        scannedCount += rows.length;

        const archivedRows = rows.map((row) => ({
            eventId: row.eventId,
            eventType: row.eventType,
            actorId: row.actorId || null,
            entityId: row.entityId || null,
            metadata: sanitizeMetadata(row.metadata || {}),
            timestampUTC: row.timestampUTC,
            region: row.region || DEFAULT_REGION,
            appVersion: row.appVersion || DEFAULT_APP_VERSION,
            source: row.source || 'archive',
            archivedAt: new Date(),
        }));

        if (archivedRows.length) {
            const insertResult = await ArchivedEventEnvelope.insertMany(archivedRows, { ordered: false }).catch((error) => {
                if (error?.code === 11000 || error?.writeErrors?.length) {
                    return [];
                }
                throw error;
            });
            archivedCount += Array.isArray(insertResult) ? insertResult.length : 0;
        }

        const deleteResult = await EventEnvelope.deleteMany({
            _id: { $in: rows.map((row) => row._id) },
        });
        purgedCount += Number(deleteResult?.deletedCount || 0);
    }

    return {
        cutoff,
        scannedCount,
        archivedCount,
        purgedCount,
    };
};

module.exports = {
    emitEventEnvelope,
    safeEmitEventEnvelope,
    buildEnvelopePayload,
    sanitizeMetadata,
    archiveRawEventsBefore,
};
