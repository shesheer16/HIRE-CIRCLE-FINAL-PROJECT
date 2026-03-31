const crypto = require('crypto');
const IdempotencyKey = require('../../models/IdempotencyKey');

const LOCK_TTL_MS = Number.parseInt(process.env.PAYMENT_IDEMPOTENCY_LOCK_MS || String(5 * 60 * 1000), 10);

const hashRequestPayload = (payload = {}) => crypto
    .createHash('sha256')
    .update(JSON.stringify(payload || {}))
    .digest('hex');

const buildCompositeKey = ({ scope, userId, key }) => `${String(scope || '').trim()}::${String(userId || '').trim()}::${String(key || '').trim()}`;

const beginIdempotentRequest = async ({ key, scope, userId, payload }) => {
    if (!key) {
        return {
            mode: 'none',
            record: null,
            requestHash: null,
        };
    }

    const requestHash = hashRequestPayload(payload);
    const compositeKey = buildCompositeKey({ scope, userId, key });
    const now = new Date();
    const lockUntil = new Date(now.getTime() + LOCK_TTL_MS);

    const existing = await IdempotencyKey.findOne({ compositeKey });
    if (existing) {
        if (existing.requestHash !== requestHash) {
            const error = new Error('Idempotency key reuse with mismatched payload');
            error.statusCode = 409;
            throw error;
        }

        if (existing.responseBody !== null && existing.responseStatus !== null) {
            return {
                mode: 'replay',
                replayResponse: {
                    statusCode: existing.responseStatus,
                    body: existing.responseBody,
                },
                record: existing,
                requestHash,
            };
        }

        if (existing.lockedUntil && existing.lockedUntil > now) {
            const error = new Error('Request with this idempotency key is currently processing');
            error.statusCode = 409;
            throw error;
        }

        existing.lockedUntil = lockUntil;
        await existing.save();
        return {
            mode: 'active',
            record: existing,
            requestHash,
        };
    }

    let created = null;
    try {
        created = await IdempotencyKey.create({
            compositeKey,
            key,
            scope,
            userId,
            requestHash,
            lockedUntil: lockUntil,
        });
    } catch (error) {
        if (Number(error?.code) !== 11000) {
            throw error;
        }

        const concurrent = await IdempotencyKey.findOne({ compositeKey });
        if (!concurrent) {
            const conflict = new Error('Idempotency key conflict');
            conflict.statusCode = 409;
            throw conflict;
        }

        if (concurrent.requestHash !== requestHash) {
            const mismatchError = new Error('Idempotency key reuse with mismatched payload');
            mismatchError.statusCode = 409;
            throw mismatchError;
        }

        if (concurrent.responseBody !== null && concurrent.responseStatus !== null) {
            return {
                mode: 'replay',
                replayResponse: {
                    statusCode: concurrent.responseStatus,
                    body: concurrent.responseBody,
                },
                record: concurrent,
                requestHash,
            };
        }

        if (concurrent.lockedUntil && concurrent.lockedUntil > now) {
            const processingError = new Error('Request with this idempotency key is currently processing');
            processingError.statusCode = 409;
            throw processingError;
        }

        concurrent.lockedUntil = lockUntil;
        await concurrent.save();
        return {
            mode: 'active',
            record: concurrent,
            requestHash,
        };
    }

    return {
        mode: 'active',
        record: created,
        requestHash,
    };
};

const finalizeIdempotentRequest = async ({ record, statusCode, body }) => {
    if (!record) return;

    record.responseStatus = statusCode;
    record.responseBody = body;
    record.lockedUntil = null;
    await record.save();
};

const clearIdempotentLock = async ({ record }) => {
    if (!record) return;
    record.lockedUntil = null;
    await record.save();
};

module.exports = {
    hashRequestPayload,
    beginIdempotentRequest,
    finalizeIdempotentRequest,
    clearIdempotentLock,
};
